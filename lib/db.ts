import { neon, neonConfig } from '@neondatabase/serverless';

let client: ReturnType<typeof neon> | null = null;

export function db(): any {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant.');
  if (!client) {
    // Tests sur un ordinateur uniquement : une base locale remplace le service Neon.
    const local = process.env.EXAM237_SQL_ENDPOINT;
    if (local) neonConfig.fetchEndpoint = () => local;
    client = neon(process.env.DATABASE_URL);
  }
  return client;
}

// Identifiant UUID valide (évite une erreur SQL sur une valeur fantaisiste).
export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
