// DROP Settings server suite (recreated 2026-11-19 from current code).
// Covers api/lib/profile.ts settings/privacy helpers + the Settings
// handlers in api/lib/profile-handlers.ts: parseSettings/getSettings
// validation, close-friends / hide-story-from / restricted lists,
// hidden words, notifications, archive, apps, status, message
// requests, post comments, and Slash. 176 checks.
// Run: ./node_modules/.bin/tsx tests/test-settings-server.mts

import { setTestSql } from '../api/lib/db.js';
import {
  DEFAULT_SETTINGS, parseSettings, getSettings, parsePrivacy,
  getPrivacy, savePrivacy, validateHiddenWord, containsHiddenWord,
  containsHiddenWordExact, canMessage,
} from '../api/lib/profile.js';
import {
  handleSettings, handleCloseFriends, handleHideStoryFrom,
  handleRestricted, handleMutedList, handleHiddenWords,
  handleNotificationsList, handleNotificationsRead, handleArchive,
  handleApps, handleStatus, handleMessageRequestsList,
  handleMessageRequestAnswer, handlePostComments,
  handleSlashCreate, handleSlashAnswer, handleSlashLeave,
} from '../api/lib/profile-handlers.js';
import { createMockDb, seedTrio, makeReq, makeRes, addSession } from './mock-db.js';
import { createRunner, eq, ok } from './harness.js';

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.POSTGRES_URL_NON_POOLING;

const t = createRunner('test-settings-server');

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

// ------------------------------------------------ Section A: unit checks --
const BOOL_FIELDS = ['reduceMotion', 'hideLikeCounts', 'saveStoryToArchive', 'gifComments', 'allowStoryShares', 'aiGeneratedLabel', 'showAccountSuggestions', 'notifyFollow', 'notifyFollowRequest', 'notifyComment', 'notifyMention', 'notifyMessage', 'notifySlash', 'notifyDrop'] as const;

await t.check('settings: DEFAULT_SETTINGS.language is en', () => eq(DEFAULT_SETTINGS.language, 'en'));
await t.check('settings: DEFAULT_SETTINGS.whoCanComment is everyone', () => eq(DEFAULT_SETTINGS.whoCanComment, 'everyone'));
await t.check('settings: DEFAULT_SETTINGS.storyReplies is followers', () => eq(DEFAULT_SETTINGS.storyReplies, 'followers'));
await t.check('settings: DEFAULT_SETTINGS.accountType is personal', () => eq(DEFAULT_SETTINGS.accountType, 'personal'));
await t.check('settings: DEFAULT_SETTINGS.gifComments is true', () => eq(DEFAULT_SETTINGS.gifComments, true));
await t.check('settings: DEFAULT_SETTINGS.notifyFollow is true', () => eq(DEFAULT_SETTINGS.notifyFollow, true));

for (const f of BOOL_FIELDS) {
  await t.check(`settings: parseSettings rejects non-boolean ${f}`, () => {
    const r = parseSettings({ [f]: 'yes' }, { ...DEFAULT_SETTINGS });
    eq(typeof r, 'string');
    ok((r as string).includes(f));
  });
  await t.check(`settings: parseSettings accepts boolean ${f}`, () => {
    const r = parseSettings({ [f]: false }, { ...DEFAULT_SETTINGS }) as any;
    eq(typeof r, 'object');
    eq(r[f], false);
  });
}

const ENUM_CASES: [string, string, string][] = [
  ['language', 'es', 'xx'],
  ['sensitiveContentLevel', 'less', 'extreme'],
  ['storyReplies', 'off', 'all'],
  ['whoCanComment', 'mutual', 'nobody'],
  ['accountType', 'creator', 'admin'],
];
for (const [field, good, bad] of ENUM_CASES) {
  await t.check(`settings: parseSettings accepts valid ${field}=${good}`, () => {
    const r = parseSettings({ [field]: good }, { ...DEFAULT_SETTINGS }) as any;
    eq(r[field], good);
  });
  await t.check(`settings: parseSettings rejects invalid ${field}=${bad}`, () => {
    const r = parseSettings({ [field]: bad }, { ...DEFAULT_SETTINGS });
    eq(typeof r, 'string');
  });
}
await t.check('settings: parseSettings accepts gender=female', () => {
  const r = parseSettings({ gender: 'female' }, { ...DEFAULT_SETTINGS }) as any;
  eq(r.gender, 'female');
});
await t.check('settings: parseSettings rejects gender=x', () => {
  eq(typeof parseSettings({ gender: 'x' }, { ...DEFAULT_SETTINGS }), 'string');
});
await t.check('settings: parseSettings clears gender on null', () => {
  const r = parseSettings({ gender: null }, { ...DEFAULT_SETTINGS, gender: 'female' }) as any;
  eq(r.gender, null);
});

await t.check('settings: parseSettings ignores unknown keys', () => {
  const r = parseSettings({ totallyMadeUp: true } as any, { ...DEFAULT_SETTINGS }) as any;
  eq(r.language, 'en');
  eq('totallyMadeUp' in r, false);
});

