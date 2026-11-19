// DROP profile-content suite (recreated 2026-11-19 from current code).
// Covers the Profile-tab handlers in api/lib/profile-handlers.ts:
// server-backed posts/reels/drops/saved, delete-post ownership,
// save toggle, report, DM creation with message-permission enforcement,
// and the post_saves FK migration (was users(id), must be posts(id)).
// 42 checks. Run: ./node_modules/.bin/tsx tests/test-profile-content.mts

import { readFileSync } from 'node:fs';
import { setTestSql } from '../api/lib/db.js';
import {
  handleProfilePosts, handleProfileReels, handleProfileDrops,
  handleCreatePost, handleDeletePost, handleCreateReel,
  handleCreateDrop, handleOpenDrop, handleSaveToggle, handleSaved,
  handleReport, handleCreateConversation,
} from '../api/lib/profile-handlers.js';
import { createMockDb, seedTrio, makeReq, makeRes } from './mock-db.js';
import { createRunner, eq, ok } from './harness.js';

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.POSTGRES_URL_NON_POOLING;

const t = createRunner('test-profile-content');

function fresh() {
  const { sql, state } = createMockDb();
  const trio = seedTrio(state);
  setTestSql(sql);
  return { sql, state, ...trio };
}

async function call(handler: any, opts: any = {}) {
  const req = makeReq(opts);
  const res = makeRes();
  await handler(req, res);
  return res;
}

async function seedPost(sql: any, authorId: number, caption = 'hello') {
  const rows = (await sql`INSERT INTO posts (author_id, caption, media_url, filter, effect, extras_json) VALUES (${authorId}, ${caption}, ${null}, 'original', 'none', ${null}::jsonb) RETURNING *`) as any[];
  return rows[0];
}
async function seedDrop(sql: any, creatorId: number, blastAt: string, caption = 'secret') {
  const rows = (await sql`INSERT INTO drops (creator_id, kind, status, blast_at, caption, media_url) VALUES (${creatorId}, 'public', 'waiting', ${blastAt}, ${caption}, ${null}) RETURNING *`) as any[];
  return rows[0];
}

// ------------------------------------------------------- content lists ----
await t.check('content: GET public user posts → 200 with the post', async () => {
  const { sql, bob } = fresh();
  const post = await seedPost(sql, bob.id);
  const res = await call(handleProfilePosts, { token: 'token-alice', query: { userId: bob.id } });
  eq(res.statusCode, 200);
  eq(res.body.posts.length, 1);
  eq(res.body.posts[0].id, post.id);
  eq(res.body.posts[0].caption, 'hello');
});
await t.check('content: GET private user posts, non-follower → 403', async () => {
  const { sql, carol } = fresh();
  await seedPost(sql, carol.id);
  eq((await call(handleProfilePosts, { token: 'token-alice', query: { userId: carol.id } })).statusCode, 403);
});
await t.check('content: GET posts as blocked viewer → 404 (never a hint)', async () => {
  const { sql, state, bob } = fresh();
  await seedPost(sql, bob.id);
  state.blocks.push({ blocker_id: bob.id, blocked_id: 1 });
  eq((await call(handleProfilePosts, { token: 'token-alice', query: { userId: bob.id } })).statusCode, 404);
});
await t.check('content: GET posts for unknown user → 404', async () => {
  fresh();
  eq((await call(handleProfilePosts, { token: 'token-alice', query: { userId: 999 } })).statusCode, 404);
});
await t.check('content: GET posts with no DB → 503 (fail-closed)', async () => {
  fresh();
  setTestSql(null);
  const res = await call(handleProfilePosts, { token: 'token-alice', query: { userId: 2 } });
  eq(res.statusCode, 503);
});
await t.check('content: POST to posts list handler → 405', async () => {
  fresh();
  eq((await call(handleProfilePosts, { method: 'POST', token: 'token-alice', query: { userId: 2 } })).statusCode, 405);
});
await t.check('content: GET reels → 200 with the reel', async () => {
  const { sql, bob } = fresh();
  await sql`INSERT INTO reels (author_id, media_url) VALUES (${bob.id}, 'https://x/reel.mp4') RETURNING *`;
  const res = await call(handleProfileReels, { token: 'token-alice', query: { userId: bob.id } });
  eq(res.statusCode, 200);
  eq(res.body.reels.length, 1);
  eq(res.body.reels[0].mediaUrl, 'https://x/reel.mp4');
});
await t.check('content: GET drops seals caption/media for non-creator before blast', async () => {
  const { sql, bob } = fresh();
  await seedDrop(sql, bob.id, '2030-01-01T00:00:00.000Z', 'secret caption');
  const res = await call(handleProfileDrops, { token: 'token-alice', query: { userId: bob.id } });
  eq(res.statusCode, 200);
  eq(res.body.drops.length, 1);
  eq(res.body.drops[0].caption, null);
  eq(res.body.drops[0].mediaUrl, null);
});
await t.check('content: GET drops shows caption to the creator before blast', async () => {
  const { sql, bob } = fresh();
  await seedDrop(sql, bob.id, '2030-01-01T00:00:00.000Z', 'secret caption');
  const res = await call(handleProfileDrops, { token: 'token-bob', query: { userId: bob.id } });
  eq(res.body.drops[0].caption, 'secret caption');
});

