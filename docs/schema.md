# DROP Database Schema — 28 tables

Postgres-flavoured DDL lives in `server/schema.ts` (`DDL`). No dummy rows
are seeded — every row is created by a real user in the app.

| # | Table | Purpose |
|---|-------|---------|
| 1 | `users` | Profile: username (unique), display name, password hash, avatar, bio, private flag |
| 2 | `auth_identities` | Google / phone identities linked to a user (`provider`, `provider_user_id`, email) |
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
