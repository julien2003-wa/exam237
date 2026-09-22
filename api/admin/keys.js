import crypto from 'node:crypto';
import { db } from '../../lib/db.js';
import { json, readJson } from '../../lib/http.js';
import { generateActivationCode, isEmail, normalizeEmail, requireAdmin, sha256 } from '../../lib/security.js';

export default async function handler(req,res){
  const admin=await requireAdmin(req); if(!admin) return json(res,401,{error:'Non autorisé'});
  const sql=db();
  if(req.method==='GET'){
    try{const rows=await sql`SELECT id,code_hint,assigned_email,plan,duration_days,order_ref,status,note,created_at,redeemed_at,revoked_at FROM jl_activation_keys ORDER BY created_at DESC LIMIT 200`;return json(res,200,{keys:rows});}
    catch(e){console.error(e);return json(res,500,{error:'Impossible de charger les clés.'});}
  }
  if(req.method==='POST'){
    try{
      const body=await readJson(req); const email=normalizeEmail(body.email); const orderRef=String(body.orderRef||'').trim()||null; const note=String(body.note||'').trim()||null;
      if(!isEmail(email)) return json(res,400,{error:'Email invalide.'});
      const existing=await sql`SELECT id FROM jl_activation_keys WHERE LOWER(assigned_email)=LOWER(${email}) AND status='available' LIMIT 1`;
      if(existing[0]) return json(res,409,{error:'Une clé non utilisée existe déjà pour cette adresse email.'});
      const code=generateActivationCode(); const normalized=code.toUpperCase(); const hint=normalized.slice(0,11)+'…'+normalized.slice(-4);
      await sql`INSERT INTO jl_activation_keys(id,code_hash,code_hint,assigned_email,plan,duration_days,order_ref,status,note,created_at,created_by) VALUES(${crypto.randomUUID()},${sha256(normalized)},${hint},${email},'annual',365,${orderRef},'available',${note},NOW(),${process.env.ADMIN_EMAIL||'exam237-admin'})`;
      return json(res,201,{ok:true,code,email,durationDays:365});
    }catch(e){console.error(e);return json(res,500,{error:'Impossible de générer la clé.'});}
  }
  return json(res,405,{error:'Méthode non autorisée'});
}
