// DROP — GET /api/profile/me/blocks
// The authenticated user's blocked and muted accounts (for the
// Privacy & Security page). Only the owner of the lists sees them.

import { requireAuth, handleError } from '../../lib/profile.js';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const blocked = (await sql`
      SELECT u.id, u.username, u.display_name, u.avatar_url FROM blocks b
      JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ${me.id} ORDER BY u.display_name`) as any[];
    const muted = (await sql`
      SELECT u.id, u.username, u.display_name, u.avatar_url FROM mutes m
      JOIN users u ON u.id = m.muted_id WHERE m.muter_id = ${me.id} ORDER BY u.display_name`) as any[];
    const fmt = (rows: any[]) => rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url ?? null }));
    res.status(200).json({ ok: true, blocked: fmt(blocked), muted: fmt(muted) });
  } catch (err) {
    handleError(res, err);
  }
}
