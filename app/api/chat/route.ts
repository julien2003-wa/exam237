import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decryptMessage, encryptMessage } from '@/lib/crypto';
import { getViewer, isActiveStudent } from '@/lib/auth';
import { chatChannel, createRealtimeToken, publishRoomEvent } from '@/lib/realtime';

const json=(data:Record<string,unknown>,status=200)=>NextResponse.json(data,{status});
const fail=(message:string,status=400)=>json({error:message},status);

async function roomForStudent(groupId:string){
  const sql=db();
  const rows=await sql`SELECT id,title FROM ex237_chat_rooms WHERE group_id=${groupId} AND active=TRUE LIMIT 1`;
  return rows[0] as any;
}

async function canAccessRoom(viewer:any, roomId:string){
  if(viewer.role==='admin')return true;
  if(!isActiveStudent(viewer)||!viewer.groupId)return false;
  const sql=db();
  const rows=await sql`SELECT id FROM ex237_chat_rooms WHERE id=${roomId} AND group_id=${viewer.groupId} AND active=TRUE LIMIT 1`;
  return !!rows[0];
}

export async function GET(req:NextRequest){
  const viewer=await getViewer(req);
  if(!viewer)return fail('Non connecté.',401);
  const action=req.nextUrl.searchParams.get('action')||'messages';
  const sql=db();

  if(action==='token'){
    if(viewer.role==='student'&&!isActiveStudent(viewer))return fail('Compte non actif.',403);
    let capability:Record<string,string[]>={};
    if(viewer.role==='admin') capability={'exam237:chat:*':['subscribe','publish','presence']};
    else {
      const room=viewer.groupId?await roomForStudent(viewer.groupId):null;
      if(!room)return fail('Aucun chat disponible.',404);
      capability[chatChannel(room.id)]=['subscribe','publish','presence'];
    }
    const token=await createRealtimeToken(viewer.userId||'admin',capability);
    if(!token)return fail('Temps réel non configuré.',503);
    return NextResponse.json(token);
  }

  if(action==='rooms'){
    if(viewer.role==='admin'){
      const rooms=await sql`SELECT r.id,r.title,g.label AS group_label,r.active,(SELECT COUNT(*)::int FROM ex237_chat_messages m WHERE m.room_id=r.id) AS message_count FROM ex237_chat_rooms r JOIN ex237_groups g ON g.id=r.group_id ORDER BY g.display_order,g.label`;
      return json({rooms});
    }
    if(!isActiveStudent(viewer)||!viewer.groupId)return json({rooms:[]});
    const room=await roomForStudent(viewer.groupId);
    return json({rooms:room?[room]:[]});
  }

  if(action==='messages'){
    let roomId=String(req.nextUrl.searchParams.get('roomId')||'');
    if(viewer.role==='student'){
      if(!isActiveStudent(viewer)||!viewer.groupId)return fail('Compte non actif.',403);
      const own=await roomForStudent(viewer.groupId);
      if(!own)return fail('Aucun chat disponible.',404);
      roomId=own.id;
    }
    if(!roomId||!(await canAccessRoom(viewer,roomId)))return fail('Chat non autorisé.',403);
    const before=String(req.nextUrl.searchParams.get('before')||'');
    const rows=before
      ? await sql`SELECT m.id,m.room_id,m.sender_user_id,m.sender_name,m.ciphertext,m.iv,m.auth_tag,m.reply_to_id,m.is_pinned,m.created_at,
                         r.sender_name AS reply_sender,r.ciphertext AS reply_ciphertext,r.iv AS reply_iv,r.auth_tag AS reply_auth_tag
                  FROM ex237_chat_messages m LEFT JOIN ex237_chat_messages r ON r.id=m.reply_to_id
                  WHERE m.room_id=${roomId} AND m.created_at<${before}::timestamptz ORDER BY m.created_at DESC LIMIT 50`
      : await sql`SELECT m.id,m.room_id,m.sender_user_id,m.sender_name,m.ciphertext,m.iv,m.auth_tag,m.reply_to_id,m.is_pinned,m.created_at,
                         r.sender_name AS reply_sender,r.ciphertext AS reply_ciphertext,r.iv AS reply_iv,r.auth_tag AS reply_auth_tag
                  FROM ex237_chat_messages m LEFT JOIN ex237_chat_messages r ON r.id=m.reply_to_id
                  WHERE m.room_id=${roomId} ORDER BY m.created_at DESC LIMIT 50`;
    const messages=(rows as any[]).reverse().map(m=>{
      let text='Message illisible'; let replyText:string|null=null;
      try{text=decryptMessage(roomId,m.ciphertext,m.iv,m.auth_tag);}catch{}
      if(m.reply_ciphertext){try{replyText=decryptMessage(roomId,m.reply_ciphertext,m.reply_iv,m.reply_auth_tag);}catch{replyText=null}}
      return {id:m.id,roomId:m.room_id,senderUserId:m.sender_user_id,senderName:m.sender_name,text,replyToId:m.reply_to_id,replySender:m.reply_sender||null,replyText,isPinned:m.is_pinned,createdAt:m.created_at,mine:viewer.role==='student'&&viewer.userId===m.sender_user_id};
    });
    return json({messages,realtimeConfigured:!!process.env.ABLY_API_KEY});
  }

  return fail('Action inconnue.',404);
}

