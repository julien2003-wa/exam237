'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Connexion(){
  const router=useRouter();
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [classes,setClasses]=useState<any[]>([]);
  const [message,setMessage]=useState<{text:string;type:'error'|'success'}|null>(null);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{fetch('/api/data?action=public').then(r=>r.json()).then(d=>setClasses(d.classes||[])).catch(()=>{})},[]);
  useEffect(()=>{fetch('/api/auth?action=me',{cache:'no-store'}).then(r=>{if(r.ok)router.replace('/')}).catch(()=>{})},[]);
  const submit=async(e:React.FormEvent<HTMLFormElement>,action:'login'|'register')=>{
    e.preventDefault();setBusy(true);setMessage(null);
    const form=e.currentTarget;const body=Object.fromEntries(new FormData(form));
    if(action==='register'&&body.password!==body.confirmPassword){setMessage({text:'Les mots de passe ne correspondent pas.',type:'error'});setBusy(false);return}
    try{const r=await fetch(`/api/auth?action=${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Erreur');router.replace('/')}catch(err:any){setMessage({text:err.message,type:'error'})}finally{setBusy(false)}
  };
  const forgot=async()=>{
    const email=prompt('Entre ton adresse email :');if(!email)return;
    try{const r=await fetch('/api/auth?action=request-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();setMessage({text:d.message||'Si le compte existe, un lien a été envoyé.',type:'success'})}catch{setMessage({text:'Impossible de traiter la demande.',type:'error'})}
  };
  return <main className="auth-page"><section className="auth-brand"><div className="auth-brand-inner"><img src="/logo.png" alt="Exam237"/><h1>Tout Exam237 dans une seule application.</h1><p>Sujets, corrections et discussion avec ta classe. Pas d’espace séparé : tu te connectes et tu arrives directement dans Exam237.</p></div></section><section className="auth-panel"><div className="auth-card"><div className="auth-tabs"><button className={`auth-tab ${mode==='login'?'active':''}`} onClick={()=>setMode('login')}>Connexion</button><button className={`auth-tab ${mode==='register'?'active':''}`} onClick={()=>setMode('register')}>Créer un compte</button></div>{message?<div className={message.type==='error'?'auth-error':'auth-success'}>{message.text}</div>:null}{mode==='login'?<form className="stack" onSubmit={e=>submit(e,'login')}><div className="field"><label>Adresse email</label><input className="input" type="email" name="email" required autoComplete="email"/></div><div className="field"><label>Mot de passe</label><input className="input" type="password" name="password" required autoComplete="current-password"/></div><button className="btn btn-primary" disabled={busy}>{busy?'Connexion…':'Se connecter'}</button><button type="button" className="text-link" style={{border:0,background:'transparent'}} onClick={forgot}>Mot de passe oublié ?</button></form>:<form className="stack" onSubmit={e=>submit(e,'register')}><div className="field"><label>Nom et prénom</label><input className="input" name="displayName" required/></div><div className="field"><label>Adresse email</label><input className="input" type="email" name="email" required autoComplete="email"/></div><div className="field"><label>Classe</label><select className="select" name="classCode" required><option value="">Choisir ta classe</option>{classes.map(c=><option key={c.code} value={c.code}>{c.label}{c.groupLabel&&c.groupLabel!==c.label?` — ${c.groupLabel}`:''}</option>)}</select></div><div className="field"><label>Mot de passe</label><input className="input" type="password" name="password" minLength={10} required autoComplete="new-password"/><small>Au moins 10 caractères.</small></div><div className="field"><label>Confirmer le mot de passe</label><input className="input" type="password" name="confirmPassword" minLength={10} required autoComplete="new-password"/></div><button className="btn btn-primary" disabled={busy}>{busy?'Création…':'Créer mon compte'}</button></form>}<div className="auth-footer">Exam237 · Sujets • Corrections • Réussite</div></div></section></main>;
}
