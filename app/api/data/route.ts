import crypto from 'node:crypto';
import { del } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getViewer, sha256 } from '@/lib/auth';
import { decryptMessage } from '@/lib/crypto';
import { publishRoomEvent } from '@/lib/realtime';
import { assistantConfigured, assistantOverview, saveAssistantSettings, testAssistant } from '@/lib/assistant';

export const maxDuration = 60;

const json = (data:Record<string,unknown>, status=200) => NextResponse.json(data,{status});
const fail = (message:string,status=400) => json({error:message},status);
const codeify = (value:string) => value.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,16);
const slugify = (value:string) => value.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,80);
const str = (value:unknown) => String(value ?? '').trim();
const clampDays = (value:unknown) => Math.max(1,Math.min(730,Math.round(Number(value))||365));

function effectiveStatus(row:any) {
  if (row.disabled_at || row.account_status === 'suspended') return 'suspended';
  if (row.account_status === 'pending') return 'pending';
  if (!row.premium_until || new Date(row.premium_until).getTime() <= Date.now()) return 'expired';
  return 'active';
}

// Supprime un PDF privé de Vercel Blob. Appelé APRÈS la suppression en base :
// si le fichier ne peut pas être effacé, la base reste cohérente (au pire un fichier orphelin).
async function deleteStored(pathname:string|null|undefined) {
  if (!pathname || /^https?:\/\//i.test(pathname)) return;
  try { await del(pathname); } catch (e) { console.error('Suppression Blob impossible:', pathname, e); }
}

function validVideoUrl(value:string) {
  return !value || /^https?:\/\/[^\s]+$/i.test(value);
}

function appUrl(req:NextRequest) {
  return String(process.env.APP_URL || req.nextUrl.origin).replace(/\/$/,'');
}

function friendlyDbError(e:any) {
  const message = String(e?.message || e || '');
  const code = String(e?.code || '');
  if (code === '23505' || /unique|duplicate/i.test(message)) return {status:409,message:'Cette valeur existe déjà (nom ou code en double).'};
  if (code === '23503' || /foreign key/i.test(message)) return {status:409,message:'Impossible : d’autres données y sont encore liées.'};
  console.error('Admin action:', e);
  return {status:500,message:'Opération impossible pour le moment. Réessaie.'};
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
    const [groups,classes,subjects,papers,corrections,users,rooms,reportCount]=await Promise.all([
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
          SELECT u.id,u.email,u.premium_until,u.created_at,u.disabled_at,p.display_name,p.class_code,p.account_status,p.chat_muted_until,
                 c.label AS class_label,g.label AS group_label,ss.last_seen_at,COALESCE(ss.active_sessions,0)::int AS active_sessions
          FROM jl_users u LEFT JOIN ex237_user_profiles p ON p.user_id=u.id LEFT JOIN ex237_classes c ON c.code=p.class_code
          LEFT JOIN ex237_groups g ON g.id=c.group_id LEFT JOIN ss ON ss.user_id=u.id
          WHERE u.role IN ('student','user') ORDER BY u.created_at DESC`,
      sql`SELECT r.id,r.group_id,r.title,r.active,g.label AS group_label,
                 (SELECT COUNT(*)::int FROM ex237_chat_messages m WHERE m.room_id=r.id) AS message_count
          FROM ex237_chat_rooms r JOIN ex237_groups g ON g.id=r.group_id ORDER BY g.display_order,g.label`,
      sql`SELECT COUNT(DISTINCT message_id)::int AS n FROM ex237_chat_reports`
    ]);
    const now=Date.now();
    const mappedUsers=users.map((u:any)=>({
      id:u.id,email:u.email,displayName:u.display_name||'',classCode:u.class_code||null,classLabel:u.class_label||null,groupLabel:u.group_label||null,
      accountStatus:effectiveStatus(u),premiumUntil:u.premium_until||null,lastSeenAt:u.last_seen_at||null,createdAt:u.created_at||null,
      mutedUntil:u.chat_muted_until&&new Date(u.chat_muted_until).getTime()>now?u.chat_muted_until:null,
      online:!u.disabled_at&&u.active_sessions>0&&u.last_seen_at&&new Date(u.last_seen_at).getTime()>now-2*60*1000
    }));
    return json({
      viewer,groups,classes,subjects,papers,corrections,users:mappedUsers,rooms,
      assistantConfigured:assistantConfigured(),
      stats:{
        students:mappedUsers.length,
        pending:mappedUsers.filter((u:any)=>u.accountStatus==='pending').length,
        online:mappedUsers.filter((u:any)=>u.online).length,
        active:mappedUsers.filter((u:any)=>u.accountStatus==='active').length,
        papers:papers.filter((p:any)=>p.status==='published').length,
        corrections:corrections.filter((c:any)=>c.status==='published').length,
        reports:Number((reportCount[0] as any)?.n||0)
      }
    });
  }

  if(action==='admin_reports') {
    if(viewer.role!=='admin') return fail('Non autorisé.',403);
    const rows=await sql`
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
    const byMessage=new Map<string,any>();
    for(const row of rows as any[]){
      const key=String(row.message_id);
      if(!byMessage.has(key)){
        let text='Message illisible';
        try{text=decryptMessage(String(row.room_id),row.ciphertext,row.iv,row.auth_tag);}catch{}
        byMessage.set(key,{
          messageId:key,roomId:row.room_id,groupLabel:row.group_label,
          senderUserId:row.sender_user_id||null,senderName:row.sender_name||'Élève',
          text,createdAt:row.message_created_at,
          mutedUntil:row.chat_muted_until&&new Date(row.chat_muted_until).getTime()>Date.now()?row.chat_muted_until:null,
          lastReportAt:row.created_at,reports:[]
        });
      }
      byMessage.get(key).reports.push({id:row.id,reason:row.reason||null,reporterName:row.reporter_name||'Élève',createdAt:row.created_at});
    }
    return json({reports:[...byMessage.values()]});
  }

  if(action==='admin_assistant') {
    if(viewer.role!=='admin') return fail('Non autorisé.',403);
    try {
      return json(await assistantOverview());
    } catch (e:any) {
      console.error('Assistant overview:',e);
      return fail('Impossible de charger l’assistant : la base n’a pas pu préparer ses tables.',500);
    }
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
  let body:any={}; try{body=await req.json();}catch{}
  const action=str(body.action);
  try {
    return await adminAction(req,action,body);
  } catch (e:any) {
    const {status,message}=friendlyDbError(e);
    return fail(message,status);
  }
}

async function adminAction(req:NextRequest,action:string,body:any):Promise<NextResponse> {
  const sql=db();
  const adminEmail=process.env.ADMIN_EMAIL||'admin';

  /* ---------- Élèves ---------- */

  if(action==='activate_user'||action==='extend_user') {
    const id=str(body.id); const days=clampDays(body.days);
    if(!id) return fail('Élève invalide.');
    const rows=await sql`UPDATE jl_users SET premium_until=CASE WHEN premium_until>NOW() THEN premium_until+(${days}*INTERVAL '1 day') ELSE NOW()+(${days}*INTERVAL '1 day') END,disabled_at=NULL,disabled_reason=NULL,updated_at=NOW() WHERE id=${id} RETURNING premium_until`;
    if(!rows[0]) return fail('Élève introuvable.',404);
    await sql`UPDATE ex237_user_profiles SET account_status='active',activated_at=COALESCE(activated_at,NOW()),activated_by=${adminEmail},updated_at=NOW() WHERE user_id=${id}`;
    return json({ok:true,premiumUntil:(rows[0] as any).premium_until});
  }

  // Lève une suspension SANS rajouter de jours : l'élève retrouve ce qui lui restait.
  if(action==='reactivate_user') {
    const id=str(body.id); if(!id) return fail('Élève invalide.');
    const rows=await sql`UPDATE jl_users SET disabled_at=NULL,disabled_reason=NULL,updated_at=NOW() WHERE id=${id} RETURNING premium_until`;
    if(!rows[0]) return fail('Élève introuvable.',404);
    await sql`UPDATE ex237_user_profiles SET account_status=CASE WHEN activated_at IS NULL THEN 'pending' ELSE 'active' END,updated_at=NOW() WHERE user_id=${id}`;
    return json({ok:true,premiumUntil:(rows[0] as any).premium_until||null});
  }

  if(action==='suspend_user') {
    const id=str(body.id); if(!id) return fail('Élève invalide.');
    await sql`UPDATE ex237_user_profiles SET account_status='suspended',updated_at=NOW() WHERE user_id=${id}`;
    await sql`UPDATE jl_users SET disabled_at=NOW(),disabled_reason='Suspendu par Exam237',updated_at=NOW() WHERE id=${id}`;
    await sql`DELETE FROM jl_sessions WHERE user_id=${id}`;
    return json({ok:true});
  }

  if(action==='delete_user') {
    const id=str(body.id); if(!id) return fail('Élève invalide.');
    await sql`DELETE FROM jl_users WHERE id=${id} AND role IN ('student','user')`;
    return json({ok:true});
  }

  if(action==='set_user_class') {
    const id=str(body.id); const classCode=str(body.classCode).toUpperCase();
    if(!id||!classCode) return fail('Élève ou classe invalide.');
    const cls=await sql`SELECT code FROM ex237_classes WHERE code=${classCode} LIMIT 1`;
    if(!cls[0]) return fail('Classe introuvable.',404);
    const rows=await sql`UPDATE ex237_user_profiles SET class_code=${classCode},updated_at=NOW() WHERE user_id=${id} RETURNING user_id`;
    if(!rows[0]) return fail('Ce compte n’a pas de profil Exam237.',404);
    return json({ok:true});
  }

  // Lien de réinitialisation à transmettre soi-même (WhatsApp, SMS…), valable 24 h.
  if(action==='reset_link') {
    const id=str(body.id); if(!id) return fail('Élève invalide.');
    const user=await sql`SELECT id FROM jl_users WHERE id=${id} LIMIT 1`;
    if(!user[0]) return fail('Élève introuvable.',404);
    const token=crypto.randomBytes(32).toString('base64url');
    await sql`DELETE FROM ex237_password_reset_tokens WHERE user_id=${id} OR expires_at<NOW()`;
    await sql`INSERT INTO ex237_password_reset_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(${crypto.randomUUID()},${id},${sha256(token)},NOW()+INTERVAL '24 hours',NOW())`;
    return json({ok:true,link:`${appUrl(req)}/reset?token=${encodeURIComponent(token)}`});
  }

  if(action==='mute_user') {
    const userId=str(body.userId); const minutes=Math.max(1,Math.min(10080,Math.round(Number(body.minutes))||60));
    if(!userId) return fail('Élève invalide.');
    await sql`UPDATE ex237_user_profiles SET chat_muted_until=NOW()+(${minutes}*INTERVAL '1 minute'),updated_at=NOW() WHERE user_id=${userId}`;
    return json({ok:true});
  }

  if(action==='unmute_user') {
    const userId=str(body.userId); if(!userId) return fail('Élève invalide.');
    await sql`UPDATE ex237_user_profiles SET chat_muted_until=NULL,updated_at=NOW() WHERE user_id=${userId}`;
    return json({ok:true});
  }

  /* ---------- Groupes ---------- */

  if(action==='create_group') {
    const label=str(body.label);
    const examType=str(body.examType||'AUTRE').toUpperCase()||'AUTRE';
    const code=codeify(str(body.code||label));
    if(label.length<2||!code) return fail('Nom du groupe invalide.');
    const id=crypto.randomUUID(),roomId=crypto.randomUUID();
    await sql`INSERT INTO ex237_groups(id,code,label,exam_type,display_order,active,created_at,updated_at) VALUES(${id},${code},${label},${examType},COALESCE((SELECT MAX(display_order)+10 FROM ex237_groups),10),TRUE,NOW(),NOW())`;
    await sql`INSERT INTO ex237_chat_rooms(id,group_id,title,active,created_at,updated_at) VALUES(${roomId},${id},${label},TRUE,NOW(),NOW())`;
    return json({ok:true,id,roomId},201);
  }

  if(action==='update_group') {
    const id=str(body.id); const label=str(body.label); const examType=str(body.examType||'AUTRE').toUpperCase()||'AUTRE';
    if(!id||label.length<2) return fail('Nom du groupe invalide.');
    const rows=await sql`UPDATE ex237_groups SET label=${label},exam_type=${examType},updated_at=NOW() WHERE id=${id} RETURNING id`;
    if(!rows[0]) return fail('Groupe introuvable.',404);
    await sql`UPDATE ex237_chat_rooms SET title=${label},updated_at=NOW() WHERE group_id=${id}`;
    return json({ok:true});
  }

  // Un groupe ne se supprime que vide (sans classe). Son chat est supprimé avec lui.
  if(action==='delete_group') {
    const id=str(body.id); if(!id) return fail('Groupe invalide.');
    const used=await sql`SELECT COUNT(*)::int AS n FROM ex237_classes WHERE group_id=${id}`;
    const n=Number((used[0] as any)?.n||0);
    if(n>0) return fail(`Ce groupe contient encore ${n} classe${n>1?'s':''}. Déplace ou supprime d’abord ${n>1?'ces classes':'cette classe'}.`,409);
    const rooms=await sql`SELECT id FROM ex237_chat_rooms WHERE group_id=${id}`;
    for(const room of rooms as any[]){
      await sql`DELETE FROM ex237_chat_reports WHERE message_id IN (SELECT id FROM ex237_chat_messages WHERE room_id=${room.id})`;
      await sql`UPDATE ex237_chat_messages SET reply_to_id=NULL WHERE room_id=${room.id} AND reply_to_id IS NOT NULL`;
      await sql`DELETE FROM ex237_chat_messages WHERE room_id=${room.id}`;
      await sql`DELETE FROM ex237_chat_rooms WHERE id=${room.id}`;
    }
    const rows=await sql`DELETE FROM ex237_groups WHERE id=${id} RETURNING id`;
    if(!rows[0]) return fail('Groupe introuvable.',404);
    return json({ok:true});
  }

  /* ---------- Classes ---------- */

  if(action==='create_class') {
    const label=str(body.label);
    const code=codeify(str(body.code||label));
    const groupId=str(body.groupId);
    const series=str(body.series).toUpperCase()||null;
    if(label.length<2||!code||!groupId) return fail('Classe incomplète.');
    const group=await sql`SELECT id,exam_type FROM ex237_groups WHERE id=${groupId} AND active=TRUE LIMIT 1`;
    if(!group[0]) return fail('Groupe invalide.');
    const examType=str(body.examType||(group[0] as any).exam_type||'AUTRE').toUpperCase()||'AUTRE';
    await sql`INSERT INTO ex237_classes(code,label,exam_type,series,display_order,active,group_id,created_at) VALUES(${code},${label},${examType},${series},COALESCE((SELECT MAX(display_order)+10 FROM ex237_classes),10),TRUE,${groupId},NOW())`;
    return json({ok:true,code},201);
  }

  if(action==='update_class') {
    const code=str(body.code).toUpperCase(); const label=str(body.label); const groupId=str(body.groupId);
    const series=str(body.series).toUpperCase()||null;
    if(!code||label.length<2||!groupId) return fail('Classe incomplète.');
    const current=await sql`SELECT group_id,exam_type FROM ex237_classes WHERE code=${code} LIMIT 1`;
    if(!current[0]) return fail('Classe introuvable.',404);
    const group=await sql`SELECT id,exam_type FROM ex237_groups WHERE id=${groupId} LIMIT 1`;
    if(!group[0]) return fail('Groupe invalide.');
    const sameGroup=String((current[0] as any).group_id||'')===String((group[0] as any).id);
    const examType=sameGroup?(current[0] as any).exam_type:((group[0] as any).exam_type||'AUTRE');
    await sql`UPDATE ex237_classes SET label=${label},group_id=${groupId},series=${series},exam_type=${examType} WHERE code=${code}`;
    return json({ok:true});
  }

  if(action==='set_class_active') {
    const code=str(body.code).toUpperCase(); const active=body.active===true;
    if(!code) return fail('Classe invalide.');
    const rows=await sql`UPDATE ex237_classes SET active=${active} WHERE code=${code} RETURNING code`;
    if(!rows[0]) return fail('Classe introuvable.',404);
    return json({ok:true});
  }

  // Une classe ne se supprime que si aucun élève ni sujet ne l'utilise (sinon : la désactiver).
  if(action==='delete_class') {
    const code=str(body.code).toUpperCase(); if(!code) return fail('Classe invalide.');
    const usage=await sql`SELECT (SELECT COUNT(*)::int FROM ex237_user_profiles WHERE class_code=${code}) AS students,
                                 (SELECT COUNT(*)::int FROM ex237_papers WHERE class_code=${code}) AS papers`;
    const students=Number((usage[0] as any)?.students||0), papers=Number((usage[0] as any)?.papers||0);
    if(students||papers){
      const parts=[students?`${students} élève${students>1?'s':''}`:'',papers?`${papers} sujet${papers>1?'s':''}`:''].filter(Boolean).join(' et ');
      return fail(`Impossible : ${parts} utilise${students+papers>1?'nt':''} encore cette classe. Désactive-la plutôt pour la retirer de l’inscription.`,409);
    }
    await sql`DELETE FROM ex237_class_subjects WHERE class_code=${code}`;
    const rows=await sql`DELETE FROM ex237_classes WHERE code=${code} RETURNING code`;
    if(!rows[0]) return fail('Classe introuvable.',404);
    return json({ok:true});
  }

  /* ---------- Matières ---------- */

  if(action==='create_subject') {
    const name=str(body.name); const classCodes=Array.isArray(body.classCodes)?[...new Set(body.classCodes.map((x:any)=>str(x).toUpperCase()).filter(Boolean))]:[];
    if(name.length<2||!classCodes.length) return fail('Matière et classes requises.');
    const id=crypto.randomUUID(); const slug=`${slugify(name)}-${id.slice(0,8)}`;
    await sql`INSERT INTO ex237_subjects(id,name,slug,active,created_at,updated_at) VALUES(${id},${name},${slug},TRUE,NOW(),NOW())`;
    for(const code of classCodes) await sql`INSERT INTO ex237_class_subjects(class_code,subject_id) VALUES(${code},${id}) ON CONFLICT DO NOTHING`;
    return json({ok:true,id},201);
  }

  if(action==='update_subject') {
    const id=str(body.id); const name=str(body.name);
    const classCodes=Array.isArray(body.classCodes)?[...new Set(body.classCodes.map((x:any)=>str(x).toUpperCase()).filter(Boolean))]:[];
    if(!id||name.length<2||!classCodes.length) return fail('Matière et classes requises.');
    const rows=await sql`UPDATE ex237_subjects SET name=${name},updated_at=NOW() WHERE id=${id} RETURNING id`;
    if(!rows[0]) return fail('Matière introuvable.',404);
    await sql`DELETE FROM ex237_class_subjects WHERE subject_id=${id}`;
    for(const code of classCodes) await sql`INSERT INTO ex237_class_subjects(class_code,subject_id) VALUES(${code},${id}) ON CONFLICT DO NOTHING`;
    return json({ok:true});
  }

  if(action==='delete_subject') {
    const id=str(body.id); if(!id) return fail('Matière invalide.');
    const used=await sql`SELECT COUNT(*)::int AS n FROM ex237_papers WHERE subject_id=${id}`;
    const n=Number((used[0] as any)?.n||0);
    if(n>0) return fail(`${n} sujet${n>1?'s utilisent':' utilise'} encore cette matière. Supprime-${n>1?'les':'le'} ou change leur matière d’abord.`,409);
    await sql`DELETE FROM ex237_class_subjects WHERE subject_id=${id}`;
    const rows=await sql`DELETE FROM ex237_subjects WHERE id=${id} RETURNING id`;
    if(!rows[0]) return fail('Matière introuvable.',404);
    return json({ok:true});
  }

  /* ---------- Sujets ---------- */

  if(action==='create_paper'||action==='update_paper') {
    const classCode=str(body.classCode).toUpperCase(); const subjectId=str(body.subjectId); const year=Number(body.year);
    const title=str(body.title); const session=str(body.sessionLabel||'Session normale')||'Session normale'; const paperUrl=str(body.paperUrl);
    if(!classCode||!subjectId||!Number.isInteger(year)||year<2000||year>2100||title.length<3) return fail('Informations du sujet incomplètes.');

    if(action==='create_paper') {
      if(!paperUrl) return fail('Ajoute le PDF du sujet.');
      const id=crypto.randomUUID();
      await sql`INSERT INTO ex237_papers(id,class_code,subject_id,exam_year,session_label,title,paper_url,is_premium,status,published_at,created_by,created_at,updated_at) VALUES(${id},${classCode},${subjectId},${year},${session},${title},${paperUrl},TRUE,'published',NOW(),${adminEmail},NOW(),NOW())`;
      return json({ok:true,id},201);
    }

    const id=str(body.id); if(!id) return fail('Sujet invalide.');
    const current=await sql`SELECT paper_url FROM ex237_papers WHERE id=${id} LIMIT 1`;
    if(!current[0]) return fail('Sujet introuvable.',404);
    const oldUrl=(current[0] as any).paper_url as string|null;
    await sql`UPDATE ex237_papers SET class_code=${classCode},subject_id=${subjectId},exam_year=${year},session_label=${session},title=${title},paper_url=${paperUrl||oldUrl},updated_at=NOW() WHERE id=${id}`;
    if(paperUrl&&oldUrl&&paperUrl!==oldUrl) await deleteStored(oldUrl);
    return json({ok:true});
  }

  if(action==='set_paper_status') {
    const id=str(body.id); const status=str(body.status); if(!['draft','published','archived'].includes(status)) return fail('Statut invalide.');
    await sql`UPDATE ex237_papers SET status=${status},published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=${id}`;
    return json({ok:true});
  }

  if(action==='delete_paper') {
    const id=str(body.id);
    const papers=await sql`SELECT paper_url FROM ex237_papers WHERE id=${id} LIMIT 1`; const p:any=papers[0];
    if(!p) return fail('Sujet introuvable.',404);
    const corrections=await sql`SELECT correction_pdf_path FROM ex237_corrections WHERE paper_id=${id}`;
    await sql`DELETE FROM ex237_corrections WHERE paper_id=${id}`;
    await sql`DELETE FROM ex237_papers WHERE id=${id}`;
    for(const c of corrections as any[]) await deleteStored(c.correction_pdf_path);
    await deleteStored(p.paper_url);
    return json({ok:true});
  }

  /* ---------- Corrections ---------- */

  if(action==='add_correction') {
    const paperId=str(body.paperId); const title=str(body.title)||'Correction';
    const videoUrl=str(body.videoUrl)||null; const correctionPdfPath=str(body.correctionPdfPath)||null;
    if(!paperId||(!videoUrl&&!correctionPdfPath)) return fail('Ajoute un PDF ou une vidéo.');
    if(!validVideoUrl(videoUrl||'')) return fail('Le lien vidéo doit commencer par https://');
    const paper=await sql`SELECT id FROM ex237_papers WHERE id=${paperId} LIMIT 1`;
    if(!paper[0]) return fail('Sujet introuvable.',404);
    const id=crypto.randomUUID();
    await sql`INSERT INTO ex237_corrections(id,paper_id,title,video_url,correction_pdf_path,display_order,status,published_at,created_by,created_at,updated_at) VALUES(${id},${paperId},${title},${videoUrl},${correctionPdfPath},COALESCE((SELECT MAX(display_order)+1 FROM ex237_corrections WHERE paper_id=${paperId}),0),'published',NOW(),${adminEmail},NOW(),NOW())`;
    return json({ok:true,id},201);
  }

  if(action==='update_correction') {
    const id=str(body.id); const title=str(body.title)||'Correction';
    const videoUrl=str(body.videoUrl)||null; const newPdf=str(body.correctionPdfPath)||null; const removePdf=body.removePdf===true;
    if(!id) return fail('Correction invalide.');
    if(!validVideoUrl(videoUrl||'')) return fail('Le lien vidéo doit commencer par https://');
    const current=await sql`SELECT correction_pdf_path FROM ex237_corrections WHERE id=${id} LIMIT 1`;
    if(!current[0]) return fail('Correction introuvable.',404);
    const oldPdf=(current[0] as any).correction_pdf_path as string|null;
    const nextPdf=newPdf||(removePdf?null:oldPdf);
    if(!nextPdf&&!videoUrl) return fail('Garde au moins un PDF ou un lien vidéo.');
    await sql`UPDATE ex237_corrections SET title=${title},video_url=${videoUrl},correction_pdf_path=${nextPdf},updated_at=NOW() WHERE id=${id}`;
    if(oldPdf&&oldPdf!==nextPdf) await deleteStored(oldPdf);
    return json({ok:true});
  }

  if(action==='set_correction_status') {
    const id=str(body.id); const status=str(body.status); if(!['draft','published','archived'].includes(status)) return fail('Statut invalide.');
    await sql`UPDATE ex237_corrections SET status=${status},published_at=CASE WHEN ${status}='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=${id}`;
    return json({ok:true});
  }

  if(action==='delete_correction') {
    const id=str(body.id);
    const rows=await sql`SELECT correction_pdf_path FROM ex237_corrections WHERE id=${id} LIMIT 1`; const c:any=rows[0];
    if(!c) return fail('Correction introuvable.',404);
    await sql`DELETE FROM ex237_corrections WHERE id=${id}`;
    await deleteStored(c.correction_pdf_path);
    return json({ok:true});
  }

  /* ---------- Signalements du chat ---------- */

  if(action==='report_dismiss') {
    const messageId=str(body.messageId); if(!messageId) return fail('Message invalide.');
    await sql`DELETE FROM ex237_chat_reports WHERE message_id=${messageId}`;
    return json({ok:true});
  }

  if(action==='report_delete_message') {
    const messageId=str(body.messageId); if(!messageId) return fail('Message invalide.');
    const rows=await sql`SELECT room_id FROM ex237_chat_messages WHERE id=${messageId} LIMIT 1`;
    await sql`DELETE FROM ex237_chat_reports WHERE message_id=${messageId}`;
    const message:any=rows[0];
    if(message){
      await sql`UPDATE ex237_chat_messages SET reply_to_id=NULL WHERE reply_to_id=${messageId}`;
      await sql`DELETE FROM ex237_chat_messages WHERE id=${messageId}`;
      try{await publishRoomEvent(String(message.room_id),'message',{deletedId:messageId,roomId:message.room_id});}catch{}
    }
    return json({ok:true});
  }

  /* ---------- Assistant ---------- */

  if(action==='assistant_settings') {
    const settings=await saveAssistantSettings({mode:body.mode,dailyLimit:body.dailyLimit});
    return json({ok:true,settings});
  }

  if(action==='assistant_test') {
    const question=str(body.question).slice(0,1000);
    if(question.length<3) return fail('Écris une question à tester.');
    if(!assistantConfigured()) return fail('Ajoute d’abord ANTHROPIC_API_KEY dans Vercel.',409);
    try {
      const result=await testAssistant(question,str(body.groupLabel)||null);
      return json({ok:true,...result});
    } catch (e:any) {
      return fail(`L’assistant n’a pas pu répondre : ${String(e?.message||'erreur inconnue')}`,502);
    }
  }

  return fail('Action inconnue.',404);
}
