'use client';
import { useEffect, useMemo, useState } from 'react';
import { Badge, FilePicker, formatDate, Section, uploadPdf, type Act, type Notify } from './shared';

const PAPER_STATUS:Record<string,{label:string;tone:'green'|'grey'|'gold'}>={
  published:{label:'Publié',tone:'green'},
  archived:{label:'Archivé',tone:'grey'},
  draft:{label:'Brouillon',tone:'gold'}
};
const PAGE=25;

function subjectsForClass(subjects:any[],classCode:string,keepId?:string){
  return subjects.filter(s=>s.id===keepId||!s.class_codes?.length||s.class_codes.includes(classCode));
}

export default function Contents({data,act,notify}:{data:any;act:Act;notify:Notify}){
  const classes:any[]=data.classes||[];
  const subjects:any[]=data.subjects||[];
  const papers:any[]=data.papers||[];
  const corrections:any[]=data.corrections||[];
  const [q,setQ]=useState('');const [classFilter,setClassFilter]=useState('');const [subjectFilter,setSubjectFilter]=useState('');const [statusFilter,setStatusFilter]=useState('');
  const [limit,setLimit]=useState(PAGE);

  const byPaper=useMemo(()=>{
    const map:Record<string,any[]>={};
    for(const c of corrections)(map[c.paper_id]=map[c.paper_id]||[]).push(c);
    return map;
  },[corrections]);

  const visible=useMemo(()=>{
    const term=q.trim().toLowerCase();
    return papers.filter(p=>(!classFilter||p.class_code===classFilter)&&(!subjectFilter||p.subject_id===subjectFilter)&&(!statusFilter||p.status===statusFilter)
      &&(!term||`${p.title} ${p.subject_name} ${p.exam_year} ${p.class_label} ${p.session_label}`.toLowerCase().includes(term)));
  },[papers,q,classFilter,subjectFilter,statusFilter]);

  return <div className="adm-stack">
    <PublishPaper classes={classes} subjects={subjects} act={act} notify={notify}/>
    <Subjects classes={classes} subjects={subjects} papers={papers} act={act}/>
    <Section title="Sujets et corrections" count={papers.length}>
      <div className="adm-toolbar">
        <input className="input" value={q} onChange={e=>{setQ(e.target.value);setLimit(PAGE);}} placeholder="Rechercher un sujet…" aria-label="Rechercher un sujet"/>
        <select className="select" value={classFilter} onChange={e=>{setClassFilter(e.target.value);setLimit(PAGE);}} aria-label="Classe"><option value="">Toutes les classes</option>{classes.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}</select>
        <select className="select" value={subjectFilter} onChange={e=>{setSubjectFilter(e.target.value);setLimit(PAGE);}} aria-label="Matière"><option value="">Toutes les matières</option>{subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="select" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setLimit(PAGE);}} aria-label="Statut"><option value="">Tous les statuts</option><option value="published">Publiés</option><option value="archived">Archivés</option><option value="draft">Brouillons</option></select>
      </div>
      <div className="adm-list">
        {visible.slice(0,limit).map(p=><PaperCard key={p.id} paper={p} corrections={byPaper[p.id]||[]} classes={classes} subjects={subjects} act={act} notify={notify}/>)}
        {!visible.length?<div className="adm-empty">{papers.length?'Aucun sujet ne correspond aux filtres.':'Aucun sujet publié pour l’instant.'}</div>:null}
      </div>
      {visible.length>limit?<button type="button" className="btn btn-light adm-more" onClick={()=>setLimit(l=>l+PAGE)}>Afficher plus ({visible.length-limit} restants)</button>:null}
    </Section>
  </div>;
}

