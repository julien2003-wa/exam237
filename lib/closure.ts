// Fermeture du site par l'admin (bouton « Fermer le site » de l'administration).
// Le réglage est rangé à part dans ex237_settings (clé « closure ») : l'enregistrement des
// autres réglages ne peut jamais le modifier. Le middleware le lit avant chaque page.
// Ce fichier n'utilise aucun module Node : le middleware tourne dans l'environnement « edge ».
import { db } from './db';

export type Closure = { closed: boolean; since: string | null };

export const CLOSED_MESSAGE = 'Exam237 est fermé pour le moment.';
const OPEN: Closure = { closed: false, since: null };
// Chaque serveur garde la valeur 10 secondes : le bouton agit partout en moins de 10 s.
const FRESH_MS = 10_000;

let cache: { value: Closure; at: number } | null = null;
let reading: Promise<Closure> | null = null;

function parse(raw: unknown): Closure {
  try {
    const v: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (v && v.closed === true)
      return { closed: true, since: typeof v.since === 'string' ? v.since : null };
  } catch {}
  return OPEN;
}

async function read(): Promise<Closure> {
  const rows: any[] = await db()`SELECT value FROM ex237_settings WHERE key='closure' LIMIT 1`;
  const value = parse(rows[0]?.value);
  cache = { value, at: Date.now() };
  return value;
}

// fresh : relit la base (admin) ; sinon la valeur gardée sert pendant 10 s.
// Si la base ne répond pas : dernière valeur connue, sinon « ouvert » (une panne de lecture
// ne doit pas fermer le site à tout le monde).
export async function getClosure(fresh = false): Promise<Closure> {
  if (!fresh && cache && Date.now() - cache.at < FRESH_MS) return cache.value;
  try {
    if (!reading)
      reading = read().finally(() => {
        reading = null;
      });
    return await reading;
  } catch (e) {
    // Visible dans les journaux Vercel : sans lecture, le bouton « Fermer le site » ne s'appliquerait pas.
    console.error('Fermeture du site : lecture du réglage impossible', e);
    return cache?.value ?? OPEN;
  }
}

export async function setClosure(closed: boolean): Promise<Closure> {
  const current = await getClosure(true);
  if (closed && current.closed) return current; // déjà fermé : on garde l'heure de fermeture
  const value: Closure = closed ? { closed: true, since: new Date().toISOString() } : OPEN;
  await db()`INSERT INTO ex237_settings(key,value,updated_at) VALUES('closure',${JSON.stringify(value)},NOW())
             ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
  cache = { value, at: Date.now() };
  return value;
}

/* ---------- Session admin (vérifiée sans les modules Node) ---------- */

const adminSeen = new Map<string, number>();

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// Jeton du cookie admin encore valable ? (même contrôle que lib/auth.ts, gardé 1 minute)
export async function isAdminSession(raw: string | undefined): Promise<boolean> {
  if (!raw) return false;
  const hash = await sha256Hex(raw);
  const until = adminSeen.get(hash);
  if (until && until > Date.now()) return true;
  try {
    const rows: any[] =
      await db()`SELECT 1 FROM jl_sessions WHERE token_hash=${hash} AND role='admin' AND expires_at>NOW() LIMIT 1`;
    if (!rows[0]) return false;
    if (adminSeen.size > 200) adminSeen.clear();
    adminSeen.set(hash, Date.now() + 60_000);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Ce que voient les visiteurs et les élèves ---------- */

// Page unique servie à la place de toutes les pages quand le site est fermé. Elle note aussi
// la fermeture sur le téléphone : la page hors ligne de l'appli n'affiche alors plus rien.
export function closedPage() {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#064b3a">
<meta name="robots" content="noindex">
<title>Exam237</title>
<link rel="icon" href="/icons/icon-192.png">
<style>
html,body{height:100%;margin:0}
body{display:flex;align-items:center;justify-content:center;background:#064b3a;color:#fff;text-align:center;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{padding:32px 24px}
img{display:block;width:96px;height:96px;margin:0 auto;border-radius:24px;background:#fff;padding:8px;box-sizing:border-box}
p{margin:22px 0 0;font-size:1.2rem;font-weight:650;line-height:1.4}
</style>
</head>
<body>
<main><img src="/logo.png" alt="Exam237" width="96" height="96"><p>${CLOSED_MESSAGE}</p></main>
<script>try{localStorage.setItem('exam237-ferme','1')}catch(e){}</script>
</body>
</html>`;
}
