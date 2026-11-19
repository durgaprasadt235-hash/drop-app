# DROP Server — rules to preserve

Server implementation: `server/index.ts` (Node built-in `http`, no
framework) and the Vercel Serverless Functions in `api/` (`auth/google`
verifies Google ID tokens, `auth/status` reports auth status). Schema:
`server/schema.ts` and `docs/schema.md` (28 tables).
Client contract: `src/lib/api.ts` (66 actions).

## Auth — Google only

- In-app profile sign-in uses a password (hashed server-side) and issues
  a revocable 30-day session; only the session hash is stored.
- Google OAuth: the client renders the real Google Identity Services
  button (`src/lib/google.ts`, public client ID from
  `VITE_GOOGLE_CLIENT_ID`) and sends the Google ID token to
  `POST /api/auth/google` in the JSON body (never a URL query string).
  The function verifies it with Google via a POST body to
  `https://oauth2.googleapis.com/tokeninfo`, checks
  `aud === DROP_GOOGLE_CLIENT_ID` (plus `email_verified` and expiry),
  then creates/links the account by Google `sub` / verified email and
  issues a 30-day session. If `DROP_GOOGLE_CLIENT_ID` is not set, or
  the token fails verification, the request is rejected with 401 —
  Google shows "coming soon — credentials needed", never a fake login.
- Link Google from Profile → Sign-in & security (same verified flow;
  a Google account already linked to another profile cannot be
  re-linked).
- **Phone + OTP is disabled (2026-11-19):** no phone sign-in, no OTP
  request/verification, no phone-based password reset, no Twilio calls
  from the client. The reference OTP code in `server/index.ts` is
  marked DISABLED and no HTTP route exposes it; `otp_challenges` in
  `server/schema.ts` is unused. Password reset is currently
  unavailable — a password user who forgets their password can sign in
  with Google once it is linked.
- Shared user tracking (2026-11-19): when `DATABASE_URL` (Neon
  Postgres) is set, `POST /api/auth/google` upserts the verified user
  into the shared `users` table (by `google_sub`, then email) and
  stores the session row with only its hash (`auth_sessions.
  session_hash`) — see `api/lib/db.ts`. The response includes `dbUser`
  (the shared DB row) and `dbConfigured: true`; the client uses the DB
  id as its local cache id so nobody is counted twice. When
  `DATABASE_URL` is not set, the old localStorage behaviour is kept
  and `dbConfigured: false` is returned — a central count is never
  faked. If the DB is set but unreachable, the function returns 503
  rather than silently signing in locally and undercounting.
  Password profiles are local-only and are not written to the shared
  DB; only Google sign-ins are counted. Users who signed up before
  the DB was connected are not backfilled.

## Shared user tracking / Admin insights

- `GET /api/admin/users` returns `{ dbConfigured, totalUsers, users,
  signupsByDay }`. With no `DATABASE_URL` it returns
  `dbConfigured: false` with empty lists (no crash, no fake count).
- With a DB, the caller must send `Authorization: Bearer <token>`
  (a session issued by `/api/auth/google`, validated against
  `auth_sessions` by hash, not revoked, not expired). The session's
  user must be an admin: `DROP_ADMIN_EMAILS` (comma-separated) or,
  by default, `durgaprasadt235@gmail.com`. Otherwise 401 (no/invalid
  session) or 403 (not an admin). User emails are returned only to an
  admin.
- Client: `getAdminUsers()` in `src/lib/api.ts`; the Admin view in
  `src/App.tsx` (Profile → "Admin — user insights") is rendered only
  when the signed-in user's email is the owner email. Without a DB
  it honestly says "Shared database not configured — counts are this
  device only" and shows the local-only count.

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
