import crypto from 'node:crypto';
import { get, head, issueSignedToken } from '@vercel/blob';
import { handleUpload, handleUploadPresigned } from '@vercel/blob/client';
import { after, NextRequest, NextResponse } from 'next/server';
import { db, isUuid } from '@/lib/db';
import { getViewer, isActiveStudent, type Viewer } from '@/lib/auth';
import { canOpenPaper, isPremiumViewer } from '@/lib/access';
import { ensureSchema } from '@/lib/schema';

// Import direct navigateur → Vercel Blob : le fichier ne passe pas par la fonction
// Vercel (limitée à 4,5 Mo par requête). Seule l'autorisation d'envoi est préparée ici.
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const UPLOAD_RULES = [
  {
    path: /^exam237\/(paper|correction)\/[A-Za-z0-9._-]{1,160}\.pdf$/,
    types: ['application/pdf'],
    max: MAX_PDF_BYTES,
    kind: 'PDF',
  },
  {
    path: /^exam237\/promo\/[A-Za-z0-9._-]{1,160}\.(mp4|webm|mov)$/,
    types: ['video/mp4', 'video/webm', 'video/quicktime'],
    max: MAX_VIDEO_BYTES,
    kind: 'vidéo',
  },
  {
    // Image d'une vidéo (statut), créée dans le navigateur de l'admin.
    path: /^exam237\/poster\/[A-Za-z0-9._-]{1,160}\.(jpg|webp)$/,
    types: ['image/jpeg', 'image/webp'],
    max: 3 * 1024 * 1024,
    kind: 'image',
  },
];
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Où lire le fichier : un chemin du stockage privé, ou (anciens contenus) l'adresse complète
// d'un fichier Vercel Blob. Ces fichiers passent aussi par ici : le lecteur intégré peut alors
// les lire par morceaux. Tout autre lien est simplement ouvert tel quel.
function blobSource(pathname: string): { id: string; access: 'public' | 'private' } | null {
  if (!/^https?:\/\//i.test(pathname)) return { id: pathname, access: 'private' };
  try {
    const url = new URL(pathname);
    if (url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com'))
      return { id: pathname, access: url.hostname.includes('.private.') ? 'private' : 'public' };
  } catch {}
  return null;
}

async function storedResponse(
  pathname: string | null | undefined,
  req: NextRequest,
  options: { fallbackType: string; cache: string }
) {
  if (!pathname) return fail('Fichier introuvable.', 404);
  const source = blobSource(pathname);
  if (!source) return NextResponse.redirect(pathname, 302);
  const range = req.headers.get('range');
  let result: Awaited<ReturnType<typeof get>> = null;
  try {
    result = await get(source.id, {
      access: source.access,
      ...(range ? { headers: { range } } : {}),
    });
  } catch (e) {
    console.error('Lecture du fichier impossible:', e);
    if (source.access === 'public') return NextResponse.redirect(pathname, 302);
    return fail('Le fichier n’a pas pu être lu. Réessaie.', 502);
  }
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

type Target = {
  pathname: string | null | undefined;
  fallbackType: string;
  cache: string;
  view?: { paperId: string; kind: 'paper' | 'correction' };
};

// Vérifie les droits (classe, Premium, admin) et renvoie le fichier demandé.
async function resolveTarget(
  req: NextRequest
): Promise<{ viewer: Viewer; target: Target } | NextResponse> {
  const viewer = await getViewer(req);
  if (!viewer) return fail('Non connecté.', 401);
  const kind = req.nextUrl.searchParams.get('kind');
  const id = String(req.nextUrl.searchParams.get('id') || '');
  if (!isUuid(id) || !['paper', 'correction', 'promo', 'poster'].includes(String(kind)))
    return fail('Fichier invalide.');
  const sql = db();
  const isAdmin = viewer.role === 'admin';
  if (!isAdmin && !isActiveStudent(viewer)) return fail('Compte non actif.', 403);

  if (kind === 'promo' || kind === 'poster') {
    await ensureSchema();
    const rows: any[] =
      await sql`SELECT video_path,poster_path,kind,audience,active FROM ex237_promos WHERE id=${id} LIMIT 1`;
    const promo = rows[0];
    if (!promo || (!isAdmin && !promo.active)) return fail('Vidéo introuvable.', 404);
    if (kind === 'poster')
      return {
        viewer,
        target: {
          pathname: promo.poster_path,
          fallbackType: 'image/jpeg',
          // L'adresse change avec l'image (« v= ») : elle peut rester en cache.
          cache: 'private, max-age=31536000, immutable',
        },
      };
    return {
      viewer,
      target: {
        pathname: promo.video_path,
        fallbackType: 'video/mp4',
        cache: 'private, max-age=3600',
      },
    };
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
    }
    return {
      viewer,
      target: {
        pathname: p.paper_url,
        fallbackType: 'application/pdf',
        cache: 'private, no-store, no-transform',
        view: isAdmin ? undefined : { paperId: String(p.id), kind: 'paper' },
      },
    };
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
  }
  return {
    viewer,
    target: {
      pathname: c.correction_pdf_path,
      fallbackType: 'application/pdf',
      cache: 'private, no-store, no-transform',
      view: isAdmin ? undefined : { paperId: String(c.paper_id), kind: 'correction' },
    },
  };
}

export async function GET(req: NextRequest) {
  const resolved = await resolveTarget(req);
  if (resolved instanceof NextResponse) return resolved;
  const { viewer, target } = resolved;
  // Le lecteur demande le fichier par morceaux : une seule ouverture est comptée, celle du
  // premier morceau (ou du fichier entier).
  const range = req.headers.get('range');
  if (target.view && (!range || /^bytes=0-/.test(range)))
    logView(viewer, target.view.paperId, target.view.kind);
  return storedResponse(target.pathname, req, target);
}

// Taille du fichier, affichée avant l'ouverture (économie de données). Ne compte pas de vue.
export async function HEAD(req: NextRequest) {
  const resolved = await resolveTarget(req);
  if (resolved instanceof NextResponse) return new NextResponse(null, { status: resolved.status });
  const { target } = resolved;
  const source = target.pathname ? blobSource(target.pathname) : null;
  if (!source) return new NextResponse(null, { status: 204 });
  let info: { size: number; type: string | null } | null = null;
  try {
    const found = await head(source.id);
    info = { size: found.size, type: found.contentType };
  } catch {
    // Fichier public d'un autre espace de stockage : on demande sa taille directement.
    if (source.access === 'public')
      try {
        const r = await fetch(source.id, { method: 'HEAD' });
        const size = Number(r.headers.get('content-length'));
        if (r.ok && size > 0) info = { size, type: r.headers.get('content-type') };
      } catch {}
  }
  if (!info) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': info.type || target.fallbackType,
      'Content-Length': String(info.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=600',
    },
  });
}