function PublishPaper({classes,subjects,act,notify}:{classes:any[];subjects:any[];act:Act;notify:Notify}){
  const activeClasses=classes.filter(c=>c.active);
  const [classCode,setClassCode]=useState(activeClasses[0]?.code||'');
  const options=subjectsForClass(subjects,classCode);
  const [subjectId,setSubjectId]=useState(options[0]?.id||'');
  const [year,setYear]=useState(new Date().getFullYear());
  const [session,setSession]=useState('Session normale');
  const [title,setTitle]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [corrFile,setCorrFile]=useState<File|null>(null);
  const [video,setVideo]=useState('');
  const [progress,setProgress]=useState<number|null>(null);
  const [corrProgress,setCorrProgress]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  const [formKey,setFormKey]=useState(0);

  useEffect(()=>{if(options.length&&!options.some(s=>s.id===subjectId))setSubjectId(options[0].id);},[classCode,subjects.length]);

  const cls=classes.find(c=>c.code===classCode);
  const subject=subjects.find(s=>s.id===subjectId);
  const suggested=[subject?.name,cls?.exam_type&&cls.exam_type!=='AUTRE'?cls.exam_type:cls?.label,year].filter(Boolean).join(' ');

  const publish=async()=>{
    if(!file)return notify('Choisis le PDF du sujet.','error');
    if(!classCode||!subjectId)return notify('Choisis la classe et la matière.','error');
    setBusy(true);
    try{
      setProgress(0);
      const paperUrl=await uploadPdf(file,'paper',setProgress);
      const created=await act({action:'create_paper',classCode,subjectId,year,title:title.trim()||suggested,sessionLabel:session,paperUrl},'');
      if(!created)return;
      let withCorrection=false;
      if(corrFile||video.trim()){
        setCorrProgress(corrFile?0:null);
        const correctionPdfPath=corrFile?await uploadPdf(corrFile,'correction',setCorrProgress):null;
        withCorrection=!!(await act({action:'add_correction',paperId:created.id,title:'Correction',videoUrl:video.trim(),correctionPdfPath},''));
      }
      notify(withCorrection?'Sujet publié avec sa correction.':'Sujet publié.');
      setTitle('');setFile(null);setCorrFile(null);setVideo('');setFormKey(k=>k+1);
    }catch(e:any){
      notify(e.message,'error');
    }finally{
      setBusy(false);setProgress(null);setCorrProgress(null);
    }
  };

  return <Section title="Publier un sujet" defaultOpen={false}>
    <div className="adm-form" key={formKey}>
      <div className="adm-grid2">
        <div className="field"><label>Classe</label><select className="select" value={classCode} onChange={e=>setClassCode(e.target.value)}>{activeClasses.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
        <div className="field"><label>Matière</label><select className="select" value={subjectId} onChange={e=>setSubjectId(e.target.value)}>{options.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>{!options.length?<small>Ajoute d’abord une matière pour cette classe.</small>:null}</div>
        <div className="field"><label>Année</label><input className="input" type="number" inputMode="numeric" value={year} onChange={e=>setYear(Number(e.target.value))}/></div>
        <div className="field"><label>Session</label><input className="input" value={session} onChange={e=>setSession(e.target.value)} list="exam237-sessions"/><datalist id="exam237-sessions"><option value="Session normale"/><option value="Session de rattrapage"/><option value="Examen blanc"/></datalist></div>
        <div className="field full"><label>Titre</label><input className="input" value={title} onChange={e=>setTitle(e.target.value)} placeholder={suggested||'Mathématiques BEPC 2026'}/><small>Laisse vide pour utiliser « {suggested||'…'} ».</small></div>
        <div className="full"><FilePicker label="PDF du sujet" file={file} onChange={setFile} progress={progress}/></div>
      </div>
      <div className="adm-inline">
        <h4>Correction (facultatif)</h4>
        <FilePicker label="PDF de la correction" file={corrFile} onChange={setCorrFile} progress={corrProgress}/>
        <div className="field"><label>Lien vidéo</label><input className="input" type="url" value={video} onChange={e=>setVideo(e.target.value)} placeholder="https://youtu.be/…"/></div>
      </div>
      <div className="adm-form-actions"><button className="btn btn-primary" disabled={busy||!file||!subjectId} onClick={publish}>{busy?'Publication…':'Publier le sujet'}</button></div>
    </div>
  </Section>;
}

function Subjects({classes,subjects,papers,act}:{classes:any[];subjects:any[];papers:any[];act:Act}){
  const [name,setName]=useState('');const [codes,setCodes]=useState<string[]>([]);const [busy,setBusy]=useState(false);
  const counts=useMemo(()=>{const m:Record<string,number>={};for(const p of papers)m[p.subject_id]=(m[p.subject_id]||0)+1;return m;},[papers]);
  return <Section title="Matières" count={subjects.length} defaultOpen={false}>
    <div className="adm-inline">
      <h4>Ajouter une matière</h4>
      <input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="Ex. Physique-Chimie-Technologie"/>
      <ClassChecks classes={classes} value={codes} onChange={setCodes}/>
      <div className="adm-form-actions"><button className="btn btn-primary btn-sm" disabled={busy||name.trim().length<2||!codes.length} onClick={async()=>{setBusy(true);const r=await act({action:'create_subject',name,classCodes:codes},'Matière ajoutée.');setBusy(false);if(r){setName('');setCodes([]);}}}>Ajouter</button></div>
    </div>
    <div className="adm-list">
      {subjects.map(s=><SubjectRow key={s.id} subject={s} classes={classes} papers={counts[s.id]||0} act={act}/>)}
      {!subjects.length?<div className="adm-empty">Aucune matière.</div>:null}
    </div>
  </Section>;
}

function ClassChecks({classes,value,onChange}:{classes:any[];value:string[];onChange:(v:string[])=>void}){
  return <div className="checks">{classes.map(c=><label className="check" key={c.code}><input type="checkbox" checked={value.includes(c.code)} onChange={e=>onChange(e.target.checked?[...value,c.code]:value.filter(x=>x!==c.code))}/> {c.label}</label>)}</div>;
}

function SubjectRow({subject,classes,papers,act}:{subject:any;classes:any[];papers:number;act:Act}){
  const [editing,setEditing]=useState(false);const [name,setName]=useState(subject.name);const [codes,setCodes]=useState<string[]>(subject.class_codes||[]);const [busy,setBusy]=useState(false);
  const labels=(subject.class_codes||[]).map((code:string)=>classes.find(c=>c.code===code)?.label||code);
  return <div className="adm-child">
    <div className="adm-item-head">
      <div className="adm-item-title"><b>{subject.name}</b><span className="adm-sub">{papers} sujet{papers>1?'s':''}</span></div>
    </div>
    <div className="adm-meta">{labels.map((l:string)=><span className="mini-pill" key={l}>{l}</span>)}</div>
    {editing?<div className="adm-inline">
      <input className="input" value={name} onChange={e=>setName(e.target.value)}/>
      <ClassChecks classes={classes} value={codes} onChange={setCodes}/>
      <div className="adm-form-actions">
        <button className="btn btn-primary btn-sm" disabled={busy||name.trim().length<2||!codes.length} onClick={async()=>{setBusy(true);const r=await act({action:'update_subject',id:subject.id,name,classCodes:codes},'Matière modifiée.');setBusy(false);if(r)setEditing(false);}}>Enregistrer</button>
        <button className="btn btn-light btn-sm" onClick={()=>{setEditing(false);setName(subject.name);setCodes(subject.class_codes||[]);}}>Annuler</button>
      </div>
    </div>:<div className="adm-actions">
      <button className="btn btn-light btn-sm" onClick={()=>setEditing(true)}>Modifier</button>
      <button className="btn btn-danger btn-sm" disabled={busy||papers>0} title={papers?'Des sujets utilisent cette matière':undefined} onClick={()=>{if(confirm(`Supprimer la matière « ${subject.name} » ?`))act({action:'delete_subject',id:subject.id},'Matière supprimée.');}}>Supprimer</button>
    </div>}
  </div>;
}

function PaperCard({paper,corrections,classes,subjects,act,notify}:{paper:any;corrections:any[];classes:any[];subjects:any[];act:Act;notify:Notify}){
  const [editing,setEditing]=useState(false);
  const [adding,setAdding]=useState(false);
  const [busy,setBusy]=useState(false);
  const status=PAPER_STATUS[paper.status]||{label:paper.status,tone:'grey' as const};
  const run=async(body:Record<string,unknown>,message:string)=>{setBusy(true);const r=await act(body,message);setBusy(false);return r;};
  return <article className="adm-item">
    <div className="adm-item-head">
      <div className="adm-item-title"><b>{paper.subject_name} · {paper.exam_year}</b><span className="adm-sub">{paper.title}</span></div>
      <Badge tone={status.tone}>{status.label}</Badge>
    </div>
    <div className="adm-meta"><span className="mini-pill">{paper.class_label}</span><span className="mini-pill">{paper.session_label}</span><span className="mini-pill">Ajouté le {formatDate(paper.created_at)}</span></div>

    {editing?<EditPaper paper={paper} classes={classes} subjects={subjects} act={act} notify={notify} onDone={()=>setEditing(false)}/>
      :<div className="adm-actions">
        <a className="btn btn-light btn-sm" href={`/api/files?kind=paper&id=${encodeURIComponent(paper.id)}`} target="_blank" rel="noopener">Ouvrir le PDF</a>
        <button className="btn btn-light btn-sm" onClick={()=>setEditing(true)}>Modifier</button>
        <button className="btn btn-light btn-sm" disabled={busy} onClick={()=>run({action:'set_paper_status',id:paper.id,status:paper.status==='published'?'archived':'published'},paper.status==='published'?'Sujet archivé : les élèves ne le voient plus.':'Sujet republié.')}>{paper.status==='published'?'Archiver':'Publier'}</button>
        <button className="btn btn-danger btn-sm" disabled={busy} onClick={()=>{if(confirm(`Supprimer définitivement ce sujet et ${corrections.length?`ses ${corrections.length} correction${corrections.length>1?'s':''}`:'ses corrections'} ? Les PDF seront effacés.`))run({action:'delete_paper',id:paper.id},'Sujet supprimé définitivement.');}}>Supprimer</button>
      </div>}

    <div className="adm-children">
      {corrections.map(c=><CorrectionRow key={c.id} correction={c} act={act} notify={notify}/>)}
      {adding?<AddCorrection paperId={paper.id} act={act} notify={notify} onDone={()=>setAdding(false)}/>
        :<div className="adm-actions"><button className="btn btn-light btn-sm" onClick={()=>setAdding(true)}>+ Ajouter une correction</button>{!corrections.length?<span className="adm-sub">Pas encore de correction.</span>:null}</div>}
    </div>
  </article>;
}

function EditPaper({paper,classes,subjects,act,notify,onDone}:{paper:any;classes:any[];subjects:any[];act:Act;notify:Notify;onDone:()=>void}){
  const [classCode,setClassCode]=useState(paper.class_code);
  const [subjectId,setSubjectId]=useState(paper.subject_id);
  const [year,setYear]=useState(Number(paper.exam_year));
  const [session,setSession]=useState(paper.session_label||'Session normale');
  const [title,setTitle]=useState(paper.title||'');
  const [file,setFile]=useState<File|null>(null);
  const [progress,setProgress]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  const options=subjectsForClass(subjects,classCode,paper.subject_id);
  const save=async()=>{
    setBusy(true);
    try{
      let paperUrl:string|undefined;
      if(file){setProgress(0);paperUrl=await uploadPdf(file,'paper',setProgress);}
      const r=await act({action:'update_paper',id:paper.id,classCode,subjectId,year,title,sessionLabel:session,paperUrl},file?'Sujet modifié, PDF remplacé.':'Sujet modifié.');
      if(r)onDone();
    }catch(e:any){notify(e.message,'error');}
    finally{setBusy(false);setProgress(null);}
  };
  return <div className="adm-inline">
    <div className="adm-grid2">
      <div className="field"><label>Classe</label><select className="select" value={classCode} onChange={e=>setClassCode(e.target.value)}>{classes.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
      <div className="field"><label>Matière</label><select className="select" value={subjectId} onChange={e=>setSubjectId(e.target.value)}>{options.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="field"><label>Année</label><input className="input" type="number" inputMode="numeric" value={year} onChange={e=>setYear(Number(e.target.value))}/></div>
      <div className="field"><label>Session</label><input className="input" value={session} onChange={e=>setSession(e.target.value)} list="exam237-sessions"/></div>
      <div className="field full"><label>Titre</label><input className="input" value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="full"><FilePicker label="Remplacer le PDF (facultatif)" file={file} onChange={setFile} progress={progress}/></div>
    </div>
    <div className="adm-form-actions">
      <button className="btn btn-primary btn-sm" disabled={busy||title.trim().length<3} onClick={save}>{busy?'Enregistrement…':'Enregistrer'}</button>
      <button className="btn btn-light btn-sm" disabled={busy} onClick={onDone}>Annuler</button>
    </div>
  </div>;
}

function CorrectionRow({correction,act,notify}:{correction:any;act:Act;notify:Notify}){
  const [editing,setEditing]=useState(false);
  const [title,setTitle]=useState(correction.title||'Correction');
  const [video,setVideo]=useState(correction.video_url||'');
  const [file,setFile]=useState<File|null>(null);
  const [removePdf,setRemovePdf]=useState(false);
  const [progress,setProgress]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  const status=PAPER_STATUS[correction.status]||{label:correction.status,tone:'grey' as const};
  const save=async()=>{
    setBusy(true);
    try{
      let correctionPdfPath:string|undefined;
      if(file){setProgress(0);correctionPdfPath=await uploadPdf(file,'correction',setProgress);}
      const r=await act({action:'update_correction',id:correction.id,title,videoUrl:video.trim(),correctionPdfPath,removePdf:!file&&removePdf},'Correction modifiée.');
      if(r){setEditing(false);setFile(null);setRemovePdf(false);}
    }catch(e:any){notify(e.message,'error');}
    finally{setBusy(false);setProgress(null);}
  };
  return <div className="adm-child">
    <div className="adm-item-head">
      <div className="adm-item-title"><b>{correction.title||'Correction'}</b>
        <span className="adm-sub">{[correction.correction_pdf_path?'PDF':null,correction.video_url?'vidéo':null].filter(Boolean).join(' + ')}</span>
      </div>
      <Badge tone={status.tone}>{status.label}</Badge>
    </div>
    {editing?<div className="adm-inline">
      <div className="field"><label>Titre</label><input className="input" value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="field"><label>Lien vidéo</label><input className="input" type="url" value={video} onChange={e=>setVideo(e.target.value)} placeholder="https://youtu.be/…"/></div>
      <FilePicker label={correction.correction_pdf_path?'Remplacer le PDF (facultatif)':'Ajouter un PDF (facultatif)'} file={file} onChange={setFile} progress={progress}/>
      {correction.correction_pdf_path&&!file?<label className="adm-toggle"><input type="checkbox" checked={removePdf} onChange={e=>setRemovePdf(e.target.checked)}/> Retirer le PDF actuel</label>:null}
      <div className="adm-form-actions">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy?'Enregistrement…':'Enregistrer'}</button>
        <button className="btn btn-light btn-sm" disabled={busy} onClick={()=>{setEditing(false);setTitle(correction.title||'Correction');setVideo(correction.video_url||'');setFile(null);setRemovePdf(false);}}>Annuler</button>
      </div>
    </div>:<div className="adm-actions">
      {correction.correction_pdf_path?<a className="btn btn-light btn-sm" href={`/api/files?kind=correction&id=${encodeURIComponent(correction.id)}`} target="_blank" rel="noopener">PDF</a>:null}
      {correction.video_url?<a className="btn btn-light btn-sm" href={correction.video_url} target="_blank" rel="noopener noreferrer">▶ Vidéo</a>:null}
      <button className="btn btn-light btn-sm" onClick={()=>setEditing(true)}>Modifier</button>
      <button className="btn btn-light btn-sm" disabled={busy} onClick={async()=>{setBusy(true);await act({action:'set_correction_status',id:correction.id,status:correction.status==='published'?'archived':'published'},correction.status==='published'?'Correction archivée.':'Correction republiée.');setBusy(false);}}>{correction.status==='published'?'Archiver':'Publier'}</button>
      <button className="btn btn-danger btn-sm" disabled={busy} onClick={()=>{if(confirm('Supprimer définitivement cette correction ?'))act({action:'delete_correction',id:correction.id},'Correction supprimée.');}}>Supprimer</button>
    </div>}
  </div>;
}

function AddCorrection({paperId,act,notify,onDone}:{paperId:string;act:Act;notify:Notify;onDone:()=>void}){
  const [title,setTitle]=useState('Correction');
  const [video,setVideo]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [progress,setProgress]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  const save=async()=>{
    if(!file&&!video.trim())return notify('Ajoute un PDF ou un lien vidéo.','error');
    setBusy(true);
    try{
      const correctionPdfPath=file?(setProgress(0),await uploadPdf(file,'correction',setProgress)):null;
      const r=await act({action:'add_correction',paperId,title,videoUrl:video.trim(),correctionPdfPath},'Correction publiée.');
      if(r)onDone();
    }catch(e:any){notify(e.message,'error');}
    finally{setBusy(false);setProgress(null);}
  };
  return <div className="adm-inline">
    <h4>Nouvelle correction</h4>
    <div className="field"><label>Titre</label><input className="input" value={title} onChange={e=>setTitle(e.target.value)}/></div>
    <FilePicker label="PDF de la correction" file={file} onChange={setFile} progress={progress}/>
    <div className="field"><label>Lien vidéo (facultatif)</label><input className="input" type="url" value={video} onChange={e=>setVideo(e.target.value)} placeholder="https://youtu.be/…"/></div>
    <div className="adm-form-actions">
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy?'Publication…':'Publier la correction'}</button>
      <button className="btn btn-light btn-sm" disabled={busy} onClick={onDone}>Annuler</button>
    </div>
  </div>;
}
