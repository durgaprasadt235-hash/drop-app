// DROP — POST /api/profile/follow-requests/[id] { accept: boolean }
// Only the TARGET of the request may accept or decline it. Accepting
// creates the follow relationship; declining marks it declined.
// Approving someone else's request is rejected (403).

import {
  requireAuth, handleError, HttpError, notify, audit,
} from '../../lib/profile.js';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const id = Number(req.query?.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid request.');
    const rows = (await sql`SELECT * FROM follow_requests WHERE id = ${id}`) as any[];
    if (rows.length === 0) throw new HttpError(404, 'Follow request not found.');
    const fr = rows[0];
    if (fr.target_id !== me.id) throw new HttpError(403, 'Only the person who received this request can answer it.');
    if (fr.status !== 'pending') throw new HttpError(409, `This request is already ${fr.status}.`);
    const accept = req.body?.accept === true;
    if (accept) {
      await sql`INSERT INTO follows (follower_id, following_id) VALUES (${fr.requester_id}, ${fr.target_id}) ON CONFLICT DO NOTHING`;
      await sql`UPDATE follow_requests SET status = 'accepted', updated_at = NOW() WHERE id = ${id}`;
      await notify(sql, fr.requester_id, 'follow_accepted', `${me.username} accepted your follow request.`);
      await audit(sql, me.id, 'follow_request_accepted', String(id));
      res.status(200).json({ ok: true, status: 'accepted' });
    } else {
      await sql`UPDATE follow_requests SET status = 'declined', updated_at = NOW() WHERE id = ${id}`;
      await audit(sql, me.id, 'follow_request_declined', String(id));
      res.status(200).json({ ok: true, status: 'declined' });
    }
  } catch (err) {
    handleError(res, err);
  }
}
