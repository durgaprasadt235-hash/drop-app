// DROP — Clubroom identity.
// GET  /api/clubrooms/[id]/identity — identity options for this room,
//   my current identity, and the member list showing ONLY room-facing
//   identities (alias + avatar for pseudonymous members; main profile
//   for visible members). Internal account IDs / mappings are NEVER
//   returned to ordinary members.
// POST /api/clubrooms/[id]/identity { identityMode, alias } — join the
//   room with the chosen identity (validates alias, persists membership
//   + room_identities row; a second join updates the identity instead
//   of duplicating the membership).
// PATCH /api/clubrooms/[id]/identity { identityMode, alias } — change
//   my identity in a room I already joined.

import {
  requireAuth, handleError, HttpError, audit,
} from '../../lib/profile.js';

function roomId(req: any): number {
  return Number(req.query?.id);
}

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    const id = roomId(req);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid clubroom.');
    const rooms = (await sql`SELECT * FROM clubrooms WHERE id = ${id}`) as any[];
    if (rooms.length === 0) throw new HttpError(404, 'Clubroom not found.');
    const room = rooms[0];

    if (req.method === 'GET') {
      const mine = (await sql`SELECT * FROM room_identities WHERE user_id = ${me.id} AND clubroom_id = ${id}`) as any[];
      const members = (await sql`
        SELECT ri.identity_mode, ri.alias, ri.avatar_url,
               u.username, u.display_name, u.avatar_url AS profile_avatar
        FROM clubroom_members cm
        LEFT JOIN room_identities ri ON ri.user_id = cm.user_id AND ri.clubroom_id = cm.clubroom_id
        JOIN users u ON u.id = cm.user_id
        WHERE cm.clubroom_id = ${id}
        ORDER BY u.display_name`) as any[];
      // Room-facing identities only — no user_id, no email, no mapping.
      res.status(200).json({
        ok: true,
        room: { id: room.id, name: room.name },
        options: [
          { mode: 'drop', label: 'Use My DROP Profile', description: 'Join rooms with your main profile (visible name, photo and identity).' },
          { mode: 'room', label: 'Join with a Room Identity', description: 'Use a unique name and photo for specific rooms (your DROP profile stays hidden).' },
        ],
        myIdentity: mine.length > 0
          ? { mode: mine[0].identity_mode, alias: mine[0].alias ?? null, avatarUrl: mine[0].avatar_url ?? null }
          : null,
        member: ((await sql`SELECT 1 FROM clubroom_members WHERE clubroom_id = ${id} AND user_id = ${me.id} LIMIT 1`) as any[]).length > 0,
        members: members.map((m) => (m.identity_mode === 'room'
          ? { identityMode: 'room', displayName: m.alias ?? 'Room member', avatarUrl: m.avatar_url ?? null }
          : { identityMode: 'drop', displayName: m.display_name, username: m.username, avatarUrl: m.profile_avatar ?? null })),
      });
      return;
    }

    if (req.method !== 'POST' && req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, POST, PATCH');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const mode = req.body?.identityMode;
    if (mode !== 'drop' && mode !== 'room') throw new HttpError(400, 'identityMode must be drop or room.');
    let alias: string | null = null;
    if (mode === 'room') {
      alias = String(req.body?.alias ?? '').trim();
      if (!/^[a-zA-Z0-9_ ]{2,30}$/.test(alias)) throw new HttpError(400, 'Room alias must be 2–30 letters, numbers, spaces or underscores.');
    }
    const avatarUrl = typeof req.body?.avatarUrl === 'string' && /^https:\/\//.test(req.body.avatarUrl) ? req.body.avatarUrl : null;
    if (req.method === 'POST') {
      await sql`INSERT INTO clubroom_members (clubroom_id, user_id) VALUES (${id}, ${me.id}) ON CONFLICT DO NOTHING`;
    } else {
      const member = (await sql`SELECT 1 FROM clubroom_members WHERE clubroom_id = ${id} AND user_id = ${me.id} LIMIT 1`) as any[];
      if (member.length === 0) throw new HttpError(403, 'Join the clubroom first.');
    }
    await sql`
      INSERT INTO room_identities (user_id, clubroom_id, identity_mode, alias, avatar_url, updated_at)
      VALUES (${me.id}, ${id}, ${mode}, ${alias}, ${avatarUrl}, NOW())
      ON CONFLICT (user_id, clubroom_id) DO UPDATE SET
        identity_mode = EXCLUDED.identity_mode, alias = EXCLUDED.alias,
        avatar_url = EXCLUDED.avatar_url, updated_at = NOW()`;
    await audit(sql, me.id, req.method === 'POST' ? 'clubroom_joined' : 'room_identity_updated', `${id}:${mode}`);
    res.status(200).json({ ok: true, identity: { mode, alias, avatarUrl } });
  } catch (err) {
    handleError(res, err);
  }
}
