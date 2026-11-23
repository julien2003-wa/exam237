import { NextResponse } from 'next/server';
import { loadPublicData } from '@/lib/public-data';

// Classes ouvertes et contact WhatsApp (page de connexion), gardés en cache par Vercel :
// les visiteurs venus d'un lien WhatsApp ne réveillent plus la base. Relu tout de suite après
// une modification de l'admin (revalidatePath dans app/api/data/route.ts), sinon une fois par heure.
export const dynamic = 'force-static';
export const revalidate = 3600;

export async function GET() {
  try {
    return NextResponse.json(await loadPublicData());
  } catch (e) {
    // Compilation sans base joignable : la page de connexion lit alors /api/data?action=public.
    if (process.env.NEXT_PHASE === 'phase-production-build')
      return NextResponse.json({ unavailable: true });
    throw e;
  }
}
