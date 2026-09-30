import crypto from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { db } from './db';

const USER_COOKIE = 'ex237_user_session';
const ADMIN_COOKIE = 'ex237_admin_session';

export type Viewer = {
  role: 'student' | 'admin';
  userId: string | null;
  email: string;
  displayName: string;
  classCode: string | null;
  classLabel: string | null;
  groupId: string | null;
  groupLabel: string | null;
  accountStatus: 'pending' | 'active' | 'expired' | 'suspended' | 'admin';
  premiumUntil: string | null;
  online?: boolean;
};

export function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string) {
  try {
    const [kind, saltHex, hashHex] = String(stored).split('$');
    if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function effectiveStatus(raw: string | null, premiumUntil: string | null, disabledAt?: string | null): Viewer['accountStatus'] {
  if (disabledAt || raw === 'suspended') return 'suspended';
  if (raw === 'pending') return 'pending';
  if (!premiumUntil || new Date(premiumUntil).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export async function createSession(response: NextResponse, role: 'user' | 'admin', userId: string | null, days = 30) {
  const sql = db();
  const raw = crypto.randomBytes(32).toString('base64url');
  await sql`
    INSERT INTO jl_sessions (id,token_hash,role,user_id,created_at,last_seen_at,expires_at)
    VALUES (${crypto.randomUUID()},${sha256(raw)},${role},${userId},NOW(),NOW(),NOW()+(${days}*INTERVAL '1 day'))
  `;
  response.cookies.set(role === 'admin' ? ADMIN_COOKIE : USER_COOKIE, raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: days * 86400
  });
}

async function sessionFromToken(raw: string | undefined, expected: 'user' | 'admin') {
  if (!raw) return null;
  const sql = db();
  const rows = await sql`
    SELECT s.id AS session_id,s.role AS session_role,s.user_id,s.last_seen_at,
           u.email,u.premium_until,u.disabled_at,
           p.display_name,p.class_code,p.account_status,
           c.label AS class_label,c.group_id,
           g.label AS group_label
    FROM jl_sessions s
    LEFT JOIN jl_users u ON u.id=s.user_id
    LEFT JOIN ex237_user_profiles p ON p.user_id=u.id
    LEFT JOIN ex237_classes c ON c.code=p.class_code
    LEFT JOIN ex237_groups g ON g.id=c.group_id
    WHERE s.token_hash=${sha256(raw)} AND s.role=${expected} AND s.expires_at>NOW()
    LIMIT 1
  `;
  const row = rows[0] as any;
  if (!row) return null;
  if (row.user_id && row.disabled_at) return null;
  await sql`UPDATE jl_sessions SET last_seen_at=NOW() WHERE id=${row.session_id}`;
  return row;
}

export async function getViewer(req: NextRequest): Promise<Viewer | null> {
  const admin = await sessionFromToken(req.cookies.get(ADMIN_COOKIE)?.value, 'admin');
  if (admin) {
    return {
      role: 'admin', userId: null,
      email: String(process.env.ADMIN_EMAIL || 'admin'), displayName: 'Administration',
      classCode: null, classLabel: null, groupId: null, groupLabel: null,
      accountStatus: 'admin', premiumUntil: null
    };
  }
  const row = await sessionFromToken(req.cookies.get(USER_COOKIE)?.value, 'user');
  if (!row) return null;
  return {
    role: 'student',
    userId: row.user_id,
    email: row.email || '',
    displayName: row.display_name || '',
    classCode: row.class_code || null,
    classLabel: row.class_label || null,
    groupId: row.group_id || null,
    groupLabel: row.group_label || null,
    accountStatus: effectiveStatus(row.account_status || 'pending', row.premium_until, row.disabled_at),
    premiumUntil: row.premium_until || null
  };
}

export function isActiveStudent(viewer: Viewer | null): viewer is Viewer {
  return !!viewer && viewer.role === 'student' && viewer.accountStatus === 'active';
}

export async function destroySessions(req: NextRequest, response: NextResponse) {
  const sql = db();
  const user = req.cookies.get(USER_COOKIE)?.value;
  const admin = req.cookies.get(ADMIN_COOKIE)?.value;
  if (user) await sql`DELETE FROM jl_sessions WHERE token_hash=${sha256(user)}`;
  if (admin) await sql`DELETE FROM jl_sessions WHERE token_hash=${sha256(admin)}`;
  response.cookies.set(USER_COOKIE, '', { path: '/', maxAge: 0 });
  response.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
}
