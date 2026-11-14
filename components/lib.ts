'use client';

/* ---------------- Types partagés par l'application élève ---------------- */

export type Viewer = {
  role: 'student' | 'admin';
  userId: string | null;
  email: string;
  displayName: string;
  classCode: string | null;
  classLabel: string | null;
  groupId: string | null;
  groupLabel: string | null;
  examType: string | null;
  accountStatus: 'active' | 'suspended' | 'admin';
  premium: boolean;
  premiumUntil: string | null;
};

export type Correction = {
  id: string;
  title: string;
  reviewer: string | null;
  hasPdf: boolean;
  hasVideo: boolean;
  pdfUrl: string | null;
  videoUrl: string | null;
};

export type Paper = {
  id: string;
  classCode: string;
  classLabel: string;
  year: number;
  session: string;
  title: string;
  subjectId: string;
  subjectName: string;
  durationMinutes: number | null;
  publishedAt: string;
  isNew: boolean;
  free: boolean;
  locked: boolean;
  favorite: boolean;
  status: 'done' | 'review' | null;
  paperUrl: string | null;
  corrections: Correction[];
};

export type Promo = {
  id: string;
  kind: 'own' | 'partner';
  title: string;
  videoUrl: string | null;
  // Image de la vidéo : affichée tout de suite (ronds de l'accueil, ouverture du statut).
  posterUrl: string | null;
  youtubeId: string | null;
  ctaType: 'none' | 'premium' | 'whatsapp' | 'link';
  ctaLabel: string | null;
  ctaUrl: string | null;
  createdAt?: string | null;
};

// Un statut vient d'être vu : l'accueil passe son rond au gris tout de suite.
export const SEEN_EVENT = 'exam237-statut-vu';

export type Site = {
  whatsapp: string;
  prices: Record<string, string>;
  examDate: string | null;
};

export type Bootstrap = {
  viewer: Viewer;
  papers: Paper[];
  rooms: any[];
  promos: Promo[];
  resume: { paperId: string; openedAt: string } | null;
  site: Site;
  assistant: { chat: boolean; tutor: boolean; tutorLimit: number };
  warning?: string;
};

export type Notify = (text: string, type?: 'error') => void;

/* ---------------- Requêtes ---------------- */

export async function api(url: string, opts?: RequestInit, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, cache: 'no-store', signal: controller.signal });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error: any = new Error(d.error || 'Une erreur est survenue.');
      error.status = r.status;
      error.data = d;
      throw error;
    }
    return d;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('La connexion prend trop de temps. Réessaie.');
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

export const post = (url: string, body: unknown, timeoutMs?: number) =>
  api(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    timeoutMs
  );

/* ---------------- WhatsApp et Premium ---------------- */

export const PLANS = [
  { months: '1', label: '1 mois' },
  { months: '3', label: '3 mois' },
  { months: '6', label: '6 mois' },
  { months: '12', label: '12 mois' },
];

