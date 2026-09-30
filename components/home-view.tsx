'use client';
import type { Viewer } from './exam-app';

export default function HomeView({viewer,latest,paperCount,onOpenSubjects,onOpenChat}:{viewer:Viewer;latest:any[];paperCount:number;onOpenSubjects:()=>void;onOpenChat:()=>void}){
  const first=(viewer.displayName||'').split(' ')[0]||'';
  return <section>
    <div className="view-head"><div><h2>{first?`Bonjour ${first}`:'Accueil'}</h2><p>{viewer.groupLabel||'Exam237'}</p></div></div>
    <div className="grid">
      <article className="card section-card"><div className="feed"><button className="feed-item" style={{width:'100%',textAlign:'left',cursor:'pointer'}} onClick={onOpenChat}><div className="chat-avatar">💬</div><div><b>{viewer.role==='admin'?'Tous les chats':'Chat de '+(viewer.groupLabel||'ma classe')}</b><small>{viewer.role==='admin'?'Ouvrir les groupes et modérer les discussions':'Discuter avec les élèves de ton groupe'}</small></div><span className="btn btn-primary btn-sm">Ouvrir</span></button><button className="feed-item" style={{width:'100%',textAlign:'left',cursor:'pointer'}} onClick={onOpenSubjects}><div className="feed-icon">📚</div><div><b>Sujets et corrections</b><small>{paperCount} sujet{paperCount>1?'s':''} disponible{paperCount>1?'s':''}</small></div><span className="btn btn-light btn-sm">Voir</span></button></div></article>
      <article className="card section-card"><div className="section-title"><h3>Derniers sujets</h3><button className="btn btn-light btn-sm" onClick={onOpenSubjects}>Tout voir</button></div><div className="feed">{latest.length?latest.map((p:any)=><div className="feed-item" key={p.id}><div className="feed-icon">📄</div><div><b>{p.subjectName} · {p.year}</b><small>{p.title} · {p.classLabel}</small></div>{p.paperUrl?<a className="btn btn-primary btn-sm" target="_blank" href={p.paperUrl}>Ouvrir</a>:null}</div>):<div className="empty">Aucun nouveau sujet.</div>}</div></article>
    </div>
  </section>;
}