// ------------------------------------------------------- create / delete ---
await t.check('content: POST create post → 200 with defaults', async () => {
  fresh();
  const res = await call(handleCreatePost, { method: 'POST', token: 'token-alice', body: { caption: 'my first post' } });
  eq(res.statusCode, 200);
  eq(res.body.post.caption, 'my first post');
  eq(res.body.post.filter, 'original');
  eq(res.body.post.fireCount, 0);
});
await t.check('content: POST create post empty caption → 400', async () => {
  fresh();
  eq((await call(handleCreatePost, { method: 'POST', token: 'token-alice', body: { caption: '   ' } })).statusCode, 400);
});
await t.check('content: POST create post caption >2000 → 400', async () => {
  fresh();
  eq((await call(handleCreatePost, { method: 'POST', token: 'token-alice', body: { caption: 'x'.repeat(2001) } })).statusCode, 400);
});
await t.check('content: POST create post invalid extras JSON → 400', async () => {
  fresh();
  eq((await call(handleCreatePost, { method: 'POST', token: 'token-alice', body: { caption: 'hi', extrasJson: '{bad' } })).statusCode, 400);
});
await t.check('content: POST create post extras >10000 chars → 400', async () => {
  fresh();
  eq((await call(handleCreatePost, { method: 'POST', token: 'token-alice', body: { caption: 'hi', extrasJson: JSON.stringify({ pad: 'x'.repeat(10001) }) } })).statusCode, 400);
});
await t.check('content: POST create post mentioning nobody-allows user → 400', async () => {
  const { state } = fresh();
  state.privacy_preferences.push({ user_id: 2, who_can_mention: 'nobody' });
  const res = await call(handleCreatePost, { method: 'POST', token: 'token-alice', body: { caption: 'hi @bob', extrasJson: JSON.stringify({ mentionUserId: 2 }) } });
  eq(res.statusCode, 400);
  eq(res.body.error, 'This account does not allow mentions.');
});
await t.check('content: POST create post mentioning friends-only non-mutual → 400', async () => {
  const { state } = fresh();
  state.privacy_preferences.push({ user_id: 2, who_can_mention: 'friends' });
  const res = await call(handleCreatePost, { method: 'POST', token: 'token-alice', body: { caption: 'hi @bob', extrasJson: JSON.stringify({ mentionUserId: 2 }) } });
  eq(res.statusCode, 400);
});
await t.check('content: POST create post without token → 401', async () => {
  fresh();
  eq((await call(handleCreatePost, { method: 'POST', body: { caption: 'hi' } })).statusCode, 401);
});
await t.check('content: DELETE own post → 200 and removes its saves', async () => {
  const { sql, state, alice, bob } = fresh();
  const post = await seedPost(sql, alice.id);
  state.post_saves.push({ user_id: bob.id, post_id: post.id });
  const res = await call(handleDeletePost, { method: 'DELETE', token: 'token-alice', query: { id: post.id } });
  eq(res.statusCode, 200);
  eq(state.posts.some((p) => p.id === post.id), false);
  eq(state.post_saves.some((s) => s.post_id === post.id), false);
});
await t.check('content: DELETE another user post → 403', async () => {
  const { sql, bob } = fresh();
  const post = await seedPost(sql, bob.id);
  eq((await call(handleDeletePost, { method: 'DELETE', token: 'token-alice', query: { id: post.id } })).statusCode, 403);
});
await t.check('content: DELETE unknown post → 404', async () => {
  fresh();
  eq((await call(handleDeletePost, { method: 'DELETE', token: 'token-alice', query: { id: 999 } })).statusCode, 404);
});
await t.check('content: DELETE bad id → 400', async () => {
  fresh();
  eq((await call(handleDeletePost, { method: 'DELETE', token: 'token-alice', query: { id: 'x' } })).statusCode, 400);
});
await t.check('content: POST create reel → 200', async () => {
  fresh();
  const res = await call(handleCreateReel, { method: 'POST', token: 'token-alice', body: { mediaUrl: 'https://x/reel.mp4' } });
  eq(res.statusCode, 200);
  eq(res.body.reel.mediaUrl, 'https://x/reel.mp4');
});
await t.check('content: POST create reel without media → 400', async () => {
  fresh();
  eq((await call(handleCreateReel, { method: 'POST', token: 'token-alice', body: { mediaUrl: '' } })).statusCode, 400);
});
await t.check('content: POST create drop future blast → 200 waiting', async () => {
  fresh();
  const res = await call(handleCreateDrop, { method: 'POST', token: 'token-alice', body: { kind: 'public', blastAt: '2030-01-01T00:00:00.000Z', caption: 'soon' } });
  eq(res.statusCode, 200);
  eq(res.body.drop.status, 'waiting');
  eq(res.body.drop.caption, 'soon');
});
await t.check('content: POST create drop past blast → 200 ready', async () => {
  fresh();
  const res = await call(handleCreateDrop, { method: 'POST', token: 'token-alice', body: { kind: 'protected', blastAt: '2020-01-01T00:00:00.000Z' } });
  eq(res.statusCode, 200);
  eq(res.body.drop.status, 'ready');
});
await t.check('content: POST create drop bad kind → 400', async () => {
  fresh();
  eq((await call(handleCreateDrop, { method: 'POST', token: 'token-alice', body: { kind: 'secret', blastAt: '2030-01-01T00:00:00.000Z' } })).statusCode, 400);
});
await t.check('content: POST create drop bad blastAt → 400', async () => {
  fresh();
  eq((await call(handleCreateDrop, { method: 'POST', token: 'token-alice', body: { kind: 'public', blastAt: 'not-a-date' } })).statusCode, 400);
});
await t.check('content: POST open drop before blast, non-creator → 403', async () => {
  const { sql, bob } = fresh();
  const drop = await seedDrop(sql, bob.id, '2030-01-01T00:00:00.000Z');
  eq((await call(handleOpenDrop, { method: 'POST', token: 'token-alice', body: { dropId: drop.id } })).statusCode, 403);
});
await t.check('content: POST open drop after blast → 200 revealed + records open', async () => {
  const { sql, state, bob } = fresh();
  const drop = await seedDrop(sql, bob.id, '2020-01-01T00:00:00.000Z', 'revealed caption');
  const res = await call(handleOpenDrop, { method: 'POST', token: 'token-alice', body: { dropId: drop.id } });
  eq(res.statusCode, 200);
  eq(res.body.drop.status, 'revealed');
  eq(res.body.drop.caption, 'revealed caption');
  eq(state.drop_opens.some((o) => o.drop_id === drop.id && o.user_id === 1), true);
});

