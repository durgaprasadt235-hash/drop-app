import {
  HttpError,
  audit,
  canMessage,
  canViewFullProfile,
  containsHiddenWord,
  containsHiddenWordExact,
  ensureProfileTables,
  getHiddenWords,
  getPrivacy,
  getSettings,
  getSql,
  getUserById,
  getUserByUsername,
  handleError,
  isBlocked,
  isFollowing,
  isRestricted,
  notify,
  parsePrivacy,
  parseSettings,
  pendingRequest,
  profileCounts,
  publicProfile,
  requireAuth,
  savePrivacy,
  saveSettings,
  validateBio,
  validateHiddenWord,
  validateLinks,
  validateUsername,
} from './profile.js';
import type { Sql } from './profile.js';
import { validateDbSession } from './db.js';
import { put } from '@vercel/blob';

// --- from api/profile/me.ts ---
export async function handleMe(req: any, res: any): Promise<void> {
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
          canMessage: true,
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

// --- from api/profile/[username].ts ---
export async function handlePublicProfile(req: any, res: any): Promise<void> {
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
    const canMsg = await canMessage(sql, viewerId, target as any);
    // Settings-driven extras (2026-11-19): presence + interaction prefs.
    // lastActiveAt is null when the target hides activity status, or
    // when the viewer is restricted by the target.
    const settings = await getSettings(sql, target.id);
    const targetPrivacy = await getPrivacy(sql, target.id);
    const viewerRestricted = viewerId !== null && viewerId !== target.id
      ? await isRestricted(sql, target.id, viewerId)
      : false;
    const lastActiveAt = targetPrivacy.activity_status && !viewerRestricted
      ? ((target as any).last_active_at ?? null)
      : null;
    res.status(200).json({
      ok: true,
      profile: {
        ...publicProfile(target as any, { full, counts, relationship, canMessage: canMsg }),
        lastActiveAt,
        interaction: {
          storyReplies: settings.storyReplies,
          whoCanComment: settings.whoCanComment,
          gifComments: settings.gifComments,
          allowStoryShares: settings.allowStoryShares,
        },
      },
    });
  } catch (err) {
    handleError(res, err);
  }
}

// --- from api/profile/follow.ts ---
export async function handleFollow(req: any, res: any): Promise<void> {
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

// --- from api/profile/block.ts ---
export async function handleBlock(req: any, res: any): Promise<void> {
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

// --- from api/profile/mute.ts ---
export async function handleMute(req: any, res: any): Promise<void> {
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

// --- from api/profile/lists.ts ---
export async function handleLists(req: any, res: any): Promise<void> {
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
    // Each row carries the viewer's relationship to that user, so the
    // Followers/Following sheet can show working Follow buttons.
    const users = await Promise.all(rows.map(async (r: any) => {
      let relationship: 'following' | 'requested' | 'none' | 'self' = 'none';
      if (r.id === me.id) relationship = 'self';
      else if (await isFollowing(sql, me.id, r.id)) relationship = 'following';
      else if (await pendingRequest(sql, me.id, r.id)) relationship = 'requested';
      return { id: r.id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url ?? null, relationship };
    }));
    res.status(200).json({ ok: true, users });
  } catch (err) {
    handleError(res, err);
  }
}

// --- from api/profile/upload.ts ---
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export async function handleUpload(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const token = process.env.BLOB_READ_WRITE_TOKEN ?? '';
    if (!token) throw new HttpError(503, 'Photo upload is not configured yet — storage needs to be connected (BLOB_READ_WRITE_TOKEN). Your Google photo or initials avatar is used instead.');
    const kind = req.body?.kind;
    if (kind !== 'avatar' && kind !== 'cover') throw new HttpError(400, 'kind must be avatar or cover.');
    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
    const mime = typeof req.body?.mime === 'string' ? req.body.mime : '';
    if (!ALLOWED[mime]) throw new HttpError(400, 'Only JPEG, PNG or WebP photos are allowed.');
    const match = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new HttpError(400, 'Invalid image data.');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new HttpError(400, 'Photo must be under 2 MB.');
    const blob = await put(`drop/${kind}/${me.id}-${Date.now()}.${ALLOWED[mime]}`, bytes, {
      access: 'public',
      contentType: mime,
      token,
    });
    if (kind === 'avatar') {
      await sql`UPDATE users SET avatar_url = ${blob.url}, updated_at = NOW() WHERE id = ${me.id}`;
    } else {
      await sql`UPDATE users SET cover_url = ${blob.url}, updated_at = NOW() WHERE id = ${me.id}`;
    }
    await audit(sql, me.id, kind === 'avatar' ? 'avatar_uploaded' : 'cover_uploaded');
    res.status(200).json({ ok: true, url: blob.url, kind });
  } catch (err) {
    handleError(res, err);
  }
}

// --- from api/profile/me/privacy.ts ---
export async function handlePrivacy(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    if (req.method === 'GET') {
      res.status(200).json({ ok: true, privacy: await getPrivacy(sql, me.id) });
      return;
    }
    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, PATCH');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const current = await getPrivacy(sql, me.id);
    const parsed = parsePrivacy(req.body ?? {}, current);
    if (typeof parsed === 'string') throw new HttpError(400, parsed);
    await savePrivacy(sql, me.id, parsed);
    await audit(sql, me.id, 'privacy_updated', JSON.stringify(parsed));
    res.status(200).json({ ok: true, privacy: parsed });
  } catch (err) {
    handleError(res, err);
  }
}

