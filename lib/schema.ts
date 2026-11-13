import { db } from './db';

/*
  Tables et colonnes ajoutées par la V6, créées automatiquement au premier usage.
  Tout est additif : aucune donnée existante n'est supprimée, et l'ancienne version
  du site continue de fonctionner sur la même base (elle ignore ces ajouts).
  Une seule requête par démarrage d'instance une fois la base à jour.
*/

const SCHEMA_VERSION = '6.0';

let ready: Promise<void> | null = null;

// Crée une table avec ses clés étrangères ; si la base refuse une clé (type différent),
// la table est créée sans elle : le site continue de fonctionner.
async function createTable(withKeys: string, withoutKeys: string) {
  const sql = db();
  try {
    await sql.query(withKeys);
  } catch {
    await sql.query(withoutKeys);
  }
}

async function addMissingColumns() {
  const sql = db();
  const wanted: Array<[table: string, column: string, type: string]> = [
    ['ex237_corrections', 'reviewer_name', 'TEXT'],
    ['ex237_papers', 'duration_minutes', 'INTEGER'],
  ];
  const rows: any[] = await sql`
    SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name IN ('ex237_corrections','ex237_papers')`;
  const existing = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
  for (const [table, column, type] of wanted) {
    if (existing.has(`${table}.${column}`)) continue;
    // Noms fixes ci-dessus (jamais issus d'une saisie) : la requête brute est sûre.
    await sql.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
  }
}

async function migrate() {
  const sql = db();
  await sql`CREATE TABLE IF NOT EXISTS ex237_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await addMissingColumns();

  // Favoris et progression (fait / à revoir) de chaque élève.
  await createTable(
    `CREATE TABLE IF NOT EXISTS ex237_user_papers (
      user_id UUID NOT NULL REFERENCES jl_users(id) ON DELETE CASCADE,
      paper_id UUID NOT NULL REFERENCES ex237_papers(id) ON DELETE CASCADE,
      favorite BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, paper_id))`,
    `CREATE TABLE IF NOT EXISTS ex237_user_papers (
      user_id UUID NOT NULL, paper_id UUID NOT NULL,
      favorite BOOLEAN NOT NULL DEFAULT FALSE, status TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, paper_id))`
  );

  // Ouvertures de sujets et corrections (« Reprendre », statistiques de l'admin).
  // Même définition que la table prévue dès la première version d'Exam237.
  await createTable(
    `CREATE TABLE IF NOT EXISTS ex237_content_views (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES jl_users(id) ON DELETE SET NULL,
      paper_id UUID NOT NULL REFERENCES ex237_papers(id) ON DELETE CASCADE,
      view_type TEXT NOT NULL CHECK (view_type IN ('paper','correction')),
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ex237_content_views (
      id UUID PRIMARY KEY, user_id UUID, paper_id UUID NOT NULL,
      view_type TEXT NOT NULL, viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  );
  await sql`CREATE INDEX IF NOT EXISTS ex237_content_views_user_idx ON ex237_content_views (user_id, viewed_at DESC)`;

  // Tentatives de connexion ratées (protection contre le piratage des comptes).
  await sql`CREATE TABLE IF NOT EXISTS ex237_login_attempts (
    key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS ex237_login_attempts_idx ON ex237_login_attempts (key, created_at)`;

  // Erreurs signalées par les élèves dans un sujet ou une correction.
  await createTable(
    `CREATE TABLE IF NOT EXISTS ex237_content_reports (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES jl_users(id) ON DELETE SET NULL,
      paper_id UUID NOT NULL REFERENCES ex237_papers(id) ON DELETE CASCADE,
      correction_id UUID,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ex237_content_reports (
      id UUID PRIMARY KEY, user_id UUID, paper_id UUID NOT NULL, correction_id UUID,
      message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  );

  // Conversations privées avec le Prof IA (chiffrées comme le chat).
  await createTable(
    `CREATE TABLE IF NOT EXISTS ex237_tutor_messages (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES jl_users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      has_image BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ex237_tutor_messages (
      id UUID PRIMARY KEY, user_id UUID NOT NULL, role TEXT NOT NULL,
      ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL,
      has_image BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  );
  await sql`CREATE INDEX IF NOT EXISTS ex237_tutor_messages_user_idx ON ex237_tutor_messages (user_id, created_at)`;

  // Réactions aux messages du chat (une par élève et par message, comme WhatsApp).
  await createTable(
    `CREATE TABLE IF NOT EXISTS ex237_chat_reactions (
      message_id UUID NOT NULL REFERENCES ex237_chat_messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS ex237_chat_reactions (
      message_id UUID NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id))`
  );

  // Historique des activations Premium faites par l'admin.
  await createTable(
    `CREATE TABLE IF NOT EXISTS ex237_premium_log (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES jl_users(id) ON DELETE CASCADE,
      days INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ex237_premium_log (
      id UUID PRIMARY KEY, user_id UUID NOT NULL, days INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  );

  // Vidéos promo affichées en « statuts » sur l'accueil.
  await sql`CREATE TABLE IF NOT EXISTS ex237_promos (
    id UUID PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'own',
    title TEXT NOT NULL,
    video_path TEXT,
    youtube_url TEXT,
    cta_type TEXT NOT NULL DEFAULT 'none',
    cta_label TEXT,
    cta_url TEXT,
    audience TEXT NOT NULL DEFAULT 'all',
    group_id TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ex237_promo_events (
    promo_id UUID NOT NULL REFERENCES ex237_promos(id) ON DELETE CASCADE,
    user_id TEXT,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS ex237_promo_events_idx ON ex237_promo_events (promo_id, kind)`;

  // Passage au modèle « presque tout Premium » : tous les sujets deviennent Premium,
  // puis l'admin choisit ses sujets gratuits (sinon un sujet corrigé par matière est
  // offert automatiquement, voir lib/access.ts). Fait une seule fois.
  const done: any[] =
    await sql`SELECT 1 FROM ex237_settings WHERE key='v6_premium_normalized' LIMIT 1`;
  if (!done[0]) {
    await sql`UPDATE ex237_papers SET is_premium=TRUE WHERE is_premium IS DISTINCT FROM TRUE`;
    await sql`INSERT INTO ex237_settings(key,value,updated_at) VALUES('v6_premium_normalized','1',NOW())
              ON CONFLICT (key) DO NOTHING`;
  }

  await sql`INSERT INTO ex237_settings(key,value,updated_at) VALUES('schema_version',${SCHEMA_VERSION},NOW())
            ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
}

async function upToDate() {
  try {
    const rows: any[] =
      await db()`SELECT value FROM ex237_settings WHERE key='schema_version' LIMIT 1`;
    return rows[0]?.value === SCHEMA_VERSION;
  } catch {
    return false; // la table des réglages n'existe pas encore
  }
}

export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      if (await upToDate()) return;
      try {
        await migrate();
      } catch {
        // Deux instances qui migrent en même temps : on réessaie une fois.
        await new Promise(resolve => setTimeout(resolve, 500));
        await migrate();
      }
    })().catch(error => {
      ready = null;
      throw error;
    });
  }
  return ready;
}
