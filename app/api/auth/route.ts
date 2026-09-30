import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createSession, destroySessions, getViewer, hashPassword, normalizeEmail, safeEqual, sha256, validEmail, verifyPassword } from '@/lib/auth';

function ok(data: Record<string, unknown> = {}) { return NextResponse.json({ ok:true, ...data }); }
function fail(message: string, status = 400) { return NextResponse.json({ error:message }, { status }); }

async function body(req: NextRequest) {
  try { return await req.json(); } catch { return {}; }
}

async function sendResetEmail(email:string, token:string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESET_EMAIL_FROM;
  const appUrl = String(process.env.APP_URL || 'https://exam237.vercel.app').replace(/\/$/, '');
  if (!apiKey || !from) return false;
  const link = `${appUrl}/reset?token=${encodeURIComponent(token)}`;
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      from, to:[email], subject:'Réinitialiser ton mot de passe Exam237',
      html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2 style="color:#064b3a">Exam237</h2><p>Tu as demandé à réinitialiser ton mot de passe.</p><p><a href="${link}" style="display:inline-block;background:#064b3a;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Créer un nouveau mot de passe</a></p><p>Ce lien expire dans 30 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet e-mail.</p></div>`
    })
  });
  return response.ok;
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
  const data:any = await body(req);
  const sql = db();

  if (action === 'login') {
    const email = normalizeEmail(data.email);
    const password = String(data.password || '');
    if (!validEmail(email) || !password) return fail('Email ou mot de passe incorrect.', 401);

    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const adminPassword = String(process.env.ADMIN_PASSWORD || '');
    if (email === adminEmail && adminPassword && safeEqual(password, adminPassword)) {
      const response = ok({ role:'admin' });
      await createSession(response, 'admin', null, 7);
      return response;
    }

    const rows = await sql`SELECT id,email,password_hash,disabled_at FROM jl_users WHERE email=${email} LIMIT 1`;
    const user:any = rows[0];
    if (!user || user.disabled_at || !verifyPassword(password, user.password_hash)) return fail('Email ou mot de passe incorrect.', 401);
    const response = ok({ role:'student' });
    await createSession(response, 'user', user.id, 30);
    return response;
  }

  if (action === 'register') {
    const email = normalizeEmail(data.email);
    const password = String(data.password || '');
    const displayName = String(data.displayName || '').trim();
    const classCode = String(data.classCode || '').trim().toUpperCase();
    if (!validEmail(email)) return fail('Adresse email invalide.');
    if (password.length < 10) return fail('Le mot de passe doit contenir au moins 10 caractères.');
    if (displayName.length < 2) return fail('Indique ton nom et prénom.');
    const cls = await sql`SELECT code FROM ex237_classes WHERE code=${classCode} AND active=TRUE LIMIT 1`;
    if (!cls[0]) return fail('Classe invalide.');
    const id = crypto.randomUUID();
    try {
      await sql`INSERT INTO jl_users(id,email,password_hash,role,created_at,updated_at) VALUES(${id},${email},${hashPassword(password)},'student',NOW(),NOW())`;
      await sql`INSERT INTO ex237_user_profiles(user_id,display_name,class_code,account_status,updated_at) VALUES(${id},${displayName},${classCode},'pending',NOW())`;
    } catch (e:any) {
      if (/unique/i.test(String(e?.message || e))) return fail('Un compte existe déjà avec cette adresse email.', 409);
      throw e;
    }
    const response = ok({ role:'student', status:'pending' });
    await createSession(response, 'user', id, 30);
    return response;
  }

  if (action === 'logout') {
    const response = ok();
    await destroySessions(req, response);
    return response;
  }

  if (action === 'request-reset') {
    const email = normalizeEmail(data.email);
    if (validEmail(email)) {
      const rows = await sql`SELECT id FROM jl_users WHERE email=${email} AND disabled_at IS NULL LIMIT 1`;
      const user:any = rows[0];
      if (user) {
        const token = crypto.randomBytes(32).toString('base64url');
        await sql`DELETE FROM ex237_password_reset_tokens WHERE user_id=${user.id} OR expires_at<NOW()`;
        await sql`INSERT INTO ex237_password_reset_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(${crypto.randomUUID()},${user.id},${sha256(token)},NOW()+INTERVAL '30 minutes',NOW())`;
        try { await sendResetEmail(email, token); } catch (e) { console.error('Reset email:', e); }
      }
    }
    return ok({ message:'Si un compte correspond à cette adresse, un lien de réinitialisation a été envoyé.' });
  }

  if (action === 'reset-password') {
    const token = String(data.token || '');
    const password = String(data.password || '');
    if (password.length < 10) return fail('Le mot de passe doit contenir au moins 10 caractères.');
    const rows = await sql`
      SELECT id,user_id FROM ex237_password_reset_tokens
      WHERE token_hash=${sha256(token)} AND used_at IS NULL AND expires_at>NOW()
      LIMIT 1
    `;
    const reset:any = rows[0];
    if (!reset) return fail('Ce lien est invalide ou a expiré.', 400);
    await sql`UPDATE jl_users SET password_hash=${hashPassword(password)},updated_at=NOW() WHERE id=${reset.user_id}`;
    await sql`UPDATE ex237_password_reset_tokens SET used_at=NOW() WHERE id=${reset.id}`;
    await sql`DELETE FROM jl_sessions WHERE user_id=${reset.user_id}`;
    return ok({ message:'Mot de passe modifié.' });
  }

  if (action === 'profile') {
    const viewer = await getViewer(req);
    if (!viewer || viewer.role !== 'student' || !viewer.userId) return fail('Non connecté.', 401);
    const displayName = String(data.displayName || '').trim();
    if (displayName.length < 2) return fail('Nom invalide.');
    await sql`UPDATE ex237_user_profiles SET display_name=${displayName},updated_at=NOW() WHERE user_id=${viewer.userId}`;
    return ok();
  }

  return fail('Action inconnue.', 404);
}
