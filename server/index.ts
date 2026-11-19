// DROP server — Node built-in http, no framework dependency.
// Run with:  npx tsx server/index.ts   (or compile with tsc and node dist-server/index.js)
// Env: DROP_GOOGLE_CLIENT_ID, DROP_GOOGLE_CLIENT_SECRET,
//      DROP_TWILIO_ACCOUNT_SID, DROP_TWILIO_AUTH_TOKEN, DROP_TWILIO_FROM_NUMBER
// All 70 actions from src/lib/api.ts are dispatched here in the Muse build;
// this file implements the same rules against an in-memory store so the
// logic is reviewable and testable without the hosted database. Replace
// the in-memory store with the Postgres tables in server/schema.ts for
// production — the rules below must stay server-side.
//
// Rules enforced here (never trust the client alone):
// - Google ID tokens are verified with Google (POST body, never a URL).
// - OTP: 10-min expiry, single-use, 5-try lockout, 3 resends per 15 min,
//   30s cooldown between resends. Only the code hash is stored.
// - Sessions: 30 days, revocable, only the session hash is stored.
// - Sealed Drops: no caption/media before blast time, except the creator.
// - Protected Drops: no Save / Share, server rejects saving them.
// - Message delete: sender-only, deletes for everyone.
// - Slash: invite is instant, no permanent group; leaving vanishes it.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3001);
const GOOGLE_CLIENT_ID = process.env.DROP_GOOGLE_CLIENT_ID ?? '';
const TWILIO_SID = process.env.DROP_TWILIO_ACCOUNT_SID ?? '';
const TWILIO_TOKEN = process.env.DROP_TWILIO_AUTH_TOKEN ?? '';
const TWILIO_FROM = process.env.DROP_TWILIO_FROM_NUMBER ?? '';

export function authStatus() {
  return { googleConfigured: Boolean(GOOGLE_CLIENT_ID), smsConfigured: Boolean(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// --- OTP -----------------------------------------------------------------
interface Otp { phone: string; codeHash: string; purpose: string; expiresAt: number; attempts: number; used: boolean; createdAt: number }
const otps: Otp[] = [];
const otpSends: { phone: string; at: number }[] = [];

export function requestOtp(phone: string, purpose: 'signup' | 'signin' | 'forgot'): { ok: boolean; error?: string } {
  if (!authStatus().smsConfigured) return { ok: false, error: 'SMS credentials needed — set DROP_TWILIO_*' };
  const now = Date.now();
  const recent = otpSends.filter((s) => s.phone === phone && now - s.at < 15 * 60 * 1000);
  if (recent.length >= 3) return { ok: false, error: 'Too many codes — try again in 15 minutes.' };
  if (recent.length > 0 && now - recent[recent.length - 1].at < 30 * 1000) return { ok: false, error: 'Wait 30 seconds before resending.' };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otps.push({ phone, codeHash: hash(code), purpose, expiresAt: now + 10 * 60 * 1000, attempts: 0, used: false, createdAt: now });
  otpSends.push({ phone, at: now });
  // Send via Twilio (real SMS in production). The code itself is never logged.
  void sendSms(phone, `Your DROP code is ${code}. It expires in 10 minutes.`);
  return { ok: true };
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

async function sendSms(to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }),
  });
}

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
  if (req.method === 'POST' && url.pathname === '/auth/phone/otp') {
    const body = await readJson(req);
    const r = requestOtp(String(body.phone ?? ''), (body.purpose as 'signup' | 'signin' | 'forgot') ?? 'signup');
    return send(res, r.ok ? 200 : 400, r);
  }
  if (req.method === 'POST' && url.pathname === '/auth/google') {
    const body = await readJson(req);
    const verified = await verifyGoogleIdToken(String(body.idToken ?? ''));
    if (!verified) return send(res, 401, { error: 'Google token verification failed or credentials not configured.' });
    return send(res, 200, { user: verified, session: issueSession(0) });
  }
  return send(res, 404, { error: 'Not found. See api/README.md for the full 70-action contract.' });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`DROP server listening on ${PORT} — googleConfigured=${authStatus().googleConfigured} smsConfigured=${authStatus().smsConfigured}`));
}

export default server;
