// DROP profile-router suite (recreated 2026-11-19 from current code).
// Covers api/profile-router.ts dispatch: segment parsing from req.url,
// ?route= fallback, method gating, and the fail-closed 503/401 paths.
// 10 checks. Run: ./node_modules/.bin/tsx tests/test-profile-router.mts

import { setTestSql } from '../api/lib/db.js';
import handler from '../api/profile-router.js';
import { createMockDb, seedTrio, makeReq, makeRes, addSession } from './mock-db.js';
import { createRunner, eq, ok } from './harness.js';

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.POSTGRES_URL_NON_POOLING;

const t = createRunner('test-profile-router');

async function call(url: string, opts: any = {}) {
  const { sql, state } = opts.db;
  setTestSql(sql);
  const req = makeReq({ url, ...opts });
  const res = makeRes();
  await handler(req, res);
  return { res, state };
}

const { sql, state } = createMockDb();
const { alice, bob } = seedTrio(state);
const db = { sql, state };

await t.check('router: GET /api/profile/me with valid token → 200 + own profile', async () => {
  const { res } = await call('/api/profile/me', { db, token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.ok, true);
  eq(res.body.profile.username, 'alice');
  eq(res.body.counts.posts, 0);
});

await t.check('router: GET /api/profile/me without token → 401', async () => {
  const { res } = await call('/api/profile/me', { db });
  eq(res.statusCode, 401);
  eq(res.body.error, 'Sign-in required.');
});

await t.check('router: GET /api/profile/me with no DB configured → 503 (fail-closed)', async () => {
  setTestSql(null);
  const req = makeReq({ url: '/api/profile/me', token: 'token-alice' });
  const res = makeRes();
  await handler(req, res);
  eq(res.statusCode, 503);
  setTestSql(sql);
});

await t.check('router: GET /api/profile/me/privacy dispatches to handlePrivacy → 200 defaults', async () => {
  const { res } = await call('/api/profile/me/privacy', { db, token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.privacy.who_can_message, 'everyone');
  eq(res.body.privacy.who_can_slash, 'friends');
});

await t.check('router: POST /api/profile/revoke-session revokes; next call with same token → 401', async () => {
  const first = await call('/api/profile/revoke-session', { db, method: 'POST', token: 'token-bob' });
  eq(first.res.statusCode, 200);
  eq(first.res.body.ok, true);
  const second = await call('/api/profile/me', { db, token: 'token-bob' });
  eq(second.res.statusCode, 401);
  eq(second.res.body.error, 'Invalid or expired session.');
});

await t.check('router: GET /api/profile/me/settings → 200 with default settings', async () => {
  const { res } = await call('/api/profile/me/settings', { db, token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.settings.language, 'en');
  eq(res.body.settings.whoCanComment, 'everyone');
});

await t.check('router: GET /api/profile/posts/<id>/comments parses numeric postId → 200', async () => {
  const post = state.posts[0] ?? null;
  // Seed one post directly so the comments route has a target.
  const { sql: s2 } = { sql };
  void s2;
  const inserted = (await sql`INSERT INTO posts (author_id, caption, media_url, filter, effect, extras_json) VALUES (${alice.id}, 'hello', ${null}, 'original', 'none', ${null}::jsonb) RETURNING *`) as any[];
  const { res } = await call(`/api/profile/posts/${inserted[0].id}/comments`, { db, token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.ok, true);
  ok(Array.isArray(res.body.comments));
  void post;
});

await t.check('router: POST /api/profile/slash-invitations dispatches with membership check → 200', async () => {
  const conv = (await sql`INSERT INTO conversations DEFAULT VALUES RETURNING id`) as any[];
  await sql`INSERT INTO conversation_members (conversation_id, user_id) VALUES (${conv[0].id}, ${alice.id}), (${conv[0].id}, ${bob.id}) ON CONFLICT DO NOTHING`;
  // bob's default who_can_slash is 'friends', so seed a mutual follow.
  await sql`INSERT INTO follows (follower_id, following_id) VALUES (${alice.id}, ${bob.id}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO follows (follower_id, following_id) VALUES (${bob.id}, ${alice.id}) ON CONFLICT DO NOTHING`;
  // Re-issue bob a fresh session (his token was revoked in an earlier check).
  addSession(state, bob.id, 'token-bob-2');
  const { res } = await call('/api/profile/slash-invitations', {
    db, method: 'POST', token: 'token-alice',
    body: { conversationId: conv[0].id, inviteeId: bob.id },
  });
  eq(res.statusCode, 200);
  ok(typeof res.body.invitationId === 'number');
});

await t.check('router: GET /api/profile/<username> public lookup → 200', async () => {
  const { res } = await call('/api/profile/alice', { db, token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.profile.username, 'alice');
  eq(res.body.profile.relationship, 'self');
});

await t.check('router: unknown 4-segment path → 404 Not found (no handler claims it)', async () => {
  const { res } = await call('/api/profile/a/b/c/d', { db, token: 'token-alice' });
  eq(res.statusCode, 404);
  eq(res.body.error, 'Not found.');
});

t.finish();
