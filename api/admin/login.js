import { json, readJson } from '../../lib/http.js';
import { constantTimeEqual, createSession, normalizeEmail } from '../../lib/security.js';

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Méthode non autorisée'});
  try{
    const body=await readJson(req);
    const email=normalizeEmail(body.email); const password=String(body.password||'');
    const expectedEmail=normalizeEmail(process.env.ADMIN_EMAIL); const expectedPassword=String(process.env.ADMIN_PASSWORD||'');
    if(!expectedEmail||!expectedPassword||!constantTimeEqual(email,expectedEmail)||!constantTimeEqual(password,expectedPassword)) return json(res,401,{error:'Identifiants administrateur incorrects.'});
    await createSession(res,{role:'admin',userId:null,days:7});
    return json(res,200,{ok:true});
  }catch(e){console.error(e);return json(res,500,{error:'Connexion administrateur impossible.'});}
}
