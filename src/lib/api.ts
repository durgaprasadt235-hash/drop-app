// DROP typed API contract — the actions used by the Muse app.
// Standalone implementation: backed by localStorage, so this deployment
// works for demo / testing without the Muse hosted database. The server
// rules in api/README.md still apply (sealed Drops, Protected grants,
// 30-day revocable sessions); in production they must be
// enforced server-side, never in the client alone.
//
// Auth is Google-only (2026-11-19): in-app profile sign-in, plus real
// Google sign-in verified server-side by /api/auth/google. Phone + OTP
// is disabled — there is no phone sign-in, no OTP, and no phone-based
// password reset anywhere in this client.
//
// Real-time: `subscribe()` uses a viewer channel where available and
// falls back to polling (see the polling interval below).

export interface User {
  id: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string;
  isPrivate?: boolean;
  /** Google account id (sub) this profile is linked to, if any. */
  googleSub?: string | null;
  email?: string | null;
}

export interface Post {
  id: number;
  authorId: number;
  author?: User;
  caption: string;
  mediaUrl?: string | null;
  filter?: string;
  effect?: string;
  extrasJson?: string | null;
  fireCount: number;
  commentCount: number;
  createdAt: string;
}

export interface Story {
  id: number;
  authorId: number;
  author?: User;
  mediaUrl?: string | null;
  filter: string;
  effect?: string;
  extrasJson?: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface Drop {
  id: number;
  creatorId: number;
  kind: 'public' | 'protected';
  status: 'waiting' | 'ready' | 'revealed';
  blastAt: string;
  caption?: string | null;
  mediaUrl?: string | null;
  createdAt: string;
}

export interface Conversation {
  id: number;
  memberIds: number[];
  lastMessageAt?: string;
}

export interface Message {
  id: number;
  conversationId: number;
  senderId: number;
  body: string;
  createdAt: string;
}

export interface AuthStatus {
  googleConfigured: boolean;
  /** Phone + OTP is disabled — always false. */
  phoneConfigured: false;
}

export interface Session {
  token: string;
  userId: number;
  expiresAt: string;
}

const LS_KEY = 'drop-app-store-v1';
const POLL_MS = 5000;

interface Store {
  users: User[];
  posts: Post[];
  stories: Story[];
  drops: Drop[];
  conversations: Conversation[];
  messages: Message[];
  follows: { followerId: number; followingId: number }[];
  likes: { userId: number; postId: number }[];
  saves: { userId: number; postId: number }[];
  comments: { id: number; postId: number; authorId: number; body: string; createdAt: string }[];
  notifications: { id: number; userId: number; type: string; body: string; read: boolean; createdAt: string }[];
  clubrooms: { id: number; name: string; memberIds: number[] }[];
  reels: { id: number; authorId: number; mediaUrl: string; createdAt: string }[];
  seq: number;
}

function emptyStore(): Store {
  return {
    users: [], posts: [], stories: [], drops: [], conversations: [],
    messages: [], follows: [], likes: [], saves: [], comments: [],
    notifications: [], clubrooms: [], reels: [], seq: 1,
  };
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...emptyStore(), ...JSON.parse(raw) };
  } catch {
    // corrupted local store — start empty, never crash the app
  }
  return emptyStore();
}

function saveStore(s: Store) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

let store = loadStore();
let currentUserId: number | null = null;
try {
  currentUserId = Number(localStorage.getItem('drop-app-user-id') ?? '') || null;
} catch { currentUserId = null; }

function nextId(): number {
  store.seq += 1;
  saveStore(store);
  return store.seq;
}

function nowIso(): string {
  return new Date().toISOString();
}

function userById(id: number): User | undefined {
  return store.users.find((u) => u.id === id);
}

function requireUser(): User {
  const u = currentUserId ? userById(currentUserId) : undefined;
  if (!u) throw new Error('Not signed in — create a profile first.');
  return u;
}

// ---------------------------------------------------------------- auth ---
export async function getAuthStatus(): Promise<AuthStatus> {
  // Ask the deployed serverless function first (runtime env); fall back
  // to the build-time public client ID used by Google Identity Services.
  // In local dev (no /api function) the fetch fails and the fallback applies.
  try {
    const res = await fetch('/api/auth/status');
    if (res.ok) {
      const data = (await res.json()) as { googleConfigured?: boolean };
      return { googleConfigured: Boolean(data.googleConfigured), phoneConfigured: false };
    }
  } catch {
    // No serverless function reachable — fall through to the fallback.
  }
  const viteClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
  return { googleConfigured: viteClientId.length > 0, phoneConfigured: false };
}

