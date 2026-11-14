import { findDuration } from '@/lib/durations';
import { findInPdf } from '../pdf-reader';

// Durée écrite en haut d'un sujet (1re page, sinon 2e) : un fichier choisi sur le téléphone ou
// un sujet déjà en ligne. null si elle est introuvable (PDF scanné, autre écriture) : l'admin
// la saisit alors lui-même.
export async function readDuration(source: File | string, timeoutMs = 45000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Lecture trop longue.')), timeoutMs);
  });
  try {
    return await Promise.race([findInPdf(source, 2, findDuration), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const paperFileUrl = (paperId: string) =>
  `/api/files?kind=paper&id=${encodeURIComponent(paperId)}`;
