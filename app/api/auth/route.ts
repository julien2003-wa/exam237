import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureSchema } from '@/lib/schema';
import {
  clientIp,
  createSession,
  destroySessions,
  getViewer,
  hashPassword,
  normalizeEmail,
  safeEqual,
  sha256,
  validEmail,
  verifyPassword,
} from '@/lib/auth';
import {
  clearLoginFailures,
  loginBlocked,
  recordLoginFailure,
  recordRegistration,
  registerBlocked,
} from '@/lib/security';

function ok(data: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...data });
}
function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function body(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') || 'me';
  if (action !== 'me') return fail('Action inconnue.', 404);
  const viewer = await getViewer(req);
  if (!viewer) return fail('Non connecté.', 401);
  return ok({ viewer });
}

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') || '';
  const data: any = await body(req);
  const sql = db();

  if (action === 'login') {
    const email = normalizeEmail(data.email);
    const password = String(data.password || '');
    if (!validEmail(email) || !password) return fail('Email ou mot de passe incorrect.', 401);

    // Après 5 mots de passe faux, la connexion est bloquée 15 minutes.
    const ip = clientIp(req);
    if (await loginBlocked(email, ip))
      return fail('Trop de tentatives. Réessaie dans 15 minutes.', 429);

    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const adminPassword = String(process.env.ADMIN_PASSWORD || '');
    if (email === adminEmail && adminPassword) {
      if (!safeEqual(password, adminPassword)) {
        await recordLoginFailure(email, ip);
        return fail('Email ou mot de passe incorrect.', 401);
      }
      await clearLoginFailures(email);
      const response = ok({ role: 'admin' });
      await createSession(response, 'admin', null, 7);
      return response;
    }

    const rows =
      await sql`SELECT id,email,password_hash,disabled_at FROM jl_users WHERE email=${email} LIMIT 1`;
    const user: any = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      await recordLoginFailure(email, ip);
      return fail('Email ou mot de passe incorrect.', 401);
    }
    if (user.disabled_at)
      return fail('Ce compte est suspendu. Contacte Exam237 sur WhatsApp.', 403);
    await clearLoginFailures(email);
    const response = ok({ role: 'student' });
    await createSession(response, 'user', user.id, 30);
    return response;
  }

  if (action === 'register') {
    const email = normalizeEmail(data.email);
    const password = String(data.password || '');
    const displayName = String(data.displayName || '')
      .trim()
      .slice(0, 80);
    const classCode = String(data.classCode || '')
      .trim()
      .toUpperCase();
    if (!validEmail(email)) return fail('Adresse email invalide.');
    if (password.length < 8) return fail('Le mot de passe doit contenir au moins 8 caractères.');
    if (displayName.length < 2) return fail('Indique ton nom et prénom.');
    const cls =
      await sql`SELECT code FROM ex237_classes WHERE code=${classCode} AND active=TRUE LIMIT 1`;
    if (!cls[0]) return fail('Classe invalide.');
    await ensureSchema();
    const ip = clientIp(req);
    if (await registerBlocked(ip))
      return fail('Trop d’inscriptions depuis ce réseau. Réessaie dans une heure.', 429);
    const id = crypto.randomUUID();
    try {
      // Compte actif tout de suite, en version gratuite (le Premium est activé par l'admin).
      await sql.transaction([
        sql`INSERT INTO jl_users(id,email,password_hash,role,created_at,updated_at) VALUES(${id},${email},${hashPassword(password)},'student',NOW(),NOW())`,
        sql`INSERT INTO ex237_user_profiles(user_id,display_name,class_code,account_status,updated_at) VALUES(${id},${displayName},${classCode},'active',NOW())`,
      ]);
      await recordRegistration(ip);
    } catch (e: any) {
      if (/unique|duplicate/i.test(String(e?.message || e)))
        return fail('Un compte existe déjà avec cette adresse email.', 409);
      throw e;
    }
    const response = ok({ role: 'student' });
    await createSession(response, 'user', id, 30);
    return response;
  }

  if (action === 'logout') {
    const response = ok();
    await destroySessions(req, response);
    return response;
  }

  // Lien envoyé par l'admin (WhatsApp) pour choisir un nouveau mot de passe.
  if (action === 'reset-password') {
    const token = String(data.token || '');
    const password = String(data.password || '');
    if (password.length < 8) return fail('Le mot de passe doit contenir au moins 8 caractères.');
    await ensureSchema();
    const rows = await sql`
      SELECT id,user_id FROM ex237_reset_links
      WHERE token_hash=${sha256(token)} AND used_at IS NULL AND expires_at>NOW()
      LIMIT 1
    `;
    const reset: any = rows[0];
    if (!reset) return fail('Ce lien est invalide ou a expiré.', 400);
    await sql`UPDATE jl_users SET password_hash=${hashPassword(password)},updated_at=NOW() WHERE id=${reset.user_id}`;
    await sql`UPDATE ex237_reset_links SET used_at=NOW() WHERE id=${reset.id}`;
    await sql`DELETE FROM jl_sessions WHERE user_id=${reset.user_id}`;
    return ok({ message: 'Mot de passe modifié.' });
  }

  return fail('Action inconnue.', 404);
}
