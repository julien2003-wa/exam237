import crypto from 'node:crypto';
import { db } from './db';
import { decryptMessage, encryptMessage } from './crypto';
import { publishChatMessage, publishRoomEvent } from './realtime';
import { ASSISTANT_NAME, messageDto } from './chat';
import { ensureSchema } from './schema';

export { ASSISTANT_NAME };

/*
  Assistant IA Exam237
  - Répond dans le chat de groupe aux messages qui contiennent @assistant (ou @Exam237),
    aux réponses faites à un de ses messages, et — en mode automatique — aux questions.
  - Appelle l'API Claude (Messages API) avec la clé ANTHROPIC_API_KEY.
  - Répond aussi en privé (« Prof IA ») dans l'onglet dédié de l'élève.
  - Journalise chaque demande dans ex237_assistant_requests (sans le texte : les messages
    restent chiffrés dans ex237_chat_messages et ex237_tutor_messages).
  - Quotas par jour : dailyLimit pour les membres Premium, freeDailyLimit pour les comptes
    gratuits (0 = assistant réservé au Premium).
*/

export const ASSISTANT_USER_ID = 'assistant';

export type AssistantMode = 'off' | 'mention' | 'auto';
export type AssistantSettings = { mode: AssistantMode; dailyLimit: number; freeDailyLimit: number };
export type AssistantTrigger = 'mention' | 'followup' | 'auto' | 'admin' | 'tutor';

const DEFAULT_SETTINGS: AssistantSettings = { mode: 'mention', dailyLimit: 30, freeDailyLimit: 0 };
const MODES: AssistantMode[] = ['off', 'mention', 'auto'];
const EFFORTS = ['low', 'medium', 'high'];
const SKIP_TOKEN = '[PASSER]';
const MAX_ANSWER_CHARS = 3500;
const MAX_THREAD = 7;

// Prix publics en dollars par million de jetons (entrée, sortie) — pour l'estimation du coût.
const MODEL_PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};

export function assistantConfigured() {
  return !!String(process.env.ANTHROPIC_API_KEY || '').trim();
}

export function assistantModel() {
  return String(process.env.ANTHROPIC_MODEL || '').trim() || 'claude-haiku-5-5';
}

function assistantEffort() {
  const value = String(process.env.ASSISTANT_EFFORT || '')
    .trim()
    .toLowerCase();
  return EFFORTS.includes(value) ? value : 'medium';
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
}

/* ---------------- Tables (créées automatiquement, sans migration manuelle) ---------------- */

let tablesReady: Promise<void> | null = null;

async function createTables() {
  const sql = db();
  await sql`CREATE TABLE IF NOT EXISTS ex237_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ex237_assistant_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    room_id TEXT NOT NULL,
    question_message_id TEXT NOT NULL,
    answer_message_id TEXT,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at TIMESTAMPTZ
  )`;
  await sql`CREATE INDEX IF NOT EXISTS ex237_assistant_requests_user_idx ON ex237_assistant_requests (user_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS ex237_assistant_requests_created_idx ON ex237_assistant_requests (created_at)`;
}

export function ensureAssistantTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      try {
        await createTables();
      } catch {
        // Deux instances qui créent la table en même temps : on réessaie une fois.
        await new Promise(resolve => setTimeout(resolve, 400));
        await createTables();
      }
    })().catch(error => {
      tablesReady = null;
      throw error;
    });
  }
  return tablesReady;
}

/* ---------------- Réglages ---------------- */

function normalizeSettings(raw: unknown): AssistantSettings {
  let value: any = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      value = {};
    }
  }
  const mode = MODES.includes(value?.mode) ? (value.mode as AssistantMode) : DEFAULT_SETTINGS.mode;
  const limit = Math.round(Number(value?.dailyLimit));
  const dailyLimit =
    Number.isFinite(limit) && limit >= 1 ? Math.min(limit, 200) : DEFAULT_SETTINGS.dailyLimit;
  const free = Math.round(Number(value?.freeDailyLimit));
  const freeDailyLimit =
    Number.isFinite(free) && free >= 0 ? Math.min(free, 200) : DEFAULT_SETTINGS.freeDailyLimit;
  return { mode, dailyLimit, freeDailyLimit };
}

export function dailyLimitFor(settings: AssistantSettings, premium: boolean) {
  return premium ? settings.dailyLimit : settings.freeDailyLimit;
}

