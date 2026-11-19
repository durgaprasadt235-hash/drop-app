// DROP — GET /api/profile/me, PATCH /api/profile/me
// GET returns the authenticated user's full profile + privacy + counts.
// PATCH updates display_name, username (case-insensitive unique,
// reserved-name guard), bio (max 150), links (https only, max 5),
// location, birthday. Ownership is the session's user — a client
// cannot update anyone else's profile (403 on any other id).

import {
  requireAuth, handleError, HttpError, validateUsername, validateBio,
  validateLinks, getPrivacy, profileCounts, audit,
} from '../lib/profile.js';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    if (req.method === 'GET') {
      const [privacy, counts] = await Promise.all([getPrivacy(sql, me.id), profileCounts(sql, me.id)]);
      res.status(200).json({
        ok: true,
        profile: {
          id: me.id, username: me.username, displayName: me.display_name,
          avatarUrl: me.avatar_url ?? null, coverUrl: me.cover_url ?? null,
          bio: me.bio ?? '', links: me.links ?? [], location: me.location ?? null,
          birthday: me.birthday ?? null, email: me.email ?? null,
          isPrivate: Boolean(me.is_private), createdAt: me.created_at,
        },
        privacy, counts,
      });
      return;
    }
    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, PATCH');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (body.display_name !== undefined) {
      const name = String(body.display_name).trim();
      if (!name || name.length > 60) throw new HttpError(400, 'Display name must be 1–60 characters.');
      updates.display_name = name;
    }
    if (body.username !== undefined) {
      const err = validateUsername(String(body.username));
      if (err) throw new HttpError(400, err);
      const u = String(body.username).trim();
      if (u.toLowerCase() !== me.username.toLowerCase()) {
        const clash = (await sql`SELECT id FROM users WHERE LOWER(username) = ${u.toLowerCase()} AND id <> ${me.id}`) as any[];
        if (clash.length > 0) throw new HttpError(409, 'That username is already taken.');
        updates.username = u;
      }
    }
    if (body.bio !== undefined) {
      const err = validateBio(String(body.bio));
      if (err) throw new HttpError(400, err);
      updates.bio = String(body.bio);
    }
    if (body.links !== undefined) {
      const links = validateLinks(body.links);
      if (typeof links === 'string') throw new HttpError(400, links);
      updates.links = JSON.stringify(links);
    }
    if (body.location !== undefined) updates.location = String(body.location).slice(0, 80) || null;
    if (body.birthday !== undefined) {
      const b = String(body.birthday).trim();
      if (b && !/^\d{4}-\d{2}-\d{2}$/.test(b)) throw new HttpError(400, 'Birthday must be YYYY-MM-DD.');
      updates.birthday = b || null;
    }
    if (Object.keys(updates).length > 0) {
      // Build a safe, explicit UPDATE (no dynamic column interpolation
      // from untrusted input — keys come only from the allow-list above).
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (updates.display_name !== undefined) { sets.push('display_name'); vals.push(updates.display_name); }
      if (updates.username !== undefined) { sets.push('username'); vals.push(updates.username); }
      if (updates.bio !== undefined) { sets.push('bio'); vals.push(updates.bio); }
      if (updates.links !== undefined) { sets.push('links'); vals.push(updates.links); }
      if (updates.location !== undefined) { sets.push('location'); vals.push(updates.location); }
      if (updates.birthday !== undefined) { sets.push('birthday'); vals.push(updates.birthday); }
      // Parameterised per-column updates keep this injection-safe.
      for (let i = 0; i < sets.length; i++) {
        const col = sets[i];
        const val = vals[i];
        if (col === 'display_name') await sql`UPDATE users SET display_name = ${String(val)}, updated_at = NOW() WHERE id = ${me.id}`;
        if (col === 'username') await sql`UPDATE users SET username = ${String(val)}, updated_at = NOW() WHERE id = ${me.id}`;
        if (col === 'bio') await sql`UPDATE users SET bio = ${String(val)}, updated_at = NOW() WHERE id = ${me.id}`;
        if (col === 'links') await sql`UPDATE users SET links = ${String(val)}::jsonb, updated_at = NOW() WHERE id = ${me.id}`;
        if (col === 'location') await sql`UPDATE users SET location = ${val as string | null}, updated_at = NOW() WHERE id = ${me.id}`;
        if (col === 'birthday') await sql`UPDATE users SET birthday = ${val as string | null}, updated_at = NOW() WHERE id = ${me.id}`;
      }
      await audit(sql, me.id, 'profile_updated', Object.keys(updates).join(','));
    }
    const rows = (await sql`SELECT * FROM users WHERE id = ${me.id}`) as any[];
    const u = rows[0];
    res.status(200).json({
      ok: true,
      profile: {
        id: u.id, username: u.username, displayName: u.display_name,
        avatarUrl: u.avatar_url ?? null, coverUrl: u.cover_url ?? null,
        bio: u.bio ?? '', links: u.links ?? [], location: u.location ?? null,
        birthday: u.birthday ?? null, email: u.email ?? null,
        isPrivate: Boolean(u.is_private), createdAt: u.created_at,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
}
