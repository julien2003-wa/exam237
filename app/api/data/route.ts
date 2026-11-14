import crypto from 'node:crypto';
import { del } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { db, isUuid } from '@/lib/db';
import { ensureSchema } from '@/lib/schema';
import { deletionErrorMessage, removeStudentAccount } from '@/lib/accounts';
import { getViewer, hasPremium, sha256, type Viewer } from '@/lib/auth';
import { freePaperIds, isPremiumViewer } from '@/lib/access';
import { decryptMessage } from '@/lib/crypto';
import { publishRoomEvent, realtimeConfigured } from '@/lib/realtime';
import { getSiteSettings, publicSettings, saveSiteSettings } from '@/lib/settings';
import { getClosure, setClosure } from '@/lib/closure';
import {
  assistantConfigured,
  assistantOverview,
  dailyLimitFor,
  getAssistantSettings,
  saveAssistantSettings,
  testAssistant,
} from '@/lib/assistant';

export const maxDuration = 60;

const json = (data: Record<string, unknown>, status = 200) => NextResponse.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);
const codeify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 16);
const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
const str = (value: unknown) => String(value ?? '').trim();
const clampDays = (value: unknown) => {
  const days = Math.round(Number(value));
  return Number.isFinite(days) && days >= 1 && days <= 730 ? days : 30;
};
const clampDuration = (value: unknown) => {
  const minutes = Math.round(Number(value));
  return Number.isFinite(minutes) && minutes >= 10 && minutes <= 360 ? minutes : null;
};
const NEW_DAYS = 7;

function planOf(row: any): 'premium' | 'free' | 'suspended' {
  if (row.disabled_at || row.account_status === 'suspended') return 'suspended';
  return hasPremium(row.premium_until) ? 'premium' : 'free';
}

