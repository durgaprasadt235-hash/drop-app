# DROP Server — rules to preserve

Server implementation: `server/index.ts` (Node built-in `http`, no
framework). Schema: `server/schema.ts` and `docs/schema.md` (28 tables).
Client contract: `src/lib/api.ts` (70 actions).

## Auth

- In-app profile sign-in uses a password (hashed server-side) and issues
  a revocable 30-day session; only the session hash is stored.
- Google OAuth: the client sends the Google ID token to the server; the
  server verifies it with Google via a POST body to
  `https://oauth2.googleapis.com/tokeninfo` (never a URL query string),
  checks `aud === DROP_GOOGLE_CLIENT_ID`, then creates/links the account.
  If `DROP_GOOGLE_CLIENT_ID` is not set, Google shows
  "coming soon — credentials needed", never a fake login.
- Phone OTP (Twilio): code is 6 digits, 10-minute expiry, single-use,
  5-try lockout, max 3 sends per 15 minutes per phone, 30-second cooldown
  between resends. Only the code hash is stored; the code is never logged.
  If `DROP_TWILIO_*` is not set, phone OTP shows "credentials needed".
- Forgot password: identifier → OTP to the account's verified phone →
  one-time reset token → new password.
- Link/unlink Google and phone from Profile → Sign-in & security.

## Drops (sealed / Blast)

- Blast presets: 1h / 6h / 24h / 3d / 7d.
- A Drop is sealed until `blast_at`: the server returns no caption or
  media before then, except to the creator.
- On first legitimate open the Blast animation plays; `drop_opens` is
  unique per (drop, user).
- Public Drops: Like / Comment / Share / Save after reveal.
- Protected Drops: no Save / Share; the server rejects saving them.
  Access is via `drop_access_grants` only.

## Stories & Posts

- Stories expire after 24h, play up to 30s per segment, replayable
  within 24h. Hold pauses, tap next/previous, swipe-down closes.
- Filters (32) and effects (22) are saved with the record and shown
  identically to every viewer.
- Poll votes, Question answers and slider ratings are real server
  records. Question answers are visible to the author only.
  Link stickers must be `https://` — `http://` is rejected.
- Music and Donation are marked unavailable (no licensed music library,
  no payments provider) — never fake them.

## Messages & Slash

- DMs are persistent. Message delete is sender-only, deletes for
  everyone (both participants' history and conversation previews).
- Slash: typing `/username` in a chat instantly invites that person.
  No permanent group is created. History boundaries are per-participant
  (`conversation_members.joined_at`); when someone leaves, the
  expansion vanishes for them with no group left behind.

## Real-time

- Live sync is a WebSocket viewer channel subscribed at sign-in
  (`src/lib/realtime.ts`); polling every 5s is the fallback when the
  socket is unavailable. Never claim live updates from polling alone.

## Privacy / safety

- Private accounts: follow requests must be approved; blocked users
  cannot see the blocker's content; reports are real records.
- Never return expired or unauthorised Stories, sealed Drops, or
  Protected media to unauthorised users.
- Never store secrets, passwords, OTP codes or session tokens in plain
  text, in the client, or in git. Use `.env` (see `.env.example`).
