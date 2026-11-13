import crypto from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { db, isUuid } from '@/lib/db';
import { encryptMessage, transportKey } from '@/lib/crypto';
import { getViewer, isActiveStudent, type Viewer } from '@/lib/auth';
import { isPremiumViewer } from '@/lib/access';
import { messageDto, protectStudentText, REACTIONS, type ChatMessageDto } from '@/lib/chat';
import {
  chatChannel,
  createRealtimeToken,
  publishChatMessage,
  publishRoomEvent,
  realtimeConfigured,
} from '@/lib/realtime';
import { getSiteSettings } from '@/lib/settings';
import { ensureSchema } from '@/lib/schema';
import {
  ASSISTANT_NAME,
  assistantConfigured,
  dailyLimitFor,
  detectAssistantTrigger,
  getAssistantSettings,
  runAssistant,
  type AssistantTrigger,
} from '@/lib/assistant';

// Laisse le temps à l'assistant de répondre après l'envoi du message (voir after()).
export const maxDuration = 60;

const json = (data: Record<string, unknown>, status = 200) => NextResponse.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);

const MESSAGE_COLUMNS = `m.id,m.room_id,m.sender_user_id,m.sender_name,m.ciphertext,m.iv,m.auth_tag,m.reply_to_id,m.is_pinned,m.created_at,
  r.sender_name AS reply_sender,r.ciphertext AS reply_ciphertext,r.iv AS reply_iv,r.auth_tag AS reply_auth_tag`;

// La réponse de l'assistant est préparée après l'envoi de la réponse HTTP :
// l'élève n'attend pas, le message de l'assistant arrive ensuite dans le chat.
function inBackground(task: () => Promise<unknown>) {
  const run = () => task().catch(e => console.error('Tâche (arrière-plan):', e));
  try {
    after(run);
  } catch {
    void run();
  }
}

function scheduleAssistant(
  roomId: string,
  questionId: string,
  userId: string | null,
  trigger: AssistantTrigger,
  dailyLimit?: number
) {
  inBackground(() => runAssistant({ roomId, questionId, userId, trigger, dailyLimit }));
}

async function roomForStudent(groupId: string) {
  const rows =
    await db()`SELECT id,title FROM ex237_chat_rooms WHERE group_id=${groupId} AND active=TRUE LIMIT 1`;
  return rows[0] as any;
}

// Salon de la discussion : celui du groupe pour un élève, celui choisi pour l'admin.
async function resolveRoom(viewer: Viewer, requested: string) {
  if (viewer.role === 'admin') {
    if (!isUuid(requested)) return null;
    const rows = await db()`SELECT id FROM ex237_chat_rooms WHERE id=${requested} LIMIT 1`;
    return rows[0] ? String((rows[0] as any).id) : null;
  }
  if (!isActiveStudent(viewer) || !viewer.groupId) return null;
  const room = await roomForStudent(viewer.groupId);
  return room ? String(room.id) : null;
}

function reactorId(viewer: Viewer) {
  return viewer.role === 'admin' ? 'admin' : String(viewer.userId || '');
}

// Réactions groupées par message : [{ emoji, count }] et la réaction de l'utilisateur.
async function attachReactions(messages: ChatMessageDto[], viewer: Viewer) {
  if (!messages.length) return messages.map(m => ({ ...m, reactions: [], myReaction: null }));
  await ensureSchema();
  const ids = messages.map(m => m.id);
  const me = reactorId(viewer);
  const rows: any[] = await db()`
    SELECT message_id::text AS message_id,emoji,COUNT(*)::int AS n,BOOL_OR(user_id=${me}) AS mine
    FROM ex237_chat_reactions WHERE message_id=ANY(${ids}::uuid[])
    GROUP BY message_id,emoji ORDER BY MIN(created_at)`;
  const byMessage = new Map<
    string,
    { reactions: Array<{ emoji: string; count: number }>; mine: string | null }
  >();
  for (const row of rows) {
    const entry = byMessage.get(row.message_id) || { reactions: [], mine: null };
    entry.reactions.push({ emoji: row.emoji, count: Number(row.n) });
    if (row.mine) entry.mine = row.emoji;
    byMessage.set(row.message_id, entry);
  }
  return messages.map(m => ({
    ...m,
    reactions: byMessage.get(m.id)?.reactions || [],
    myReaction: byMessage.get(m.id)?.mine || null,
  }));
}