// Supprime un fichier privé de Vercel Blob. Appelé APRÈS la suppression en base :
// si le fichier ne peut pas être effacé, la base reste cohérente (au pire un fichier orphelin).
async function deleteStored(pathname: string | null | undefined) {
  if (!pathname || /^https?:\/\//i.test(pathname)) return;
  try {
    await del(pathname);
  } catch (e) {
    console.error('Suppression Blob impossible:', pathname, e);
  }
}

function validHttpUrl(value: string) {
  return !value || /^https?:\/\/[^\s]+$/i.test(value);
}

function youtubeId(url: string | null | undefined) {
  const value = String(url || '');
  const m =
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/.exec(
      value
    );
  return m ? m[1] : null;
}

// Image d'un statut : celle créée à l'envoi de la vidéo (l'adresse change avec l'image, d'où le
// « v= » qui permet de la garder longtemps en cache), sinon la miniature YouTube.
const POSTER_PATH = /^exam237\/poster\/[A-Za-z0-9._-]{1,160}\.(jpg|webp)$/;
function posterUrl(promoId: string, posterPath: string | null, youtube: string | null) {
  if (posterPath) {
    const version = crypto.createHash('sha1').update(posterPath).digest('hex').slice(0, 10);
    return `/api/files?kind=poster&id=${encodeURIComponent(promoId)}&v=${version}`;
  }
  return youtube ? `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg` : null;
}

function appUrl(req: NextRequest) {
  return String(process.env.APP_URL || req.nextUrl.origin).replace(/\/$/, '');
}

function friendlyDbError(e: any) {
  const message = String(e?.message || e || '');
  const code = String(e?.code || '');
  if (code === '23505' || /unique|duplicate/i.test(message))
    return { status: 409, message: 'Cette valeur existe déjà (nom, code ou sujet en double).' };
  if (code === '23503' || /foreign key/i.test(message))
    return { status: 409, message: 'Impossible : d’autres données y sont encore liées.' };
  console.error('Admin action:', e);
  return { status: 500, message: 'Opération impossible pour le moment. Réessaie.' };
}

/* =========================================================================
   Lecture
   ========================================================================= */

export async function GET(req: NextRequest) {
  const sql = db();
  const action = req.nextUrl.searchParams.get('action') || 'bootstrap';

  // Page de connexion et page de présentation : classes ouvertes et contact WhatsApp.
  if (action === 'public') {
    const [groups, classes, site] = await Promise.all([
      sql`SELECT id,code,label,exam_type,display_order FROM ex237_groups WHERE active=TRUE ORDER BY display_order,label`,
      sql`SELECT c.code,c.label,c.exam_type,c.series,c.group_id,g.label AS group_label
          FROM ex237_classes c LEFT JOIN ex237_groups g ON g.id=c.group_id
          WHERE c.active=TRUE ORDER BY c.display_order,c.label`,
      getSiteSettings().catch(() => null),
    ]);
    return json({
      groups: groups.map((g: any) => ({
        id: g.id,
        code: g.code,
        label: g.label,
        examType: g.exam_type,
      })),
      classes: classes.map((c: any) => ({
        code: c.code,
        label: c.label,
        examType: c.exam_type,
        series: c.series,
        groupId: c.group_id,
        groupLabel: c.group_label,
      })),
      site: { whatsapp: site?.whatsapp || '', prices: site?.prices || null },
    });
  }

  const viewer = await getViewer(req);
  if (!viewer) return fail('Non connecté.', 401);

  if (action === 'admin') {
    if (viewer.role !== 'admin') return fail('Non autorisé.', 403);
    return adminOverview(viewer);
  }

  if (action === 'admin_reports') {
    if (viewer.role !== 'admin') return fail('Non autorisé.', 403);
    return adminChatReports();
  }

  if (action === 'admin_content_reports') {
    if (viewer.role !== 'admin') return fail('Non autorisé.', 403);
    await ensureSchema();
    const rows: any[] = await sql`
      SELECT r.id,r.message,r.status,r.created_at,r.correction_id,
             p.id AS paper_id,p.title AS paper_title,p.exam_year,s.name AS subject_name,c.label AS class_label,
             cor.title AS correction_title,pr.display_name AS reporter_name
      FROM ex237_content_reports r
      JOIN ex237_papers p ON p.id=r.paper_id
      JOIN ex237_subjects s ON s.id=p.subject_id
      JOIN ex237_classes c ON c.code=p.class_code
      LEFT JOIN ex237_corrections cor ON cor.id=r.correction_id
      LEFT JOIN ex237_user_profiles pr ON pr.user_id=r.user_id
      ORDER BY (r.status='open') DESC,r.created_at DESC
      LIMIT 200`;
    return json({
      reports: rows.map(r => ({
        id: r.id,
        message: r.message,
        status: r.status,
        createdAt: r.created_at,
        paperId: r.paper_id,
        paperTitle: r.paper_title,
        year: r.exam_year,
        subjectName: r.subject_name,
        classLabel: r.class_label,
        correctionId: r.correction_id,
        correctionTitle: r.correction_title || null,
        reporterName: r.reporter_name || 'Élève',
      })),
    });
  }

  if (action === 'admin_assistant') {
    if (viewer.role !== 'admin') return fail('Non autorisé.', 403);
    try {
      return json(await assistantOverview());
    } catch (e: any) {
      console.error('Assistant overview:', e);
      return fail(
        'Impossible de charger l’assistant : la base n’a pas pu préparer ses tables.',
        500
      );
    }
  }

  return studentBootstrap(viewer);
}

async function studentBootstrap(viewer: Viewer) {
  const sql = db();
  await ensureSchema();
  const [site, assistantSettings] = await Promise.all([
    getSiteSettings(),
    getAssistantSettings().catch(() => null),
  ]);
  const premium = isPremiumViewer(viewer);
  const assistant = {
    chat: assistantConfigured() && assistantSettings?.mode !== 'off',
    tutor: assistantConfigured(),
    tutorLimit: assistantSettings ? dailyLimitFor(assistantSettings, premium) : 0,
  };

  if (viewer.role === 'admin') {
    const rooms =
      await sql`SELECT r.id,r.title,g.label AS group_label FROM ex237_chat_rooms r JOIN ex237_groups g ON g.id=r.group_id WHERE r.active=TRUE ORDER BY g.display_order`;
    return json({
      viewer,
      rooms,
      papers: [],
      promos: [],
      site: publicSettings(site),
      assistant,
    });
  }

  if (!viewer.groupId)
    return json({
      viewer,
      papers: [],
      rooms: [],
      promos: [],
      site: publicSettings(site, viewer.examType),
      assistant,
      warning: 'Ta classe n’est reliée à aucun groupe. Contacte Exam237.',
    });

  // Colonnes récentes (image des statuts) : la mise à jour du schéma passe avant la lecture.
  await ensureSchema();
  const [rows, free, rooms, resumeRows, promoRows] = await Promise.all([
    sql`
      SELECT p.id,p.class_code,c.label AS class_label,p.exam_year,p.session_label,p.title,p.duration_minutes,
             COALESCE(p.published_at,p.created_at) AS published_at,
             s.id AS subject_id,s.name AS subject_name,
             up.favorite,up.status AS my_status,
             COALESCE(json_agg(json_build_object('id',cor.id,'title',cor.title,'videoUrl',cor.video_url,'pdfPath',cor.correction_pdf_path,'reviewer',cor.reviewer_name,'order',cor.display_order) ORDER BY cor.display_order) FILTER(WHERE cor.id IS NOT NULL),'[]'::json) AS corrections
      FROM ex237_papers p
      JOIN ex237_classes c ON c.code=p.class_code
      JOIN ex237_subjects s ON s.id=p.subject_id
      LEFT JOIN ex237_corrections cor ON cor.paper_id=p.id AND cor.status='published'
      LEFT JOIN ex237_user_papers up ON up.paper_id=p.id AND up.user_id=${viewer.userId}
      WHERE p.status='published' AND c.group_id=${viewer.groupId}
      GROUP BY p.id,c.label,c.display_order,s.id,s.name,up.favorite,up.status
      ORDER BY s.name,p.exam_year DESC,c.display_order`,
    freePaperIds(viewer.groupId),
    sql`SELECT id,title FROM ex237_chat_rooms WHERE group_id=${viewer.groupId} AND active=TRUE LIMIT 1`,
    sql`SELECT v.paper_id,v.viewed_at FROM ex237_content_views v
        JOIN ex237_papers p ON p.id=v.paper_id JOIN ex237_classes c ON c.code=p.class_code
        WHERE v.user_id=${viewer.userId} AND p.status='published' AND c.group_id=${viewer.groupId}
        ORDER BY v.viewed_at DESC LIMIT 1`,
    sql`SELECT id,kind,title,video_path,poster_path,youtube_url,cta_type,cta_label,cta_url,audience,created_at
        FROM ex237_promos
        WHERE active=TRUE AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>NOW())
          AND (group_id IS NULL OR group_id=${String(viewer.groupId)})
        ORDER BY display_order,created_at DESC LIMIT 12`,
  ]);

  const newSince = Date.now() - NEW_DAYS * 86400000;
  const papers = (rows as any[]).map(p => {
    const isFree = free.has(String(p.id));
    const locked = !premium && !isFree;
    return {
      id: p.id,
      classCode: p.class_code,
      classLabel: p.class_label,
      year: p.exam_year,
      session: p.session_label,
      title: p.title,
      subjectId: p.subject_id,
      subjectName: p.subject_name,
      durationMinutes: p.duration_minutes || null,
      publishedAt: p.published_at,
      isNew: new Date(p.published_at).getTime() > newSince,
      // « Gratuit » n'a de sens que pour un compte gratuit : un membre Premium a tout.
      free: isFree && !premium,
      locked,
      favorite: p.favorite === true,
      status: p.my_status || null,
      paperUrl: locked ? null : `/api/files?kind=paper&id=${encodeURIComponent(p.id)}`,
      corrections: (p.corrections || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        reviewer: c.reviewer || null,
        hasPdf: !!c.pdfPath,
        hasVideo: !!c.videoUrl,
        pdfUrl:
          !locked && c.pdfPath ? `/api/files?kind=correction&id=${encodeURIComponent(c.id)}` : null,
        videoUrl: !locked ? c.videoUrl || null : null,
      })),
    };
  });

  // « Premium sans pub » : les pubs des partenaires et les promos réservées aux comptes
  // gratuits ne sont pas montrées aux membres Premium.
  const promos = (promoRows as any[])
    .filter(p => !(premium && (p.kind === 'partner' || p.audience === 'free')))
    .map(p => {
      const youtube = youtubeId(p.youtube_url);
      return {
        id: p.id,
        kind: p.kind === 'partner' ? 'partner' : 'own',
        title: p.title,
        videoUrl: p.video_path ? `/api/files?kind=promo&id=${encodeURIComponent(p.id)}` : null,
        posterUrl: posterUrl(p.id, p.poster_path, youtube),
        youtubeId: youtube,
        ctaType: p.cta_type,
        ctaLabel: p.cta_label || null,
        ctaUrl: p.cta_url || null,
        createdAt: p.created_at,
      };
    })
    .filter(p => p.videoUrl || p.youtubeId);

  const resume = (resumeRows as any[])[0]
    ? { paperId: resumeRows[0].paper_id, openedAt: resumeRows[0].viewed_at }
    : null;

  return json({
    viewer,
    papers,
    rooms,
    promos,
    resume,
    site: publicSettings(site, viewer.examType),
    assistant,
  });
}