export async function createProfile(args: {
  username: string; displayName: string; password?: string; bio?: string;
}): Promise<{ user: User; session: Session }> {
  if (store.users.some((u) => u.username === args.username)) {
    throw new Error('That username is already taken.');
  }
  const user: User = {
    id: nextId(), username: args.username, displayName: args.displayName,
    bio: args.bio ?? '', isPrivate: false,
  };
  store.users.push(user);
  saveStore(store);
  const session = issueSession(user.id);
  return { user, session };
}

export async function signInWithProfile(args: {
  username: string; password?: string;
}): Promise<{ user: User; session: Session }> {
  const user = store.users.find((u) => u.username === args.username);
  if (!user) throw new Error('No profile with that username.');
  // Standalone keeps the password check in the Muse server build; here a
  // profile is local-only, so sign-in is by username on this device.
  void args.password;
  const session = issueSession(user.id);
  return { user, session };
}

interface GoogleAuthResponse {
  ok: boolean;
  error?: string;
  user?: { sub: string; email: string; name?: string; picture?: string };
  session?: { token: string; expiresAt: string };
}

async function callGoogleAuth(idToken: string): Promise<GoogleAuthResponse> {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // ID token travels in the POST body, never in a URL.
    body: JSON.stringify({ idToken }),
  });
  const data = (await res.json().catch(() => ({}))) as GoogleAuthResponse;
  if (!res.ok || !data.ok || !data.user || !data.session) {
    throw new Error(data.error ?? 'Google sign-in failed — token could not be verified.');
  }
  return data;
}

function slugFromEmail(email: string): string {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'user';
  let username = base;
  let n = 1;
  while (store.users.some((u) => u.username === username)) {
    n += 1;
    username = `${base}_${n}`;
  }
  return username;
}

export async function signInWithGoogle(idToken: string): Promise<{ user: User; session: Session }> {
  const data = await callGoogleAuth(idToken);
  const verified = data.user!;
  // Create or link the local profile for this Google account (by sub,
  // then by verified email). No profile is created unless Google
  // verified the token server-side — a fake token never signs anyone in.
  let user = store.users.find((u) => u.googleSub === verified.sub)
    ?? store.users.find((u) => u.email === verified.email);
  if (!user) {
    user = {
      id: nextId(),
      username: slugFromEmail(verified.email),
      displayName: verified.name ?? verified.email.split('@')[0],
      avatarUrl: verified.picture ?? null,
      bio: '',
      isPrivate: false,
      googleSub: verified.sub,
      email: verified.email,
    };
    store.users.push(user);
  } else {
    user.googleSub = verified.sub;
    user.email = verified.email;
    if (verified.name && !user.displayName) user.displayName = verified.name;
    if (verified.picture && !user.avatarUrl) user.avatarUrl = verified.picture;
  }
  saveStore(store);
  const session = storeSession(user.id, data.session!.token, data.session!.expiresAt);
  return { user, session };
}

// Phone + OTP is disabled (2026-11-19). The phone functions were removed
// from this client entirely — there is no phone sign-in, no OTP request
// or verification, and no phone-based password reset. Password reset is
// unavailable: users who signed up with a password and forget it must
// sign in with Google (if linked) — see the note on the sign-in screen.

export async function getSessionUser(): Promise<User | null> {
  return currentUserId ? (userById(currentUserId) ?? null) : null;
}

export async function revokeSession(): Promise<void> {
  currentUserId = null;
  localStorage.removeItem('drop-app-user-id');
  localStorage.removeItem('drop-app-session');
}

export async function getAuthLinks(): Promise<{ hasPassword: boolean; hasGoogle: boolean }> {
  const me = currentUserId ? userById(currentUserId) : undefined;
  return { hasPassword: true, hasGoogle: Boolean(me?.googleSub) };
}

