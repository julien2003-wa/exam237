import { NextResponse } from 'next/server';
import { readClosure } from '@/lib/closure';

// État ouvert / fermé du site, lu par le middleware avant chaque page.
// La réponse est gardée en cache par Vercel : les simples visiteurs ne réveillent plus la base.
// Les boutons « Fermer le site » et « Rouvrir le site » vident ce cache aussitôt
// (revalidatePath dans app/api/data/route.ts) ; sinon, il est relu au plus une fois par heure.
export const dynamic = 'force-static';
export const revalidate = 3600;

export async function GET() {
  try {
    const closure = await readClosure();
    return NextResponse.json({ closed: closure.closed, since: closure.since });
  } catch (e) {
    // Compilation sans base joignable : état « inconnu », le middleware interroge alors la base.
    // En service, l'erreur garde en cache la dernière réponse valable.
    if (process.env.NEXT_PHASE === 'phase-production-build')
      return NextResponse.json({ unknown: true });
    throw e;
  }
}