async function adminOverview(viewer: Viewer) {
  const sql = db();
  await ensureSchema();
  const [
    groups,
    classes,
    subjects,
    papers,
    corrections,
    users,
    rooms,
    reportCount,
    contentReportCount,
    topPapers,
    activations,
    promos,
    site,
    autoFree,
    closure,
  ] = await Promise.all([
    sql`SELECT id,code,label,exam_type,display_order,active,created_at FROM ex237_groups ORDER BY display_order,label`,
    sql`SELECT c.code,c.label,c.exam_type,c.series,c.display_order,c.active,c.group_id,g.label AS group_label
        FROM ex237_classes c LEFT JOIN ex237_groups g ON g.id=c.group_id ORDER BY c.display_order,c.label`,
    sql`SELECT s.id,s.name,s.slug,s.active,COALESCE(json_agg(cs.class_code ORDER BY cs.class_code) FILTER(WHERE cs.class_code IS NOT NULL),'[]'::json) AS class_codes
        FROM ex237_subjects s LEFT JOIN ex237_class_subjects cs ON cs.subject_id=s.id GROUP BY s.id ORDER BY s.name`,
    sql`SELECT p.id,p.class_code,c.label AS class_label,c.group_id,p.subject_id,s.name AS subject_name,p.exam_year,p.session_label,p.title,p.paper_url,p.status,p.is_premium,p.duration_minutes,p.created_at
        FROM ex237_papers p JOIN ex237_classes c ON c.code=p.class_code JOIN ex237_subjects s ON s.id=p.subject_id ORDER BY p.created_at DESC`,
    sql`SELECT cor.id,cor.paper_id,cor.title,cor.video_url,cor.correction_pdf_path,cor.reviewer_name,cor.status,cor.created_at,p.title AS paper_title,p.exam_year,p.class_code,c.label AS class_label,s.name AS subject_name
        FROM ex237_corrections cor JOIN ex237_papers p ON p.id=cor.paper_id JOIN ex237_classes c ON c.code=p.class_code JOIN ex237_subjects s ON s.id=p.subject_id ORDER BY cor.created_at DESC`,
    sql`WITH ss AS (
          SELECT user_id,MAX(last_seen_at) AS last_seen_at,COUNT(*) FILTER(WHERE expires_at>NOW())::int AS active_sessions
          FROM jl_sessions WHERE role='user' AND user_id IS NOT NULL GROUP BY user_id
        )
        SELECT u.id,u.email,u.role,u.premium_until,u.created_at,u.disabled_at,p.display_name,p.class_code,p.account_status,p.chat_muted_until,
               c.label AS class_label,g.label AS group_label,ss.last_seen_at,COALESCE(ss.active_sessions,0)::int AS active_sessions
        FROM jl_users u LEFT JOIN ex237_user_profiles p ON p.user_id=u.id LEFT JOIN ex237_classes c ON c.code=p.class_code
        LEFT JOIN ex237_groups g ON g.id=c.group_id LEFT JOIN ss ON ss.user_id=u.id
        WHERE u.role='student' OR (u.role='user' AND p.user_id IS NOT NULL)
        ORDER BY u.created_at DESC`,
    sql`SELECT r.id,r.group_id,r.title,r.active,g.label AS group_label,
               (SELECT COUNT(*)::int FROM ex237_chat_messages m WHERE m.room_id=r.id) AS message_count
        FROM ex237_chat_rooms r JOIN ex237_groups g ON g.id=r.group_id ORDER BY g.display_order,g.label`,
    sql`SELECT COUNT(DISTINCT message_id)::int AS n FROM ex237_chat_reports`,
    sql`SELECT COUNT(*)::int AS n FROM ex237_content_reports WHERE status='open'`,
    sql`SELECT p.id,p.title,p.exam_year,s.name AS subject_name,c.label AS class_label,COUNT(*)::int AS views
        FROM ex237_content_views v JOIN ex237_papers p ON p.id=v.paper_id
        JOIN ex237_subjects s ON s.id=p.subject_id JOIN ex237_classes c ON c.code=p.class_code
        WHERE v.viewed_at>NOW()-INTERVAL '30 days'
        GROUP BY p.id,p.title,p.exam_year,s.name,c.label ORDER BY views DESC LIMIT 5`,
    sql`SELECT COUNT(*)::int AS n FROM ex237_premium_log WHERE created_at>NOW()-INTERVAL '30 days'`,
    sql`SELECT pr.*,
               (SELECT COUNT(*)::int FROM ex237_promo_events e WHERE e.promo_id=pr.id AND e.kind='view') AS views,
               (SELECT COUNT(*)::int FROM ex237_promo_events e WHERE e.promo_id=pr.id AND e.kind='click') AS clicks
        FROM ex237_promos pr ORDER BY pr.display_order,pr.created_at DESC`,
    getSiteSettings(),
    // Sujets offerts automatiquement (même règle que lib/access.ts, pour tous les groupes).
    sql`WITH pub AS (
          SELECT p.id,c.group_id,p.subject_id,p.is_premium,p.exam_year,p.created_at,
                 EXISTS (SELECT 1 FROM ex237_corrections cor WHERE cor.paper_id=p.id AND cor.status='published') AS has_correction
          FROM ex237_papers p JOIN ex237_classes c ON c.code=p.class_code
          WHERE p.status='published'
        ),
        chosen AS (SELECT DISTINCT group_id,subject_id FROM pub WHERE is_premium=FALSE)
        SELECT DISTINCT ON (pub.group_id,pub.subject_id) pub.id::text AS id FROM pub
        WHERE NOT EXISTS (SELECT 1 FROM chosen ch WHERE ch.group_id IS NOT DISTINCT FROM pub.group_id AND ch.subject_id=pub.subject_id)
        ORDER BY pub.group_id,pub.subject_id,pub.has_correction DESC,pub.exam_year DESC,pub.created_at DESC`,
    getClosure(true),
  ]);

  const now = Date.now();
  const autoFreeIds = new Set((autoFree as any[]).map(r => String(r.id)));
  const mappedUsers = (users as any[]).map(u => ({
    id: u.id,
    email: u.email,
    // Compte qui ne vient pas d'Exam237 (JulienLab…) : retiré d'Exam237 seulement, jamais supprimé.
    shared: u.role !== 'student',
    displayName: u.display_name || '',
    classCode: u.class_code || null,
    classLabel: u.class_label || null,
    groupLabel: u.group_label || null,
    plan: planOf(u),
    premiumUntil: u.premium_until || null,
    lastSeenAt: u.last_seen_at || null,
    createdAt: u.created_at || null,
    mutedUntil:
      u.chat_muted_until && new Date(u.chat_muted_until).getTime() > now
        ? u.chat_muted_until
        : null,
    online:
      !u.disabled_at &&
      u.active_sessions > 0 &&
      u.last_seen_at &&
      new Date(u.last_seen_at).getTime() > now - 2 * 60 * 1000,
  }));
  const weekAgo = now - 7 * 86400000;
  const inSevenDays = now + 7 * 86400000;
  const expiring = mappedUsers
    .filter(
      u =>
        u.plan === 'premium' && u.premiumUntil && new Date(u.premiumUntil).getTime() <= inSevenDays
    )
    .sort((a, b) => new Date(a.premiumUntil).getTime() - new Date(b.premiumUntil).getTime());

  return json({
    viewer,
    groups,
    classes,
    subjects,
    papers: (papers as any[]).map(p => ({ ...p, free_auto: autoFreeIds.has(String(p.id)) })),
    corrections,
    users: mappedUsers,
    rooms,
    site,
    closure,
    promos: (promos as any[]).map(p => ({ ...p, youtube_id: youtubeId(p.youtube_url) })),
    assistantConfigured: assistantConfigured(),
    realtimeConfigured: realtimeConfigured(),
    // Branchement récent du stockage : BLOB_STORE_ID (le site s'identifie tout seul) ; ancien : une clé.
    blobConfigured: !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN),
    expiring: expiring.slice(0, 30),
    topPapers,
    stats: {
      students: mappedUsers.length,
      premium: mappedUsers.filter(u => u.plan === 'premium').length,
      free: mappedUsers.filter(u => u.plan === 'free').length,
      suspended: mappedUsers.filter(u => u.plan === 'suspended').length,
      newThisWeek: mappedUsers.filter(u => u.createdAt && new Date(u.createdAt).getTime() > weekAgo)
        .length,
      online: mappedUsers.filter(u => u.online).length,
      expiring: expiring.length,
      activationsMonth: Number((activations[0] as any)?.n || 0),
      papers: (papers as any[]).filter(p => p.status === 'published').length,
      freePapers: (papers as any[]).filter(
        p => p.status === 'published' && (p.is_premium === false || autoFreeIds.has(String(p.id)))
      ).length,
      corrections: (corrections as any[]).filter(c => c.status === 'published').length,
      reports: Number((reportCount[0] as any)?.n || 0),
      contentReports: Number((contentReportCount[0] as any)?.n || 0),
    },
  });
}

