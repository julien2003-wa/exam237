import { NextResponse, type NextRequest } from 'next/server';
import { closedPage, getClosure } from '@/lib/closure';

// Site fermé par l'admin : toutes les pages affichent « Exam237 est fermé pour le moment »,
// sauf l'administration (et la page de connexion quand elle y mène). Les API ne passent pas
// par ici : chacune refuse elle-même les élèves avec la vraie session (lib/closure-guard.ts),
// ce qui garde toujours l'accès à l'admin. Site ouvert : rien ne change.

// Chaque serveur garde l'état 10 secondes : les boutons de l'admin agissent partout en moins de 10 s.
const MEMO_MS = 10_000;
let memo: { closed: boolean | null; at: number } | null = null;

// État lu sur /api/site-state, gardé en cache par Vercel : les simples visiteurs ne réveillent
// pas la base. null = état inconnu (pas de réponse valable) : la base décide alors.
async function cachedClosed(req: NextRequest): Promise<boolean | null> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.closed;
  let closed: boolean | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(new URL('/api/site-state', req.nextUrl.origin), {
      // Les aperçus Vercel protégés demandent le cookie du visiteur.
      headers: { cookie: req.headers.get('cookie') || '' },
      signal: controller.signal,
    });
    if (res.ok) {
      const data: any = await res.json();
      if (typeof data?.closed === 'boolean') closed = data.closed;
    }
  } catch {
    // Réponse absente : la base décide (ci-dessous).
  } finally {
    clearTimeout(timer);
  }
  memo = { closed, at: Date.now() };
  return closed;
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (pathname.startsWith('/api/')) return NextResponse.next();

  // « Fermé » est toujours confirmé dans la base : un cache en retard ne peut jamais bloquer
  // la réouverture du site. État inconnu : la base décide aussi.
  const cached = await cachedClosed(req);
  const closed = cached === false ? false : (await getClosure()).closed;
  if (!closed) return NextResponse.next();

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
  // Fichiers fixes (scripts, images, icônes, appli installable, lecteur PDF) et API : jamais ici.
  matcher: [
    '/((?!api/|_next/|favicon\\.ico|icons/|apercu/|pdfjs/|logo\\.png|og\\.png|manifest\\.webmanifest|sw\\.js|offline\\.html|robots\\.txt).*)',
  ],
};
