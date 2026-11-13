import type { Metadata } from 'next';
import ExamApp from '@/components/exam-app';

export const metadata: Metadata = { title: 'Profil', robots: { index: false } };

export default function Page() {
  return <ExamApp />;
}
