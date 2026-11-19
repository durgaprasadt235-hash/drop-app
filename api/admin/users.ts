// DROP — Vercel serverless function: owner-only user insights.
// GET /api/admin/users → { dbConfigured, totalUsers, users, signupsByDay }
// Access control: when DATABASE_URL is NOT set there is no shared data
// to protect, so it returns { dbConfigured: false, totalUsers: 0,
// users: [], signupsByDay: [] } (no crash, no fake count). When the DB
// IS set, the caller must send a valid session token
// (Authorization: Bearer <token>, issued by /api/auth/google and
// stored hashed in auth_sessions) AND the session's user must be an
// admin (DROP_ADMIN_EMAILS, default durgaprasadt235@gmail.com).
// Anyone else gets 401 (no/invalid token) or 403 (not an admin).
// User emails are returned ONLY to an admin — never to unauthenticated
// or non-admin callers. Password profiles are local-only and are not
// in this table; users who signed up BEFORE the DB was connected were
// local-only too and are NOT backfilled — they do not appear here.

import {
  getSql, ensureUserTables, validateDbSession, isAdminEmail, publicDbUser,
} from '../lib/db.js';
import type { DbUserRow } from '../lib/db.js';

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }
  const sql = getSql();
  if (!sql) {
    res.status(200).json({ dbConfigured: false, totalUsers: 0, users: [], signupsByDay: [] });
    return;
  }
  const auth = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) {
    res.status(401).json({ ok: false, error: 'Sign-in required.' });
    return;
  }
  let admin: DbUserRow | null;
  try {
    await ensureUserTables(sql);
    admin = await validateDbSession(sql, token);
  } catch (err) {
    console.error('DROP admin users: shared DB unavailable', err);
    res.status(503).json({ ok: false, error: 'Shared database unavailable — please try again in a moment.' });
    return;
  }
  if (!admin) {
    res.status(401).json({ ok: false, error: 'Invalid or expired session.' });
    return;
  }
  if (!isAdminEmail(admin.email)) {
    res.status(403).json({ ok: false, error: 'Admin only.' });
    return;
  }
  const rows = (await sql`
    SELECT * FROM users ORDER BY created_at DESC`) as DbUserRow[];
  const byDay = (await sql`
    SELECT DATE(created_at) AS day, COUNT(*)::int AS count
    FROM users GROUP BY DATE(created_at) ORDER BY day DESC`) as { day: string; count: number }[];
  res.status(200).json({
    dbConfigured: true,
    totalUsers: rows.length,
    users: rows.map(publicDbUser),
    signupsByDay: byDay.map((r) => ({ day: String(r.day).slice(0, 10), count: r.count })),
  });
}
