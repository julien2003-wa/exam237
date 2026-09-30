'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Viewer } from './exam-app';

async function jfetch(url:string,opts?:RequestInit){const r=await fetch(url,{...opts,cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Erreur');return d}
function loadAblyBrowser(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;

    if (w.Ably) {
      resolve(w.Ably);
      return;
    }

    const existing = document.querySelector(
      'script[data-exam237-ably]'
    ) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).Ably));
      existing.addEventListener('error', reject);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.ably.com/lib/ably.min-2.js';
    script.async = true;
    script.dataset.exam237Ably = 'true';

    script.onload = () => resolve((window as any).Ably);
    script.onerror = () => reject(new Error('Impossible de charger Ably'));

    document.head.appendChild(script);
  });
}
export default function ChatView({viewer,rooms:initialRooms,notify,onUnread}:{viewer:Viewer;rooms:any[];notify:(m:string,t?:'error')=>void;onUnread:(n:number)=>void}){
  const [rooms,setRooms]=useState<any[]>(initialRooms||[]);
  const [roomId,setRoomId]=useState<string>(initialRooms?.[0]?.id||'');
  const [messages,setMessages]=useState<any[]>([]);
  const [text,setText]=useState('');
  const [reply,setReply]=useState<any|null>(null);
  const [typing,setTyping]=useState('');
  const [realtime,setRealtime]=useState(false);
  const [onlineCount,setOnlineCount]=useState(0);
  const endRef=useRef<HTMLDivElement|null>(null);
  const channelRef=useRef<any>(null);

  const selected=useMemo(()=>rooms.find(r=>r.id===roomId)||rooms[0], [rooms,roomId]);
  const loadRooms=useCallback(async()=>{try{const d=await jfetch('/api/chat?action=rooms');setRooms(d.rooms||[]);if(!roomId&&d.rooms?.[0])setRoomId(d.rooms[0].id)}catch(e:any){notify(e.message,'error')}},[roomId]);
  const loadMessages=useCallback(async(scroll=true)=>{
    if(!selected?.id)return;
    try{const d=await jfetch(`/api/chat?action=messages&roomId=${encodeURIComponent(selected.id)}`);setMessages(d.messages||[]);setRealtime(!!d.realtimeConfigured);onUnread(0);if(scroll)setTimeout(()=>endRef.current?.scrollIntoView({behavior:'smooth'}),40)}catch(e:any){notify(e.message,'error')}
  },[selected?.id]);

  useEffect(()=>{loadRooms()},[]);
  useEffect(()=>{if(selected?.id)loadMessages()},[selected?.id]);

  useEffect(()=>{
    if(!selected?.id)return;
    let closed=false,client:any,channel:any,poll:any,typingTimer:any;
    (async()=>{
      try{
        const tokenCheck=await fetch('/api/chat?action=token',{cache:'no-store'});
        if(!tokenCheck.ok)throw new Error('fallback');
        const Ably:any=await loadAblyBrowser();
        if(closed)return;
        client=new Ably.Realtime({authUrl:'/api/chat?action=token',clientId:viewer.userId||'admin'});
        channel=client.channels.get(`exam237:chat:${selected.id}`);channelRef.current=channel;
        await channel.attach();
        channel.subscribe('message',()=>loadMessages(false));
        channel.subscribe('typing',(m:any)=>{
          if(m.data?.userId===viewer.userId)return;
          setTyping(m.data?.active?`${m.data?.name||'Quelqu’un'} écrit…`:'');
          clearTimeout(typingTimer);if(m.data?.active)typingTimer=setTimeout(()=>setTyping(''),2500);
        });
        try{
          await channel.presence.enter({name:viewer.displayName||'Exam237'});
          const refreshPresence=async()=>{try{const members=await channel.presence.get();setOnlineCount(members.length)}catch{}};
          await refreshPresence();
          channel.presence.subscribe(()=>refreshPresence());
        }catch{}
        setRealtime(true);
      }catch{
        setRealtime(false);poll=setInterval(()=>loadMessages(false),3500);
      }
    })();
    return()=>{closed=true;clearInterval(poll);clearTimeout(typingTimer);channelRef.current=null;try{channel?.presence.leave()}catch{};try{client?.close()}catch{}};
  },[selected?.id,viewer.userId]);

  const publishTyping=()=>{try{channelRef.current?.publish('typing',{userId:viewer.userId||'admin',name:viewer.displayName||'Exam237',active:true})}catch{}};
  const send=async()=>{
    const value=text.trim();if(!value||!selected?.id)return;
    setText('');
    try{await jfetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',roomId:selected.id,text:value,replyToId:reply?.id||null})});setReply(null);try{channelRef.current?.publish('typing',{userId:viewer.userId||'admin',active:false})}catch{};await loadMessages()}catch(e:any){setText(value);notify(e.message,'error')}
  };
  const report=async(id:string)=>{try{await jfetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'report',messageId:id,reason:'Signalé depuis le chat'})});notify('Message signalé.')}catch(e:any){notify(e.message,'error')}};
  const remove=async(id:string)=>{if(!confirm('Supprimer définitivement ce message ?'))return;try{await jfetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',messageId:id})});await loadMessages(false)}catch(e:any){notify(e.message,'error')}};
  const pin=async(id:string,pinned:boolean)=>{try{await jfetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pin',messageId:id,pinned:!pinned})});await loadMessages(false)}catch(e:any){notify(e.message,'error')}};

  if(!rooms.length)return <div className="empty">Aucun groupe de discussion disponible.</div>;
  return <section>
    {viewer.role==='admin'&&rooms.length>1?<div className="chat-room-list">{rooms.map(r=><button key={r.id} className={`room-chip ${r.id===selected?.id?'active':''}`} onClick={()=>setRoomId(r.id)}>{r.group_label||r.title}</button>)}</div>:null}
    <div className="chat-wrap">
      <header className="chat-head"><div className="chat-title"><div className="chat-avatar">{String(selected?.title||selected?.group_label||'C').charAt(0)}</div><div><b>{selected?.title||selected?.group_label||'Chat'}</b><small>{realtime?`● En direct${onlineCount?` · ${onlineCount} en ligne`:''}`:'● En ligne'}{typing?` · ${typing}`:''}</small></div></div></header>
      <div className="messages">{messages.map(m=><div key={m.id} className={`bubble-row ${m.mine?'mine':''}`}><div className={`bubble ${m.senderUserId===null?'admin':''}`} onDoubleClick={()=>setReply(m)}>{!m.mine?<div className="bubble-name">{m.senderName}{m.isPinned?<span className="pinned">Épinglé</span>:null}</div>:m.isPinned?<div className="bubble-name"><span className="pinned">Épinglé</span></div>:null}{m.replyText?<div className="reply-box"><b>{m.replySender||'Message'}</b><br/>{String(m.replyText).slice(0,120)}</div>:null}<div className="bubble-text">{m.text}</div><div className="bubble-meta">{new Date(m.createdAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div><div className="toolbar" style={{marginTop:6}}><button className="btn btn-light btn-sm" onClick={()=>setReply(m)}>↩</button>{viewer.role==='student'&&!m.mine?<button className="btn btn-light btn-sm" onClick={()=>report(m.id)}>Signaler</button>:null}{viewer.role==='admin'?<><button className="btn btn-light btn-sm" onClick={()=>pin(m.id,m.isPinned)}>{m.isPinned?'Désépingler':'Épingler'}</button><button className="btn btn-danger btn-sm" onClick={()=>remove(m.id)}>Supprimer</button></>:null}</div></div></div>)}<div ref={endRef}/></div>
      <div className="chat-compose">{reply?<div className="reply-strip"><span><b>Réponse à {reply.senderName}</b> · {String(reply.text).slice(0,80)}</span><button className="btn btn-light btn-sm" onClick={()=>setReply(null)}>×</button></div>:null}<button className="btn btn-light" title="Répondre au dernier message" onClick={()=>messages.length&&setReply(messages[messages.length-1])}>↩</button><textarea className="composer-input" rows={1} value={text} onChange={e=>{setText(e.target.value);publishTyping()}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Écrire un message…"/><button className="send-btn" onClick={send}>➤</button></div>
    </div>
  </section>;
}
