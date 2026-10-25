'use client';
import { useMemo, useState } from 'react';
import { Badge, Section, type Act } from './shared';

export default function Organisation({data,act}:{data:any;act:Act}){
  const groups:any[]=data.groups||[];
  const classes:any[]=data.classes||[];
  const users:any[]=data.users||[];
  const papers:any[]=data.papers||[];

  const usage=useMemo(()=>{
    const students:Record<string,number>={},paperCount:Record<string,number>={};
    for(const u of users)if(u.classCode)students[u.classCode]=(students[u.classCode]||0)+1;
    for(const p of papers)paperCount[p.class_code]=(paperCount[p.class_code]||0)+1;
    return {students,papers:paperCount};
  },[users,papers]);

  const orphanClasses=classes.filter(c=>!c.group_id||!groups.some(g=>g.id===c.group_id));

  return <div className="adm-stack">
    <NewGroup act={act}/>
    <NewClass groups={groups} act={act}/>
    <Section title="Organisation actuelle" count={`${groups.length} groupe${groups.length>1?'s':''} · ${classes.length} classe${classes.length>1?'s':''}`}>
      <p className="adm-note">Les classes d’un même groupe partagent les sujets et le chat. Une classe désactivée disparaît du formulaire d’inscription sans toucher aux élèves déjà inscrits.</p>
      <div className="adm-list">
        {groups.map(g=><GroupCard key={g.id} group={g} groups={groups} classes={classes.filter(c=>c.group_id===g.id)} usage={usage} act={act}/>)}
        {orphanClasses.length?<article className="adm-item">
          <div className="adm-item-title"><b>Classes sans groupe</b><span className="adm-sub">Rattache-les à un groupe pour leur donner sujets et chat.</span></div>
          <div className="adm-children">{orphanClasses.map(c=><ClassRow key={c.code} cls={c} groups={groups} usage={usage} act={act}/>)}</div>
        </article>:null}
        {!groups.length?<div className="adm-empty">Aucun groupe pour l’instant.</div>:null}
      </div>
    </Section>
  </div>;
}

function NewGroup({act}:{act:Act}){
  const [label,setLabel]=useState('');const [examType,setExamType]=useState('BEPC');const [busy,setBusy]=useState(false);
  return <Section title="Nouveau groupe" defaultOpen={false}>
    <div className="adm-form">
      <div className="adm-grid2">
        <div className="field"><label>Nom du groupe</label><input className="input" value={label} onChange={e=>setLabel(e.target.value)} placeholder="Ex. Seconde C / D"/></div>
        <div className="field"><label>Examen</label><input className="input" value={examType} onChange={e=>setExamType(e.target.value)} placeholder="BEPC, PROBATOIRE, BAC…"/></div>
      </div>
      <div className="adm-form-actions"><button className="btn btn-primary" disabled={busy||label.trim().length<2} onClick={async()=>{setBusy(true);const r=await act({action:'create_group',label,examType},'Groupe créé avec son chat.');setBusy(false);if(r)setLabel('');}}>Créer le groupe + son chat</button></div>
    </div>
  </Section>;
}

