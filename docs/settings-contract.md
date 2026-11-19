# DROP Settings — Build Contract (2026-11-19)

User approved the FULL build. Two agents implement in parallel against this
contract. **Server agent owns `api/` + `server/schema.ts` + `docs/schema.md`.
Client agent owns `src/`. No other overlap.** Do not edit each other's files.
Do not push to GitHub (coordinator pushes after verification).

## Ground rules (both)

- No dummy/seeded data. No Instagram names/photos/bios/counts copied anywhere.
  Reference screenshots: `~/workspace/user/media_library/image/image-18.png`
  … `image-52.png` (image-16/17 are old Vercel screenshots — ignore).
- Design: plain white background, simple black text (big bold headings,
  regular body, grey explanations), generous white space, one setting per
  row in clean rounded cards, simple toggles/radio controls. Dark navy
  `#0B1327` stays the dark option. No extra decoration.
- Never use browser `confirm`/`alert`/`prompt` for destructive actions —
  in-page two-step Delete → Confirm delete / Cancel (see
  `~/workspace/custom-skills/app_creation_shell_dialogs/SKILL.md`).
- Vercel Hobby limit: 5 serverless functions of 12 today. **ZERO new files
  under `api/`.** All new routes go in `api/profile/[...route].ts` +
  `api/lib/profile-handlers.ts`. Additive migrations only, in
  `ensureProfileTables` (`api/lib/profile.ts:59`).
- Fail-closed: no DB → 503; no/invalid Bearer → 401; invalid input → 400.
  Every handler wrapped in try/catch → `handleError`. Audit sensitive
  changes via `audit()` into `privacy_audit_events`. Block precedence over
  every other setting.
- Do NOT touch: Blast presets, One-Time Drop single-view semantics,
  30-day sessions, Google-only auth, dock behaviour, Home v1.0.
- `npm install` first if `node_modules` is missing. Server agent: verify
  with `npx tsc -p tsconfig.server.json` + tsx handler tests; do NOT run
  `npm run build` / `vite build` (client agent owns the full build).

## Key existing patterns (from scout report)

- Auth: `requireAuth(req)` in `api/lib/profile.ts` — 503 no DB, 401 no/invalid
  Bearer, runs `ensureProfileTables`, returns `{sql, me}`.
- DB: `getSql()` → `neon(url)`; queries are Neon tagged templates.
  Env precedence: `DATABASE_URL ?? POSTGRES_URL ?? POSTGRES_PRISMA_URL ??
  POSTGRES_URL_NON_POOLING`.
- Router `api/profile/[...route].ts`: `req.query.route` array; `setQuery`
  rewrites `req.query`. First match wins; unmatched → 404.
- Client: `serverFetch(path, init)` in `src/lib/api.ts` (Bearer auto);
  module flag `dbOn` (set from `/api/auth/status`); server-first with
  local fallback. `toPrivacy`/`fromPrivacy` snake↔camel mapping.
- Views: `src/App.tsx` `type View` + `setView(...)`, no URL routing.
  Profile Settings button (`onPrivacy`) currently opens `'privacy'` view
  → `PrivacyPage` in `src/components/ProfileViews.tsx`.
- Notifications server-side: `notify()` in `api/lib/profile.ts` inserts
  into `notifications (user_id, type, body)`; types today: `follow`,
  `follow_request`, `follow_accepted`. Client lists notifications from
  local store only.
- Messages are local-only except conversation creation (`POST
  /api/profile/conversations`, server-enforced `canMessage()`).
  Comments are local-only (`store.comments`); `post_comments` table exists
  but is never written by the client. Stories are local-only.
  `createSlashInvitation` is local-only with NO `who_can_slash` check.
  Mentions: only `StoryEditor` produces `extras.mentionUserId`; no tag
  input exists anywhere; no `canMention`/`canTag` helper exists.

## New tables (server agent — add to `ensureProfileTables`, `TABLES` + `DDL`
## in `server/schema.ts`, and the table in `docs/schema.md`)

Total goes 33 → 40 tables.