export async function linkGoogle(idToken: string): Promise<User> {
  const me = requireUser();
  const data = await callGoogleAuth(idToken);
  const verified = data.user!;
  // A Google account already linked to a different profile cannot be
  // linked to this one.
  const other = store.users.find((u) => u.googleSub === verified.sub && u.id !== me.id);
  if (other) throw new Error('That Google account is already linked to another profile.');
  me.googleSub = verified.sub;
  me.email = verified.email;
  if (verified.picture && !me.avatarUrl) me.avatarUrl = verified.picture;
  saveStore(store);
  return me;
}

export async function updateProfile(args: Partial<User> & { id: number }): Promise<User> {
  const u = userById(args.id);
  if (!u) throw new Error('Profile not found.');
  Object.assign(u, args);
  saveStore(store);
  return u;
}

export async function getProfile(id: number): Promise<User | null> {
  return userById(id) ?? null;
}

export async function listUsers(): Promise<User[]> {
  return [...store.users];
}

function storeSession(userId: number, token: string, expiresAt: string): Session {
  const session: Session = { token, userId, expiresAt };
  currentUserId = userId;
  localStorage.setItem('drop-app-user-id', String(userId));
  localStorage.setItem('drop-app-session', JSON.stringify(session));
  return session;
}

function issueSession(userId: number): Session {
  return storeSession(
    userId,
    `drop-${userId}-${Date.now()}`,
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  );
}

// ------------------------------------------------------------- follows ---
export async function followUser(followingId: number): Promise<void> {
  const me = requireUser();
  if (!store.follows.some((f) => f.followerId === me.id && f.followingId === followingId)) {
    store.follows.push({ followerId: me.id, followingId });
    saveStore(store);
  }
}

export async function unfollowUser(followingId: number): Promise<void> {
  const me = requireUser();
  store.follows = store.follows.filter(
    (f) => !(f.followerId === me.id && f.followingId === followingId),
  );
  saveStore(store);
}

export async function listFollowers(userId: number): Promise<User[]> {
  return store.follows.filter((f) => f.followingId === userId)
    .map((f) => userById(f.followerId)).filter((u): u is User => !!u);
}

export async function listFollowing(userId: number): Promise<User[]> {
  return store.follows.filter((f) => f.followerId === userId)
    .map((f) => userById(f.followingId)).filter((u): u is User => !!u);
}

export async function requestFollow(userId: number): Promise<void> {
  await followUser(userId);
}

export async function respondFollowRequest(_followerId: number, _accept: boolean): Promise<void> {
  // Private-account follow requests are approved server-side in the Muse build.
}

export async function blockUser(userId: number): Promise<void> {
  const me = requireUser();
  store.follows = store.follows.filter(
    (f) => !((f.followerId === me.id && f.followingId === userId) || (f.followerId === userId && f.followingId === me.id)),
  );
  saveStore(store);
}

export async function unblockUser(_userId: number): Promise<void> {
  // Unblock is a no-op in the standalone; blocking only removes follows.
}

export async function reportUser(userId: number, reason: string): Promise<void> {
  const me = requireUser();
  store.notifications.push({
    id: nextId(), userId, type: 'report', body: `Reported by ${me.username}: ${reason}`, read: false, createdAt: nowIso(),
  });
  saveStore(store);
}

// -------------------------------------------------------------- feed -----
export async function listFeed(): Promise<Post[]> {
  return [...store.posts].reverse().map((p) => ({ ...p, author: userById(p.authorId) }));
}

export async function createPost(args: {
  caption: string; mediaUrl?: string | null; filter?: string; effect?: string; extrasJson?: string | null;
}): Promise<Post> {
  const me = requireUser();
  const post: Post = {
    id: nextId(), authorId: me.id, caption: args.caption,
    mediaUrl: args.mediaUrl ?? null, filter: args.filter ?? 'original',
    effect: args.effect ?? 'none', extrasJson: args.extrasJson ?? null,
    fireCount: 0, commentCount: 0, createdAt: nowIso(),
  };
  store.posts.push(post);
  saveStore(store);
  return { ...post, author: me };
}

export async function deletePost(postId: number): Promise<void> {
  const me = requireUser();
  const post = store.posts.find((p) => p.id === postId);
  if (!post) throw new Error('Post not found.');
  if (post.authorId !== me.id) throw new Error('Only the author can delete this post.');
  store.posts = store.posts.filter((p) => p.id !== postId);
  saveStore(store);
}

