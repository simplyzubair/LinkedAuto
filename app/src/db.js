import postgres from 'postgres';

export const sql = postgres(process.env.DATABASE_URL, { max: 5, onnotice: () => {} });

// Plain SQL migrations, applied in order at startup. Append new ones; never edit old ones.
const MIGRATIONS = [
  `CREATE TABLE settings (
     key text PRIMARY KEY,
     value jsonb NOT NULL
   )`,
  `CREATE TABLE runner_status (
     id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     last_seen timestamptz,
     session text NOT NULL DEFAULT 'unknown',
     detail text,
     url text,
     version text
   )`,
  `INSERT INTO runner_status (id) VALUES (1)`,
  `INSERT INTO settings (key, value) VALUES ('paused', 'true')`,
  `CREATE TABLE events (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     source text NOT NULL,
     kind text NOT NULL,
     detail text
   )`,
  `CREATE INDEX events_at ON events (at DESC)`,
];

export async function migrate() {
  await sql`CREATE TABLE IF NOT EXISTS schema_version (version int NOT NULL)`;
  const [row] = await sql`SELECT version FROM schema_version`;
  let version = row?.version ?? 0;
  if (!row) await sql`INSERT INTO schema_version VALUES (0)`;
  for (; version < MIGRATIONS.length; version++) {
    await sql.begin(async (tx) => {
      await tx.unsafe(MIGRATIONS[version]);
      await tx`UPDATE schema_version SET version = ${version + 1}`;
    });
  }
}

export async function getSetting(key) {
  const [row] = await sql`SELECT value FROM settings WHERE key = ${key}`;
  return row?.value;
}

export async function setSetting(key, value) {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${sql.json(value)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

export async function logEvent(source, kind, detail = null) {
  await sql`INSERT INTO events (source, kind, detail) VALUES (${source}, ${kind}, ${detail})`;
}
