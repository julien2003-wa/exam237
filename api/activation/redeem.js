import { db } from '../../lib/db.js';
import { json, readJson } from '../../lib/http.js';
import { requireUser, sha256 } from '../../lib/security.js';

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Méthode non autorisée'});
  const s=await requireUser(req); if(!s) return json(res,401,{error:'Non connecté'});
  try{
    const body=await readJson(req); const raw=String(body.code||'').trim();
    if(raw.length<10) return json(res,400,{error:'Clé invalide.'});
    const exact=sha256(raw), upper=sha256(raw.toUpperCase()); const sql=db();
    const rows=await sql`
      WITH redeemed AS (
        UPDATE jl_activation_keys
        SET status='redeemed', redeemed_at=NOW(), redeemed_by=${s.user_id}
        WHERE code_hash IN (${exact},${upper})
          AND status='available'
          AND plan='annual'
          AND (assigned_email IS NULL OR LOWER(assigned_email)=LOWER(${s.email}))
        RETURNING duration_days
      )
      UPDATE jl_users
      SET premium_until=GREATEST(COALESCE(premium_until,NOW()),NOW()) + ((SELECT duration_days FROM redeemed) * INTERVAL '1 day'),
          last_plan='annual', updated_at=NOW()
      WHERE id=${s.user_id} AND EXISTS(SELECT 1 FROM redeemed)
      RETURNING premium_until
    `;
    if(!rows[0]) return json(res,400,{error:'Cette clé est invalide, déjà utilisée ou attribuée à une autre adresse email.'});
    return json(res,200,{ok:true,premiumUntil:rows[0].premium_until});
  }catch(e){console.error(e);return json(res,500,{error:'Activation impossible.'});}
}