export async function toggleLike(postId: number): Promise<{ fired: boolean; count: number }> {
  const me = requireUser();
  const post = store.posts.find((p) => p.id === postId);
  if (!post) throw new Error('Post not found.');
  const idx = store.likes.findIndex((l) => l.userId === me.id && l.postId === postId);
  if (idx >= 0) {
    store.likes.splice(idx, 1);
    post.fireCount = Math.max(0, post.fireCount - 1);
  } else {
    store.likes.push({ userId: me.id, postId });
    post.fireCount += 1;
  }
  saveStore(store);
  return { fired: idx < 0, count: post.fireCount };
}

export async function toggleSave(postId: number): Promise<{ saved: boolean }> {
  const me = requireUser();
  const idx = store.saves.findIndex((s) => s.userId === me.id && s.postId === postId);
  if (idx >= 0) store.saves.splice(idx, 1);
  else store.saves.push({ userId: me.id, postId });
  saveStore(store);
  return { saved: idx < 0 };
}

export async function listComments(postId: number) {
  return store.comments.filter((c) => c.postId === postId).map((c) => ({ ...c, author: userById(c.authorId) }));
}

export async function addComment(postId: number, body: string) {
  const me = requireUser();
  if (!body.trim()) throw new Error('Comment cannot be empty.');
  const comment = { id: nextId(), postId, authorId: me.id, body, createdAt: nowIso() };
  store.comments.push(comment);
  const post = store.posts.find((p) => p.id === postId);
  if (post) post.commentCount += 1;
  saveStore(store);
  return { ...comment, author: me };
}

export async function deleteComment(commentId: number): Promise<void> {
  const me = requireUser();
  const c = store.comments.find((x) => x.id === commentId);
  if (!c) throw new Error('Comment not found.');
  if (c.authorId !== me.id) throw new Error('Only the author can delete this comment.');
  store.comments = store.comments.filter((x) => x.id !== commentId);
  saveStore(store);
}

export async function listSaved(): Promise<Post[]> {
  const me = requireUser();
  const ids = new Set(store.saves.filter((s) => s.userId === me.id).map((s) => s.postId));
  return store.posts.filter((p) => ids.has(p.id)).map((p) => ({ ...p, author: userById(p.authorId) }));
}

export async function listPostsByUser(userId: number): Promise<Post[]> {
  return store.posts.filter((p) => p.authorId === userId).map((p) => ({ ...p, author: userById(p.authorId) }));
}

export async function getPost(postId: number): Promise<Post | null> {
  const p = store.posts.find((x) => x.id === postId);
  return p ? { ...p, author: userById(p.authorId) } : null;
}

// ------------------------------------------------------------ stories ----
export async function listStories(): Promise<Story[]> {
  const now = Date.now();
  return store.stories
    .filter((s) => new Date(s.expiresAt).getTime() > now)
    .map((s) => ({ ...s, author: userById(s.authorId) }));
}

export async function createStory(args: {
  mediaUrl?: string | null; filter?: string; effect?: string; extrasJson?: string | null;
}): Promise<Story> {
  const me = requireUser();
  const story: Story = {
    id: nextId(), authorId: me.id, mediaUrl: args.mediaUrl ?? null,
    filter: args.filter ?? 'original', effect: args.effect ?? 'none',
    extrasJson: args.extrasJson ?? null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: nowIso(),
  };
  store.stories.push(story);
  saveStore(store);
  return { ...story, author: me };
}

export async function deleteStory(storyId: number): Promise<void> {
  const me = requireUser();
  const s = store.stories.find((x) => x.id === storyId);
  if (!s) throw new Error('Story not found.');
  if (s.authorId !== me.id) throw new Error('Only the author can delete this story.');
  store.stories = store.stories.filter((x) => x.id !== storyId);
  saveStore(store);
}

export async function voteStoryPoll(_storyId: number, _option: 0 | 1): Promise<{ counts: [number, number] }> {
  // Poll votes are real server records in the Muse build.
  return { counts: [0, 0] };
}

export async function answerStoryQuestion(_storyId: number, _answer: string): Promise<void> {
  // Question answers are real server records in the Muse build.
}

export async function rateStorySlider(_storyId: number, _rating: number): Promise<{ average: number }> {
  return { average: _rating };
}

