// DROP server — Node built-in http, no framework dependency.
// Run with:  npx tsx server/index.ts   (or compile with tsc and node dist-server/index.js)
// Env: DROP_GOOGLE_CLIENT_ID
// All actions from src/lib/api.ts are dispatched here in the Muse build;
// this file implements the same rules against an in-memory store so the
// logic is reviewable and testable without the hosted database. Replace
// the in-memory store with the Postgres tables in server/schema.ts for
// production — the rules below must stay server-side.
//
// PHONE + OTP IS DISABLED (2026-11-19): the OTP helpers below are
// reference-only, kept for the record. No HTTP route exposes them and
// authStatus() always reports smsConfigured=false. Do not re-expose
// them without a user decision.
//
// Rules enforced here (never trust the client alone):
// - Google ID tokens are verified with Google (POST body, never a URL).
// - Sessions: 30 days, revocable, only the session hash is stored.
// - Sealed Drops: no caption/media before blast time, except the creator.
// - Protected Drops: no Save / Share, server rejects saving them.
// - Message delete: sender-only, deletes for everyone.
// - Slash: invite is instant, no permanent group; leaving vanishes it.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3001);
const GOOGLE_CLIENT_ID = process.env.DROP_GOOGLE_CLIENT_ID ?? '';

export function authStatus() {
  return { googleConfigured: Boolean(GOOGLE_CLIENT_ID), smsConfigured: false };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// --- OTP (DISABLED — reference only, no HTTP route exposes it) ---------
// Phone + OTP was removed 2026-11-19. Kept here only so the rules that
// used to apply (10-min expiry, single-use, 5-try lockout, 3 resends
// per 15 min, 30s cooldown, only the code hash stored) stay on record.
// requestOtp() always refuses because smsConfigured is always false.
interface Otp { phone: string; codeHash: string; purpose: string; expiresAt: number; attempts: number; used: boolean; createdAt: number }
const otps: Otp[] = [];

export function requestOtp(_phone: string, _purpose: 'signup' | 'signin' | 'forgot'): { ok: boolean; error?: string } {
  // DISABLED — phone + OTP removed 2026-11-19. No SMS is ever sent.
  return { ok: false, error: 'Phone sign-in is disabled.' };
}

export function verifyOtp(phone: string, code: string, purpose: string): boolean {
  const now = Date.now();
  const otp = [...otps].reverse().find((o) => o.phone === phone && o.purpose === purpose && !o.used);
  if (!otp) return false;
  if (now > otp.expiresAt) return false;
  otp.attempts += 1;
  if (otp.attempts > 5) return false; // 5-try lockout
  if (!safeEqual(otp.codeHash, hash(code))) return false;
  otp.used = true; // single-use
  return true;
}

// (Twilio SMS sender removed with phone auth — see DISABLED note above.)

// --- Google ---------------------------------------------------------------
export async function verifyGoogleIdToken(idToken: string): Promise<{ sub: string; email: string; name?: string; picture?: string } | null> {
  if (!GOOGLE_CLIENT_ID) return null;
  // Token is sent in the POST body, never in a URL query string.
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { aud?: string; sub?: string; email?: string; name?: string; picture?: string };
  if (data.aud !== GOOGLE_CLIENT_ID || !data.sub || !data.email) return null;
  return { sub: data.sub, email: data.email, name: data.name, picture: data.picture };
}

// --- Sessions --------------------------------------------------------------
interface Session { userId: number; hash: string; expiresAt: number; revoked: boolean }
const sessions: Session[] = [];

export function issueSession(userId: number): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('hex');
  sessions.push({ userId, hash: hash(token), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, revoked: false });
  return { token, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
}

export function validateSession(token: string): number | null {
  const s = sessions.find((x) => safeEqual(x.hash, hash(token)));
  if (!s || s.revoked || Date.now() > s.expiresAt) return null;
  return s.userId;
}

export function revokeSession(token: string): void {
  const s = sessions.find((x) => safeEqual(x.hash, hash(token)));
  if (s) s.revoked = true;
}

// --- Google users (in-memory reference store) ---------------------------
interface GoogleUser { id: number; googleSub: string; email: string; displayName: string; avatarUrl?: string }
const googleUsers: GoogleUser[] = [];
let googleUserSeq = 0;

export function findOrCreateGoogleUser(verified: { sub: string; email: string; name?: string; picture?: string }): GoogleUser {
  const existing = googleUsers.find((u) => u.googleSub === verified.sub)
    ?? googleUsers.find((u) => u.email === verified.email);
  if (existing) {
    existing.googleSub = verified.sub;
    existing.email = verified.email;
    return existing;
  }
  const user: GoogleUser = {
    id: ++googleUserSeq,
    googleSub: verified.sub,
    email: verified.email,
    displayName: verified.name ?? verified.email.split('@')[0],
    avatarUrl: verified.picture,
  };
  googleUsers.push(user);
  return user;
}

// --- HTTP ------------------------------------------------------------------
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>; }
  catch { return {}; }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, ...authStatus() });
  if (req.method === 'GET' && url.pathname === '/auth/status') return send(res, 200, authStatus());
  // No /auth/phone/otp route — phone + OTP is disabled (2026-11-19).
  if (req.method === 'POST' && url.pathname === '/auth/google') {
    const body = await readJson(req);
    const verified = await verifyGoogleIdToken(String(body.idToken ?? ''));
    if (!verified) return send(res, 401, { error: 'Google token verification failed or credentials not configured.' });
    const user = findOrCreateGoogleUser(verified);
    return send(res, 200, { user, session: issueSession(user.id) });
  }
  return send(res, 404, { error: 'Not found. See api/README.md for the full action contract.' });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`DROP server listening on ${PORT} — googleConfigured=${authStatus().googleConfigured} smsConfigured=${authStatus().smsConfigured}`));
}

export default server;
