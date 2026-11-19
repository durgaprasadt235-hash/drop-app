// DROP — POST /api/profile/mute { targetId }, DELETE /api/profile/mute?targetId=
// Muting is distinct from blocking: it suppresses feed content and
// notifications from the muted account, but does NOT delete follows
// or messages and does NOT hide the muter from the muted account.

import {
  requireAuth, handleError, HttpError, getUserById, audit,
} from '../lib/profile.js';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    const targetId = Number(req.method === 'POST' ? req.body?.targetId : req.query?.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Invalid target.');
    if (targetId === me.id) throw new HttpError(400, 'You cannot mute yourself.');
    const target = await getUserById(sql, targetId);
    if (!target) throw new HttpError(404, 'Profile not found.');
    if (req.method === 'POST') {
      await sql`INSERT INTO mutes (muter_id, muted_id, scope) VALUES (${me.id}, ${targetId}, 'all') ON CONFLICT DO NOTHING`;
      await audit(sql, me.id, 'muted', String(targetId));
      res.status(200).json({ ok: true, muted: true });
      return;
    }
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'POST, DELETE');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    await sql`DELETE FROM mutes WHERE muter_id = ${me.id} AND muted_id = ${targetId}`;
    await audit(sql, me.id, 'unmuted', String(targetId));
    res.status(200).json({ ok: true, muted: false });
  } catch (err) {
    handleError(res, err);
  }
}