// --------------------------------------------------------------- drops ---
export async function listDrops(): Promise<Drop[]> {
  return [...store.drops].reverse();
}

export async function createDrop(args: {
  kind: 'public' | 'protected'; blastAt: string; caption?: string; mediaUrl?: string;
}): Promise<Drop> {
  const me = requireUser();
  const drop: Drop = {
    id: nextId(), creatorId: me.id, kind: args.kind,
    status: new Date(args.blastAt).getTime() <= Date.now() ? 'ready' : 'waiting',
    blastAt: args.blastAt, caption: args.caption ?? null,
    mediaUrl: args.mediaUrl ?? null, createdAt: nowIso(),
  };
  store.drops.push(drop);
  saveStore(store);
  return drop;
}

export async function openDrop(dropId: number): Promise<Drop> {
  const me = requireUser();
  const drop = store.drops.find((d) => d.id === dropId);
  if (!drop) throw new Error('Drop not found.');
  // Sealed Drops stay sealed until blast time — enforced server-side in
  // the Muse build; the standalone mirrors the rule here.
  if (new Date(drop.blastAt).getTime() > Date.now() && drop.creatorId !== me.id) {
    throw new Error('This Drop has not blasted yet.');
  }
  drop.status = 'revealed';
  saveStore(store);
  return drop;
}

export async function getDrop(dropId: number): Promise<Drop | null> {
  return store.drops.find((d) => d.id === dropId) ?? null;
}

export async function listScheduledDrops(): Promise<Drop[]> {
  return store.drops.filter((d) => d.status === 'waiting');
}

export async function listTrendingDrops(): Promise<Drop[]> {
  return store.drops.filter((d) => d.status === 'revealed');
}

export async function searchHubDrops(query: string): Promise<Drop[]> {
  const q = query.toLowerCase();
  return store.drops.filter((d) => (d.caption ?? '').toLowerCase().includes(q));
}

export async function deleteDrop(dropId: number): Promise<void> {
  const me = requireUser();
  const d = store.drops.find((x) => x.id === dropId);
  if (!d) throw new Error('Drop not found.');
  if (d.creatorId !== me.id) throw new Error('Only the creator can delete this Drop.');
  store.drops = store.drops.filter((x) => x.id !== dropId);
  saveStore(store);
}

// --------------------------------------------------------------- reels ---
export async function listReels() {
  return [...store.reels].reverse().map((r) => ({ ...r, author: userById(r.authorId) }));
}

export async function createReel(mediaUrl: string) {
  const me = requireUser();
  const reel = { id: nextId(), authorId: me.id, mediaUrl, createdAt: nowIso() };
  store.reels.push(reel);
  saveStore(store);
  return { ...reel, author: me };
}

// ---------------------------------------------------------- messages -----
export async function listConversations(): Promise<Conversation[]> {
  const me = requireUser();
  return store.conversations.filter((c) => c.memberIds.includes(me.id));
}

export async function listMessages(conversationId: number): Promise<Message[]> {
  return store.messages.filter((m) => m.conversationId === conversationId);
}

export async function sendMessage(conversationId: number, body: string): Promise<Message> {
  const me = requireUser();
  if (!body.trim()) throw new Error('Message cannot be empty.');
  const msg: Message = { id: nextId(), conversationId, senderId: me.id, body, createdAt: nowIso() };
  store.messages.push(msg);
  const conv = store.conversations.find((c) => c.id === conversationId);
  if (conv) conv.lastMessageAt = msg.createdAt;
  saveStore(store);
  return msg;
}

export async function deleteMessage(messageId: number): Promise<void> {
  const me = requireUser();
  const m = store.messages.find((x) => x.id === messageId);
  if (!m) throw new Error('Message not found.');
  if (m.senderId !== me.id) throw new Error('Only the sender can delete this message.');
  store.messages = store.messages.filter((x) => x.id !== messageId);
  saveStore(store);
}

export async function sendPostToConversation(conversationId: number, postId: number): Promise<Message> {
  const post = store.posts.find((p) => p.id === postId);
  if (!post) throw new Error('Post not found.');
  return sendMessage(conversationId, `Shared a post: ${post.caption}`);
}

export async function createSlashInvitation(conversationId: number, userId: number): Promise<void> {
  const me = requireUser();
  store.notifications.push({
    id: nextId(), userId, type: 'slash', body: `${me.username} invited you via Slash`, read: false, createdAt: nowIso(),
  });
  saveStore(store);
  void conversationId;
}