export async function getAssistantSettings(): Promise<AssistantSettings> {
  await ensureAssistantTables();
  const rows = await db()`SELECT value FROM ex237_settings WHERE key='assistant' LIMIT 1`;
  return normalizeSettings((rows[0] as any)?.value ?? null);
}

export async function saveAssistantSettings(input: {
  mode?: unknown;
  dailyLimit?: unknown;
  freeDailyLimit?: unknown;
}) {
  const current = await getAssistantSettings();
  const next = normalizeSettings({
    ...current,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
  });
  await db()`INSERT INTO ex237_settings(key,value,updated_at) VALUES('assistant',${JSON.stringify(next)},NOW())
             ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
  return next;
}

/* ---------------- Détection ---------------- */

const MENTION = /@\s*(?:exam\s*237|assistant)\b/i;
const MENTION_GLOBAL = /@\s*(?:exam\s*237|assistant)\b[\s,:;.!-]*/gi;
const QUESTION_START =
  /^(comment|pourquoi|quel(?:le)?s?|combien|est[- ]ce|c'?est quoi|qu'?est[- ]ce|que signifie|explique|expliquez|aide[sz]?[- ]moi|aidez[- ]moi|svp|s'?il vous pla[iî]t|how|why|what|which|explain|can someone|please)/i;

export function mentionsAssistant(text: string) {
  return MENTION.test(text);
}

export function stripMention(text: string) {
  return text
    .replace(MENTION_GLOBAL, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikeQuestion(text: string) {
  const value = stripMention(text);
  if (value.length < 12) return false;
  return value.includes('?') || QUESTION_START.test(value);
}

export function isAssistantMessage(row: { sender_user_id?: unknown; sender_name?: unknown }) {
  return (
    (row.sender_user_id === null || row.sender_user_id === undefined) &&
    row.sender_name === ASSISTANT_NAME
  );
}

// Indique si un message qui vient d'être envoyé doit déclencher l'assistant.
export async function detectAssistantTrigger(input: {
  text: string;
  replyToId: string | null;
  roomId: string;
  fromStudent: boolean;
}): Promise<AssistantTrigger | null> {
  if (!assistantConfigured()) return null;
  let settings: AssistantSettings;
  try {
    settings = await getAssistantSettings();
  } catch (e) {
    console.error('Assistant settings:', e);
    return null;
  }
  if (settings.mode === 'off') return null;
  if (mentionsAssistant(input.text)) return 'mention';
  if (input.replyToId) {
    const rows =
      await db()`SELECT sender_user_id,sender_name FROM ex237_chat_messages WHERE id=${input.replyToId} AND room_id=${input.roomId} LIMIT 1`;
    if (rows[0] && isAssistantMessage(rows[0] as any)) return 'followup';
  }
  if (settings.mode === 'auto' && input.fromStudent && looksLikeQuestion(input.text)) return 'auto';
  return null;
}

/* ---------------- Consignes ---------------- */

function systemPrompt(context: {
  groupLabel?: string | null;
  examType?: string | null;
  classLabel?: string | null;
  auto?: boolean;
}) {
  const where = [
    context.groupLabel ? `groupe « ${context.groupLabel} »` : null,
    context.classLabel ? `classe de l'élève : ${context.classLabel}` : null,
    context.examType && context.examType !== 'AUTRE' ? `examen visé : ${context.examType}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return `Tu es l'Assistant IA d'Exam237, une plateforme camerounaise qui prépare les élèves aux examens officiels (BEPC, Probatoire, Baccalauréat, GCE). Tu réponds dans le chat d'un groupe de révision${where ? ` (${where})` : ''}. Ta réponse est visible par tout le groupe.

Ton rôle : expliquer comme un bon enseignant camerounais, pour que l'élève comprenne et sache refaire seul.
- Commence par un bref rappel de cours utile (définition, propriété, formule ou méthode).
- Puis résous étape par étape, avec des étapes numérotées et courtes, en justifiant chaque étape.
- Termine par le résultat bien mis en évidence et, si c'est utile, l'erreur fréquente à éviter.
- Suis les programmes officiels du Cameroun (MINESEC) et la rédaction attendue aux examens : unités, phrases de conclusion, notations usuelles.
- Explique toujours par toi-même à partir du cours : ne cite jamais de « corrigé officiel » ni de « corrigé harmonisé ».
- Si l'énoncé est incomplet (figure absente, données manquantes), dis ce qu'il manque et explique la méthode générale.
- Si tu n'es pas sûr d'un résultat, dis-le franchement plutôt que d'inventer.

Format (le chat affiche du texte brut sur téléphone) :
- Pas de Markdown (pas de **, de #, de tableaux) ni de LaTeX. Écris les formules simplement : x², √2, 3/4, ×, ÷, ≤, ≥, π, Δ, →.
- Sois concis : environ 120 à 250 mots, davantage seulement si l'exercice l'exige.
- Réponds en français ; si l'élève écrit en anglais, réponds en anglais.

Limites :
- Tu aides uniquement pour les cours, les exercices, les méthodes de travail et l'orientation scolaire. Pour tout autre sujet, réponds en une phrase, gentiment, que tu es là pour les révisions.
- Pour les questions sur un compte, un abonnement, un paiement ou le fonctionnement du site, réponds que l'équipe Exam237 va s'en occuper, sans rien inventer.
- Les élèves sont mineurs : reste bienveillant et adapté à leur âge. Ne demande jamais d'informations personnelles (nom complet, téléphone, adresse, photos) et n'en partage pas.
- Si un élève parle de détresse, de violence, d'abus ou de danger, réponds avec douceur et encourage-le à en parler tout de suite à un adulte de confiance (parent, enseignant, conseiller d'orientation) ou aux secours en cas d'urgence.${
    context.auto
      ? `

Ce message vient du chat de groupe et ne t'est peut-être pas adressé. S'il ne s'agit pas d'une question de cours ou d'exercice à laquelle tu peux répondre utilement (bavardage, salutation, question adressée à un camarade, organisation du groupe), réponds uniquement : ${SKIP_TOKEN}`
      : ''
  }`;
}

/* ---------------- Appel à l'API Claude ---------------- */

type ClaudeContent = string | Array<Record<string, unknown>>;
type ClaudeMessage = { role: 'user' | 'assistant'; content: ClaudeContent };
type ClaudeResult = {
  text: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

export async function callClaude(
  system: string,
  messages: ClaudeMessage[],
  timeoutMs = 50_000
): Promise<ClaudeResult> {
  const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY manquante');
  const model = assistantModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${key}`,
    'anthropic-version': '2023-06-01',
  };
  // Seulement pour une clé non rattachée à un espace de travail (workspace) de la Console.
  const workspace = String(process.env.ANTHROPIC_WORKSPACE_ID || '').trim();
  if (workspace) headers['anthropic-workspace-id'] = workspace;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 6000,
        system,
        messages,
        output_config: { effort: assistantEffort() },
      }),
      signal: controller.signal,
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || `HTTP ${response.status}`;
      throw new Error(`API Claude : ${detail}`);
    }
    const text = (Array.isArray(data?.content) ? data.content : [])
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('\n')
      .trim();
    return {
      text,
      stopReason: data?.stop_reason ?? null,
      inputTokens: Number(data?.usage?.input_tokens || 0),
      outputTokens: Number(data?.usage?.output_tokens || 0),
      model: String(data?.model || model),
    };
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('API Claude : délai dépassé');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Nettoie le Markdown/LaTeX éventuel : le chat affiche du texte brut.
export function toPlainText(text: string) {
  let value = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/\\\(|\\\)|\\\[|\\\]|\$\$/g, '')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\sqrt\{([^}]*)\}/g, '√($1)')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (value.length > MAX_ANSWER_CHARS) value = `${value.slice(0, MAX_ANSWER_CHARS - 1).trimEnd()}…`;
  return value;
}

