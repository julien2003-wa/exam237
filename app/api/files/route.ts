import crypto from 'node:crypto';
import { get } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { after, NextRequest, NextResponse } from 'next/server';
import { db, isUuid } from '@/lib/db';
import { getViewer, isActiveStudent, type Viewer } from '@/lib/auth';
import { canOpenPaper, isPremiumViewer } from '@/lib/access';
import { ensureSchema } from '@/lib/schema';

// Import direct navigateur → Vercel Blob : le fichier ne passe pas par la fonction
// Vercel (limitée à 4,5 Mo par requête). Seul le jeton d'envoi est généré ici.
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const PDF_PATH = /^exam237\/(paper|correction)\/[A-Za-z0-9._-]{1,160}\.pdf$/;
const VIDEO_PATH = /^exam237\/promo\/[A-Za-z0-9._-]{1,160}\.(mp4|webm|mov)$/;
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

async function storedResponse(
  pathname: string | null | undefined,
  req: NextRequest,
  options: { fallbackType: string; cache: string }
) {
  if (!pathname) return fail('Fichier introuvable.', 404);
  if (/^https?:\/\//i.test(pathname)) return NextResponse.redirect(pathname, 302);
  const range = req.headers.get('range');
  const result = await get(pathname, {
    access: 'private',
    ...(range ? { headers: { range } } : {}),
  });
  if (!result || result.statusCode !== 200) return fail('Fichier introuvable.', 404);
  const headers = new Headers({
    'Content-Type': result.blob?.contentType || options.fallbackType,
    'Content-Disposition': 'inline',
    'Cache-Control': options.cache,
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  });
  // Lecture vidéo par morceaux (nécessaire sur iPhone) : on relaie la plage reçue.
  const contentRange = result.headers.get('content-range');
  const length = result.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  if (contentRange) headers.set('Content-Range', contentRange);
  return new NextResponse(result.stream as any, { status: contentRange ? 206 : 200, headers });
}

function logView(viewer: Viewer, paperId: string, kind: 'paper' | 'correction') {
  if (viewer.role !== 'student' || !viewer.userId) return;
  const task = async () => {
    await ensureSchema();
    await db()`INSERT INTO ex237_content_views(id,user_id,paper_id,view_type,viewed_at)
               VALUES(${crypto.randomUUID()},${viewer.userId},${paperId},${kind},NOW())`;
  };
  const run = () => task().catch(e => console.error('Vue non enregistrée:', e));
  try {
    after(run);
  } catch {
    void run();
  }
}

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return fail('Non connecté.', 401);
  const kind = req.nextUrl.searchParams.get('kind');
  const id = String(req.nextUrl.searchParams.get('id') || '');
  if (!isUuid(id) || !['paper', 'correction', 'promo'].includes(String(kind)))
    return fail('Fichier invalide.');
  const sql = db();
  const isAdmin = viewer.role === 'admin';
  if (!isAdmin && !isActiveStudent(viewer)) return fail('Compte non actif.', 403);

  if (kind === 'promo') {
    await ensureSchema();
    const rows: any[] =
      await sql`SELECT video_path,kind,audience,active FROM ex237_promos WHERE id=${id} LIMIT 1`;
    const promo = rows[0];
    if (!promo || (!isAdmin && !promo.active)) return fail('Vidéo introuvable.', 404);
    return storedResponse(promo.video_path, req, {
      fallbackType: 'video/mp4',
      cache: 'private, max-age=3600',
    });
  }

  if (kind === 'paper') {
    const rows: any[] = await sql`
      SELECT p.id,p.paper_url,p.status,c.group_id
      FROM ex237_papers p JOIN ex237_classes c ON c.code=p.class_code
      WHERE p.id=${id} LIMIT 1`;
    const p = rows[0];
    // L'admin peut ouvrir un sujet archivé ou en brouillon pour le vérifier.
    if (!p || (!isAdmin && p.status !== 'published')) return fail('Sujet introuvable.', 404);
    if (!isAdmin) {
      if (!viewer.groupId || String(viewer.groupId) !== String(p.group_id))
        return fail('Ce sujet n’appartient pas à ta classe.', 403);
      if (!(await canOpenPaper(viewer, String(p.id), viewer.groupId)))
        return fail('Ce sujet est réservé aux membres Premium.', 402);
      logView(viewer, String(p.id), 'paper');
    }
    return storedResponse(p.paper_url, req, {
      fallbackType: 'application/pdf',
      cache: 'private, no-store',
    });
  }

  const rows: any[] = await sql`
    SELECT cor.correction_pdf_path,cor.status AS correction_status,p.id AS paper_id,p.status AS paper_status,c.group_id
    FROM ex237_corrections cor JOIN ex237_papers p ON p.id=cor.paper_id JOIN ex237_classes c ON c.code=p.class_code
    WHERE cor.id=${id} LIMIT 1`;
  const c = rows[0];
  if (!c || (!isAdmin && (c.correction_status !== 'published' || c.paper_status !== 'published')))
    return fail('Correction introuvable.', 404);
  if (!isAdmin) {
    if (!viewer.groupId || String(viewer.groupId) !== String(c.group_id))
      return fail('Cette correction n’appartient pas à ta classe.', 403);
    if (
      !isPremiumViewer(viewer) &&
      !(await canOpenPaper(viewer, String(c.paper_id), viewer.groupId))
    )
      return fail('Cette correction est réservée aux membres Premium.', 402);
    logView(viewer, String(c.paper_id), 'correction');
  }
  return storedResponse(c.correction_pdf_path, req, {
    fallbackType: 'application/pdf',
    cache: 'private, no-store',
  });
}

// Génère le jeton d'envoi pour @vercel/blob/client (upload()) — réservé à l'admin.
export async function POST(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer || viewer.role !== 'admin') return fail('Non autorisé.', 403);
  let body: HandleUploadBody;
  try {
    body = await req.json();
  } catch {
    return fail('Requête invalide.');
  }
  // Aucun rappel « envoi terminé » n'est configuré : on n'accepte que la demande de jeton.
  if (body?.type !== 'blob.generate-client-token') return fail('Requête invalide.');
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async pathname => {
        if (PDF_PATH.test(pathname))
          return {
            allowedContentTypes: ['application/pdf'],
            maximumSizeInBytes: MAX_PDF_BYTES,
            addRandomSuffix: true,
          };
        if (VIDEO_PATH.test(pathname))
          return {
            allowedContentTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
            maximumSizeInBytes: MAX_VIDEO_BYTES,
            addRandomSuffix: true,
          };
        throw new Error('Nom de fichier invalide.');
      },
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return fail(e?.message || 'Import impossible.', 400);
  }
}
