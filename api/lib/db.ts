// DROP — shared Postgres (Neon) access for Vercel Serverless Functions.
// Used by api/auth/google.ts (upsert the verified Google user + session)
// and api/admin/users.ts (owner-only user counts). When DATABASE_URL is
// NOT set, getSql() returns null and callers must keep the
// localStorage-compatible behaviour — never fake a central count and
// never crash. No secrets in code: the connection string comes only
// from the DATABASE_URL environment variable (Vercel → Settings →
// Environment Variables, Secret). Only session token HASHES are stored
// in auth_sessions (column session_hash, as in server/schema.ts — the
// task's "token_hash" is this same column); Google ID tokens and
// passwords are never stored here.

import { createHash, randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

export type Sql = ReturnType<typeof neon>;

export const OWNER_EMAIL = 'durgaprasadt235@gmail.com';

/** Admin allow-list: DROP_ADMIN_EMAILS (comma-separated) or the owner. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.DROP_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) list.push(OWNER_EMAIL.toLowerCase());
  return list.includes(email.toLowerCase());
}

/**
 * Neon via the Vercel integration does NOT create DATABASE_URL — it
 * creates POSTGRES_URL / POSTGRES_PRISMA_URL / POSTGRES_URL_NON_POOLING
 * instead. Accept those as fallbacks, in that order, so the integration
 * works without the user copying the secret by hand.
 */
export function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    ''
  );
}

export function getSql(): Sql | null {
  const url = getDatabaseUrl();
  if (!url) return null;
  return neon(url);
}

export function dbConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create the two tables this feature needs if they do not exist, and
 * add the newer users columns (email, google_sub, auth_method) to a
 * database created from the older schema in server/schema.ts.
 */
export async function ensureUserTables(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      email TEXT UNIQUE,
      google_sub TEXT UNIQUE,
      avatar_url TEXT,
      bio TEXT,
      is_private BOOLEAN DEFAULT FALSE,
      auth_method TEXT NOT NULL DEFAULT 'google',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'google'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`;
  // Unique indexes for the added columns (IF NOT EXISTS is not valid
  // for CREATE UNIQUE INDEX in all versions, so guard via pg_indexes).
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_unique') THEN
        CREATE UNIQUE INDEX users_email_unique ON users (email);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_google_sub_unique') THEN
        CREATE UNIQUE INDEX users_google_sub_unique ON users (google_sub);
      END IF;
    END $$`;
  await sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id),
      session_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
}

export interface DbUserRow {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  google_sub: string | null;
  avatar_url: string | null;
  auth_method: string;
  created_at: string;
}

function slugBase(email: string): string {
  return (
    email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'user'
  );
}

async function uniqueUsername(sql: Sql, base: string): Promise<string> {
  let username = base;
  let n = 1;
  for (;;) {
    const rows = (await sql`SELECT id FROM users WHERE username = ${username}`) as { id: number }[];
    if (rows.length === 0) return username;
    n += 1;
    username = `${base}_${n}`;
  }
}

/**
 * Upsert a Google-verified user: match by google_sub first, then by
 * verified email. Updates name/avatar on every sign-in; never creates
 * a duplicate row for the same Google account. Returns the DB row.
 */
export async function upsertGoogleUser(
  sql: Sql,
  verified: { sub: string; email: string; name?: string; picture?: string },
): Promise<DbUserRow> {
  const displayName = verified.name ?? verified.email.split('@')[0];
  const bySub = (await sql`SELECT * FROM users WHERE google_sub = ${verified.sub}`) as DbUserRow[];
  if (bySub.length > 0) {
    const rows = (await sql`
      UPDATE users
      SET email = ${verified.email}, display_name = ${displayName},
          avatar_url = ${verified.picture ?? null}, google_sub = ${verified.sub},
          auth_method = 'google'
      WHERE id = ${bySub[0].id}
      RETURNING *`) as DbUserRow[];
    return rows[0];
  }
  const byEmail = (await sql`SELECT * FROM users WHERE email = ${verified.email}`) as DbUserRow[];
  if (byEmail.length > 0) {
    const rows = (await sql`
      UPDATE users
      SET google_sub = ${verified.sub}, display_name = ${displayName},
          avatar_url = ${verified.picture ?? null}, auth_method = 'google'
      WHERE id = ${byEmail[0].id}
      RETURNING *`) as DbUserRow[];
    return rows[0];
  }
  const username = await uniqueUsername(sql, slugBase(verified.email));
  const rows = (await sql`
    INSERT INTO users (username, display_name, email, google_sub, avatar_url, auth_method)
    VALUES (${username}, ${displayName}, ${verified.email}, ${verified.sub}, ${verified.picture ?? null}, 'google')
    RETURNING *`) as DbUserRow[];
  return rows[0];
}

/** Create a 30-day session row; only the token hash is stored. */
export async function createDbSession(
  sql: Sql,
  userId: number,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO auth_sessions (user_id, session_hash, expires_at)
    VALUES (${userId}, ${hashToken(token)}, ${expiresAt})`;
  return { token, expiresAt };
}

/**
 * Validate a Bearer session token against the DB. Returns the session's
 * user (with email, for the admin check) or null when the token is
 * missing, revoked, expired, or unknown.
 */
export async function validateDbSession(
  sql: Sql,
  token: string,
): Promise<DbUserRow | null> {
  if (!token) return null;
  const rows = (await sql`
    SELECT u.* FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.session_hash = ${hashToken(token)}
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()`) as DbUserRow[];
  return rows.length > 0 ? rows[0] : null;
}

export function publicDbUser(row: DbUserRow): {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  authMethod: string;
  createdAt: string;
} {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    authMethod: row.auth_method,
    createdAt: row.created_at,
  };
}
