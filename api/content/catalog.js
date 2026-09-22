import { Readable } from 'node:stream';
import { get } from '@vercel/blob';
import { db } from '../../lib/db.js';
import { json } from '../../lib/http.js';
import { requireUser, premiumActive } from '../../lib/security.js';

function requestUrl(req) {
  return new URL(req.url || '/', 'https://exam237.local');
}

async function sendStoredFile(pathname,res){
  if(!pathname) return json(res,404,{error:'Fichier introuvable.'});
  if(/^https?:\/\//i.test(pathname)){
    res.statusCode=302;
    res.setHeader('Location',pathname);
    return res.end();
  }
  const result=await get(pathname,{access:'private'});
  if(!result||result.statusCode!==200) return json(res,404,{error:'Fichier introuvable.'});
  res.statusCode=200;
  res.setHeader('Content-Type',result.blob?.contentType||'application/pdf');
  res.setHeader('Content-Disposition','inline');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  Readable.fromWeb(result.stream).pipe(res);
}

export default async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Méthode non autorisée'});
  const s=await requireUser(req);
  if(!s) return json(res,401,{error:'Non connecté'});
  const sql=db();
  const url=requestUrl(req);
  const download=url.searchParams.get('download');
  const id=String(url.searchParams.get('id')||'');

  try{
    if(download==='paper'&&id){
      const rows=await sql`
        SELECT p.paper_url,p.is_premium,p.status
        FROM ex237_papers p
        WHERE p.id=${id}
        LIMIT 1
      `;
      const p=rows[0];
      if(!p||p.status!=='published') return json(res,404,{error:'Sujet introuvable.'});
      if(p.is_premium&&!premiumActive(s)) return json(res,403,{error:'Abonnement requis.'});
      return sendStoredFile(p.paper_url,res);
    }

    if(download==='correction'&&id){
      const rows=await sql`
        SELECT cor.correction_pdf_path,cor.status AS correction_status,p.is_premium,p.status AS paper_status
        FROM ex237_corrections cor
        JOIN ex237_papers p ON p.id=cor.paper_id
        WHERE cor.id=${id}
        LIMIT 1
      `;
      const c=rows[0];
      if(!c||c.paper_status!=='published'||c.correction_status!=='published') return json(res,404,{error:'Correction introuvable.'});
      if(c.is_premium&&!premiumActive(s)) return json(res,403,{error:'Abonnement requis.'});
      return sendStoredFile(c.correction_pdf_path,res);
    }

    const rows=await sql`
      SELECT p.id,p.class_code,c.label AS class_label,c.exam_type,c.series,
             p.exam_year,p.session_label,p.title,p.is_premium,
             sub.id AS subject_id,sub.name AS subject_name,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id',cor.id,
                   'title',cor.title,
                   'videoUrl',cor.video_url,
                   'pdfPath',cor.correction_pdf_path,
                   'order',cor.display_order
                 ) ORDER BY cor.display_order
               ) FILTER (WHERE cor.id IS NOT NULL),
               '[]'::json
             ) AS corrections
      FROM ex237_papers p
      JOIN ex237_classes c ON c.code=p.class_code
      JOIN ex237_subjects sub ON sub.id=p.subject_id
      LEFT JOIN ex237_corrections cor ON cor.paper_id=p.id AND cor.status='published'
      WHERE p.status='published'
      GROUP BY p.id,c.label,c.exam_type,c.series,c.display_order,sub.id,sub.name
      ORDER BY c.display_order,sub.name,p.exam_year DESC
    `;
    const premium=premiumActive(s);
    const papers=rows.map(r=>{
      const entitled=!r.is_premium||premium;
      return {
        id:r.id,classCode:r.class_code,classLabel:r.class_label,examType:r.exam_type,series:r.series,
        year:r.exam_year,session:r.session_label,title:r.title,subjectId:r.subject_id,subjectName:r.subject_name,
        locked:r.is_premium&&!premium,
        paperUrl:entitled?`/api/content/catalog?download=paper&id=${encodeURIComponent(r.id)}`:null,
        corrections:(r.corrections||[]).map(c=>({
          id:c.id,title:c.title,order:c.order,
          pdfUrl:entitled&&c.pdfPath?`/api/content/catalog?download=correction&id=${encodeURIComponent(c.id)}`:null,
          videoUrl:entitled&&c.videoUrl?c.videoUrl:null
        }))
      };
    });
    return json(res,200,{premium,papers});
  }catch(e){
    console.error(e);
    return json(res,500,{error:'Contenu indisponible.'});
  }
}
