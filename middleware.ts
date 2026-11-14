import { NextResponse, type NextRequest } from 'next/server';
import { closedPage, getClosure } from '@/lib/closure';

// Site fermé par l'admin : toutes les pages affichent « Exam237 est fermé pour le moment »,
// sauf l'administration (et la page de connexion quand elle y mène). Les API ne passent pas
// par ici : chacune refuse elle-même les élèves avec la vraie session (lib/closure-guard.ts),
// ce qui garde toujours l'accès à l'admin. Site ouvert : rien ne change.
export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (pathname.startsWith('/api/')) return NextResponse.next();

  const closure = await getClosure();
  if (!closure.closed) return NextResponse.next();

  if (pathname === '/admin' || pathname.startsWith('/admin/')) return NextResponse.next();
  if (pathname === '/connexion' && (searchParams.get('next') || '').startsWith('/admin'))
    return NextResponse.next();

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