```sql
CREATE TABLE close_friends (user_id INT NOT NULL REFERENCES users(id), friend_id INT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (user_id, friend_id));
CREATE TABLE story_hidden_from (user_id INT NOT NULL REFERENCES users(id), hidden_id INT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (user_id, hidden_id));
CREATE TABLE restricted_accounts (restrictor_id INT NOT NULL REFERENCES users(id), restricted_id INT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (restrictor_id, restricted_id));
CREATE TABLE hidden_words (user_id INT NOT NULL REFERENCES users(id), word TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (user_id, word));
CREATE TABLE user_settings (user_id INT PRIMARY KEY REFERENCES users(id),
  language TEXT NOT NULL DEFAULT 'en',
  reduce_motion BOOLEAN NOT NULL DEFAULT FALSE,
  hide_like_counts BOOLEAN NOT NULL DEFAULT FALSE,
  sensitive_content_level TEXT NOT NULL DEFAULT 'standard',
  save_story_to_archive BOOLEAN NOT NULL DEFAULT FALSE,
  story_replies TEXT NOT NULL DEFAULT 'followers',
  who_can_comment TEXT NOT NULL DEFAULT 'everyone',
  gif_comments BOOLEAN NOT NULL DEFAULT TRUE,
  allow_story_shares BOOLEAN NOT NULL DEFAULT TRUE,
  account_type TEXT NOT NULL DEFAULT 'personal',
  ai_generated_label BOOLEAN NOT NULL DEFAULT FALSE,
  show_account_suggestions BOOLEAN NOT NULL DEFAULT TRUE,
  gender TEXT,
  notify_follow BOOLEAN NOT NULL DEFAULT TRUE,
  notify_follow_request BOOLEAN NOT NULL DEFAULT TRUE,
  notify_comment BOOLEAN NOT NULL DEFAULT TRUE,
  notify_mention BOOLEAN NOT NULL DEFAULT TRUE,
  notify_message BOOLEAN NOT NULL DEFAULT TRUE,
  notify_slash BOOLEAN NOT NULL DEFAULT TRUE,
  notify_drop BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE story_archive (id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id), media_url TEXT, filter TEXT DEFAULT 'original', effect TEXT DEFAULT 'none', extras_json JSONB, original_created_at TIMESTAMPTZ, archived_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE message_requests (id SERIAL PRIMARY KEY, sender_id INT NOT NULL REFERENCES users(id), recipient_id INT NOT NULL REFERENCES users(id), body TEXT, status TEXT NOT NULL DEFAULT 'pending', conversation_id INT REFERENCES conversations(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE UNIQUE INDEX IF NOT EXISTS message_requests_pending_unique ON message_requests (sender_id, recipient_id) WHERE status = 'pending';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
```

Validators: `language` in `['en','es','fr','de','pt','hi','ar','zh']` (stored
only — UI stays English, see client notes); `sensitive_content_level` in
`['less','standard','more']`; `story_replies` in
`['followers','mutual','off']`; `who_can_comment` in
`['everyone','followers','mutual','off']`; `account_type` in
`['personal','creator','business']`; `gender` in
`['male','female','other','prefer-not-to-say']` or empty/null.
`hidden_words.word`: trim, lowercase, 1–50 chars, letters/digits/spaces/
hyphen only; max 100 words per user.

## Server routes (server agent — all inside the profile router)

### Settings
- `GET /api/profile/me/settings` → `{ok:true, settings:{...camelCase...}}`
  (defaults when no row). `PATCH /api/profile/me/settings` accepts any
  subset, validates, upserts, audits `settings_updated`, returns updated
  settings. CamelCase keys: `language, reduceMotion, hideLikeCounts,
  sensitiveContentLevel, saveStoryToArchive, storyReplies, whoCanComment,
  gifComments, allowStoryShares, accountType, aiGeneratedLabel,
  showAccountSuggestions, gender, notifyFollow, notifyFollowRequest,
  notifyComment, notifyMention, notifyMessage, notifySlash, notifyDrop`.

