import type { Metadata } from 'next';
import ExamApp from '@/components/exam-app';
import { db, isUuid } from '@/lib/db';

const EXAMS: Record<string, string> = {
  BEPC: 'BEPC',
  PROBATOIRE: 'Probatoire',
  BAC: 'Bac',
  CAP: 'CAP',
  GCE: 'GCE',
};

type Props = { params: Promise<{ rest?: string[] }> };

// Aperçu d'un lien partagé sur WhatsApp : la matière, l'examen et l'année du sujet.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { rest = [] } = await params;
  const fallback: Metadata = { title: 'Sujets', robots: { index: false } };
  const id = rest[0];
  if (!id || id === 'matiere' || !isUuid(id)) return fallback;
  try {
    const rows: any[] = await db()`
      SELECT s.name AS subject, p.exam_year, c.exam_type,
             EXISTS(SELECT 1 FROM ex237_corrections cor
                    WHERE cor.paper_id=p.id AND cor.status='published') AS corrected
      FROM ex237_papers p
      JOIN ex237_subjects s ON s.id=p.subject_id
      JOIN ex237_classes c ON c.code=p.class_code
      WHERE p.id=${id} AND p.status='published' LIMIT 1`;
    const p = rows[0];
    if (!p) return fallback;
    const exam = EXAMS[String(p.exam_type || '').toUpperCase()] || '';
    const title = [p.subject, [exam, p.exam_year].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    const description = p.corrected
      ? 'Le sujet et sa correction, sur Exam237.'
      : 'Le sujet, sur Exam237.';
    return {
      title,
      description,
      robots: { index: false },
      openGraph: {
        type: 'website',
        locale: 'fr_CM',
        siteName: 'Exam237',
        title,
        description,
        images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Exam237' }],
      },
    };
  } catch {
    return fallback;
  }
}

export default function Page() {
  return <ExamApp />;
}