async function adminChatReports() {
  const rows: any[] = await db()`
    SELECT rp.id,rp.message_id,rp.reason,rp.created_at,rep.display_name AS reporter_name,
           m.room_id,m.sender_user_id,m.sender_name,m.ciphertext,m.iv,m.auth_tag,m.created_at AS message_created_at,
           g.label AS group_label,sp.chat_muted_until
    FROM ex237_chat_reports rp
    JOIN ex237_chat_messages m ON m.id=rp.message_id
    JOIN ex237_chat_rooms r ON r.id=m.room_id
    JOIN ex237_groups g ON g.id=r.group_id
    LEFT JOIN ex237_user_profiles rep ON rep.user_id=rp.reporter_user_id
    LEFT JOIN ex237_user_profiles sp ON sp.user_id=m.sender_user_id
    ORDER BY rp.created_at DESC
    LIMIT 300`;
  const byMessage = new Map<string, any>();
  for (const row of rows) {
    const key = String(row.message_id);
    if (!byMessage.has(key)) {
      let text = 'Message illisible';
      try {
        text = decryptMessage(String(row.room_id), row.ciphertext, row.iv, row.auth_tag);
      } catch {}
      byMessage.set(key, {
        messageId: key,
        roomId: row.room_id,
        groupLabel: row.group_label,
        senderUserId: row.sender_user_id || null,
        senderName: row.sender_name || 'Élève',
        text,
        createdAt: row.message_created_at,
        mutedUntil:
          row.chat_muted_until && new Date(row.chat_muted_until).getTime() > Date.now()
            ? row.chat_muted_until
            : null,
        lastReportAt: row.created_at,
        reports: [],
      });
    }
    byMessage.get(key).reports.push({
      id: row.id,
      reason: row.reason || null,
      reporterName: row.reporter_name || 'Élève',
      createdAt: row.created_at,
    });
  }
  return json({ reports: [...byMessage.values()] });
}

/* =========================================================================
   Actions de l'admin
   ========================================================================= */

export async function POST(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer || viewer.role !== 'admin') return fail('Non autorisé.', 403);
  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const action = str(body.action);
  try {
    await ensureSchema();
    return await adminAction(req, action, body);
  } catch (e: any) {
    const { status, message } = friendlyDbError(e);
    return fail(message, status);
  }
}

