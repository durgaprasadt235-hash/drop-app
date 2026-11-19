// DROP — Single Serverless Function for ALL /api/profile/* routes.
// Vercel's Hobby plan allows at most 12 Serverless Functions per
// deployment; Page 04 originally shipped 11 profile endpoints as
// separate files (15 functions total with auth/admin/clubrooms), which
// failed the deploy. All profile routes now live behind this one
// function: api/profile-router.ts. The handler logic is unchanged —
// it lives verbatim in api/lib/profile-handlers.ts (a helper file,
// not a function). Route paths, methods, status codes, validation
// and response shapes are exactly as before, so the client
// (src/lib/api.ts) needs no changes.
//
// WHY NOT api/profile/[...route].ts: Vercel never populated
// req.query.route for that catch-all file live (single-segment paths
// reached the handler with empty segments → 404; multi-segment paths
// edge-404'd before reaching it), so every profile/settings save
// failed. This is a plain-named function instead, reached by an
// explicit vercel.json rewrite (/api/profile/:path* → here), and it
// parses the segments from req.url itself — it does not depend on
// Vercel injecting dynamic route params at all.
// Vercel serves api/ functions before vercel.json rewrites, and the
// SPA fallback excludes /api/*, so the fallback cannot swallow
// these routes.

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
  handleProfilePosts,
  handleProfileReels,
  handleProfileDrops,
  handleCreatePost,
  handleDeletePost,
  handleCreateReel,
  handleCreateDrop,
  handleOpenDrop,
  handleSaveToggle,
  handleSaved,
  handleReport,
  handleCreateConversation,
  // DROP Settings (2026-11-19) — same single function, no new files.
  handleSettings,
  handleCloseFriends,
  handleHideStoryFrom,
  handleRestricted,
  handleMutedList,
  handleHiddenWords,
  handleNotificationsList,
  handleNotificationsRead,
  handleArchive,
  handleApps,
  handleStatus,
  handleMessageRequestsList,
  handleMessageRequestAnswer,
  handlePostComments,
  handleSlashCreate,
  handleSlashAnswer,
  handleSlashLeave,
} from './lib/profile-handlers.js';

