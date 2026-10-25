'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Badge, formatDate, timeAgo, type Act } from './shared';

export default function Reports({act,onChanged}:{act:Act;onChanged:()=>void}){
  const [reports,setReports]=useState<any[]|null>(null);
  const [error,setError]=useState<string|null>(null);

  const load=useCallback(async()=>{
    try{const d=await api('/api/data?action=admin_reports');setReports(d.reports||[]);setError(null);}
    catch(e:any){setError(e.message);}
  },[]);
  useEffect(()=>{load();},[load]);

  // act() recharge déjà les données générales (compteur) ; on recharge la liste ici.
  const run=async(body:Record<string,unknown>,message:string)=>{
    const r=await act(body,message);
    await load();
    return r;
  };

  if(error)return <div className="adm-stack"><p className="adm-note error">{error}</p><button className="btn btn-light adm-more" onClick={load}>Réessayer</button></div>;
  if(!reports)return <div className="adm-empty">Chargement des signalements…</div>;

  return <div className="adm-stack">
    <p className="adm-note">Les élèves signalent un message depuis le chat (appui sur le message → 🚩). Supprime le message, ignore le signalement ou coupe la parole à l’auteur.</p>
    <div className="adm-list">
      {reports.map(r=><ReportCard key={r.messageId} report={r} run={run}/>)}
      {!reports.length?<div className="adm-empty">Aucun message signalé. 👍</div>:null}
    </div>
    <button type="button" className="btn btn-light adm-more" onClick={()=>{load();onChanged();}}>↻ Actualiser</button>
  </div>;
}

function ReportCard({report,run}:{report:any;run:(b:Record<string,unknown>,m:string)=>Promise<any>}){
  const [busy,setBusy]=useState(false);
  const exec=async(body:Record<string,unknown>,message:string)=>{setBusy(true);await run(body,message);setBusy(false);};
  const count=report.reports.length;
  return <article className="adm-item highlight">
    <div className="adm-item-head">
      <div className="adm-item-title"><b>{report.senderName}</b><span className="adm-sub">{report.groupLabel} · envoyé {timeAgo(report.createdAt)}</span></div>
      <Badge tone="red">{count} signalement{count>1?'s':''}</Badge>
    </div>
    <blockquote className="adm-quote">{report.text}</blockquote>
    <div className="adm-children">
      {report.reports.map((x:any)=><div key={x.id} className="adm-sub">🚩 <b>{x.reporterName}</b> · {formatDate(x.createdAt,true)}{x.reason?` — « ${x.reason} »`:''}</div>)}
    </div>
    {report.mutedUntil?<span className="adm-sub">🔇 Auteur muet jusqu’à {formatDate(report.mutedUntil,true)}</span>:null}
    <div className="adm-actions">
      <button className="btn btn-danger btn-sm" disabled={busy} onClick={()=>{if(confirm('Supprimer ce message pour tout le groupe ?'))exec({action:'report_delete_message',messageId:report.messageId},'Message supprimé.');}}>Supprimer le message</button>
      <button className="btn btn-light btn-sm" disabled={busy} onClick={()=>exec({action:'report_dismiss',messageId:report.messageId},'Signalement ignoré.')}>Ignorer</button>
      {report.senderUserId?(report.mutedUntil
        ?<button className="btn btn-light btn-sm" disabled={busy} onClick={()=>exec({action:'unmute_user',userId:report.senderUserId},'L’élève peut de nouveau écrire.')}>Rendre la parole</button>
        :<button className="btn btn-light btn-sm" disabled={busy} onClick={()=>exec({action:'mute_user',userId:report.senderUserId,minutes:1440},'Auteur rendu muet pendant 24 h.')}>Rendre muet 24 h</button>):null}
      {report.senderUserId?<button className="btn btn-light btn-sm" disabled={busy} onClick={()=>{if(confirm(`Suspendre le compte de ${report.senderName} ?`))exec({action:'suspend_user',id:report.senderUserId},'Compte suspendu.');}}>Suspendre l’auteur</button>:null}
    </div>
  </article>;
}