export function whatsappUrl(number: string, text: string) {
  const base = number ? `https://wa.me/${number}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function premiumMessage(viewer: Viewer, planLabel: string, price: string, renew = false) {
  return [
    renew
      ? 'Bonjour Exam237, je veux renouveler mon Premium.'
      : 'Bonjour Exam237, je veux passer Premium.',
    `Nom : ${viewer.displayName || 'non renseigné'}`,
    `E-mail : ${viewer.email}`,
    `Classe : ${viewer.classLabel || 'non renseignée'}${viewer.groupLabel && viewer.groupLabel !== viewer.classLabel ? ` (${viewer.groupLabel})` : ''}`,
    `Formule : ${planLabel}${price ? ` (${price})` : ''}`,
  ].join('\n');
}

/* ---------------- Matières : couleurs et abréviations ---------------- */

const SUBJECT_COLORS: Array<[RegExp, string]> = [
  [/math/i, '#064b3a'],
  [/phys|chim|pct|techno/i, '#1d4ed8'],
  [/svt|vie|bio|eehb/i, '#0f766e'],
  [/fran|litt/i, '#b45309'],
  [/angl|english/i, '#7c3aed'],
  [/hist|g[ée]o|ecm/i, '#9a3412'],
  [/info/i, '#334155'],
  [/philo/i, '#86198f'],
  [/esp|allem|lang/i, '#be123c'],
];
const FALLBACK = ['#0e7490', '#4d7c0f', '#a16207', '#6d28d9', '#b91c1c', '#0369a1'];

export function subjectColor(name: string) {
  for (const [re, color] of SUBJECT_COLORS) if (re.test(name)) return color;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

export function subjectShort(name: string) {
  const clean = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const parts = clean.split(/[\s\-–/]+/).filter(Boolean);
  if (/^pct$/i.test(clean.trim())) return 'PC';
  if (parts.length >= 2 && /phys/i.test(parts[0])) return 'PC';
  const first = parts[0] || name;
  return (first.slice(0, 2) || '??').replace(/^./, c => c.toUpperCase());
}

/* ---------------- Dates ---------------- */

export function daysUntil(date: string | null | undefined) {
  if (!date) return null;
  const target = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function daysLeft(value: string | null | undefined) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  return Number.isNaN(diff) ? null : Math.ceil(diff / 86400000);
}

export function frDate(value: string | null | undefined, long = true) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(
    'fr-FR',
    long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: '2-digit', month: 'short' }
  );
}

export function timeAgo(value: string | null | undefined) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.round(diff / 60000);
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'hier';
  if (d < 31) return `il y a ${d} jours`;
  return frDate(value);
}

/* ---------------- Petits stockages sur le téléphone ---------------- */

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {}
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Lecture hors ligne (Premium) ---------------- */

/* ---------------- Économie de données ---------------- */

const sizeCache = new Map<string, Promise<number | null>>();

// Taille d'un fichier avant de l'ouvrir (requête HEAD, aucune donnée du fichier téléchargée).
export function fileSize(url: string | null | undefined): Promise<number | null> {
  if (!url) return Promise.resolve(null);
  let pending = sizeCache.get(url);
  if (!pending) {
    pending = fetch(url, { method: 'HEAD', cache: 'no-store' })
      .then(r => {
        const n = Number(r.headers.get('content-length'));
        return r.ok && n > 0 ? n : null;
      })
      .catch(() => null);
    sizeCache.set(url, pending);
  }
  return pending;
}

const WIFI_KEY = 'exam237-wifi-seulement';

// « Télécharger seulement en Wi-Fi » : activé d'office si le téléphone demande d'économiser les données.
export function wifiOnly(): boolean {
  const saved = readLocal<boolean | null>(WIFI_KEY, null);
  if (saved !== null) return saved;
  return !!(typeof navigator !== 'undefined' && (navigator as any).connection?.saveData);
}

export function setWifiOnly(value: boolean) {
  writeLocal(WIFI_KEY, value);
}

// « wifi », « cellular » (données mobiles) ou « unknown » (iPhone : le navigateur ne le dit pas).
export function connectionType(): 'wifi' | 'cellular' | 'unknown' {
  const type = typeof navigator !== 'undefined' ? (navigator as any).connection?.type : undefined;
  if (type === 'wifi' || type === 'ethernet') return 'wifi';
  if (type === 'cellular' || type === 'wimax' || type === 'bluetooth') return 'cellular';
  return 'unknown';
}

export const OFFLINE_CACHE = 'exam237-offline-v1';
const OFFLINE_INDEX = 'exam237-offline-index';

export type OfflineItem = {
  key: string;
  title: string;
  subtitle: string;
  kind: 'paper' | 'correction';
  size: number;
  savedAt: string;
};

export function offlineSupported() {
  return typeof window !== 'undefined' && 'caches' in window;
}

export function offlineList(): OfflineItem[] {
  return readLocal<OfflineItem[]>(OFFLINE_INDEX, []);
}

export function isSavedOffline(url: string) {
  return offlineList().some(item => item.key === url);
}

export async function saveOffline(
  url: string,
  meta: { title: string; subtitle: string; kind: 'paper' | 'correction' }
) {
  if (!offlineSupported()) throw new Error('Ton navigateur ne permet pas la lecture hors ligne.');
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) {
    const d = await response.json().catch(() => ({}));
    throw new Error(d.error || 'Téléchargement impossible.');
  }
  const blob = await response.blob();
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.put(
    url,
    new Response(blob, { headers: { 'Content-Type': blob.type || 'application/pdf' } })
  );
  const list = offlineList().filter(item => item.key !== url);
  list.unshift({ key: url, ...meta, size: blob.size, savedAt: new Date().toISOString() });
  writeLocal(OFFLINE_INDEX, list.slice(0, 60));
  return blob.size;
}

export async function openOffline(url: string, title = 'Exam237') {
  const cache = await caches.open(OFFLINE_CACHE);
  const hit = await cache.match(url);
  if (!hit) throw new Error('Ce fichier n’est plus sur ton téléphone.');
  const raw = await hit.blob();
  const blob = raw.type ? raw : new Blob([raw], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);
  // Android ne lit pas toujours un PDF dans le navigateur : on l'enregistre pour l'ouvrir
  // avec le lecteur PDF du téléphone. Ailleurs, il s'ouvre dans un nouvel onglet.
  const link = document.createElement('a');
  link.href = objectUrl;
  link.rel = 'noopener';
  if (/android/i.test(navigator.userAgent)) {
    const safe = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    link.download = `${safe || 'exam237'}.pdf`;
  } else link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
}

export async function removeOffline(url: string) {
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.delete(url);
  } catch {}
  writeLocal(
    OFFLINE_INDEX,
    offlineList().filter(item => item.key !== url)
  );
}

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}