// --- from api/profile/me/blocks.ts ---
export async function handleBlocks(req: any, res: any): Promise<void> {
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

// --- from api/profile/me/follow-requests.ts ---
export async function handleFollowRequestsList(req: any, res: any): Promise<void> {
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

// --- from api/profile/follow-requests/[id].ts ---
export async function handleFollowRequestAnswer(req: any, res: any): Promise<void> {
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

// ------------------------------------------------- profile content --------
// Posts, Reels, Drops and Saved are the Profile tabs. Until this change
// they lived only in each device's localStorage: the server's posts
// table was never written, so server counts said 0 posts while the tabs
// showed local posts, and another user's (or another device's) content
// was invisible. These handlers make profile content server-backed:
// create/list/delete run against Neon, with the same private-profile
// and blocking rules as the profile itself.

/** Optional viewer identity (never trusted from a body/query id). */
async function optionalViewerId(sql: Sql, req: any): Promise<number | null> {
  const auth = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const viewer = await validateDbSession(sql, token);
  return viewer ? viewer.id : null;
}

function fmtPost(r: any): Record<string, unknown> {
  return {
    id: r.id, authorId: r.author_id, caption: r.caption ?? '',
    mediaUrl: r.media_url ?? null, filter: r.filter ?? 'original',
    effect: r.effect ?? 'none',
    extrasJson: typeof r.extras_json === 'string' ? r.extras_json : (r.extras_json ? JSON.stringify(r.extras_json) : null),
    fireCount: r.fire_count ?? 0, commentCount: r.comment_count ?? 0,
    createdAt: r.created_at,
  };
}

function fmtDrop(r: any, sealed: boolean): Record<string, unknown> {
  return {
    id: r.id, creatorId: r.creator_id, kind: r.kind, status: r.status,
    blastAt: r.blast_at,
    // A sealed Drop's caption/media are never returned before blast_at,
    // except to its creator (same rule as openDrop).
    caption: sealed ? null : (r.caption ?? null),
    mediaUrl: sealed ? null : (r.media_url ?? null),
    createdAt: r.created_at,
  };
}

/** Shared guard for the per-user content lists: target must exist, the
 *  viewer must be allowed to see the full profile, and a blocked viewer
 *  gets a 404 (never a hint the account exists). */
async function contentTarget(req: any): Promise<{ sql: Sql; viewerId: number | null; target: any }> {
  const sql = getSql();
  if (!sql) throw new HttpError(503, 'Shared database not configured.');
  await ensureProfileTables(sql);
  const targetId = Number(req.query?.userId);
  if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Invalid user.');
  const target = await getUserById(sql, targetId);
  if (!target) throw new HttpError(404, 'Profile not found.');
  const viewerId = await optionalViewerId(sql, req);
  if (viewerId !== null && viewerId !== targetId && (await isBlocked(sql, viewerId, targetId))) {
    throw new HttpError(404, 'Profile not found.');
  }
  if (!(await canViewFullProfile(sql, viewerId, target as any))) {
    throw new HttpError(403, 'This account is private.');
  }
  return { sql, viewerId, target };
}

// GET /api/profile/<id>/posts
export async function handleProfilePosts(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, target } = await contentTarget(req);
    const rows = (await sql`SELECT * FROM posts WHERE author_id = ${target.id} ORDER BY created_at DESC`) as any[];
    res.status(200).json({ ok: true, posts: rows.map(fmtPost) });
  } catch (err) {
    handleError(res, err);
  }
}

// GET /api/profile/<id>/reels
export async function handleProfileReels(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, target } = await contentTarget(req);
    const rows = (await sql`SELECT * FROM reels WHERE author_id = ${target.id} ORDER BY created_at DESC`) as any[];
    res.status(200).json({
      ok: true,
      reels: rows.map((r: any) => ({ id: r.id, authorId: r.author_id, mediaUrl: r.media_url, createdAt: r.created_at })),
    });
  } catch (err) {
    handleError(res, err);
  }
}

// GET /api/profile/<id>/drops
export async function handleProfileDrops(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, viewerId, target } = await contentTarget(req);
    const rows = (await sql`SELECT * FROM drops WHERE creator_id = ${target.id} ORDER BY created_at DESC`) as any[];
    const now = Date.now();
    res.status(200).json({
      ok: true,
      drops: rows.map((r: any) => fmtDrop(r, viewerId !== target.id && new Date(r.blast_at).getTime() > now)),
    });
  } catch (err) {
    handleError(res, err);
  }
}

function cleanShortString(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  if (s.length > max) throw new HttpError(400, `Value must be under ${max} characters.`);
  return s;
}

// POST /api/profile/posts
export async function handleCreatePost(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const body = req.body ?? {};
    const caption = String(body.caption ?? '').trim();
    if (!caption || caption.length > 2000) throw new HttpError(400, 'Caption must be 1–2000 characters.');
    const mediaUrl = cleanShortString(body.mediaUrl, 5000);
    const filter = cleanShortString(body.filter, 40) ?? 'original';
    const effect = cleanShortString(body.effect, 40) ?? 'none';
    let extrasJson: string | null = null;
    if (body.extrasJson !== undefined && body.extrasJson !== null) {
      const raw = typeof body.extrasJson === 'string' ? body.extrasJson : JSON.stringify(body.extrasJson);
      if (raw.length > 10000) throw new HttpError(400, 'Post extras are too large.');
      try { JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid post extras.'); }
      extrasJson = raw;
    }
    // Mentions (2026-11-19 Settings): a mentionUserId in extras is
    // checked against the mentioned user's stored who_can_mention.
    let mentionUserId: number | null = null;
    if (extrasJson) {
      try {
        const ex = JSON.parse(extrasJson);
        if (typeof ex?.mentionUserId === 'number' && Number.isInteger(ex.mentionUserId)) mentionUserId = ex.mentionUserId;
      } catch { /* already validated above */ }
    }
    let mentioned: any = null;
    if (mentionUserId !== null && mentionUserId !== me.id) {
      mentioned = await getUserById(sql, mentionUserId);
      if (mentioned) {
        const mp = await getPrivacy(sql, mentioned.id);
        if (mp.who_can_mention === 'nobody') throw new HttpError(400, 'This account does not allow mentions.');
        if (mp.who_can_mention === 'friends') {
          const [a, b] = await Promise.all([
            isFollowing(sql, me.id, mentioned.id),
            isFollowing(sql, mentioned.id, me.id),
          ]);
          if (!(a && b)) throw new HttpError(400, 'This account only allows mentions from friends.');
        }
      }
    }
    const rows = (await sql`
      INSERT INTO posts (author_id, caption, media_url, filter, effect, extras_json)
      VALUES (${me.id}, ${caption}, ${mediaUrl}, ${filter}, ${effect}, ${extrasJson ? extrasJson : null}::jsonb)
      RETURNING *`) as any[];
    if (mentioned) {
      await notify(sql, mentioned.id, 'mention', `${me.username} mentioned you in a post.`);
    }
    res.status(200).json({ ok: true, post: fmtPost(rows[0]) });
  } catch (err) {
    handleError(res, err);
  }
}

