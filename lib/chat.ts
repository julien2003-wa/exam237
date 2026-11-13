import { decryptMessage } from './crypto';

export const ASSISTANT_NAME = 'Assistant IA Exam237';

// Réactions rapides proposées dans le chat.
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/* ---------------- Format d'un message envoyé au navigateur ---------------- */

export type ChatMessageDto = {
  id: string;
  roomId: string;
  senderUserId: string | null;
  senderName: string;
  isAssistant: boolean;
  text: string;
  replyToId: string | null;
  replySender: string | null;
  replyText: string | null;
  isPinned: boolean;
  createdAt: string;
};

const iso = (value: unknown) => {
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

export function messageDto(row: any, roomId: string): ChatMessageDto {
  let text = 'Message illisible';
  let replyText: string | null = null;
  try {
    text = decryptMessage(roomId, row.ciphertext, row.iv, row.auth_tag);
  } catch {}
  if (row.reply_ciphertext) {
    try {
      replyText = decryptMessage(roomId, row.reply_ciphertext, row.reply_iv, row.reply_auth_tag);
    } catch {
      replyText = null;
    }
  }
  return {
    id: String(row.id),
    roomId: String(row.room_id || roomId),
    senderUserId: row.sender_user_id ? String(row.sender_user_id) : null,
    senderName: row.sender_name || 'Élève',
    isAssistant: !row.sender_user_id && row.sender_name === ASSISTANT_NAME,
    text,
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    replySender: row.reply_sender || null,
    replyText,
    isPinned: row.is_pinned === true,
    createdAt: iso(row.created_at),
  };
}

/* ---------------- Protection des élèves (mineurs) ---------------- */

// Insultes courantes ; l'admin peut ajouter ses propres mots dans « Réglages ».
const DEFAULT_BANNED = [
  'connard',
  'connasse',
  'salope',
  'salaud',
  'pute',
  'putain',
  'enculé',
  'encule',
  'enfoiré',
  'enfoire',
  'fdp',
  'ntm',
  'nique',
  'niquer',
  'bâtard',
  'batard',
  'pédé',
  'fils de pute',
  'ta gueule',
  'ferme ta gueule',
];

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PHONE =
  /(?:\+|00)?237[\s.-]*\d(?:[\s.-]*\d){7,8}|(?<!\d)6[\s.-]*[2-9](?:[\s.-]*\d){7}(?!\d)/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/gi;
const CONTACT_LINK =
  /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me)\/\S*/gi;

// Masque les numéros, e-mails et liens WhatsApp/Telegram, et les insultes.
export function protectStudentText(text: string, extraBanned: string[] = []) {
  let value = text
    .replace(CONTACT_LINK, '[lien masqué]')
    .replace(EMAIL, '[e-mail masqué]')
    .replace(PHONE, '[numéro masqué]');

  const words = [
    ...new Set([...DEFAULT_BANNED, ...extraBanned].map(w => w.trim()).filter(Boolean)),
  ];
  if (words.length) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])(${words
        .sort((a, b) => b.length - a.length)
        .map(escapeRegex)
        .join('|')})(?![\\p{L}\\p{N}])`,
      'giu'
    );
    value = value.replace(
      pattern,
      match => `${match.charAt(0)}${'*'.repeat(Math.max(2, match.length - 1))}`
    );
  }
  return { text: value, changed: value !== text };
}
