// DROP — GET /api/profile/lists?targetId=&kind=followers|following
// Follower / following lists. A private account's lists are visible
// only to the owner and approved followers; everyone else gets 403.
// Blocked relationships get 404.

import {
  requireAuth, handleError, HttpError, getUserById, isBlocked,
  canViewFullProfile, audit,
} from '../lib/profile.js';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const targetId = Number(req.query?.targetId);
    const kind = req.query?.kind === 'following' ? 'following' : 'followers';
    if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Invalid target.');
    const target = await getUserById(sql, targetId);
    if (!target) throw new HttpError(404, 'Profile not found.');
    if (me.id !== targetId && (await isBlocked(sql, me.id, targetId))) throw new HttpError(404, 'Profile not found.');
    if (!(await canViewFullProfile(sql, me.id, target as any))) throw new HttpError(403, 'This account is private.');
    const rows = (kind === 'followers'
      ? await sql`SELECT u.id, u.username, u.display_name, u.avatar_url FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = ${targetId} ORDER BY u.display_name`
      : await sql`SELECT u.id, u.username, u.display_name, u.avatar_url FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = ${targetId} ORDER BY u.display_name`) as any[];
    await audit(sql, me.id, 'viewed_list', `${kind}:${targetId}`);
    res.status(200).json({
      ok: true,
      users: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url ?? null })),
    });
  } catch (err) {
    handleError(res, err);
  }
}
