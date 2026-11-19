// DROP — POST /api/profile/upload { kind: 'avatar' | 'cover', dataUrl, mime }
// Avatar / cover upload via Vercel Blob. The client sends a data URL
// (base64); the server validates MIME (jpeg/png/webp only), size
// (max 2 MB) and the actual decoded bytes before storing. The public
// Blob URL is saved on the user's row (avatar_url / cover_url).
// Binaries are NEVER stored in database rows.
// If BLOB_READ_WRITE_TOKEN is not set, this returns 503 with an honest
// message and the client falls back to the Google photo or initials
// avatar — uploads are never faked.

import { put } from '@vercel/blob';
import {
  requireAuth, handleError, HttpError, audit,
} from '../lib/profile.js';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export default async function handler(req: any, res: any): Promise<void> {
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
