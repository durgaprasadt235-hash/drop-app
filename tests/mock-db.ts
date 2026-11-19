// DROP server-handler test mock (recreated 2026-11-19, durable under tests/).
//
// The original suites lived in /tmp and were wiped. This is a faithful
// rebuild from the CURRENT server code (api/lib/profile-handlers.ts,
// api/lib/profile.ts, api/lib/db.ts, api/profile-router.ts): it replays
// the exact query shapes those files emit against an in-memory store,
// via the setTestSql() seam in api/lib/db.ts. No real database, no
// network. Any query shape the handlers emit that this mock does not
// recognise throws loudly ("mock: unhandled query") instead of
// silently returning [] — a missing shape is a test failure, not a pass.

import { createHash } from 'node:crypto';

export type Row = Record<string, any>;

export interface MockState {
  users: Row[];
  sessions: Row[]; // { user_id, session_hash, expires_at, revoked_at }
  follows: Row[];
  blocks: Row[];
  mutes: Row[];
  follow_requests: Row[];
  reports: Row[];
  posts: Row[];
  post_likes: Row[];
  post_saves: Row[];
  post_comments: Row[];
  reels: Row[];
  drops: Row[];
  drop_opens: Row[];
  conversations: Row[];
  conversation_members: Row[];
  notifications: Row[];
  privacy_preferences: Row[];
  close_friends: Row[];
  story_hidden_from: Row[];
  restricted_accounts: Row[];
  hidden_words: Row[];
  user_settings: Row[];
  story_archive: Row[];
  message_requests: Row[];
  slash_invitations: Row[];
  privacy_audit_events: Row[];
  auth_identities: Row[];
  nextId: Record<string, number>;
  seq: number;
}

const TABLES: (keyof MockState)[] = [
  'users', 'sessions', 'follows', 'blocks', 'mutes', 'follow_requests',
  'reports', 'posts', 'post_likes', 'post_saves', 'post_comments',
  'reels', 'drops', 'drop_opens', 'conversations', 'conversation_members',
  'notifications', 'privacy_preferences', 'close_friends',
  'story_hidden_from', 'restricted_accounts', 'hidden_words',
  'user_settings', 'story_archive', 'message_requests',
  'slash_invitations', 'privacy_audit_events', 'auth_identities',
];

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function freshState(): MockState {
  const s = { nextId: {}, seq: 0 } as MockState;
  for (const t of TABLES) (s as any)[t] = [];
  for (const t of ['users', 'posts', 'post_comments', 'reels', 'drops', 'conversations', 'notifications', 'follow_requests', 'reports', 'story_archive', 'message_requests', 'slash_invitations', 'privacy_audit_events', 'auth_identities']) s.nextId[t] = 1;
  return s;
}

/** Deterministic increasing timestamps so ORDER BY created_at works. */
function stamp(s: MockState): string {
  s.seq += 1;
  return new Date(Date.now() + s.seq * 1000).toISOString();
}

export function addUser(s: MockState, partial: Partial<Row>): Row {
  const id = partial.id ?? s.nextId.users++;
  const row: Row = {
    id,
    username: `user${id}`,
    display_name: `User ${id}`,
    email: null,
    google_sub: null,
    avatar_url: null,
    bio: null,
    is_private: false,
    cover_url: null,
    links: null,
    location: null,
    birthday: null,
    last_active_at: null,
    auth_method: 'google',
    created_at: stamp(s),
    updated_at: stamp(s),
    ...partial,
    id,
  };
  s.users.push(row);
  return row;
}

export function addSession(s: MockState, userId: number, token: string, opts: Partial<Row> = {}): Row {
  const row: Row = {
    user_id: userId,
    session_hash: hashToken(token),
    expires_at: '2099-01-01T00:00:00.000Z',
    revoked_at: null,
    created_at: stamp(s),
    ...opts,
  };
  s.sessions.push(row);
  return row;
}

// --- SQL literal handling -------------------------------------------------

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Split a comma list, respecting single quotes and nested parens. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (text[i + 1] === "'") { cur += text[i + 1]; i++; } else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Parse one substituted literal back into a JS value. */
function parseLit(tok: string): any {
  let t = tok.trim().replace(/::jsonb$/i, '').replace(/::int$/i, '').trim();
  if (t === 'NULL') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'NOW()') return { __now: true };
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  const n = Number(t);
  if (!Number.isNaN(n) && t !== '') return n;
  return t;
}