/* ---------------- Fil de discussion ---------------- */

type ThreadItem = { role: 'user' | 'assistant'; text: string; senderUserId: string | null };

async function loadThread(roomId: string, questionId: string): Promise<ThreadItem[]> {
  const sql = db();
  const thread: ThreadItem[] = [];
  const seen = new Set<string>();
  let currentId: string | null = questionId;
  while (currentId && thread.length < MAX_THREAD && !seen.has(currentId)) {
    seen.add(currentId);
    const rows: any[] =
      await sql`SELECT id,sender_user_id,sender_name,ciphertext,iv,auth_tag,reply_to_id
                                  FROM ex237_chat_messages WHERE id=${currentId} AND room_id=${roomId} LIMIT 1`;
    const row = rows[0];
    if (!row) break;
    let text = '';
    try {
      text = decryptMessage(roomId, row.ciphertext, row.iv, row.auth_tag);
    } catch {
      break;
    }
    const assistant = isAssistantMessage(row);
    thread.unshift({
      role: assistant ? 'assistant' : 'user',
      text: assistant ? text : stripMention(text),
      senderUserId: row.sender_user_id ? String(row.sender_user_id) : null,
    });
    currentId = row.reply_to_id ? String(row.reply_to_id) : null;
  }
  return thread;
}