async function adminAction(req: NextRequest, action: string, body: any): Promise<NextResponse> {
  const sql = db();
  const adminEmail = process.env.ADMIN_EMAIL || 'admin';
  const id = str(body.id);

  /* ---------- Réglages du site ---------- */

  if (action === 'save_site_settings') {
    const site = await saveSiteSettings(body.settings || {});
    return json({ ok: true, site });
  }

  // Bouton « Fermer le site » / « Rouvrir le site » (voir middleware.ts).
  if (action === 'set_site_closed') {
    const closure = await setClosure(body.closed === true);
    return json({ ok: true, closure });
  }

  /* ---------- Élèves et Premium ---------- */

  if (action === 'activate_premium') {
    const days = clampDays(body.days);
    if (!isUuid(id)) return fail('Élève invalide.');
    const rows =
      await sql`UPDATE jl_users SET premium_until=CASE WHEN premium_until>NOW() THEN premium_until+(${days}*INTERVAL '1 day') ELSE NOW()+(${days}*INTERVAL '1 day') END,updated_at=NOW() WHERE id=${id} AND role IN ('student','user') RETURNING premium_until`;
    if (!rows[0]) return fail('Élève introuvable.', 404);
    await sql`UPDATE ex237_user_profiles SET account_status=CASE WHEN account_status='suspended' THEN account_status ELSE 'active' END,activated_at=COALESCE(activated_at,NOW()),activated_by=${adminEmail},updated_at=NOW() WHERE user_id=${id}`;
    await sql`INSERT INTO ex237_premium_log(id,user_id,days,created_at) VALUES(${crypto.randomUUID()},${id},${days},NOW())`;
    return json({ ok: true, premiumUntil: (rows[0] as any).premium_until });
  }

  if (action === 'revoke_premium') {
    if (!isUuid(id)) return fail('Élève invalide.');
    const rows =
      await sql`UPDATE jl_users SET premium_until=NOW(),updated_at=NOW() WHERE id=${id} AND role IN ('student','user') RETURNING id`;
    if (!rows[0]) return fail('Élève introuvable.', 404);
    return json({ ok: true });
  }

  // Lève une suspension SANS rajouter de jours : l'élève retrouve ce qui lui restait.
  if (action === 'reactivate_user') {
    if (!isUuid(id)) return fail('Élève invalide.');
    const rows =
      await sql`UPDATE jl_users SET disabled_at=NULL,disabled_reason=NULL,updated_at=NOW() WHERE id=${id} RETURNING premium_until`;
    if (!rows[0]) return fail('Élève introuvable.', 404);
    await sql`UPDATE ex237_user_profiles SET account_status='active',updated_at=NOW() WHERE user_id=${id}`;
    return json({ ok: true, premiumUntil: (rows[0] as any).premium_until || null });
  }

  if (action === 'suspend_user') {
    if (!isUuid(id)) return fail('Élève invalide.');
    await sql`UPDATE ex237_user_profiles SET account_status='suspended',updated_at=NOW() WHERE user_id=${id}`;
    await sql`UPDATE jl_users SET disabled_at=NOW(),disabled_reason='Suspendu par Exam237',updated_at=NOW() WHERE id=${id}`;
    await sql`DELETE FROM jl_sessions WHERE user_id=${id}`;
    return json({ ok: true });
  }

  if (action === 'delete_user') {
    if (!isUuid(id)) return fail('Élève invalide.');
    try {
      const result = await removeStudentAccount(id);
      return json({ ok: true, ...result });
    } catch (error) {
      const { message, status } = deletionErrorMessage(error);
      console.error('Suppression d’élève refusée', error);
      return fail(message, status);
    }
  }

  if (action === 'set_user_class') {
    const classCode = str(body.classCode).toUpperCase();
    if (!isUuid(id) || !classCode) return fail('Élève ou classe invalide.');
    const cls = await sql`SELECT code FROM ex237_classes WHERE code=${classCode} LIMIT 1`;
    if (!cls[0]) return fail('Classe introuvable.', 404);
    const rows =
      await sql`UPDATE ex237_user_profiles SET class_code=${classCode},updated_at=NOW() WHERE user_id=${id} RETURNING user_id`;
    if (!rows[0]) return fail('Ce compte n’a pas de profil Exam237.', 404);
    return json({ ok: true });
  }

  // Lien de réinitialisation à transmettre soi-même (WhatsApp, SMS…), valable 24 h.
  if (action === 'reset_link') {
    if (!isUuid(id)) return fail('Élève invalide.');
    const user = await sql`SELECT id FROM jl_users WHERE id=${id} LIMIT 1`;
    if (!user[0]) return fail('Élève introuvable.', 404);
    const token = crypto.randomBytes(32).toString('base64url');
    try {
      await sql`DELETE FROM ex237_reset_links WHERE user_id=${id} OR expires_at<NOW()`;
      await sql`INSERT INTO ex237_reset_links(id,user_id,token_hash,expires_at,created_at)
                VALUES(${crypto.randomUUID()},${id},${sha256(token)},NOW()+INTERVAL '24 hours',NOW())`;
    } catch (e: any) {
      console.error('Lien de mot de passe :', e);
      return fail(`Le lien n’a pas pu être créé (${String(e?.message || e).slice(0, 160)}).`, 500);
    }
    return json({ ok: true, link: `${appUrl(req)}/reset?token=${encodeURIComponent(token)}` });
  }

  if (action === 'mute_user') {
    const userId = str(body.userId);
    const minutes = Math.max(1, Math.min(10080, Math.round(Number(body.minutes)) || 60));
    if (!isUuid(userId)) return fail('Élève invalide.');
    await sql`UPDATE ex237_user_profiles SET chat_muted_until=NOW()+(${minutes}*INTERVAL '1 minute'),updated_at=NOW() WHERE user_id=${userId}`;
    return json({ ok: true });
  }

  if (action === 'unmute_user') {
    const userId = str(body.userId);
    if (!isUuid(userId)) return fail('Élève invalide.');
    await sql`UPDATE ex237_user_profiles SET chat_muted_until=NULL,updated_at=NOW() WHERE user_id=${userId}`;
    return json({ ok: true });
  }

  /* ---------- Groupes ---------- */

  if (action === 'create_group') {
    const label = str(body.label);
    const examType = str(body.examType || 'AUTRE').toUpperCase() || 'AUTRE';
    const code = codeify(str(body.code || label));
    if (label.length < 2 || !code) return fail('Nom du groupe invalide.');
    const groupId = crypto.randomUUID(),
      roomId = crypto.randomUUID();
    await sql`INSERT INTO ex237_groups(id,code,label,exam_type,display_order,active,created_at,updated_at) VALUES(${groupId},${code},${label},${examType},COALESCE((SELECT MAX(display_order)+10 FROM ex237_groups),10),TRUE,NOW(),NOW())`;
    await sql`INSERT INTO ex237_chat_rooms(id,group_id,title,active,created_at,updated_at) VALUES(${roomId},${groupId},${label},TRUE,NOW(),NOW())`;
    return json({ ok: true, id: groupId, roomId }, 201);
  }

  if (action === 'update_group') {
    const label = str(body.label);
    const examType = str(body.examType || 'AUTRE').toUpperCase() || 'AUTRE';
    if (!id || label.length < 2) return fail('Nom du groupe invalide.');
    const rows =
      await sql`UPDATE ex237_groups SET label=${label},exam_type=${examType},updated_at=NOW() WHERE id=${id} RETURNING id`;
    if (!rows[0]) return fail('Groupe introuvable.', 404);
    await sql`UPDATE ex237_chat_rooms SET title=${label},updated_at=NOW() WHERE group_id=${id}`;
    return json({ ok: true });
  }

  // Un groupe ne se supprime que vide (sans classe). Son chat est supprimé avec lui.
  if (action === 'delete_group') {
    if (!id) return fail('Groupe invalide.');
    const used = await sql`SELECT COUNT(*)::int AS n FROM ex237_classes WHERE group_id=${id}`;
    const n = Number((used[0] as any)?.n || 0);
    if (n > 0)
      return fail(
        `Ce groupe contient encore ${n} classe${n > 1 ? 's' : ''}. Déplace ou supprime d’abord ${n > 1 ? 'ces classes' : 'cette classe'}.`,
        409
      );
    const rooms = await sql`SELECT id FROM ex237_chat_rooms WHERE group_id=${id}`;
    for (const room of rooms as any[]) {
      await sql`DELETE FROM ex237_chat_reports WHERE message_id IN (SELECT id FROM ex237_chat_messages WHERE room_id=${room.id})`;
      await sql`DELETE FROM ex237_chat_reactions WHERE message_id IN (SELECT id FROM ex237_chat_messages WHERE room_id=${room.id})`;
      await sql`UPDATE ex237_chat_messages SET reply_to_id=NULL WHERE room_id=${room.id} AND reply_to_id IS NOT NULL`;
      await sql`DELETE FROM ex237_chat_messages WHERE room_id=${room.id}`;
      await sql`DELETE FROM ex237_chat_rooms WHERE id=${room.id}`;
    }
    await sql`DELETE FROM ex237_promos WHERE group_id=${String(id)}`;
    const rows = await sql`DELETE FROM ex237_groups WHERE id=${id} RETURNING id`;
    if (!rows[0]) return fail('Groupe introuvable.', 404);
    return json({ ok: true });
  }

  /* ---------- Classes ---------- */

  if (action === 'create_class') {
    const label = str(body.label);
    const code = codeify(str(body.code || label));
    const groupId = str(body.groupId);
    const series = str(body.series).toUpperCase() || null;
    if (label.length < 2 || !code || !groupId) return fail('Classe incomplète.');
    const group =
      await sql`SELECT id,exam_type FROM ex237_groups WHERE id=${groupId} AND active=TRUE LIMIT 1`;
    if (!group[0]) return fail('Groupe invalide.');
    const examType =
      str(body.examType || (group[0] as any).exam_type || 'AUTRE').toUpperCase() || 'AUTRE';
    await sql`INSERT INTO ex237_classes(code,label,exam_type,series,display_order,active,group_id,created_at) VALUES(${code},${label},${examType},${series},COALESCE((SELECT MAX(display_order)+10 FROM ex237_classes),10),TRUE,${groupId},NOW())`;
    return json({ ok: true, code }, 201);
  }

  if (action === 'update_class') {
    const code = str(body.code).toUpperCase();
    const label = str(body.label);
    const groupId = str(body.groupId);
    const series = str(body.series).toUpperCase() || null;
    if (!code || label.length < 2 || !groupId) return fail('Classe incomplète.');
    const current =
      await sql`SELECT group_id,exam_type FROM ex237_classes WHERE code=${code} LIMIT 1`;
    if (!current[0]) return fail('Classe introuvable.', 404);
    const group = await sql`SELECT id,exam_type FROM ex237_groups WHERE id=${groupId} LIMIT 1`;
    if (!group[0]) return fail('Groupe invalide.');
    const sameGroup = String((current[0] as any).group_id || '') === String((group[0] as any).id);
    const examType = sameGroup
      ? (current[0] as any).exam_type
      : (group[0] as any).exam_type || 'AUTRE';
    await sql`UPDATE ex237_classes SET label=${label},group_id=${groupId},series=${series},exam_type=${examType} WHERE code=${code}`;
    return json({ ok: true });
  }

  if (action === 'set_class_active') {
    const code = str(body.code).toUpperCase();
    const active = body.active === true;
    if (!code) return fail('Classe invalide.');
    const rows =
      await sql`UPDATE ex237_classes SET active=${active} WHERE code=${code} RETURNING code`;
    if (!rows[0]) return fail('Classe introuvable.', 404);
    return json({ ok: true });
  }

  // Une classe ne se supprime que si aucun élève ni sujet ne l'utilise (sinon : la désactiver).
  if (action === 'delete_class') {
    const code = str(body.code).toUpperCase();
    if (!code) return fail('Classe invalide.');
    const usage =
      await sql`SELECT (SELECT COUNT(*)::int FROM ex237_user_profiles WHERE class_code=${code}) AS students,
                       (SELECT COUNT(*)::int FROM ex237_papers WHERE class_code=${code}) AS papers`;
    const students = Number((usage[0] as any)?.students || 0),
      paperCount = Number((usage[0] as any)?.papers || 0);
    if (students || paperCount) {
      const parts = [
        students ? `${students} élève${students > 1 ? 's' : ''}` : '',
        paperCount ? `${paperCount} sujet${paperCount > 1 ? 's' : ''}` : '',
      ]
        .filter(Boolean)
        .join(' et ');
      return fail(
        `Impossible : ${parts} utilise${students + paperCount > 1 ? 'nt' : ''} encore cette classe. Désactive-la plutôt pour la retirer de l’inscription.`,
        409
      );
    }
    await sql`DELETE FROM ex237_class_subjects WHERE class_code=${code}`;
    const rows = await sql`DELETE FROM ex237_classes WHERE code=${code} RETURNING code`;
    if (!rows[0]) return fail('Classe introuvable.', 404);
    return json({ ok: true });
  }

  /* ---------- Matières ---------- */

  if (action === 'create_subject' || action === 'update_subject') {
    const name = str(body.name);
    const classCodes = Array.isArray(body.classCodes)
      ? [...new Set(body.classCodes.map((x: any) => str(x).toUpperCase()).filter(Boolean))]
      : [];
    if (name.length < 2 || !classCodes.length) return fail('Matière et classes requises.');
    let subjectId = id;
    if (action === 'create_subject') {
      subjectId = crypto.randomUUID();
      await sql`INSERT INTO ex237_subjects(id,name,slug,active,created_at,updated_at) VALUES(${subjectId},${name},${`${slugify(name)}-${subjectId.slice(0, 8)}`},TRUE,NOW(),NOW())`;
    } else {
      if (!isUuid(subjectId)) return fail('Matière invalide.');
      const rows =
        await sql`UPDATE ex237_subjects SET name=${name},updated_at=NOW() WHERE id=${subjectId} RETURNING id`;
      if (!rows[0]) return fail('Matière introuvable.', 404);
      await sql`DELETE FROM ex237_class_subjects WHERE subject_id=${subjectId}`;
    }
    for (const code of classCodes)
      await sql`INSERT INTO ex237_class_subjects(class_code,subject_id) VALUES(${code},${subjectId}) ON CONFLICT DO NOTHING`;
    return json({ ok: true, id: subjectId }, action === 'create_subject' ? 201 : 200);
  }

  if (action === 'delete_subject') {
    if (!isUuid(id)) return fail('Matière invalide.');
    const used = await sql`SELECT COUNT(*)::int AS n FROM ex237_papers WHERE subject_id=${id}`;
    const n = Number((used[0] as any)?.n || 0);
    if (n > 0)
      return fail(
        `${n} sujet${n > 1 ? 's utilisent' : ' utilise'} encore cette matière. Supprime-${n > 1 ? 'les' : 'le'} ou change leur matière d’abord.`,
        409
      );
    await sql`DELETE FROM ex237_class_subjects WHERE subject_id=${id}`;
    const rows = await sql`DELETE FROM ex237_subjects WHERE id=${id} RETURNING id`;
    if (!rows[0]) return fail('Matière introuvable.', 404);
    return json({ ok: true });
  }

  /* ---------- Sujets ---------- */

  if (action === 'create_paper' || action === 'update_paper') {
    const classCode = str(body.classCode).toUpperCase();
    const subjectId = str(body.subjectId);
    const year = Number(body.year);
    const title = str(body.title);
    const session = str(body.sessionLabel || 'Session normale') || 'Session normale';
    const paperUrl = str(body.paperUrl);
    const isPremium = body.free !== true;
    const duration = clampDuration(body.durationMinutes);
    if (
      !classCode ||
      !isUuid(subjectId) ||
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100 ||
      title.length < 3
    )
      return fail('Informations du sujet incomplètes.');

    if (action === 'create_paper') {
      if (!paperUrl) return fail('Ajoute le PDF du sujet.');
      const paperId = crypto.randomUUID();
      await sql`INSERT INTO ex237_papers(id,class_code,subject_id,exam_year,session_label,title,paper_url,is_premium,duration_minutes,status,published_at,created_by,created_at,updated_at) VALUES(${paperId},${classCode},${subjectId},${year},${session},${title},${paperUrl},${isPremium},${duration},'published',NOW(),${adminEmail},NOW(),NOW())`;
      return json({ ok: true, id: paperId }, 201);
    }

    if (!isUuid(id)) return fail('Sujet invalide.');
    const current = await sql`SELECT paper_url FROM ex237_papers WHERE id=${id} LIMIT 1`;
    if (!current[0]) return fail('Sujet introuvable.', 404);
    const oldUrl = (current[0] as any).paper_url as string | null;
    await sql`UPDATE ex237_papers SET class_code=${classCode},subject_id=${subjectId},exam_year=${year},session_label=${session},title=${title},paper_url=${paperUrl || oldUrl},is_premium=${isPremium},duration_minutes=${duration},updated_at=NOW() WHERE id=${id}`;
    if (paperUrl && oldUrl && paperUrl !== oldUrl) await deleteStored(oldUrl);
    return json({ ok: true });
  }

  if (action === 'set_paper_free') {
    if (!isUuid(id)) return fail('Sujet invalide.');
    const rows =
      await sql`UPDATE ex237_papers SET is_premium=${body.free !== true},updated_at=NOW() WHERE id=${id} RETURNING id`;
    if (!rows[0]) return fail('Sujet introuvable.', 404);
    return json({ ok: true });
  }

  // Durées lues en haut des PDF depuis l'admin (chrono du mode examen).
  if (action === 'set_paper_durations') {
    const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
    let saved = 0;
    for (const item of items) {
      const paperId = str(item?.id);
      const minutes = clampDuration(item?.minutes);
      if (!isUuid(paperId) || !minutes) continue;
      const rows =
        await sql`UPDATE ex237_papers SET duration_minutes=${minutes},updated_at=NOW() WHERE id=${paperId} RETURNING id`;
      if (rows[0]) saved++;
    }
    return json({ ok: true, saved });
  }

  if (action === 'set_paper_status') {
    const status = str(body.status);
    if (!isUuid(id)) return fail('Sujet invalide.');
    if (!['draft', 'published', 'archived'].includes(status)) return fail('Statut invalide.');
    await sql`UPDATE ex237_papers SET status=${status},published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=${id}`;
    return json({ ok: true });
  }

  if (action === 'delete_paper') {
    if (!isUuid(id)) return fail('Sujet invalide.');
    const papers = await sql`SELECT paper_url FROM ex237_papers WHERE id=${id} LIMIT 1`;
    const p: any = papers[0];
    if (!p) return fail('Sujet introuvable.', 404);
    const corrections =
      await sql`SELECT correction_pdf_path FROM ex237_corrections WHERE paper_id=${id}`;
    await sql`DELETE FROM ex237_user_papers WHERE paper_id=${id}`;
    await sql`DELETE FROM ex237_content_reports WHERE paper_id=${id}`;
    await sql`DELETE FROM ex237_content_views WHERE paper_id=${id}`;
    await sql`DELETE FROM ex237_corrections WHERE paper_id=${id}`;
    await sql`DELETE FROM ex237_papers WHERE id=${id}`;
    for (const c of corrections as any[]) await deleteStored(c.correction_pdf_path);
    await deleteStored(p.paper_url);
    return json({ ok: true });
  }

  /* ---------- Corrections ---------- */

  if (action === 'add_correction') {
    const paperId = str(body.paperId);
    const title = str(body.title) || 'Correction';
    const videoUrl = str(body.videoUrl) || null;
    const correctionPdfPath = str(body.correctionPdfPath) || null;
    const reviewer = str(body.reviewerName).slice(0, 80) || null;
    if (!isUuid(paperId) || (!videoUrl && !correctionPdfPath))
      return fail('Ajoute un PDF ou une vidéo.');
    if (!validHttpUrl(videoUrl || '')) return fail('Le lien vidéo doit commencer par https://');
    const paper = await sql`SELECT id FROM ex237_papers WHERE id=${paperId} LIMIT 1`;
    if (!paper[0]) return fail('Sujet introuvable.', 404);
    const correctionId = crypto.randomUUID();
    await sql`INSERT INTO ex237_corrections(id,paper_id,title,video_url,correction_pdf_path,reviewer_name,display_order,status,published_at,created_by,created_at,updated_at) VALUES(${correctionId},${paperId},${title},${videoUrl},${correctionPdfPath},${reviewer},COALESCE((SELECT MAX(display_order)+1 FROM ex237_corrections WHERE paper_id=${paperId}),0),'published',NOW(),${adminEmail},NOW(),NOW())`;
    return json({ ok: true, id: correctionId }, 201);
  }

  if (action === 'update_correction') {
    const title = str(body.title) || 'Correction';
    const videoUrl = str(body.videoUrl) || null;
    const newPdf = str(body.correctionPdfPath) || null;
    const removePdf = body.removePdf === true;
    const reviewer = str(body.reviewerName).slice(0, 80) || null;
    if (!isUuid(id)) return fail('Correction invalide.');
    if (!validHttpUrl(videoUrl || '')) return fail('Le lien vidéo doit commencer par https://');
    const current =
      await sql`SELECT correction_pdf_path FROM ex237_corrections WHERE id=${id} LIMIT 1`;
    if (!current[0]) return fail('Correction introuvable.', 404);
    const oldPdf = (current[0] as any).correction_pdf_path as string | null;
    const nextPdf = newPdf || (removePdf ? null : oldPdf);
    if (!nextPdf && !videoUrl) return fail('Garde au moins un PDF ou un lien vidéo.');
    await sql`UPDATE ex237_corrections SET title=${title},video_url=${videoUrl},correction_pdf_path=${nextPdf},reviewer_name=${reviewer},updated_at=NOW() WHERE id=${id}`;
    if (oldPdf && oldPdf !== nextPdf) await deleteStored(oldPdf);
    return json({ ok: true });
  }

  if (action === 'set_correction_status') {
    const status = str(body.status);
    if (!isUuid(id)) return fail('Correction invalide.');
    if (!['draft', 'published', 'archived'].includes(status)) return fail('Statut invalide.');
    await sql`UPDATE ex237_corrections SET status=${status},published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=${id}`;
    return json({ ok: true });
  }

  if (action === 'delete_correction') {
    if (!isUuid(id)) return fail('Correction invalide.');
    const rows =
      await sql`SELECT correction_pdf_path FROM ex237_corrections WHERE id=${id} LIMIT 1`;
    const c: any = rows[0];
    if (!c) return fail('Correction introuvable.', 404);
    await sql`DELETE FROM ex237_corrections WHERE id=${id}`;
    await deleteStored(c.correction_pdf_path);
    return json({ ok: true });
  }

  /* ---------- Vidéos promo ---------- */

  if (action === 'create_promo' || action === 'update_promo') {
    const title = str(body.title).slice(0, 80);
    const kind = body.kind === 'partner' ? 'partner' : 'own';
    const videoPath = str(body.videoPath) || null;
    const posterPath = POSTER_PATH.test(str(body.posterPath)) ? str(body.posterPath) : null;
    const youtubeUrl = str(body.youtubeUrl) || null;
    const ctaType = ['none', 'premium', 'whatsapp', 'link'].includes(body.ctaType)
      ? body.ctaType
      : 'none';
    const ctaLabel = str(body.ctaLabel).slice(0, 40) || null;
    const ctaUrl = str(body.ctaUrl) || null;
    const audience = body.audience === 'free' ? 'free' : 'all';
    const groupId = str(body.groupId) || null;
    const startsAt = /^\d{4}-\d{2}-\d{2}$/.test(str(body.startsAt)) ? str(body.startsAt) : null;
    const endsAt = /^\d{4}-\d{2}-\d{2}$/.test(str(body.endsAt)) ? str(body.endsAt) : null;
    if (title.length < 2) return fail('Donne un titre à la vidéo.');
    if (youtubeUrl && !youtubeId(youtubeUrl)) return fail('Lien YouTube non reconnu.');
    if (ctaType === 'link' && (!ctaUrl || !validHttpUrl(ctaUrl)))
      return fail('Le lien du bouton doit commencer par https://');

    if (action === 'create_promo') {
      if (!videoPath && !youtubeUrl) return fail('Ajoute une vidéo ou un lien YouTube.');
      const promoId = crypto.randomUUID();
      await sql`INSERT INTO ex237_promos(id,kind,title,video_path,poster_path,youtube_url,cta_type,cta_label,cta_url,audience,group_id,starts_at,ends_at,display_order,active,created_at,updated_at)
                VALUES(${promoId},${kind},${title},${videoPath},${videoPath ? posterPath : null},${youtubeUrl},${ctaType},${ctaLabel},${ctaUrl},${audience},${groupId},${startsAt},${endsAt ? `${endsAt}T23:59:59+01:00` : null},
                       COALESCE((SELECT MAX(display_order)+10 FROM ex237_promos),10),TRUE,NOW(),NOW())`;
      return json({ ok: true, id: promoId }, 201);
    }

    if (!isUuid(id)) return fail('Vidéo invalide.');
    const current: any[] =
      await sql`SELECT video_path,poster_path,youtube_url FROM ex237_promos WHERE id=${id} LIMIT 1`;
    if (!current[0]) return fail('Vidéo introuvable.', 404);
    const oldVideo = current[0].video_path as string | null;
    const oldPoster = current[0].poster_path as string | null;
    const nextVideo = videoPath || (youtubeUrl ? null : oldVideo);
    const nextYoutube = videoPath ? null : youtubeUrl;
    if (!nextVideo && !nextYoutube) return fail('Garde une vidéo ou un lien YouTube.');
    // Nouvelle vidéo : nouvelle image (ou aucune) ; même vidéo : l'image reste.
    const nextPoster = !nextVideo ? null : videoPath ? posterPath : posterPath || oldPoster;
    await sql`UPDATE ex237_promos SET kind=${kind},title=${title},video_path=${nextVideo},poster_path=${nextPoster},youtube_url=${nextYoutube},cta_type=${ctaType},cta_label=${ctaLabel},cta_url=${ctaUrl},
              audience=${audience},group_id=${groupId},starts_at=${startsAt},ends_at=${endsAt ? `${endsAt}T23:59:59+01:00` : null},updated_at=NOW() WHERE id=${id}`;
    if (oldVideo && oldVideo !== nextVideo) await deleteStored(oldVideo);
    if (oldPoster && oldPoster !== nextPoster) await deleteStored(oldPoster);
    return json({ ok: true });
  }

  // Image d'une vidéo déjà en ligne (créée depuis l'admin).
  if (action === 'set_promo_poster') {
    const posterPath = str(body.posterPath);
    if (!isUuid(id) || !POSTER_PATH.test(posterPath)) return fail('Image invalide.');
    const current: any[] =
      await sql`SELECT poster_path FROM ex237_promos WHERE id=${id} AND video_path IS NOT NULL LIMIT 1`;
    if (!current[0]) return fail('Vidéo introuvable.', 404);
    await sql`UPDATE ex237_promos SET poster_path=${posterPath},updated_at=NOW() WHERE id=${id}`;
    if (current[0].poster_path && current[0].poster_path !== posterPath)
      await deleteStored(current[0].poster_path);
    return json({ ok: true });
  }

  if (action === 'set_promo_active') {
    if (!isUuid(id)) return fail('Vidéo invalide.');
    await sql`UPDATE ex237_promos SET active=${body.active === true},updated_at=NOW() WHERE id=${id}`;
    return json({ ok: true });
  }

  if (action === 'move_promo') {
    if (!isUuid(id)) return fail('Vidéo invalide.');
    const list: any[] =
      await sql`SELECT id FROM ex237_promos ORDER BY display_order,created_at DESC`;
    const index = list.findIndex(p => String(p.id) === id);
    const target = index + (body.direction === 'up' ? -1 : 1);
    if (index < 0 || target < 0 || target >= list.length) return json({ ok: true });
    const order = list.map(p => String(p.id));
    [order[index], order[target]] = [order[target], order[index]];
    for (let i = 0; i < order.length; i++)
      await sql`UPDATE ex237_promos SET display_order=${(i + 1) * 10} WHERE id=${order[i]}`;
    return json({ ok: true });
  }

  if (action === 'delete_promo') {
    if (!isUuid(id)) return fail('Vidéo invalide.');
    const rows: any[] =
      await sql`DELETE FROM ex237_promos WHERE id=${id} RETURNING video_path,poster_path`;
    if (!rows[0]) return fail('Vidéo introuvable.', 404);
    await deleteStored(rows[0].video_path);
    await deleteStored(rows[0].poster_path);
    return json({ ok: true });
  }

  /* ---------- Erreurs signalées dans les contenus ---------- */

  if (action === 'content_report_resolve') {
    if (!isUuid(id)) return fail('Signalement invalide.');
    await sql`UPDATE ex237_content_reports SET status=${body.reopen === true ? 'open' : 'resolved'} WHERE id=${id}`;
    return json({ ok: true });
  }

  if (action === 'content_report_delete') {
    if (!isUuid(id)) return fail('Signalement invalide.');
    await sql`DELETE FROM ex237_content_reports WHERE id=${id}`;
    return json({ ok: true });
  }

  /* ---------- Signalements du chat ---------- */

  if (action === 'report_dismiss') {
    const messageId = str(body.messageId);
    if (!isUuid(messageId)) return fail('Message invalide.');
    await sql`DELETE FROM ex237_chat_reports WHERE message_id=${messageId}`;
    return json({ ok: true });
  }

  if (action === 'report_delete_message') {
    const messageId = str(body.messageId);
    if (!isUuid(messageId)) return fail('Message invalide.');
    const rows = await sql`SELECT room_id FROM ex237_chat_messages WHERE id=${messageId} LIMIT 1`;
    await sql`DELETE FROM ex237_chat_reports WHERE message_id=${messageId}`;
    const message: any = rows[0];
    if (message) {
      await sql`DELETE FROM ex237_chat_reactions WHERE message_id=${messageId}`;
      await sql`UPDATE ex237_chat_messages SET reply_to_id=NULL WHERE reply_to_id=${messageId}`;
      await sql`DELETE FROM ex237_chat_messages WHERE id=${messageId}`;
      try {
        await publishRoomEvent(String(message.room_id), 'message', {
          deletedIds: [messageId],
          roomId: message.room_id,
        });
      } catch {}
    }
    return json({ ok: true });
  }

  /* ---------- Assistant ---------- */

  if (action === 'assistant_settings') {
    const settings = await saveAssistantSettings({
      mode: body.mode,
      dailyLimit: body.dailyLimit,
      freeDailyLimit: body.freeDailyLimit,
    });
    return json({ ok: true, settings });
  }

  if (action === 'assistant_test') {
    const question = str(body.question).slice(0, 1000);
    if (question.length < 3) return fail('Écris une question à tester.');
    if (!assistantConfigured()) return fail('Ajoute d’abord ANTHROPIC_API_KEY dans Vercel.', 409);
    try {
      const result = await testAssistant(question, str(body.groupLabel) || null);
      return json({ ok: true, ...result });
    } catch (e: any) {
      return fail(
        `L’assistant n’a pas pu répondre : ${String(e?.message || 'erreur inconnue')}`,
        502
      );
    }
  }

  return fail('Action inconnue.', 404);
}
