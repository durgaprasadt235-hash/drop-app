// DROP — Profile, Privacy & Identity: shared server helpers.
// Used by all api/profile/* and api/clubrooms/*/identity functions.
// Rules enforced here, server-side, never in the client alone:
//  - Bearer session validated against auth_sessions (hash, not revoked,
//    not expired); the session's user is the only identity trusted.
//    Client-supplied user IDs are never proof of ownership.
//  - Private profiles: a non-approved viewer sees only the public
//    summary (display name, username, avatar, is_private) — no bio,
//    links, counts or content.
//  - Blocking is enforced everywhere: blocked users cannot view,
//    follow, message, Slash-invite or search each other.
//  - Room identities: the mapping internal-account <-> room alias is
//    NEVER returned to ordinary members; only the room-facing identity
//    (alias + optional avatar) is visible in member lists.

import {
  getSql, ensureUserTables, validateDbSession, hashToken,
} from './db.js';
import type { Sql, DbUserRow } from './db.js';

export type { Sql, DbUserRow };
export { getSql, ensureUserTables, validateDbSession } from './db.js';

export interface FullDbUser extends DbUserRow {
  bio: string | null;
  is_private: boolean;
  cover_url: string | null;
  links: { label: string; url: string }[] | null;
  location: string | null;
  birthday: string | null;
  created_at: string;
}

export interface PrivacyPrefs {
  is_private: boolean;
  activity_status: boolean;
  read_receipts: boolean;
  who_can_message: 'everyone' | 'friends' | 'nobody';
  who_can_slash: 'everyone' | 'friends' | 'nobody';
  who_can_mention: 'everyone' | 'friends' | 'nobody';
  who_can_tag: 'everyone' | 'friends' | 'nobody';
  default_room_identity: 'drop' | 'room';
}

export const DEFAULT_PRIVACY: PrivacyPrefs = {
  is_private: false,
  activity_status: true,
  read_receipts: true,
  who_can_message: 'everyone',
  who_can_slash: 'friends',
  who_can_mention: 'everyone',
  who_can_tag: 'friends',
  default_room_identity: 'drop',
};

const MSG_OPTIONS = ['everyone', 'friends', 'nobody'] as const;

