import crypto from 'node:crypto';
import { db } from '../../lib/db.js';
import { json, readJson } from '../../lib/http.js';
import { createSession, hashPassword, isEmail, normalizeEmail } from '../../lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée' });
  try {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim();
    const classCode = String(body.classCode || '').trim().toUpperCase();
    if (!isEmail(email)) return json(res, 400, { error: 'Adresse email invalide.' });
    if (password.length < 10) return json(res, 400, { error: 'Le mot de passe doit contenir au moins 10 caractères.' });
    if (displayName.length < 2) return json(res, 400, { error: 'Indique ton nom.' });
    if (!classCode) return json(res, 400, { error: 'Choisis ta classe.' });

    const sql = db();
    const classRows = await sql`SELECT code FROM ex237_classes WHERE code=${classCode} AND active=TRUE LIMIT 1`;
    if (!classRows[0]) return json(res, 400, { error: 'Classe invalide.' });

    const id = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO jl_users (id,email,password_hash,role,created_at,updated_at)
        VALUES (${id},${email},${hashPassword(password)},'student',NOW(),NOW())
      `;
      await sql`
        INSERT INTO ex237_user_profiles (user_id,display_name,class_code,updated_at)
        VALUES (${id},${displayName},${classCode},NOW())
      `;
    } catch (e) {
      if (String(e?.message || e).includes('unique')) return json(res, 409, { error: 'Un compte existe déjà avec cette adresse email.' });
      throw e;
    }
    await createSession(res, { role: 'user', userId: id, days: 30 });
    return json(res, 201, { ok: true });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Impossible de créer le compte.' });
  }
}
