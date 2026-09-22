import { db } from '../../lib/db.js';
import { json, readJson } from '../../lib/http.js';
import { requireUser } from '../../lib/security.js';
export default async function handler(req,res){
  const s=await requireUser(req); if(!s) return json(res,401,{error:'Non connecté'});
  if(req.method!=='POST') return json(res,405,{error:'Méthode non autorisée'});
  try{
    const body=await readJson(req); const displayName=String(body.displayName||'').trim(); const classCode=String(body.classCode||'').trim().toUpperCase();
    if(displayName.length<2||!classCode) return json(res,400,{error:'Nom et classe requis.'});
    const sql=db(); const cls=await sql`SELECT code FROM ex237_classes WHERE code=${classCode} AND active=TRUE LIMIT 1`;
    if(!cls[0]) return json(res,400,{error:'Classe invalide.'});
    await sql`INSERT INTO ex237_user_profiles(user_id,display_name,class_code,updated_at) VALUES(${s.user_id},${displayName},${classCode},NOW()) ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,class_code=EXCLUDED.class_code,updated_at=NOW()`;
    return json(res,200,{ok:true});
  }catch(e){console.error(e);return json(res,500,{error:'Profil non enregistré.'});}
}
