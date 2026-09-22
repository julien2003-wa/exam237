import { json } from '../../lib/http.js';
import { destroySession } from '../../lib/security.js';
export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Méthode non autorisée'});
  try{ await destroySession(req,res); return json(res,200,{ok:true}); }
  catch(e){ console.error(e); return json(res,500,{error:'Déconnexion impossible.'}); }
}
