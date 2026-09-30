import crypto from 'node:crypto';
import { del } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getViewer } from '@/lib/auth';

const json = (data:Record<string,unknown>, status=200) => NextResponse.json(data,{status});
const fail = (message:string,status=400) => json({error:message},status);
const codeify = (value:string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,16);
const slugify = (value:string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,80);

function effectiveStatus(row:any) {
  if (row.disabled_at || row.account_status === 'suspended') return 'suspended';
  if (row.account_status === 'pending') return 'pending';
  if (!row.premium_until || new Date(row.premium_until).getTime() <= Date.now()) return 'expired';
  return 'active';
}

async function deleteStored(pathname:string|null|undefined) {
  if (!pathname || /^https?:\/\//i.test(pathname)) return;
  await del(pathname);
}

export async function GET(req:NextRequest) {
  const sql=db();
  const action=req.nextUrl.searchParams.get('action')||'bootstrap';

  if(action==='public') {
    const [groups,classes]=await Promise.all([
      sql`SELECT id,code,label,exam_type,display_order FROM ex237_groups WHERE active=TRUE ORDER BY display_order,label`,
      sql`SELECT c.code,c.label,c.exam_type,c.series,c.group_id,g.label AS group_label
          FROM ex237_classes c LEFT JOIN ex237_groups g ON g.id=c.group_id
          WHERE c.active=TRUE ORDER BY c.display_order,c.label`
    ]);
    return json({groups:groups.map((g:any)=>({id:g.id,code:g.code,label:g.label,examType:g.exam_type})),classes:classes.map((c:any)=>({code:c.code,label:c.label,examType:c.exam_type,series:c.series,groupId:c.group_id,groupLabel:c.group_label}))});
  }

  const viewer=await getViewer(req);
  if(!viewer) return fail('Non connecté.',401);

  if(action==='admin') {
    if(viewer.role!=='admin') return fail('Non autorisé.',403);
    const [groups,classes,subjects,papers,corrections,users,rooms]=await Promise.all([
      sql`SELECT id,code,label,exam_type,display_order,active,created_at FROM ex237_groups ORDER BY display_order,label`,
      sql`SELECT c.code,c.label,c.exam_type,c.series,c.display_order,c.active,c.group_id,g.label AS group_label
          FROM ex237_classes c LEFT JOIN ex237_groups g ON g.id=c.group_id ORDER BY c.display_order,c.label`,
      sql`SELECT s.id,s.name,s.slug,s.active,COALESCE(json_agg(cs.class_code ORDER BY cs.class_code) FILTER(WHERE cs.class_code IS NOT NULL),'[]'::json) AS class_codes
          FROM ex237_subjects s LEFT JOIN ex237_class_subjects cs ON cs.subject_id=s.id GROUP BY s.id ORDER BY s.name`,
      sql`SELECT p.id,p.class_code,c.label AS class_label,p.subject_id,s.name AS subject_name,p.exam_year,p.session_label,p.title,p.paper_url,p.status,p.created_at
          FROM ex237_papers p JOIN ex237_classes c ON c.code=p.class_code JOIN ex237_subjects s ON s.id=p.subject_id ORDER BY p.created_at DESC`,
      sql`SELECT cor.id,cor.paper_id,cor.title,cor.video_url,cor.correction_pdf_path,cor.status,cor.created_at,p.title AS paper_title,p.exam_year,p.class_code,c.label AS class_label,s.name AS subject_name
          FROM ex237_corrections cor JOIN ex237_papers p ON p.id=cor.paper_id JOIN ex237_classes c ON c.code=p.class_code JOIN ex237_subjects s ON s.id=p.subject_id ORDER BY cor.created_at DESC`,
      sql`WITH ss AS (
            SELECT user_id,MAX(last_seen_at) AS last_seen_at,COUNT(*) FILTER(WHERE expires_at>NOW())::int AS active_sessions
            FROM jl_sessions WHERE role='user' AND user_id IS NOT NULL GROUP BY user_id
          )
          SELECT u.id,u.email,u.premium_until,u.created_at,u.disabled_at,p.display_name,p.class_code,p.account_status,
                 c.label AS class_label,g.label AS group_label,ss.last_seen_at,COALESCE(ss.active_sessions,0)::int AS active_sessions
          FROM jl_users u LEFT JOIN ex237_user_profiles p ON p.user_id=u.id LEFT JOIN ex237_classes c ON c.code=p.class_code
          LEFT JOIN ex237_groups g ON g.id=c.group_id LEFT JOIN ss ON ss.user_id=u.id
          WHERE u.role IN ('student','user') ORDER BY u.created_at DESC`,
      sql`SELECT r.id,r.group_id,r.title,r.active,g.label AS group_label,
                 (SELECT COUNT(*)::int FROM ex237_chat_messages m WHERE m.room_id=r.id) AS message_count
          FROM ex237_chat_rooms r JOIN ex237_groups g ON g.id=r.group_id ORDER BY g.display_order,g.label`
    ]);
    const now=Date.now();
    const mappedUsers=users.map((u:any)=>({
      id:u.id,email:u.email,displayName:u.display_name||'',classCode:u.class_code||null,classLabel:u.class_label||null,groupLabel:u.group_label||null,
      accountStatus:effectiveStatus(u),premiumUntil:u.premium_until||null,lastSeenAt:u.last_seen_at||null,
      online:!u.disabled_at&&u.active_sessions>0&&u.last_seen_at&&new Date(u.last_seen_at).getTime()>now-2*60*1000
    }));
    return json({
      viewer,groups,classes,subjects,papers,corrections,users:mappedUsers,rooms,
      stats:{students:mappedUsers.length,pending:mappedUsers.filter((u:any)=>u.accountStatus==='pending').length,online:mappedUsers.filter((u:any)=>u.online).length,active:mappedUsers.filter((u:any)=>u.accountStatus==='active').length,papers:papers.filter((p:any)=>p.status==='published').length,corrections:corrections.filter((c:any)=>c.status==='published').length}
    });
  }

  if(viewer.role==='admin') {
    const rooms=await sql`SELECT r.id,r.title,g.label AS group_label FROM ex237_chat_rooms r JOIN ex237_groups g ON g.id=r.group_id WHERE r.active=TRUE ORDER BY g.display_order`;
    return json({viewer,rooms,papers:[]});
  }

  if(viewer.accountStatus!=='active') return json({viewer,papers:[],subjects:[],rooms:[]});
  if(!viewer.groupId) return fail('Ta classe n’est reliée à aucun groupe.',409);

  const rows=await sql`
    SELECT p.id,p.class_code,c.label AS class_label,p.exam_year,p.session_label,p.title,p.is_premium,
           s.id AS subject_id,s.name AS subject_name,
           COALESCE(json_agg(json_build_object('id',cor.id,'title',cor.title,'videoUrl',cor.video_url,'pdfPath',cor.correction_pdf_path,'order',cor.display_order) ORDER BY cor.display_order) FILTER(WHERE cor.id IS NOT NULL),'[]'::json) AS corrections
    FROM ex237_papers p
    JOIN ex237_classes c ON c.code=p.class_code
    JOIN ex237_subjects s ON s.id=p.subject_id
    LEFT JOIN ex237_corrections cor ON cor.paper_id=p.id AND cor.status='published'
    WHERE p.status='published' AND c.group_id=${viewer.groupId}
    GROUP BY p.id,c.label,c.display_order,s.id,s.name
    ORDER BY s.name,p.exam_year DESC,c.display_order
  `;
  const papers=rows.map((p:any)=>({
    id:p.id,classCode:p.class_code,classLabel:p.class_label,year:p.exam_year,session:p.session_label,title:p.title,subjectId:p.subject_id,subjectName:p.subject_name,locked:false,
    paperUrl:`/api/files?kind=paper&id=${encodeURIComponent(p.id)}`,
    corrections:(p.corrections||[]).map((c:any)=>({id:c.id,title:c.title,pdfUrl:c.pdfPath?`/api/files?kind=correction&id=${encodeURIComponent(c.id)}`:null,videoUrl:c.videoUrl||null}))
  }));
  const subjects=[...new Map(papers.map((p:any)=>[p.subjectId,p.subjectName])).entries()].map(([id,name])=>({id,name}));
  const rooms=await sql`SELECT id,title FROM ex237_chat_rooms WHERE group_id=${viewer.groupId} AND active=TRUE LIMIT 1`;
  const latest=papers.slice().sort((a:any,b:any)=>b.year-a.year).slice(0,6);
  return json({viewer,papers,subjects,rooms,latest});
}

export async function POST(req:NextRequest) {
  const viewer=await getViewer(req);
  if(!viewer||viewer.role!=='admin') return fail('Non autorisé.',403);
  const sql=db();
  let body:any={}; try{body=await req.json();}catch{}
  const action=String(body.action||'');

  if(action==='create_group') {
    const label=String(body.label||'').trim();
    const examType=String(body.examType||'AUTRE').trim().toUpperCase()||'AUTRE';
    const code=codeify(String(body.code||label));
    if(label.length<2||!code) return fail('Nom du groupe invalide.');
    const id=crypto.randomUUID(),roomId=crypto.randomUUID();
    await sql`INSERT INTO ex237_groups(id,code,label,exam_type,display_order,active,created_at,updated_at) VALUES(${id},${code},${label},${examType},COALESCE((SELECT MAX(display_order)+10 FROM ex237_groups),10),TRUE,NOW(),NOW())`;
    await sql`INSERT INTO ex237_chat_rooms(id,group_id,title,active,created_at,updated_at) VALUES(${roomId},${id},${label},TRUE,NOW(),NOW())`;
    return json({ok:true,id,roomId},201);
  }

  if(action==='create_class') {
    const label=String(body.label||'').trim();
    const code=codeify(String(body.code||label));
    const groupId=String(body.groupId||'');
    const examType=String(body.examType||'AUTRE').trim().toUpperCase()||'AUTRE';
    const series=String(body.series||'').trim().toUpperCase()||null;
    if(label.length<2||!code||!groupId) return fail('Classe incomplète.');
    const group=await sql`SELECT id FROM ex237_groups WHERE id=${groupId} AND active=TRUE LIMIT 1`;
    if(!group[0]) return fail('Groupe invalide.');
    await sql`INSERT INTO ex237_classes(code,label,exam_type,series,display_order,active,group_id,created_at) VALUES(${code},${label},${examType},${series},COALESCE((SELECT MAX(display_order)+10 FROM ex237_classes),10),TRUE,${groupId},NOW())`;
    return json({ok:true,code},201);
  }

  if(action==='activate_user'||action==='extend_user') {
    const id=String(body.id||''); const days=Math.max(1,Math.min(730,Number(body.days)||365));
    if(!id) return fail('Élève invalide.');
    await sql`UPDATE jl_users SET premium_until=CASE WHEN premium_until>NOW() THEN premium_until+(${days}*INTERVAL '1 day') ELSE NOW()+(${days}*INTERVAL '1 day') END,disabled_at=NULL,disabled_reason=NULL,updated_at=NOW() WHERE id=${id}`;
    await sql`UPDATE ex237_user_profiles SET account_status='active',activated_at=COALESCE(activated_at,NOW()),activated_by=${process.env.ADMIN_EMAIL||'admin'},updated_at=NOW() WHERE user_id=${id}`;
    return json({ok:true});
  }

  if(action==='suspend_user') {
    const id=String(body.id||''); if(!id)return fail('Élève invalide.');
    await sql`UPDATE ex237_user_profiles SET account_status='suspended',updated_at=NOW() WHERE user_id=${id}`;
    await sql`UPDATE jl_users SET disabled_at=NOW(),disabled_reason='Suspendu par Exam237',updated_at=NOW() WHERE id=${id}`;
    await sql`DELETE FROM jl_sessions WHERE user_id=${id}`;
    return json({ok:true});
  }

  if(action==='delete_user') {
    const id=String(body.id||''); if(!id)return fail('Élève invalide.');
    await sql`DELETE FROM jl_users WHERE id=${id} AND role IN ('student','user')`;
    return json({ok:true});
  }

  if(action==='create_subject') {
    const name=String(body.name||'').trim(); const classCodes=Array.isArray(body.classCodes)?body.classCodes.map((x:any)=>String(x).toUpperCase()):[];
    if(name.length<2||!classCodes.length)return fail('Matière et classes requises.');
    const id=crypto.randomUUID(); const slug=`${slugify(name)}-${id.slice(0,8)}`;
    await sql`INSERT INTO ex237_subjects(id,name,slug,active,created_at,updated_at) VALUES(${id},${name},${slug},TRUE,NOW(),NOW())`;
    for(const code of classCodes) await sql`INSERT INTO ex237_class_subjects(class_code,subject_id) VALUES(${code},${id}) ON CONFLICT DO NOTHING`;
    return json({ok:true,id},201);
  }

  if(action==='create_paper') {
    const classCode=String(body.classCode||'').toUpperCase(); const subjectId=String(body.subjectId||''); const year=Number(body.year);
    const title=String(body.title||'').trim(); const session=String(body.sessionLabel||'Session normale').trim(); const paperUrl=String(body.paperUrl||'').trim();
    if(!classCode||!subjectId||!Number.isInteger(year)||year<2000||year>2100||title.length<3||!paperUrl)return fail('Informations du sujet incomplètes.');
    const id=crypto.randomUUID();
    await sql`INSERT INTO ex237_papers(id,class_code,subject_id,exam_year,session_label,title,paper_url,is_premium,status,published_at,created_by,created_at,updated_at) VALUES(${id},${classCode},${subjectId},${year},${session},${title},${paperUrl},TRUE,'published',NOW(),${process.env.ADMIN_EMAIL||'admin'},NOW(),NOW())`;
    return json({ok:true,id},201);
  }

  if(action==='add_correction') {
    const paperId=String(body.paperId||''); const title=String(body.title||'Correction').trim()||'Correction';
    const videoUrl=String(body.videoUrl||'').trim()||null; const correctionPdfPath=String(body.correctionPdfPath||'').trim()||null;
    if(!paperId||(!videoUrl&&!correctionPdfPath))return fail('Ajoute un PDF ou une vidéo.');
    const id=crypto.randomUUID();
    await sql`INSERT INTO ex237_corrections(id,paper_id,title,video_url,correction_pdf_path,display_order,status,published_at,created_by,created_at,updated_at) VALUES(${id},${paperId},${title},${videoUrl},${correctionPdfPath},0,'published',NOW(),${process.env.ADMIN_EMAIL||'admin'},NOW(),NOW())`;
    return json({ok:true,id},201);
  }

  if(action==='set_paper_status') {
    const id=String(body.id||''); const status=String(body.status||''); if(!['draft','published','archived'].includes(status))return fail('Statut invalide.');
    await sql`UPDATE ex237_papers SET status=${status},published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=${id}`;
    return json({ok:true});
  }

  if(action==='set_correction_status') {
    const id=String(body.id||''); const status=String(body.status||''); if(!['draft','published','archived'].includes(status))return fail('Statut invalide.');
    await sql`UPDATE ex237_corrections SET status=${status},published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=${id}`;
    return json({ok:true});
  }

  if(action==='delete_correction') {
    const id=String(body.id||'');
    const rows=await sql`SELECT correction_pdf_path FROM ex237_corrections WHERE id=${id} LIMIT 1`; const c:any=rows[0];
    if(!c)return fail('Correction introuvable.',404);
    await deleteStored(c.correction_pdf_path);
    await sql`DELETE FROM ex237_corrections WHERE id=${id}`;
    return json({ok:true});
  }

  if(action==='delete_paper') {
    const id=String(body.id||'');
    const papers=await sql`SELECT paper_url FROM ex237_papers WHERE id=${id} LIMIT 1`; const p:any=papers[0]; if(!p)return fail('Sujet introuvable.',404);
    const corrections=await sql`SELECT correction_pdf_path FROM ex237_corrections WHERE paper_id=${id}`;
    for(const c of corrections as any[]) await deleteStored(c.correction_pdf_path);
    await deleteStored(p.paper_url);
    await sql`DELETE FROM ex237_papers WHERE id=${id}`;
    return json({ok:true});
  }

  return fail('Action inconnue.',404);
}
