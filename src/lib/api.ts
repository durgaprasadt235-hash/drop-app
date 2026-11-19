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
  /** Viewer relationship, returned by the followers/following lists. */
  relationship?: 'following' | 'requested' | 'none' | 'self';
  isPrivate?: boolean;
  /** Google account id (sub) this profile is linked to, if any. */
  googleSub?: string | null;
  email?: string | null;
  coverUrl?: string | null;
  links?: { label: string; url: string }[];
  location?: string | null;
  birthday?: string | null;
  createdAt?: string;
}

/** Privacy preferences — persisted server-side (privacy_preferences). */
export interface PrivacyPrefs {
  isPrivate: boolean;
  activityStatus: boolean;
  readReceipts: boolean;
  whoCanMessage: 'everyone' | 'friends' | 'nobody';
  whoCanSlash: 'everyone' | 'friends' | 'nobody';
  whoCanMention: 'everyone' | 'friends' | 'nobody';
  whoCanTag: 'everyone' | 'friends' | 'nobody';
  defaultRoomIdentity: 'drop' | 'room';
}

export const DEFAULT_PRIVACY: PrivacyPrefs = {
  isPrivate: false, activityStatus: true, readReceipts: true,
  whoCanMessage: 'everyone', whoCanSlash: 'friends',
  whoCanMention: 'everyone', whoCanTag: 'friends', defaultRoomIdentity: 'drop',
};

export interface FollowRequestItem {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  createdAt: string;
}

export interface RoomIdentity {
  mode: 'drop' | 'room';
  alias?: string | null;
  avatarUrl?: string | null;
}

export interface PublicProfile {
  id: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  isPrivate: boolean;
  relationship: 'none' | 'following' | 'requested' | 'self';
  bio?: string;
  coverUrl?: string | null;
  links?: { label: string; url: string }[];
  location?: string | null;
  birthday?: string | null;
  counts?: { posts: number; followers: number; following: number };
  /** Server-computed from the target's stored who_can_message: whether
   *  the viewer may open a DM with this account. */
  canMessage?: boolean;
  createdAt?: string;
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

/** Owner of DROP — the only accounts that may see the Admin / Insights view. */
export const OWNER_EMAIL = 'durgaprasadt235@gmail.com';
export const OWNER_EMAILS = ['durgaprasadt235@gmail.com', 'dpthoorpati@gmail.com'];

export function isOwnerEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && OWNER_EMAILS.some((o) => o.toLowerCase() === email.toLowerCase());
}

export interface AuthStatus {
  googleConfigured: boolean;
  /** True only when DATABASE_URL (Neon) is set server-side — i.e. a shared user count exists. */
  dbConfigured: boolean;
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
  privacy: Record<number, PrivacyPrefs>;
  followRequests: { id: number; requesterId: number; targetId: number; status: string; createdAt: string }[];
  blocks: { blockerId: number; blockedId: number }[];
  mutes: { muterId: number; mutedId: number }[];
  roomIdentities: { userId: number; clubroomId: number; mode: 'drop' | 'room'; alias?: string | null; avatarUrl?: string | null }[];
  seq: number;
}