await t.check('settings: getSettings with no row returns defaults', async () => {
  const { sql, state, alice } = fresh();
  const s = await getSettings(sql, alice.id);
  eq(s.language, 'en');
  eq(s.whoCanComment, 'everyone');
  void state;
});
await t.check('settings: getSettings with stored row returns stored values', async () => {
  const { sql, state, alice } = fresh();
  state.user_settings.push({ user_id: alice.id, language: 'fr', reduce_motion: true });
  const s = await getSettings(sql, alice.id);
  eq(s.language, 'fr');
  eq(s.reduceMotion, true);
  eq(s.whoCanComment, 'everyone'); // unset columns keep defaults
});

await t.check('privacy: parsePrivacy rejects invalid who_can_message', () => {
  const r = parsePrivacy({ who_can_message: 'all' }, { is_private: false, activity_status: true, read_receipts: true, who_can_message: 'everyone', who_can_slash: 'friends', who_can_mention: 'everyone', who_can_tag: 'friends', default_room_identity: 'drop' });
  eq(typeof r, 'string');
});
await t.check('privacy: parsePrivacy rejects invalid default_room_identity', () => {
  const r = parsePrivacy({ default_room_identity: 'alias' }, { is_private: false, activity_status: true, read_receipts: true, who_can_message: 'everyone', who_can_slash: 'friends', who_can_mention: 'everyone', who_can_tag: 'friends', default_room_identity: 'drop' });
  eq(typeof r, 'string');
});

await t.check('hidden-words: validateHiddenWord normalises "  Spam " to spam', () => {
  const r = validateHiddenWord('  Spam ');
  eq(r.ok, true);
  if (r.ok) eq(r.word, 'spam');
});
await t.check('hidden-words: validateHiddenWord rejects >50 chars', () => {
  eq(validateHiddenWord('x'.repeat(51)).ok, false);
});
await t.check('hidden-words: validateHiddenWord rejects punctuation', () => {
  eq(validateHiddenWord('!!!').ok, false);
});
await t.check('hidden-words: validateHiddenWord rejects non-string', () => {
  eq(validateHiddenWord(42).ok, false);
});

await t.check('hidden-words: containsHiddenWord matches whole word', () => {
  eq(containsHiddenWord('this is spam here', ['spam']), true);
});
await t.check('hidden-words: containsHiddenWord ignores substring spammy', () => {
  eq(containsHiddenWord('spammy post', ['spam']), false);
});
await t.check('hidden-words: containsHiddenWord is case-insensitive', () => {
  eq(containsHiddenWord('SPAM post', ['spam']), true);
});
await t.check('hidden-words: containsHiddenWordExact matches token', () => {
  eq(containsHiddenWordExact('say spam now', ['spam']), true);
});
await t.check('hidden-words: containsHiddenWordExact ignores substring', () => {
  eq(containsHiddenWordExact('spammy', ['spam']), false);
});

await t.check('canMessage: everyone allows any viewer', async () => {
  const { sql, state, alice, bob } = fresh();
  state.privacy_preferences.push({ user_id: bob.id, who_can_message: 'everyone' });
  eq(await canMessage(sql, alice.id, bob as any), true);
});
await t.check('canMessage: nobody blocks any viewer', async () => {
  const { sql, state, alice, bob } = fresh();
  state.privacy_preferences.push({ user_id: bob.id, who_can_message: 'nobody' });
  eq(await canMessage(sql, alice.id, bob as any), false);
});
await t.check('canMessage: friends allows mutual follow', async () => {
  const { sql, state, alice, bob } = fresh();
  state.privacy_preferences.push({ user_id: bob.id, who_can_message: 'friends' });
  state.follows.push({ follower_id: alice.id, following_id: bob.id }, { follower_id: bob.id, following_id: alice.id });
  eq(await canMessage(sql, alice.id, bob as any), true);
});
await t.check('canMessage: friends blocks one-way follow', async () => {
  const { sql, state, alice, bob } = fresh();
  state.privacy_preferences.push({ user_id: bob.id, who_can_message: 'friends' });
  state.follows.push({ follower_id: alice.id, following_id: bob.id });
  eq(await canMessage(sql, alice.id, bob as any), false);
});
await t.check('canMessage: blocked either way blocks', async () => {
  const { sql, state, alice, bob } = fresh();
  state.privacy_preferences.push({ user_id: bob.id, who_can_message: 'everyone' });
  state.blocks.push({ blocker_id: bob.id, blocked_id: alice.id });
  eq(await canMessage(sql, alice.id, bob as any), false);
});
await t.check('canMessage: null viewer cannot message', async () => {
  const { sql, state, bob } = fresh();
  state.privacy_preferences.push({ user_id: bob.id, who_can_message: 'everyone' });
  eq(await canMessage(sql, null, bob as any), false);
});

