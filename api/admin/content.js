import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { put, get } from '@vercel/blob';
import { db } from '../../lib/db.js';
import { json, readJson } from '../../lib/http.js';
import { requireAdmin } from '../../lib/security.js';
import { slugify } from '../../lib/slug.js';

const MAX_PDF_BYTES = 4 * 1024 * 1024;

function requestUrl(req) {
  return new URL(req.url || '/', 'https://exam237.local');
}

function header(req, name) {
  const value = req.headers?.[String(name).toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readRaw(req, maxBytes = MAX_PDF_BYTES) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw new Error('PDF trop volumineux. Maximum : 4 Mo.');
    return req.body;
  }
  if (typeof req.body === 'string') {
    const b = Buffer.from(req.body);
    if (b.length > maxBytes) throw new Error('PDF trop volumineux. Maximum : 4 Mo.');
    return b;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > maxBytes) throw new Error('PDF trop volumineux. Maximum : 4 Mo.');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

async function streamStoredFile(pathname, res) {
  if (!pathname) return json(res, 404, { error: 'Fichier introuvable.' });
  if (/^https?:\/\//i.test(pathname)) {
    res.statusCode = 302;
    res.setHeader('Location', pathname);
    return res.end();
  }
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200) return json(res, 404, { error: 'Fichier introuvable.' });
  res.statusCode = 200;
  res.setHeader('Content-Type', result.blob?.contentType || 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Readable.fromWeb(result.stream).pipe(res);
}

export default async function handler(req,res){
  const admin = await requireAdmin(req);
  if (!admin) return json(res,401,{error:'Non autorisé'});
  const sql = db();
  const url = requestUrl(req);

  if (req.method === 'PUT' && url.searchParams.get('upload') === 'pdf') {
    try {
      const kind = url.searchParams.get('kind');
      if (!['paper','correction'].includes(kind)) return json(res,400,{error:'Type de fichier invalide.'});
      const contentType = String(header(req,'content-type') || '').toLowerCase();
      if (!contentType.includes('application/pdf')) return json(res,400,{error:'Seuls les fichiers PDF sont acceptés.'});
      const raw = await readRaw(req);
      if (!raw.length) return json(res,400,{error:'Fichier vide.'});
      let fileName = String(header(req,'x-filename') || 'document.pdf');
      try { fileName = decodeURIComponent(fileName); } catch {}
      fileName = fileName.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-120) || 'document.pdf';
      if (!fileName.toLowerCase().endsWith('.pdf')) fileName += '.pdf';
      const blob = await put(`exam237/${kind}/${Date.now()}-${fileName}`, raw, {
        access: 'private',
        contentType: 'application/pdf',
        addRandomSuffix: true
      });
      return json(res,201,{ok:true,pathname:blob.pathname,size:raw.length});
    } catch (e) {
      console.error(e);
      const m = String(e?.message || e);
      if (/token|blob|store|oidc/i.test(m)) return json(res,503,{error:'Le stockage PDF n’est pas encore configuré dans Vercel.'});
      return json(res,400,{error:m || 'Import du PDF impossible.'});
    }
  }

  if (req.method === 'GET') {
    try {
      const preview = url.searchParams.get('preview');
      const id = String(url.searchParams.get('id') || '');
      if (preview === 'paper' && id) {
        const rows = await sql`SELECT paper_url FROM ex237_papers WHERE id=${id} LIMIT 1`;
        return streamStoredFile(rows[0]?.paper_url, res);
      }
      if (preview === 'correction' && id) {
        const rows = await sql`SELECT correction_pdf_path FROM ex237_corrections WHERE id=${id} LIMIT 1`;
        return streamStoredFile(rows[0]?.correction_pdf_path, res);
      }

      const [classes,subjects,papers,corrections,users] = await Promise.all([
        sql`SELECT code,label,exam_type,series FROM ex237_classes WHERE active=TRUE ORDER BY display_order`,
        sql`SELECT s.id,s.name,s.slug,s.active,
            COALESCE(json_agg(cs.class_code ORDER BY cs.class_code) FILTER(WHERE cs.class_code IS NOT NULL),'[]'::json) AS class_codes
            FROM ex237_subjects s
            LEFT JOIN ex237_class_subjects cs ON cs.subject_id=s.id
            GROUP BY s.id ORDER BY s.name`,
        sql`SELECT p.id,p.class_code,c.label AS class_label,p.exam_year,p.session_label,p.title,
            p.paper_url,p.is_premium,p.status,p.created_at,s.name AS subject_name,s.id AS subject_id
            FROM ex237_papers p
            JOIN ex237_classes c ON c.code=p.class_code
            JOIN ex237_subjects s ON s.id=p.subject_id
            ORDER BY p.created_at DESC`,
        sql`SELECT cor.id,cor.paper_id,cor.title,cor.video_url,cor.correction_pdf_path,
            cor.display_order,cor.status,cor.created_at,
            p.title AS paper_title,p.exam_year,p.class_code,c.label AS class_label,s.name AS subject_name
            FROM ex237_corrections cor
            JOIN ex237_papers p ON p.id=cor.paper_id
            JOIN ex237_classes c ON c.code=p.class_code
            JOIN ex237_subjects s ON s.id=p.subject_id
            ORDER BY cor.created_at DESC`,
        sql`WITH ss AS (
              SELECT user_id,MAX(last_seen_at) AS last_seen_at,
                     COUNT(*) FILTER (WHERE expires_at>NOW())::int AS active_sessions
              FROM jl_sessions
              WHERE role='user' AND user_id IS NOT NULL
              GROUP BY user_id
            )
            SELECT u.id,u.email,u.premium_until,u.created_at,u.disabled_at,
                   p.display_name,p.class_code,c.label AS class_label,
                   ss.last_seen_at,COALESCE(ss.active_sessions,0)::int AS active_sessions
            FROM jl_users u
            LEFT JOIN ex237_user_profiles p ON p.user_id=u.id
            LEFT JOIN ex237_classes c ON c.code=p.class_code
            LEFT JOIN ss ON ss.user_id=u.id
            WHERE u.role IN ('student','user')
            ORDER BY u.created_at DESC`
      ]);

      const now = Date.now();
      const mappedUsers = users.map(u => {
        const last = u.last_seen_at ? new Date(u.last_seen_at).getTime() : 0;
        const until = u.premium_until ? new Date(u.premium_until).getTime() : 0;
        return {
          id:u.id,email:u.email,displayName:u.display_name||'',classCode:u.class_code||'',
          classLabel:u.class_label||u.class_code||'—',createdAt:u.created_at,
          premiumUntil:u.premium_until,disabled:!!u.disabled_at,lastSeenAt:u.last_seen_at,
          online:!u.disabled_at && u.active_sessions>0 && last>now-2*60*1000,
          premiumActive:until>now
        };
      });
      const stats = {
        students:mappedUsers.length,
        online:mappedUsers.filter(u=>u.online).length,
        activeSubscriptions:mappedUsers.filter(u=>u.premiumActive).length,
        expiring30:mappedUsers.filter(u=>{
          if(!u.premiumUntil) return false;
          const ms=new Date(u.premiumUntil).getTime()-now;
          return ms>0 && ms<=30*86400000;
        }).length,
        papers:papers.filter(p=>p.status==='published').length,
        corrections:corrections.filter(c=>c.status==='published').length
      };
      return json(res,200,{classes,subjects,papers,corrections,users:mappedUsers,stats});
    } catch(e) {
      console.error(e);
      return json(res,500,{error:'Chargement impossible.'});
    }
  }

  if (req.method !== 'POST') return json(res,405,{error:'Méthode non autorisée'});

  try {
    const body = await readJson(req);
    const action = String(body.action || '');

    if (action === 'create_subject') {
      const name = String(body.name||'').trim();
      const classCodes = Array.isArray(body.classCodes) ? body.classCodes.map(v=>String(v).toUpperCase()) : [];
      if (name.length<2 || !classCodes.length) return json(res,400,{error:'Nom et classes requis.'});
      const id = crypto.randomUUID();
      const slug = slugify(name)+'-'+id.slice(0,8);
      await sql`INSERT INTO ex237_subjects(id,name,slug,active,created_at,updated_at)
                VALUES(${id},${name},${slug},TRUE,NOW(),NOW())`;
      for (const code of classCodes) {
        await sql`INSERT INTO ex237_class_subjects(class_code,subject_id)
                  VALUES(${code},${id}) ON CONFLICT DO NOTHING`;
      }
      return json(res,201,{ok:true,id});
    }

    if (action === 'create_paper') {
      const classCode=String(body.classCode||'').toUpperCase();
      const subjectId=String(body.subjectId||'');
      const year=Number(body.year);
      const title=String(body.title||'').trim();
      const paperUrl=String(body.paperUrl||'').trim();
      const sessionLabel=String(body.sessionLabel||'Session normale').trim();
      if(!classCode||!subjectId||!Number.isInteger(year)||year<2000||year>2100||title.length<3||!paperUrl)
        return json(res,400,{error:'Informations du sujet incomplètes.'});
      const id=crypto.randomUUID();
      await sql`INSERT INTO ex237_papers(
          id,class_code,subject_id,exam_year,session_label,title,paper_url,is_premium,status,created_by,created_at,updated_at
        ) VALUES(
          ${id},${classCode},${subjectId},${year},${sessionLabel},${title},${paperUrl},TRUE,'draft',
          ${process.env.ADMIN_EMAIL||'exam237-admin'},NOW(),NOW()
        )`;
      return json(res,201,{ok:true,id});
    }

    if (action === 'add_correction') {
      const paperId=String(body.paperId||'');
      const title=String(body.title||'Correction').trim() || 'Correction';
      const videoUrl=String(body.videoUrl||'').trim() || null;
      const correctionPdfPath=String(body.correctionPdfPath||'').trim() || null;
      if(!paperId || (!videoUrl && !correctionPdfPath))
        return json(res,400,{error:'Ajoute au moins un PDF de correction ou une vidéo.'});
      if(videoUrl && !/^https?:\/\//i.test(videoUrl))
        return json(res,400,{error:'Le lien vidéo est invalide.'});
      const id=crypto.randomUUID();
      await sql`INSERT INTO ex237_corrections(
          id,paper_id,title,video_url,correction_pdf_path,display_order,status,created_by,created_at,updated_at
        ) VALUES(
          ${id},${paperId},${title},${videoUrl},${correctionPdfPath},0,'draft',
          ${process.env.ADMIN_EMAIL||'exam237-admin'},NOW(),NOW()
        )`;
      return json(res,201,{ok:true,id});
    }

    if (action === 'set_paper_status') {
      const id=String(body.id||'');
      const status=String(body.status||'');
      if(!['draft','published','archived'].includes(status)) return json(res,400,{error:'Statut invalide.'});
      await sql`UPDATE ex237_papers
                SET status=${status},
                    published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,
                    updated_at=NOW()
                WHERE id=${id}`;
      return json(res,200,{ok:true});
    }

    if (action === 'set_correction_status') {
      const id=String(body.id||'');
      const status=String(body.status||'');
      if(!['draft','published','archived'].includes(status)) return json(res,400,{error:'Statut invalide.'});
      await sql`UPDATE ex237_corrections
                SET status=${status},
                    published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,
                    updated_at=NOW()
                WHERE id=${id}`;
      return json(res,200,{ok:true});
    }

    if (action === 'logout_user') {
      const id=String(body.id||'');
      if(!id) return json(res,400,{error:'Élève invalide.'});
      await sql`DELETE FROM jl_sessions WHERE user_id=${id}`;
      return json(res,200,{ok:true});
    }

    if (action === 'set_user_disabled') {
      const id=String(body.id||'');
      const disabled=body.disabled===true;
      if(!id) return json(res,400,{error:'Élève invalide.'});
      if(disabled) {
        await sql`UPDATE jl_users SET disabled_at=NOW(),disabled_reason='Désactivé depuis Exam237 Admin',updated_at=NOW() WHERE id=${id}`;
        await sql`DELETE FROM jl_sessions WHERE user_id=${id}`;
      } else {
        await sql`UPDATE jl_users SET disabled_at=NULL,disabled_reason=NULL,updated_at=NOW() WHERE id=${id}`;
      }
      return json(res,200,{ok:true});
    }

    return json(res,400,{error:'Action inconnue.'});
  } catch(e) {
    console.error(e);
    return json(res,500,{error:'Opération impossible.'});
  }
}