function toClaudeMessages(
  thread: ThreadItem[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const item of thread) {
    const text = item.text.trim() || '(message vide)';
    const last = merged[merged.length - 1];
    if (last && last.role === item.role) last.content = `${last.content}\n\n${text}`;
    else merged.push({ role: item.role, content: text });
  }
  while (merged.length && merged[0].role === 'assistant') merged.shift();
  return merged;
}

/* ---------------- Publication dans le chat ---------------- */

async function postAssistantMessage(roomId: string, replyToId: string | null, text: string) {
  const sql = db();
  const id = crypto.randomUUID();
  const encrypted = encryptMessage(roomId, text);
  try {
    await sql`INSERT INTO ex237_chat_messages(id,room_id,sender_user_id,sender_name,ciphertext,iv,auth_tag,reply_to_id,is_pinned,created_at)
              VALUES(${id},${roomId},${null},${ASSISTANT_NAME},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${replyToId},FALSE,NOW())`;
  } catch (error) {
    if (!replyToId) throw error;
    // La question a pu être supprimée entre-temps : on publie sans citation.
    await sql`INSERT INTO ex237_chat_messages(id,room_id,sender_user_id,sender_name,ciphertext,iv,auth_tag,reply_to_id,is_pinned,created_at)
              VALUES(${id},${roomId},${null},${ASSISTANT_NAME},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${null},FALSE,NOW())`;
  }
  try {
    const rows: any[] = await sql`
      SELECT m.id,m.room_id,m.sender_user_id,m.sender_name,m.ciphertext,m.iv,m.auth_tag,m.reply_to_id,m.is_pinned,m.created_at,
             r.sender_name AS reply_sender,r.ciphertext AS reply_ciphertext,r.iv AS reply_iv,r.auth_tag AS reply_auth_tag
      FROM ex237_chat_messages m LEFT JOIN ex237_chat_messages r ON r.id=m.reply_to_id
      WHERE m.id=${id} LIMIT 1`;
    if (rows[0]) await publishChatMessage(roomId, messageDto(rows[0], roomId));
  } catch (error) {
    console.error('Assistant realtime:', error);
  }
  return id;
}

function startTyping(roomId: string) {
  const ping = (active: boolean) => {
    publishRoomEvent(roomId, 'typing', {
      userId: ASSISTANT_USER_ID,
      name: ASSISTANT_NAME,
      active,
    }).catch(() => {});
  };
  ping(true);
  const timer = setInterval(() => ping(true), 2000);
  return () => {
    clearInterval(timer);
    ping(false);
  };
}

/* ---------------- Exécution ---------------- */

export type RunInput = {
  roomId: string;
  questionId: string;
  userId: string | null;
  trigger: AssistantTrigger;
  // Quota du jour de l'élève (dépend de son offre : gratuite ou Premium).
  dailyLimit?: number;
};

