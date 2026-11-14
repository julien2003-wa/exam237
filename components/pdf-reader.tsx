'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { fileSize, isSavedOffline, OFFLINE_CACHE, readLocal, writeLocal, type Paper } from './lib';

/*
  Lecteur intégré : le sujet et ses corrections s'ouvrent dans l'application.
  - Le fichier est demandé par morceaux : seules les pages regardées sont téléchargées.
  - Les derniers documents ouverts restent en mémoire : passer du sujet à la correction et
    revenir ne retélécharge rien.
  - Seules les pages proches de l'écran sont dessinées (téléphones modestes).
  - La page où l'élève s'est arrêté est retenue.
  - Un fichier enregistré sur le téléphone s'ouvre sans connexion.
  - Zoom avec deux doigts, double appui, ou les boutons − et +.
*/

const PAGE_KEY = 'exam237-lecture';
const EXAM_KEY = 'exam237-mode-examen';
const STEPS = [1, 1.25, 1.5, 2, 2.5, 3];
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
// Au-delà, certains téléphones n'affichent plus rien (et la mémoire sature).
const MAX_PIXELS = 5_000_000;
// Morceaux de 64 Ko : les morceaux voisins sont demandés ensemble, en une seule requête.
const CHUNK = 65536;
// Un petit fichier (moins de 512 Ko) est demandé en une fois.
const SMALL_FILE = 8 * CHUNK;
const KEEP_DOCS = 3;

type Doc = { key: string; label: string; url: string };

let pdfjsPromise: Promise<any> | null = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((lib: any) => {
      // Fichiers copiés par scripts/copy-pdfjs.mjs, rangés par version.
      lib.GlobalWorkerOptions.workerSrc = `/pdfjs/${lib.version}/pdf.worker.min.mjs`;
      return lib;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

// Après un enregistrement hors ligne : le lecteur lui-même est gardé en cache, pour lire
// sans connexion si l'application est déjà ouverte.
export function preloadReader() {
  loadPdfjs()
    .then(lib => fetch(`/pdfjs/${lib.version}/pdf.worker.min.mjs`))
    .catch(() => {});
}

class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

// Un morceau du fichier ; deux nouveaux essais si le réseau coupe.
async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        cache: 'no-store',
      });
      if (r.status === 206) return new Uint8Array(await r.arrayBuffer());
      if (r.status === 200) return new Uint8Array((await r.arrayBuffer()).slice(start, end + 1));
      if (r.status < 500) throw new HttpError(r.status);
      lastError = new HttpError(r.status);
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) throw e;
      lastError = e;
    }
    await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw lastError;
}

type Loaded = {
  url: string;
  task: any;
  ready: Promise<any>;
  offline: boolean;
  broken: boolean;
  onBroken: Set<() => void>;
};
const loadedDocs: Loaded[] = [];

function dropDoc(doc: Loaded) {
  const i = loadedDocs.indexOf(doc);
  if (i >= 0) loadedDocs.splice(i, 1);
  try {
    doc.task?.destroy?.();
  } catch {}
}

// À la déconnexion : rien ne reste en mémoire pour le compte suivant.
export function clearReaderCache() {
  while (loadedDocs.length) dropDoc(loadedDocs[0]);
}

function openDocument(lib: any, url: string): Loaded {
  const cached = loadedDocs.find(d => d.url === url && !d.broken);
  if (cached) {
    loadedDocs.splice(loadedDocs.indexOf(cached), 1);
    loadedDocs.push(cached);
    return cached;
  }
  for (const old of loadedDocs.filter(d => d.url === url)) dropDoc(old);
  const doc: Loaded = {
    url,
    task: null,
    ready: Promise.resolve(null),
    offline: false,
    broken: false,
    onBroken: new Set(),
  };
  const base = `/pdfjs/${lib.version}/`;
  const common = {
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    isEvalSupported: false,
    enableXfa: false,
  };
  doc.ready = (async () => {
    const data = await offlineData(url);
    if (data) {
      doc.offline = true;
      doc.task = lib.getDocument({ ...common, data });
      return doc.task.promise;
    }
    const size = await fileSize(url);
    if (size && size > SMALL_FILE) {
      const first = await fetchRange(url, 0, CHUNK - 1);
      const transport = new lib.PDFDataRangeTransport(size, first);
      transport.requestDataRange = (begin: number, end: number) => {
        fetchRange(url, begin, end - 1)
          .then(chunk => transport.onDataRange(begin, chunk))
          .catch(() => {
            // Morceau introuvable après trois essais : le document est à rouvrir.
            doc.broken = true;
            for (const listener of doc.onBroken) listener();
          });
      };
      doc.task = lib.getDocument({
        ...common,
        range: transport,
        rangeChunkSize: CHUNK,
        disableAutoFetch: true,
        disableStream: true,
      });
    } else {
      doc.task = lib.getDocument({
        ...common,
        url,
        rangeChunkSize: CHUNK,
        disableAutoFetch: true,
        disableStream: true,
      });
    }
    return doc.task.promise;
  })();
  doc.ready.catch(() => dropDoc(doc));
  loadedDocs.push(doc);
  while (loadedDocs.length > KEEP_DOCS) dropDoc(loadedDocs[0]);
  return doc;
}

