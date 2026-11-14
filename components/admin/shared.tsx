'use client';
import { uploadPresigned } from '@vercel/blob/client';
import { useState, type ReactNode } from 'react';

export type Notify = (message: string, type?: 'error') => void;
export type Act = (body: Record<string, unknown>, message?: string) => Promise<any>;

export async function api(url: string, opts?: RequestInit) {
  const r = await fetch(url, { ...opts, cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Une erreur est survenue.');
  return d;
}

export const MAX_PDF_MB = 50;

function safePdfName(name: string) {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(-100) || 'document';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

// Raison lisible d'un échec pendant l'envoi lui-même (erreurs de la bibliothèque Vercel Blob).
function uploadError(e: any) {
  const message = String(e?.message || '').replace(/^Vercel Blob:\s*/, '');
  if (e?.name === 'AbortError' || /aborted/i.test(message)) return 'envoi annulé.';
  if (/Failed to fetch|fetch failed|NetworkError|Load failed|not available/i.test(message))
    return 'la connexion a été coupée. Vérifie internet, puis réessaie.';
  if (/Content type mismatch/i.test(message)) return 'ce format de fichier n’est pas accepté.';
  if (/too large/i.test(message)) return 'fichier trop lourd.';
  if (/presigned URL|client token/i.test(message))
    return 'le site n’a pas donné l’autorisation d’envoi. Recharge la page, puis réessaie.';
  if (/expired|Access denied/i.test(message)) return 'l’autorisation d’envoi a expiré. Réessaie.';
  return message || 'erreur inconnue.';
}

// Envoi direct navigateur → Vercel Blob (privé), par un lien d'envoi présigné. Le site vérifie
// d'abord la demande (session, fichier, stockage) pour pouvoir expliquer un refus en français.
// Renvoie le pathname à enregistrer.
async function sendFile(
  pathname: string,
  file: File,
  contentType: string,
  what: string,
  onProgress?: (percent: number) => void
) {
  let check: Response;
  try {
    check = await fetch('/api/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'exam237.check-upload',
        payload: { pathname, size: file.size, contentType },
      }),
      cache: 'no-store',
    });
  } catch {
    throw new Error(`Import ${what} impossible : pas de connexion internet. Réessaie.`);
  }
  if (!check.ok) {
    const d = await check.json().catch(() => ({}));
    throw new Error(
      `Import ${what} impossible : ${d.error || `le site a refusé (erreur ${check.status}).`}`
    );
  }
  try {
    const blob = await uploadPresigned(pathname, file, {
      access: 'private',
      handleUploadUrl: '/api/files',
      contentType,
      multipart: file.size > 8 * 1024 * 1024,
      onUploadProgress: e => onProgress?.(Math.round(e.percentage)),
    });
    return blob.pathname;
  } catch (e) {
    throw new Error(`Import ${what} impossible : ${uploadError(e)}`);
  }
}

// Image d'une vidéo (statut), créée dans le navigateur. Renvoie le pathname à enregistrer.
export async function uploadPoster(image: Blob) {
  const file = new File([image], 'image.jpg', { type: 'image/jpeg' });
  return sendFile(`exam237/poster/${Date.now()}-image.jpg`, file, 'image/jpeg', 'de l’image');
}

export async function uploadPdf(
  file: File,
  kind: 'paper' | 'correction',
  onProgress?: (percent: number) => void
) {
  const looksPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksPdf) throw new Error('Choisis un fichier PDF.');
  if (file.size > MAX_PDF_MB * 1024 * 1024)
    throw new Error(`PDF trop volumineux (maximum ${MAX_PDF_MB} Mo).`);
  const pathname = `exam237/${kind}/${Date.now()}-${safePdfName(file.name)}`;
  return sendFile(pathname, file, 'application/pdf', 'du PDF', onProgress);
}

export const MAX_VIDEO_MB = 60;
const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