export async function runAssistant(input: RunInput) {
  const sql = db();
  await ensureAssistantTables();
  const settings = await getAssistantSettings();
  const requestId = crypto.randomUUID();
  const model = assistantModel();

  await sql`INSERT INTO ex237_assistant_requests(id,user_id,room_id,question_message_id,trigger,status,model,created_at)
            VALUES(${requestId},${input.userId},${input.roomId},${input.questionId},${input.trigger},'pending',${model},NOW())`;

  // Limite quotidienne par élève (la demande en cours est comptée).
  const limit = input.dailyLimit ?? settings.dailyLimit;
  if (input.userId && input.trigger !== 'admin') {
    const used: any[] = await sql`SELECT COUNT(*)::int AS n FROM ex237_assistant_requests
                                  WHERE user_id=${input.userId} AND created_at>NOW()-INTERVAL '1 day'
                                  AND status IN ('pending','answered','error')`;
    if (Number(used[0]?.n || 0) > limit) {
      await sql`UPDATE ex237_assistant_requests SET status='limited' WHERE id=${requestId}`;
      const limited: any[] = await sql`SELECT COUNT(*)::int AS n FROM ex237_assistant_requests
                                       WHERE user_id=${input.userId} AND status='limited' AND created_at>NOW()-INTERVAL '1 day'`;
      if (Number(limited[0]?.n || 0) <= 1 && input.trigger !== 'auto') {
        await postAssistantMessage(
          input.roomId,
          input.questionId,
          `Tu as atteint la limite de ${limit} questions à l'assistant pour aujourd'hui. Reviens demain ; en attendant, tes camarades du groupe peuvent t'aider ici. Bon courage !`
        );
      }
      return { status: 'limited' as const, requestId };
    }
  }

  // Un simple « @assistant » en réponse au message d'un camarade = « réponds à sa question ».
  const thread = (await loadThread(input.roomId, input.questionId)).filter(
    item => item.text.trim().length >= 2
  );
  const messages = toClaudeMessages(thread);
  const asker = [...thread].reverse().find(item => item.role === 'user');

  if (!asker || !messages.length || messages[messages.length - 1].role !== 'user') {
    await sql`UPDATE ex237_assistant_requests SET status='skipped',error='Question vide' WHERE id=${requestId}`;
    if (input.trigger !== 'auto') {
      await postAssistantMessage(
        input.roomId,
        input.questionId,
        'Écris ta question juste après @assistant, par exemple : « @assistant comment résoudre 2x + 3 = 7 ? »'
      );
    }
    return { status: 'skipped' as const, requestId };
  }

  const contextRows: any[] =
    await sql`SELECT g.label AS group_label,g.exam_type FROM ex237_chat_rooms r JOIN ex237_groups g ON g.id=r.group_id WHERE r.id=${input.roomId} LIMIT 1`;
  let classLabel: string | null = null;
  if (asker.senderUserId) {
    const cls: any[] =
      await sql`SELECT c.label FROM ex237_user_profiles p JOIN ex237_classes c ON c.code=p.class_code WHERE p.user_id=${asker.senderUserId} LIMIT 1`;
    classLabel = cls[0]?.label || null;
  }

  const stopTyping = input.trigger === 'auto' ? () => {} : startTyping(input.roomId);
  try {
    const result = await callClaude(
      systemPrompt({
        groupLabel: contextRows[0]?.group_label || null,
        examType: contextRows[0]?.exam_type || null,
        classLabel,
        auto: input.trigger === 'auto',
      }),
      messages
    );

    const compact = result.text.replace(/\s+/g, '').toUpperCase();
    if (
      input.trigger === 'auto' &&
      compact.includes(SKIP_TOKEN) &&
      compact.length <= SKIP_TOKEN.length + 20
    ) {
      await sql`UPDATE ex237_assistant_requests SET status='skipped',input_tokens=${result.inputTokens},output_tokens=${result.outputTokens},model=${result.model},answered_at=NOW() WHERE id=${requestId}`;
      return { status: 'skipped' as const, requestId };
    }

    let answer = toPlainText(result.text.replace(SKIP_TOKEN, '').trim());
    if (result.stopReason === 'refusal' || !answer) {
      answer =
        'Je ne peux pas répondre à ce message. Pose-moi plutôt une question sur tes cours ou un exercice, je t’explique volontiers !';
    }

    const answerId = await postAssistantMessage(input.roomId, input.questionId, answer);
    await sql`UPDATE ex237_assistant_requests SET status='answered',answer_message_id=${answerId},input_tokens=${result.inputTokens},output_tokens=${result.outputTokens},model=${result.model},answered_at=NOW() WHERE id=${requestId}`;
    return { status: 'answered' as const, requestId, answerId };
  } catch (error: any) {
    const message = String(error?.message || error || 'Erreur inconnue').slice(0, 500);
    console.error('Assistant:', message);
    await sql`UPDATE ex237_assistant_requests SET status='error',error=${message} WHERE id=${requestId}`;
    if (input.trigger !== 'auto') {
      try {
        await postAssistantMessage(
          input.roomId,
          input.questionId,
          'Désolé, je n’arrive pas à répondre pour le moment. Réessaie dans quelques minutes.'
        );
      } catch {}
    }
    return { status: 'error' as const, requestId, error: message };
  } finally {
    stopTyping();
  }
}

// Pour l'admin : tester l'assistant sans rien publier dans le chat.
export async function testAssistant(question: string, groupLabel: string | null) {
  const result = await callClaude(systemPrompt({ groupLabel }), [
    { role: 'user', content: stripMention(question) },
  ]);
  return {
    answer: toPlainText(result.text) || '(réponse vide)',
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: estimateCostUsd(result.model, result.inputTokens, result.outputTokens),
  };
}

/* ---------------- Vue d'ensemble pour l'admin ---------------- */

