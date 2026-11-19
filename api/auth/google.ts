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
// Shared user tracking (2026-11-19): when DATABASE_URL (Neon Postgres)
// is set, the verified user is upserted into the shared users table
// (by google_sub, then email) and the session row is stored server-side
// with only its hash — the response then includes dbUser + dbConfigured
// so the client can use the shared DB id as its local cache id. When
// DATABASE_URL is NOT set, the previous localStorage-compatible
// behaviour is kept and dbConfigured is false — a central count is
// never faked. If the DB is set but unreachable, sign-in fails with
// 503 rather than silently signing in locally and undercounting.
// Phone + OTP is disabled (2026-11-19) — there is no phone endpoint here.

import { randomBytes } from 'node:crypto';
import {
  getSql, ensureUserTables, upsertGoogleUser, createDbSession, publicDbUser,
} from '../lib/db.js';

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
  const sql = getSql();
  if (sql) {
    try {
      await ensureUserTables(sql);
      const dbRow = await upsertGoogleUser(sql, verified);
      const session = await createDbSession(sql, dbRow.id);
      res.status(200).json({
        ok: true, user: verified, dbUser: publicDbUser(dbRow),
        session, dbConfigured: true,
      });
      return;
    } catch (err) {
      console.error('DROP Google sign-in: shared DB unavailable', err);
      res.status(503).json({
        ok: false,
        error: 'Shared database unavailable — please try again in a moment.',
      });
      return;
    }
  }
  // No shared database: the session token is issued here and the
  // profile is created/linked in the client store (src/lib/api.ts,
  // keyed by Google sub). The central user count is not available in
  // this mode (dbConfigured: false) — never fake it.
  res.status(200).json({ ok: true, user: verified, session: issueSessionToken(), dbConfigured: false });
}
