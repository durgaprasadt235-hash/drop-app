# DROP

Privacy-aware social platform: 24-hour Stories, feed Posts, Reels,
One-Time Drops with Blast, persistent direct messaging with Slash,
Clubrooms, search, notifications, and saved items. No dummy users,
posts, or data — every record is created by a real user in the app.

## What is in this repo

- `src/App.tsx` — app shell: sign-in, Home v1.0, Stories, Posts, Hub,
  Messages, Reels, Clubrooms, Search, Profile, Notifications, Saved,
  AssistiveTouch dock
- `src/components/` — StoryViewer (30s, hold-to-pause, replay),
  StoryEditor (full editor), PostCard (Fire, double-tap, long-press
  comments), DropHub (Waiting/Ready, Blast presets), MessagesView
  (DMs + Slash), OtherViews (Reels, Clubrooms, Search, Notifications, Saved)
- `src/lib/filters.ts` — all 32 DROP filters + 22 DROP effects, verbatim
- `src/lib/api.ts` — typed client contract: all 65 actions
- `src/lib/google.ts` — Google Identity Services loader + button
- `api/auth/google.ts` — Vercel serverless function: verifies the
  Google ID token with Google and issues a 30-day session
- `api/auth/status.ts` — Vercel serverless function: auth status
- `server/index.ts` — Node server (Google verification, sessions,
  sealed Drops, Protected rules). Phone + OTP is disabled.
- `server/schema.ts` + `docs/schema.md` — all 28 database tables
- `api/README.md` — server rules to preserve

## Setup

```bash
npm install
cp .env.example .env   # fill in real values — never commit .env
npm run dev            # http://localhost:5173
npm run build          # typecheck + production build
npm run server         # node server (needs tsx, see below)
```

Server: `npm run server` uses `tsx`. If you prefer, compile it with
`npx tsc -p tsconfig.server.json` and run `node dist-server/index.js`.

## Environment variables

| Variable | Required for | Notes |
|----------|--------------|-------|
| `VITE_GOOGLE_CLIENT_ID` | Google sign-in button (browser) | Public client ID, baked in at build time |
| `DROP_GOOGLE_CLIENT_ID` | Google token verification (server) | Same client ID as above, read at runtime |

Set **both to the same client ID** (see "Google sign-in setup" below).
Phone + OTP is disabled — there are no Twilio variables.

Honest note: **Google needs a real client ID to activate.** Without
it the app shows "Continue with Google (coming soon — credentials
needed)" on the sign-in screen and in Profile → Sign-in & security,
instead of faking a login. The in-app profile sign-in works without
it, and the standalone client in this repo stores data in
`localStorage` for demo/testing — the Muse hosted database is **not**
included here. Deploying this repo does not migrate or copy
Muse-hosted data.

## Google sign-in setup (Google-only auth)

1. **Google Cloud Console** → APIs & Services → Credentials → Create
   Credentials → OAuth client ID → Application type: **Web application**.
2. Authorized JavaScript origins: add
   `https://drop-app-five.vercel.app` (and `http://localhost:5173` for
   local dev). No redirect URI is needed — Google Identity Services
   returns the ID token directly to the page.
3. Copy the client ID (ends in `.apps.googleusercontent.com`).
4. **Vercel** → Project `drop-app` → Settings → Environment Variables:
   add `VITE_GOOGLE_CLIENT_ID` = the client ID and
   `DROP_GOOGLE_CLIENT_ID` = the same client ID, both for
   **Production** (add Preview too if you test preview deployments).
5. **Redeploy** (Deployments → ⋯ → Redeploy) so the build picks up
   `VITE_GOOGLE_CLIENT_ID`. Then open the site, tap "Continue with
   Google", and sign in — the token is verified server-side by
   `api/auth/google.ts` (`aud === DROP_GOOGLE_CLIENT_ID`) before any
   profile is created or linked.

Phone sign-in is disabled: there is no phone button, no OTP, and no
phone-based password reset. If a password user forgets their password,
they can sign in with Google once they link it in Profile →
Sign-in & security; password reset itself is currently unavailable.

## Features

- **Auth:** in-app profile with password + revocable 30-day sessions;
  Google OAuth (server-verified ID token, real Google button, link
  from Profile → Sign-in & security). Phone + OTP is disabled.
- **Home v1.0:** White default, Dark navy `#0B1327` toggle (persisted);
  header with Clubs, DROP logo, bell with real unread badge; 72px
  Stories rail; 64px shortcut pill (My Drops / Scheduled / Active /
  Trending); edge-to-edge feed; Fire instead of heart; double-tap Fire;
  500ms long-press Comments.
- **Stories:** 24h expiry, 30s per segment with progress + countdown,
  replay within 24h, hold-to-pause, tap next/previous, swipe-down close;
  32 filters; 22-effect gallery (For You / Spotlight / Real-time /
  Personalized / Film + search); full editor (Text 6 fonts, colour
  wheel, alignment, animation, background, Mention + Location;
  Stickers sheet with all 19 entries; Draw 5 pens, 9 colours, Undo;
  Avatar sticker; Download; More). Music/Donation marked unavailable.
- **Posts:** the same full editor as Stories, saved with the Post;
  Poll / Questions / Slider work with real votes, answers, ratings.
- **DROP Hub:** Waiting / Ready to Open, Blast presets
  1h / 6h / 24h / 3d / 7d, sealed Drops, Blast animation on first
  open, Public vs Protected rules.
- **Messages:** persistent DMs, Slash (`/username` to invite, no
  permanent group, vanishes on leave), sender-only delete for everyone.
- **AssistiveTouch dock:** round translucent ball, draggable anywhere;
  tap unfurls the 56×296 panel on the nearest side; 30s idle
  auto-collapse back to the ball.
- **Real-time:** WebSocket live sync with polling fallback.

## GitHub push

```bash
git init
git add .
git commit -m "DROP v1.0 — full standalone app"
git branch -M main
git remote add origin https://github.com/durgaprasadt235-hash/drop-app.git
git push -u origin main
```

## Vercel import

1. Go to https://vercel.com/new and import
   `durgaprasadt235-hash/drop-app`.
2. Framework preset: **Vite**. Build command: `npm run build`.
   Output directory: `dist`.
3. Add the environment variables from `.env.example` in
   Project → Settings → Environment Variables (`VITE_GOOGLE_CLIENT_ID`
   and `DROP_GOOGLE_CLIENT_ID`, same value — see "Google sign-in setup"
   above). If you have no Google client ID yet, leave them unset and
   the app will show "credentials needed" honestly.
4. Deploy. The SPA rewrite in `vercel.json` sends all routes to
   `index.html`. Vercel Serverless Functions in `api/` are routed
   before the rewrite, so `/api/auth/google` and `/api/auth/status`
   keep working.

## Muse → Vercel mapping

| Muse hosted app | This repo |
|-----------------|-----------|
| Hosted SQLite database | `localStorage` (standalone) / Postgres via `server/schema.ts` |
| Platform viewer channel | `src/lib/realtime.ts` (WebSocket + polling fallback) |
| Server actions (65) | `src/lib/api.ts` + `server/index.ts` + `api/` |
| Secrets in the Muse server | `.env` on Vercel (never in git) |