async function offlineData(url: string): Promise<ArrayBuffer | null> {
  if (!isSavedOffline(url) || typeof caches === 'undefined') return null;
  try {
    const hit = await (await caches.open(OFFLINE_CACHE)).match(url);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

// Cherche une information dans le texte des premières pages d'un PDF (admin : la durée écrite
// en haut d'un sujet), page après page. Pour un fichier en ligne, seuls les morceaux utiles
// sont téléchargés. Un PDF scanné (des photos) n'a pas de texte : le résultat est alors null.
export async function findInPdf<T>(
  source: File | string,
  maxPages: number,
  test: (pageText: string) => T | null
): Promise<T | null> {
  const lib = await loadPdfjs();
  const base = `/pdfjs/${lib.version}/`;
  const common = {
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    isEvalSupported: false,
    enableXfa: false,
  };
  let task: any;
  if (typeof source !== 'string') {
    task = lib.getDocument({ ...common, data: new Uint8Array(await source.arrayBuffer()) });
  } else {
    const size = await fileSize(source);
    if (size && size > SMALL_FILE) {
      const first = await fetchRange(source, 0, CHUNK - 1);
      const transport = new lib.PDFDataRangeTransport(size, first);
      transport.requestDataRange = (begin: number, end: number) => {
        fetchRange(source, begin, end - 1)
          .then(chunk => transport.onDataRange(begin, chunk))
          .catch(() => task?.destroy?.());
      };
      task = lib.getDocument({
        ...common,
        range: transport,
        rangeChunkSize: CHUNK,
        disableAutoFetch: true,
        disableStream: true,
      });
    } else {
      task = lib.getDocument({
        ...common,
        url: source,
        rangeChunkSize: CHUNK,
        disableAutoFetch: true,
        disableStream: true,
      });
    }
  }
  try {
    const pdf = await task.promise;
    for (let n = 1; n <= Math.min(maxPages, pdf.numPages); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`)
        .join('');
      const found = test(text);
      if (found !== null && found !== undefined) return found;
    }
    return null;
  } finally {
    try {
      task.destroy();
    } catch {}
  }
}

function formatLeft(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function errorFor(e: any): { text: string; premium?: boolean; retry: boolean } {
  const status = Number(e?.status) || Number(/\((\d{3})\)/.exec(String(e?.message || ''))?.[1]);
  if (status === 402)
    return { text: 'Ce document est réservé aux membres Premium.', premium: true, retry: false };
  if (status === 401)
    return { text: 'Ta session a expiré. Reconnecte-toi pour lire ce document.', retry: false };
  if (status === 403)
    return { text: 'Ce document n’est pas disponible pour ta classe.', retry: false };
  if (status === 404) return { text: 'Ce document n’est plus disponible.', retry: false };
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return { text: 'Pas de connexion internet. Vérifie ton réseau, puis réessaie.', retry: true };
  return { text: 'Le document n’a pas pu s’ouvrir dans l’application.', retry: true };
}

export default function PdfReader({
  paper,
  doc,
  onClose,
  onSwitch,
  onPremium,
}: {
  paper: Paper;
  doc: string; // 'paper' ou l'identifiant d'une correction
  onClose: () => void;
  onSwitch: (doc: string) => void;
  onPremium: () => void;
}) {
  const docs = useMemo<Doc[]>(() => {
    const list: Doc[] = [];
    if (paper.paperUrl) list.push({ key: 'paper', label: 'Sujet', url: paper.paperUrl });
    const withPdf = paper.corrections.filter(c => c.pdfUrl);
    withPdf.forEach((c, i) =>
      list.push({
        key: c.id,
        label: withPdf.length > 1 ? c.title || `Correction ${i + 1}` : 'Correction',
        url: c.pdfUrl!,
      })
    );
    return list;
  }, [paper]);
  const current = docs.find(d => d.key === doc) || docs[0] || null;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<any>(null);
  const tasks = useRef<Map<number, any>>(new Map());
  const rendered = useRef<Map<number, number>>(new Map()); // page → largeur dessinée
  const [pages, setPages] = useState<Array<{ w: number; h: number }>>([]);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [failure, setFailure] = useState<ReturnType<typeof errorFor> | null>(null);
  const [offline, setOffline] = useState(false);
  const [resumed, setResumed] = useState<number | null>(null);
  const [examLeft, setExamLeft] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  // Chrono du mode examen, s'il est lancé pour ce sujet.
  const buzzed = useRef(false);
  useEffect(() => {
    const tick = () => {
      const run = readLocal<{ paperId: string; startedAt: number; minutes: number } | null>(
        EXAM_KEY,
        null
      );
      const left =
        run && run.paperId === paper.id ? run.startedAt + run.minutes * 60000 - Date.now() : null;
      // Un chrono terminé depuis longtemps n'est plus affiché.
      setExamLeft(left !== null && left > -30 * 60000 ? left : null);
      if (left !== null && left <= 0 && left > -2000 && !buzzed.current) {
        buzzed.current = true;
        try {
          navigator.vibrate?.([200, 100, 200]);
        } catch {}
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [paper.id]);

  // Touche Échap (ordinateur). Le bouton « retour » du téléphone est géré par l'adresse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Largeur disponible (la page tient dans l'écran au zoom 1).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(el.clientWidth - 16, 900));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ouverture du document (ou reprise s'il vient d'être lu).
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    let doc: Loaded | null = null;
    const broken = () => {
      if (cancelled) return;
      setFailure(errorFor(new Error('broken')));
      setStatus('error');
    };
    setStatus('loading');
    setFailure(null);
    setPages([]);
    setZoom(1);
    setPage(1);
    rendered.current.clear();
    (async () => {
      try {
        const lib = await loadPdfjs();
        if (cancelled) return;
        doc = openDocument(lib, current.url);
        doc.onBroken.add(broken);
        const pdf = await doc.ready;
        if (cancelled) return;
        if (doc.broken) return broken();
        setOffline(doc.offline);
        pdfRef.current = pdf;
        const first = await pdf.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setPages(Array.from({ length: pdf.numPages }, () => ({ w: vp.width, h: vp.height })));
        setStatus('ready');
        const saved = readLocal<Record<string, number>>(PAGE_KEY, {})[current.url];
        setResumed(saved && saved > 1 && saved <= pdf.numPages ? saved : null);
      } catch (e: any) {
        if (cancelled) return;
        setFailure(errorFor(e));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      doc?.onBroken.delete(broken);
      for (const t of tasks.current.values()) t?.cancel?.();
      tasks.current.clear();
      pdfRef.current = null;
    };
  }, [current?.url, reload]);

  // Aller à la page où l'élève s'était arrêté.
  useEffect(() => {
    if (status !== 'ready' || !resumed || !width) return;
    const el = document.getElementById(`pdf-page-${resumed}`);
    const box = scrollRef.current;
    if (el && box) box.scrollTop = el.offsetTop - 8;
  }, [status, resumed, width]);

  const pageWidth = Math.round(width * zoom);

  const renderPage = useCallback(
    async (n: number) => {
      const pdf = pdfRef.current;
      const canvas = document.getElementById(`pdf-canvas-${n}`) as HTMLCanvasElement | null;
      if (!pdf || !canvas || !pageWidth) return;
      if (rendered.current.get(n) === pageWidth) return;
      tasks.current.get(n)?.cancel?.();
      let job: any = null;
      try {
        const p = await pdf.getPage(n);
        const base = p.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        let scale = (pageWidth / base.width) * ratio;
        if (base.width * base.height * scale * scale > MAX_PIXELS)
          scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
        const viewport = p.getViewport({ scale });
        delete canvas.dataset.drawn;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${pageWidth}px`;
        canvas.style.height = `${Math.round(pageWidth * (base.height / base.width))}px`;
        setPages(list => {
          const cur = list[n - 1];
          if (!cur || (cur.w === base.width && cur.h === base.height)) return list;
          const next = list.slice();
          next[n - 1] = { w: base.width, h: base.height };
          return next;
        });
        job = p.render({ canvas, viewport });
        tasks.current.set(n, job);
        await job.promise;
        rendered.current.set(n, pageWidth);
        canvas.dataset.drawn = '1';
      } catch {
        /* rendu annulé (défilement rapide) */
      } finally {
        if (job && tasks.current.get(n) === job) tasks.current.delete(n);
      }
    },
    [pageWidth]
  );

  // Dessine les pages proches de l'écran, libère les autres (mémoire des petits téléphones).
  useEffect(() => {
    const box = scrollRef.current;
    if (status !== 'ready' || !box || !pages.length || !pageWidth) return;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) renderPage(n);
          else if (rendered.current.has(n) || tasks.current.has(n)) {
            tasks.current.get(n)?.cancel?.();
            tasks.current.delete(n);
            const canvas = document.getElementById(`pdf-canvas-${n}`) as HTMLCanvasElement | null;
            if (canvas) {
              canvas.width = 0;
              canvas.height = 0;
              delete canvas.dataset.drawn;
            }
            rendered.current.delete(n);
            // Libère aussi les images décodées de cette page.
            pdfRef.current
              ?.getPage(n)
              .then((p: any) => p.cleanup())
              .catch(() => {});
          }
        }
      },
      { root: box, rootMargin: '100% 0px' }
    );
    box.querySelectorAll('[data-page]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [status, pages.length, pageWidth, renderPage]);

  // Le message « Reprise à la page… » disparaît tout seul.
  useEffect(() => {
    if (!resumed) return;
    const timer = window.setTimeout(() => setResumed(null), 3500);
    return () => window.clearTimeout(timer);
  }, [resumed]);

  const onScroll = () => {
    const box = scrollRef.current;
    if (!box || !pages.length) return;
    const mid = box.scrollTop + box.clientHeight * 0.4;
    let n = 1;
    for (let i = 1; i <= pages.length; i++) {
      const el = document.getElementById(`pdf-page-${i}`);
      if (el && el.offsetTop <= mid) n = i;
      else break;
    }
    if (n !== page) {
      setPage(n);
      if (current) {
        const all = readLocal<Record<string, number>>(PAGE_KEY, {});
        delete all[current.url];
        all[current.url] = n;
        const keys = Object.keys(all);
        if (keys.length > 60) delete all[keys[0]];
        writeLocal(PAGE_KEY, all);
      }
    }
  };

  // Zoom autour d'un point de l'écran (le centre, ou l'endroit touché).
  const applyZoom = (next: number, x?: number, y?: number) => {
    const target = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 100) / 100;
    const box = scrollRef.current;
    if (target === zoom) return;
    if (!box) return setZoom(target);
    const ax = x ?? box.clientWidth / 2;
    const ay = y ?? box.clientHeight / 2;
    const factor = target / zoom;
    const cx = box.scrollLeft + ax;
    const cy = box.scrollTop + ay;
    setZoom(target);
    requestAnimationFrame(() => {
      box.scrollLeft = cx * factor - ax;
      box.scrollTop = cy * factor - ay;
    });
  };

  const step = (dir: 1 | -1) => {
    const next =
      dir > 0
        ? (STEPS.find(z => z > zoom + 0.01) ?? MAX_ZOOM)
        : ([...STEPS].reverse().find(z => z < zoom - 0.01) ?? MIN_ZOOM);
    applyZoom(next);
  };

  // Deux doigts : l'image grossit tout de suite, la page est redessinée nette ensuite.
  const pinch = useRef<{ dist: number; zoom: number; x: number; y: number; scale: number } | null>(
    null
  );
  const tap = useRef<{ t: number; x: number; y: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const point = (touch: React.Touch) => {
    const rect = scrollRef.current!.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (status !== 'ready' || !scrollRef.current) return;
    if (e.touches.length === 2) {
      tap.current = null;
      const a = point(e.touches[0]);
      const b = point(e.touches[1]);
      const box = scrollRef.current;
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        scale: 1,
      };
      if (pagesRef.current)
        pagesRef.current.style.transformOrigin = `${box.scrollLeft + pinch.current.x}px ${
          box.scrollTop + pinch.current.y
        }px`;
    } else if (e.touches.length === 1) {
      const p = point(e.touches[0]);
      tap.current = { t: Date.now(), x: p.x, y: p.y, moved: false };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const p = pinch.current;
    if (p && e.touches.length === 2) {
      const a = point(e.touches[0]);
      const b = point(e.touches[1]);
      const raw = Math.hypot(a.x - b.x, a.y - b.y) / p.dist;
      p.scale = Math.min(MAX_ZOOM / p.zoom, Math.max(MIN_ZOOM / p.zoom, raw));
      if (pagesRef.current) pagesRef.current.style.transform = `scale(${p.scale})`;
      return;
    }
    const t = tap.current;
    if (t && e.touches.length === 1) {
      const q = point(e.touches[0]);
      if (Math.hypot(q.x - t.x, q.y - t.y) > 10) t.moved = true;
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const p = pinch.current;
    if (p) {
      if (e.touches.length >= 2) return;
      pinch.current = null;
      if (pagesRef.current) {
        pagesRef.current.style.transform = '';
        pagesRef.current.style.transformOrigin = '';
      }
      applyZoom(p.zoom * p.scale, p.x, p.y);
      return;
    }
    // Double appui : zoom ×2, ou retour à la taille normale.
    const t = tap.current;
    tap.current = null;
    if (!t || t.moved || Date.now() - t.t > 250 || e.touches.length) return;
    const prev = lastTap.current;
    if (prev && t.t - prev.t < 320 && Math.hypot(t.x - prev.x, t.y - prev.y) < 30) {
      lastTap.current = null;
      applyZoom(zoom > 1.05 ? 1 : 2, t.x, t.y);
    } else lastTap.current = { t: t.t, x: t.x, y: t.y };
  };

  const header = (
    <header className="reader-head">
      <button type="button" className="reader-btn" aria-label="Retour" onClick={onClose}>
        <Icon name="back" strokeWidth={2.4} />
      </button>
      <div className="grow reader-title">
        <b>
          {paper.subjectName} {paper.year}
        </b>
        {current ? (
          <span>
            {current.label}
            {offline ? ', sur ton téléphone' : ''}
          </span>
        ) : null}
      </div>
      {examLeft !== null ? (
        <span
          className={`reader-chrono ${examLeft < 10 * 60000 ? 'low' : ''}`}
          aria-label="Temps restant"
        >
          <Icon name="clock" size={14} /> {examLeft > 0 ? formatLeft(examLeft) : 'Temps écoulé'}
        </span>
      ) : null}
    </header>
  );

  if (!current)
    return (
      <div className="reader" role="dialog" aria-modal="true" aria-label="Lecteur">
        {header}
        <div className="reader-body">
          <div className="reader-msg">
            <p>
              {paper.locked
                ? 'Ce sujet est réservé aux membres Premium.'
                : 'Ce document n’est pas disponible.'}
            </p>
            {paper.locked ? (
              <div className="reader-actions">
                <button type="button" className="btn btn-gold" onClick={onPremium}>
                  Devenir Premium
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );

  return (
    <div
      className="reader"
      role="dialog"
      aria-modal="true"
      aria-label={`${current.label}, ${paper.subjectName} ${paper.year}`}
    >
      {header}

      {docs.length > 1 ? (
        <div className="reader-tabs" role="tablist">
          {docs.map(d => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={d.key === current.key}
              onClick={() => d.key !== current.key && onSwitch(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="reader-body"
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {status === 'loading' ? (
          <div className="reader-msg">
            <span className="spinner" />
            {current.key === 'paper' ? 'Ouverture du sujet…' : 'Ouverture de la correction…'}
          </div>
        ) : null}
        {status === 'error' && failure ? (
          <div className="reader-msg">
            <p>{failure.text}</p>
            <div className="reader-actions">
              {failure.premium ? (
                <button type="button" className="btn btn-gold" onClick={onPremium}>
                  Devenir Premium
                </button>
              ) : null}
              {failure.retry ? (
                <>
                  <button
                    type="button"
                    className="btn btn-gold"
                    onClick={() => setReload(r => r + 1)}
                  >
                    Réessayer
                  </button>
                  <a className="btn btn-light" href={current.url} target="_blank" rel="noopener">
                    Ouvrir avec une autre application
                  </a>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        {status === 'ready' ? (
          <div ref={pagesRef} className="reader-pages">
            {pages.map((size, i) => (
              <div
                key={i}
                id={`pdf-page-${i + 1}`}
                data-page={i + 1}
                className="reader-page"
                style={{
                  width: pageWidth,
                  height: Math.round(pageWidth * (size.h / size.w)),
                }}
              >
                <canvas id={`pdf-canvas-${i + 1}`} aria-label={`Page ${i + 1}`} />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {status === 'ready' ? (
        <footer className="reader-foot">
          <button
            type="button"
            className="reader-btn"
            aria-label="Dézoomer"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => step(-1)}
          >
            <span aria-hidden="true">−</span>
          </button>
          <span className="reader-page-count">
            Page {page} / {pages.length}
          </span>
          <button
            type="button"
            className="reader-btn"
            aria-label="Zoomer"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => step(1)}
          >
            <span aria-hidden="true">+</span>
          </button>
        </footer>
      ) : null}

      {resumed && status === 'ready' ? (
        <button type="button" className="reader-resume" onClick={() => setResumed(null)}>
          Reprise à la page {resumed}
        </button>
      ) : null}
    </div>
  );
}
