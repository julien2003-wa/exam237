import crypto from 'node:crypto';
import { db } from './db.js';

const COOKIE = 'ex237_session';

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [kind, saltHex, hashHex] = String(stored).split('$');
    if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function createSession(res, { role = 'user', userId = null, days = 30 } = {}) {
  const sql = db();
  const raw = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256(raw);
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO jl_sessions (id, token_hash, role, user_id, created_at, last_seen_at, expires_at)
    VALUES (${id}, ${tokenHash}, ${role}, ${userId}, NOW(), NOW(), NOW() + (${days} * INTERVAL '1 day'))
  `;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(raw)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days * 86400}${secure}`);
  return raw;
}

export async function destroySession(req, res) {
  const raw = parseCookies(req)[COOKIE];
  if (raw) {
    const sql = db();
    await sql`DELETE FROM jl_sessions WHERE token_hash=${sha256(raw)}`;
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

export async function getSession(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const sql = db();
  const rows = await sql`
    SELECT s.id AS session_id, s.role AS session_role, s.user_id,
           u.email, u.premium_until, u.disabled_at,
           p.display_name, p.class_code
    FROM jl_sessions s
    LEFT JOIN jl_users u ON u.id=s.user_id
    LEFT JOIN ex237_user_profiles p ON p.user_id=u.id
    WHERE s.token_hash=${sha256(raw)} AND s.expires_at > NOW()
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (row.user_id && row.disabled_at) return null;
  await sql`UPDATE jl_sessions SET last_seen_at=NOW() WHERE id=${row.session_id}`;
  return row;
}

export async function requireUser(req) {
  const session = await getSession(req);
  if (!session || session.session_role !== 'user' || !session.user_id) return null;
  return session;
}

export async function requireAdmin(req) {
  const session = await getSession(req);
  if (!session || session.session_role !== 'admin') return null;
  return session;
}

export function premiumActive(session) {
  if (!session?.premium_until) return false;
  return new Date(session.premium_until).getTime() > Date.now();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateActivationCode() {
  const bytes = crypto.randomBytes(20); // 160 bits d'entropie
  let bits = 0, buffer = 0, out = '';
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
      buffer &= bits ? (1 << bits) - 1 : 0;
    }
  }
  return 'EX237-' + out.match(/.{1,4}/g).join('-');
}

export function constantTimeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