async function reactionSummary(messageId: string) {
  const rows: any[] = await db()`
    SELECT emoji,COUNT(*)::int AS n FROM ex237_chat_reactions WHERE message_id=${messageId}
    GROUP BY emoji ORDER BY MIN(created_at)`;
  return rows.map(r => ({ emoji: r.emoji, count: Number(r.n) }));
}

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return fail('Non connecté.', 401);
  const action = req.nextUrl.searchParams.get('action') || 'messages';
  const sql = db();

  if (action === 'token') {
    if (viewer.role === 'student' && !isActiveStudent(viewer))
      return fail('Compte non actif.', 403);
    let capability: Record<string, string[]> = {};
    if (viewer.role === 'admin')
      capability = { 'exam237:chat:*': ['subscribe', 'publish', 'presence'] };
    else {
      const room = viewer.groupId ? await roomForStudent(viewer.groupId) : null;
      if (!room) return fail('Aucun chat disponible.', 404);
      capability[chatChannel(room.id)] = ['subscribe', 'publish', 'presence'];
    }
    const token = await createRealtimeToken(viewer.userId || 'admin', capability);
    if (!token) return fail('Temps réel non configuré.', 503);
    return NextResponse.json(token);
  }

  if (action === 'rooms') {
    if (viewer.role === 'admin') {
      const rooms =
        await sql`SELECT r.id,r.title,g.label AS group_label,r.active,(SELECT COUNT(*)::int FROM ex237_chat_messages m WHERE m.room_id=r.id) AS message_count FROM ex237_chat_rooms r JOIN ex237_groups g ON g.id=r.group_id ORDER BY g.display_order,g.label`;
      return json({ rooms });
    }
    if (!isActiveStudent(viewer) || !viewer.groupId) return json({ rooms: [] });
    const room = await roomForStudent(viewer.groupId);
    return json({ rooms: room ? [room] : [] });
  }

  if (action === 'messages') {
    const roomId = await resolveRoom(viewer, String(req.nextUrl.searchParams.get('roomId') || ''));
    if (!roomId) return fail('Chat non autorisé.', 403);
    const before = String(req.nextUrl.searchParams.get('before') || '');
    const afterParam = String(req.nextUrl.searchParams.get('after') || '');
    const validDate = (v: string) => !!v && !Number.isNaN(Date.parse(v));
    let rows: any[];
    if (validDate(afterParam)) {
      // Rattrapage rapide : seulement les messages arrivés depuis le dernier connu.
      rows = await sql.query(
        `SELECT ${MESSAGE_COLUMNS} FROM ex237_chat_messages m LEFT JOIN ex237_chat_messages r ON r.id=m.reply_to_id
         WHERE m.room_id=$1 AND m.created_at>$2::timestamptz ORDER BY m.created_at ASC LIMIT 100`,
        [roomId, afterParam]
      );
    } else if (validDate(before)) {
      rows = await sql.query(
        `SELECT ${MESSAGE_COLUMNS} FROM ex237_chat_messages m LEFT JOIN ex237_chat_messages r ON r.id=m.reply_to_id
         WHERE m.room_id=$1 AND m.created_at<$2::timestamptz ORDER BY m.created_at DESC LIMIT 50`,
        [roomId, before]
      );
      rows.reverse();
    } else {
      rows = await sql.query(
        `SELECT ${MESSAGE_COLUMNS} FROM ex237_chat_messages m LEFT JOIN ex237_chat_messages r ON r.id=m.reply_to_id
         WHERE m.room_id=$1 ORDER BY m.created_at DESC LIMIT 50`,
        [roomId]
      );
      rows.reverse();
    }
    const messages = await attachReactions(
      rows.map(row => messageDto(row, roomId)),
      viewer
    );
    return json({
      messages,
      roomId,
      realtimeConfigured: realtimeConfigured(),
      transportKey: transportKey(roomId).toString('base64url'),
      assistantName: ASSISTANT_NAME,
      assistantAvailable: assistantConfigured(),
    });
  }

  return fail('Action inconnue.', 404);
}

