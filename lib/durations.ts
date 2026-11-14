/*
  Durée d'une épreuve, écrite en haut d'un sujet : « Durée : 2 h », « DUREE : 3H00 »,
  « Durée de l'épreuve : 1 h 30 min », « Time allowed: 2½ hours », « Duration: 90 minutes »…
  Sert au mode examen (chrono). Renvoie des minutes, ou null si rien de sûr n'est trouvé :
  dans le doute, l'admin saisit la durée lui-même.
*/

const MIN_MINUTES = 30;
const MAX_MINUTES = 360;

const WORD_NUMBERS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

// « Durée », « Duration », « Time allowed », « Temps alloué » ; « Time » et « Temps » seuls
// seulement suivis de « : » (sinon une phrase d'exercice pourrait passer pour la durée).
const KEYWORD =
  /(?:duree|duration|time ?allowed|temps ?(?:alloue|imparti)|(?:time|temps)(?=\s*:))/g;
const QUALIFIER =
  /^\s*(?:de l'epreuve|de l'examen|totale|of (?:the )?(?:paper|exam(?:ination)?|test))?\s*[:=\-.(]*\s*/;
// Durée d'une partie ou de la préparation, pas de l'épreuve entière.
const EXCLUDED =
  /^(?:conseillee|indicative|approximative|de (?:la )?preparation|suggested|recommended)/;
const NUMBER = `\\d{1,2}(?:[.,]\\d{1,2})?|${Object.keys(WORD_NUMBERS).join('|')}`;
const VALUE = new RegExp(
  '^(?:' +
    // heures, puis minutes éventuelles : « 2 h », « 2h30 », « 2 heures 30 minutes », « 2 h et demie »
    `(${NUMBER})\\s*(?:heures?|hours?|hrs?|h)(?![a-z])` +
    `(?:\\s*(?:et|and)?\\s*(demie?|half|\\d{1,2})\\s*(?:minutes?|mins?|mn|m(?![a-z])|')?)?` +
    '|' +
    // minutes seules : « 90 minutes », « 90 min »
    '(\\d{2,3})\\s*(?:minutes?|mins?|mn)(?![a-z])' +
    ')'
);

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[    ]/g, ' ')
    .replace(/[’‘`´]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/h\s*(?:½|1\s*\/\s*2)/g, 'h30') // « 1h½ », « 1 h 1/2 »
    .replace(/(\d)\s*½/g, '$1.5') // « 2½ hours »
    .replace(/(\d)\s+1\s*\/\s*2\b/g, '$1.5') // « 2 1/2 hours »
    .replace(/[ \t\r\f\v]+/g, ' ');
}

// Titres espacés lettre par lettre dans certains PDF : « D U R É E » → « duree ».
function joinSpacedLetters(text: string) {
  return text.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, word => word.replace(/ /g, ''));
}

function toMinutes(m: RegExpMatchArray) {
  if (m[3]) return Number(m[3]);
  const hours = WORD_NUMBERS[m[1]] ?? Number(m[1].replace(',', '.'));
  const extra = !m[2] ? 0 : /^(?:demie?|half)$/.test(m[2]) ? 30 : Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(extra) || extra >= 60) return null;
  return Math.round(hours * 60 + extra);
}

function scan(text: string) {
  for (const k of text.matchAll(KEYWORD)) {
    const from = (k.index ?? 0) + k[0].length;
    const rest = text.slice(from, from + 80).replace(QUALIFIER, '');
    if (EXCLUDED.test(rest)) continue;
    const m = rest.match(VALUE);
    if (!m) continue;
    const minutes = toMinutes(m);
    if (minutes && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES) return minutes;
  }
  return null;
}

export function findDuration(text: string | null | undefined): number | null {
  if (!text) return null;
  const base = normalize(text);
  return scan(base) ?? scan(joinSpacedLetters(base));
}

// 120 → « 2 h », 150 → « 2 h 30 », 45 → « 45 min »
export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