function unq(v: any): string {
  return String(v ?? '').replace(/''/g, "'");
}

// --- the mock sql tag -----------------------------------------------------

export type MockSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

export function createMockDb(): { sql: MockSql; state: MockState } {
  const state = freshState();

  const sql: MockSql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let raw = '';
    for (let i = 0; i < strings.length; i++) {
      raw += strings[i];
      if (i < values.length) raw += sqlLiteral(values[i]);
    }
    const q = raw.replace(/\s+/g, ' ').trim();
    return dispatch(state, q);
  };

  return { sql, state };
}

// --- dispatch ---------------------------------------------------------------

const SERIAL = new Set(['users', 'posts', 'post_comments', 'reels', 'drops', 'conversations', 'notifications', 'follow_requests', 'reports', 'story_archive', 'message_requests', 'slash_invitations', 'privacy_audit_events', 'auth_identities']);

const DEDUP: Record<string, string[]> = {
  follows: ['follower_id', 'following_id'],
  blocks: ['blocker_id', 'blocked_id'],
  mutes: ['muter_id', 'muted_id'],
  follow_requests: ['requester_id', 'target_id'],
  close_friends: ['user_id', 'friend_id'],
  story_hidden_from: ['user_id', 'hidden_id'],
  restricted_accounts: ['restrictor_id', 'restricted_id'],
  hidden_words: ['user_id', 'word'],
  post_saves: ['user_id', 'post_id'],
  drop_opens: ['drop_id', 'user_id'],
  conversation_members: ['conversation_id', 'user_id'],
};