export async function POST(req:NextRequest){
  const viewer=await getViewer(req);
  if(!viewer)return fail('Non connecté.',401);
  let body:any={}; try{body=await req.json();}catch{}
  const action=String(body.action||'send');
  const sql=db();

  if(action==='send'){
    if(viewer.role==='student'&&!isActiveStudent(viewer))return fail('Compte non actif.',403);
    let roomId=String(body.roomId||'');
    if(viewer.role==='student'){
      if(!viewer.groupId)return fail('Classe non configurée.',409);
      const room=await roomForStudent(viewer.groupId); if(!room)return fail('Aucun chat disponible.',404); roomId=room.id;
    }
    if(!roomId||!(await canAccessRoom(viewer,roomId)))return fail('Chat non autorisé.',403);
    const text=String(body.text||'').trim();
    if(!text)return fail('Message vide.');
    if(text.length>1000)return fail('Message trop long. Maximum : 1000 caractères.');
    if(viewer.role==='student'&&viewer.userId){
      const mute=await sql`SELECT chat_muted_until FROM ex237_user_profiles WHERE user_id=${viewer.userId} LIMIT 1`;
      const until=(mute[0] as any)?.chat_muted_until;
      if(until&&new Date(until).getTime()>Date.now())return fail('Tu ne peux pas envoyer de message pour le moment.',403);
      const recent=await sql`SELECT COUNT(*)::int AS n FROM ex237_chat_messages WHERE sender_user_id=${viewer.userId} AND created_at>NOW()-INTERVAL '10 seconds'`;
      if(Number((recent[0] as any)?.n||0)>=8)return fail('Tu envoies des messages trop rapidement.',429);
    }
    const replyToId=String(body.replyToId||'')||null;
    if(replyToId){const reply=await sql`SELECT id FROM ex237_chat_messages WHERE id=${replyToId} AND room_id=${roomId} LIMIT 1`;if(!reply[0])return fail('Message de réponse introuvable.');}
    const id=crypto.randomUUID();
    const encrypted=encryptMessage(roomId,text);
    const senderName=viewer.role==='admin'?'Exam237':(viewer.displayName||'Élève');
    await sql`INSERT INTO ex237_chat_messages(id,room_id,sender_user_id,sender_name,ciphertext,iv,auth_tag,reply_to_id,is_pinned,created_at)
              VALUES(${id},${roomId},${viewer.userId},${senderName},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${replyToId},FALSE,NOW())`;
    try{await publishRoomEvent(roomId,'message',{id,roomId,senderUserId:viewer.userId,createdAt:new Date().toISOString()});}catch(e){console.error('Realtime publish',e)}
    return json({ok:true,id},201);
  }

  if(action==='report'){
    if(viewer.role!=='student'||!isActiveStudent(viewer)||!viewer.userId)return fail('Non autorisé.',403);
    const messageId=String(body.messageId||''); const reason=String(body.reason||'').trim().slice(0,300)||null;
    const rows=await sql`SELECT m.id FROM ex237_chat_messages m JOIN ex237_chat_rooms r ON r.id=m.room_id WHERE m.id=${messageId} AND r.group_id=${viewer.groupId} LIMIT 1`;
    if(!rows[0])return fail('Message introuvable.',404);
    await sql`INSERT INTO ex237_chat_reports(id,message_id,reporter_user_id,reason,created_at) VALUES(${crypto.randomUUID()},${messageId},${viewer.userId},${reason},NOW())`;
    return json({ok:true});
  }

  if(viewer.role!=='admin')return fail('Non autorisé.',403);

  if(action==='delete'){
    const messageId=String(body.messageId||'');
    const rows=await sql`SELECT room_id FROM ex237_chat_messages WHERE id=${messageId} LIMIT 1`; const m:any=rows[0]; if(!m)return fail('Message introuvable.',404);
    await sql`DELETE FROM ex237_chat_messages WHERE id=${messageId}`;
    try{await publishRoomEvent(m.room_id,'message',{deletedId:messageId,roomId:m.room_id});}catch{}
    return json({ok:true});
  }

  if(action==='pin'){
    const messageId=String(body.messageId||''); const pinned=body.pinned!==false;
    const rows=await sql`UPDATE ex237_chat_messages SET is_pinned=${pinned} WHERE id=${messageId} RETURNING room_id`;
    const roomId=(rows[0] as any)?.room_id;if(roomId){try{await publishRoomEvent(roomId,'message',{pinnedId:messageId,roomId});}catch{}}
    return json({ok:true});
  }

  if(action==='mute'){
    const userId=String(body.userId||''); const minutes=Math.max(1,Math.min(10080,Number(body.minutes)||60));
    await sql`UPDATE ex237_user_profiles SET chat_muted_until=NOW()+(${minutes}*INTERVAL '1 minute'),updated_at=NOW() WHERE user_id=${userId}`;
    return json({ok:true});
  }

  return fail('Action inconnue.',404);
}
