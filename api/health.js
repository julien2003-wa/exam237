import { db } from '../lib/db.js';
import { json } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée' });
  try {
    const sql = db();
    const rows = await sql`
      SELECT
        (SELECT COUNT(*) FROM ex237_classes)::int AS classes,
        (SELECT COUNT(*) FROM ex237_subjects)::int AS subjects,
        (SELECT COUNT(*) FROM ex237_papers WHERE status='published')::int AS published_papers
    `;
    return json(res, 200, {
      ok: true,
      app: 'Exam237',
      database: 'connected',
      ...rows[0]
    });
  } catch (error) {
    console.error(error);
    return json(res, 503, { ok: false, app: 'Exam237', database: 'unavailable' });
  }
}