### Lists (each: GET returns `{ok:true, users:[{id,username,displayName,avatarUrl}]}` for list endpoints; POST `{userId}` adds; DELETE `?userId=` removes; self-add → 400; nonexistent target → 404; blocked either way → 403 on add)
- `GET/POST/DELETE /api/profile/me/close-friends`
- `GET/POST/DELETE /api/profile/me/hide-story-from`
- `GET/POST/DELETE /api/profile/me/restricted`
- `GET /api/profile/me/muted` (returns muted users; mute/unmute stay on existing `/mute`)
- `GET/POST/DELETE /api/profile/me/hidden-words` — GET returns
  `{ok:true, words:[...]}`; POST `{word}`; DELETE `?word=`. Audit changes.
- Existing `/me/blocks` stays (Blocked screen uses it).

### Notifications
- `GET /api/profile/me/notifications` → `{ok:true, notifications:[{id,type,body,read,createdAt}]}` newest first, limit 100.
- `POST /api/profile/me/notifications/read` `{id?}` — id given marks one
  read, omitted marks all read. Returns `{ok:true}`.
- `notify()` must check the recipient's `user_settings` prefs before
  inserting: map type → pref (`follow`→notifyFollow,
  `follow_request`→notifyFollowRequest, `follow_accepted`→notifyFollow
  (reuse), `comment`→notifyComment, `mention`→notifyMention,
  `message`→notifyMessage, `slash`→notifySlash, `drop`→notifyDrop).
  Missing settings row = all true. Apply the pref check to the existing
  follow/follow_request/follow_accepted call sites too.

### Archive
- `POST /api/profile/me/archive` `{mediaUrl?, filter?, effect?, extrasJson?}`
  → stores row, returns it. `GET /api/profile/me/archive` → owner's rows
  newest first. `DELETE /api/profile/me/archive?id=` → owner only.
  Audit create/delete.

### Apps & status
- `GET /api/profile/me/apps` → `{ok:true, apps:[{provider:'google',
  name:'Google sign-in', email, connectedAt}]}` from `auth_identities` +
  users (Google only; empty array otherwise — never invent apps).
- `GET /api/profile/me/status` → `{ok:true, status:{createdAt, isPrivate,
  reportsAgainstMe:number, standing:'good'|'review', note}}` where
  `standing='review'` iff `reportsAgainstMe > 0`; note is honest text
  ("No actions have been taken on your account." when 0 reports).
  No fake violations.

### Message requests (wires into permission flow)
- Modify `handleCreateConversation`: after the existing self/block checks,
  if `canMessage()` is false: if target `who_can_message === 'friends'`
  → create (or reuse pending) `message_requests` row and return
  `{ok:true, status:'requested', requestId}` (200, NOT an error); if
  `'nobody'` → 403 as today. Accept optional `body` (≤500 chars) stored
  on the request; if body matches any of the recipient's hidden words
  (exact word, case-insensitive) → still create but set
  `status='hidden'` and do NOT notify the recipient.
- `GET /api/profile/me/message-requests` → `{ok:true,
  incoming:[{id,senderId,senderUsername,senderDisplayName,senderAvatarUrl,body,createdAt}],
  outgoing:[{id,recipientId,...}]}` for `status='pending'` (hidden ones
  listed under `hidden:[...]` too, so the user can still find them).
