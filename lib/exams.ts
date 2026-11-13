/*
  Examens : noms affichés et compte à rebours (page de présentation et accueil de l'appli).
  Ce fichier ne dépend de rien : il sert côté serveur comme dans le navigateur.
*/

// Code saisi dans l'admin (BEPC, PROBATOIRE, BAC, BACCALAUREAT…) → nom lisible.
export function examName(type?: string | null): string | null {
  const t = String(type || '')
    .trim()
    .toUpperCase();
  if (!t || t === 'AUTRE') return null;
  if (t === 'BEPC') return 'BEPC';
  if (t.startsWith('PROBA')) return 'Probatoire';
  if (t === 'BAC' || t.startsWith('BACC')) return 'Bac';
  if (t === 'CAP') return 'CAP';
  if (t.startsWith('GCE')) return 'GCE';
  return t.charAt(0) + t.slice(1).toLowerCase();
}

/*
  Calendrier officiel de l'année scolaire 2026-2027 (arrêté conjoint MINEDUB / MINESEC du
  14 août 2026) : les examens officiels de l'enseignement secondaire se déroulent du lundi
  19 avril au vendredi 30 juillet 2027. Les dates exactes de chaque examen sont publiées plus
  tard par l'OBC, la DECC et le GCE Board : l'admin les saisit alors dans Réglages, et elles
  remplacent cette période. À mettre à jour à chaque nouvelle année scolaire.
*/
export const OFFICIAL_EXAM_PERIOD = {
  start: '2027-04-19',
  end: '2027-07-30',
  year: 2027,
};

export type ExamTarget = {
  title: string; // « BEPC 2027 » ou « Examens officiels 2027 »
  date: string; // AAAA-MM-JJ
  exact: boolean; // date de l'examen (Réglages) ou début de la période officielle
};

// Minuit, heure du Cameroun.
export function examTime(date: string) {
  return new Date(`${date}T00:00:00+01:00`).getTime();
}

function upcoming(date: string, now: number) {
  const t = examTime(date);
  return Number.isFinite(t) && t > now;
}

function periodTarget(now: number): ExamTarget | null {
  if (!upcoming(OFFICIAL_EXAM_PERIOD.start, now)) return null;
  return {
    title: `Examens officiels ${OFFICIAL_EXAM_PERIOD.year}`,
    date: OFFICIAL_EXAM_PERIOD.start,
    exact: false,
  };
}

// Toutes les échéances à venir (une par examen dont la date est connue), sinon la période officielle.
export function examTargets(examDates: Record<string, string>, now = Date.now()): ExamTarget[] {
  const exact = Object.entries(examDates || {})
    .filter(([, date]) => upcoming(date, now))
    .map(([type, date]) => ({
      title: `${examName(type) || type} ${date.slice(0, 4)}`,
      date,
      exact: true,
    }))
    .sort((a, b) => examTime(a.date) - examTime(b.date));
  if (exact.length) return exact;
  const period = periodTarget(now);
  return period ? [period] : [];
}

// L'échéance d'un élève : la date de son examen si elle est connue, sinon la période officielle.
export function examTargetFor(
  examDate: string | null | undefined,
  examType: string | null | undefined,
  now = Date.now()
): ExamTarget | null {
  if (examDate && upcoming(examDate, now))
    return {
      title: `${examName(examType) || 'Examen'} ${examDate.slice(0, 4)}`,
      date: examDate,
      exact: true,
    };
  return periodTarget(now);
}

export function daysBefore(date: string, now = Date.now()) {
  return Math.max(0, Math.ceil((examTime(date) - now) / 86400000));
}
