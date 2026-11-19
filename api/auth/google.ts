// DROP — Vercel serverless function: Google sign-in.
// POST /api/auth/google  { idToken }  (ID token in the POST body, never a URL)
// Verifies the Google ID token with Google (tokeninfo), checks
// aud === DROP_GOOGLE_CLIENT_ID, and on success returns the verified
// Google identity plus a 30-day session token. The client then creates
// or links the local profile for that Google sub (see src/lib/api.ts).
// No secrets in code: the client ID comes from DROP_GOOGLE_CLIENT_ID
// (Vercel Project Settings → Environment Variables). The client ID is a
// public identifier, not a secret; no client secret is needed for
// Google Identity Services token verification.
// Phone + OTP is disabled (2026-11-19) — there is no phone endpoint here.

import { randomBytes } from 'node:crypto';

interface GoogleTokenInfo {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
  exp?: string;
}

export interface VerifiedGoogleUser {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export async function verifyGoogleIdToken(
  idToken: string,
): Promise<VerifiedGoogleUser | null> {
  const clientId = process.env.DROP_GOOGLE_CLIENT_ID ?? '';
  if (!clientId || !idToken) return null;
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as GoogleTokenInfo;
  if (data.aud !== clientId || !data.sub || !data.email) return null;
  if (data.email_verified !== undefined && data.email_verified !== 'true') return null;
  if (data.exp && Number(data.exp) * 1000 < Date.now()) return null;
  return { sub: data.sub, email: data.email, name: data.name, picture: data.picture };
}

function issueSessionToken(): { token: string; expiresAt: string } {
  return {
    token: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }
  const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : '';
  if (!idToken) {
    res.status(400).json({ ok: false, error: 'Missing Google ID token.' });
    return;
  }
  const verified = await verifyGoogleIdToken(idToken);
  if (!verified) {
    // Covers both "credentials not configured" and "token invalid" —
    // the client must never distinguish them into a fake login.
    res.status(401).json({
      ok: false,
      error: 'Google sign-in failed — token could not be verified or Google credentials are not configured.',
    });
    return;
  }
  // NOTE (standalone): this deployment has no shared database, so the
  // session token is issued here and the profile is created/linked in
  // the client store (src/lib/api.ts, keyed by Google sub). In a
  // production deployment backed by Postgres (server/schema.ts), this
  // function must instead create/link the user row and store only the
  // session hash server-side, and the client must validate the session
  // against the server — never trust a client-stored session alone.
  res.status(200).json({ ok: true, user: verified, session: issueSessionToken() });
}
