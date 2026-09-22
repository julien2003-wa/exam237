import { db } from '../../lib/db.js';
import { json } from '../../lib/http.js';
import { requireUser, premiumActive } from '../../lib/security.js';
export default async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Méthode non autorisée'});
  const s=await requireUser(req); if(!s) return json(res,401,{error:'Non connecté'});
  try{
    const sql=db();
    const rows=await sql`
      SELECT p.id,p.class_code,c.label AS class_label,c.exam_type,c.series,
             p.exam_year,p.session_label,p.title,p.paper_url,p.is_premium,
             sub.id AS subject_id,sub.name AS subject_name,
             COALESCE(json_agg(json_build_object('id',cor.id,'title',cor.title,'videoUrl',cor.video_url,'order',cor.display_order) ORDER BY cor.display_order)
               FILTER (WHERE cor.id IS NOT NULL),'[]'::json) AS corrections
      FROM ex237_papers p
      JOIN ex237_classes c ON c.code=p.class_code
      JOIN ex237_subjects sub ON sub.id=p.subject_id
      LEFT JOIN ex237_corrections cor ON cor.paper_id=p.id AND cor.status='published'
      WHERE p.status='published'
      GROUP BY p.id,c.label,c.exam_type,c.series,c.display_order,sub.id,sub.name
      ORDER BY c.display_order,sub.name,p.exam_year DESC
    `;
    const premium=premiumActive(s);
    const papers=rows.map(r=>({
      id:r.id,classCode:r.class_code,classLabel:r.class_label,examType:r.exam_type,series:r.series,
      year:r.exam_year,session:r.session_label,title:r.title,subjectId:r.subject_id,subjectName:r.subject_name,
      locked:r.is_premium&&!premium,
      paperUrl:(!r.is_premium||premium)?r.paper_url:null,
      corrections:(r.corrections||[]).map(c=>({...c,videoUrl:(!r.is_premium||premium)?c.videoUrl:null}))
    }));
    return json(res,200,{premium,papers});
  }catch(e){console.error(e);return json(res,500,{error:'Contenu indisponible.'});}
}
