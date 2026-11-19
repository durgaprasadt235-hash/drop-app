// DROP — GET /api/profile/[username]
// Public profile lookup. Authentication is optional: an unauthenticated
// viewer, or a viewer who is blocked / not an approved follower of a
// private account, sees only the public summary (display name,
// username, avatar, is_private) — no bio, links, counts or content.
// The viewer is identified by Bearer session when present; a blocked
// relationship returns 404 (never confirms the account exists to a
// blocked viewer).

import { getSql, ensureProfileTables } from '../lib/profile.js';
import type { Sql } from '../lib/profile.js';
import {
  getUserByUsername, isBlocked, isFollowing, pendingRequest,
  canViewFullProfile, profileCounts, publicProfile, handleError, HttpError,
} from '../lib/profile.js';
import { validateDbSession } from '../lib/db.js';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const sql: Sql | null = getSql();
    if (!sql) throw new HttpError(503, 'Shared database not configured.');
    await ensureProfileTables(sql);
    const username = String(req.query?.username ?? '');
    const target = await getUserByUsername(sql, username);
    if (!target) throw new HttpError(404, 'Profile not found.');
    // Optional viewer identity (never trusted from a body/query id).
    let viewerId: number | null = null;
    const auth = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token) {
      const viewer = await validateDbSession(sql, token);
      if (viewer) viewerId = viewer.id;
    }
    if (viewerId !== null && viewerId !== target.id && (await isBlocked(sql, viewerId, target.id))) {
      throw new HttpError(404, 'Profile not found.');
    }
    const full = await canViewFullProfile(sql, viewerId, target as any);
    const counts = full ? await profileCounts(sql, target.id) : { posts: 0, followers: 0, following: 0 };
    let relationship: 'none' | 'following' | 'requested' | 'self' = 'none';
    if (viewerId === target.id) relationship = 'self';
    else if (viewerId !== null) {
      if (await isFollowing(sql, viewerId, target.id)) relationship = 'following';
      else if (await pendingRequest(sql, viewerId, target.id)) relationship = 'requested';
    }
    res.status(200).json({ ok: true, profile: publicProfile(target as any, { full, counts, relationship }) });
  } catch (err) {
    handleError(res, err);
  }
}
