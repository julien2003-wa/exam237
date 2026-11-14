import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from './auth';
import { CLOSED_MESSAGE, getClosure } from './closure';

// Site fermé par l'admin : chaque API refuse tout le monde sauf l'admin connecté.
// Ce contrôle tourne sur le serveur avec la vraie session (le middleware, lui, ne bloque que les pages).
export async function refuseIfClosed(req: NextRequest): Promise<NextResponse | null> {
  if (!(await getClosure()).closed) return null;
  const viewer = await getViewer(req).catch(() => null);
  if (viewer?.role === 'admin') return null;
  return NextResponse.json(
    { error: CLOSED_MESSAGE, closed: true },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3600' } }
  );
}
