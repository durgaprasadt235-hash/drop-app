// DROP — GET /api/profile/me/follow-requests
// Incoming pending follow requests for the authenticated user, with
// the requester's public identity. Also returns outgoing pending
// requests the user made, so the UI can show "Requested" state.

import { requireAuth, handleError } from '../../lib/profile.js';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const incoming = (await sql`
      SELECT fr.id, fr.requester_id, fr.created_at, u.username, u.display_name, u.avatar_url
      FROM follow_requests fr JOIN users u ON u.id = fr.requester_id
      WHERE fr.target_id = ${me.id} AND fr.status = 'pending'
      ORDER BY fr.created_at DESC`) as any[];
    const outgoing = (await sql`
      SELECT fr.id, fr.target_id, fr.created_at, u.username, u.display_name, u.avatar_url
      FROM follow_requests fr JOIN users u ON u.id = fr.target_id
      WHERE fr.requester_id = ${me.id} AND fr.status = 'pending'
      ORDER BY fr.created_at DESC`) as any[];
    res.status(200).json({
      ok: true,
      incoming: incoming.map((r) => ({ id: r.id, userId: r.requester_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url ?? null, createdAt: r.created_at })),
      outgoing: outgoing.map((r) => ({ id: r.id, userId: r.target_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url ?? null, createdAt: r.created_at })),
    });
  } catch (err) {
    handleError(res, err);
  }
}
