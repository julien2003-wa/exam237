'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Reset(){
  const router=useRouter();const [token,setToken]=useState('');const [ready,setReady]=useState(false);const [msg,setMsg]=useState('');const [error,setError]=useState('');
  useEffect(()=>{setToken(new URLSearchParams(window.location.search).get('token')||'');setReady(true)},[]);
  const submit=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');const f=new FormData(e.currentTarget);const password=String(f.get('password')||'');const confirm=String(f.get('confirm')||'');if(password!==confirm)return setError('Les mots de passe ne correspondent pas.');const r=await fetch('/api/auth?action=reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password})});const d=await r.json().catch(()=>({}));if(!r.ok)return setError(d.error||'Impossible de modifier le mot de passe.');setMsg('Mot de passe modifié. Tu peux maintenant te connecter.');setTimeout(()=>router.replace('/connexion'),1200)};
  return <main className="center-screen"><div className="auth-card"><img src="/logo.png" alt="Exam237" style={{width:90}}/><h2>Nouveau mot de passe</h2>{error?<div className="auth-error">{error}</div>:null}{msg?<div className="auth-success">{msg}</div>:null}{ready&&!token?<div className="auth-error">Lien invalide.</div>:ready?<form className="stack" onSubmit={submit}><div className="field"><label>Nouveau mot de passe</label><input className="input" type="password" name="password" minLength={10} required/></div><div className="field"><label>Confirmer</label><input className="input" type="password" name="confirm" minLength={10} required/></div><button className="btn btn-primary">Modifier le mot de passe</button></form>:<p>Chargement…</p>}</div></main>;
}
