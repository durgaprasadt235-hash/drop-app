# DROP Database Schema — 40 tables

Postgres-flavoured DDL lives in `server/schema.ts` (`DDL`). No dummy rows
are seeded — every row is created by a real user in the app.

| # | Table | Purpose |
|---|-------|---------|
| 1 | `users` | Profile: username (unique), display name, password hash, avatar, bio, private flag |
| 2 | `auth_identities` | Google identities linked to a user (`provider`, `provider_user_id`, email) |
| 3 | `auth_sessions` | 30-day revocable sessions — only the session hash is stored |
| 4 | `otp_challenges` | Phone OTPs: code hash only, purpose, expiry, attempts, used flag. Also holds forgot-password tokens (`purpose='forgot'`) |
| 5 | `follows` | Follower → following pairs |
| 6 | `blocks` | Blocker → blocked pairs |
| 7 | `reports` | Reporter, target, reason |
| 8 | `posts` | Feed posts: author, caption, media, `filter`, `effect`, `extras_json` (editor overlays + widgets), Fire / comment counts |
| 9 | `post_likes` | Fire on a post (user, post) |
| 10 | `post_saves` | Saved posts (user, post) |
| 11 | `post_comments` | Comments on a post |
| 12 | `post_poll_votes` | Poll votes on a post, plus slider ratings (rating value) |
| 13 | `post_question_answers` | Answers to a post Question sticker — visible to the author only |
| 14 | `stories` | 24h Stories: author, media, `filter`, `effect`, `extras_json`, `expires_at` |
| 15 | `story_poll_votes` | Poll votes on a Story, plus slider ratings |
| 16 | `story_question_answers` | Answers to a Story Question sticker — visible to the author only |
| 17 | `drops` | One-Time Drops: creator, kind (public/protected), status (waiting/ready/revealed), `blast_at`, sealed caption/media |
| 18 | `drop_access_grants` | Who may open a Protected Drop |
| 19 | `drop_opens` | Per-user open record — one row per (drop, user) |
| 20 | `reels` | Reels: author, media |
| 21 | `conversations` | DM conversations |
| 22 | `conversation_members` | Members of a conversation, with join time — Slash history boundaries use this |
| 23 | `messages` | Messages: conversation, sender, body |
| 24 | `slash_invitations` | Slash invites: conversation, inviter, invitee, status |
| 25 | `clubrooms` | Clubrooms: name, creator |
| 26 | `clubroom_members` | Clubroom membership |
| 27 | `notifications` | Notifications: user, type, body, read |
| 28 | `saved_items` | Saved items (user, post) — the Saved view |
| 29 | `privacy_preferences` | Page 04: per-user privacy — is_private, activity status, read receipts, who can message/Slash/mention/tag, default room identity |
| 30 | `follow_requests` | Page 04: follow requests (requester, target, status pending/accepted/declined/cancelled, unique requester+target) |
| 31 | `mutes` | Page 04: muter → muted pairs + scope (muting suppresses feed/notifications, does not delete relationships) |
| 32 | `room_identities` | Page 04: per-user-per-clubroom identity (mode 'drop' or 'room', alias, avatar) — the account mapping is never exposed to ordinary members |
| 33 | `privacy_audit_events` | Page 04: security-relevant changes (profile/privacy/block/mute/room actions, no personal data beyond the user id) |
| 34 | `close_friends` | Settings: owner's Close Friends list (user → friend) |
| 35 | `story_hidden_from` | Settings: users a story author hides stories from |
| 36 | `restricted_accounts` | Settings: restrictor → restricted pairs; a restricted user's comments are visible only to the author and the commenter |
| 37 | `hidden_words` | Settings: per-user hidden words (lowercase, 1–50 chars, max 100 per user) — filter comments, message requests and comment lists |
| 38 | `user_settings` | Settings: language, accessibility, content prefs, story/comment/sharing prefs, account type, gender, per-event notification prefs |
| 39 | `story_archive` | Settings: owner's archived stories (media, filter, effect, extras, original date) |
| 40 | `message_requests` | Settings: DM requests when the recipient only accepts messages from friends (status pending/hidden/accepted/declined; one pending per sender+recipient) |

`users` also gained Page 04 columns: `cover_url`, `links` (JSONB, https only), `location`, `birthday`, `updated_at`. Settings added `users.last_active_at` (updated by `requireAuth` at most once per 5 minutes; shown as `lastActiveAt` on public profiles only when the target's activity status is on and the viewer isn't restricted by the target).

## Profile end-to-end (2026-11-19)

Profile content is server-backed: posts, Reels, Drops and saves are
written to Neon by `POST /api/profile/posts|reels|drops`,
`POST /api/profile/save`, `POST /api/profile/drops/open` and read by
`GET /api/profile/<id>/posts|reels|drops` + `GET /api/profile/me/saved`
(all behind the single `api/profile/[...route].ts` function), so header
counts (`profileCounts`, from the same Neon tables) agree with the
tabs, and another user's content is visible on any device. `reports`,
`conversations`, `conversation_members` and `messages` are created by
`ensureProfileTables`; `POST /api/profile/conversations` enforces the
target's stored `who_can_message` server-side. `post_saves.post_id`
references `posts(id)` — an earlier migration wrongly referenced
`users(id)` and is repaired idempotently by `ensureProfileTables`.
No Story Highlights feature exists anywhere in the app, so the Profile
page renders no highlights row (none is faked).

## DROP Settings (2026-11-19)

All Settings routes live behind the single `api/profile/[...route].ts`
function (no new files): `GET/PATCH /me/settings`, `GET/POST/DELETE
/me/close-friends`, `/me/hide-story-from`, `/me/restricted`, `GET
/me/muted`, `GET/POST/DELETE /me/hidden-words`, `GET
/me/notifications` + `POST /me/notifications/read`, `POST/GET/DELETE
/me/archive`, `GET /me/apps`, `GET /me/status`, `GET
/me/message-requests` + `POST /me/message-requests/<id>`, `GET/POST
/posts/<id>/comments`, `POST /slash-invitations`,
`POST /slash-invitations/<id>`, `POST /slash-leave`. `notify()` checks
the recipient's `user_settings` prefs before inserting (missing row =
all on). `POST /conversations` files a message request (200
`{status:'requested'}`) when the target only accepts messages from
friends, and stays 403 for `'nobody'`. `POST /posts` enforces the
mentioned user's `who_can_mention`. Close-friends / hide-story-from
are stored server-side but enforced client-side — Stories are
local-only in this build. `post_comments` and `slash_invitations`
(which the reference schema already listed) are now also created by
`ensureProfileTables`, so they exist in Neon too.

## Key rules (enforced server-side, see `api/README.md`)

- A Story expires 24h after creation; expired Stories are never returned.
- A Drop's caption/media are never returned before `blast_at`, except to
  its creator. `drop_opens` is unique per (drop, user).
- A Protected Drop cannot be saved or shared; the server rejects it.
- A Slash invitee only sees messages sent after they joined
  (`conversation_members.joined_at`); when they leave, the expansion
  vanishes for them and no group is left behind.
- Message delete is sender-only and deletes for everyone.
- OTP codes are stored only as hashes, expire in 10 minutes, are
  single-use, and lock after 5 wrong tries.
