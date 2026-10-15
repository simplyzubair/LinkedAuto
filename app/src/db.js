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
  // Phase 1-4: campaigns, leads, imports and the action log.
  `CREATE TABLE campaigns (
     id serial PRIMARY KEY,
     name text NOT NULL,
     active boolean NOT NULL DEFAULT false,
     visit_first boolean NOT NULL DEFAULT true,
     invite_note text NOT NULL DEFAULT '',
     first_message text NOT NULL DEFAULT '',
     followups jsonb NOT NULL DEFAULT '[]',
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE leads (
     id serial PRIMARY KEY,
     profile_url text NOT NULL UNIQUE,
     full_name text,
     first_name text,
     headline text,
     location text,
     company text,
     tags text[] NOT NULL DEFAULT '{}',
     source text,
     campaign_id int REFERENCES campaigns(id) ON DELETE SET NULL,
     status text NOT NULL DEFAULT 'new',
     msg_step int NOT NULL DEFAULT 0,
     invite_variant int,
     message_variant int,
     next_action_at timestamptz NOT NULL DEFAULT now(),
     invited_at timestamptz,
     accepted_at timestamptz,
     last_message_at timestamptz,
     replied_at timestamptz,
     error text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX leads_due ON leads (status, next_action_at)`,
  `CREATE TABLE imports (
     id serial PRIMARY KEY,
     search_url text NOT NULL,
     campaign_id int REFERENCES campaigns(id) ON DELETE SET NULL,
     tags text[] NOT NULL DEFAULT '{}',
     max_pages int NOT NULL DEFAULT 3,
     next_page int NOT NULL DEFAULT 1,
     status text NOT NULL DEFAULT 'queued',
     found int NOT NULL DEFAULT 0,
     added int NOT NULL DEFAULT 0,
     error text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE actions (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     finished_at timestamptz,
     type text NOT NULL,
     lead_id int REFERENCES leads(id) ON DELETE SET NULL,
     import_id int REFERENCES imports(id) ON DELETE SET NULL,
     payload jsonb NOT NULL DEFAULT '{}',
     result text,
     detail text,
     dry_run boolean NOT NULL DEFAULT false
   )`,
  `CREATE INDEX actions_type_at ON actions (type, at DESC)`,
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
