import { json } from '../../lib/http.js';
import { requireUser, premiumActive } from '../../lib/security.js';
export default async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Méthode non autorisée'});
  const s=await requireUser(req);
  if(!s) return json(res,401,{error:'Non connecté'});
  return json(res,200,{user:{id:s.user_id,email:s.email,displayName:s.display_name||'',classCode:s.class_code||'',premiumUntil:s.premium_until,premiumActive:premiumActive(s)}});
}