function findMatchingParen(text: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "'") {
        if (text[i + 1] === "'") i++;
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function genericInsert(s: MockState, q: string): Row[] | null {
  const m = /^INSERT INTO (\w+) \(([^)]*)\) VALUES \(/.exec(q);
  if (!m) return null;
  const table = m[1];
  const cols = splitTopLevel(m[2]);
  // Parse every VALUES tuple (some statements insert two rows at once,
  // e.g. conversation_members for both participants).
  const tuples: any[][] = [];
  let cursor = q.indexOf('VALUES (') + 'VALUES '.length;
  for (;;) {
    const closeIdx = findMatchingParen(q, cursor);
    if (closeIdx < 0) return null;
    tuples.push(splitTopLevel(q.slice(cursor + 1, closeIdx)).map(parseLit));
    const rest = q.slice(closeIdx + 1);
    const next = /^, \(/.exec(rest);
    if (!next) break;
    cursor = closeIdx + 1 + next[0].length - 1; // at the '(' of the next tuple
  }
  const rest = q.slice(findMatchingParen(q, cursor) + 1);
  const returning = /RETURNING \*/.test(rest);
  const inserted: Row[] = [];
  for (const vals of tuples) {
    const row: Row = {};
    cols.forEach((c, i) => {
      const v = vals[i];
      row[c] = v && typeof v === 'object' && (v as any).__now ? stamp(s) : v;
    });
    // Upserts keyed by user_id (privacy_preferences / user_settings).
    if (table === 'privacy_preferences' || table === 'user_settings') {
      const ex = (s as any)[table].find((r: Row) => r.user_id === row.user_id);
      if (ex) { Object.assign(ex, row, { updated_at: stamp(s) }); inserted.push(ex); continue; }
      (s as any)[table].push(row);
      inserted.push(row);
      continue;
    }
    // Dedup tables (ON CONFLICT DO NOTHING).
    const keys = DEDUP[table];
    if (keys) {
      const ex = (s as any)[table].find((r: Row) => keys.every((k) => r[k] === row[k]));
      if (ex) { inserted.push(ex); continue; }
    }
    if (SERIAL.has(table)) {
      if (row.id === undefined) { row.id = s.nextId[table] ?? 1; s.nextId[table] = (s.nextId[table] ?? 1) + 1; }
      if (row.created_at === undefined) row.created_at = stamp(s);
    }
    if (table === 'posts') { row.fire_count ??= 0; row.comment_count ??= 0; row.filter ??= 'original'; row.effect ??= 'none'; }
    if (table === 'drops') { row.status ??= 'waiting'; }
    if (table === 'notifications') { row.read ??= false; }
    if (table === 'story_archive') { row.archived_at ??= stamp(s); row.filter ??= 'original'; row.effect ??= 'none'; }
    if (table === 'follow_requests' || table === 'message_requests' || table === 'slash_invitations') {
      row.status ??= 'pending';
      if (row.updated_at === undefined) row.updated_at = stamp(s);
    }
    (s as any)[table].push(row);
    inserted.push(row);
  }
  return returning ? inserted : [];
}

function brief(r: Row): Row {
  return { id: r.id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url ?? null };
}

function dispatch(s: MockState, q: string): Row[] {
  // DDL / audit — no-ops.
  if (/^(CREATE TABLE|ALTER TABLE|CREATE UNIQUE INDEX|CREATE INDEX|DO \$\$)/.test(q)) return [];
  if (/^INSERT INTO privacy_audit_events/.test(q)) {
    const ins = genericInsert(s, q);
    return ins ?? [];
  }
  if (/^INSERT INTO conversations DEFAULT VALUES RETURNING id/.test(q)) {
    const row: Row = { id: s.nextId.conversations++, created_at: stamp(s) };
    s.conversations.push(row);
    return [row];
  }
  if (/^INSERT INTO /.test(q)) {
    const ins = genericInsert(s, q);
    if (ins !== null) return ins;
  }

  // ---- UPDATE ----
  let m: RegExpMatchArray | null;
  if ((m = /^UPDATE auth_sessions SET revoked_at = NOW\(\) WHERE session_hash = '([0-9a-f]+)'/.exec(q))) {
    const sess = s.sessions.find((x) => x.session_hash === m![1]);
    if (sess) sess.revoked_at = new Date().toISOString();
    return [];
  }
  if ((m = /^UPDATE users SET last_active_at = NOW\(\) WHERE id = (\d+)/.exec(q))) {
    const u = s.users.find((r) => r.id === +m![1]);
    if (u) u.last_active_at = new Date().toISOString();
    return [];
  }
  if ((m = /^UPDATE users SET is_private = (true|false), updated_at = NOW\(\) WHERE id = (\d+)/.exec(q))) {
    const u = s.users.find((r) => r.id === +m![2]);
    if (u) { u.is_private = m![1] === 'true'; u.updated_at = stamp(s); }
    return [];
  }
  if ((m = /^UPDATE users SET (\w+) = (NULL|'(?:[^']|'')*'|true|false)(?:::jsonb)?, updated_at = NOW\(\) WHERE id = (\d+)/.exec(q))) {
    const u = s.users.find((r) => r.id === +m![3]);
    if (u) {
      let v: any = parseLit(m![2]);
      if (m![1] === 'links' && typeof v === 'string') { try { v = JSON.parse(v); } catch { /* keep string */ } }
      (u as any)[m![1]] = v;
      u.updated_at = stamp(s);
    }
    return [];
  }
  if ((m = /^UPDATE posts SET comment_count = comment_count \+ 1 WHERE id = (\d+)/.exec(q))) {
    const p = s.posts.find((r) => r.id === +m![1]);
    if (p) p.comment_count = (p.comment_count ?? 0) + 1;
    return [];
  }
  if ((m = /^UPDATE drops SET status = 'revealed' WHERE id = (\d+)/.exec(q))) {
    const d = s.drops.find((r) => r.id === +m![1]);
    if (d) d.status = 'revealed';
    return [];
  }
  if ((m = /^UPDATE notifications SET read = TRUE WHERE user_id = (\d+) AND id = (\d+)/.exec(q))) {
    const n = s.notifications.find((r) => r.user_id === +m![1] && r.id === +m![2]);
    if (n) n.read = true;
    return [];
  }
  if ((m = /^UPDATE notifications SET read = TRUE WHERE user_id = (\d+)$/.exec(q))) {
    for (const n of s.notifications) if (n.user_id === +m![1]) n.read = true;
    return [];
  }
  if ((m = /^UPDATE follow_requests SET status = '(\w+)', updated_at = NOW\(\) WHERE requester_id = (\d+) AND target_id = (\d+) AND status = 'pending'/.exec(q))) {
    for (const r of s.follow_requests) {
      if (r.requester_id === +m![2] && r.target_id === +m![3] && r.status === 'pending') { r.status = m![1]; r.updated_at = stamp(s); }
    }
    return [];
  }
  if ((m = /^UPDATE follow_requests SET status = '(\w+)', updated_at = NOW\(\) WHERE \(\(requester_id = (\d+) AND target_id = (\d+)\) OR \(requester_id = (\d+) AND target_id = (\d+)\)\) AND status = 'pending'/.exec(q))) {
    for (const r of s.follow_requests) {
      const pair = (r.requester_id === +m![2] && r.target_id === +m![3]) || (r.requester_id === +m![4] && r.target_id === +m![5]);
      if (pair && r.status === 'pending') { r.status = m![1]; r.updated_at = stamp(s); }
    }
    return [];
  }
  if ((m = /^UPDATE follow_requests SET status = '(\w+)', updated_at = NOW\(\) WHERE id = (\d+)/.exec(q))) {
    const r = s.follow_requests.find((x) => x.id === +m![2]);
    if (r) { r.status = m![1]; r.updated_at = stamp(s); }
    return [];
  }
  if ((m = /^UPDATE message_requests SET status = '(\w+)', conversation_id = (\d+), updated_at = NOW\(\) WHERE id = (\d+)/.exec(q))) {
    const r = s.message_requests.find((x) => x.id === +m![3]);
    if (r) { r.status = m![1]; r.conversation_id = +m![2]; r.updated_at = stamp(s); }
    return [];
  }
  if ((m = /^UPDATE message_requests SET status = '(\w+)', updated_at = NOW\(\) WHERE id = (\d+)/.exec(q))) {
    const r = s.message_requests.find((x) => x.id === +m![2]);
    if (r) { r.status = m![1]; r.updated_at = stamp(s); }
    return [];
  }
  if ((m = /^UPDATE slash_invitations SET status = '(\w+)' WHERE id = (\d+)/.exec(q))) {
    const r = s.slash_invitations.find((x) => x.id === +m![2]);
    if (r) r.status = m![1];
    return [];
  }

  // ---- DELETE ----
  if ((m = /^DELETE FROM follows WHERE \(follower_id = (\d+) AND following_id = (\d+)\) OR \(follower_id = (\d+) AND following_id = (\d+)\)/.exec(q))) {
    s.follows = s.follows.filter((r) => !((r.follower_id === +m![1] && r.following_id === +m![2]) || (r.follower_id === +m![3] && r.following_id === +m![4])));
    return [];
  }
  if ((m = /^DELETE FROM follows WHERE follower_id = (\d+) AND following_id = (\d+)/.exec(q))) {
    s.follows = s.follows.filter((r) => !(r.follower_id === +m![1] && r.following_id === +m![2]));
    return [];
  }
  if ((m = /^DELETE FROM blocks WHERE blocker_id = (\d+) AND blocked_id = (\d+)/.exec(q))) {
    s.blocks = s.blocks.filter((r) => !(r.blocker_id === +m![1] && r.blocked_id === +m![2]));
    return [];
  }
  if ((m = /^DELETE FROM mutes WHERE muter_id = (\d+) AND muted_id = (\d+)/.exec(q))) {
    s.mutes = s.mutes.filter((r) => !(r.muter_id === +m![1] && r.muted_id === +m![2]));
    return [];
  }
  if ((m = /^DELETE FROM (close_friends|story_hidden_from|restricted_accounts) WHERE (\w+) = (\d+) AND (\w+) = (\d+)/.exec(q))) {
    const tbl = m![1] as keyof MockState;
    (s as any)[tbl] = (s as any)[tbl].filter((r: Row) => !(r[m![2]] === +m![3] && r[m![4]] === +m![5]));
    return [];
  }
  if ((m = /^DELETE FROM hidden_words WHERE user_id = (\d+) AND word = '((?:[^']|'')*)'/.exec(q))) {
    s.hidden_words = s.hidden_words.filter((r) => !(r.user_id === +m![1] && r.word === unq(m![2])));
    return [];
  }
  if ((m = /^DELETE FROM post_saves WHERE post_id = (\d+)/.exec(q))) {
    s.post_saves = s.post_saves.filter((r) => r.post_id !== +m![1]);
    return [];
  }
  if ((m = /^DELETE FROM post_saves WHERE user_id = (\d+) AND post_id = (\d+)/.exec(q))) {
    s.post_saves = s.post_saves.filter((r) => !(r.user_id === +m![1] && r.post_id === +m![2]));
    return [];
  }
  if ((m = /^DELETE FROM posts WHERE id = (\d+)/.exec(q))) {
    s.posts = s.posts.filter((r) => r.id !== +m![1]);
    return [];
  }
  if ((m = /^DELETE FROM story_archive WHERE id = (\d+) AND user_id = (\d+)/.exec(q))) {
    s.story_archive = s.story_archive.filter((r) => !(r.id === +m![1] && r.user_id === +m![2]));
    return [];
  }
  if ((m = /^DELETE FROM conversation_members WHERE conversation_id = (\d+) AND user_id = (\d+)/.exec(q))) {
    s.conversation_members = s.conversation_members.filter((r) => !(r.conversation_id === +m![1] && r.user_id === +m![2]));
    return [];
  }

  // ---- SELECT ----
  // Session validation (validateDbSession).
  if (q.includes('FROM auth_sessions s JOIN users u')) {
    const hm = /s\.session_hash = '([0-9a-f]+)'/.exec(q);
    const sess = s.sessions.find((x) => x.session_hash === hm?.[1] && !x.revoked_at && Date.parse(x.expires_at) > Date.now());
    if (!sess) return [];
    const u = s.users.find((x) => x.id === sess.user_id);
    return u ? [u] : [];
  }
  if ((m = /^SELECT \* FROM users WHERE id = (\d+)/.exec(q))) {
    const u = s.users.find((r) => r.id === +m![1]);
    return u ? [u] : [];
  }
  if ((m = /^SELECT id FROM users WHERE LOWER\(username\) = '((?:[^']|'')*)' AND id <> (\d+)/.exec(q))) {
    return s.users.filter((r) => r.username.toLowerCase() === unq(m![1]).toLowerCase() && r.id !== +m![2]).map((r) => ({ id: r.id }));
  }
  if ((m = /^SELECT \* FROM users WHERE LOWER\(username\) = '((?:[^']|'')*)'/.exec(q))) {
    const u = s.users.find((r) => r.username.toLowerCase() === unq(m![1]).toLowerCase());
    return u ? [u] : [];
  }
  if ((m = /^SELECT id FROM users WHERE username = '((?:[^']|'')*)'/.exec(q))) {
    return s.users.filter((r) => r.username === unq(m![1])).map((r) => ({ id: r.id }));
  }
  if ((m = /^SELECT \* FROM privacy_preferences WHERE user_id = (\d+)/.exec(q))) {
    return s.privacy_preferences.filter((r) => r.user_id === +m![1]);
  }
  if ((m = /^SELECT \* FROM user_settings WHERE user_id = (\d+)/.exec(q))) {
    return s.user_settings.filter((r) => r.user_id === +m![1]);
  }
  if ((m = /^SELECT word FROM hidden_words WHERE user_id = (\d+) ORDER BY word/.exec(q))) {
    return s.hidden_words.filter((r) => r.user_id === +m![1]).sort((a, b) => a.word.localeCompare(b.word)).map((r) => ({ word: r.word }));
  }
  if ((m = /^SELECT 1 FROM blocks WHERE \(blocker_id = (\d+) AND blocked_id = (\d+)\) OR \(blocker_id = (\d+) AND blocked_id = (\d+)\) LIMIT 1/.exec(q))) {
    const hit = s.blocks.some((r) => (r.blocker_id === +m![1] && r.blocked_id === +m![2]) || (r.blocker_id === +m![3] && r.blocked_id === +m![4]));
    return hit ? [{ '?column?': 1 }] : [];
  }
  if ((m = /^SELECT 1 FROM follows WHERE follower_id = (\d+) AND following_id = (\d+) LIMIT 1/.exec(q))) {
    const hit = s.follows.some((r) => r.follower_id === +m![1] && r.following_id === +m![2]);
    return hit ? [{ '?column?': 1 }] : [];
  }
  if ((m = /^SELECT 1 FROM restricted_accounts WHERE restrictor_id = (\d+) AND restricted_id = (\d+) LIMIT 1/.exec(q))) {
    const hit = s.restricted_accounts.some((r) => r.restrictor_id === +m![1] && r.restricted_id === +m![2]);
    return hit ? [{ '?column?': 1 }] : [];
  }
  if ((m = /^SELECT 1 FROM conversation_members WHERE conversation_id = (\d+) AND user_id = (\d+) LIMIT 1/.exec(q))) {
    const hit = s.conversation_members.some((r) => r.conversation_id === +m![1] && r.user_id === +m![2]);
    return hit ? [{ '?column?': 1 }] : [];
  }
  if ((m = /^SELECT 1 FROM post_saves WHERE user_id = (\d+) AND post_id = (\d+) LIMIT 1/.exec(q))) {
    const hit = s.post_saves.some((r) => r.user_id === +m![1] && r.post_id === +m![2]);
    return hit ? [{ '?column?': 1 }] : [];
  }
  if ((m = /^SELECT id FROM follow_requests WHERE requester_id = (\d+) AND target_id = (\d+) AND status = 'pending' LIMIT 1/.exec(q))) {
    const r = s.follow_requests.find((x) => x.requester_id === +m![1] && x.target_id === +m![2] && x.status === 'pending');
    return r ? [{ id: r.id }] : [];
  }
  if ((m = /^SELECT COUNT\(\*\)::int AS c FROM posts WHERE author_id = (\d+)/.exec(q))) {
    return [{ c: s.posts.filter((r) => r.author_id === +m![1]).length }];
  }
  if ((m = /^SELECT COUNT\(\*\)::int AS c FROM follows WHERE following_id = (\d+)/.exec(q))) {
    return [{ c: s.follows.filter((r) => r.following_id === +m![1]).length }];
  }
  if ((m = /^SELECT COUNT\(\*\)::int AS c FROM follows WHERE follower_id = (\d+)/.exec(q))) {
    return [{ c: s.follows.filter((r) => r.follower_id === +m![1]).length }];
  }
  if ((m = /^SELECT COUNT\(\*\)::int AS c FROM reports WHERE target_id = (\d+)/.exec(q))) {
    return [{ c: s.reports.filter((r) => r.target_id === +m![1]).length }];
  }
  // Follow-request lists (incoming / outgoing).
  if ((m = /^SELECT fr\.id, fr\.requester_id, fr\.created_at, u\.username, u\.display_name, u\.avatar_url FROM follow_requests fr JOIN users u ON u\.id = fr\.requester_id WHERE fr\.target_id = (\d+) AND fr\.status = 'pending' ORDER BY fr\.created_at DESC/.exec(q))) {
    return s.follow_requests.filter((r) => r.target_id === +m![1] && r.status === 'pending')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({ id: r.id, requester_id: r.requester_id, created_at: r.created_at, ...pickUser(s, r.requester_id) }));
  }
  if ((m = /^SELECT fr\.id, fr\.target_id, fr\.created_at, u\.username, u\.display_name, u\.avatar_url FROM follow_requests fr JOIN users u ON u\.id = fr\.target_id WHERE fr\.requester_id = (\d+) AND fr\.status = 'pending' ORDER BY fr\.created_at DESC/.exec(q))) {
    return s.follow_requests.filter((r) => r.requester_id === +m![1] && r.status === 'pending')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({ id: r.id, target_id: r.target_id, created_at: r.created_at, ...pickUser(s, r.target_id) }));
  }
  if ((m = /^SELECT \* FROM follow_requests WHERE id = (\d+)/.exec(q))) {
    const r = s.follow_requests.find((x) => x.id === +m![1]);
    return r ? [r] : [];
  }
  if ((m = /^SELECT \* FROM message_requests WHERE id = (\d+)/.exec(q))) {
    const r = s.message_requests.find((x) => x.id === +m![1]);
    return r ? [r] : [];
  }
  if ((m = /^SELECT \* FROM message_requests WHERE sender_id = (\d+) AND recipient_id = (\d+) AND status = 'pending'/.exec(q))) {
    return s.message_requests.filter((r) => r.sender_id === +m![1] && r.recipient_id === +m![2] && r.status === 'pending');
  }
  if ((m = /^SELECT \* FROM slash_invitations WHERE id = (\d+)/.exec(q))) {
    const r = s.slash_invitations.find((x) => x.id === +m![1]);
    return r ? [r] : [];
  }
  if ((m = /^SELECT \* FROM story_archive WHERE id = (\d+) AND user_id = (\d+)/.exec(q))) {
    const r = s.story_archive.find((x) => x.id === +m![1] && x.user_id === +m![2]);
    return r ? [r] : [];
  }
  if ((m = /^SELECT \* FROM story_archive WHERE user_id = (\d+) ORDER BY archived_at DESC/.exec(q))) {
    return [...s.story_archive.filter((r) => r.user_id === +m![1])].sort((a, b) => b.archived_at.localeCompare(a.archived_at));
  }
  if ((m = /^SELECT \* FROM posts WHERE author_id = (\d+) ORDER BY created_at DESC/.exec(q))) {
    return [...s.posts.filter((r) => r.author_id === +m![1])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  if ((m = /^SELECT \* FROM posts WHERE id = (\d+)/.exec(q))) {
    const r = s.posts.find((x) => x.id === +m![1]);
    return r ? [r] : [];
  }
  if ((m = /^SELECT \* FROM reels WHERE author_id = (\d+) ORDER BY created_at DESC/.exec(q))) {
    return [...s.reels.filter((r) => r.author_id === +m![1])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  if ((m = /^SELECT \* FROM drops WHERE creator_id = (\d+) ORDER BY created_at DESC/.exec(q))) {
    return [...s.drops.filter((r) => r.creator_id === +m![1])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  if ((m = /^SELECT \* FROM drops WHERE id = (\d+)/.exec(q))) {
    const r = s.drops.find((x) => x.id === +m![1]);
    return r ? [r] : [];
  }
  if ((m = /^SELECT \* FROM post_comments WHERE post_id = (\d+) ORDER BY created_at ASC/.exec(q))) {
    return [...s.post_comments.filter((r) => r.post_id === +m![1])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  if ((m = /^SELECT p\.\* FROM post_saves s JOIN posts p ON p\.id = s\.post_id WHERE s\.user_id = (\d+) ORDER BY p\.created_at DESC/.exec(q))) {
    const ids = s.post_saves.filter((r) => r.user_id === +m![1]).map((r) => r.post_id);
    return s.posts.filter((p) => ids.includes(p.id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  if ((m = /^SELECT id, type, body, read, created_at FROM notifications WHERE user_id = (\d+) ORDER BY created_at DESC LIMIT 100/.exec(q))) {
    return [...s.notifications.filter((r) => r.user_id === +m![1])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100)
      .map((r) => ({ id: r.id, type: r.type, body: r.body, read: r.read, created_at: r.created_at }));
  }
  if ((m = /^SELECT \* FROM auth_identities WHERE user_id = (\d+)/.exec(q))) {
    return s.auth_identities.filter((r) => r.user_id === +m![1]);
  }
  // 1:1 conversation lookup (findOrCreateConversation + reopen check).
  if (q.includes('FROM conversations c JOIN conversation_members m1')) {
    const a = /m1\.user_id = (\d+)/.exec(q);
    const b = /m2\.user_id = (\d+)/.exec(q);
    if (a && b) {
      const x = +a[1]; const y = +b[1];
      const conv = s.conversations.find((c) => {
        const members = s.conversation_members.filter((mm) => mm.conversation_id === c.id).map((mm) => mm.user_id);
        return members.length === 2 && members.includes(x) && members.includes(y);
      });
      return conv ? [{ id: conv.id }] : [];
    }
  }
  // Message-request list joins.
  if ((m = /^SELECT mr\.id, mr\.sender_id, mr\.body, mr\.created_at, u\.username, u\.display_name, u\.avatar_url FROM message_requests mr JOIN users u ON u\.id = mr\.sender_id WHERE mr\.recipient_id = (\d+) AND mr\.status = '(pending|hidden)' ORDER BY mr\.created_at DESC/.exec(q))) {
    return s.message_requests.filter((r) => r.recipient_id === +m![1] && r.status === m![2])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({ id: r.id, sender_id: r.sender_id, body: r.body, created_at: r.created_at, ...pickUser(s, r.sender_id) }));
  }
  if ((m = /^SELECT mr\.id, mr\.recipient_id, mr\.body, mr\.created_at, u\.username, u\.display_name, u\.avatar_url FROM message_requests mr JOIN users u ON u\.id = mr\.recipient_id WHERE mr\.sender_id = (\d+) AND mr\.status = 'pending' ORDER BY mr\.created_at DESC/.exec(q))) {
    return s.message_requests.filter((r) => r.sender_id === +m![1] && r.status === 'pending')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({ id: r.id, recipient_id: r.recipient_id, body: r.body, created_at: r.created_at, ...pickUser(s, r.recipient_id) }));
  }
  // Relation-list joins (close friends / hide-story / restricted / muted / blocks / followers / following).
  if ((m = /^SELECT u\.id, u\.username, u\.display_name, u\.avatar_url FROM (close_friends|story_hidden_from|restricted_accounts) t JOIN users u ON u\.id = t\.(\w+) WHERE t\.(\w+) = (\d+) ORDER BY u\.display_name/.exec(q))) {
    const tbl = m![1] as keyof MockState;
    const joinCol = m![2]; const whereCol = m![3]; const who = +m![4];
    return (s as any)[tbl].filter((r: Row) => r[whereCol] === who)
      .map((r: Row) => s.users.find((u) => u.id === r[joinCol]))
      .filter(Boolean)
      .sort((a: Row, b: Row) => a.display_name.localeCompare(b.display_name))
      .map((u: Row) => ({ id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url ?? null }));
  }
  if ((m = /^SELECT u\.id, u\.username, u\.display_name, u\.avatar_url FROM (blocks|mutes) \w JOIN users u ON u\.id = \w\.(blocked_id|muted_id) WHERE \w\.(\w+) = (\d+) ORDER BY u\.display_name/.exec(q))) {
    const tbl = m![1] as keyof MockState;
    const joinCol = m![2]; const whereCol = m![3]; const who = +m![4];
    return (s as any)[tbl].filter((r: Row) => r[whereCol] === who)
      .map((r: Row) => s.users.find((u) => u.id === r[joinCol]))
      .filter(Boolean)
      .sort((a: Row, b: Row) => a.display_name.localeCompare(b.display_name))
      .map((u: Row) => ({ id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url ?? null }));
  }
  if ((m = /^SELECT u\.id, u\.username, u\.display_name, u\.avatar_url FROM follows f JOIN users u ON u\.id = f\.follower_id WHERE f\.following_id = (\d+) ORDER BY u\.display_name/.exec(q))) {
    return s.follows.filter((r) => r.following_id === +m![1])
      .map((r) => s.users.find((u) => u.id === r.follower_id)).filter(Boolean)
      .sort((a: Row, b: Row) => a.display_name.localeCompare(b.display_name))
      .map((u: Row) => ({ id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url ?? null }));
  }
  if ((m = /^SELECT u\.id, u\.username, u\.display_name, u\.avatar_url FROM follows f JOIN users u ON u\.id = f\.following_id WHERE f\.follower_id = (\d+) ORDER BY u\.display_name/.exec(q))) {
    return s.follows.filter((r) => r.follower_id === +m![1])
      .map((r) => s.users.find((u) => u.id === r.following_id)).filter(Boolean)
      .sort((a: Row, b: Row) => a.display_name.localeCompare(b.display_name))
      .map((u: Row) => ({ id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url ?? null }));
  }

  throw new Error(`mock: unhandled query: ${q}`);
}

function pickUser(s: MockState, id: number): Row {
  const u = s.users.find((x) => x.id === id);
  return u ? { username: u.username, display_name: u.display_name, avatar_url: u.avatar_url ?? null } : { username: null, display_name: null, avatar_url: null };
}

// --- req/res helpers ----------------------------------------------------------

export function makeReq(opts: {
  method?: string; token?: string | null; query?: Record<string, any>; body?: any; url?: string;
} = {}): any {
  return {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/api/profile/me',
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    query: opts.query ?? {},
    body: opts.body ?? {},
  };
}

export function makeRes(): any {
  const res: any = { statusCode: 0, body: null as any, headers: {} as Record<string, string> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
  return res;
}

/** Seed the standard trio: alice(1, public), bob(2, public), carol(3, private). */
export function seedTrio(s: MockState): { alice: Row; bob: Row; carol: Row } {
  const alice = addUser(s, { id: 1, username: 'alice', display_name: 'Alice', email: 'alice@example.com', google_sub: 'google-alice' });
  const bob = addUser(s, { id: 2, username: 'bob', display_name: 'Bob', email: 'bob@example.com', google_sub: 'google-bob' });
  const carol = addUser(s, { id: 3, username: 'carol', display_name: 'Carol', email: 'carol@example.com', google_sub: 'google-carol', is_private: true });
  addSession(s, 1, 'token-alice');
  addSession(s, 2, 'token-bob');
  addSession(s, 3, 'token-carol');
  return { alice, bob, carol };
}
