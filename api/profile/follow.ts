// DROP — POST /api/profile/follow { targetId }, DELETE /api/profile/follow?targetId=
// Public target: follow is accepted immediately. Private target: a
// pending follow request is created (and the target is notified); the
// requester is NOT a follower until the target accepts. Self-follow,
// follows to blocked accounts and duplicate follows are rejected.
// DELETE unfollows (and cancels any pending request).

import {
  requireAuth, handleError, HttpError, getUserById, isBlocked,
  isFollowing, pendingRequest, notify, audit,
} from '../lib/profile.js';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    const targetId = Number(req.method === 'POST' ? req.body?.targetId : req.query?.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Invalid target.');
    if (targetId === me.id) throw new HttpError(400, 'You cannot follow yourself.');
    const target = await getUserById(sql, targetId);
    if (!target) throw new HttpError(404, 'Profile not found.');
    if (await isBlocked(sql, me.id, targetId)) throw new HttpError(403, 'You cannot follow this account.');
    if (req.method === 'POST') {
      if (await isFollowing(sql, me.id, targetId)) {
        res.status(200).json({ ok: true, status: 'following' });
        return;
      }
      if (await pendingRequest(sql, me.id, targetId)) {
        res.status(200).json({ ok: true, status: 'requested' });
        return;
      }
      if (target.is_private) {
        await sql`INSERT INTO follow_requests (requester_id, target_id, status) VALUES (${me.id}, ${targetId}, 'pending')`;
        await notify(sql, targetId, 'follow_request', `${me.username} requested to follow you.`);
        await audit(sql, me.id, 'follow_requested', String(targetId));
        res.status(200).json({ ok: true, status: 'requested' });
        return;
      }
      await sql`INSERT INTO follows (follower_id, following_id) VALUES (${me.id}, ${targetId}) ON CONFLICT DO NOTHING`;
      await notify(sql, targetId, 'follow', `${me.username} started following you.`);
      await audit(sql, me.id, 'followed', String(targetId));
      res.status(200).json({ ok: true, status: 'following' });
      return;
    }
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'POST, DELETE');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    await sql`DELETE FROM follows WHERE follower_id = ${me.id} AND following_id = ${targetId}`;
    await sql`UPDATE follow_requests SET status = 'cancelled', updated_at = NOW() WHERE requester_id = ${me.id} AND target_id = ${targetId} AND status = 'pending'`;
    await audit(sql, me.id, 'unfollowed', String(targetId));
    res.status(200).json({ ok: true, status: 'none' });
  } catch (err) {
    handleError(res, err);
  }
}
