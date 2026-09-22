import { db } from '../lib/db.js';
import { json } from '../lib/http.js';

export default async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Méthode non autorisée'});
  try{
    const sql=db();
    const rows=await sql`SELECT code,label,exam_type,series FROM ex237_classes WHERE active=TRUE ORDER BY display_order,label`;
    return json(res,200,{
      classes:rows,
      whatsappNumber:String(process.env.PUBLIC_WHATSAPP_NUMBER||'').replace(/\D/g,'')
    });
  }catch(e){
    console.error(e);
    return json(res,500,{error:'Configuration indisponible.'});
  }
}