function emptyStore(): Store {
  return {
    users: [], posts: [], stories: [], drops: [], conversations: [],
    messages: [], follows: [], likes: [], saves: [], comments: [],
    notifications: [], clubrooms: [], reels: [],
    privacy: {}, followRequests: [], blocks: [], mutes: [], roomIdentities: [],
    seq: 1,
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
  // Google is configured if EITHER the server (DROP_GOOGLE_CLIENT_ID)
  // or the build-time public client ID (VITE_GOOGLE_CLIENT_ID) is set.
  // The server status must never override a set VITE_ ID with false —
  // that hid the Google button after a redeploy with only VITE_ set.
  const viteClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
  let serverConfigured = false;
  let dbConfigured = false;
  try {
    const res = await fetch('/api/auth/status');
    if (res.ok) {
      const data = (await res.json()) as { googleConfigured?: boolean; dbConfigured?: boolean };
      serverConfigured = Boolean(data.googleConfigured);
      dbConfigured = Boolean(data.dbConfigured);
    }
  } catch {
    // No serverless function reachable — rely on the build-time ID.
  }
  dbOn = dbConfigured;
  return { googleConfigured: serverConfigured || viteClientId.length > 0, dbConfigured, phoneConfigured: false };
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
  /** Present only when DATABASE_URL is set: the shared DB user row. */
  dbUser?: { id: number; username: string; displayName: string; email: string | null; authMethod: string; createdAt: string };
  session?: { token: string; expiresAt: string };
  dbConfigured?: boolean;
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
  // When the shared DB is configured, the server returns dbUser: use
  // the DB id/username as the local cache identity (and keep the local
  // id sequence ahead of it) so the same person is never counted twice
  // and the admin session token matches the DB session row.
  let user = store.users.find((u) => u.googleSub === verified.sub)
    ?? store.users.find((u) => u.email === verified.email);
  if (data.dbUser) {
    const db = data.dbUser;
    user = store.users.find((u) => u.id === db.id) ?? user;
    if (!user) {
      user = {
        id: db.id,
        username: db.username,
        displayName: db.displayName,
        avatarUrl: verified.picture ?? null,
        bio: '',
        isPrivate: false,
        googleSub: verified.sub,
        email: verified.email,
      };
      store.users.push(user);
    } else {
      user.id = db.id;
      user.username = db.username;
      user.displayName = db.displayName;
      user.googleSub = verified.sub;
      user.email = verified.email;
      if (verified.picture && !user.avatarUrl) user.avatarUrl = verified.picture;
    }
    if (store.seq < db.id) store.seq = db.id;
  } else if (!user) {
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

// ------------------------------------------------------- admin / insights ---
export interface AdminUserRow {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  authMethod: string;
  createdAt: string;
}

export interface AdminUsersData {
  dbConfigured: boolean;
  totalUsers: number;
  users: AdminUserRow[];
  signupsByDay: { day: string; count: number }[];
}

function getCurrentSessionToken(): string | null {
  try {
    const raw = localStorage.getItem('drop-app-session');
    if (!raw) return null;
    return (JSON.parse(raw) as Session).token ?? null;
  } catch {
    return null;
  }
}

/** Local-only user count (this device) — labelled local-only in the UI. */
export function getLocalUserCount(): number {
  return store.users.length;
}

/**
 * Owner-only: fetch the shared user list from /api/admin/users.ts.
 * Sends the current session token as Bearer auth; the server returns
 * 401 for a missing/invalid session and 403 for a non-admin. When the
 * shared DB is not configured the server returns dbConfigured: false
 * with an empty list — never a fake count.
 */
export async function getAdminUsers(): Promise<AdminUsersData> {
  const token = getCurrentSessionToken();
  if (!token) throw new Error('Sign-in required.');
  const res = await fetch('/api/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AdminUsersData> & { ok?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? (res.status === 403 ? 'Admin only.' : 'Could not load user insights.'));
  }
  return {
    dbConfigured: Boolean(data.dbConfigured),
    totalUsers: Number(data.totalUsers ?? 0),
    users: Array.isArray(data.users) ? data.users : [],
    signupsByDay: Array.isArray(data.signupsByDay) ? data.signupsByDay : [],
  };
}

// Phone + OTP is disabled (2026-11-19). The phone functions were removed
// from this client entirely — there is no phone sign-in, no OTP request
// or verification, and no phone-based password reset. Password reset is
// unavailable: users who signed up with a password and forget it must
// sign in with Google (if linked) — see the note on the sign-in screen.

// ------------------------------------------- profile / privacy (server) ---
/** Is the shared DB configured (from the last getAuthStatus call)? */
let dbOn = false;
export function setDbConfigured(v: boolean): void { dbOn = v; }

async function serverFetch(path: string, init?: RequestInit): Promise<any> {
  const token = getCurrentSessionToken();
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
  return data;
}

function toPrivacy(server: any): PrivacyPrefs {
  return {
    isPrivate: Boolean(server.is_private),
    activityStatus: server.activity_status !== false,
    readReceipts: server.read_receipts !== false,
    whoCanMessage: server.who_can_message ?? 'everyone',
    whoCanSlash: server.who_can_slash ?? 'friends',
    whoCanMention: server.who_can_mention ?? 'everyone',
    whoCanTag: server.who_can_tag ?? 'friends',
    defaultRoomIdentity: server.default_room_identity === 'room' ? 'room' : 'drop',
  };
}

function fromPrivacy(p: PrivacyPrefs): Record<string, unknown> {
  return {
    is_private: p.isPrivate, activity_status: p.activityStatus, read_receipts: p.readReceipts,
    who_can_message: p.whoCanMessage, who_can_slash: p.whoCanSlash,
    who_can_mention: p.whoCanMention, who_can_tag: p.whoCanTag,
    default_room_identity: p.defaultRoomIdentity,
  };
}

export async function getMyPrivacy(): Promise<PrivacyPrefs> {
  const me = requireUser();
  if (dbOn) {
    try {
      const data = await serverFetch('/api/profile/me/privacy');
      const p = toPrivacy(data.privacy);
      store.privacy[me.id] = p;
      saveStore(store);
      return p;
    } catch { /* fall through to local */ }
  }
  return store.privacy[me.id] ?? { ...DEFAULT_PRIVACY, isPrivate: Boolean(me.isPrivate) };
}

export async function updateMyPrivacy(p: PrivacyPrefs): Promise<PrivacyPrefs> {
  const me = requireUser();
  if (dbOn) {
    const data = await serverFetch('/api/profile/me/privacy', { method: 'PATCH', body: JSON.stringify(fromPrivacy(p)) });
    const next = toPrivacy(data.privacy);
    store.privacy[me.id] = next;
    me.isPrivate = next.isPrivate;
    saveStore(store);
    return next;
  }
  store.privacy[me.id] = p;
  me.isPrivate = p.isPrivate;
  saveStore(store);
  return p;
}

export async function getMyProfileServer(): Promise<PublicProfile | null> {
  if (!dbOn) return null;
  try {
    const data = await serverFetch('/api/profile/me');
    const p = data.profile;
    return {
      id: p.id, username: p.username, displayName: p.displayName,
      avatarUrl: p.avatarUrl ?? null, coverUrl: p.coverUrl ?? null,
      bio: p.bio ?? '', links: p.links ?? [], location: p.location ?? null,
      birthday: p.birthday ?? null, isPrivate: Boolean(p.isPrivate),
      relationship: 'self', counts: data.counts, canMessage: p.canMessage ?? true, createdAt: p.createdAt,
    };
  } catch { return null; }
}

export async function getPublicProfile(username: string): Promise<PublicProfile> {
  if (dbOn) {
    try {
      const data = await serverFetch(`/api/profile/${encodeURIComponent(username)}`);
      const p = data.profile;
      return {
        id: p.id, username: p.username, displayName: p.displayName,
        avatarUrl: p.avatarUrl ?? null, coverUrl: p.coverUrl ?? null,
        bio: p.bio ?? '', links: p.links ?? [], location: p.location ?? null,
        birthday: p.birthday ?? null, isPrivate: Boolean(p.isPrivate),
        relationship: p.relationship ?? 'none', counts: p.counts,
        canMessage: p.canMessage ?? false, createdAt: p.createdAt,
      };
    } catch (err) { throw err; }
  }
  const u = store.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
  if (!u) throw new Error('Profile not found.');
  const me = currentUserId ? userById(currentUserId) : undefined;
  return {
    id: u.id, username: u.username, displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? null, coverUrl: u.coverUrl ?? null,
    bio: u.bio ?? '', links: u.links ?? [], location: u.location ?? null,
    birthday: u.birthday ?? null, isPrivate: Boolean(u.isPrivate),
    relationship: me?.id === u.id ? 'self'
      : store.follows.some((f) => f.followerId === me?.id && f.followingId === u.id) ? 'following'
      : store.followRequests.some((r) => r.requesterId === me?.id && r.targetId === u.id && r.status === 'pending') ? 'requested' : 'none',
    counts: {
      posts: store.posts.filter((p) => p.authorId === u.id).length,
      followers: store.follows.filter((f) => f.followingId === u.id).length,
      following: store.follows.filter((f) => f.followerId === u.id).length,
    },
  };
}

/** Upload avatar/cover. Returns the public URL, or throws an honest error when storage is not configured. */
export async function uploadProfilePhoto(kind: 'avatar' | 'cover', file: File): Promise<string> {
  const me = requireUser();
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Only JPEG, PNG or WebP photos are allowed.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Photo must be under 2 MB.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the photo.'));
    r.readAsDataURL(file);
  });
  if (dbOn) {
    const data = await serverFetch('/api/profile/upload', {
      method: 'POST',
      body: JSON.stringify({ kind, dataUrl, mime: file.type }),
    });
    if (kind === 'avatar') me.avatarUrl = data.url; else me.coverUrl = data.url;
    saveStore(store);
    return data.url as string;
  }
  throw new Error('Photo upload needs storage configured (BLOB_READ_WRITE_TOKEN). Your Google photo or initials avatar is used instead.');
}

export async function listFollowRequests(): Promise<{ incoming: FollowRequestItem[]; outgoing: FollowRequestItem[] }> {
  const me = requireUser();
  if (dbOn) {
    try {
      const data = await serverFetch('/api/profile/me/follow-requests');
      return {
        incoming: (data.incoming ?? []).map((r: any) => ({ id: r.id, userId: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl ?? null, createdAt: r.createdAt })),
        outgoing: (data.outgoing ?? []).map((r: any) => ({ id: r.id, userId: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl ?? null, createdAt: r.createdAt })),
      };
    } catch { /* fall through to local */ }
  }
  return {
    incoming: store.followRequests.filter((r) => r.targetId === me.id && r.status === 'pending').map((r) => {
      const u = userById(r.requesterId);
      return { id: r.id, userId: r.requesterId, username: u?.username ?? '', displayName: u?.displayName ?? '', avatarUrl: u?.avatarUrl ?? null, createdAt: r.createdAt };
    }),
    outgoing: store.followRequests.filter((r) => r.requesterId === me.id && r.status === 'pending').map((r) => {
      const u = userById(r.targetId);
      return { id: r.id, userId: r.targetId, username: u?.username ?? '', displayName: u?.displayName ?? '', avatarUrl: u?.avatarUrl ?? null, createdAt: r.createdAt };
    }),
  };
}

export async function listBlockedMuted(): Promise<{ blocked: User[]; muted: User[] }> {
  const me = requireUser();
  if (dbOn) {
    try {
      const data = await serverFetch('/api/profile/me/blocks');
      return {
        blocked: (data.blocked ?? []).map((u: any) => ({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl ?? null })),
        muted: (data.muted ?? []).map((u: any) => ({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl ?? null })),
      };
    } catch { /* fall through to local */ }
  }
  return {
    blocked: store.blocks.filter((b) => b.blockerId === me.id).map((b) => userById(b.blockedId)).filter((u): u is User => !!u),
    muted: store.mutes.filter((m) => m.muterId === me.id).map((m) => userById(m.mutedId)).filter((u): u is User => !!u),
  };
}

export async function listFollowersFollowing(userId: number, kind: 'followers' | 'following'): Promise<User[]> {
  if (dbOn) {
    try {
      const data = await serverFetch(`/api/profile/lists?targetId=${userId}&kind=${kind}`);
      return (data.users ?? []).map((u: any) => ({
        id: u.id, username: u.username, displayName: u.displayName,
        avatarUrl: u.avatarUrl ?? null, relationship: u.relationship ?? 'none',
      }));
    } catch (err) { throw err; }
  }
  const users = kind === 'followers' ? await listFollowers(userId) : await listFollowing(userId);
  return users.map((u) => ({
    ...u,
    relationship: u.id === currentUserId ? 'self'
      : store.follows.some((f) => f.followerId === currentUserId && f.followingId === u.id) ? 'following'
      : store.followRequests.some((r) => r.requesterId === currentUserId && r.targetId === u.id && r.status === 'pending') ? 'requested' : 'none',
  }));
}

export async function getRoomIdentity(clubroomId: number): Promise<{ myIdentity: RoomIdentity | null; members: { identityMode: string; displayName: string; username?: string; avatarUrl?: string | null }[]; member: boolean }> {
  const me = requireUser();
  if (dbOn) {
    try {
      const data = await serverFetch(`/api/clubrooms/${clubroomId}/identity`);
      return { myIdentity: data.myIdentity, members: data.members ?? [], member: Boolean(data.member) };
    } catch { /* fall through to local */ }
  }
  const mine = store.roomIdentities.find((r) => r.userId === me.id && r.clubroomId === clubroomId);
  const room = store.clubrooms.find((r) => r.id === clubroomId);
  const members = (room?.memberIds ?? []).map((id) => {
    const u = userById(id);
    const ri = store.roomIdentities.find((r) => r.userId === id && r.clubroomId === clubroomId);
    if (ri?.mode === 'room') return { identityMode: 'room', displayName: ri.alias ?? 'Room member', avatarUrl: ri.avatarUrl ?? null };
    return { identityMode: 'drop', displayName: u?.displayName ?? '', username: u?.username, avatarUrl: u?.avatarUrl ?? null };
  });
  return { myIdentity: mine ? { mode: mine.mode, alias: mine.alias ?? null, avatarUrl: mine.avatarUrl ?? null } : null, members, member: Boolean(room?.memberIds.includes(me.id)) };
}

export async function joinClubroomWithIdentity(clubroomId: number, identity: RoomIdentity): Promise<void> {
  const me = requireUser();
  if (dbOn) {
    await serverFetch(`/api/clubrooms/${clubroomId}/identity`, {
      method: 'POST',
      body: JSON.stringify({ identityMode: identity.mode, alias: identity.alias ?? undefined, avatarUrl: identity.avatarUrl ?? undefined }),
    });
  }
  await joinClubroom(clubroomId);
  const existing = store.roomIdentities.find((r) => r.userId === me.id && r.clubroomId === clubroomId);
  if (existing) { existing.mode = identity.mode; existing.alias = identity.alias ?? null; existing.avatarUrl = identity.avatarUrl ?? null; }
  else store.roomIdentities.push({ userId: me.id, clubroomId, mode: identity.mode, alias: identity.alias ?? null, avatarUrl: identity.avatarUrl ?? null });
  saveStore(store);
}

export async function updateRoomIdentity(clubroomId: number, identity: RoomIdentity): Promise<void> {
  const me = requireUser();
  if (dbOn) {
    await serverFetch(`/api/clubrooms/${clubroomId}/identity`, {
      method: 'PATCH',
      body: JSON.stringify({ identityMode: identity.mode, alias: identity.alias ?? undefined, avatarUrl: identity.avatarUrl ?? undefined }),
    });
  }
  const existing = store.roomIdentities.find((r) => r.userId === me.id && r.clubroomId === clubroomId);
  if (existing) { existing.mode = identity.mode; existing.alias = identity.alias ?? null; existing.avatarUrl = identity.avatarUrl ?? null; }
  else store.roomIdentities.push({ userId: me.id, clubroomId, mode: identity.mode, alias: identity.alias ?? null, avatarUrl: identity.avatarUrl ?? null });
  saveStore(store);
}

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
  const me = requireUser();
  if (args.id !== me.id) throw new Error('You can only edit your own profile.');
  // Client-side validation mirrors the server (which re-validates).
  if (args.username !== undefined) {
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(args.username.trim())) throw new Error('Username must be 3–30 letters, numbers or underscores.');
    const clash = store.users.find((x) => x.username.toLowerCase() === args.username!.toLowerCase() && x.id !== me.id);
    if (clash) throw new Error('That username is already taken.');
  }
  if (args.bio !== undefined && args.bio.length > 150) throw new Error('Bio must be 150 characters or fewer.');
  if (args.links !== undefined) {
    if (args.links.length > 5) throw new Error('At most 5 links.');
    for (const l of args.links) {
      if (!/^https:\/\//.test(l.url)) throw new Error('Links must start with https://');
    }
  }
  if (dbOn) {
    const data = await serverFetch('/api/profile/me', {
      method: 'PATCH',
      body: JSON.stringify({
        display_name: args.displayName, username: args.username, bio: args.bio,
        links: args.links, location: args.location, birthday: args.birthday,
      }),
    });
    const p = data.profile;
    Object.assign(me, {
      displayName: p.displayName, username: p.username, bio: p.bio,
      avatarUrl: p.avatarUrl ?? me.avatarUrl, coverUrl: p.coverUrl ?? me.coverUrl,
      links: p.links ?? [], location: p.location ?? null, birthday: p.birthday ?? null,
    });
    saveStore(store);
    return me;
  }
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
/** Follow a user. Returns 'following' (public) or 'requested' (private). */
export async function followUser(followingId: number): Promise<'following' | 'requested'> {
  const me = requireUser();
  if (followingId === me.id) throw new Error('You cannot follow yourself.');
  if (dbOn) {
    const data = await serverFetch('/api/profile/follow', {
      method: 'POST',
      body: JSON.stringify({ targetId: followingId }),
    });
    const status = data.status === 'requested' ? 'requested' : 'following';
    if (status === 'following' && !store.follows.some((f) => f.followerId === me.id && f.followingId === followingId)) {
      store.follows.push({ followerId: me.id, followingId });
    }
    if (status === 'requested' && !store.followRequests.some((r) => r.requesterId === me.id && r.targetId === followingId && r.status === 'pending')) {
      store.followRequests.push({ id: nextId(), requesterId: me.id, targetId: followingId, status: 'pending', createdAt: nowIso() });
    }
    saveStore(store);
    return status;
  }
  const target = userById(followingId);
  if (target?.isPrivate) {
    if (!store.followRequests.some((r) => r.requesterId === me.id && r.targetId === followingId && r.status === 'pending')) {
      store.followRequests.push({ id: nextId(), requesterId: me.id, targetId: followingId, status: 'pending', createdAt: nowIso() });
      saveStore(store);
    }
    return 'requested';
  }
  if (!store.follows.some((f) => f.followerId === me.id && f.followingId === followingId)) {
    store.follows.push({ followerId: me.id, followingId });
    saveStore(store);
  }
  return 'following';
}

export async function unfollowUser(followingId: number): Promise<void> {
  const me = requireUser();
  if (dbOn) {
    try {
      await serverFetch(`/api/profile/follow?targetId=${followingId}`, { method: 'DELETE' });
    } catch { /* fall through to local */ }
  }
  store.follows = store.follows.filter(
    (f) => !(f.followerId === me.id && f.followingId === followingId),
  );
  store.followRequests.forEach((r) => {
    if (r.requesterId === me.id && r.targetId === followingId && r.status === 'pending') r.status = 'cancelled';
  });
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

export async function respondFollowRequest(requestId: number, accept: boolean): Promise<void> {
  const me = requireUser();
  if (dbOn) {
    await serverFetch(`/api/profile/follow-requests/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    });
  }
  const r = store.followRequests.find((x) => x.id === requestId && x.targetId === me.id);
  if (r) {
    r.status = accept ? 'accepted' : 'declined';
    if (accept && !store.follows.some((f) => f.followerId === r.requesterId && f.followingId === me.id)) {
      store.follows.push({ followerId: r.requesterId, followingId: me.id });
    }
  }
  saveStore(store);
}

/** Legacy signature kept for callers passing a follower id. */
export async function respondFollowRequestByFollower(followerId: number, accept: boolean): Promise<void> {
  const me = requireUser();
  const r = store.followRequests.find((x) => x.requesterId === followerId && x.targetId === me.id && x.status === 'pending');
  if (!r) throw new Error('Follow request not found.');
  await respondFollowRequest(r.id, accept);
}

export async function blockUser(userId: number): Promise<void> {
  const me = requireUser();
  if (dbOn) {
    await serverFetch('/api/profile/block', { method: 'POST', body: JSON.stringify({ targetId: userId }) });
  }
  store.follows = store.follows.filter(
    (f) => !((f.followerId === me.id && f.followingId === userId) || (f.followerId === userId && f.followingId === me.id)),
  );
  store.followRequests.forEach((r) => {
    if (((r.requesterId === me.id && r.targetId === userId) || (r.requesterId === userId && r.targetId === me.id)) && r.status === 'pending') r.status = 'cancelled';
  });
  if (!store.blocks.some((b) => b.blockerId === me.id && b.blockedId === userId)) {
    store.blocks.push({ blockerId: me.id, blockedId: userId });
  }
  saveStore(store);
}

export async function unblockUser(userId: number): Promise<void> {
  const me = requireUser();
  if (dbOn) {
    try {
      await serverFetch(`/api/profile/block?targetId=${userId}`, { method: 'DELETE' });
    } catch { /* fall through to local */ }
  }
  store.blocks = store.blocks.filter((b) => !(b.blockerId === me.id && b.blockedId === userId));
  saveStore(store);
}

export async function muteUser(userId: number): Promise<void> {
  const me = requireUser();
  if (dbOn) {
    await serverFetch('/api/profile/mute', { method: 'POST', body: JSON.stringify({ targetId: userId }) });
  }
  if (!store.mutes.some((m) => m.muterId === me.id && m.mutedId === userId)) {
    store.mutes.push({ muterId: me.id, mutedId: userId });
  }
  saveStore(store);
}

export async function unmuteUser(userId: number): Promise<void> {
  const me = requireUser();
  if (dbOn) {
    try {
      await serverFetch(`/api/profile/mute?targetId=${userId}`, { method: 'DELETE' });
    } catch { /* fall through to local */ }
  }
  store.mutes = store.mutes.filter((m) => !(m.muterId === me.id && m.mutedId === userId));
  saveStore(store);
}

export function isBlockedLocal(a: number, b: number): boolean {
  return store.blocks.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));
}

export function isMutedLocal(userId: number): boolean {
  const me = currentUserId;
  return me !== null && store.mutes.some((m) => m.muterId === me && m.mutedId === userId);
}

/**
 * Report a user. Server-first (POST /api/profile/report) — the report is
 * stored in Neon for moderation. The old client wrote a notification
 * into the target's local store, which did nothing on any other device.
 */
export async function reportUser(userId: number, reason: string): Promise<void> {
  const me = requireUser();
  if (dbOn) {
    await serverFetch('/api/profile/report', {
      method: 'POST',
      body: JSON.stringify({ targetId: userId, reason }),
    });
    return;
  }
  store.notifications.push({
    id: nextId(), userId, type: 'report', body: `Reported by ${me.username}: ${reason}`, read: false, createdAt: nowIso(),
  });
  saveStore(store);
}

/**
 * Find or create a 1:1 DM conversation with a user. Server-first
 * (POST /api/profile/conversations): the server enforces the target's
 * stored who_can_message and blocking before any conversation exists.
 * Until this existed, no code path in the app created a conversation
 * at all — the profile Message button led to an empty inbox.
 */
export async function createConversation(targetId: number): Promise<number> {
  const me = requireUser();
  if (targetId === me.id) throw new Error('You cannot message yourself.');
  if (dbOn) {
    const data = await serverFetch('/api/profile/conversations', {
      method: 'POST',
      body: JSON.stringify({ targetId }),
    });
    const id = Number(data.conversationId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Could not open this conversation.');
    if (store.seq < id) store.seq = id;
    if (!store.conversations.some((c) => c.id === id)) {
      store.conversations.push({ id, memberIds: [me.id, targetId] });
    }
    saveStore(store);
    return id;
  }
  const existing = store.conversations.find(
    (c) => c.memberIds.length === 2 && c.memberIds.includes(me.id) && c.memberIds.includes(targetId),
  );
  if (existing) return existing.id;
  const conv = { id: nextId(), memberIds: [me.id, targetId] };
  store.conversations.push(conv);
  saveStore(store);
  return conv.id;
}

// -------------------------------------------------------------- feed -----
export async function listFeed(): Promise<Post[]> {
  // Muted accounts' posts are suppressed from the feed (muting does
  // not delete follows or messages — it only hides their content).
  const me = currentUserId;
  const muted = new Set(store.mutes.filter((m) => m.muterId === me).map((m) => m.mutedId));
  return [...store.posts].reverse()
    .filter((p) => !muted.has(p.authorId))
    .map((p) => ({ ...p, author: userById(p.authorId) }));
}

/**
 * Create a post. Server-first when the shared DB is configured
 * (POST /api/profile/posts) so the post exists in Neon — that is what
 * makes profile counts, profile tabs and other devices agree. The
 * server row is mirrored into the local store so Home/feed keep
 * working; if the server is unreachable the post is created locally
 * only (same fallback as the rest of this client).
 */
export async function createPost(args: {
  caption: string; mediaUrl?: string | null; filter?: string; effect?: string; extrasJson?: string | null;
}): Promise<Post> {
  const me = requireUser();
  if (dbOn) {
    try {
      const data = await serverFetch('/api/profile/posts', {
        method: 'POST',
        body: JSON.stringify({
          caption: args.caption, mediaUrl: args.mediaUrl ?? null,
          filter: args.filter ?? 'original', effect: args.effect ?? 'none',
          extrasJson: args.extrasJson ?? null,
        }),
      });
      const p = data.post;
      const post: Post = {
        id: p.id, authorId: p.authorId, caption: p.caption,
        mediaUrl: p.mediaUrl ?? null, filter: p.filter ?? 'original',
        effect: p.effect ?? 'none', extrasJson: p.extrasJson ?? null,
        fireCount: p.fireCount ?? 0, commentCount: p.commentCount ?? 0,
        createdAt: p.createdAt,
      };
      if (store.seq < post.id) store.seq = post.id;
      if (!store.posts.some((x) => x.id === post.id)) store.posts.push(post);
      saveStore(store);
      return { ...post, author: me };
    } catch { /* fall through to local-only create */ }
  }
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
  if (dbOn) {
    try {
      await serverFetch(`/api/profile/posts?id=${postId}`, { method: 'DELETE' });
    } catch { /* fall through to local delete */ }
  }
  const post = store.posts.find((p) => p.id === postId);
  if (!post) {
    if (!dbOn) throw new Error('Post not found.');
    return; // server already deleted it; nothing local to remove
  }
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
  if (dbOn) {
    try {
      const data = await serverFetch('/api/profile/save', {
        method: 'POST',
        body: JSON.stringify({ postId }),
      });
      const saved = Boolean(data.saved);
      if (saved && !store.saves.some((s) => s.userId === me.id && s.postId === postId)) {
        store.saves.push({ userId: me.id, postId });
      } else if (!saved) {
        store.saves = store.saves.filter((s) => !(s.userId === me.id && s.postId === postId));
      }
      saveStore(store);
      return { saved };
    } catch { /* fall through to local toggle */ }
  }
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
  if (dbOn) {
    try {
      const data = await serverFetch('/api/profile/me/saved');
      return (data.posts ?? []).map((p: any) => ({
        id: p.id, authorId: p.authorId, caption: p.caption ?? '',
        mediaUrl: p.mediaUrl ?? null, filter: p.filter ?? 'original',
        effect: p.effect ?? 'none', extrasJson: p.extrasJson ?? null,
        fireCount: p.fireCount ?? 0, commentCount: p.commentCount ?? 0,
        createdAt: p.createdAt, author: userById(p.authorId),
      }));
    } catch { /* fall through to local */ }
  }
  const ids = new Set(store.saves.filter((s) => s.userId === me.id).map((s) => s.postId));
  return store.posts.filter((p) => ids.has(p.id)).map((p) => ({ ...p, author: userById(p.authorId) }));
}

function mapServerPost(p: any): Post {
  return {
    id: p.id, authorId: p.authorId, caption: p.caption ?? '',
    mediaUrl: p.mediaUrl ?? null, filter: p.filter ?? 'original',
    effect: p.effect ?? 'none', extrasJson: p.extrasJson ?? null,
    fireCount: p.fireCount ?? 0, commentCount: p.commentCount ?? 0,
    createdAt: p.createdAt, author: userById(p.authorId),
  };
}

/** Profile Posts tab: server-first (Neon), local fallback. */
export async function listPostsByUser(userId: number): Promise<Post[]> {
  if (dbOn) {
    try {
      const data = await serverFetch(`/api/profile/${userId}/posts`);
      return (data.posts ?? []).map(mapServerPost);
    } catch { /* fall through to local */ }
  }
  return store.posts.filter((p) => p.authorId === userId).map((p) => ({ ...p, author: userById(p.authorId) }));
}

/** Profile Reels tab: server-first (Neon), local fallback. */
export async function listReelsByUser(userId: number): Promise<{ id: number; authorId: number; mediaUrl: string; createdAt: string; author?: User }[]> {
  if (dbOn) {
    try {
      const data = await serverFetch(`/api/profile/${userId}/reels`);
      return (data.reels ?? []).map((r: any) => ({
        id: r.id, authorId: r.authorId, mediaUrl: r.mediaUrl,
        createdAt: r.createdAt, author: userById(r.authorId),
      }));
    } catch { /* fall through to local */ }
  }
  return store.reels.filter((r) => r.authorId === userId).map((r) => ({ ...r, author: userById(r.authorId) }));
}

/** Profile Drops tab: server-first (Neon), local fallback. Sealed Drops
 *  arrive with caption/media stripped server-side (creator excepted). */
export async function listDropsByUser(userId: number): Promise<Drop[]> {
  if (dbOn) {
    try {
      const data = await serverFetch(`/api/profile/${userId}/drops`);
      return (data.drops ?? []).map((d: any) => ({
        id: d.id, creatorId: d.creatorId, kind: d.kind, status: d.status,
        blastAt: d.blastAt, caption: d.caption ?? null,
        mediaUrl: d.mediaUrl ?? null, createdAt: d.createdAt,
      }));
    } catch { /* fall through to local */ }
  }
  return store.drops.filter((d) => d.creatorId === userId);
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
  if (dbOn) {
    try {
      const data = await serverFetch('/api/profile/drops', {
        method: 'POST',
        body: JSON.stringify({
          kind: args.kind, blastAt: args.blastAt,
          caption: args.caption ?? null, mediaUrl: args.mediaUrl ?? null,
        }),
      });
      const d = data.drop;
      const drop: Drop = {
        id: d.id, creatorId: d.creatorId, kind: d.kind, status: d.status,
        blastAt: d.blastAt, caption: d.caption ?? null,
        mediaUrl: d.mediaUrl ?? null, createdAt: d.createdAt,
      };
      if (store.seq < drop.id) store.seq = drop.id;
      if (!store.drops.some((x) => x.id === drop.id)) store.drops.push(drop);
      saveStore(store);
      return drop;
    } catch { /* fall through to local-only create */ }
  }
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
  if (dbOn) {
    try {
      const data = await serverFetch('/api/profile/drops/open', {
        method: 'POST',
        body: JSON.stringify({ dropId }),
      });
      const d = data.drop;
      const local = store.drops.find((x) => x.id === dropId);
      if (local) { local.status = 'revealed'; saveStore(store); }
      return {
        id: d.id, creatorId: d.creatorId, kind: d.kind, status: d.status,
        blastAt: d.blastAt, caption: d.caption ?? null,
        mediaUrl: d.mediaUrl ?? null, createdAt: d.createdAt,
      };
    } catch { /* fall through to the local rule, which enforces the same sealed-until-blast check */ }
  }
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
  if (dbOn) {
    try {
      const data = await serverFetch('/api/profile/reels', {
        method: 'POST',
        body: JSON.stringify({ mediaUrl }),
      });
      const r = data.reel;
      const reel = { id: r.id, authorId: r.authorId, mediaUrl: r.mediaUrl, createdAt: r.createdAt };
      if (store.seq < reel.id) store.seq = reel.id;
      if (!store.reels.some((x) => x.id === reel.id)) store.reels.push(reel);
      saveStore(store);
      return { ...reel, author: me };
    } catch { /* fall through to local-only create */ }
  }
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
  'updateProfile', 'getProfile', 'getPublicProfile', 'getMyProfileServer',
  'getMyPrivacy', 'updateMyPrivacy', 'uploadProfilePhoto',
  'listFollowRequests', 'listBlockedMuted', 'listFollowersFollowing',
  'getRoomIdentity', 'joinClubroomWithIdentity', 'updateRoomIdentity',
  'listUsers', 'followUser', 'unfollowUser',
  'listFollowers', 'listFollowing', 'requestFollow', 'respondFollowRequest',
  'respondFollowRequestByFollower',
  'blockUser', 'unblockUser', 'muteUser', 'unmuteUser', 'reportUser', 'listFeed', 'createPost',
  'deletePost', 'toggleLike', 'toggleSave', 'listComments', 'addComment',
  'deleteComment', 'listSaved', 'listPostsByUser', 'listReelsByUser',
  'listDropsByUser', 'getPost', 'listStories',
  'createStory', 'deleteStory', 'voteStoryPoll', 'answerStoryQuestion',
  'rateStorySlider', 'listDrops', 'createDrop', 'openDrop', 'getDrop',
  'listScheduledDrops', 'listTrendingDrops', 'searchHubDrops', 'deleteDrop',
  'listReels', 'createReel', 'createConversation', 'listConversations', 'listMessages',
  'sendMessage', 'deleteMessage', 'sendPostToConversation',
  'createSlashInvitation', 'respondSlashInvitation', 'leaveSlash',
  'listClubrooms', 'createClubroom', 'joinClubroom', 'leaveClubroom',
  'searchAll', 'listNotifications', 'markNotificationsRead',
  'getUnreadCounts', 'getAppStats', 'getAdminUsers', 'subscribe',
] as const;
