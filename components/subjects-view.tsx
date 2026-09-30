'use client';
import { useMemo, useState } from 'react';
import type { Viewer } from './exam-app';

export default function SubjectsView({viewer,papers,notify}:{viewer:Viewer;papers:any[];onRefresh:()=>Promise<void>;notify:(m:string,t?:'error')=>void}){
  const [subject,setSubject]=useState<string>('all');
  const [search,setSearch]=useState('');
  const subjects=useMemo(()=>[...new Map(papers.map((p:any)=>[p.subjectId,p.subjectName])).entries()], [papers]);
  const visible=useMemo(()=>papers.filter((p:any)=>(subject==='all'||p.subjectId===subject)&&(!search.trim()||`${p.title} ${p.subjectName} ${p.year} ${p.classLabel}`.toLowerCase().includes(search.toLowerCase().trim()))),[papers,subject,search]);

  if(viewer.role==='admin'&&papers.length===0) return <div className="empty">Les sujets sont gérés dans l’onglet Admin.</div>;
  return <section>
    <div className="view-head"><div><h2>Sujets</h2><p>{viewer.groupLabel||'Contenus publiés'}</p></div><div className="toolbar"><select className="select" value={subject} onChange={e=>setSubject(e.target.value)}><option value="all">Toutes les matières</option>{subjects.map(([id,name])=><option key={String(id)} value={String(id)}>{String(name)}</option>)}</select><input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher…"/></div></div>
    <div className="paper-list">{visible.length?visible.map((p:any)=><article key={p.id} className="card paper-row"><div className="feed-icon">📄</div><div><h4>{p.subjectName} · {p.year}</h4><small>{p.title}</small><div className="paper-meta"><span className="mini-pill">{p.classLabel}</span><span className="mini-pill">{p.session}</span></div></div><div className="paper-actions"><a className="btn btn-primary btn-sm" target="_blank" href={p.paperUrl}>Sujet</a>{(p.corrections||[]).map((c:any)=><span key={c.id}>{c.pdfUrl?<a className="btn btn-light btn-sm" target="_blank" href={c.pdfUrl}>Correction PDF</a>:null}{c.videoUrl?<a className="btn btn-gold btn-sm" target="_blank" rel="noopener" href={c.videoUrl}>▶ Vidéo</a>:null}</span>)}</div></article>):<div className="empty">Aucun sujet trouvé.</div>}</div>
  </section>;
}
