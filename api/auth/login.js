import { db } from '../../lib/db.js';
import { json, readJson } from '../../lib/http.js';
import { createSession, normalizeEmail, verifyPassword } from '../../lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée' });
  try {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const sql = db();
    const rows = await sql`
      SELECT id,email,password_hash,disabled_at
      FROM jl_users WHERE email=${email} LIMIT 1
    `;
    const user = rows[0];
    if (!user || user.disabled_at || !verifyPassword(password, user.password_hash)) {
      return json(res, 401, { error: 'Email ou mot de passe incorrect.' });
    }
    await createSession(res, { role: 'user', userId: user.id, days: 30 });
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Connexion impossible.' });
  }
}