type UploadRule = (typeof UPLOAD_RULES)[number];

function uploadRule(pathname: string) {
  return UPLOAD_RULES.find(rule => rule.path.test(pathname)) || null;
}

function checkUpload(
  pathname: string,
  size: unknown,
  contentType: unknown
): { rule: UploadRule } | { error: string } {
  const rule = uploadRule(pathname);
  if (!rule) return { error: 'nom de fichier refusé.' };
  if (typeof contentType === 'string' && contentType && !rule.types.includes(contentType))
    return {
      error:
        rule.kind === 'PDF'
          ? 'seuls les PDF sont acceptés.'
          : rule.kind === 'image'
            ? 'image JPEG ou WebP attendue.'
            : 'choisis une vidéo MP4, WebM ou MOV.',
    };
  if (typeof size === 'number' && size <= 0) return { error: 'le fichier est vide.' };
  if (typeof size === 'number' && size > rule.max)
    return { error: `fichier trop lourd (maximum ${Math.round(rule.max / 1048576)} Mo).` };
  return { rule };
}

// Autorisation d'écrire ce seul fichier, demandée au stockage. Fonctionne avec le branchement
// récent du stockage (le site s'identifie tout seul grâce à BLOB_STORE_ID, sans clé) comme avec
// une clé BLOB_READ_WRITE_TOKEN.
function signedToken(rule: UploadRule, pathname: string) {
  return issueSignedToken({
    pathname,
    operations: ['put'],
    allowedContentTypes: rule.types,
    maximumSizeInBytes: rule.max,
  });
}