/** Additive migrations for the Profile / Privacy / Identity system. */
export async function ensureProfileTables(sql: Sql): Promise<void> {
  await ensureUserTables(sql);
  // users additions (additive only — existing rows are untouched).
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS links JSONB`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday DATE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
  // Tables the reference schema defines but ensureUserTables never
  // created in Neon (only users + auth_sessions existed there).
  await sql`CREATE TABLE IF NOT EXISTS follows (follower_id INT REFERENCES users(id), following_id INT REFERENCES users(id), PRIMARY KEY (follower_id, following_id))`;
  await sql`CREATE TABLE IF NOT EXISTS blocks (blocker_id INT REFERENCES users(id), blocked_id INT REFERENCES users(id), PRIMARY KEY (blocker_id, blocked_id))`;
  await sql`CREATE TABLE IF NOT EXISTS clubrooms (id SERIAL PRIMARY KEY, name TEXT NOT NULL, created_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS clubroom_members (clubroom_id INT REFERENCES clubrooms(id), user_id INT REFERENCES users(id), PRIMARY KEY (clubroom_id, user_id))`;
  await sql`CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, author_id INT REFERENCES users(id), caption TEXT, media_url TEXT, filter TEXT DEFAULT 'original', effect TEXT DEFAULT 'none', extras_json JSONB, fire_count INT DEFAULT 0, comment_count INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS reels (id SERIAL PRIMARY KEY, author_id INT REFERENCES users(id), media_url TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS drops (id SERIAL PRIMARY KEY, creator_id INT REFERENCES users(id), kind TEXT NOT NULL, status TEXT DEFAULT 'waiting', blast_at TIMESTAMPTZ NOT NULL, caption TEXT, media_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
  // NOTE (2026-11-19 fix): post_saves.post_id originally referenced
  // users(id) by mistake — it must reference posts(id). The CREATE below
  // is correct for fresh databases; the DO block underneath repairs a
  // table that was already created with the wrong FK (idempotent).
  await sql`CREATE TABLE IF NOT EXISTS post_saves (user_id INT REFERENCES users(id), post_id INT REFERENCES posts(id), PRIMARY KEY (user_id, post_id))`;
  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_saves_post_id_fkey' AND conrelid = 'post_saves'::regclass AND confrelid <> 'posts'::regclass) THEN
        ALTER TABLE post_saves DROP CONSTRAINT post_saves_post_id_fkey;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_saves_post_id_fkey') THEN
        ALTER TABLE post_saves ADD CONSTRAINT post_saves_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
      END IF;
    END $$`;
  await sql`CREATE TABLE IF NOT EXISTS drop_opens (drop_id INT REFERENCES drops(id), user_id INT REFERENCES users(id), opened_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (drop_id, user_id))`;
  await sql`CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, reporter_id INT REFERENCES users(id), target_id INT REFERENCES users(id), reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS conversations (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS conversation_members (conversation_id INT REFERENCES conversations(id), user_id INT REFERENCES users(id), joined_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (conversation_id, user_id))`;
  await sql`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, conversation_id INT REFERENCES conversations(id), sender_id INT REFERENCES users(id), body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), type TEXT NOT NULL, body TEXT NOT NULL, read BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW())`;
  // New tables for this module.
  await sql`
    CREATE TABLE IF NOT EXISTS privacy_preferences (
      user_id INT PRIMARY KEY REFERENCES users(id),
      is_private BOOLEAN DEFAULT FALSE,
      activity_status BOOLEAN DEFAULT TRUE,
      read_receipts BOOLEAN DEFAULT TRUE,
      who_can_message TEXT DEFAULT 'everyone',
      who_can_slash TEXT DEFAULT 'friends',
      who_can_mention TEXT DEFAULT 'everyone',
      who_can_tag TEXT DEFAULT 'friends',
      default_room_identity TEXT DEFAULT 'drop',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS follow_requests (
      id SERIAL PRIMARY KEY,
      requester_id INT NOT NULL REFERENCES users(id),
      target_id INT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (requester_id, target_id)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS follow_requests_target_idx ON follow_requests (target_id, status)`;
  await sql`
    CREATE TABLE IF NOT EXISTS mutes (
      muter_id INT NOT NULL REFERENCES users(id),
      muted_id INT NOT NULL REFERENCES users(id),
      scope TEXT NOT NULL DEFAULT 'all',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (muter_id, muted_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS room_identities (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id),
      clubroom_id INT NOT NULL REFERENCES clubrooms(id),
      identity_mode TEXT NOT NULL DEFAULT 'drop',
      alias TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, clubroom_id)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS room_identities_room_idx ON room_identities (clubroom_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS privacy_audit_events (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
}

export async function audit(sql: Sql, userId: number, action: string, detail?: string): Promise<void> {
  try {
    await sql`INSERT INTO privacy_audit_events (user_id, action, detail) VALUES (${userId}, ${action}, ${detail ?? null})`;
  } catch { /* audit must never break the request */ }
}

// ---------------------------------------------------------------- auth ----
export function bearerToken(req: any): string {
  const auth = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Returns the authenticated DB user, or throws 401/503. */
export async function requireAuth(req: any): Promise<{ sql: Sql; me: FullDbUser }> {
  const sql = getSql();
  if (!sql) throw new HttpError(503, 'Shared database not configured — set DATABASE_URL (Neon) in Vercel and redeploy.');
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'Sign-in required.');
  await ensureProfileTables(sql);
  const row = await validateDbSession(sql, token);
  if (!row) throw new HttpError(401, 'Invalid or expired session.');
  return { sql, me: row as FullDbUser };
}

export async function getUserById(sql: Sql, id: number): Promise<FullDbUser | null> {
  const rows = (await sql`SELECT * FROM users WHERE id = ${id}`) as FullDbUser[];
  return rows[0] ?? null;
}

export async function getUserByUsername(sql: Sql, username: string): Promise<FullDbUser | null> {
  const rows = (await sql`SELECT * FROM users WHERE LOWER(username) = ${username.toLowerCase()}`) as FullDbUser[];
  return rows[0] ?? null;
}

// ----------------------------------------------------------- validation ---
const RESERVED = new Set([
  'admin', 'drop', 'support', 'system', 'official', 'help', 'security',
  'root', 'null', 'undefined', 'api', 'vercel', 'neon', 'moderator', 'mod',
  // Route names under /api/profile/* — a user named e.g. "posts" would
  // collide with the POST /api/profile/posts content endpoint.
  'me', 'profile', 'posts', 'reels', 'drops', 'saved', 'save', 'report',
  'conversations', 'messages',
]);

export function validateUsername(username: string): string | null {
  const u = username.trim();
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(u)) return 'Username must be 3–30 letters, numbers or underscores.';
  if (RESERVED.has(u.toLowerCase())) return 'That username is reserved.';
  return null;
}

export function validateBio(bio: string): string | null {
  if (bio.length > 150) return 'Bio must be 150 characters or fewer.';
  return null;
}

export function validateLinks(links: unknown): { label: string; url: string }[] | string {
  if (!Array.isArray(links)) return 'Links must be a list.';
  if (links.length > 5) return 'At most 5 links.';
  const out: { label: string; url: string }[] = [];
  for (const l of links) {
    if (typeof l !== 'object' || !l || typeof (l as any).url !== 'string') return 'Each link needs a URL.';
    const url = (l as any).url.trim();
    if (!/^https:\/\//.test(url)) return 'Links must start with https://';
    try { new URL(url); } catch { return 'Invalid link URL.'; }
    out.push({ label: typeof (l as any).label === 'string' ? (l as any).label.slice(0, 40) : url, url });
  }
  return out;
}

export function parsePrivacy(body: any, current: PrivacyPrefs): PrivacyPrefs | string {
  const p: PrivacyPrefs = { ...current };
  if (typeof body.is_private === 'boolean') p.is_private = body.is_private;
  if (typeof body.activity_status === 'boolean') p.activity_status = body.activity_status;
  if (typeof body.read_receipts === 'boolean') p.read_receipts = body.read_receipts;
  for (const k of ['who_can_message', 'who_can_slash', 'who_can_mention', 'who_can_tag'] as const) {
    if (body[k] !== undefined) {
      if (!MSG_OPTIONS.includes(body[k])) return `Invalid value for ${k}.`;
      p[k] = body[k];
    }
  }
  if (body.default_room_identity !== undefined) {
    if (body.default_room_identity !== 'drop' && body.default_room_identity !== 'room') return 'Invalid default_room_identity.';
    p.default_room_identity = body.default_room_identity;
  }
  return p;
}

export async function getPrivacy(sql: Sql, userId: number): Promise<PrivacyPrefs> {
  const rows = (await sql`SELECT * FROM privacy_preferences WHERE user_id = ${userId}`) as any[];
  if (rows.length === 0) return { ...DEFAULT_PRIVACY };
  const r = rows[0];
  return {
    is_private: Boolean(r.is_private),
    activity_status: Boolean(r.activity_status),
    read_receipts: Boolean(r.read_receipts),
    who_can_message: MSG_OPTIONS.includes(r.who_can_message) ? r.who_can_message : 'everyone',
    who_can_slash: MSG_OPTIONS.includes(r.who_can_slash) ? r.who_can_slash : 'friends',
    who_can_mention: MSG_OPTIONS.includes(r.who_can_mention) ? r.who_can_mention : 'everyone',
    who_can_tag: MSG_OPTIONS.includes(r.who_can_tag) ? r.who_can_tag : 'friends',
    default_room_identity: r.default_room_identity === 'room' ? 'room' : 'drop',
  };
}

export async function savePrivacy(sql: Sql, userId: number, p: PrivacyPrefs): Promise<void> {
  await sql`
    INSERT INTO privacy_preferences
      (user_id, is_private, activity_status, read_receipts, who_can_message, who_can_slash, who_can_mention, who_can_tag, default_room_identity, updated_at)
    VALUES (${userId}, ${p.is_private}, ${p.activity_status}, ${p.read_receipts}, ${p.who_can_message}, ${p.who_can_slash}, ${p.who_can_mention}, ${p.who_can_tag}, ${p.default_room_identity}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      is_private = EXCLUDED.is_private, activity_status = EXCLUDED.activity_status,
      read_receipts = EXCLUDED.read_receipts, who_can_message = EXCLUDED.who_can_message,
      who_can_slash = EXCLUDED.who_can_slash, who_can_mention = EXCLUDED.who_can_mention,
      who_can_tag = EXCLUDED.who_can_tag, default_room_identity = EXCLUDED.default_room_identity,
      updated_at = NOW()`;
  await sql`UPDATE users SET is_private = ${p.is_private}, updated_at = NOW() WHERE id = ${userId}`;
}

// ---------------------------------------------------------- relationships --
export async function isBlocked(sql: Sql, a: number, b: number): Promise<boolean> {
  const rows = (await sql`SELECT 1 FROM blocks WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a}) LIMIT 1`) as any[];
  return rows.length > 0;
}

export async function isFollowing(sql: Sql, followerId: number, followingId: number): Promise<boolean> {
  const rows = (await sql`SELECT 1 FROM follows WHERE follower_id = ${followerId} AND following_id = ${followingId} LIMIT 1`) as any[];
  return rows.length > 0;
}

export async function pendingRequest(sql: Sql, requesterId: number, targetId: number): Promise<number | null> {
  const rows = (await sql`SELECT id FROM follow_requests WHERE requester_id = ${requesterId} AND target_id = ${targetId} AND status = 'pending' LIMIT 1`) as any[];
  return rows.length > 0 ? rows[0].id : null;
}

/** May viewer start a DM with target? Server-side, from target's stored
 *  who_can_message: everyone = yes, nobody = no, friends = mutual follow.
 *  Blocked either way = no. The owner can always message themselves is
 *  irrelevant (self-DM is rejected elsewhere); viewer === target → true. */
export async function canMessage(sql: Sql, viewerId: number | null, target: FullDbUser): Promise<boolean> {
  if (viewerId === null) return false;
  if (viewerId === target.id) return true;
  if (await isBlocked(sql, viewerId, target.id)) return false;
  const prefs = await getPrivacy(sql, target.id);
  if (prefs.who_can_message === 'everyone') return true;
  if (prefs.who_can_message === 'nobody') return false;
  const [a, b] = await Promise.all([
    isFollowing(sql, viewerId, target.id),
    isFollowing(sql, target.id, viewerId),
  ]);
  return a && b;
}

/** Can viewer see target's full profile? Owner and approved followers can; anyone can see the public summary. */
export async function canViewFullProfile(sql: Sql, viewerId: number | null, target: FullDbUser): Promise<boolean> {
  if (viewerId === target.id) return true;
  if (!target.is_private) return true;
  if (viewerId === null) return false;
  return isFollowing(sql, viewerId, target.id);
}

export async function profileCounts(sql: Sql, userId: number): Promise<{ posts: number; followers: number; following: number }> {
  const [p, f1, f2] = await Promise.all([
    sql`SELECT COUNT(*)::int AS c FROM posts WHERE author_id = ${userId}`,
    sql`SELECT COUNT(*)::int AS c FROM follows WHERE following_id = ${userId}`,
    sql`SELECT COUNT(*)::int AS c FROM follows WHERE follower_id = ${userId}`,
  ]) as any[];
  return { posts: (p as any[])[0]?.c ?? 0, followers: (f1 as any[])[0]?.c ?? 0, following: (f2 as any[])[0]?.c ?? 0 };
}

/** Public view of a profile: private fields stripped when not allowed.
 *  canMessage (server-computed from the target's stored privacy prefs)
 *  is included even for private profiles — the Message button needs it
 *  to decide honestly whether a DM can be opened. */
export function publicProfile(
  target: FullDbUser,
  opts: { full: boolean; counts: { posts: number; followers: number; following: number }; relationship: 'none' | 'following' | 'requested' | 'self'; canMessage?: boolean },
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: target.id, username: target.username, displayName: target.display_name,
    avatarUrl: target.avatar_url ?? null, isPrivate: Boolean(target.is_private),
    relationship: opts.relationship, createdAt: target.created_at,
    canMessage: opts.canMessage ?? false,
  };
  if (!opts.full) return base;
  return {
    ...base,
    bio: target.bio ?? '', coverUrl: target.cover_url ?? null,
    links: target.links ?? [], location: target.location ?? null,
    birthday: target.birthday ?? null, counts: opts.counts,
  };
}

export async function notify(sql: Sql, userId: number, type: string, body: string): Promise<void> {
  try {
    await sql`INSERT INTO notifications (user_id, type, body) VALUES (${userId}, ${type}, ${body})`;
  } catch { /* notifications must never break the request */ }
}

export function sendJson(res: any, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function handleError(res: any, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ ok: false, error: err.message });
    return;
  }
  console.error('DROP profile API error', err);
  res.status(500).json({ ok: false, error: 'Something went wrong — please try again.' });
}

export { hashToken };
