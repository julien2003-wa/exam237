'use client';
import { upload } from '@vercel/blob/client';
import { useState, type ReactNode } from 'react';

export type Notify=(message:string,type?:'error')=>void;
export type Act=(body:Record<string,unknown>,message?:string)=>Promise<any>;

export async function api(url:string,opts?:RequestInit){
  const r=await fetch(url,{...opts,cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Une erreur est survenue.');
  return d;
}

export const MAX_PDF_MB=50;

function safePdfName(name:string){
  const base=name.normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,'').slice(-100)||'document';
  return base.toLowerCase().endsWith('.pdf')?base:`${base}.pdf`;
}

// Envoi direct navigateur → Vercel Blob (privé). Renvoie le pathname à enregistrer.
export async function uploadPdf(file:File,kind:'paper'|'correction',onProgress?:(percent:number)=>void){
  const looksPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
  if(!looksPdf)throw new Error('Choisis un fichier PDF.');
  if(file.size>MAX_PDF_MB*1024*1024)throw new Error(`PDF trop volumineux (maximum ${MAX_PDF_MB} Mo).`);
  try{
    const blob=await upload(`exam237/${kind}/${Date.now()}-${safePdfName(file.name)}`,file,{
      access:'private',
      handleUploadUrl:'/api/files',
      contentType:'application/pdf',
      multipart:file.size>8*1024*1024,
      onUploadProgress:e=>onProgress?.(Math.round(e.percentage))
    });
    return blob.pathname;
  }catch(e:any){
    const message=String(e?.message||'');
    throw new Error(message?`Import du PDF impossible : ${message}`:'Import du PDF impossible.');
  }
}

export function formatDate(value:string|null|undefined,withTime=false){
  if(!value)return '—';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '—';
  return d.toLocaleDateString('fr-FR',withTime
    ?{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}
    :{day:'2-digit',month:'short',year:'numeric'});
}

export function timeAgo(value:string|null|undefined){
  if(!value)return 'jamais';
  const diff=Date.now()-new Date(value).getTime();
  if(Number.isNaN(diff))return '—';
  const min=Math.round(diff/60000);
  if(min<2)return 'à l’instant';
  if(min<60)return `il y a ${min} min`;
  const h=Math.round(min/60);
  if(h<24)return `il y a ${h} h`;
  const d=Math.round(h/24);
  if(d<31)return `il y a ${d} j`;
  return formatDate(value);
}

export function daysLeft(value:string|null|undefined){
  if(!value)return null;
  const diff=new Date(value).getTime()-Date.now();
  if(Number.isNaN(diff))return null;
  return Math.ceil(diff/86400000);
}

export const DURATIONS=[
  {days:30,label:'1 mois'},
  {days:90,label:'3 mois'},
  {days:180,label:'6 mois'},
  {days:365,label:'1 an'}
];

export function Badge({tone,children}:{tone:'green'|'gold'|'red'|'grey'|'blue';children:ReactNode}){
  return <span className={`adm-badge adm-badge-${tone}`}>{children}</span>;
}

export function Section({title,count,defaultOpen=true,actions,children}:{title:string;count?:number|string;defaultOpen?:boolean;actions?:ReactNode;children:ReactNode}){
  const [open,setOpen]=useState(defaultOpen);
  return <article className="card adm-section">
    <header className="adm-section-head">
      <button type="button" className="adm-section-toggle" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
        <span className="adm-chevron" aria-hidden="true">{open?'▾':'▸'}</span>
        <h3>{title}</h3>
        {count!==undefined?<span className="mini-pill">{count}</span>:null}
      </button>
      {actions?<div className="adm-section-actions">{actions}</div>:null}
    </header>
    {open?<div className="adm-section-body">{children}</div>:null}
  </article>;
}

export function FilePicker({label,file,onChange,progress}:{label:string;file:File|null;onChange:(f:File|null)=>void;progress?:number|null}){
  return <div className="field">
    <label>{label}</label>
    <input className="input" type="file" accept="application/pdf,.pdf" onChange={e=>onChange(e.target.files?.[0]||null)}/>
    {file?<small>{file.name} · {(file.size/1024/1024).toFixed(1)} Mo</small>:<small>PDF jusqu’à {MAX_PDF_MB} Mo.</small>}
    {progress!==null&&progress!==undefined?<div className="adm-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${progress}%`}}/></div>:null}
  </div>;
}

export async function copyText(value:string){
  try{await navigator.clipboard.writeText(value);return true;}catch{}
  try{
    const area=document.createElement('textarea');
    area.value=value;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';
    document.body.appendChild(area);area.select();document.execCommand('copy');document.body.removeChild(area);
    return true;
  }catch{return false;}
}
