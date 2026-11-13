import type { Metadata } from 'next';
import ExamApp from '@/components/exam-app';

export const metadata: Metadata = { title: 'Prof IA', robots: { index: false } };

export default function Page() {
  return <ExamApp />;
}
