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
- `src/lib/api.ts` — typed client contract: all 70 actions
- `src/lib/realtime.ts` — WebSocket live sync with polling fallback
- `server/index.ts` — Node server (Google verification, Twilio OTP,
  sessions, sealed Drops, Protected rules)
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
| `DROP_GOOGLE_CLIENT_ID` | Google OAuth | Google Cloud Console → Credentials |
| `DROP_GOOGLE_CLIENT_SECRET` | Google OAuth | Google Cloud Console → Credentials |
| `DROP_TWILIO_ACCOUNT_SID` | Phone OTP | Twilio Console |
| `DROP_TWILIO_AUTH_TOKEN` | Phone OTP | Twilio Console |
| `DROP_TWILIO_FROM_NUMBER` | Phone OTP | Twilio phone number |

Honest note: **Google and Twilio need real credentials to activate.**
Without them the app shows "coming soon — credentials needed" on the
sign-in screen and in Profile → Sign-in & security, instead of faking a
login or an SMS. The in-app profile sign-in works without them, and the
standalone client in this repo stores data in `localStorage` for
demo/testing — the Muse hosted database is **not** included here.
Deploying this repo does not migrate or copy Muse-hosted data.

## Features

- **Auth:** in-app profile with password + revocable 30-day sessions;
  Google OAuth (server-verified); phone OTP signup / sign-in / forgot
  password (10-min expiry, single-use, 5-try lockout, resend limits).
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
   Project → Settings → Environment Variables (only if you have real
   Google / Twilio credentials; otherwise leave them unset and the
   app will show "credentials needed" honestly).
4. Deploy. The SPA rewrite in `vercel.json` sends all routes to
   `index.html`.

## Muse → Vercel mapping

| Muse hosted app | This repo |
|-----------------|-----------|
| Hosted SQLite database | `localStorage` (standalone) / Postgres via `server/schema.ts` |
| Platform viewer channel | `src/lib/realtime.ts` (WebSocket + polling fallback) |
| Server actions (70) | `src/lib/api.ts` + `server/index.ts` |
| Secrets in the Muse server | `.env` on Vercel (never in git) |