export async function POST(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return fail('Non connecté.', 401);
  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const action = String(body.action || 'send');
  const sql = db();
  const isStudent = viewer.role === 'student';
  if (isStudent && !isActiveStudent(viewer)) return fail('Compte non actif.', 403);

  if (action === 'send') {
    const raw = String(body.text || '').trim();
    if (!raw) return fail('Message vide.');
    if (raw.length > 1000) return fail('Message trop long. Maximum : 1000 caractères.');
    const roomId = await resolveRoom(viewer, String(body.roomId || ''));
    if (!roomId) return fail('Chat non autorisé.', 403);

    if (isStudent && viewer.userId) {
      const checks: any[] = await sql`
        SELECT (SELECT chat_muted_until FROM ex237_user_profiles WHERE user_id=${viewer.userId}) AS muted_until,
               (SELECT COUNT(*)::int FROM ex237_chat_messages WHERE sender_user_id=${viewer.userId} AND created_at>NOW()-INTERVAL '10 seconds') AS recent`;
      const until = checks[0]?.muted_until;
      if (until && new Date(until).getTime() > Date.now())
        return fail('Tu ne peux pas envoyer de message pour le moment.', 403);
      if (Number(checks[0]?.recent || 0) >= 8)
        return fail('Tu envoies des messages trop rapidement.', 429);
    }

    const replyToId = isUuid(body.replyToId) ? String(body.replyToId) : null;
    let reply: any = null;
    if (replyToId) {
      const rows: any[] =
        await sql`SELECT id,sender_user_id,sender_name,ciphertext,iv,auth_tag FROM ex237_chat_messages WHERE id=${replyToId} AND room_id=${roomId} LIMIT 1`;
      reply = rows[0];
      if (!reply) return fail('Message de réponse introuvable.');
    }

    // Numéros, e-mails, liens WhatsApp et insultes masqués pour les élèves (mineurs).
    const text = isStudent
      ? protectStudentText(raw, (await getSiteSettings()).bannedWords).text
      : raw;
    const id = crypto.randomUUID();
    const encrypted = encryptMessage(roomId, text);
    const senderName = viewer.role === 'admin' ? 'Exam237' : viewer.displayName || 'Élève';
    const inserted: any[] = await sql`
      INSERT INTO ex237_chat_messages(id,room_id,sender_user_id,sender_name,ciphertext,iv,auth_tag,reply_to_id,is_pinned,created_at)
      VALUES(${id},${roomId},${viewer.userId},${senderName},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${replyToId},FALSE,NOW())
      RETURNING created_at`;

    const message = {
      ...messageDto(
        {
          id,
          room_id: roomId,
          sender_user_id: viewer.userId,
          sender_name: senderName,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          auth_tag: encrypted.authTag,
          reply_to_id: replyToId,
          is_pinned: false,
          created_at: inserted[0]?.created_at,
          reply_sender: reply?.sender_name || null,
          reply_ciphertext: reply?.ciphertext || null,
          reply_iv: reply?.iv || null,
          reply_auth_tag: reply?.auth_tag || null,
        },
        roomId
      ),
      reactions: [],
      myReaction: null,
      nonce: String(body.nonce || '').slice(0, 64) || null,
    };

    try {
      await publishChatMessage(roomId, message);
    } catch (e) {
      console.error('Temps réel (envoi):', e);
    }

    // @assistant, réponse à l'assistant ou (mode automatique) question d'un élève.
    let assistantTriggered = false;
    let assistantBlocked: string | null = null;
    try {
      const trigger = await detectAssistantTrigger({
        text,
        replyToId,
        roomId,
        fromStudent: isStudent,
      });
      if (trigger && !isStudent) {
        scheduleAssistant(roomId, id, null, trigger);
        assistantTriggered = trigger !== 'auto';
      } else if (trigger) {
        const premium = isPremiumViewer(viewer);
        const limit = dailyLimitFor(await getAssistantSettings(), premium);
        if (trigger === 'auto' && !premium) {
          // Le mode automatique ne répond qu'aux membres Premium.
        } else if (limit <= 0) {
          assistantBlocked = 'premium';
        } else {
          scheduleAssistant(roomId, id, viewer.userId, trigger, limit);
          assistantTriggered = trigger !== 'auto';
        }
      }
    } catch (e) {
      console.error('Assistant trigger', e);
    }

    return json({ ok: true, id, message, assistant: assistantTriggered, assistantBlocked }, 201);
  }

  // Réaction rapide (une par personne et par message) ; même émoji = on l'enlève.
  if (action === 'react') {
    const messageId = String(body.messageId || '');
    const emoji = String(body.emoji || '');
    if (!isUuid(messageId) || !REACTIONS.includes(emoji)) return fail('Réaction invalide.');
    const rows: any[] = await sql`
      SELECT m.room_id,r.group_id FROM ex237_chat_messages m JOIN ex237_chat_rooms r ON r.id=m.room_id
      WHERE m.id=${messageId} LIMIT 1`;
    const message = rows[0];
    if (!message) return fail('Message introuvable.', 404);
    if (isStudent && String(message.group_id) !== String(viewer.groupId))
      return fail('Non autorisé.', 403);
    await ensureSchema();
    const me = reactorId(viewer);
    const existing: any[] =
      await sql`SELECT emoji FROM ex237_chat_reactions WHERE message_id=${messageId} AND user_id=${me} LIMIT 1`;
    let mine: string | null = emoji;
    if (existing[0]?.emoji === emoji) {
      await sql`DELETE FROM ex237_chat_reactions WHERE message_id=${messageId} AND user_id=${me}`;
      mine = null;
    } else {
      await sql`INSERT INTO ex237_chat_reactions(message_id,user_id,emoji,created_at) VALUES(${messageId},${me},${emoji},NOW())
                ON CONFLICT (message_id,user_id) DO UPDATE SET emoji=EXCLUDED.emoji,created_at=NOW()`;
    }
    const reactions = await reactionSummary(messageId);
    try {
      await publishRoomEvent(String(message.room_id), 'reaction', {
        messageId,
        reactions,
        userId: me,
        emoji: mine,
      });
    } catch {}
    return json({ ok: true, reactions, myReaction: mine });
  }

  if (action === 'report') {
    if (!isStudent || !viewer.userId) return fail('Non autorisé.', 403);
    const messageId = String(body.messageId || '');
    if (!isUuid(messageId)) return fail('Message introuvable.', 404);
    const reason =
      String(body.reason || '')
        .trim()
        .slice(0, 300) || null;
    const rows = await sql`SELECT m.id,m.sender_user_id FROM ex237_chat_messages m
      JOIN ex237_chat_rooms r ON r.id=m.room_id
      WHERE m.id=${messageId} AND r.group_id=${viewer.groupId}
      LIMIT 1`;
    if (!rows[0]) return fail('Message introuvable.', 404);
    if ((rows[0] as any).sender_user_id === viewer.userId)
      return fail('Tu ne peux pas signaler ton propre message.');
    const already =
      await sql`SELECT id FROM ex237_chat_reports WHERE message_id=${messageId} AND reporter_user_id=${viewer.userId} LIMIT 1`;
    if (already[0]) return json({ ok: true, already: true });
    await sql`INSERT INTO ex237_chat_reports(id,message_id,reporter_user_id,reason,created_at)
      VALUES(${crypto.randomUUID()},${messageId},${viewer.userId},${reason},NOW())`;
    return json({ ok: true });
  }

  if (action === 'delete_many' || action === 'delete') {
    const rawIds =
      action === 'delete'
        ? [body.messageId]
        : Array.isArray(body.messageIds)
          ? body.messageIds
          : [];
    const messageIds = Array.from(
      new Set(rawIds.map((value: any) => String(value || '').trim()).filter(isUuid))
    ).slice(0, 50) as string[];
    if (!messageIds.length) return fail('Aucun message sélectionné.');

    const found: any[] = await sql`
      SELECT m.id,m.room_id,m.sender_user_id,r.group_id FROM ex237_chat_messages m
      JOIN ex237_chat_rooms r ON r.id=m.room_id WHERE m.id=ANY(${messageIds}::uuid[])`;
    if (found.length !== messageIds.length)
      return fail('Un message sélectionné est introuvable.', 404);
    if (isStudent) {
      const allowed = found.every(
        m =>
          String(m.sender_user_id) === String(viewer.userId) &&
          String(m.group_id) === String(viewer.groupId)
      );
      if (!allowed) return fail('Tu peux supprimer uniquement tes propres messages.', 403);
    }
    const roomId = String(found[0].room_id);
    if (found.some(m => String(m.room_id) !== roomId))
      return fail('Les messages doivent appartenir à la même discussion.');

    await ensureSchema();
    await sql`DELETE FROM ex237_chat_reports WHERE message_id=ANY(${messageIds}::uuid[])`;
    await sql`DELETE FROM ex237_chat_reactions WHERE message_id=ANY(${messageIds}::uuid[])`;
    await sql`UPDATE ex237_chat_messages SET reply_to_id=NULL WHERE reply_to_id=ANY(${messageIds}::uuid[])`;
    await sql`DELETE FROM ex237_chat_messages WHERE id=ANY(${messageIds}::uuid[])`;
    try {
      await publishRoomEvent(roomId, 'message', { deletedIds: messageIds, roomId });
    } catch {}
    return json({ ok: true, deleted: messageIds.length });
  }

  if (viewer.role !== 'admin') return fail('Non autorisé.', 403);

  if (action === 'pin') {
    const messageId = String(body.messageId || '');
    if (!isUuid(messageId)) return fail('Message invalide.');
    const pinned = body.pinned !== false;
    const rows =
      await sql`UPDATE ex237_chat_messages SET is_pinned=${pinned} WHERE id=${messageId} RETURNING room_id`;
    const roomId = (rows[0] as any)?.room_id;
    if (roomId) {
      try {
        await publishRoomEvent(String(roomId), 'pin', { messageId, pinned });
      } catch {}
    }
    return json({ ok: true });
  }

  if (action === 'mute') {
    const userId = String(body.userId || '');
    if (!isUuid(userId)) return fail('Élève invalide.');
    const minutes = Math.max(1, Math.min(10080, Number(body.minutes) || 60));
    await sql`UPDATE ex237_user_profiles SET chat_muted_until=NOW()+(${minutes}*INTERVAL '1 minute'),updated_at=NOW() WHERE user_id=${userId}`;
    return json({ ok: true });
  }

  // L'admin demande à l'assistant de répondre à n'importe quel message du chat.
  if (action === 'assistant_reply') {
    if (!assistantConfigured())
      return fail('Assistant non configuré : ajoute ANTHROPIC_API_KEY dans Vercel.', 409);
    const messageId = String(body.messageId || '');
    if (!isUuid(messageId)) return fail('Message introuvable.', 404);
    const rows = await sql`SELECT room_id FROM ex237_chat_messages WHERE id=${messageId} LIMIT 1`;
    const message: any = rows[0];
    if (!message) return fail('Message introuvable.', 404);
    scheduleAssistant(String(message.room_id), messageId, null, 'admin');
    return json({ ok: true });
  }

  return fail('Action inconnue.', 404);
}
