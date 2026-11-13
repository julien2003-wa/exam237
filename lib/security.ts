import { db } from './db';
import { ensureSchema } from './schema';

/*
  Protection contre les tentatives de piratage des comptes :
  après 5 mots de passe faux en 15 minutes pour une même adresse e-mail,
  la connexion est bloquée 15 minutes. La limite par adresse IP est large,
  car beaucoup d'élèves partagent la même IP (réseau mobile, école).
*/

const WINDOW = '15 minutes';
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 40;

export async function loginBlocked(email: string, ip: string) {
  await ensureSchema();
  const emailKey = `email:${email}`;
  const ipKey = `ip:${ip}`;
  const rows: any[] = await db()`
    SELECT COUNT(*) FILTER (WHERE key=${emailKey})::int AS by_email,
           COUNT(*) FILTER (WHERE key=${ipKey})::int AS by_ip
    FROM ex237_login_attempts
    WHERE key IN (${emailKey},${ipKey}) AND created_at>NOW()-${WINDOW}::interval`;
  const row = rows[0] || {};
  return Number(row.by_email || 0) >= MAX_PER_EMAIL || Number(row.by_ip || 0) >= MAX_PER_IP;
}

export async function recordLoginFailure(email: string, ip: string) {
  const sql = db();
  await sql`INSERT INTO ex237_login_attempts(key,created_at) VALUES(${`email:${email}`},NOW()),(${`ip:${ip}`},NOW())`;
  // Ménage léger : les anciennes tentatives ne servent plus.
  if (Math.random() < 0.1)
    await sql`DELETE FROM ex237_login_attempts WHERE created_at<NOW()-INTERVAL '1 day'`;
}

export async function clearLoginFailures(email: string) {
  await db()`DELETE FROM ex237_login_attempts WHERE key=${`email:${email}`}`;
}

// Inscriptions : limite large par réseau (une classe entière peut s'inscrire ensemble),
// suffisante pour arrêter un robot qui crée des comptes en masse.
const MAX_REGISTER_PER_IP_HOUR = 60;

export async function registerBlocked(ip: string) {
  await ensureSchema();
  const rows: any[] = await db()`
    SELECT COUNT(*)::int AS n FROM ex237_login_attempts
    WHERE key=${`register:${ip}`} AND created_at>NOW()-INTERVAL '1 hour'`;
  return Number(rows[0]?.n || 0) >= MAX_REGISTER_PER_IP_HOUR;
}

export async function recordRegistration(ip: string) {
  await db()`INSERT INTO ex237_login_attempts(key,created_at) VALUES(${`register:${ip}`},NOW())`;
}

// Identifiant passé dans une URL ou un formulaire : lettres, chiffres, tirets.
export function safeId(value: unknown) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : '';
}
