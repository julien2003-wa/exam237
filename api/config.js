import { json } from '../lib/http.js';
export default function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Méthode non autorisée'});
  return json(res,200,{whatsappNumber:String(process.env.PUBLIC_WHATSAPP_NUMBER||'').replace(/\D/g,''),annualPriceFcfa:String(process.env.ANNUAL_PRICE_FCFA||'')});
}
