'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import HomeView from './home-view';
import SubjectsView from './subjects-view';
import ChatView from './chat-view';
import ProfileView from './profile-view';
import AdminView from './admin-view';

export type Viewer = {
  role:'student'|'admin'; userId:string|null; email:string; displayName:string;
  classCode:string|null; classLabel:string|null; groupId:string|null; groupLabel:string|null;
  accountStatus:'pending'|'active'|'expired'|'suspended'|'admin'; premiumUntil:string|null;
};

type Bootstrap = { viewer:Viewer; papers:any[]; subjects:any[]; rooms:any[]; latest?:any[] };

type Tab='home'|'subjects'|'chat'|'admin'|'profile';

async function api(url:string,opts?:RequestInit){
  const r=await fetch(url,{...opts,cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||'Une erreur est survenue.');
  return d;
}

function Icon({name}:{name:string}){
  const icons:Record<string,string>={home:'⌂',subjects:'▤',chat:'◉',admin:'⚙',profile:'●'};
  return <span className="nav-icon">{icons[name]}</span>;
}

export default function ExamApp(){
  const router=useRouter();
  const [data,setData]=useState<Bootstrap|null>(null);
  const [tab,setTab]=useState<Tab>('home');
  const [loading,setLoading]=useState(true);
  const [toast,setToast]=useState<{text:string;type?:'error'}|null>(null);
  const [unread,setUnread]=useState(0);

  const contentRef=useRef<HTMLDivElement|null>(null);
  const scrollByTab=useRef<Record<Tab,number>>({
    home:0,
    subjects:0,
    chat:0,
    admin:0,
    profile:0
  });

  const notify=(text:string,type?:'error')=>{
    setToast({text,type});
    setTimeout(()=>setToast(null),3500);
  };

  const load=async()=>{
    try{
      const d=await api('/api/data?action=bootstrap');
      setData(d);
    }catch(e:any){
      if(/Non connecté/i.test(e.message)) router.replace('/connexion');
      else if(typeof navigator!=='undefined' && !navigator.onLine) router.replace('/offline');
      else notify(e.message,'error');
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{load()},[]);

  const viewer=data?.viewer;

  const tabs=useMemo(()=>{
    if(!viewer)return [] as Array<{id:Tab;label:string}>;
    if(viewer.role==='admin') return [
      {id:'home' as Tab,label:'Accueil'},
      {id:'subjects' as Tab,label:'Sujets'},
      {id:'chat' as Tab,label:'Chats'},
      {id:'admin' as Tab,label:'Admin'},
      {id:'profile' as Tab,label:'Profil'}
    ];
    if(viewer.accountStatus!=='active') return [
      {id:'home' as Tab,label:'Accueil'},
      {id:'profile' as Tab,label:'Profil'}
    ];
    return [
      {id:'home' as Tab,label:'Accueil'},
      {id:'subjects' as Tab,label:'Sujets'},
      {id:'chat' as Tab,label:'Chat'},
      {id:'profile' as Tab,label:'Profil'}
    ];
  },[viewer]);

  const switchTab=(next:Tab)=>{
    if(next===tab)return;
    const content=contentRef.current;
    if(content) scrollByTab.current[tab]=content.scrollTop;
    setTab(next);
  };

  useEffect(()=>{
    if(tabs.length&&!tabs.some(x=>x.id===tab)){
      const content=contentRef.current;
      if(content) scrollByTab.current[tab]=content.scrollTop;
      setTab('home');
    }
  },[tabs,tab]);

  useEffect(()=>{
    const content=contentRef.current;
    if(!content)return;

    const id=requestAnimationFrame(()=>{
      content.scrollTop=scrollByTab.current[tab]||0;
    });

    return ()=>cancelAnimationFrame(id);
  },[tab]);

  const logout=async()=>{
    try{
      await api('/api/auth?action=logout',{method:'POST'});
    }finally{
      router.replace('/connexion');
    }
  };

  if(loading||!data||!viewer){
    return (
      <main className="center-screen">
        <div className="offline-card">
          <img src="/logo.png" alt="Exam237"/>
          <p>Chargement d’Exam237…</p>
        </div>
      </main>
    );
  }

  const isPending=viewer.role==='student'&&viewer.accountStatus!=='active';
  const statusLabel=
    viewer.role==='admin'
      ?'Administrateur'
      :viewer.accountStatus==='active'
        ?'Compte actif'
        :viewer.accountStatus==='pending'
          ?'En attente'
          :viewer.accountStatus==='expired'
            ?'Accès expiré'
            :'Suspendu';

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand">
          <img src="/logo.png" alt="Exam237"/>
          <div>
            EXAM237
            <small>{viewer.groupLabel||'Administration'}</small>
          </div>
        </div>

        <div className="side-links">
          {tabs.map(x=>(
            <button
              key={x.id}
              onClick={()=>switchTab(x.id)}
              className={`nav-btn ${tab===x.id?'active':''}`}
            >
              <Icon name={x.id}/>
              <span>{x.label}</span>
              {x.id==='chat'&&unread>0
                ?<span className="badge">{unread>99?'99+':unread}</span>
                :null}
            </button>
          ))}
        </div>

        <div className="side-bottom">
          <div className="user-chip">
            <b>{viewer.displayName||viewer.email}</b>
            <small>{statusLabel}</small>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{tab==='home'?'Exam237':tabs.find(x=>x.id===tab)?.label}</h1>
          <div className="topbar-right">
            {viewer.groupLabel
              ?<span className="group-pill">{viewer.groupLabel}</span>
              :null}
            <span className={`status-pill ${viewer.accountStatus}`}>
              {statusLabel}
            </span>
          </div>
        </header>

        <div
          ref={contentRef}
          className="content"
          data-tab={tab}
        >
          {isPending&&tab==='home'
            ?<Pending viewer={viewer}/>
            :null}

          {!isPending&&tab==='home'
            ?<HomeView
                viewer={viewer}
                latest={data.latest||data.papers?.slice(0,6)||[]}
                paperCount={data.papers?.length||0}
                onOpenSubjects={()=>switchTab('subjects')}
                onOpenChat={()=>switchTab('chat')}
              />
            :null}

          {tab==='subjects'
            ?<SubjectsView
                viewer={viewer}
                papers={data.papers||[]}
                onRefresh={load}
                notify={notify}
              />
            :null}

          {tab==='chat'
            ?<ChatView
                viewer={viewer}
                rooms={data.rooms||[]}
                notify={notify}
                onUnread={setUnread}
              />
            :null}

          {tab==='admin'&&viewer.role==='admin'
            ?<AdminView notify={notify}/>
            :null}

          {tab==='profile'
            ?<ProfileView
                viewer={viewer}
                onLogout={logout}
                onRefresh={load}
                notify={notify}
              />
            :null}
        </div>
      </main>

      <nav className="mobile-nav">
        {tabs.map(x=>(
          <button
            key={x.id}
            className={tab===x.id?'active':''}
            onClick={()=>switchTab(x.id)}
          >
            <span>
              {x.id==='home'
                ?'⌂'
                :x.id==='subjects'
                  ?'▤'
                  :x.id==='chat'
                    ?'◉'
                    :x.id==='admin'
                      ?'⚙'
                      :'●'}
            </span>
            <span>{x.label}</span>
            {x.id==='chat'&&unread>0
              ?<span className="badge">{unread>99?'99+':unread}</span>
              :null}
          </button>
        ))}
      </nav>

      {toast
        ?<div className={`toast ${toast.type==='error'?'error':''}`}>
            {toast.text}
          </div>
        :null}
    </div>
  );
}

function Pending({viewer}:{viewer:Viewer}){
  const text=
    viewer.accountStatus==='pending'
      ?'Ton compte a bien été créé. Il doit maintenant être activé par Exam237.'
      :viewer.accountStatus==='expired'
        ?'Ton accès a expiré. Contacte Exam237 pour le renouveler.'
        :'Ton compte est temporairement suspendu.';

  return (
    <section className="pending-screen">
      <img src="/logo.png" alt="Exam237"/>
      <div className="pending-icon">
        {viewer.accountStatus==='pending'
          ?'⌛'
          :viewer.accountStatus==='expired'
            ?'⏱'
            :'!'}
      </div>
      <h2>
        {viewer.accountStatus==='pending'
          ?'Compte en attente'
          :viewer.accountStatus==='expired'
            ?'Accès expiré'
            :'Compte suspendu'}
      </h2>
      <p>{text}</p>
      {viewer.classLabel
        ?<p>
            <b>Classe :</b> {viewer.classLabel}<br/>
            <b>Groupe :</b> {viewer.groupLabel}
          </p>
        :null}
    </section>
  );
}
