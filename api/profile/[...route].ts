// DROP — Single Serverless Function for ALL /api/profile/* routes.
// Vercel's Hobby plan allows at most 12 Serverless Functions per
// deployment; Page 04 originally shipped 11 profile endpoints as
// separate files (15 functions total with auth/admin/clubrooms), which
// failed the deploy. All profile routes now live behind this one
// catch-all function: /api/profile/[...route]. The handler logic is
// unchanged — it lives verbatim in api/lib/profile-handlers.ts (a
// helper file, not a function). Route paths, methods, status codes,
// validation and response shapes are exactly as before, so the client
// (src/lib/api.ts) needs no changes.
// Vercel serves api/ functions before vercel.json rewrites, so the
// SPA fallback (/(.*) -> /index.html) does not swallow these routes.

import {
  handleMe,
  handlePublicProfile,
  handleFollow,
  handleBlock,
  handleMute,
  handleLists,
  handleUpload,
  handlePrivacy,
  handleBlocks,
  handleFollowRequestsList,
  handleFollowRequestAnswer,
} from '../lib/profile-handlers.js';

export default async function handler(req: any, res: any): Promise<void> {
  // Vercel passes [...route] as an array in req.query.route; tolerate a
  // plain string too (single segment / local test calls).
  const raw = req.query?.route;
  const segments: string[] = Array.isArray(raw)
    ? raw.map((s) => String(s))
    : typeof raw === 'string' && raw.length > 0
      ? [raw]
      : [];
  // Normalise the dynamic params the handlers read from req.query so
  // they behave exactly as the old per-file routes did.
  const query = { ...(req.query ?? {}) };
  const setQuery = (patch: Record<string, unknown>) => {
    req.query = { ...query, ...patch };
  };

  const [a, b] = segments;
  if (segments.length === 1 && a === 'me') return handleMe(req, res);
  if (segments.length === 2 && a === 'me' && b === 'privacy') return handlePrivacy(req, res);
  if (segments.length === 2 && a === 'me' && b === 'blocks') return handleBlocks(req, res);
  if (segments.length === 2 && a === 'me' && b === 'follow-requests') return handleFollowRequestsList(req, res);
  if (segments.length === 2 && a === 'follow-requests') {
    setQuery({ id: b });
    return handleFollowRequestAnswer(req, res);
  }
  if (segments.length === 1 && a === 'follow') return handleFollow(req, res);
  if (segments.length === 1 && a === 'block') return handleBlock(req, res);
  if (segments.length === 1 && a === 'mute') return handleMute(req, res);
  if (segments.length === 1 && a === 'lists') return handleLists(req, res);
  if (segments.length === 1 && a === 'upload') return handleUpload(req, res);
  if (segments.length === 1) {
    // Public profile lookup: /api/profile/<username>
    setQuery({ username: a });
    return handlePublicProfile(req, res);
  }
  res.status(404).json({ ok: false, error: 'Not found.' });
}
