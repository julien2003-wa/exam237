import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, isUuid } from '@/lib/db';
import { ensureSchema } from '@/lib/schema';
import { deletionErrorMessage, removeStudentAccount } from '@/lib/accounts';
import {
  currentUserTokenHash,
  destroySessions,
  getViewer,
  hashPassword,
  verifyPassword,
  type Viewer,
} from '@/lib/auth';
import { isPremiumViewer } from '@/lib/access';
import {
  assistantConfigured,
  clearTutorHistory,
  dailyLimitFor,
  getAssistantSettings,
  runTutor,
  tutorHistory,
  tutorUsedToday,
  validTutorImage,
} from '@/lib/assistant';

// Le Prof IA peut prendre quelques secondes, surtout avec une photo.
export const maxDuration = 60;

const json = (data: Record<string, unknown>, status = 200) => NextResponse.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);

async function studentOnly(req: NextRequest): Promise<Viewer | NextResponse> {
  const viewer = await getViewer(req);
  if (!viewer) return fail('Non connecté.', 401);
  if (viewer.role !== 'student' || !viewer.userId || viewer.accountStatus !== 'active')
    return fail('Réservé aux élèves.', 403);
  return viewer;
}

// Le sujet doit être publié et appartenir au groupe de l'élève.
async function paperOfGroup(paperId: string, groupId: string | null) {
  if (!isUuid(paperId) || !groupId) return null;
  const rows: any[] = await db()`
    SELECT p.id FROM ex237_papers p JOIN ex237_classes c ON c.code=p.class_code
    WHERE p.id=${paperId} AND p.status='published' AND c.group_id=${groupId} LIMIT 1`;
  return rows[0] || null;
}

async function tutorAccess(viewer: Viewer) {
  const settings = await getAssistantSettings();
  const premium = isPremiumViewer(viewer);
  return { premium, limit: dailyLimitFor(settings, premium) };
}

export async function GET(req: NextRequest) {
  const viewer = await studentOnly(req);
  if (viewer instanceof NextResponse) return viewer;
  const action = req.nextUrl.searchParams.get('action') || '';

  if (action === 'tutor') {
    const { premium, limit } = await tutorAccess(viewer);
    const [messages, used] = await Promise.all([
      tutorHistory(viewer.userId!),
      tutorUsedToday(viewer.userId!),
    ]);
    return json({
      configured: assistantConfigured(),
      premium,
      limit,
      used,
      messages,
    });
  }

  return fail('Action inconnue.', 404);
}

