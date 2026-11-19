// DROP — POST /api/profile/block { targetId }, DELETE /api/profile/block?targetId=
// Blocking is enforced server-side: it removes follows in both
// directions, cancels pending follow requests, and (via isBlocked in
// api/lib/profile.ts) blocks profile views, follows, messages, Slash
// invitations and search between the two accounts.

import {
  requireAuth, handleError, HttpError, getUserById, audit,
} from '../lib/profile.js';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    const targetId = Number(req.method === 'POST' ? req.body?.targetId : req.query?.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Invalid target.');
    if (targetId === me.id) throw new HttpError(400, 'You cannot block yourself.');
    const target = await getUserById(sql, targetId);
    if (!target) throw new HttpError(404, 'Profile not found.');
    if (req.method === 'POST') {
      await sql`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${me.id}, ${targetId}) ON CONFLICT DO NOTHING`;
      await sql`DELETE FROM follows WHERE (follower_id = ${me.id} AND following_id = ${targetId}) OR (follower_id = ${targetId} AND following_id = ${me.id})`;
      await sql`UPDATE follow_requests SET status = 'cancelled', updated_at = NOW() WHERE ((requester_id = ${me.id} AND target_id = ${targetId}) OR (requester_id = ${targetId} AND target_id = ${me.id})) AND status = 'pending'`;
      await audit(sql, me.id, 'blocked', String(targetId));
      res.status(200).json({ ok: true, blocked: true });
      return;
    }
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'POST, DELETE');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    await sql`DELETE FROM blocks WHERE blocker_id = ${me.id} AND blocked_id = ${targetId}`;
    await audit(sql, me.id, 'unblocked', String(targetId));
    res.status(200).json({ ok: true, blocked: false });
  } catch (err) {
    handleError(res, err);
  }
}