export async function assistantOverview() {
  const sql = db();
  await ensureAssistantTables();
  await ensureSchema();
  const [settings, statsRows, usageRows, recentRows] = await Promise.all([
    getAssistantSettings(),
    sql`SELECT
          COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '1 day' AND status<>'skipped')::int AS day_count,
          COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '7 days' AND status<>'skipped')::int AS week_count,
          COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '30 days' AND status='answered')::int AS month_answered,
          COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '7 days' AND status='error')::int AS week_errors,
          COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '7 days' AND status='limited')::int AS week_limited
        FROM ex237_assistant_requests`,
    sql`SELECT COALESCE(model,'') AS model,COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,COALESCE(SUM(output_tokens),0)::bigint AS output_tokens
        FROM ex237_assistant_requests WHERE created_at>NOW()-INTERVAL '30 days' GROUP BY model`,
    sql`SELECT a.id,a.user_id,a.room_id,a.trigger,a.status,a.error,a.input_tokens,a.output_tokens,a.model,a.created_at,
               p.display_name,g.label AS group_label,
               COALESCE(q.ciphertext,tq.ciphertext) AS q_ct,COALESCE(q.iv,tq.iv) AS q_iv,COALESCE(q.auth_tag,tq.auth_tag) AS q_tag,
               COALESCE(ans.ciphertext,ta.ciphertext) AS a_ct,COALESCE(ans.iv,ta.iv) AS a_iv,COALESCE(ans.auth_tag,ta.auth_tag) AS a_tag
        FROM ex237_assistant_requests a
        LEFT JOIN ex237_user_profiles p ON p.user_id::text=a.user_id
        LEFT JOIN ex237_chat_rooms r ON r.id::text=a.room_id
        LEFT JOIN ex237_groups g ON g.id=r.group_id
        LEFT JOIN ex237_chat_messages q ON q.id::text=a.question_message_id
        LEFT JOIN ex237_chat_messages ans ON ans.id::text=a.answer_message_id
        LEFT JOIN ex237_tutor_messages tq ON a.trigger='tutor' AND tq.id::text=a.question_message_id
        LEFT JOIN ex237_tutor_messages ta ON a.trigger='tutor' AND ta.id::text=a.answer_message_id
        WHERE a.status<>'skipped'
        ORDER BY a.created_at DESC
        LIMIT 30`,
  ]);

  let costUsd = 0;
  let costKnown = true;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of usageRows as any[]) {
    const input = Number(row.input_tokens || 0);
    const output = Number(row.output_tokens || 0);
    inputTokens += input;
    outputTokens += output;
    const cost = estimateCostUsd(String(row.model || ''), input, output);
    if (cost === null) {
      if (input || output) costKnown = false;
    } else costUsd += cost;
  }

  const decrypt = (roomId: string, ct: string | null, iv: string | null, tag: string | null) => {
    if (!ct || !iv || !tag) return null;
    try {
      return decryptMessage(roomId, ct, iv, tag);
    } catch {
      return null;
    }
  };

  const keyFor = (row: any) =>
    row.trigger === 'tutor' ? tutorKey(String(row.user_id || '')) : String(row.room_id);
  const stats: any = (statsRows as any[])[0] || {};
  return {
    configured: assistantConfigured(),
    model: assistantModel(),
    settings,
    stats: {
      day: Number(stats.day_count || 0),
      week: Number(stats.week_count || 0),
      monthAnswered: Number(stats.month_answered || 0),
      weekErrors: Number(stats.week_errors || 0),
      weekLimited: Number(stats.week_limited || 0),
      monthInputTokens: inputTokens,
      monthOutputTokens: outputTokens,
      monthCostUsd: costKnown ? costUsd : null,
    },
    recent: (recentRows as any[]).map(row => ({
      id: row.id,
      createdAt: row.created_at,
      status: row.status,
      trigger: row.trigger,
      error: row.error || null,
      studentName: row.display_name || (row.user_id ? 'Élève' : 'Admin'),
      groupLabel: row.trigger === 'tutor' ? 'Prof IA (privé)' : row.group_label || null,
      question: decrypt(keyFor(row), row.q_ct, row.q_iv, row.q_tag),
      answer: decrypt(keyFor(row), row.a_ct, row.a_iv, row.a_tag),
      costUsd: estimateCostUsd(
        String(row.model || ''),
        Number(row.input_tokens || 0),
        Number(row.output_tokens || 0)
      ),
    })),
  };
}

/* ---------------- Prof IA privé ---------------- */

// Chaque élève a sa propre clé de chiffrement pour sa conversation privée.
export const tutorKey = (userId: string) => `tutor:${userId}`;

