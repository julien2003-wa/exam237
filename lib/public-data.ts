import { db } from './db';
import { getSiteSettings } from './settings';

// Données publiques de la page de connexion : classes ouvertes et contact WhatsApp.
// Servies par /api/public (gardées en cache par Vercel) et par /api/data?action=public.
export async function loadPublicData() {
  const sql = db();
  const [groups, classes, site] = await Promise.all([
    sql`SELECT id,code,label,exam_type,display_order FROM ex237_groups WHERE active=TRUE ORDER BY display_order,label`,
    sql`SELECT c.code,c.label,c.exam_type,c.series,c.group_id,g.label AS group_label
        FROM ex237_classes c LEFT JOIN ex237_groups g ON g.id=c.group_id
        WHERE c.active=TRUE ORDER BY c.display_order,c.label`,
    getSiteSettings().catch(() => null),
  ]);
  return {
    groups: groups.map((g: any) => ({
      id: g.id,
      code: g.code,
      label: g.label,
      examType: g.exam_type,
    })),
    classes: classes.map((c: any) => ({
      code: c.code,
      label: c.label,
      examType: c.exam_type,
      series: c.series,
      groupId: c.group_id,
      groupLabel: c.group_label,
    })),
    site: { whatsapp: site?.whatsapp || '', prices: site?.prices || null },
  };
}