// ------------------------------------------------------------- saves -------
await t.check('content: POST save toggles on → saved true', async () => {
  const { sql, bob } = fresh();
  const post = await seedPost(sql, bob.id);
  const res = await call(handleSaveToggle, { method: 'POST', token: 'token-alice', body: { postId: post.id } });
  eq(res.statusCode, 200);
  eq(res.body.saved, true);
});
await t.check('content: POST save again toggles off → saved false', async () => {
  const { sql, bob } = fresh();
  const post = await seedPost(sql, bob.id);
  await call(handleSaveToggle, { method: 'POST', token: 'token-alice', body: { postId: post.id } });
  const res = await call(handleSaveToggle, { method: 'POST', token: 'token-alice', body: { postId: post.id } });
  eq(res.body.saved, false);
});
await t.check('content: GET me/saved returns saved posts', async () => {
  const { sql, bob } = fresh();
  const post = await seedPost(sql, bob.id);
  await call(handleSaveToggle, { method: 'POST', token: 'token-alice', body: { postId: post.id } });
  const res = await call(handleSaved, { token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.posts.length, 1);
  eq(res.body.posts[0].id, post.id);
});

// ------------------------------------------------------------ report / DM --
await t.check('content: POST report stores server-side → 200', async () => {
  const { state } = fresh();
  const res = await call(handleReport, { method: 'POST', token: 'token-alice', body: { targetId: 2, reason: 'spam' } });
  eq(res.statusCode, 200);
  eq(state.reports.length, 1);
  eq(state.reports[0].reason, 'spam');
});
await t.check('content: POST report self → 400', async () => {
  fresh();
  eq((await call(handleReport, { method: 'POST', token: 'token-alice', body: { targetId: 1 } })).statusCode, 400);
});
await t.check('content: POST report unknown user → 404', async () => {
  fresh();
  eq((await call(handleReport, { method: 'POST', token: 'token-alice', body: { targetId: 999 } })).statusCode, 404);
});
await t.check('content: POST conversation creates 1:1 DM → 200', async () => {
  fresh();
  const res = await call(handleCreateConversation, { method: 'POST', token: 'token-alice', body: { targetId: 2 } });
  eq(res.statusCode, 200);
  ok(typeof res.body.conversationId === 'number');
});
await t.check('content: POST conversation blocked → 403', async () => {
  const { state } = fresh();
  state.blocks.push({ blocker_id: 2, blocked_id: 1 });
  eq((await call(handleCreateConversation, { method: 'POST', token: 'token-alice', body: { targetId: 2 } })).statusCode, 403);
});
await t.check('content: POST conversation friends-only target → message request, not error', async () => {
  const { state } = fresh();
  state.privacy_preferences.push({ user_id: 2, who_can_message: 'friends' });
  const res = await call(handleCreateConversation, { method: 'POST', token: 'token-alice', body: { targetId: 2, body: 'hey' } });
  eq(res.statusCode, 200);
  eq(res.body.status, 'requested');
  ok(typeof res.body.requestId === 'number');
});
await t.check('content: POST conversation nobody target → 403', async () => {
  const { state } = fresh();
  state.privacy_preferences.push({ user_id: 2, who_can_message: 'nobody' });
  eq((await call(handleCreateConversation, { method: 'POST', token: 'token-alice', body: { targetId: 2 } })).statusCode, 403);
});
await t.check('content: POST conversation twice returns same id', async () => {
  fresh();
  const a = await call(handleCreateConversation, { method: 'POST', token: 'token-alice', body: { targetId: 2 } });
  const b = await call(handleCreateConversation, { method: 'POST', token: 'token-alice', body: { targetId: 2 } });
  eq(a.body.conversationId, b.body.conversationId);
});

// ------------------------------------------------- migration SQL checks ---
await t.check('migration: server/schema.ts post_saves FK references posts(id)', () => {
  const ddl = readFileSync(new URL('../server/schema.ts', import.meta.url), 'utf8');
  ok(ddl.includes('post_saves (user_id INT REFERENCES users(id), post_id INT REFERENCES posts(id)'), 'post_saves FK');
});
await t.check('migration: profile.ts repairs a wrong post_saves FK to posts', () => {
  const src = readFileSync(new URL('../api/lib/profile.ts', import.meta.url), 'utf8');
  ok(src.includes("confrelid <> 'posts'::regclass"), 'FK repair guard');
  ok(src.includes('FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE'), 'FK repair target');
});

t.finish();