export default async function handler(req: any, res: any): Promise<void> {
  // Segments come from the request path itself, not from
  // req.query.route: Vercel never populated that for the old
  // api/profile/[...route].ts catch-all. The vercel.json rewrite
  // sends /api/profile/* here with the original URL intact.
  const rawUrl = typeof req.url === 'string' ? req.url : '';
  let path = rawUrl;
  try { path = new URL(rawUrl, 'http://localhost').pathname; } catch { /* keep rawUrl */ }
  const prefix = '/api/profile/';
  let segments: string[] = [];
  if (path === '/api/profile' || path === '/api/profile/') {
    segments = [];
  } else if (path.startsWith(prefix)) {
    segments = path.slice(prefix.length).split('/').filter((s: string) => s.length > 0).map((s: string) => decodeURIComponent(s));
  } else if (path === '/api/profile-router' || path === '/api/profile-router/') {
    // Direct hit on this function (no rewrite): nothing to dispatch.
    segments = [];
  } else {
    // Fallback: honour an explicit ?route= query value, if present.
    const raw = req.query?.route;
    segments = Array.isArray(raw)
      ? raw.map((s) => String(s))
      : typeof raw === 'string' && raw.length > 0
        ? [raw]
        : [];
  }
  // Normalise the dynamic params the handlers read from req.query so
  // they behave exactly as the old per-file routes did.
  const query = { ...(req.query ?? {}) };
  const setQuery = (patch: Record<string, unknown>) => {
    req.query = { ...query, ...patch };
  };

  const [a, b] = segments;
  const c = segments[2];
  if (segments.length === 1 && a === 'me') return handleMe(req, res);
  if (segments.length === 2 && a === 'me' && b === 'privacy') return handlePrivacy(req, res);
  if (segments.length === 2 && a === 'me' && b === 'blocks') return handleBlocks(req, res);
  if (segments.length === 2 && a === 'me' && b === 'follow-requests') return handleFollowRequestsList(req, res);
  if (segments.length === 2 && a === 'me' && b === 'saved') return handleSaved(req, res);
  // DROP Settings (2026-11-19) — all inside this router, no new files.
  if (segments.length === 2 && a === 'me' && b === 'settings') return handleSettings(req, res);
  if (segments.length === 2 && a === 'me' && b === 'close-friends') return handleCloseFriends(req, res);
  if (segments.length === 2 && a === 'me' && b === 'hide-story-from') return handleHideStoryFrom(req, res);
  if (segments.length === 2 && a === 'me' && b === 'restricted') return handleRestricted(req, res);
  if (segments.length === 2 && a === 'me' && b === 'muted') return handleMutedList(req, res);
  if (segments.length === 2 && a === 'me' && b === 'hidden-words') return handleHiddenWords(req, res);
  if (segments.length === 2 && a === 'me' && b === 'notifications') return handleNotificationsList(req, res);
  if (segments.length === 3 && a === 'me' && b === 'notifications' && c === 'read') return handleNotificationsRead(req, res);
  if (segments.length === 2 && a === 'me' && b === 'archive') return handleArchive(req, res);
  if (segments.length === 2 && a === 'me' && b === 'apps') return handleApps(req, res);
  if (segments.length === 2 && a === 'me' && b === 'status') return handleStatus(req, res);
  if (segments.length === 2 && a === 'me' && b === 'message-requests') return handleMessageRequestsList(req, res);
  if (segments.length === 3 && a === 'me' && b === 'message-requests') {
    setQuery({ id: c });
    return handleMessageRequestAnswer(req, res);
  }
  // Post comments: /api/profile/posts/<id>/comments (GET + POST).
  if (segments.length === 3 && a === 'posts' && /^\d+$/.test(b) && c === 'comments') {
    setQuery({ postId: Number(b) });
    return handlePostComments(req, res);
  }
  // Slash: POST /api/profile/slash-invitations,
  // POST /api/profile/slash-invitations/<id>, POST /api/profile/slash-leave.
  if (segments.length === 1 && a === 'slash-invitations' && req.method === 'POST') return handleSlashCreate(req, res);
  if (segments.length === 2 && a === 'slash-invitations' && req.method === 'POST') {
    setQuery({ id: b });
    return handleSlashAnswer(req, res);
  }
  if (segments.length === 1 && a === 'slash-leave' && req.method === 'POST') return handleSlashLeave(req, res);
  // Profile content lists: /api/profile/<userId>/posts|reels|drops
  if (segments.length === 2 && /^\d+$/.test(a) && (b === 'posts' || b === 'reels' || b === 'drops')) {
    setQuery({ userId: Number(a) });
    if (b === 'posts') return handleProfilePosts(req, res);
    if (b === 'reels') return handleProfileReels(req, res);
    return handleProfileDrops(req, res);
  }
  // Open a Drop: POST /api/profile/drops/open
  if (segments.length === 2 && a === 'drops' && b === 'open') return handleOpenDrop(req, res);
  // Content writes (single segment, dispatched on method so GET still
  // falls through to the username lookup below).
  if (segments.length === 1 && a === 'posts') {
    if (req.method === 'POST') return handleCreatePost(req, res);
    if (req.method === 'DELETE') return handleDeletePost(req, res);
  }
  if (segments.length === 1 && a === 'reels' && req.method === 'POST') return handleCreateReel(req, res);
  if (segments.length === 1 && a === 'drops' && req.method === 'POST') return handleCreateDrop(req, res);
  if (segments.length === 1 && a === 'save' && req.method === 'POST') return handleSaveToggle(req, res);
  if (segments.length === 1 && a === 'report' && req.method === 'POST') return handleReport(req, res);
  if (segments.length === 1 && a === 'conversations' && req.method === 'POST') return handleCreateConversation(req, res);
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
