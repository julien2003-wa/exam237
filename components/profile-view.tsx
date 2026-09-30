'use client';
import { useEffect, useState } from 'react';
import type { Viewer } from './exam-app';

declare global { interface WindowEventMap { beforeinstallprompt: Event; } }

export default function ProfileView({viewer,onLogout,onRefresh,notify}:{viewer:Viewer;onLogout:()=>void;onRefresh:()=>Promise<void>;notify:(m:string,t?:'error')=>void}){
  const [name,setName]=useState(viewer.displayName||'');
  const [installEvent,setInstallEvent]=useState<any>(null);
  useEffect(()=>{
    const fn=(e:any)=>{e.preventDefault();setInstallEvent(e)};
    window.addEventListener('beforeinstallprompt',fn as any);return()=>window.removeEventListener('beforeinstallprompt',fn as any);
  },[]);
  const save=async()=>{
    const r=await fetch('/api/auth?action=profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:name})});
    const d=await r.json().catch(()=>({}));if(!r.ok)return notify(d.error||'Impossible d’enregistrer.','error');notify('Profil mis à jour.');await onRefresh();
  };
  const install=async()=>{if(!installEvent)return;await installEvent.prompt();setInstallEvent(null)};
  const expires=viewer.premiumUntil?new Date(viewer.premiumUntil).toLocaleDateString('fr-FR'):null;
  return <section><div className="view-head"><div><h2>Profil</h2><p>Les informations essentielles de ton compte.</p></div></div><div className="profile-grid"><article className="card profile-box"><div className="profile-top"><div className="profile-big-avatar">{(viewer.displayName||viewer.email||'E').charAt(0).toUpperCase()}</div><div><h3>{viewer.displayName||'Exam237'}</h3><p>{viewer.email}</p></div></div><div className="info-list"><div className="info-row"><span>Classe</span><b>{viewer.classLabel||'—'}</b></div><div className="info-row"><span>Groupe</span><b>{viewer.groupLabel||'—'}</b></div><div className="info-row"><span>Statut</span><b>{viewer.accountStatus}</b></div>{expires?<div className="info-row"><span>Expiration</span><b>{expires}</b></div>:null}</div></article><article className="card profile-box"><div className="stack"><div className="field"><label>Nom affiché</label><input className="input" value={name} onChange={e=>setName(e.target.value)} disabled={viewer.role==='admin'}/></div>{viewer.role==='student'?<button className="btn btn-primary" onClick={save}>Enregistrer</button>:null}<button className="btn btn-light" onClick={onLogout}>Se déconnecter</button></div></article><article className="card install-box"><h3>Installer Exam237</h3><p>Ajoute Exam237 à l’écran d’accueil pour l’ouvrir comme une application.</p>{installEvent?<button className="btn btn-gold" onClick={install}>Installer l’application</button>:<small style={{color:'var(--muted)'}}>Si le bouton n’apparaît pas, utilise le menu de ton navigateur puis « Ajouter à l’écran d’accueil ».</small>}</article></div></section>;
}