function NewClass({groups,act}:{groups:any[];act:Act}){
  const [label,setLabel]=useState('');const [code,setCode]=useState('');const [groupId,setGroupId]=useState(groups[0]?.id||'');const [series,setSeries]=useState('');const [busy,setBusy]=useState(false);
  const selectedGroup=groups.find(g=>g.id===groupId)||groups[0];
  return <Section title="Nouvelle classe" defaultOpen={false}>
    <div className="adm-form">
      <div className="adm-grid2">
        <div className="field"><label>Nom</label><input className="input" value={label} onChange={e=>setLabel(e.target.value)} placeholder="Seconde C"/></div>
        <div className="field"><label>Code (facultatif)</label><input className="input" value={code} onChange={e=>setCode(e.target.value)} placeholder="2C"/><small>Lettres et chiffres, unique. Ne peut plus être changé.</small></div>
        <div className="field"><label>Groupe</label><select className="select" value={selectedGroup?.id||''} onChange={e=>setGroupId(e.target.value)}>{groups.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select></div>
        <div className="field"><label>Série (facultatif)</label><input className="input" value={series} onChange={e=>setSeries(e.target.value)} placeholder="C"/></div>
      </div>
      <div className="adm-form-actions"><button className="btn btn-primary" disabled={busy||label.trim().length<2||!selectedGroup} onClick={async()=>{setBusy(true);const r=await act({action:'create_class',label,code,groupId:selectedGroup?.id,series,examType:selectedGroup?.exam_type||'AUTRE'},'Classe créée : elle apparaît à l’inscription.');setBusy(false);if(r){setLabel('');setCode('');setSeries('');}}}>Créer la classe</button></div>
    </div>
  </Section>;
}

function GroupCard({group,groups,classes,usage,act}:{group:any;groups:any[];classes:any[];usage:{students:Record<string,number>;papers:Record<string,number>};act:Act}){
  const [editing,setEditing]=useState(false);
  const [label,setLabel]=useState(group.label);const [examType,setExamType]=useState(group.exam_type||'AUTRE');
  const [busy,setBusy]=useState(false);
  const studentCount=classes.reduce((n,c)=>n+(usage.students[c.code]||0),0);
  return <article className="adm-item">
    <div className="adm-item-head">
      <div className="adm-item-title"><b>{group.label}</b><span className="adm-sub">{group.code} · {group.exam_type} · {classes.length} classe{classes.length>1?'s':''} · {studentCount} élève{studentCount>1?'s':''}</span></div>
      {group.active===false?<Badge tone="grey">Inactif</Badge>:null}
    </div>
    {editing?<div className="adm-inline">
      <div className="adm-grid2">
        <div className="field"><label>Nom du groupe</label><input className="input" value={label} onChange={e=>setLabel(e.target.value)}/></div>
        <div className="field"><label>Examen</label><input className="input" value={examType} onChange={e=>setExamType(e.target.value)}/></div>
      </div>
      <small className="adm-sub">Le nom du chat du groupe change aussi.</small>
      <div className="adm-form-actions">
        <button className="btn btn-primary btn-sm" disabled={busy||label.trim().length<2} onClick={async()=>{setBusy(true);const r=await act({action:'update_group',id:group.id,label,examType},'Groupe modifié.');setBusy(false);if(r)setEditing(false);}}>Enregistrer</button>
        <button className="btn btn-light btn-sm" onClick={()=>{setEditing(false);setLabel(group.label);setExamType(group.exam_type||'AUTRE');}}>Annuler</button>
      </div>
    </div>:<div className="adm-actions">
      <button className="btn btn-light btn-sm" onClick={()=>setEditing(true)}>Modifier</button>
      <button className="btn btn-danger btn-sm" disabled={busy||classes.length>0} title={classes.length?'Déplace ou supprime d’abord ses classes':undefined}
        onClick={()=>{if(confirm(`Supprimer le groupe « ${group.label} » et tout son chat ? Cette action est irréversible.`))act({action:'delete_group',id:group.id},'Groupe supprimé.');}}>Supprimer</button>
      {classes.length?<span className="adm-sub">Suppression possible une fois le groupe vide.</span>:null}
    </div>}
    {classes.length?<div className="adm-children">{classes.map(c=><ClassRow key={c.code} cls={c} groups={groups} usage={usage} act={act}/>)}</div>:<span className="adm-sub">Aucune classe dans ce groupe.</span>}
  </article>;
}

function ClassRow({cls,groups,usage,act}:{cls:any;groups:any[];usage:{students:Record<string,number>;papers:Record<string,number>};act:Act}){
  const [editing,setEditing]=useState(false);
  const [label,setLabel]=useState(cls.label);const [groupId,setGroupId]=useState(cls.group_id||groups[0]?.id||'');const [series,setSeries]=useState(cls.series||'');
  const [busy,setBusy]=useState(false);
  const students=usage.students[cls.code]||0, papers=usage.papers[cls.code]||0;
  const run=async(body:Record<string,unknown>,message:string)=>{setBusy(true);const r=await act(body,message);setBusy(false);return r;};
  return <div className="adm-child">
    <div className="adm-item-head">
      <div className="adm-item-title"><b>{cls.label}</b><span className="adm-sub">{cls.code}{cls.series?` · série ${cls.series}`:''} · {students} élève{students>1?'s':''} · {papers} sujet{papers>1?'s':''}</span></div>
      {cls.active?<Badge tone="green">Inscriptions ouvertes</Badge>:<Badge tone="grey">Désactivée</Badge>}
    </div>
    {editing?<div className="adm-inline">
      <div className="adm-grid2">
        <div className="field"><label>Nom</label><input className="input" value={label} onChange={e=>setLabel(e.target.value)}/></div>
        <div className="field"><label>Série</label><input className="input" value={series} onChange={e=>setSeries(e.target.value)}/></div>
        <div className="field full"><label>Groupe</label><select className="select" value={groupId} onChange={e=>setGroupId(e.target.value)}>{groups.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select>
          {groupId!==cls.group_id&&students?<small>Ses {students} élève{students>1?'s':''} passeront dans le chat et les sujets du nouveau groupe.</small>:null}</div>
      </div>
      <div className="adm-form-actions">
        <button className="btn btn-primary btn-sm" disabled={busy||label.trim().length<2||!groupId} onClick={async()=>{const r=await run({action:'update_class',code:cls.code,label,groupId,series},'Classe modifiée.');if(r)setEditing(false);}}>Enregistrer</button>
        <button className="btn btn-light btn-sm" onClick={()=>{setEditing(false);setLabel(cls.label);setGroupId(cls.group_id||'');setSeries(cls.series||'');}}>Annuler</button>
      </div>
    </div>:<div className="adm-actions">
      <button className="btn btn-light btn-sm" onClick={()=>setEditing(true)}>Modifier</button>
      <button className="btn btn-light btn-sm" disabled={busy} onClick={()=>run({action:'set_class_active',code:cls.code,active:!cls.active},cls.active?'Classe désactivée : elle n’apparaît plus à l’inscription.':'Classe réactivée.')}>{cls.active?'Désactiver':'Réactiver'}</button>
      <button className="btn btn-danger btn-sm" disabled={busy||students>0||papers>0} title={students||papers?'Utilisée par des élèves ou des sujets':undefined}
        onClick={()=>{if(confirm(`Supprimer définitivement la classe « ${cls.label} » ?`))run({action:'delete_class',code:cls.code},'Classe supprimée.');}}>Supprimer</button>
    </div>}
  </div>;
}
