'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Badge, formatDate, Section, type Act, type Notify } from './shared';

const MODES=[
  {id:'mention',label:'Sur demande',help:'L’assistant répond quand un élève écrit @assistant (bouton 🎓 dans le chat) ou répond à un de ses messages.'},
  {id:'auto',label:'Automatique',help:'Il répond aussi aux questions de cours posées dans le chat, sans mention. Il ignore les bavardages.'},
  {id:'off',label:'Désactivé',help:'Plus aucune réponse automatique.'}
];

const STATUS:Record<string,{label:string;tone:'green'|'gold'|'red'|'grey'|'blue'}>={
  answered:{label:'Répondu',tone:'green'},
  pending:{label:'En cours',tone:'blue'},
  error:{label:'Erreur',tone:'red'},
  limited:{label:'Limite atteinte',tone:'gold'},
  skipped:{label:'Ignoré',tone:'grey'}
};

const TRIGGERS:Record<string,string>={mention:'@assistant',followup:'suite de conversation',auto:'automatique',admin:'demandé par l’admin'};

function money(value:number|null|undefined){
  if(value===null||value===undefined)return '—';
  if(value>0&&value<0.01)return '<\u00a00,01\u00a0$US';
  return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value).replace(/\s/g,'\u00a0');
}

export default function Assistant({data,act,notify}:{data:any;act:Act;notify:Notify}){
  const [overview,setOverview]=useState<any>(null);
  const [error,setError]=useState<string|null>(null);
  const [mode,setMode]=useState('mention');
  const [limit,setLimit]=useState(15);
  const [saving,setSaving]=useState(false);
  const [question,setQuestion]=useState('');
  const [groupLabel,setGroupLabel]=useState('');
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState<any>(null);
  const [expanded,setExpanded]=useState<string|null>(null);

  const load=useCallback(async()=>{
    try{
      const d=await api('/api/data?action=admin_assistant');
      setOverview(d);setMode(d.settings?.mode||'mention');setLimit(d.settings?.dailyLimit||15);setError(null);
    }catch(e:any){setError(e.message);}
  },[]);
  useEffect(()=>{load();},[load]);

  const save=async()=>{
    setSaving(true);
    const r=await act({action:'assistant_settings',mode,dailyLimit:limit},'Réglages de l’assistant enregistrés.');
    setSaving(false);
    if(r)load();
  };

  const test=async()=>{
    setTesting(true);setTestResult(null);
    try{
      const r=await api('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assistant_test',question,groupLabel})});
      setTestResult(r);
    }catch(e:any){notify(e.message,'error');}
    finally{setTesting(false);}
  };

  const configured=overview?overview.configured:data.assistantConfigured;
  const stats=overview?.stats||{};

  return <div className="adm-stack">
    {!configured?<article className="card adm-section"><div className="adm-section-body" style={{paddingTop:14}}>
      <p className="adm-note warn"><b>L’assistant n’est pas encore branché.</b> Il lui faut une clé API Claude (payante à l’usage, de l’ordre de quelques dixièmes de centime par réponse avec le modèle Haiku).</p>
      <ol className="adm-sub" style={{margin:0,paddingLeft:18,display:'grid',gap:6}}>
        <li>Sur <a className="text-link" href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">platform.claude.com/settings/keys</a>, clique « Create key », rattache-la à un espace de travail (workspace) et copie la clé (elle commence par sk-ant-).</li>
        <li>Dans la Console, vérifie la facturation (Billing) pour que la clé puisse être utilisée.</li>
        <li>Dans Vercel : ton projet → Settings → Environment Variables → ajoute <b>ANTHROPIC_API_KEY</b> (Production et Preview), puis redéploie.</li>
      </ol>
    </div></article>:null}

    {error?<p className="adm-note error">{error}</p>:null}

    <div className="adm-stats" style={{marginBottom:0}}>
      <div className="adm-stat"><b>{stats.day??'—'}</b><small>questions (24 h)</small></div>
      <div className="adm-stat"><b>{stats.week??'—'}</b><small>questions (7 j)</small></div>
      <div className="adm-stat"><b>{stats.monthAnswered??'—'}</b><small>réponses (30 j)</small></div>
      <div className={`adm-stat ${stats.weekErrors?'danger':''}`}><b>{stats.weekErrors??'—'}</b><small>erreurs (7 j)</small></div>
      <div className="adm-stat"><b>{stats.weekLimited??'—'}</b><small>limites (7 j)</small></div>
      <div className="adm-stat"><b style={{fontSize:'1rem'}}>{overview?money(stats.monthCostUsd):'—'}</b><small>coût estimé (30 j)</small></div>
    </div>

    <Section title="Réglages" actions={<Badge tone={configured?'green':'gold'}>{configured?`Clé OK · ${overview?.model||'…'}`:'Clé manquante'}</Badge>}>
      <div className="adm-radio">
        {MODES.map(m=><label key={m.id} className={mode===m.id?'active':''}>
          <input type="radio" name="assistant-mode" value={m.id} checked={mode===m.id} onChange={()=>setMode(m.id)}/>
          <span><b>{m.label}</b><small>{m.help}</small></span>
        </label>)}
      </div>
      <div className="field" style={{maxWidth:280}}>
        <label>Questions par élève et par jour</label>
        <input className="input" type="number" inputMode="numeric" min={1} max={200} value={limit} onChange={e=>setLimit(Number(e.target.value))}/>
        <small>Au-delà, l’élève est invité à revenir le lendemain.</small>
      </div>
      <div className="adm-form-actions"><button className="btn btn-primary" disabled={saving||!overview} onClick={save}>{saving?'Enregistrement…':'Enregistrer'}</button></div>
    </Section>

    <Section title="Tester l’assistant" defaultOpen={false}>
      <p className="adm-sub" style={{margin:0}}>La réponse s’affiche ici seulement : rien n’est publié dans le chat.</p>
      <textarea className="textarea" rows={3} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ex. Comment résoudre l’équation 3x − 5 = 2x + 7 ?"/>
      <select className="select" value={groupLabel} onChange={e=>setGroupLabel(e.target.value)} aria-label="Groupe">
        <option value="">Sans groupe précis</option>
        {(data.groups||[]).map((g:any)=><option key={g.id} value={g.label}>{g.label}</option>)}
      </select>
      <div className="adm-form-actions"><button className="btn btn-primary" disabled={testing||!configured||question.trim().length<3} onClick={test}>{testing?'L’assistant réfléchit…':'Tester'}</button></div>
      {testResult?<div className="adm-stack">
        <blockquote className="adm-quote green">{testResult.answer}</blockquote>
        <span className="adm-sub">{testResult.model} · {testResult.inputTokens+testResult.outputTokens} jetons · {money(testResult.costUsd)}</span>
      </div>:null}
    </Section>

    <Section title="Dernières questions" count={overview?.recent?.length??0} actions={<button className="btn btn-light btn-sm" onClick={load}>↻</button>}>
      <p className="adm-note">Les élèves écrivent <b>@assistant</b> suivi de leur question (ou touchent 🎓 dans le chat). Toi, tu peux aussi appuyer sur n’importe quel message du chat puis sur 🎓 pour faire répondre l’assistant.</p>
      <div className="adm-list">
        {(overview?.recent||[]).map((r:any)=>{
          const s=STATUS[r.status]||{label:r.status,tone:'grey' as const};
          const open=expanded===r.id;
          return <article key={r.id} className="adm-item">
            <div className="adm-item-head">
              <div className="adm-item-title"><b>{r.studentName}{r.groupLabel?` · ${r.groupLabel}`:''}</b><span className="adm-sub">{formatDate(r.createdAt,true)} · {TRIGGERS[r.trigger]||r.trigger}{r.costUsd?` · ${money(r.costUsd)}`:''}</span></div>
              <Badge tone={s.tone}>{s.label}</Badge>
            </div>
            {r.question?<blockquote className="adm-quote">{open||r.question.length<=220?r.question:`${r.question.slice(0,220)}…`}</blockquote>:<span className="adm-sub">Question supprimée du chat.</span>}
            {r.answer&&open?<blockquote className="adm-quote green">{r.answer}</blockquote>:null}
            {r.error?<span className="adm-sub">⚠️ {r.error}</span>:null}
            {r.answer||(r.question&&r.question.length>220)?<div className="adm-actions"><button className="btn btn-light btn-sm" onClick={()=>setExpanded(open?null:r.id)}>{open?'Réduire':'Voir la réponse'}</button></div>:null}
          </article>;
        })}
        {overview&&!overview.recent?.length?<div className="adm-empty">Aucune question pour l’instant.</div>:null}
        {!overview&&!error?<div className="adm-empty">Chargement…</div>:null}
      </div>
    </Section>
  </div>;
}