// DELETE /api/profile/posts?id=<postId>
export async function handleDeletePost(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'DELETE');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const id = Number(req.query?.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid post.');
    const rows = (await sql`SELECT * FROM posts WHERE id = ${id}`) as any[];
    if (rows.length === 0) throw new HttpError(404, 'Post not found.');
    if (rows[0].author_id !== me.id) throw new HttpError(403, 'Only the author can delete this post.');
    await sql`DELETE FROM post_saves WHERE post_id = ${id}`;
    await sql`DELETE FROM posts WHERE id = ${id}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/reels { mediaUrl }
export async function handleCreateReel(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const mediaUrl = String(req.body?.mediaUrl ?? '').trim();
    if (!mediaUrl || mediaUrl.length > 5000) throw new HttpError(400, 'A Reel needs media (under 5000 characters).');
    const rows = (await sql`INSERT INTO reels (author_id, media_url) VALUES (${me.id}, ${mediaUrl}) RETURNING *`) as any[];
    const r = rows[0];
    res.status(200).json({ ok: true, reel: { id: r.id, authorId: r.author_id, mediaUrl: r.media_url, createdAt: r.created_at } });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/drops { kind, blastAt, caption?, mediaUrl? }
export async function handleCreateDrop(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const body = req.body ?? {};
    const kind = body.kind === 'protected' ? 'protected' : body.kind === 'public' ? 'public' : null;
    if (!kind) throw new HttpError(400, 'kind must be public or protected.');
    const blastMs = Date.parse(String(body.blastAt ?? ''));
    if (Number.isNaN(blastMs)) throw new HttpError(400, 'blastAt must be a valid date.');
    const caption = cleanShortString(body.caption, 500);
    const mediaUrl = cleanShortString(body.mediaUrl, 5000);
    const status = blastMs <= Date.now() ? 'ready' : 'waiting';
    const rows = (await sql`
      INSERT INTO drops (creator_id, kind, status, blast_at, caption, media_url)
      VALUES (${me.id}, ${kind}, ${status}, ${new Date(blastMs).toISOString()}, ${caption}, ${mediaUrl})
      RETURNING *`) as any[];
    const r = rows[0];
    res.status(200).json({ ok: true, drop: fmtDrop(r, false) });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/drops/open { dropId }
export async function handleOpenDrop(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const dropId = Number(req.body?.dropId);
    if (!Number.isInteger(dropId) || dropId <= 0) throw new HttpError(400, 'Invalid Drop.');
    const rows = (await sql`SELECT * FROM drops WHERE id = ${dropId}`) as any[];
    if (rows.length === 0) throw new HttpError(404, 'Drop not found.');
    const d = rows[0];
    if (new Date(d.blast_at).getTime() > Date.now() && d.creator_id !== me.id) {
      throw new HttpError(403, 'This Drop has not blasted yet.');
    }
    await sql`UPDATE drops SET status = 'revealed' WHERE id = ${dropId}`;
    await sql`INSERT INTO drop_opens (drop_id, user_id) VALUES (${dropId}, ${me.id}) ON CONFLICT DO NOTHING`;
    const updated = (await sql`SELECT * FROM drops WHERE id = ${dropId}`) as any[];
    res.status(200).json({ ok: true, drop: fmtDrop(updated[0], false) });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/save { postId } — toggles the save, returns { saved }
export async function handleSaveToggle(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const postId = Number(req.body?.postId);
    if (!Number.isInteger(postId) || postId <= 0) throw new HttpError(400, 'Invalid post.');
    const rows = (await sql`SELECT * FROM posts WHERE id = ${postId}`) as any[];
    if (rows.length === 0) throw new HttpError(404, 'Post not found.');
    const author = await getUserById(sql, rows[0].author_id);
    if (author && !(await canViewFullProfile(sql, me.id, author as any))) {
      throw new HttpError(403, 'This account is private.');
    }
    const existing = (await sql`SELECT 1 FROM post_saves WHERE user_id = ${me.id} AND post_id = ${postId} LIMIT 1`) as any[];
    if (existing.length > 0) {
      await sql`DELETE FROM post_saves WHERE user_id = ${me.id} AND post_id = ${postId}`;
      res.status(200).json({ ok: true, saved: false });
      return;
    }
    await sql`INSERT INTO post_saves (user_id, post_id) VALUES (${me.id}, ${postId}) ON CONFLICT DO NOTHING`;
    res.status(200).json({ ok: true, saved: true });
  } catch (err) {
    handleError(res, err);
  }
}

// GET /api/profile/me/saved
export async function handleSaved(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const rows = (await sql`
      SELECT p.* FROM post_saves s JOIN posts p ON p.id = s.post_id
      WHERE s.user_id = ${me.id} ORDER BY p.created_at DESC`) as any[];
    res.status(200).json({ ok: true, posts: rows.map(fmtPost) });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/report { targetId, reason } — stored server-side for
// moderation. The old client wrote a notification into the target's
// local store, which did nothing on any other device.
export async function handleReport(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const targetId = Number(req.body?.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Invalid target.');
    if (targetId === me.id) throw new HttpError(400, 'You cannot report yourself.');
    const target = await getUserById(sql, targetId);
    if (!target) throw new HttpError(404, 'Profile not found.');
    const reason = String(req.body?.reason ?? 'Inappropriate content').slice(0, 500);
    await sql`INSERT INTO reports (reporter_id, target_id, reason) VALUES (${me.id}, ${targetId}, ${reason})`;
    await audit(sql, me.id, 'reported', String(targetId));
    res.status(200).json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/conversations { targetId } — find or create a 1:1 DM
// conversation. The target's stored who_can_message is enforced here,
// server-side (the old client never checked it, and no code path in the
// app ever created a conversation at all — the Message button led to an
// empty inbox). Blocked either way is rejected.
// Settings (2026-11-19): when the target only accepts messages from
// friends, a non-friend gets a message request instead (200, NOT an
// error); 'nobody' is still a 403. A request body matching one of the
// recipient's hidden words is stored as status 'hidden' and not notified.

/** Find the 1:1 conversation between a and b, or create it. */
async function findOrCreateConversation(sql: Sql, a: number, b: number): Promise<number> {
  const existing = (await sql`
    SELECT c.id FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ${a}
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ${b}
    WHERE NOT EXISTS (
      SELECT 1 FROM conversation_members m3
      WHERE m3.conversation_id = c.id AND m3.user_id NOT IN (${a}, ${b})
    )
    LIMIT 1`) as any[];
  if (existing.length > 0) return existing[0].id as number;
  const created = (await sql`INSERT INTO conversations DEFAULT VALUES RETURNING id`) as any[];
  const convId = created[0].id as number;
  await sql`INSERT INTO conversation_members (conversation_id, user_id) VALUES (${convId}, ${a}), (${convId}, ${b}) ON CONFLICT DO NOTHING`;
  return convId;
}

export async function handleCreateConversation(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const targetId = Number(req.body?.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Invalid target.');
    if (targetId === me.id) throw new HttpError(400, 'You cannot message yourself.');
    const target = await getUserById(sql, targetId);
    if (!target) throw new HttpError(404, 'Profile not found.');
    if (await isBlocked(sql, me.id, targetId)) throw new HttpError(403, 'You cannot message this account.');
    // A conversation that already exists can always be reopened.
    const already = (await sql`
      SELECT c.id FROM conversations c
      JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ${me.id}
      JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ${targetId}
      WHERE NOT EXISTS (
        SELECT 1 FROM conversation_members m3
        WHERE m3.conversation_id = c.id AND m3.user_id NOT IN (${me.id}, ${targetId})
      )
      LIMIT 1`) as any[];
    if (already.length > 0) {
      res.status(200).json({ ok: true, conversationId: already[0].id });
      return;
    }
    if (!(await canMessage(sql, me.id, target as any))) {
      const prefs = await getPrivacy(sql, targetId);
      if (prefs.who_can_message === 'nobody') {
        throw new HttpError(403, 'This account does not accept messages.');
      }
      // 'friends': file a message request instead of an error.
      const body = req.body?.body === undefined || req.body?.body === null ? null : String(req.body.body);
      if (body !== null && body.length > 500) throw new HttpError(400, 'Message request must be 500 characters or fewer.');
      const pending = (await sql`SELECT * FROM message_requests WHERE sender_id = ${me.id} AND recipient_id = ${targetId} AND status = 'pending'`) as any[];
      if (pending.length > 0) {
        res.status(200).json({ ok: true, status: 'requested', requestId: pending[0].id });
        return;
      }
      const hidden = body !== null && containsHiddenWordExact(body, await getHiddenWords(sql, targetId));
      const created = (await sql`
        INSERT INTO message_requests (sender_id, recipient_id, body, status)
        VALUES (${me.id}, ${targetId}, ${body}, ${hidden ? 'hidden' : 'pending'})
        RETURNING *`) as any[];
      await audit(sql, me.id, 'message_requested', String(targetId));
      if (!hidden) {
        await notify(sql, targetId, 'message', `${me.username} sent you a message request.`);
      }
      res.status(200).json({ ok: true, status: 'requested', requestId: created[0].id });
      return;
    }
    const convId = await findOrCreateConversation(sql, me.id, targetId);
    res.status(200).json({ ok: true, conversationId: convId });
  } catch (err) {
    handleError(res, err);
  }
}

// ------------------------------------------------------- DROP Settings ----
// All routes below are Settings (2026-11-19), inside this same router.
// Fail-closed: requireAuth gives 503 (no DB) / 401 (no/invalid Bearer);
// invalid input is 400; block precedence is checked before any other
// setting on every add.

function fmtBrief(r: any): Record<string, unknown> {
  return { id: r.id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url ?? null };
}

// GET/PATCH /api/profile/me/settings
export async function handleSettings(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    if (req.method === 'GET') {
      res.status(200).json({ ok: true, settings: await getSettings(sql, me.id) });
      return;
    }
    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, PATCH');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const current = await getSettings(sql, me.id);
    const parsed = parseSettings(req.body ?? {}, current);
    if (typeof parsed === 'string') throw new HttpError(400, parsed);
    await saveSettings(sql, me.id, parsed);
    await audit(sql, me.id, 'settings_updated', JSON.stringify(parsed));
    res.status(200).json({ ok: true, settings: parsed });
  } catch (err) {
    handleError(res, err);
  }
}

// GET/POST/DELETE /api/profile/me/<list> — close-friends,
// hide-story-from, restricted. GET lists brief user rows; POST
// {userId} adds; DELETE ?userId= removes. Self-add → 400, unknown
// target → 404, blocked either way → 403 on add.
// NOTE: table/column names are literal in each handler — Neon tagged
// templates bind ${...} values as parameters, which cannot stand in
// for identifiers, so the three lists do not share one dynamic query.

async function relationTarget(sql: Sql, me: any, targetId: number, checkBlocked: boolean): Promise<any> {
  if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Invalid user.');
  if (targetId === me.id) throw new HttpError(400, 'You cannot add yourself to this list.');
  const target = await getUserById(sql, targetId);
  if (!target) throw new HttpError(404, 'Profile not found.');
  if (checkBlocked && (await isBlocked(sql, me.id, targetId))) {
    throw new HttpError(403, 'You cannot add this account.');
  }
  return target;
}

export async function handleCloseFriends(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    if (req.method === 'GET') {
      const rows = (await sql`
        SELECT u.id, u.username, u.display_name, u.avatar_url FROM close_friends t
        JOIN users u ON u.id = t.friend_id
        WHERE t.user_id = ${me.id} ORDER BY u.display_name`) as any[];
      res.status(200).json({ ok: true, users: rows.map(fmtBrief) });
      return;
    }
    if (req.method === 'POST') {
      const target = await relationTarget(sql, me, Number(req.body?.userId), true);
      await sql`INSERT INTO close_friends (user_id, friend_id) VALUES (${me.id}, ${target.id}) ON CONFLICT DO NOTHING`;
      await audit(sql, me.id, 'close_friend_added', String(target.id));
      res.status(200).json({ ok: true, user: fmtBrief(target as any) });
      return;
    }
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const target = await relationTarget(sql, me, Number(req.query?.userId), false);
    await sql`DELETE FROM close_friends WHERE user_id = ${me.id} AND friend_id = ${target.id}`;
    await audit(sql, me.id, 'close_friend_removed', String(target.id));
    res.status(200).json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
}

export async function handleHideStoryFrom(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    if (req.method === 'GET') {
      const rows = (await sql`
        SELECT u.id, u.username, u.display_name, u.avatar_url FROM story_hidden_from t
        JOIN users u ON u.id = t.hidden_id
        WHERE t.user_id = ${me.id} ORDER BY u.display_name`) as any[];
      res.status(200).json({ ok: true, users: rows.map(fmtBrief) });
      return;
    }
    if (req.method === 'POST') {
      const target = await relationTarget(sql, me, Number(req.body?.userId), true);
      await sql`INSERT INTO story_hidden_from (user_id, hidden_id) VALUES (${me.id}, ${target.id}) ON CONFLICT DO NOTHING`;
      await audit(sql, me.id, 'story_hidden_added', String(target.id));
      res.status(200).json({ ok: true, user: fmtBrief(target as any) });
      return;
    }
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const target = await relationTarget(sql, me, Number(req.query?.userId), false);
    await sql`DELETE FROM story_hidden_from WHERE user_id = ${me.id} AND hidden_id = ${target.id}`;
    await audit(sql, me.id, 'story_hidden_removed', String(target.id));
    res.status(200).json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
}

export async function handleRestricted(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    if (req.method === 'GET') {
      const rows = (await sql`
        SELECT u.id, u.username, u.display_name, u.avatar_url FROM restricted_accounts t
        JOIN users u ON u.id = t.restricted_id
        WHERE t.restrictor_id = ${me.id} ORDER BY u.display_name`) as any[];
      res.status(200).json({ ok: true, users: rows.map(fmtBrief) });
      return;
    }
    if (req.method === 'POST') {
      const target = await relationTarget(sql, me, Number(req.body?.userId), true);
      await sql`INSERT INTO restricted_accounts (restrictor_id, restricted_id) VALUES (${me.id}, ${target.id}) ON CONFLICT DO NOTHING`;
      await audit(sql, me.id, 'restricted_added', String(target.id));
      res.status(200).json({ ok: true, user: fmtBrief(target as any) });
      return;
    }
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const target = await relationTarget(sql, me, Number(req.query?.userId), false);
    await sql`DELETE FROM restricted_accounts WHERE restrictor_id = ${me.id} AND restricted_id = ${target.id}`;
    await audit(sql, me.id, 'restricted_removed', String(target.id));
    res.status(200).json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
}

// GET /api/profile/me/muted — mute/unmute stay on the existing /mute route.
export async function handleMutedList(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const rows = (await sql`
      SELECT u.id, u.username, u.display_name, u.avatar_url FROM mutes m
      JOIN users u ON u.id = m.muted_id WHERE m.muter_id = ${me.id} ORDER BY u.display_name`) as any[];
    res.status(200).json({ ok: true, users: rows.map(fmtBrief) });
  } catch (err) {
    handleError(res, err);
  }
}

// GET/POST/DELETE /api/profile/me/hidden-words — max 100 words per user.
export async function handleHiddenWords(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    if (req.method === 'GET') {
      res.status(200).json({ ok: true, words: await getHiddenWords(sql, me.id) });
      return;
    }
    if (req.method === 'POST') {
      const checked = validateHiddenWord(req.body?.word);
      if (!checked.ok) throw new HttpError(400, checked.error);
      const existing = await getHiddenWords(sql, me.id);
      if (!existing.includes(checked.word) && existing.length >= 100) {
        throw new HttpError(400, 'You can hide up to 100 words.');
      }
      await sql`INSERT INTO hidden_words (user_id, word) VALUES (${me.id}, ${checked.word}) ON CONFLICT DO NOTHING`;
      await audit(sql, me.id, 'hidden_word_added', checked.word);
      res.status(200).json({ ok: true, words: await getHiddenWords(sql, me.id) });
      return;
    }
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const checked = validateHiddenWord(req.query?.word);
    if (!checked.ok) throw new HttpError(400, checked.error);
    await sql`DELETE FROM hidden_words WHERE user_id = ${me.id} AND word = ${checked.word}`;
    await audit(sql, me.id, 'hidden_word_removed', checked.word);
    res.status(200).json({ ok: true, words: await getHiddenWords(sql, me.id) });
  } catch (err) {
    handleError(res, err);
  }
}

// GET /api/profile/me/notifications — newest first, limit 100.
export async function handleNotificationsList(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const rows = (await sql`
      SELECT id, type, body, read, created_at FROM notifications
      WHERE user_id = ${me.id} ORDER BY created_at DESC LIMIT 100`) as any[];
    res.status(200).json({
      ok: true,
      notifications: rows.map((r: any) => ({
        id: r.id, type: r.type, body: r.body, read: Boolean(r.read), createdAt: r.created_at,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/me/notifications/read {id?} — one, or all when omitted.
export async function handleNotificationsRead(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const id = req.body?.id === undefined || req.body?.id === null ? null : Number(req.body.id);
    if (id !== null && (!Number.isInteger(id) || id <= 0)) throw new HttpError(400, 'Invalid notification.');
    if (id === null) {
      await sql`UPDATE notifications SET read = TRUE WHERE user_id = ${me.id}`;
    } else {
      await sql`UPDATE notifications SET read = TRUE WHERE user_id = ${me.id} AND id = ${id}`;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
}

function fmtArchive(r: any): Record<string, unknown> {
  return {
    id: r.id, userId: r.user_id, mediaUrl: r.media_url ?? null,
    filter: r.filter ?? 'original', effect: r.effect ?? 'none',
    extrasJson: typeof r.extras_json === 'string' ? r.extras_json : (r.extras_json ? JSON.stringify(r.extras_json) : null),
    originalCreatedAt: r.original_created_at ?? null, archivedAt: r.archived_at,
  };
}

// POST/GET/DELETE /api/profile/me/archive
export async function handleArchive(req: any, res: any): Promise<void> {
  try {
    const { sql, me } = await requireAuth(req);
    if (req.method === 'GET') {
      const rows = (await sql`SELECT * FROM story_archive WHERE user_id = ${me.id} ORDER BY archived_at DESC`) as any[];
      res.status(200).json({ ok: true, archive: rows.map(fmtArchive) });
      return;
    }
    if (req.method === 'POST') {
      const body = req.body ?? {};
      const mediaUrl = cleanShortString(body.mediaUrl, 5000);
      const filter = cleanShortString(body.filter, 40) ?? 'original';
      const effect = cleanShortString(body.effect, 40) ?? 'none';
      let extrasJson: string | null = null;
      if (body.extrasJson !== undefined && body.extrasJson !== null) {
        const raw = typeof body.extrasJson === 'string' ? body.extrasJson : JSON.stringify(body.extrasJson);
        if (raw.length > 10000) throw new HttpError(400, 'Archive extras are too large.');
        try { JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid archive extras.'); }
        extrasJson = raw;
      }
      let originalCreatedAt: string | null = null;
      if (body.originalCreatedAt !== undefined && body.originalCreatedAt !== null) {
        const ms = Date.parse(String(body.originalCreatedAt));
        if (Number.isNaN(ms)) throw new HttpError(400, 'originalCreatedAt must be a valid date.');
        originalCreatedAt = new Date(ms).toISOString();
      }
      const rows = (await sql`
        INSERT INTO story_archive (user_id, media_url, filter, effect, extras_json, original_created_at)
        VALUES (${me.id}, ${mediaUrl}, ${filter}, ${effect}, ${extrasJson ? extrasJson : null}::jsonb, ${originalCreatedAt})
        RETURNING *`) as any[];
      await audit(sql, me.id, 'archive_created', String(rows[0].id));
      res.status(200).json({ ok: true, archived: fmtArchive(rows[0]) });
      return;
    }
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const id = Number(req.query?.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid archived story.');
    const rows = (await sql`SELECT * FROM story_archive WHERE id = ${id} AND user_id = ${me.id}`) as any[];
    if (rows.length === 0) throw new HttpError(404, 'Archived story not found.');
    await sql`DELETE FROM story_archive WHERE id = ${id} AND user_id = ${me.id}`;
    await audit(sql, me.id, 'archive_deleted', String(id));
    res.status(200).json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
}

// GET /api/profile/me/apps — Google sign-in only, from real records.
// auth_identities is consulted first; the Google sign-in flow stores
// google_sub on the user row (api/auth/google.ts never writes
// auth_identities), so a user with google_sub / auth_method 'google'
// is real evidence of a Google connection — never an invented app.
export async function handleApps(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const identities = (await sql`SELECT * FROM auth_identities WHERE user_id = ${me.id}`) as any[];
    const apps: Record<string, unknown>[] = [];
    const googleIdentity = identities.find((r: any) => r.provider === 'google');
    if (googleIdentity || (me as any).google_sub || (me as any).auth_method === 'google') {
      apps.push({
        provider: 'google',
        name: 'Google sign-in',
        email: googleIdentity?.email ?? (me as any).email ?? null,
        connectedAt: (me as any).created_at ?? null,
      });
    }
    res.status(200).json({ ok: true, apps });
  } catch (err) {
    handleError(res, err);
  }
}

// GET /api/profile/me/status — real standing from the reports table.
// No fake violations: 'review' only when reports exist against the user.
export async function handleStatus(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const rows = (await sql`SELECT COUNT(*)::int AS c FROM reports WHERE target_id = ${me.id}`) as any[];
    const reportsAgainstMe = rows[0]?.c ?? 0;
    res.status(200).json({
      ok: true,
      status: {
        createdAt: (me as any).created_at,
        isPrivate: Boolean((me as any).is_private),
        reportsAgainstMe,
        standing: reportsAgainstMe > 0 ? 'review' : 'good',
        note: reportsAgainstMe > 0
          ? 'Your account has been reported. No actions have been taken on your account yet.'
          : 'No actions have been taken on your account.',
      },
    });
  } catch (err) {
    handleError(res, err);
  }
}

// GET /api/profile/me/message-requests — pending incoming + outgoing,
// plus hidden incoming (status 'hidden') under `hidden`.
export async function handleMessageRequestsList(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const incoming = (await sql`
      SELECT mr.id, mr.sender_id, mr.body, mr.created_at, u.username, u.display_name, u.avatar_url
      FROM message_requests mr JOIN users u ON u.id = mr.sender_id
      WHERE mr.recipient_id = ${me.id} AND mr.status = 'pending' ORDER BY mr.created_at DESC`) as any[];
    const hidden = (await sql`
      SELECT mr.id, mr.sender_id, mr.body, mr.created_at, u.username, u.display_name, u.avatar_url
      FROM message_requests mr JOIN users u ON u.id = mr.sender_id
      WHERE mr.recipient_id = ${me.id} AND mr.status = 'hidden' ORDER BY mr.created_at DESC`) as any[];
    const outgoing = (await sql`
      SELECT mr.id, mr.recipient_id, mr.body, mr.created_at, u.username, u.display_name, u.avatar_url
      FROM message_requests mr JOIN users u ON u.id = mr.recipient_id
      WHERE mr.sender_id = ${me.id} AND mr.status = 'pending' ORDER BY mr.created_at DESC`) as any[];
    res.status(200).json({
      ok: true,
      incoming: incoming.map((r: any) => ({
        id: r.id, senderId: r.sender_id, senderUsername: r.username,
        senderDisplayName: r.display_name, senderAvatarUrl: r.avatar_url ?? null,
        body: r.body ?? null, createdAt: r.created_at,
      })),
      outgoing: outgoing.map((r: any) => ({
        id: r.id, recipientId: r.recipient_id, recipientUsername: r.username,
        recipientDisplayName: r.display_name, recipientAvatarUrl: r.avatar_url ?? null,
        body: r.body ?? null, createdAt: r.created_at,
      })),
      hidden: hidden.map((r: any) => ({
        id: r.id, senderId: r.sender_id, senderUsername: r.username,
        senderDisplayName: r.display_name, senderAvatarUrl: r.avatar_url ?? null,
        body: r.body ?? null, createdAt: r.created_at,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/me/message-requests/<id> {accept:boolean}
export async function handleMessageRequestAnswer(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const id = Number(req.query?.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid request.');
    const rows = (await sql`SELECT * FROM message_requests WHERE id = ${id}`) as any[];
    if (rows.length === 0) throw new HttpError(404, 'Message request not found.');
    const mr = rows[0];
    if (mr.recipient_id !== me.id) throw new HttpError(403, 'Only the person who received this request can answer it.');
    if (mr.status !== 'pending') throw new HttpError(409, `This request is already ${mr.status}.`);
    const accept = req.body?.accept === true;
    if (accept) {
      const convId = await findOrCreateConversation(sql, me.id, mr.sender_id);
      await sql`UPDATE message_requests SET status = 'accepted', conversation_id = ${convId}, updated_at = NOW() WHERE id = ${id}`;
      await notify(sql, mr.sender_id, 'message', `${me.username} accepted your message request.`);
      await audit(sql, me.id, 'message_request_accepted', String(id));
      res.status(200).json({ ok: true, status: 'accepted', conversationId: convId });
    } else {
      await sql`UPDATE message_requests SET status = 'declined', updated_at = NOW() WHERE id = ${id}`;
      await audit(sql, me.id, 'message_request_declined', String(id));
      res.status(200).json({ ok: true, status: 'declined' });
    }
  } catch (err) {
    handleError(res, err);
  }
}

// ------------------------------------------------------------ comments ----
// GET/POST /api/profile/posts/<id>/comments — server-backed comments.
// Guards: post must exist (404); blocked viewer → 404; private author +
// viewer not allowed → 403. POST additionally enforces the author's
// who_can_comment and hidden words.

function fmtComment(r: any, author: any): Record<string, unknown> {
  return {
    id: r.id, postId: r.post_id, authorId: r.author_id,
    authorUsername: author?.username ?? null,
    authorDisplayName: author?.display_name ?? null,
    authorAvatarUrl: author?.avatar_url ?? null,
    body: r.body, createdAt: r.created_at,
  };
}

async function commentPostGuard(sql: Sql, viewerId: number | null, postId: number): Promise<any> {
  const rows = (await sql`SELECT * FROM posts WHERE id = ${postId}`) as any[];
  if (rows.length === 0) throw new HttpError(404, 'Post not found.');
  const post = rows[0];
  const author = await getUserById(sql, post.author_id);
  if (!author) throw new HttpError(404, 'Post not found.');
  if (viewerId !== null && viewerId !== author.id && (await isBlocked(sql, viewerId, author.id))) {
    throw new HttpError(404, 'Post not found.');
  }
  if (!(await canViewFullProfile(sql, viewerId, author as any))) {
    throw new HttpError(403, 'This account is private.');
  }
  return { post, author };
}

export async function handlePostComments(req: any, res: any): Promise<void> {
  try {
    const postId = Number(req.query?.postId);
    if (!Number.isInteger(postId) || postId <= 0) throw new HttpError(400, 'Invalid post.');
    if (req.method === 'GET') {
      const sql = getSql();
      if (!sql) throw new HttpError(503, 'Shared database not configured.');
      await ensureProfileTables(sql);
      const viewerId = await optionalViewerId(sql, req);
      const { post, author } = await commentPostGuard(sql, viewerId, postId);
      const rows = (await sql`SELECT * FROM post_comments WHERE post_id = ${postId} ORDER BY created_at ASC`) as any[];
      const viewerWords = viewerId !== null ? await getHiddenWords(sql, viewerId) : [];
      const out: Record<string, unknown>[] = [];
      for (const r of rows) {
        // Comments by users the author restricted are visible only to
        // the author and the commenter.
        if (r.author_id !== author.id && viewerId !== author.id && viewerId !== r.author_id
          && (await isRestricted(sql, author.id, r.author_id))) {
          continue;
        }
        // Comments containing any of the VIEWER's hidden words are
        // excluded from the viewer's list.
        if (viewerWords.length > 0 && containsHiddenWord(String(r.body ?? ''), viewerWords)) continue;
        const commentAuthor = r.author_id === author.id ? author : await getUserById(sql, r.author_id);
        out.push(fmtComment(r, commentAuthor));
      }
      res.status(200).json({ ok: true, comments: out });
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const { post, author } = await commentPostGuard(sql, me.id, postId);
    const settings = await getSettings(sql, author.id);
    if (settings.whoCanComment === 'off') throw new HttpError(403, 'Comments are turned off for this post.');
    if (settings.whoCanComment === 'followers' && !(await isFollowing(sql, me.id, author.id)) && me.id !== author.id) {
      throw new HttpError(403, 'Only followers can comment on this post.');
    }
    if (settings.whoCanComment === 'mutual' && me.id !== author.id) {
      const [a, b] = await Promise.all([
        isFollowing(sql, me.id, author.id),
        isFollowing(sql, author.id, me.id),
      ]);
      if (!(a && b)) throw new HttpError(403, 'Only mutual friends can comment on this post.');
    }
    const body = String(req.body?.body ?? '').trim();
    if (!body || body.length > 500) throw new HttpError(400, 'Comment must be 1–500 characters.');
    const authorWords = await getHiddenWords(sql, author.id);
    if (authorWords.length > 0 && containsHiddenWord(body, authorWords)) {
      throw new HttpError(400, 'Your comment contains a word the author has chosen to hide.');
    }
    const created = (await sql`
      INSERT INTO post_comments (post_id, author_id, body)
      VALUES (${postId}, ${me.id}, ${body}) RETURNING *`) as any[];
    await sql`UPDATE posts SET comment_count = comment_count + 1 WHERE id = ${postId}`;
    if (author.id !== me.id) {
      await notify(sql, author.id, 'comment', `${me.username} commented on your post.`);
    }
    const commentAuthor = await getUserById(sql, me.id);
    res.status(200).json({ ok: true, comment: fmtComment(created[0], commentAuthor) });
  } catch (err) {
    handleError(res, err);
  }
}

// ---------------------------------------------------------------- slash ---
// POST /api/profile/slash-invitations {conversationId, inviteeId}
export async function handleSlashCreate(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const conversationId = Number(req.body?.conversationId);
    const inviteeId = Number(req.body?.inviteeId);
    if (!Number.isInteger(conversationId) || conversationId <= 0) throw new HttpError(400, 'Invalid conversation.');
    if (!Number.isInteger(inviteeId) || inviteeId <= 0) throw new HttpError(400, 'Invalid invitee.');
    if (inviteeId === me.id) throw new HttpError(400, 'You cannot invite yourself.');
    const invitee = await getUserById(sql, inviteeId);
    if (!invitee) throw new HttpError(404, 'Profile not found.');
    const member = (await sql`SELECT 1 FROM conversation_members WHERE conversation_id = ${conversationId} AND user_id = ${me.id} LIMIT 1`) as any[];
    if (member.length === 0) throw new HttpError(403, 'You are not a member of this conversation.');
    if (await isBlocked(sql, me.id, inviteeId)) throw new HttpError(403, 'You cannot invite this account.');
    const prefs = await getPrivacy(sql, inviteeId);
    if (prefs.who_can_slash === 'nobody') throw new HttpError(403, 'This account does not accept Slash invitations.');
    if (prefs.who_can_slash === 'friends') {
      const [a, b] = await Promise.all([
        isFollowing(sql, me.id, inviteeId),
        isFollowing(sql, inviteeId, me.id),
      ]);
      if (!(a && b)) throw new HttpError(403, 'This account only accepts Slash invitations from friends.');
    }
    const created = (await sql`
      INSERT INTO slash_invitations (conversation_id, inviter_id, invitee_id, status)
      VALUES (${conversationId}, ${me.id}, ${inviteeId}, 'pending') RETURNING *`) as any[];
    await notify(sql, inviteeId, 'slash', `${me.username} invited you to a Slash conversation.`);
    res.status(200).json({ ok: true, invitationId: created[0].id });
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/slash-invitations/<id> {accept:boolean}
export async function handleSlashAnswer(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const id = Number(req.query?.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid invitation.');
    const rows = (await sql`SELECT * FROM slash_invitations WHERE id = ${id}`) as any[];
    if (rows.length === 0) throw new HttpError(404, 'Slash invitation not found.');
    const inv = rows[0];
    if (inv.invitee_id !== me.id) throw new HttpError(403, 'Only the invited person can answer this invitation.');
    if (inv.status !== 'pending') throw new HttpError(409, `This invitation is already ${inv.status}.`);
    const accept = req.body?.accept === true;
    if (accept) {
      await sql`INSERT INTO conversation_members (conversation_id, user_id) VALUES (${inv.conversation_id}, ${me.id}) ON CONFLICT DO NOTHING`;
      await sql`UPDATE slash_invitations SET status = 'accepted' WHERE id = ${id}`;
      res.status(200).json({ ok: true, status: 'accepted' });
    } else {
      await sql`UPDATE slash_invitations SET status = 'declined' WHERE id = ${id}`;
      res.status(200).json({ ok: true, status: 'declined' });
    }
  } catch (err) {
    handleError(res, err);
  }
}

// POST /api/profile/slash-leave {conversationId}
export async function handleSlashLeave(req: any, res: any): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }
    const { sql, me } = await requireAuth(req);
    const conversationId = Number(req.body?.conversationId);
    if (!Number.isInteger(conversationId) || conversationId <= 0) throw new HttpError(400, 'Invalid conversation.');
    const member = (await sql`SELECT 1 FROM conversation_members WHERE conversation_id = ${conversationId} AND user_id = ${me.id} LIMIT 1`) as any[];
    if (member.length === 0) throw new HttpError(403, 'You are not a member of this conversation.');
    await sql`DELETE FROM conversation_members WHERE conversation_id = ${conversationId} AND user_id = ${me.id}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
}
