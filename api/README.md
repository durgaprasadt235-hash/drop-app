# DROP Server — rules to preserve

Server implementation: `server/index.ts` (Node built-in `http`, no
framework) and the Vercel Serverless Functions in `api/` (`auth/google`
verifies Google ID tokens, `auth/status` reports auth status,
`profile/*` and `clubrooms/[id]/identity` implement Page 04).
Schema: `server/schema.ts` and `docs/schema.md` (33 tables).
Client contract: `src/lib/api.ts` (80 actions).

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

## Profile, Privacy & Identity (Page 04, 2026-11-19)

- Tables (additive, `api/lib/profile.ts` `ensureProfileTables`): new
  users columns `cover_url`, `links` (JSONB), `location`, `birthday`,
  `updated_at`; `privacy_preferences` (per-user toggles + who-can
  message/Slash/mention/tag + default room identity),
  `follow_requests` (status pending/accepted/declined/cancelled,
  unique requester+target), `mutes` (suppresses feed/notifications,
  keeps relationships), `room_identities` (per user+clubroom, mode
  'drop'|'room', alias, avatar), `privacy_audit_events`.
- Endpoints (all Bearer-session authed, ownership checked server-side,
  client user IDs never trusted): `GET/PATCH /api/profile/me`,
  `GET /api/profile/[username]` (private profiles return only the
  public summary to non-approved viewers; blocked viewers get 404),
  `GET/PATCH /api/profile/me/privacy`, `GET /api/profile/me/follow-requests`,
  `POST /api/profile/follow-requests/[id]` (target only),
  `POST/DELETE /api/profile/follow` (private = pending request +
  notification), `POST/DELETE /api/profile/block` (removes follows
  both ways, cancels pending requests), `POST/DELETE /api/profile/mute`,
  `GET /api/profile/lists` (each row carries the viewer's relationship
  for the Follow buttons), `GET /api/profile/me/blocks`,
  `GET/POST/PATCH /api/clubrooms/[id]/identity` (member lists show
  ONLY room-facing identities — no user ids, emails or mappings).
- Profile content (end-to-end, 2026-11-19): profile tabs are server-
  backed — `GET /api/profile/<id>/posts|reels|drops` (private-profile
  and block rules apply; sealed Drops return no caption/media except
  to the creator), `POST /api/profile/posts|reels|drops`,
  `DELETE /api/profile/posts?id=`, `POST /api/profile/drops/open`
  (sealed until blast time, creator excepted),
  `POST /api/profile/save` (toggle) + `GET /api/profile/me/saved`,
  `POST /api/profile/report` (stored in `reports` for moderation),
  `POST /api/profile/conversations` (find-or-create a 1:1 DM; the
  target's stored `who_can_message` is enforced server-side, and the
  public profile carries a server-computed `canMessage` flag).
  `post_saves.post_id` references `posts(id)` — an earlier migration
  wrongly referenced `users(id)`; `ensureProfileTables` repairs an
  existing wrong FK idempotently. No Story Highlights feature exists
  in the app, so the Profile page renders no highlights row.
  All `/api/profile/*` routes are served by ONE serverless function,
  `api/profile/[...route].ts`, which dispatches to the handlers in
  `api/lib/profile-handlers.ts` (helper file, not a function). This
  keeps the deployment at 5 functions total, under Vercel's Hobby-plan
  limit of 12 per deployment (Page 04 originally shipped 11 separate
  profile files = 15 functions, and the deploy failed on that limit).
- Username: 3–30 chars `[a-zA-Z0-9_]`, case-insensitive unique,
  reserved names rejected (`admin`, `drop`, `support`, …). Bio max
  150 chars. Links must be `https://`, max 5.
- Avatar/cover upload: `POST /api/profile/upload` accepts a base64
  data URL, validates MIME (jpeg/png/webp) and size (≤2 MB) server-side
  and stores via Vercel Blob (`BLOB_READ_WRITE_TOKEN`). Without the
  token it returns 503 and the UI says storage is not configured;
  the Google photo or initials avatar is used instead. Binaries are
  never stored in DB rows.
- Privacy toggles persist server-side; without a shared DB they
  persist in localStorage on the device only (the UI must not claim
  otherwise). Muting suppresses muted users' posts from the feed
  (`listFeed`); blocking is enforced via `isBlocked` on profile,
  follow, message, Slash and search paths.
- Client: `src/components/ProfileViews.tsx` (Profile, Edit Profile,
  Privacy & Security, Room Identity) wired in `src/App.tsx` views
  `profile` / `edit-profile` / `privacy` / `room-identity`; Search
  opens a user's profile, Clubrooms offers "Join with identity".

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