// Raison lisible quand le stockage refuse de préparer un envoi (affichée après « Import … impossible : »).
function storageMessage(e: unknown) {
  const message = String((e as any)?.message || '').replace(/^Vercel Blob:\s*/, '');
  const linkHelp = 'Dans Vercel : Storage → exam237-files → Projects, brancher le projet exam237.';
  if (/No blob credentials|No read-write token/i.test(message))
    return `le stockage des fichiers n’est pas branché sur cette version du site. ${linkHelp}`;
  if (/OIDC is enabled|environment.*not allowed|not allowed.*environment/i.test(message))
    return `le stockage n’accepte pas cette version du site (Production ou Preview). ${linkHelp}`;
  if (/Access denied/i.test(message)) return `le stockage a refusé l’accès. ${linkHelp}`;
  if (/store does not exist/i.test(message))
    return 'le stockage exam237-files est introuvable dans Vercel.';
  if (/suspended/i.test(message))
    return 'le stockage exam237-files est suspendu dans Vercel (quota dépassé ?).';
  if (/not available|rate limit|too many/i.test(message))
    return 'le stockage ne répond pas pour l’instant. Réessaie dans une minute.';
  return `le stockage a refusé l’envoi (${message.slice(0, 160) || 'raison inconnue'}).`;
}

// Prépare l'envoi direct navigateur → Vercel Blob (réservé à l'admin).
// « exam237.check-upload » vérifie d'abord tout (session, fichier, stockage) et renvoie la raison
// exacte d'un refus : la bibliothèque de Vercel n'affiche qu'un message générique en anglais.
export async function POST(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer || viewer.role !== 'admin')
    return fail('ta session admin a expiré. Reconnecte-toi, puis réessaie.', 403);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('requête invalide.');
  }
  const type = String(body?.type || '');
  const payload = body?.payload || {};
  const pathname = String(payload.pathname || '');

  if (type === 'exam237.check-upload') {
    const checked = checkUpload(pathname, payload.size, payload.contentType);
    if ('error' in checked) return fail(checked.error);
    try {
      await signedToken(checked.rule, pathname);
      return NextResponse.json({ ok: true });
    } catch (e) {
      console.error('Envoi impossible (vérification) :', e);
      return fail(storageMessage(e), 502);
    }
  }

  // Méthode actuelle : lien d'envoi présigné.
  if (type === 'blob.generate-presigned-url') {
    const rule = uploadRule(pathname);
    if (!rule) return fail('nom de fichier refusé.');
    try {
      const result = await handleUploadPresigned({
        body,
        request: req,
        // Aucun rappel « envoi terminé » n'est accepté ici : cette clé de vérification ne sert pas.
        webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || 'non-utilisee',
        getSignedToken: async () => ({
          token: await signedToken(rule, pathname),
          urlOptions: {
            allowedContentTypes: rule.types,
            maximumSizeInBytes: rule.max,
            addRandomSuffix: true,
          },
        }),
      });
      return NextResponse.json(result);
    } catch (e) {
      console.error('Envoi impossible :', e);
      return fail(storageMessage(e), 502);
    }
  }

  // Ancienne méthode (page admin ouverte avant la mise à jour) : exige une clé BLOB_READ_WRITE_TOKEN.
  if (type === 'blob.generate-client-token') {
    if (!process.env.BLOB_READ_WRITE_TOKEN)
      return fail('recharge la page de l’admin (le site a été mis à jour), puis réessaie.');
    const rule = uploadRule(pathname);
    if (!rule) return fail('nom de fichier refusé.');
    try {
      const result = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: rule.types,
          maximumSizeInBytes: rule.max,
          addRandomSuffix: true,
        }),
      });
      return NextResponse.json(result);
    } catch (e) {
      console.error('Envoi impossible :', e);
      return fail(storageMessage(e), 502);
    }
  }

  // Aucun rappel « envoi terminé » n'est configuré : tout autre message est refusé.
  return fail('requête invalide.');
}
