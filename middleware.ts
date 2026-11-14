import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE } from '@/lib/cookies';
import { CLOSED_MESSAGE, closedPage, getClosure, isAdminSession } from '@/lib/closure';

// Site fermé par l'admin : toutes les pages affichent « Exam237 est fermé pour le moment »,
// sauf l'administration (et la page de connexion quand elle y mène). Les données des élèves
// (API) sont refusées ; l'admin connecté garde tout. Site ouvert : rien ne change.
export async function middleware(req: NextRequest) {
  const closure = await getClosure();
  if (!closure.closed) return NextResponse.next();

  const { pathname, searchParams } = req.nextUrl;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return NextResponse.next();
  if (pathname === '/connexion' && (searchParams.get('next') || '').startsWith('/admin'))
    return NextResponse.next();
  // La connexion applique elle-même la fermeture : seul l'admin peut se connecter.
  if (pathname === '/api/auth') return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    if (await isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.next();
    return NextResponse.json(
      { error: CLOSED_MESSAGE, closed: true },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3600' } }
    );
  }

  // 503 : Google comprend que la fermeture est temporaire.
  return new NextResponse(closedPage(), {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '3600',
    },
  });
}

export const config = {
  // Fichiers fixes (scripts, images, icônes, appli installable, lecteur PDF) : jamais bloqués.
  matcher: [
    '/((?!_next/|favicon\\.ico|icons/|apercu/|pdfjs/|logo\\.png|og\\.png|manifest\\.webmanifest|sw\\.js|offline\\.html|robots\\.txt).*)',
  ],
};
