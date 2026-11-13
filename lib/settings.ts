import { db } from './db';
import { ensureSchema } from './schema';

/*
  Réglages du site modifiables dans l'admin (onglet « Réglages ») :
  numéro WhatsApp, prix du Premium, dates d'examen, mots interdits dans le chat.
  Ils sont stockés en base, jamais dans le code (le dépôt GitHub est public).
*/

export const PLAN_MONTHS = ['1', '3', '6', '12'] as const;
export type PlanMonths = (typeof PLAN_MONTHS)[number];

export type SiteSettings = {
  whatsapp: string;
  prices: Record<PlanMonths, string>;
  examDates: Record<string, string>;
  bannedWords: string[];
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  whatsapp: '',
  prices: { '1': '', '3': '', '6': '', '12': '' },
  examDates: {},
  bannedWords: [],
};

// Numéro au format international sans « + » : 6XX XX XX XX → 2376XXXXXXXX.
export function normalizeWhatsapp(value: unknown) {
  let digits = String(value ?? '').replace(/\D+/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^6\d{8}$/.test(digits)) digits = `237${digits}`;
  return /^\d{10,15}$/.test(digits) ? digits : '';
}

const clean = (value: unknown, max: number) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .trim()
    .slice(0, max);

export function normalizeSiteSettings(raw: unknown): SiteSettings {
  let value: any = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      value = {};
    }
  }
  value = value && typeof value === 'object' ? value : {};

  const prices = { ...DEFAULT_SITE_SETTINGS.prices };
  for (const months of PLAN_MONTHS) prices[months] = clean(value.prices?.[months], 40);

  const examDates: Record<string, string> = {};
  if (value.examDates && typeof value.examDates === 'object') {
    for (const [type, date] of Object.entries(value.examDates)) {
      const key = clean(type, 24).toUpperCase();
      const day = clean(date, 10);
      if (key && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)))
        examDates[key] = day;
    }
  }

  const words = Array.isArray(value.bannedWords)
    ? value.bannedWords
    : String(value.bannedWords || '').split(/[,\n]/);
  const bannedWords = words
    .map((w: unknown) => clean(w, 40).toLowerCase())
    .filter((w: string) => w.length >= 2)
    .slice(0, 200);

  return {
    whatsapp: normalizeWhatsapp(value.whatsapp),
    prices,
    examDates,
    bannedWords: [...new Set<string>(bannedWords)],
  };
}

// Cache court par instance : les réglages changent rarement.
let cache: { value: SiteSettings; at: number } | null = null;

export async function getSiteSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  await ensureSchema();
  const rows: any[] = await db()`SELECT value FROM ex237_settings WHERE key='site' LIMIT 1`;
  const value = normalizeSiteSettings(rows[0]?.value ?? null);
  cache = { value, at: Date.now() };
  return value;
}

export async function saveSiteSettings(input: unknown) {
  await ensureSchema();
  const next = normalizeSiteSettings(input);
  await db()`INSERT INTO ex237_settings(key,value,updated_at) VALUES('site',${JSON.stringify(next)},NOW())
             ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
  cache = { value: next, at: Date.now() };
  return next;
}

// Ce que les élèves voient des réglages.
export function publicSettings(settings: SiteSettings, examType?: string | null) {
  const key = String(examType || '').toUpperCase();
  return {
    whatsapp: settings.whatsapp,
    prices: settings.prices,
    examDate: key && settings.examDates[key] ? settings.examDates[key] : null,
  };
}
