import { json } from '../../lib/http.js';
import { requireAdmin } from '../../lib/security.js';
export default async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Méthode non autorisée'});
  const s=await requireAdmin(req); if(!s) return json(res,401,{error:'Non connecté'});
  return json(res,200,{ok:true,email:process.env.ADMIN_EMAIL||''});
}