export type TutorImage = { mediaType: string; data: string };
export type TutorMessageDto = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  hasImage: boolean;
  createdAt: string;
};

const TUTOR_HISTORY = 12;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function tutorPrompt(context: { classLabel?: string | null; examType?: string | null }) {
  const where = [
    context.classLabel ? `classe : ${context.classLabel}` : null,
    context.examType && context.examType !== 'AUTRE' ? `examen visé : ${context.examType}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `Tu es le Prof IA d'Exam237, une plateforme camerounaise qui prépare les élèves aux examens officiels (BEPC, Probatoire, Baccalauréat, GCE). Tu parles en privé avec un élève${where ? ` (${where})` : ''}.

Ta méthode, « les indices d'abord », comme un bon enseignant camerounais :
- Pour un exercice, commence par un bref rappel de cours (définition, propriété, formule ou méthode), puis donne un indice ou pose une question qui met l'élève sur la voie. Propose-lui ensuite d'essayer.
- Donne la solution complète, étape par étape, quand l'élève la demande, quand il a déjà proposé une réponse, ou s'il bloque encore après un indice.
- Si l'élève propose une réponse, dis s'il a raison ; sinon, montre précisément où est l'erreur.
- Suis les programmes officiels du Cameroun (MINESEC) et la rédaction attendue aux examens : unités, phrases de conclusion, notations usuelles.
- Explique toujours par toi-même à partir du cours : ne cite jamais de « corrigé officiel » ni de « corrigé harmonisé ».
- Si l'élève envoie la photo d'un exercice, lis l'énoncé avant d'aider. Si la photo est floue ou incomplète, dis ce que tu n'arrives pas à lire.
- Si tu n'es pas sûr d'un résultat, dis-le franchement plutôt que d'inventer.

Format (texte brut sur téléphone) :
- Pas de Markdown (pas de **, de #, de tableaux) ni de LaTeX. Écris les formules simplement : x², √2, 3/4, ×, ÷, ≤, ≥, π, Δ, →.
- Sois concis : environ 80 à 220 mots, davantage seulement pour une solution complète.
- Réponds en français ; si l'élève écrit en anglais, réponds en anglais.

Limites :
- Tu aides uniquement pour les cours, les exercices, les méthodes de travail et l'orientation scolaire. Pour tout autre sujet, réponds en une phrase, gentiment, que tu es là pour les révisions.
- Pour les questions sur un compte, un abonnement ou un paiement, réponds que l'équipe Exam237 répond sur WhatsApp, sans rien inventer.
- L'élève est peut-être mineur : reste bienveillant et adapté à son âge. Ne demande jamais d'informations personnelles (nom complet, téléphone, adresse, photos de lui) et n'en partage pas.
- S'il parle de détresse, de violence, d'abus ou de danger, réponds avec douceur et encourage-le à en parler tout de suite à un adulte de confiance (parent, enseignant, conseiller d'orientation) ou aux secours en cas d'urgence.`;
}

function tutorDto(row: any, userId: string): TutorMessageDto {
  let text = '';
  try {
    text = decryptMessage(tutorKey(userId), row.ciphertext, row.iv, row.auth_tag);
  } catch {
    text = 'Message illisible';
  }
  const created =
    row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
  return {
    id: String(row.id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    text,
    hasImage: row.has_image === true,
    createdAt: Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString(),
  };
}

async function storeTutorMessage(
  userId: string,
  role: 'user' | 'assistant',
  text: string,
  hasImage = false
) {
  const id = crypto.randomUUID();
  const encrypted = encryptMessage(tutorKey(userId), text);
  const rows: any[] = await db()`
    INSERT INTO ex237_tutor_messages(id,user_id,role,ciphertext,iv,auth_tag,has_image,created_at)
    VALUES(${id},${userId},${role},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${hasImage},NOW())
    RETURNING id,role,ciphertext,iv,auth_tag,has_image,created_at`;
  return tutorDto(rows[0], userId);
}

export async function tutorHistory(userId: string, limit = 60) {
  await ensureSchema();
  const rows: any[] = await db()`
    SELECT id,role,ciphertext,iv,auth_tag,has_image,created_at FROM ex237_tutor_messages
    WHERE user_id=${userId} ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.reverse().map(row => tutorDto(row, userId));
}

export async function clearTutorHistory(userId: string) {
  await ensureSchema();
  await db()`DELETE FROM ex237_tutor_messages WHERE user_id=${userId}`;
}

export async function tutorUsedToday(userId: string) {
  await ensureAssistantTables();
  const rows: any[] = await db()`SELECT COUNT(*)::int AS n FROM ex237_assistant_requests
    WHERE user_id=${userId} AND created_at>NOW()-INTERVAL '1 day' AND status IN ('pending','answered','error')`;
  return Number(rows[0]?.n || 0);
}

export function validTutorImage(image: unknown): TutorImage | null {
  const value: any = image;
  if (!value || typeof value !== 'object') return null;
  const mediaType = String(value.mediaType || '');
  const data = String(value.data || '');
  if (!IMAGE_TYPES.includes(mediaType)) return null;
  // Environ 3 Mo d'image au maximum (le navigateur la réduit avant l'envoi).
  if (!data || data.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  return { mediaType, data };
}

export async function runTutor(input: {
  userId: string;
  text: string;
  image: TutorImage | null;
  dailyLimit: number;
  classLabel: string | null;
  examType: string | null;
}) {
  const sql = db();
  await ensureAssistantTables();
  await ensureSchema();

  const used = await tutorUsedToday(input.userId);
  if (used >= input.dailyLimit)
    return { status: 'limited' as const, used, limit: input.dailyLimit };

  const questionText = input.text.trim() || (input.image ? 'Aide-moi avec cet exercice.' : '');
  const previous: any[] = await sql`
    SELECT id,role,ciphertext,iv,auth_tag,has_image,created_at FROM ex237_tutor_messages
    WHERE user_id=${input.userId} ORDER BY created_at DESC LIMIT ${TUTOR_HISTORY}`;
  const question = await storeTutorMessage(input.userId, 'user', questionText, !!input.image);
  const requestId = crypto.randomUUID();
  const model = assistantModel();
  await sql`INSERT INTO ex237_assistant_requests(id,user_id,room_id,question_message_id,trigger,status,model,created_at)
            VALUES(${requestId},${input.userId},'tutor',${question.id},'tutor','pending',${model},NOW())`;

  // Historique (sans les anciennes photos, qui ne sont pas conservées) + nouvelle question.
  const history = previous
    .reverse()
    .map(row => tutorDto(row, input.userId))
    .map(m => ({
      role: m.role,
      content: m.hasImage ? `[Photo d'exercice envoyée plus tôt]\n${m.text}` : m.text,
    }));
  const messages: ClaudeMessage[] = [];
  for (const item of history) {
    const last = messages[messages.length - 1];
    if (last && last.role === item.role && typeof last.content === 'string')
      last.content = `${last.content}\n\n${item.content}`;
    else messages.push({ role: item.role, content: item.content });
  }
  while (messages.length && messages[0].role === 'assistant') messages.shift();
  const current: ClaudeContent = input.image
    ? [
        {
          type: 'image',
          source: { type: 'base64', media_type: input.image.mediaType, data: input.image.data },
        },
        { type: 'text', text: questionText },
      ]
    : questionText;
  if (messages.length && messages[messages.length - 1].role === 'user') {
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = {
      role: 'user',
      content: Array.isArray(current)
        ? [{ type: 'text', text: String(last.content) }, ...current]
        : `${last.content}\n\n${current}`,
    };
  } else messages.push({ role: 'user', content: current });

  try {
    const result = await callClaude(
      tutorPrompt({ classLabel: input.classLabel, examType: input.examType }),
      messages
    );
    let answerText = toPlainText(result.text);
    if (result.stopReason === 'refusal' || !answerText)
      answerText =
        'Je ne peux pas répondre à ce message. Pose-moi plutôt une question sur tes cours ou un exercice, je t’explique volontiers !';
    const answer = await storeTutorMessage(input.userId, 'assistant', answerText);
    await sql`UPDATE ex237_assistant_requests SET status='answered',answer_message_id=${answer.id},input_tokens=${result.inputTokens},output_tokens=${result.outputTokens},model=${result.model},answered_at=NOW() WHERE id=${requestId}`;
    return {
      status: 'answered' as const,
      question,
      answer,
      used: used + 1,
      limit: input.dailyLimit,
    };
  } catch (error: any) {
    const message = String(error?.message || error || 'Erreur inconnue').slice(0, 500);
    console.error('Prof IA:', message);
    await sql`UPDATE ex237_assistant_requests SET status='error',error=${message} WHERE id=${requestId}`;
    return { status: 'error' as const, question, used: used + 1, limit: input.dailyLimit };
  }
}
