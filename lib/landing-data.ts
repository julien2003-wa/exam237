import { db } from './db';
import { ensureSchema } from './schema';
import { getSiteSettings, type SiteSettings } from './settings';
import { examName } from './exams';

/*
  Données des pages publiques (présentation et À propos), tirées de la base.
  Les pages sont regénérées toutes les 10 minutes.
*/

export type CatalogYear = { year: number; count: number; corrected: boolean; fresh: boolean };
export type CatalogExam = {
  exam: string;
  subjects: Array<{ name: string; years: CatalogYear[] }>;
};

export type LandingData = {
  site: SiteSettings | null;
  papers: number;
  corrections: number;
  subjects: number;
  students: number;
  catalog: CatalogExam[];
};

// Un sujet ajouté il y a moins de 45 jours porte le badge « Nouveau ».
const FRESH_MS = 45 * 86400000;
const ORDER = ['BEPC', 'Probatoire', 'Bac', 'CAP', 'GCE'];

export async function loadLandingData(): Promise<LandingData> {
  const data: LandingData = {
    site: null,
    papers: 0,
    corrections: 0,
    subjects: 0,
    students: 0,
    catalog: [],
  };
  try {
    await ensureSchema();
    const sql = db();
    const [totals, rows, students, site] = await Promise.all([
      sql`SELECT COUNT(*)::int AS papers,COUNT(DISTINCT p.subject_id)::int AS subjects,
                 (SELECT COUNT(*)::int FROM ex237_corrections cor JOIN ex237_papers pp ON pp.id=cor.paper_id
                  WHERE cor.status='published' AND pp.status='published') AS corrections
          FROM ex237_papers p WHERE p.status='published'`,
      sql`SELECT g.exam_type,s.name AS subject,p.exam_year,COUNT(DISTINCT p.id)::int AS n,
                 BOOL_OR(EXISTS(SELECT 1 FROM ex237_corrections cor
                                WHERE cor.paper_id=p.id AND cor.status='published')) AS corrected,
                 MAX(COALESCE(p.published_at,p.created_at)) AS last_at
          FROM ex237_papers p
          JOIN ex237_subjects s ON s.id=p.subject_id
          JOIN ex237_classes c ON c.code=p.class_code
          LEFT JOIN ex237_groups g ON g.id=c.group_id
          WHERE p.status='published'
          GROUP BY g.exam_type,s.name,p.exam_year
          ORDER BY s.name,p.exam_year DESC`,
      sql`SELECT COUNT(*)::int AS n FROM ex237_user_profiles`,
      getSiteSettings(),
    ]);
    data.site = site;
    const t: any = (totals as any[])[0] || {};
    data.papers = t.papers || 0;
    data.corrections = t.corrections || 0;
    data.subjects = t.subjects || 0;
    data.students = (students as any[])[0]?.n || 0;
    const now = Date.now();
    const byExam = new Map<string, Map<string, CatalogExam['subjects'][number]>>();
    for (const r of rows as any[]) {
      const exam = examName(r.exam_type);
      if (!exam) continue;
      if (!byExam.has(exam)) byExam.set(exam, new Map());
      const subjects = byExam.get(exam)!;
      if (!subjects.has(r.subject)) subjects.set(r.subject, { name: r.subject, years: [] });
      subjects.get(r.subject)!.years.push({
        year: r.exam_year,
        count: r.n,
        corrected: !!r.corrected,
        fresh: !!r.last_at && now - new Date(r.last_at).getTime() < FRESH_MS,
      });
    }
    data.catalog = [...byExam.entries()]
      .sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99))
      .map(([exam, subjects]) => ({
        exam,
        subjects: [...subjects.values()].sort(
          (a, b) => b.years.length - a.years.length || a.name.localeCompare(b.name, 'fr')
        ),
      }));
  } catch (error) {
    console.error('Pages publiques : données indisponibles', error);
  }
  return data;
}
