// DROP — GET /api/profile/me/privacy, PATCH /api/profile/me/privacy
// Privacy preferences are persisted server-side per user; every toggle
// here writes to privacy_preferences (and mirrors is_private onto
// users). Switching public -> private takes effect immediately.

import {
  requireAuth, handleError, HttpError, getPrivacy, savePrivacy, parsePrivacy, audit,
} from '../../lib/profile.js';

export default async function handler(req: any, res: any): Promise<void> {
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