// Vidéo promo (statut) : envoi direct vers Vercel Blob privé, comme les PDF.
export async function uploadVideo(file: File, onProgress?: (percent: number) => void) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = Object.values(VIDEO_TYPES).includes(file.type) ? file.type : VIDEO_TYPES[ext] || '';
  if (!type) throw new Error('Choisis une vidéo MP4, WebM ou MOV.');
  if (file.size > MAX_VIDEO_MB * 1024 * 1024)
    throw new Error(
      `Vidéo trop lourde (maximum ${MAX_VIDEO_MB} Mo). Raccourcis-la ou compresse-la.`
    );
  const safeExt = Object.keys(VIDEO_TYPES).find(k => VIDEO_TYPES[k] === type) || 'mp4';
  const base =
    file.name
      .replace(/\.[^.]+$/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'video';
  return sendFile(
    `exam237/promo/${Date.now()}-${base}.${safeExt}`,
    file,
    type,
    'de la vidéo',
    onProgress
  );
}

export function Progress({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <div
      className="adm-progress"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

export function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(
    'fr-FR',
    withTime
      ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: 'short', year: 'numeric' }
  );
}

export function timeAgo(value: string | null | undefined) {
  if (!value) return 'jamais';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return '—';
  const min = Math.round(diff / 60000);
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `il y a ${d} j`;
  return formatDate(value);
}

export function daysLeft(value: string | null | undefined) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  return Math.ceil(diff / 86400000);
}

export const DURATIONS = [
  { days: 30, label: '1 mois' },
  { days: 90, label: '3 mois' },
  { days: 180, label: '6 mois' },
  { days: 365, label: '1 an' },
];

export function Badge({
  tone,
  children,
}: {
  tone: 'green' | 'gold' | 'red' | 'grey' | 'blue';
  children: ReactNode;
}) {
  return <span className={`adm-badge adm-badge-${tone}`}>{children}</span>;
}

export function Section({
  title,
  count,
  defaultOpen = true,
  actions,
  children,
}: {
  title: string;
  count?: number | string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className="card adm-section">
      <header className="adm-section-head">
        <button
          type="button"
          className="adm-section-toggle"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
        >
          <span className="adm-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <h3>{title}</h3>
          {count !== undefined ? <span className="mini-pill">{count}</span> : null}
        </button>
        {actions ? <div className="adm-section-actions">{actions}</div> : null}
      </header>
      {open ? <div className="adm-section-body">{children}</div> : null}
    </article>
  );
}

export function FilePicker({
  label,
  file,
  onChange,
  progress,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  progress?: number | null;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="file"
        accept="application/pdf,.pdf"
        onChange={e => onChange(e.target.files?.[0] || null)}
      />
      {file ? (
        <small>
          {file.name} · {(file.size / 1024 / 1024).toFixed(1)} Mo
        </small>
      ) : (
        <small>PDF jusqu’à {MAX_PDF_MB} Mo.</small>
      )}
      {progress !== null && progress !== undefined ? (
        <div
          className="adm-progress"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}

// Fichier CSV lisible par Excel en français (séparateur « ; », accents conservés).
export function downloadCsv(
  filename: string,
  rows: Array<Array<string | number | null | undefined>>
) {
  const cell = (v: string | number | null | undefined) => {
    const text = String(v ?? '');
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = '\uFEFF' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// 237677123456 → « +237 6 77 12 34 56 » (affichage seulement).
export function formatPhone(value: string) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (/^237\d{9}$/.test(digits))
    return `+237 ${digits.slice(3, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`;
  return digits ? `+${digits}` : '';
}

export const PLAN_LABEL: Record<string, string> = {
  premium: 'Premium',
  free: 'Gratuit',
  suspended: 'Suspendu',
};

export function exportStudents(users: any[], name = 'eleves') {
  const day = new Date().toISOString().slice(0, 10);
  downloadCsv(`exam237-${name}-${day}.csv`, [
    [
      'Nom',
      'E-mail',
      'Classe',
      'Groupe',
      'Formule',
      'Premium jusqu’au',
      'Inscrit le',
      'Dernière visite',
    ],
    ...users.map(u => [
      u.displayName,
      u.email,
      u.classLabel,
      u.groupLabel,
      PLAN_LABEL[u.plan] || u.plan,
      u.plan === 'premium' ? formatDate(u.premiumUntil) : '',
      formatDate(u.createdAt),
      u.lastSeenAt ? formatDate(u.lastSeenAt, true) : 'jamais',
    ]),
  ]);
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
