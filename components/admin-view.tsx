'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Act, type Notify } from './admin/shared';
import Students, { type StudentFilter } from './admin/students';
import Organisation from './admin/organisation';
import Contents from './admin/contents';
import Reports from './admin/reports';
import Assistant from './admin/assistant';

type Pane='students'|'classes'|'content'|'reports'|'assistant';

export default function AdminView({notify}:{notify:Notify}){
  const [data,setData]=useState<any>(null);
  const [pane,setPane]=useState<Pane>('students');
  const [studentFilter,setStudentFilter]=useState<StudentFilter|null>(null);
  const [refreshing,setRefreshing]=useState(false);
  const notifyRef=useRef(notify);
  notifyRef.current=notify;

  const load=useCallback(async()=>{
    setRefreshing(true);
    try{setData(await api('/api/data?action=admin'));}
    catch(e:any){notifyRef.current(e.message,'error');}
    finally{setRefreshing(false);}
  },[]);

  useEffect(()=>{load();},[load]);

  // Renvoie la réponse du serveur en cas de succès, null en cas d'erreur (déjà affichée).
  const act:Act=useCallback(async(body,message='Opération effectuée.')=>{
    try{
      const result=await api('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(message)notifyRef.current(message);
      await load();
      return result;
    }catch(e:any){
      notifyRef.current(e.message,'error');
      return null;
    }
  },[load]);

  if(!data)return <div className="empty">Chargement de l’administration…</div>;
  const stats=data.stats||{};

  const openStudents=(filter:StudentFilter)=>{setStudentFilter(filter);setPane('students');};
  const tabs:Array<{id:Pane;label:string;badge?:number;tone?:'gold'|'red';dot?:'on'|'warn'}>=[
    {id:'students',label:'Élèves',badge:stats.pending||0,tone:'gold'},
    {id:'classes',label:'Classes & groupes'},
    {id:'content',label:'Sujets & corrections'},
    {id:'reports',label:'Signalements',badge:stats.reports||0,tone:'red'},
    {id:'assistant',label:'Assistant IA',dot:data.assistantConfigured?'on':'warn'}
  ];

  return <section>
    <div className="adm-head">
      <div><h2>Administration</h2><p>Élèves, contenus, chat et assistant au même endroit.</p></div>
      <button className="btn btn-light btn-sm" onClick={load} disabled={refreshing} aria-label="Actualiser">↻<span className="adm-hide-mobile">{refreshing?' Actualisation…':' Actualiser'}</span></button>
    </div>

    <div className="adm-stats">
      <button type="button" className={`adm-stat ${stats.pending?'alert':''}`} onClick={()=>openStudents('pending')}><b>{stats.pending||0}</b><small>en attente</small></button>
      <button type="button" className="adm-stat" onClick={()=>openStudents('active')}><b>{stats.active||0}</b><small>actifs</small></button>
      <button type="button" className="adm-stat" onClick={()=>openStudents('all')}><b>{stats.students||0}</b><small>élèves</small></button>
      <div className="adm-stat"><b>{stats.online||0}</b><small>en ligne</small></div>
      <button type="button" className="adm-stat" onClick={()=>setPane('content')}><b>{stats.papers||0}</b><small>sujets</small></button>
      <button type="button" className="adm-stat" onClick={()=>setPane('content')}><b>{stats.corrections||0}</b><small>corrections</small></button>
      <button type="button" className={`adm-stat ${stats.reports?'danger':''}`} onClick={()=>setPane('reports')}><b>{stats.reports||0}</b><small>signalements</small></button>
    </div>

    <div className="adm-tabs" role="tablist">
      {tabs.map(t=><button key={t.id} role="tab" aria-selected={pane===t.id} className={`adm-tab ${pane===t.id?'active':''}`} onClick={()=>setPane(t.id)}>
        {t.dot?<span className={`adm-dot ${t.dot}`} aria-hidden="true"/>:null}
        {t.label}
        {t.badge?<span className={`adm-count ${t.tone==='gold'?'gold':''}`}>{t.badge>99?'99+':t.badge}</span>:null}
      </button>)}
    </div>

    {pane==='students'?<Students data={data} act={act} notify={notify} filter={studentFilter} onFilter={setStudentFilter}/>:null}
    {pane==='classes'?<Organisation data={data} act={act}/>:null}
    {pane==='content'?<Contents data={data} act={act} notify={notify}/>:null}
    {pane==='reports'?<Reports act={act} onChanged={load}/>:null}
    {pane==='assistant'?<Assistant data={data} act={act} notify={notify}/>:null}
  </section>;
}
