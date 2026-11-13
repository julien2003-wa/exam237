import { db } from './db';
import type { Viewer } from './auth';

/*
  Règle d'accès « presque tout Premium » :
  - un membre Premium (ou l'admin) ouvre tous les sujets et corrections de son groupe ;
  - un compte gratuit ouvre seulement les sujets marqués « Gratuit » par l'admin ;
  - si l'admin n'a marqué aucun sujet gratuit dans une matière, le sujet corrigé le plus
    récent de cette matière est offert automatiquement (un sujet d'essai par matière).
  La même règle sert à la liste des sujets ET à l'ouverture des PDF (côté serveur).
*/

export function isPremiumViewer(viewer: Viewer | null | undefined) {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  return viewer.accountStatus === 'active' && viewer.premium === true;
}

// Identifiants des sujets ouverts aux comptes gratuits dans un groupe.
export async function freePaperIds(groupId: string): Promise<Set<string>> {
  const rows: any[] = await db()`
    WITH pub AS (
      SELECT p.id,p.subject_id,p.is_premium,p.exam_year,p.created_at,
             EXISTS (SELECT 1 FROM ex237_corrections cor
                     WHERE cor.paper_id=p.id AND cor.status='published') AS has_correction
      FROM ex237_papers p JOIN ex237_classes c ON c.code=p.class_code
      WHERE p.status='published' AND c.group_id=${groupId}
    ),
    chosen AS (SELECT DISTINCT subject_id FROM pub WHERE is_premium=FALSE),
    automatic AS (
      SELECT DISTINCT ON (subject_id) id FROM pub
      WHERE subject_id NOT IN (SELECT subject_id FROM chosen)
      ORDER BY subject_id,has_correction DESC,exam_year DESC,created_at DESC
    )
    SELECT id::text AS id FROM pub WHERE is_premium=FALSE
    UNION
    SELECT id::text AS id FROM automatic`;
  return new Set(rows.map(r => String(r.id)));
}

export async function canOpenPaper(viewer: Viewer, paperId: string, groupId: string) {
  if (isPremiumViewer(viewer)) return true;
  return (await freePaperIds(groupId)).has(String(paperId));
}
