import { get, put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getViewer, isActiveStudent } from '@/lib/auth';

const MAX_PDF_BYTES=6*1024*1024;
const fail=(message:string,status=400)=>NextResponse.json({error:message},{status});

async function storedResponse(pathname:string|null|undefined){
  if(!pathname)return fail('Fichier introuvable.',404);
  if(/^https?:\/\//i.test(pathname))return NextResponse.redirect(pathname,302);
  const result=await get(pathname,{access:'private'});
  if(!result||result.statusCode!==200)return fail('Fichier introuvable.',404);
  const headers=new Headers({
    'Content-Type':result.blob?.contentType||'application/pdf',
    'Content-Disposition':'inline',
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff'
  });
  return new NextResponse(result.stream as any,{status:200,headers});
}

export async function GET(req:NextRequest){
  const viewer=await getViewer(req);
  if(!viewer)return fail('Non connecté.',401);
  const kind=req.nextUrl.searchParams.get('kind');
  const id=String(req.nextUrl.searchParams.get('id')||'');
  if(!id||!['paper','correction'].includes(String(kind)))return fail('Fichier invalide.');
  const sql=db();

  if(kind==='paper'){
    const rows=await sql`
      SELECT p.paper_url,p.status,c.group_id
      FROM ex237_papers p JOIN ex237_classes c ON c.code=p.class_code
      WHERE p.id=${id} LIMIT 1`;
    const p:any=rows[0];
    if(!p||p.status!=='published')return fail('Sujet introuvable.',404);
    if(viewer.role!=='admin'){
      if(!isActiveStudent(viewer))return fail('Compte non actif.',403);
      if(!viewer.groupId||viewer.groupId!==p.group_id)return fail('Ce sujet n’appartient pas à ta classe.',403);
    }
    return storedResponse(p.paper_url);
  }

  const rows=await sql`
    SELECT cor.correction_pdf_path,cor.status AS correction_status,p.status AS paper_status,c.group_id
    FROM ex237_corrections cor JOIN ex237_papers p ON p.id=cor.paper_id JOIN ex237_classes c ON c.code=p.class_code
    WHERE cor.id=${id} LIMIT 1`;
  const c:any=rows[0];
  if(!c||c.correction_status!=='published'||c.paper_status!=='published')return fail('Correction introuvable.',404);
  if(viewer.role!=='admin'){
    if(!isActiveStudent(viewer))return fail('Compte non actif.',403);
    if(!viewer.groupId||viewer.groupId!==c.group_id)return fail('Cette correction n’appartient pas à ta classe.',403);
  }
  return storedResponse(c.correction_pdf_path);
}

export async function PUT(req:NextRequest){
  const viewer=await getViewer(req);
  if(!viewer||viewer.role!=='admin')return fail('Non autorisé.',403);
  const kind=String(req.nextUrl.searchParams.get('kind')||'');
  if(!['paper','correction'].includes(kind))return fail('Type de fichier invalide.');
  const type=String(req.headers.get('content-type')||'').toLowerCase();
  if(!type.includes('application/pdf'))return fail('Seuls les PDF sont acceptés.');
  const raw=Buffer.from(await req.arrayBuffer());
  if(!raw.length)return fail('Fichier vide.');
  if(raw.length>MAX_PDF_BYTES)return fail('PDF trop volumineux. Maximum : 6 Mo.');
  let filename=decodeURIComponent(req.headers.get('x-filename')||'document.pdf').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-120)||'document.pdf';
  if(!filename.toLowerCase().endsWith('.pdf'))filename+='.pdf';
  const blob=await put(`exam237/${kind}/${Date.now()}-${filename}`,raw,{access:'private',contentType:'application/pdf',addRandomSuffix:true});
  return NextResponse.json({ok:true,pathname:blob.pathname,size:raw.length},{status:201});
}