export async function respondSlashInvitation(_invitationId: number, _accept: boolean): Promise<void> {
  // Slash invitations vanish when the invited user leaves — no group left behind.
}

export async function leaveSlash(_conversationId: number): Promise<void> {
  // Leaving a Slash expansion removes it for that participant only.
}

// ----------------------------------------------------------- clubrooms ---
export async function listClubrooms() {
  return [...store.clubrooms];
}

export async function createClubroom(name: string) {
  const me = requireUser();
  const room = { id: nextId(), name, memberIds: [me.id] };
  store.clubrooms.push(room);
  saveStore(store);
  return room;
}

export async function joinClubroom(roomId: number): Promise<void> {
  const me = requireUser();
  const room = store.clubrooms.find((r) => r.id === roomId);
  if (!room) throw new Error('Clubroom not found.');
  if (!room.memberIds.includes(me.id)) room.memberIds.push(me.id);
  saveStore(store);
}

export async function leaveClubroom(roomId: number): Promise<void> {
  const me = requireUser();
  const room = store.clubrooms.find((r) => r.id === roomId);
  if (!room) return;
  room.memberIds = room.memberIds.filter((id) => id !== me.id);
  saveStore(store);
}

// ------------------------------------------------- search / notifications
export async function searchAll(query: string): Promise<{ users: User[]; posts: Post[] }> {
  const q = query.toLowerCase();
  return {
    users: store.users.filter((u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)),
    posts: store.posts.filter((p) => p.caption.toLowerCase().includes(q)),
  };
}

export async function listNotifications() {
  const me = requireUser();
  return store.notifications.filter((n) => n.userId === me.id).reverse();
}

export async function markNotificationsRead(): Promise<void> {
  const me = requireUser();
  store.notifications.forEach((n) => { if (n.userId === me.id) n.read = true; });
  saveStore(store);
}

export async function getUnreadCounts(): Promise<{ messages: number; notifications: number }> {
  const me = requireUser();
  return {
    messages: 0,
    notifications: store.notifications.filter((n) => n.userId === me.id && !n.read).length,
  };
}

export async function getAppStats(): Promise<{ users: number; posts: number; drops: number }> {
  return { users: store.users.length, posts: store.posts.length, drops: store.drops.length };
}

// ------------------------------------------------------------ real-time ---
/**
 * Subscribe to live updates. In the Muse build this is a viewer channel
 * (WebSocket) subscribed at sign-in; here it falls back to polling
 * every POLL_MS, calling `onUpdate` on each tick. Returns an unsubscribe
 * function.
 */
export function subscribe(onUpdate: () => void): () => void {
  const timer = window.setInterval(onUpdate, POLL_MS);
  return () => window.clearInterval(timer);
}

export const ACTIONS = [
  'getAuthStatus', 'createProfile', 'signInWithProfile', 'signInWithGoogle',
  'getSessionUser', 'revokeSession', 'getAuthLinks', 'linkGoogle',
  'updateProfile', 'getProfile', 'listUsers', 'followUser', 'unfollowUser',
  'listFollowers', 'listFollowing', 'requestFollow', 'respondFollowRequest',
  'blockUser', 'unblockUser', 'reportUser', 'listFeed', 'createPost',
  'deletePost', 'toggleLike', 'toggleSave', 'listComments', 'addComment',
  'deleteComment', 'listSaved', 'listPostsByUser', 'getPost', 'listStories',
  'createStory', 'deleteStory', 'voteStoryPoll', 'answerStoryQuestion',
  'rateStorySlider', 'listDrops', 'createDrop', 'openDrop', 'getDrop',
  'listScheduledDrops', 'listTrendingDrops', 'searchHubDrops', 'deleteDrop',
  'listReels', 'createReel', 'listConversations', 'listMessages',
  'sendMessage', 'deleteMessage', 'sendPostToConversation',
  'createSlashInvitation', 'respondSlashInvitation', 'leaveSlash',
  'listClubrooms', 'createClubroom', 'joinClubroom', 'leaveClubroom',
  'searchAll', 'listNotifications', 'markNotificationsRead',
  'getUnreadCounts', 'getAppStats', 'subscribe',
] as const;