// ------------------------------------------- Section B: handleSettings ----
await t.check('handleSettings: GET returns 200 defaults', async () => {
  fresh();
  const res = await call(handleSettings, { token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.settings.language, 'en');
});
await t.check('handleSettings: GET without token → 401', async () => {
  fresh();
  const res = await call(handleSettings, {});
  eq(res.statusCode, 401);
});
await t.check('handleSettings: GET with no DB → 503', async () => {
  fresh();
  setTestSql(null);
  const res = await call(handleSettings, { token: 'token-alice' });
  eq(res.statusCode, 503);
});
await t.check('handleSettings: PATCH valid persists and returns merged settings', async () => {
  const { sql, state, alice } = fresh();
  const res = await call(handleSettings, { method: 'PATCH', token: 'token-alice', body: { language: 'es', hideLikeCounts: true } });
  eq(res.statusCode, 200);
  eq(res.body.settings.language, 'es');
  eq(res.body.settings.hideLikeCounts, true);
  eq(res.body.settings.whoCanComment, 'everyone'); // untouched key preserved
  const stored = state.user_settings.find((r) => r.user_id === alice.id);
  eq(stored?.language, 'es');
  void sql;
});
await t.check('handleSettings: PATCH invalid value → 400', async () => {
  fresh();
  const res = await call(handleSettings, { method: 'PATCH', token: 'token-alice', body: { language: 'xx' } });
  eq(res.statusCode, 400);
});
await t.check('handleSettings: PUT → 405', async () => {
  fresh();
  const res = await call(handleSettings, { method: 'PUT', token: 'token-alice' });
  eq(res.statusCode, 405);
});

// --------------------------------- Section C: relation lists (×3 handlers) --
const LIST_HANDLERS: [string, any, string][] = [
  ['close-friends', handleCloseFriends, 'close_friends'],
  ['hide-story-from', handleHideStoryFrom, 'hide-story-from'],
  ['restricted', handleRestricted, 'restricted'],
];
for (const [name, handler, _table] of LIST_HANDLERS) {
  await t.check(`${name}: GET empty list → 200 []`, async () => {
    fresh();
    const res = await call(handler, { token: 'token-alice' });
    eq(res.statusCode, 200);
    eq(JSON.stringify(res.body.users), '[]');
  });
  await t.check(`${name}: POST add → 200 with user brief`, async () => {
    fresh();
    const res = await call(handler, { method: 'POST', token: 'token-alice', body: { userId: 2 } });
    eq(res.statusCode, 200);
    eq(res.body.user.username, 'bob');
  });
  await t.check(`${name}: POST self → 400`, async () => {
    fresh();
    const res = await call(handler, { method: 'POST', token: 'token-alice', body: { userId: 1 } });
    eq(res.statusCode, 400);
  });
  await t.check(`${name}: POST unknown user → 404`, async () => {
    fresh();
    const res = await call(handler, { method: 'POST', token: 'token-alice', body: { userId: 999 } });
    eq(res.statusCode, 404);
  });
  await t.check(`${name}: POST blocked user → 403`, async () => {
    const { state } = fresh();
    state.blocks.push({ blocker_id: 1, blocked_id: 2 });
    const res = await call(handler, { method: 'POST', token: 'token-alice', body: { userId: 2 } });
    eq(res.statusCode, 403);
  });
  await t.check(`${name}: DELETE removes → 200`, async () => {
    fresh();
    await call(handler, { method: 'POST', token: 'token-alice', body: { userId: 2 } });
    const res = await call(handler, { method: 'DELETE', token: 'token-alice', query: { userId: 2 } });
    eq(res.statusCode, 200);
    const after = await call(handler, { token: 'token-alice' });
    eq(after.body.users.length, 0);
  });
  await t.check(`${name}: GET lists added user`, async () => {
    fresh();
    await call(handler, { method: 'POST', token: 'token-alice', body: { userId: 2 } });
    const res = await call(handler, { token: 'token-alice' });
    eq(res.body.users.length, 1);
    eq(res.body.users[0].username, 'bob');
  });
  await t.check(`${name}: PUT → 405`, async () => {
    fresh();
    const res = await call(handler, { method: 'PUT', token: 'token-alice' });
    eq(res.statusCode, 405);
  });
  await t.check(`${name}: GET without token → 401`, async () => {
    fresh();
    const res = await call(handler, {});
    eq(res.statusCode, 401);
  });
  void _table;
}

// ------------------------------------------------ Section D: muted list ---
await t.check('muted: GET returns seeded mute → 200', async () => {
  const { state } = fresh();
  state.mutes.push({ muter_id: 1, muted_id: 2, scope: 'all' });
  const res = await call(handleMutedList, { token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.users.length, 1);
  eq(res.body.users[0].username, 'bob');
});
await t.check('muted: GET without token → 401', async () => {
  fresh();
  eq((await call(handleMutedList, {})).statusCode, 401);
});
await t.check('muted: POST → 405 (mute/unmute live on /mute)', async () => {
  fresh();
  eq((await call(handleMutedList, { method: 'POST', token: 'token-alice' })).statusCode, 405);
});

// ---------------------------------------------- Section E: hidden words ---
await t.check('hidden-words: GET empty → 200 []', async () => {
  fresh();
  const res = await call(handleHiddenWords, { token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(JSON.stringify(res.body.words), '[]');
});
await t.check('hidden-words: POST valid stores lowercased word', async () => {
  fresh();
  const res = await call(handleHiddenWords, { method: 'POST', token: 'token-alice', body: { word: 'Spam' } });
  eq(res.statusCode, 200);
  eq(JSON.stringify(res.body.words), '["spam"]');
});
await t.check('hidden-words: POST punctuation → 400', async () => {
  fresh();
  eq((await call(handleHiddenWords, { method: 'POST', token: 'token-alice', body: { word: '!!!' } })).statusCode, 400);
});
await t.check('hidden-words: POST >50 chars → 400', async () => {
  fresh();
  eq((await call(handleHiddenWords, { method: 'POST', token: 'token-alice', body: { word: 'x'.repeat(51) } })).statusCode, 400);
});
await t.check('hidden-words: POST non-string → 400', async () => {
  fresh();
  eq((await call(handleHiddenWords, { method: 'POST', token: 'token-alice', body: { word: 42 } })).statusCode, 400);
});
await t.check('hidden-words: POST duplicate is idempotent (still 1 word)', async () => {
  fresh();
  await call(handleHiddenWords, { method: 'POST', token: 'token-alice', body: { word: 'spam' } });
  const res = await call(handleHiddenWords, { method: 'POST', token: 'token-alice', body: { word: 'SPAM' } });
  eq(res.statusCode, 200);
  eq(res.body.words.length, 1);
});
await t.check('hidden-words: 100-word cap → 400 on 101st', async () => {
  const { state } = fresh();
  for (let i = 0; i < 100; i++) state.hidden_words.push({ user_id: 1, word: `word${i}` });
  const res = await call(handleHiddenWords, { method: 'POST', token: 'token-alice', body: { word: 'newword' } });
  eq(res.statusCode, 400);
  eq(res.body.error, 'You can hide up to 100 words.');
});
await t.check('hidden-words: DELETE removes word', async () => {
  fresh();
  await call(handleHiddenWords, { method: 'POST', token: 'token-alice', body: { word: 'spam' } });
  const res = await call(handleHiddenWords, { method: 'DELETE', token: 'token-alice', query: { word: 'spam' } });
  eq(res.statusCode, 200);
  eq(JSON.stringify(res.body.words), '[]');
});
await t.check('hidden-words: DELETE invalid word → 400', async () => {
  fresh();
  eq((await call(handleHiddenWords, { method: 'DELETE', token: 'token-alice', query: { word: '!!!' } })).statusCode, 400);
});
await t.check('hidden-words: GET without token → 401', async () => {
  fresh();
  eq((await call(handleHiddenWords, {})).statusCode, 401);
});

// --------------------------------------------- Section F: notifications ---
await t.check('notifications: GET returns newest first (limit 100)', async () => {
  const { state } = fresh();
  state.notifications.push(
    { id: 1, user_id: 1, type: 'follow', body: 'old', read: false, created_at: '2026-11-19T10:00:00.000Z' },
    { id: 2, user_id: 1, type: 'comment', body: 'new', read: false, created_at: '2026-11-19T12:00:00.000Z' },
    { id: 3, user_id: 2, type: 'follow', body: 'other user', read: false, created_at: '2026-11-19T13:00:00.000Z' },
  );
  const res = await call(handleNotificationsList, { token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.notifications.length, 2);
  eq(res.body.notifications[0].body, 'new');
});
await t.check('notifications: GET without token → 401', async () => {
  fresh();
  eq((await call(handleNotificationsList, {})).statusCode, 401);
});
await t.check('notifications: POST read {id} marks only that one', async () => {
  const { state } = fresh();
  state.notifications.push(
    { id: 1, user_id: 1, type: 'follow', body: 'a', read: false, created_at: '2026-11-19T10:00:00.000Z' },
    { id: 2, user_id: 1, type: 'comment', body: 'b', read: false, created_at: '2026-11-19T11:00:00.000Z' },
  );
  const res = await call(handleNotificationsRead, { method: 'POST', token: 'token-alice', body: { id: 1 } });
  eq(res.statusCode, 200);
  eq(state.notifications.find((n) => n.id === 1)?.read, true);
  eq(state.notifications.find((n) => n.id === 2)?.read, false);
});
await t.check('notifications: POST read {} marks all', async () => {
  const { state } = fresh();
  state.notifications.push(
    { id: 1, user_id: 1, type: 'follow', body: 'a', read: false, created_at: '2026-11-19T10:00:00.000Z' },
    { id: 2, user_id: 1, type: 'comment', body: 'b', read: false, created_at: '2026-11-19T11:00:00.000Z' },
  );
  const res = await call(handleNotificationsRead, { method: 'POST', token: 'token-alice', body: {} });
  eq(res.statusCode, 200);
  eq(state.notifications.every((n) => n.read), true);
});
await t.check('notifications: POST read invalid id → 400', async () => {
  fresh();
  eq((await call(handleNotificationsRead, { method: 'POST', token: 'token-alice', body: { id: 0 } })).statusCode, 400);
});
await t.check('notifications: PUT list → 405', async () => {
  fresh();
  eq((await call(handleNotificationsList, { method: 'PUT', token: 'token-alice' })).statusCode, 405);
});

// --------------------------------------------------- Section G: archive ---
await t.check('archive: POST creates entry → 200', async () => {
  fresh();
  const res = await call(handleArchive, { method: 'POST', token: 'token-alice', body: { mediaUrl: 'https://x/y.jpg', filter: 'noir' } });
  eq(res.statusCode, 200);
  eq(res.body.archived.filter, 'noir');
  eq(res.body.archived.mediaUrl, 'https://x/y.jpg');
});
await t.check('archive: POST invalid extras JSON → 400', async () => {
  fresh();
  eq((await call(handleArchive, { method: 'POST', token: 'token-alice', body: { extrasJson: '{bad' } })).statusCode, 400);
});
await t.check('archive: POST bad originalCreatedAt → 400', async () => {
  fresh();
  eq((await call(handleArchive, { method: 'POST', token: 'token-alice', body: { originalCreatedAt: 'not-a-date' } })).statusCode, 400);
});
await t.check('archive: GET lists own entries only', async () => {
  fresh();
  await call(handleArchive, { method: 'POST', token: 'token-alice', body: { mediaUrl: 'https://x/a.jpg' } });
  await call(handleArchive, { method: 'POST', token: 'token-bob', body: { mediaUrl: 'https://x/b.jpg' } });
  const res = await call(handleArchive, { token: 'token-alice' });
  eq(res.body.archive.length, 1);
  eq(res.body.archive[0].mediaUrl, 'https://x/a.jpg');
});
await t.check('archive: DELETE removes own entry → 200', async () => {
  fresh();
  const created = await call(handleArchive, { method: 'POST', token: 'token-alice', body: { mediaUrl: 'https://x/a.jpg' } });
  const res = await call(handleArchive, { method: 'DELETE', token: 'token-alice', query: { id: created.body.archived.id } });
  eq(res.statusCode, 200);
  eq((await call(handleArchive, { token: 'token-alice' })).body.archive.length, 0);
});
await t.check('archive: DELETE other user entry → 404', async () => {
  fresh();
  const created = await call(handleArchive, { method: 'POST', token: 'token-bob', body: { mediaUrl: 'https://x/b.jpg' } });
  eq((await call(handleArchive, { method: 'DELETE', token: 'token-alice', query: { id: created.body.archived.id } })).statusCode, 404);
});
await t.check('archive: DELETE bad id → 400', async () => {
  fresh();
  eq((await call(handleArchive, { method: 'DELETE', token: 'token-alice', query: { id: 0 } })).statusCode, 400);
});
await t.check('archive: GET without token → 401', async () => {
  fresh();
  eq((await call(handleArchive, {})).statusCode, 401);
});

// ------------------------------------------------------ Section H: apps ---
await t.check('apps: GET lists Google sign-in from google_sub → 200', async () => {
  fresh();
  const res = await call(handleApps, { token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.apps.length, 1);
  eq(res.body.apps[0].provider, 'google');
});
await t.check('apps: GET without token → 401', async () => {
  fresh();
  eq((await call(handleApps, {})).statusCode, 401);
});
await t.check('apps: POST → 405', async () => {
  fresh();
  eq((await call(handleApps, { method: 'POST', token: 'token-alice' })).statusCode, 405);
});

// ---------------------------------------------------- Section I: status ---
await t.check('status: GET with no reports → standing good', async () => {
  fresh();
  const res = await call(handleStatus, { token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.status.standing, 'good');
  eq(res.body.status.reportsAgainstMe, 0);
});
await t.check('status: GET with a report → standing review', async () => {
  const { state } = fresh();
  state.reports.push({ id: 1, reporter_id: 2, target_id: 1, reason: 'spam', created_at: '2026-11-19T10:00:00.000Z' });
  const res = await call(handleStatus, { token: 'token-alice' });
  eq(res.body.status.standing, 'review');
  eq(res.body.status.reportsAgainstMe, 1);
});
await t.check('status: GET without token → 401', async () => {
  fresh();
  eq((await call(handleStatus, {})).statusCode, 401);
});

// ------------------------------ Section J: message requests list + answer --
await t.check('message-requests: GET returns incoming/outgoing/hidden buckets', async () => {
  const { state } = fresh();
  state.message_requests.push(
    { id: 1, sender_id: 2, recipient_id: 1, body: 'hi', status: 'pending', created_at: '2026-11-19T10:00:00.000Z' },
    { id: 2, sender_id: 3, recipient_id: 1, body: 'secret', status: 'hidden', created_at: '2026-11-19T11:00:00.000Z' },
    { id: 3, sender_id: 1, recipient_id: 2, body: 'yo', status: 'pending', created_at: '2026-11-19T12:00:00.000Z' },
  );
  const res = await call(handleMessageRequestsList, { token: 'token-alice' });
  eq(res.statusCode, 200);
  eq(res.body.incoming.length, 1);
  eq(res.body.hidden.length, 1);
  eq(res.body.outgoing.length, 1);
  eq(res.body.incoming[0].senderUsername, 'bob');
});
await t.check('message-requests: GET without token → 401', async () => {
  fresh();
  eq((await call(handleMessageRequestsList, {})).statusCode, 401);
});
await t.check('message-requests: PUT → 405', async () => {
  fresh();
  eq((await call(handleMessageRequestsList, { method: 'PUT', token: 'token-alice' })).statusCode, 405);
});

async function seedMessageRequest() {
  const { sql, state, alice, bob } = fresh();
  const rows = (await sql`INSERT INTO message_requests (sender_id, recipient_id, body, status) VALUES (${alice.id}, ${bob.id}, 'hello', 'pending') RETURNING *`) as any[];
  return { sql, state, alice, bob, req: rows[0] };
}
await t.check('message-requests: accept → 200 + creates conversation', async () => {
  const { state, bob, req } = await seedMessageRequest();
  const res = await call(handleMessageRequestAnswer, { method: 'POST', token: 'token-bob', query: { id: req.id }, body: { accept: true } });
  eq(res.statusCode, 200);
  eq(res.body.status, 'accepted');
  ok(typeof res.body.conversationId === 'number');
  eq(state.message_requests.find((r) => r.id === req.id)?.status, 'accepted');
});
await t.check('message-requests: decline → 200', async () => {
  const { bob, req } = await seedMessageRequest();
  const res = await call(handleMessageRequestAnswer, { method: 'POST', token: 'token-bob', query: { id: req.id }, body: { accept: false } });
  eq(res.statusCode, 200);
  eq(res.body.status, 'declined');
});
await t.check('message-requests: only the recipient can answer → 403', async () => {
  const { req } = await seedMessageRequest();
  eq((await call(handleMessageRequestAnswer, { method: 'POST', token: 'token-alice', query: { id: req.id }, body: { accept: true } })).statusCode, 403);
});
await t.check('message-requests: answering twice → 409', async () => {
  const { bob, req } = await seedMessageRequest();
  await call(handleMessageRequestAnswer, { method: 'POST', token: 'token-bob', query: { id: req.id }, body: { accept: true } });
  eq((await call(handleMessageRequestAnswer, { method: 'POST', token: 'token-bob', query: { id: req.id }, body: { accept: true } })).statusCode, 409);
});
await t.check('message-requests: unknown id → 404', async () => {
  fresh();
  eq((await call(handleMessageRequestAnswer, { method: 'POST', token: 'token-bob', query: { id: 999 }, body: { accept: true } })).statusCode, 404);
});
await t.check('message-requests: bad id → 400', async () => {
  fresh();
  eq((await call(handleMessageRequestAnswer, { method: 'POST', token: 'token-bob', query: { id: 'x' }, body: { accept: true } })).statusCode, 400);
});
await t.check('message-requests: GET answer → 405', async () => {
  const { bob, req } = await seedMessageRequest();
  eq((await call(handleMessageRequestAnswer, { method: 'GET', token: 'token-bob', query: { id: req.id } })).statusCode, 405);
});

// ------------------------------------------------- Section K: comments ----
async function seedPost(authorId = 2) {
  const { sql, state, alice, bob, carol } = fresh();
  const rows = (await sql`INSERT INTO posts (author_id, caption, media_url, filter, effect, extras_json) VALUES (${authorId}, 'hello world', ${null}, 'original', 'none', ${null}::jsonb) RETURNING *`) as any[];
  return { sql, state, alice, bob, carol, post: rows[0] };
}
await t.check('comments: GET empty list → 200', async () => {
  const { post } = await seedPost();
  const res = await call(handlePostComments, { token: 'token-alice', query: { postId: post.id } });
  eq(res.statusCode, 200);
  eq(JSON.stringify(res.body.comments), '[]');
});
await t.check('comments: GET unknown post → 404', async () => {
  fresh();
  eq((await call(handlePostComments, { token: 'token-alice', query: { postId: 999 } })).statusCode, 404);
});
await t.check('comments: GET private author, non-follower → 403', async () => {
  const { post } = await seedPost(3); // carol is private
  eq((await call(handlePostComments, { token: 'token-alice', query: { postId: post.id } })).statusCode, 403);
});
await t.check('comments: POST creates + increments post comment_count', async () => {
  const { state, post } = await seedPost();
  const res = await call(handlePostComments, { method: 'POST', token: 'token-alice', query: { postId: post.id }, body: { body: 'nice!' } });
  eq(res.statusCode, 200);
  eq(res.body.comment.body, 'nice!');
  eq(res.body.comment.authorUsername, 'alice');
  eq(state.posts.find((p) => p.id === post.id)?.comment_count, 1);
});
await t.check('comments: POST empty body → 400', async () => {
  const { post } = await seedPost();
  eq((await call(handlePostComments, { method: 'POST', token: 'token-alice', query: { postId: post.id }, body: { body: '   ' } })).statusCode, 400);
});
await t.check('comments: POST >500 chars → 400', async () => {
  const { post } = await seedPost();
  eq((await call(handlePostComments, { method: 'POST', token: 'token-alice', query: { postId: post.id }, body: { body: 'x'.repeat(501) } })).statusCode, 400);
});
await t.check('comments: POST whoCanComment=off → 403', async () => {
  const { sql, state, post } = await seedPost();
  state.user_settings.push({ user_id: 2, who_can_comment: 'off' });
  eq((await call(handlePostComments, { method: 'POST', token: 'token-alice', query: { postId: post.id }, body: { body: 'hi' } })).statusCode, 403);
  void sql;
});
await t.check('comments: POST followers-only, non-follower → 403', async () => {
  const { state, post } = await seedPost();
  state.user_settings.push({ user_id: 2, who_can_comment: 'followers' });
  eq((await call(handlePostComments, { method: 'POST', token: 'token-alice', query: { postId: post.id }, body: { body: 'hi' } })).statusCode, 403);
});
await t.check('comments: POST containing author hidden word → 400', async () => {
  const { state, post } = await seedPost();
  state.hidden_words.push({ user_id: 2, word: 'spoiler' });
  eq((await call(handlePostComments, { method: 'POST', token: 'token-alice', query: { postId: post.id }, body: { body: 'total spoiler here' } })).statusCode, 400);
});
await t.check('comments: POST by blocked viewer → 404 (never a hint)', async () => {
  const { state, post } = await seedPost();
  state.blocks.push({ blocker_id: 2, blocked_id: 1 });
  eq((await call(handlePostComments, { method: 'POST', token: 'token-alice', query: { postId: post.id }, body: { body: 'hi' } })).statusCode, 404);
});
await t.check('comments: GET filters out viewer hidden-word comments', async () => {
  const { state, post } = await seedPost();
  state.hidden_words.push({ user_id: 1, word: 'nope' });
  await call(handlePostComments, { method: 'POST', token: 'token-bob', query: { postId: post.id }, body: { body: 'nope not this' } });
  await call(handlePostComments, { method: 'POST', token: 'token-bob', query: { postId: post.id }, body: { body: 'clean comment' } });
  const res = await call(handlePostComments, { token: 'token-alice', query: { postId: post.id } });
  eq(res.body.comments.length, 1);
  eq(res.body.comments[0].body, 'clean comment');
});
await t.check('comments: GET hides restricted commenter from other viewers', async () => {
  const { state, post } = await seedPost();
  state.restricted_accounts.push({ restrictor_id: 2, restricted_id: 3 });
  await call(handlePostComments, { method: 'POST', token: 'token-carol', query: { postId: post.id }, body: { body: 'from carol' } });
  const res = await call(handlePostComments, { token: 'token-alice', query: { postId: post.id } });
  eq(res.body.comments.length, 0);
});
await t.check('comments: PUT → 405', async () => {
  const { post } = await seedPost();
  eq((await call(handlePostComments, { method: 'PUT', token: 'token-alice', query: { postId: post.id } })).statusCode, 405);
});
await t.check('comments: POST without token → 401', async () => {
  const { post } = await seedPost();
  eq((await call(handlePostComments, { method: 'POST', query: { postId: post.id }, body: { body: 'hi' } })).statusCode, 401);
});

// --------------------------------------------------- Section L: Slash -----
async function slashSetup() {
  const { sql, state, alice, bob, carol } = fresh();
  const conv = (await sql`INSERT INTO conversations DEFAULT VALUES RETURNING id`) as any[];
  await sql`INSERT INTO conversation_members (conversation_id, user_id) VALUES (${conv[0].id}, ${alice.id}) ON CONFLICT DO NOTHING`;
  state.follows.push({ follower_id: alice.id, following_id: bob.id }, { follower_id: bob.id, following_id: alice.id });
  return { sql, state, alice, bob, carol, convId: conv[0].id };
}
async function seedInvitation() {
  const { sql, state, alice, bob, carol, convId } = await slashSetup();
  const rows = (await sql`INSERT INTO slash_invitations (conversation_id, inviter_id, invitee_id, status) VALUES (${convId}, ${alice.id}, ${bob.id}, 'pending') RETURNING *`) as any[];
  return { sql, state, alice, bob, carol, convId, inv: rows[0] };
}
await t.check('slash: create → 200 invitationId', async () => {
  const { convId, bob } = await slashSetup();
  const res = await call(handleSlashCreate, { method: 'POST', token: 'token-alice', body: { conversationId: convId, inviteeId: bob.id } });
  eq(res.statusCode, 200);
  ok(typeof res.body.invitationId === 'number');
});
await t.check('slash: inviting yourself → 400', async () => {
  const { convId, alice } = await slashSetup();
  eq((await call(handleSlashCreate, { method: 'POST', token: 'token-alice', body: { conversationId: convId, inviteeId: alice.id } })).statusCode, 400);
});
await t.check('slash: unknown invitee → 404', async () => {
  const { convId } = await slashSetup();
  eq((await call(handleSlashCreate, { method: 'POST', token: 'token-alice', body: { conversationId: convId, inviteeId: 999 } })).statusCode, 404);
});
await t.check('slash: inviter not a member → 403', async () => {
  const { convId, bob } = await slashSetup();
  eq((await call(handleSlashCreate, { method: 'POST', token: 'token-carol', body: { conversationId: convId, inviteeId: bob.id } })).statusCode, 403);
});
await t.check('slash: blocked invitee → 403', async () => {
  const { state, convId, carol } = await slashSetup();
  state.blocks.push({ blocker_id: 1, blocked_id: 3 });
  eq((await call(handleSlashCreate, { method: 'POST', token: 'token-alice', body: { conversationId: convId, inviteeId: carol.id } })).statusCode, 403);
});
await t.check('slash: invitee who_can_slash=nobody → 403', async () => {
  const { state, convId, carol } = await slashSetup();
  state.privacy_preferences.push({ user_id: carol.id, who_can_slash: 'nobody' });
  eq((await call(handleSlashCreate, { method: 'POST', token: 'token-alice', body: { conversationId: convId, inviteeId: carol.id } })).statusCode, 403);
});
await t.check('slash: friends-only invitee, non-mutual → 403', async () => {
  const { convId, carol } = await slashSetup();
  // carol's default who_can_slash is 'friends'; alice and carol do not follow each other.
  eq((await call(handleSlashCreate, { method: 'POST', token: 'token-alice', body: { conversationId: convId, inviteeId: carol.id } })).statusCode, 403);
});
await t.check('slash: invalid conversation id → 400', async () => {
  const { bob } = await slashSetup();
  eq((await call(handleSlashCreate, { method: 'POST', token: 'token-alice', body: { conversationId: 0, inviteeId: bob.id } })).statusCode, 400);
});
await t.check('slash: GET create → 405', async () => {
  const { convId, bob } = await slashSetup();
  eq((await call(handleSlashCreate, { method: 'GET', token: 'token-alice', body: { conversationId: convId, inviteeId: bob.id } })).statusCode, 405);
});
await t.check('slash: answer accept → 200 + joins conversation', async () => {
  const { state, convId, inv } = await seedInvitation();
  const res = await call(handleSlashAnswer, { method: 'POST', token: 'token-bob', query: { id: inv.id }, body: { accept: true } });
  eq(res.statusCode, 200);
  eq(res.body.status, 'accepted');
  eq(state.conversation_members.some((m) => m.conversation_id === convId && m.user_id === 2), true);
});
await t.check('slash: answer decline → 200', async () => {
  const { inv } = await seedInvitation();
  const res = await call(handleSlashAnswer, { method: 'POST', token: 'token-bob', query: { id: inv.id }, body: { accept: false } });
  eq(res.statusCode, 200);
  eq(res.body.status, 'declined');
});
await t.check('slash: only the invitee can answer → 403', async () => {
  const { inv } = await seedInvitation();
  eq((await call(handleSlashAnswer, { method: 'POST', token: 'token-alice', query: { id: inv.id }, body: { accept: true } })).statusCode, 403);
});
await t.check('slash: answering twice → 409', async () => {
  const { inv } = await seedInvitation();
  await call(handleSlashAnswer, { method: 'POST', token: 'token-bob', query: { id: inv.id }, body: { accept: true } });
  eq((await call(handleSlashAnswer, { method: 'POST', token: 'token-bob', query: { id: inv.id }, body: { accept: true } })).statusCode, 409);
});
await t.check('slash: unknown invitation → 404', async () => {
  fresh();
  eq((await call(handleSlashAnswer, { method: 'POST', token: 'token-bob', query: { id: 999 }, body: { accept: true } })).statusCode, 404);
});
await t.check('slash: leave removes member → 200', async () => {
  const { state, convId } = await slashSetup();
  const res = await call(handleSlashLeave, { method: 'POST', token: 'token-alice', body: { conversationId: convId } });
  eq(res.statusCode, 200);
  eq(state.conversation_members.some((m) => m.conversation_id === convId && m.user_id === 1), false);
});
await t.check('slash: leave as non-member → 403', async () => {
  const { convId } = await slashSetup();
  eq((await call(handleSlashLeave, { method: 'POST', token: 'token-carol', body: { conversationId: convId } })).statusCode, 403);
});
await t.check('slash: leave bad id → 400', async () => {
  fresh();
  eq((await call(handleSlashLeave, { method: 'POST', token: 'token-alice', body: { conversationId: 0 } })).statusCode, 400);
});

// --------------------------------- Section M: privacy storage round-trip --
await t.check('privacy: getPrivacy with no row returns defaults', async () => {
  const { sql, alice } = fresh();
  const p = await getPrivacy(sql, alice.id);
  eq(p.who_can_message, 'everyone');
  eq(p.who_can_slash, 'friends');
  eq(p.activity_status, true);
});
await t.check('privacy: savePrivacy then getPrivacy returns stored prefs', async () => {
  const { sql, alice } = fresh();
  await savePrivacy(sql, alice.id, { is_private: true, activity_status: false, read_receipts: true, who_can_message: 'nobody', who_can_slash: 'nobody', who_can_mention: 'friends', who_can_tag: 'friends', default_room_identity: 'room' });
  const p = await getPrivacy(sql, alice.id);
  eq(p.who_can_message, 'nobody');
  eq(p.is_private, true);
  eq(p.activity_status, false);
  eq(p.default_room_identity, 'room');
});

t.finish();