- `POST /api/profile/me/message-requests/<id>` `{accept:boolean}` —
  recipient only (403 otherwise); non-pending → 409. Accept: create (or
  find) the 1:1 conversation, set `conversation_id`, `status='accepted'`,
  notify sender (type `message`, gated by sender's notifyMessage pref),
  return `{ok:true, status:'accepted', conversationId}`. Decline:
  `status='declined'`, return `{ok:true, status:'declined'}`.
- Router must handle 3 segments for this (`me/message-requests/<id>`).

### Comments go server-backed (new)
- `GET /api/profile/posts/<id>/comments` → `{ok:true, comments:[{id,
  postId, authorId, authorUsername, authorDisplayName, authorAvatarUrl,
  body, createdAt}]}`. Guards: post must exist (404); blocked viewer →
  404; private author + viewer not allowed → 403. Visibility: comments
  by users the author has restricted are visible ONLY to the author and
  the commenter. Comments containing any of the VIEWER's hidden words
  are excluded from the viewer's list.
- `POST /api/profile/posts/<id>/comments` `{body}` (1–500 chars).
  Guards as above + author's `who_can_comment`: `'off'` → 403;
  `'followers'` → viewer must follow author; `'mutual'` → mutual
  follow; `'everyone'` → ok. Body matching any of the AUTHOR's hidden
  words (exact word, case-insensitive, word-boundary) → 400 with a
  clear message. On success insert into `post_comments`, notify author
  (type `comment`, gated by author's notifyComment pref), return the
  created comment. Keep `posts.comment_count` in sync (increment).
- Router: segments `[<numericId>, 'comments']`, GET + POST.

### Slash goes server-backed (new)
- `POST /api/profile/slash-invitations` `{conversationId, inviteeId}`:
  inviter must be a member of the conversation (403 otherwise); blocked
  either way → 403; invitee `who_can_slash`: `'nobody'` → 403,
  `'friends'` → inviter+invitee must mutually follow, `'everyone'` →
  ok. Insert `slash_invitations` row (status `pending`), notify invitee
  (type `slash`, gated by invitee notifySlash pref). Return
  `{ok:true, invitationId}`.
- `POST /api/profile/slash-invitations/<id>` `{accept:boolean}`:
  invitee only; non-pending → 409. Accept → insert
  `conversation_members` row (invitee joins), `status='accepted'`,
  return `{ok:true, status:'accepted'}`. Decline → `status='declined'`.
- `POST /api/profile/slash-leave` `{conversationId}`: removes the
  caller's `conversation_members` row for that conversation (403 if not
  a member). Returns `{ok:true}`.
- Router: single segment `slash-invitations` (POST), two segments
  `slash-invitations/<id>` (POST), single segment `slash-leave` (POST).

### Mentions (server enforcement on post creation)
- In `handleCreatePost`: parse `extrasJson` if present; if it contains
  `mentionUserId` (number): load that user's prefs. `who_can_mention`
  `'nobody'` → 400; `'friends'` → caller and mentioned user must
  mutually follow, else 400; `'everyone'` → ok. On success, notify the
  mentioned user (type `mention`, gated by their notifyMention pref).
  (Tags: no tag input exists in the app — nothing to enforce; do not
  invent one.)

### Presence (activity status made real)
- In `requireAuth`, after session validation, update
  `users.last_active_at = NOW()` when it is NULL or older than 5 minutes
  (single UPDATE, best-effort — never fail the request).
- `handlePublicProfile` response: add `lastActiveAt` (ISO string or
  null). Value is null when target `activity_status` is false, or when
  the viewer is restricted by the target. Otherwise the stored value.
- `handlePublicProfile` response: add `interaction: {storyReplies,
  whoCanComment, gifComments, allowStoryShares}` from the target's
  `user_settings` row (defaults when no row).

### Close-friends / hide-story-from are client-enforced
Stories are local-only in this build; the server only stores the lists.
The client filters story visibility using these lists (see client notes).

## Client routes/actions (client agent — `src/lib/api.ts` + views)

Add (all server-first with local fallback where a local store exists;
server failure must surface honestly, not silently pretend success):
- `getMySettings()` / `updateMySettings(patch)` → `/me/settings`
- `listCloseFriends()` / `addCloseFriend(id)` / `removeCloseFriend(id)`
- `listHiddenFrom()` / `addHiddenFrom(id)` / `removeHiddenFrom(id)`
- `listRestricted()` / `restrictUser(id)` / `unrestrictUser(id)`
- `listHiddenWords()` / `addHiddenWord(word)` / `removeHiddenWord(word)`
- `listMutedUsers()` → `/me/muted`
- `listServerNotifications()` / `markNotificationsRead(id?)` → server
  notifications; `NotificationsView` goes server-first, local fallback.
- `listArchive()` / `archiveStory(story)` / `deleteArchived(id)` —
  call `archiveStory` automatically at story creation when
  `saveStoryToArchive` is on.
- `listConnectedApps()` → `/me/apps`; `getAccountStatus()` → `/me/status`
- `listMessageRequests()` / `answerMessageRequest(id, accept)` —
  `createConversation` must handle the `{status:'requested'}` response
  (show "Request sent" state, do not open a conversation).
- `listPostComments(postId)` / `addPostComment(postId, body)` — server-
  first, local fallback to existing `store.comments` behaviour.
- `createSlashInvitation` / `respondSlashInvitation` / `leaveSlash` —
  rewire to the new server endpoints (keep local fallback behaviour for
  when `dbOn` is false).
- Settings type + `DEFAULT_SETTINGS` constant; add new action names to
  the `ACTIONS` list.

## Client views (client agent — new file `src/components/SettingsViews.tsx`)

- `SettingsHub` + one screen per section, reachable from the hub.
  Hub sections (DROP-adapted Instagram grouping):
  - Your account: Edit profile, Notifications
  - How you use DROP: Archiving and downloading, Accessibility, Language,
    Apps and websites
  - Who can see your content: Profile privacy, Close Friends, Blocked,
    Hide story from
  - How others can interact with you: Messages and story replies,
    Message requests, Story replies, Tags and mentions, Comments,
    Sharing, Restricted, Hidden Words
  - What you see: Muted, Content preferences, Like and share counts
  - For professionals: Profile type and tools
  - More info and support: Help, Profile status, Family Center
- `App.tsx`: add view `'settings'` (+ a settings sub-view state, e.g.
  `settingsScreen: string|null`). Profile "⚙️ Settings" button →
  `'settings'`. Privacy & Security becomes a screen inside the hub —
  ALL existing `PrivacyPage` controls must remain reachable (reuse the
  existing `PrivacyPage` component as the hub's Privacy screen, or move
  its sections into the hub — either way, nothing may be lost).
- Edit Profile extras: add `gender` select, `aiGeneratedLabel` toggle,
  `showAccountSuggestions` toggle (via settings endpoints).
- Search box in the hub filtering rows by name.
- Notifications settings screen: toggles per event type (follow, follow
  request, comment, mention, message, Slash, Drop). Email and push rows:
  show as honestly unavailable ("Email notifications aren't available in
  DROP yet — no email provider is connected." / same for push). Never
  fake them.
- Family Center row: honest text "Supervision for teen accounts isn't
  available in DROP yet." (Do NOT build a parent/guardian flow.)
- Sensitive content screen: Less / Standard / More radios + honest note:
  "DROP doesn't classify content yet. 'Less' hides posts from accounts
  you've reported; 'Standard' and 'More' show everything not blocked."
  Enforce client-side in `listFeed()`: level `'less'` filters out posts
  whose author the viewer has reported (use the local reports + server
  `reports` knowledge the client has — at minimum the local report
  action's record).
- Language screen: picker with `en, es, fr, de, pt, hi, ar, zh` storing
  the preference; UI stays English; honest note "DROP is in English for
  now — your choice is saved and will apply when translations arrive."
  Do NOT fake translations.
- Accessibility screen: `reduceMotion` toggle. When on, add a
  `reduce-motion` class to `document.body` and add CSS in `src/index.css`
  that disables animations/transitions app-wide (editor animations,
  Blast animation, dock transitions).
- Like & share counts screen: `hideLikeCounts` toggle; when on, `PostCard`
  and profile grids hide Fire/like counts (show the Fire button without
  the number).
- Profile type screen: Creator / Business / Personal radio cards storing
  `accountType`. No fake insights or subscriptions attached — say so
  plainly ("Creator tools and insights aren't built yet.").
- Apps & websites: list from `/me/apps` (Google sign-in only, with an
  honest empty state for anything else). "Revoke" = sign out (existing
  `revokeSession()` flow) with an honest explanation.
- Help screen: in-app help topics (Blast, Slash, Stories, Drops, privacy)
  written for DROP. No invented contact channels.
- Profile status screen: real data from `/me/status`.
- Story archive screen: owner's archived stories (from `/me/archive`),
  tap to view, delete with in-page two-step confirm.
- Story replies screen: `storyReplies` radio (followers / mutual / off).
  StoryViewer: add a reply box that sends a DM to the story author
  (via `createConversation` + `sendMessage`) — shown only when the
  author's `interaction.storyReplies` allows the viewer (followers →
  viewer follows author; mutual → mutual follow; off → hidden). If the
  author can't be messaged (`canMessage` false), show the honest reason.
- Comments screen: `whoCanComment` radio (everyone / followers / mutual /
  off) with REAL follower counts shown per option (from `profileCounts`
  via `getMyProfileServer()`/local counts), plus `gifComments` toggle
  with the honest note "GIF comments aren't available in DROP yet — this
  setting will apply when they are."
- Sharing screen: `allowStoryShares` toggle. When off, the share action
  on others' view of your stories is hidden/disabled (StoryViewer share
  affordance must respect it — if no share affordance exists, the toggle
  is stored and the screen says so honestly).
- Hide story from / Close friends: searchable follower lists with radio
  circles (same pattern as Instagram reference). Story visibility
  filtering (client, stories are local-only): in `listStories`/StoryViewer,
  hide a story from a viewer if the viewer is in the author's
  `story_hidden_from` list, and hide `audience:'close-friends'` stories
  from viewers not in the author's `close_friends` list. To support
  this, `createStory` accepts an optional `audience` field
  (`'everyone' | 'close-friends'`, default `'everyone'`) stored in
  `extrasJson`; the StoryEditor gets an audience picker (Everyone /
  Close Friends) when creating a story. The author always sees their own
  stories. Lists are fetched server-first; when offline/`dbOn` false,
  fall back to local-only (no filtering) and say so nowhere — just
  don't filter.
- Restricted screen: list + Unrestrict; restricted users' comments are
  hidden from other viewers server-side (already in the server contract).
- Hidden Words screen: custom words manager (add/remove, max 100) +
  toggles are NOT needed beyond the list — the filtering is automatic.
  Show honest explainer text.
- Muted screen: its own screen listing muted users with Unmute (uses
  `/me/muted` + existing unmute).
- Message requests screen: inbox with incoming requests (Accept /
  Decline) + outgoing (pending) + hidden requests section.
- Presence: `ProfilePage` shows "Active now" / "Active 2h ago" under the
  name when `lastActiveAt` is present (and the viewer isn't the owner);
  hide it entirely when null. Format relative time honestly.
- Message requests + Slash: `MessagesView` shows a "Requests" entry
  opening the requests screen; `/username` Slash invite calls the new
  server endpoint and shows the invitation state; invitees see the
  invitation via their notifications/inbox (server notification row is
  listed by the server-first NotificationsView).

## Verification (each agent, before reporting back)

- Server agent: `npx tsc -p tsconfig.server.json` passes; write
  `/tmp/test-settings-server.mts` (follow the pattern of
  `/tmp/test-profile-content.mts`: import handlers + router, mock sql
  tag, no real DB) covering: settings GET/PATCH validation + fail-closed
  503 without DB + 401 without Bearer; each list endpoint add/remove
  validation; hidden-words validation; message-request flow (friends →
  requested, nobody → 403); comment guards (off/followers/hidden word);
  slash guards; mention check on createPost; notifications read; archive
  CRUD; apps/status shapes. All tests must pass; report counts.
- Client agent: `npm run build` passes (tsc + vite); `npx vite preview`
  returns 200. No new `api/` files. No dummy data. Grep clean for
  `confirm(`, `alert(`, `prompt(` in new code.
- Both agents report: files changed (new/edited, with line counts),
  what was built per screen, verification results, and HONEST LIMITS
  (what is stored-not-enforced, what is honestly unavailable, what
  still needs a live Neon round-trip test by the user).
