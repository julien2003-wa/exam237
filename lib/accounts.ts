import { db } from './db';
import { ensureSchema } from './schema';

/*
  Suppression d'un élève (par l'admin ou par l'élève lui-même).

  La table des comptes (jl_users) est partagée avec d'autres applications (JulienLab) :
  - toutes les données Exam237 de l'élève sont effacées en une seule fois ;
  - le compte lui-même n'est supprimé que s'il a été créé par Exam237 (rôle « student »)
    et qu'aucune autre application ne s'en sert. Sinon il est seulement retiré d'Exam237.
*/

export class AccountError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Reference = { schema: string; table: string; column: string; notNull: boolean };

// Tables gérées une par une ci-dessous (ordre important pour les messages du chat).
const HANDLED = new Set([
  'ex237_chat_messages',
  'ex237_chat_reactions',
  'ex237_chat_reports',
  'ex237_assistant_requests',
  'ex237_tutor_messages',
  'ex237_user_papers',
  'ex237_premium_log',
  'ex237_content_reports',
  'ex237_content_views',
  'ex237_promo_events',
  'ex237_password_reset_tokens',
  'ex237_reset_links',
  'ex237_login_attempts',
  'ex237_user_profiles',
]);

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const ownedByExam237 = (table: string) => table.startsWith('ex237_') || table === 'jl_sessions';

// Toutes les colonnes de la base qui pointent vers un compte (clés étrangères vers jl_users).
async function userReferences(): Promise<Reference[]> {
  const rows: any[] = await db()`
    SELECT n.nspname AS schema_name, cl.relname AS table_name, a.attname AS column_name, a.attnotnull AS not_null
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'jl_users'::regclass`;
  return rows
    .map(r => ({
      schema: String(r.schema_name),
      table: String(r.table_name),
      column: String(r.column_name),
      notNull: r.not_null === true || r.not_null === 't',
    }))
    .filter(r => r.table !== 'jl_users');
}

export async function removeStudentAccount(
  userId: string
): Promise<{ deleted: boolean; sharedWith: string[] }> {
  await ensureSchema();
  const sql = db();
  const users: any[] = await sql`SELECT id,email,role FROM jl_users WHERE id=${userId} LIMIT 1`;
  const user = users[0];
  if (!user) throw new AccountError('Élève introuvable.', 404);
  if (user.role === 'admin')
    throw new AccountError('Ce compte ne peut pas être supprimé ici.', 403);

  const tableRows: any[] = await sql`
    SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()`;
  const tables = new Set(tableRows.map(r => String(r.table_name)));
  const has = (name: string) => tables.has(name);

  // Le compte sert-il à une autre application ?
  const references = await userReferences();
  const sharedWith: string[] = [];
  for (const ref of references.filter(r => !ownedByExam237(r.table))) {
    const hit: any[] = await sql.query(
      `SELECT 1 FROM ${quote(ref.schema)}.${quote(ref.table)} WHERE ${quote(ref.column)}=$1 LIMIT 1`,
      [userId]
    );
    if (hit.length && !sharedWith.includes(ref.table)) sharedWith.push(ref.table);
  }
  const keepAccount = user.role !== 'student' || sharedWith.length > 0;

  const queries: any[] = [];
  if (has('ex237_chat_messages')) {
    // D'abord ce qui dépend des messages de l'élève, puis les messages eux-mêmes.
    if (has('ex237_chat_reactions'))
      queries.push(
        sql`DELETE FROM ex237_chat_reactions WHERE message_id IN (SELECT id FROM ex237_chat_messages WHERE sender_user_id=${userId})`
      );
    if (has('ex237_chat_reports'))
      queries.push(
        sql`DELETE FROM ex237_chat_reports WHERE reporter_user_id=${userId} OR message_id IN (SELECT id FROM ex237_chat_messages WHERE sender_user_id=${userId})`
      );
    queries.push(
      sql`UPDATE ex237_chat_messages SET reply_to_id=NULL WHERE reply_to_id IN (SELECT id FROM ex237_chat_messages WHERE sender_user_id=${userId})`
    );
    queries.push(sql`DELETE FROM ex237_chat_messages WHERE sender_user_id=${userId}`);
  }
  if (has('ex237_chat_reactions'))
    queries.push(sql`DELETE FROM ex237_chat_reactions WHERE user_id=${userId}`);
  if (has('ex237_assistant_requests'))
    queries.push(sql`DELETE FROM ex237_assistant_requests WHERE user_id=${userId}`);
  if (has('ex237_tutor_messages'))
    queries.push(sql`DELETE FROM ex237_tutor_messages WHERE user_id=${userId}`);
  if (has('ex237_user_papers'))
    queries.push(sql`DELETE FROM ex237_user_papers WHERE user_id=${userId}`);
  if (has('ex237_premium_log'))
    queries.push(sql`DELETE FROM ex237_premium_log WHERE user_id=${userId}`);
  if (has('ex237_content_reports'))
    queries.push(sql`UPDATE ex237_content_reports SET user_id=NULL WHERE user_id=${userId}`);
  if (has('ex237_content_views'))
    queries.push(sql`UPDATE ex237_content_views SET user_id=NULL WHERE user_id=${userId}`);
  if (has('ex237_promo_events'))
    queries.push(sql`UPDATE ex237_promo_events SET user_id=NULL WHERE user_id=${userId}`);
  if (has('ex237_password_reset_tokens'))
    queries.push(sql`DELETE FROM ex237_password_reset_tokens WHERE user_id=${userId}`);
  if (has('ex237_reset_links'))
    queries.push(sql`DELETE FROM ex237_reset_links WHERE user_id=${userId}`);
  if (has('ex237_login_attempts'))
    queries.push(sql`DELETE FROM ex237_login_attempts WHERE key=${`email:${user.email}`}`);

  // Autres tables d'Exam237 liées au compte (créées à la main dans la base, par exemple).
  for (const ref of references) {
    if (!ref.table.startsWith('ex237_') || HANDLED.has(ref.table)) continue;
    const target = `${quote(ref.schema)}.${quote(ref.table)}`;
    queries.push(
      ref.notNull
        ? sql.query(`DELETE FROM ${target} WHERE ${quote(ref.column)}=$1`, [userId])
        : sql.query(
            `UPDATE ${target} SET ${quote(ref.column)}=NULL WHERE ${quote(ref.column)}=$1`,
            [userId]
          )
    );
  }

  if (has('ex237_user_profiles'))
    queries.push(sql`DELETE FROM ex237_user_profiles WHERE user_id=${userId}`);
  if (!keepAccount) {
    queries.push(sql`DELETE FROM jl_sessions WHERE user_id=${userId}`);
    queries.push(sql`DELETE FROM jl_users WHERE id=${userId} AND role='student'`);
  }

  await sql.transaction(queries);
  return { deleted: !keepAccount, sharedWith };
}

// Message clair pour l'admin quand la base refuse quand même la suppression.
export function deletionErrorMessage(error: any) {
  if (error instanceof AccountError) return { message: error.message, status: error.status };
  if (error?.code === '23503')
    return {
      message: `Suppression impossible : ce compte est encore utilisé dans la table « ${error.table || 'inconnue'} ».`,
      status: 409,
    };
  return { message: `Suppression impossible : ${String(error?.message || error)}`, status: 500 };
}
