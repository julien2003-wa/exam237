import crypto from 'node:crypto';
import { db } from '../../lib/db.js';
import { json, readJson } from '../../lib/http.js';
import { requireAdmin } from '../../lib/security.js';
import { slugify } from '../../lib/slug.js';

export default async function handler(req,res){
  const admin=await requireAdmin(req); if(!admin) return json(res,401,{error:'Non autorisé'});
  const sql=db();
  if(req.method==='GET'){
    try{
      const [classes,subjects,papers,corrections]=await Promise.all([
        sql`SELECT code,label,exam_type,series FROM ex237_classes WHERE active=TRUE ORDER BY display_order`,
        sql`SELECT s.id,s.name,s.slug,s.active,COALESCE(json_agg(cs.class_code ORDER BY cs.class_code) FILTER(WHERE cs.class_code IS NOT NULL),'[]'::json) AS class_codes FROM ex237_subjects s LEFT JOIN ex237_class_subjects cs ON cs.subject_id=s.id GROUP BY s.id ORDER BY s.name`,
        sql`SELECT p.id,p.class_code,c.label AS class_label,p.exam_year,p.session_label,p.title,p.paper_url,p.source_note,p.is_premium,p.status,p.created_at,s.name AS subject_name,s.id AS subject_id FROM ex237_papers p JOIN ex237_classes c ON c.code=p.class_code JOIN ex237_subjects s ON s.id=p.subject_id ORDER BY p.created_at DESC`,
        sql`SELECT c.id,c.paper_id,c.title,c.video_url,c.display_order,c.status,c.created_at FROM ex237_corrections c ORDER BY c.created_at DESC`
      ]);
      return json(res,200,{classes,subjects,papers,corrections});
    }catch(e){console.error(e);return json(res,500,{error:'Chargement impossible.'});}
  }
  if(req.method!=='POST') return json(res,405,{error:'Méthode non autorisée'});
  try{
    const body=await readJson(req); const action=String(body.action||'');
    if(action==='create_subject'){
      const name=String(body.name||'').trim(); const classCodes=Array.isArray(body.classCodes)?body.classCodes.map(v=>String(v).toUpperCase()):[];
      if(name.length<2||!classCodes.length) return json(res,400,{error:'Nom et classes requis.'});
      const id=crypto.randomUUID(); const slug=slugify(name)+'-'+id.slice(0,8);
      await sql`INSERT INTO ex237_subjects(id,name,slug,active,created_at,updated_at) VALUES(${id},${name},${slug},TRUE,NOW(),NOW())`;
      for(const code of classCodes) await sql`INSERT INTO ex237_class_subjects(class_code,subject_id) VALUES(${code},${id}) ON CONFLICT DO NOTHING`;
      return json(res,201,{ok:true,id});
    }
    if(action==='create_paper'){
      const classCode=String(body.classCode||'').toUpperCase(); const subjectId=String(body.subjectId||''); const year=Number(body.year); const title=String(body.title||'').trim(); const paperUrl=String(body.paperUrl||'').trim(); const sessionLabel=String(body.sessionLabel||'Session normale').trim(); const sourceNote=String(body.sourceNote||'').trim()||null;
      if(!classCode||!subjectId||!Number.isInteger(year)||year<2000||year>2100||title.length<3||!/^https?:\/\//i.test(paperUrl)) return json(res,400,{error:'Informations du sujet incomplètes.'});
      const id=crypto.randomUUID();
      await sql`INSERT INTO ex237_papers(id,class_code,subject_id,exam_year,session_label,title,paper_url,source_note,is_premium,status,created_by,created_at,updated_at) VALUES(${id},${classCode},${subjectId},${year},${sessionLabel},${title},${paperUrl},${sourceNote},TRUE,'draft',${process.env.ADMIN_EMAIL||'exam237-admin'},NOW(),NOW())`;
      return json(res,201,{ok:true,id});
    }
    if(action==='add_correction'){
      const paperId=String(body.paperId||''); const title=String(body.title||'Correction vidéo').trim(); const videoUrl=String(body.videoUrl||'').trim();
      if(!paperId||!/^https?:\/\//i.test(videoUrl)) return json(res,400,{error:'Sujet et URL vidéo requis.'});
      const id=crypto.randomUUID(); const order=Number.isInteger(Number(body.displayOrder))?Number(body.displayOrder):0;
      await sql`INSERT INTO ex237_corrections(id,paper_id,title,video_url,display_order,status,created_by,created_at,updated_at) VALUES(${id},${paperId},${title||'Correction vidéo'},${videoUrl},${order},'draft',${process.env.ADMIN_EMAIL||'exam237-admin'},NOW(),NOW())`;
      return json(res,201,{ok:true,id});
    }
    if(action==='set_paper_status'){
      const id=String(body.id||''); const status=String(body.status||''); if(!['draft','published','archived'].includes(status)) return json(res,400,{error:'Statut invalide.'});
      await sql`UPDATE ex237_papers SET status=${status},published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=${id}`;
      return json(res,200,{ok:true});
    }
    if(action==='set_correction_status'){
      const id=String(body.id||''); const status=String(body.status||''); if(!['draft','published','archived'].includes(status)) return json(res,400,{error:'Statut invalide.'});
      await sql`UPDATE ex237_corrections SET status=${status},published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=${id}`;
      return json(res,200,{ok:true});
    }
    return json(res,400,{error:'Action inconnue.'});
  }catch(e){console.error(e);return json(res,500,{error:'Opération impossible.'});}
}