export async function POST(req: NextRequest) {
  const viewer = await studentOnly(req);
  if (viewer instanceof NextResponse) return viewer;
  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const action = String(body.action || '');
  const sql = db();
  const userId = viewer.userId!;

  /* ---------- Favoris et progression ---------- */

  if (action === 'paper_state') {
    const paperId = String(body.paperId || '');
    if (!(await paperOfGroup(paperId, viewer.groupId))) return fail('Sujet introuvable.', 404);
    await ensureSchema();
    const hasFavorite = typeof body.favorite === 'boolean';
    const hasStatus = 'status' in body;
    const status = ['done', 'review'].includes(body.status) ? String(body.status) : null;
    if (!hasFavorite && !hasStatus) return fail('Rien à modifier.');
    const rows: any[] = await sql`
      INSERT INTO ex237_user_papers(user_id,paper_id,favorite,status,updated_at)
      VALUES(${userId},${paperId},${hasFavorite ? body.favorite : false},${hasStatus ? status : null},NOW())
      ON CONFLICT (user_id,paper_id) DO UPDATE SET
        favorite=CASE WHEN ${hasFavorite} THEN EXCLUDED.favorite ELSE ex237_user_papers.favorite END,
        status=CASE WHEN ${hasStatus} THEN EXCLUDED.status ELSE ex237_user_papers.status END,
        updated_at=NOW()
      RETURNING favorite,status`;
    return json({
      ok: true,
      favorite: rows[0]?.favorite === true,
      status: rows[0]?.status || null,
    });
  }

  /* ---------- Profil ---------- */

  if (action === 'profile') {
    const displayName = String(body.displayName || '')
      .trim()
      .slice(0, 80);
    if (displayName.length < 2) return fail('Nom invalide.');
    await sql`UPDATE ex237_user_profiles SET display_name=${displayName},updated_at=NOW() WHERE user_id=${userId}`;
    return json({ ok: true });
  }

  if (action === 'change_password') {
    const current = String(body.current || '');
    const next = String(body.next || '');
    if (next.length < 8)
      return fail('Le nouveau mot de passe doit contenir au moins 8 caractères.');
    const rows: any[] = await sql`SELECT password_hash FROM jl_users WHERE id=${userId} LIMIT 1`;
    if (!rows[0] || !verifyPassword(current, rows[0].password_hash))
      return fail('Mot de passe actuel incorrect.', 403);
    await sql`UPDATE jl_users SET password_hash=${hashPassword(next)},updated_at=NOW() WHERE id=${userId}`;
    // Déconnecte les autres appareils, garde celui-ci.
    const keep = currentUserTokenHash(req);
    if (keep) await sql`DELETE FROM jl_sessions WHERE user_id=${userId} AND token_hash<>${keep}`;
    return json({ ok: true });
  }

  // L'élève supprime lui-même son compte et ses données.
  if (action === 'delete_account') {
    const password = String(body.password || '');
    const rows: any[] = await sql`SELECT password_hash FROM jl_users WHERE id=${userId} LIMIT 1`;
    if (!rows[0] || !verifyPassword(password, rows[0].password_hash))
      return fail('Mot de passe incorrect.', 403);
    try {
      await removeStudentAccount(userId);
    } catch (error) {
      const { message, status } = deletionErrorMessage(error);
      console.error('Suppression de compte refusée', error);
      return fail(message, status);
    }
    const response = json({ ok: true });
    await destroySessions(req, response);
    return response;
  }

  /* ---------- Signaler une erreur dans un sujet ou une correction ---------- */

  if (action === 'report_content') {
    const paperId = String(body.paperId || '');
    const correctionId = String(body.correctionId || '') || null;
    const message = String(body.message || '')
      .trim()
      .slice(0, 800);
    if (message.length < 5) return fail('Décris l’erreur en quelques mots.');
    if (!(await paperOfGroup(paperId, viewer.groupId))) return fail('Sujet introuvable.', 404);
    if (correctionId && !isUuid(correctionId)) return fail('Correction introuvable.', 404);
    await ensureSchema();
    const recent: any[] = await sql`SELECT COUNT(*)::int AS n FROM ex237_content_reports
      WHERE user_id=${userId} AND created_at>NOW()-INTERVAL '1 hour'`;
    if (Number(recent[0]?.n || 0) >= 10) return fail('Merci ! Réessaie un peu plus tard.', 429);
    await sql`INSERT INTO ex237_content_reports(id,user_id,paper_id,correction_id,message,status,created_at)
              VALUES(${crypto.randomUUID()},${userId},${paperId},${correctionId},${message},'open',NOW())`;
    return json({ ok: true });
  }

  /* ---------- Statistiques des vidéos promo ---------- */

  if (action === 'promo_event') {
    const promoId = String(body.promoId || '');
    const kind = body.kind === 'click' ? 'click' : 'view';
    if (!isUuid(promoId)) return fail('Vidéo introuvable.', 404);
    await ensureSchema();
    await sql`INSERT INTO ex237_promo_events(promo_id,user_id,kind,created_at)
              SELECT ${promoId},${userId},${kind},NOW() WHERE EXISTS (SELECT 1 FROM ex237_promos WHERE id=${promoId})`;
    return json({ ok: true });
  }

  /* ---------- Prof IA privé ---------- */

  if (action === 'tutor_ask') {
    if (!assistantConfigured()) return fail('Le Prof IA n’est pas encore disponible.', 503);
    const { premium, limit } = await tutorAccess(viewer);
    if (limit <= 0)
      return json(
        { error: 'Le Prof IA est réservé aux membres Premium.', premiumRequired: true },
        403
      );
    const text = String(body.text || '')
      .trim()
      .slice(0, 1500);
    const image = body.image ? validTutorImage(body.image) : null;
    if (body.image && !image) return fail('Photo invalide. Utilise une image JPG ou PNG.');
    if (!text && !image) return fail('Écris ta question ou ajoute la photo de l’exercice.');
    const result = await runTutor({
      userId,
      text,
      image,
      dailyLimit: limit,
      classLabel: viewer.classLabel,
      examType: viewer.examType,
    });
    if (result.status === 'limited')
      return json(
        {
          error: `Tu as utilisé tes ${limit} questions du jour. Reviens demain !`,
          premiumRequired: !premium,
        },
        429
      );
    if (result.status === 'error')
      return json(
        {
          error: 'Le Prof IA n’arrive pas à répondre pour le moment. Réessaie dans un instant.',
          question: result.question,
        },
        502
      );
    return json({
      ok: true,
      question: result.question,
      answer: result.answer,
      used: result.used,
      limit,
    });
  }

  if (action === 'tutor_clear') {
    await clearTutorHistory(userId);
    return json({ ok: true });
  }

  return fail('Action inconnue.', 404);
}
