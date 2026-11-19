import { useCallback, useEffect, useRef, useState } from 'react';
import type { Drop, Post, Story, User } from './lib/api';
import {
  createProfile, signInWithProfile, signInWithGoogle, linkGoogle, getAuthLinks,
  getSessionUser, revokeSession,
  listFeed, listStories, createStory, createPost, listDrops, listUsers,
  listConversations, getUnreadCounts, followUser, getAuthStatus,
  getAdminUsers, getLocalUserCount, isOwnerEmail,
  getPublicProfile, getMyProfileServer, setDbConfigured,
  listFollowers, listFollowing,
} from './lib/api';
import type { AdminUsersData, PublicProfile } from './lib/api';
import { ProfilePage, EditProfilePage, PrivacyPage, RoomIdentityPage } from './components/ProfileViews';
import { renderGoogleButton } from './lib/google';
import { subscribeToUpdates } from './lib/realtime';
import StoryViewer from './components/StoryViewer';
import StoryEditor from './components/StoryEditor';
import type { EditorExtras } from './components/StoryEditor';
import PostCard from './components/PostCard';
import DropHub from './components/DropHub';
import MessagesView from './components/MessagesView';
import { ReelsView, ClubroomsView, SearchView, NotificationsView, SavedView } from './components/OtherViews';

type View = 'home' | 'discover' | 'hub' | 'search' | 'profile' | 'messages' | 'clubrooms' | 'notifications' | 'saved' | 'admin' | 'edit-profile' | 'privacy' | 'room-identity';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'discover', label: 'Discover', icon: '🎬' },
  { id: 'hub', label: 'DROP Hub', icon: '💧' },
  { id: 'search', label: 'Search', icon: '🔍' },
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'messages', label: 'Messages', icon: '💬' },
];

export default function App() {
  const [me, setMe] = useState<User | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem('drop-theme') === 'dark');
  const [view, setView] = useState<View>('home');
  const [feed, setFeed] = useState<Post[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<{ id: number; memberIds: number[] }[]>([]);
  const [unread, setUnread] = useState(0);
  const [shortcut, setShortcut] = useState<'my' | 'scheduled' | 'active' | 'trending'>('my');
  const [following, setFollowing] = useState<Set<number>>(new Set());
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<'story' | 'post' | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authStatus, setAuthStatus] = useState({ googleConfigured: false, dbConfigured: false, phoneConfigured: false as const });
  const [authLinks, setAuthLinks] = useState({ hasPassword: true, hasGoogle: false });
  // Admin / Insights (owner only — see the admin view below).
  const [adminData, setAdminData] = useState<AdminUsersData | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  // Profile (Page 04): the username being viewed (null = my own profile),
  // the loaded public profile, and the clubroom for Room Identity.
  const [viewedUsername, setViewedUsername] = useState<string | null>(null);
  const [viewedProfile, setViewedProfile] = useState<PublicProfile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [roomIdentity, setRoomIdentity] = useState<{ id: number; name: string } | null>(null);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const linkGoogleBtnRef = useRef<HTMLDivElement | null>(null);

  // AssistiveTouch dock
  const [ball, setBall] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem('drop-dock-pos');
      if (raw) { const p = JSON.parse(raw) as { x: number; y: number }; return p; }
    } catch { /* default */ }
    return { x: 0.85, y: 0.75 };
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('right');
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    document.body.classList.toggle('dark', dark);
    localStorage.setItem('drop-theme', dark ? 'dark' : 'white');
  }, [dark]);

  const refresh = useCallback(async () => {
    setFeed(await listFeed());
    setStories(await listStories());
    setDrops(await listDrops());
    setUsers(await listUsers());
    try { setConversations(await listConversations()); } catch { setConversations([]); }
    try { setUnread((await getUnreadCounts()).notifications); } catch { setUnread(0); }
  }, []);

  useEffect(() => {
    void getSessionUser().then((u) => { if (u) setMe(u); });
    void getAuthStatus().then((s) => { setDbConfigured(s.dbConfigured); setAuthStatus(s); });
  }, []);

  // Profile (Page 04): load the public profile whenever the profile
  // view opens — my own profile, or another user's by username.
  useEffect(() => {
    if (!me || view !== 'profile') return;
    let cancelled = false;
    setProfileError('');
    setViewedProfile(null);
    const load = async () => {
      try {
        if (viewedUsername) {
          setViewedProfile(await getPublicProfile(viewedUsername));
        } else {
          const server = await getMyProfileServer();
          if (cancelled) return;
          if (server) setViewedProfile(server);
          else {
            const [fl, fg] = await Promise.all([
              listFollowers(me.id).catch(() => [] as User[]),
              listFollowing(me.id).catch(() => [] as User[]),
            ]);
            if (cancelled) return;
            setViewedProfile({
              id: me.id, username: me.username, displayName: me.displayName,
              avatarUrl: me.avatarUrl ?? null, coverUrl: me.coverUrl ?? null,
              bio: me.bio ?? '', links: me.links ?? [], location: me.location ?? null,
              birthday: me.birthday ?? null, isPrivate: Boolean(me.isPrivate),
              relationship: 'self',
              counts: {
                posts: feed.filter((p) => p.authorId === me.id).length,
                followers: fl.length,
                following: fg.length,
              },
            });
          }
        }
      } catch (err) {
        if (!cancelled) setProfileError(err instanceof Error ? err.message : 'Could not load this profile.');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [me, view, viewedUsername, feed, users, following]);

  useEffect(() => {
    if (!me) return;
    void getAuthLinks().then(setAuthLinks);
  }, [me]);

  // Admin / Insights: load the shared user list only for the owner,
  // only when the admin view is open. Non-owners never call it.
  useEffect(() => {
    if (!me || view !== 'admin' || !isOwnerEmail(me.email)) return;
    let cancelled = false;
    setAdminLoading(true);
    setAdminError('');
    void getAdminUsers()
      .then((d) => { if (!cancelled) setAdminData(d); })
      .catch((err: unknown) => {
        if (!cancelled) setAdminError(err instanceof Error ? err.message : 'Could not load user insights.');
      })
      .finally(() => { if (!cancelled) setAdminLoading(false); });
    return () => { cancelled = true; };
  }, [me, view]);

  // Real Google sign-in button (Google Identity Services) on the
  // sign-in screen. Rendered only when Google is configured; otherwise
  // the screen honestly says "coming soon — credentials needed".
  useEffect(() => {
    if (me || !authStatus.googleConfigured) return;
    const el = googleBtnRef.current;
    if (!el) return;
    let cancelled = false;
    void renderGoogleButton(el, async (idToken) => {
      if (cancelled) return;
      setAuthError('');
      try {
        const r = await signInWithGoogle(idToken);
        setMe(r.user);
        void refresh();
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
      }
    }).catch((err: unknown) => {
      if (!cancelled) setAuthError(err instanceof Error ? err.message : 'Google sign-in failed to load.');
    });
    return () => { cancelled = true; };
  }, [me, authStatus.googleConfigured, authMode, refresh]);

  // "Link Google" button in Profile → Sign-in & security.
  useEffect(() => {
    if (!me || view !== 'profile' || !authStatus.googleConfigured || authLinks.hasGoogle) return;
    const el = linkGoogleBtnRef.current;
    if (!el) return;
    let cancelled = false;
    void renderGoogleButton(el, async (idToken) => {
      if (cancelled) return;
      try {
        await linkGoogle(idToken);
        setAuthLinks(await getAuthLinks());
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Google linking failed.');
      }
    }).catch(() => { /* button stays unavailable; sign-in still works */ });
    return () => { cancelled = true; };
  }, [me, view, authStatus.googleConfigured, authLinks.hasGoogle]);

  useEffect(() => {
    if (!me) return;
    void refresh();
    return subscribeToUpdates(() => { void refresh(); });
  }, [me, refresh]);

  // 30s idle auto-collapse
  useEffect(() => {
    if (!panelOpen) return;
    const reset = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setPanelOpen(false), 30000);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    return () => {
      window.removeEventListener('pointerdown', reset);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [panelOpen]);

  const openPanel = () => {
    setPanelSide(ball.x < 0.5 ? 'left' : 'right');
    setPanelOpen(true);
  };

  const onBallPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { dx: e.clientX - ball.x * window.innerWidth, dy: e.clientY - ball.y * window.innerHeight, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onBallPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = (e.clientX - d.dx) / window.innerWidth;
    const ny = (e.clientY - d.dy) / window.innerHeight;
    if (Math.abs(nx - ball.x) > 0.01 || Math.abs(ny - ball.y) > 0.01) d.moved = true;
    const pos = { x: Math.min(0.92, Math.max(0.02, nx)), y: Math.min(0.9, Math.max(0.05, ny)) };
    setBall(pos);
    localStorage.setItem('drop-dock-pos', JSON.stringify(pos));
  };
  const onBallPointerUp = () => {
    const moved = dragRef.current?.moved;
    dragRef.current = null;
    if (!moved) {
      if (panelOpen) setPanelOpen(false);
      else openPanel();
    }
  };

  const doAuth = async () => {
    setAuthError('');
    try {
      if (authMode === 'signup') {
        const r = await createProfile({ username, displayName: displayName || username, password });
        setMe(r.user);
      } else {
        const r = await signInWithProfile({ username, password });
        setMe(r.user);
      }
      void refresh();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const publishEditor = async (args: { filter: string; effect: string; extras: EditorExtras }) => {
    if (editing === 'story') {
      await createStory({ filter: args.filter, effect: args.effect, extrasJson: JSON.stringify(args.extras) });
    } else {
      await createPost({ caption: args.extras.text ?? 'New post', filter: args.filter, effect: args.effect, extrasJson: JSON.stringify(args.extras) });
    }
    setEditing(null);
    void refresh();
  };

  if (!me) {
    return (
      <div className="app">
        <div className="signin">
          <div className="logo">D<span>R</span>OP</div>
          <p className="muted">Privacy-aware social — Stories, Drops, Slash messaging.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={authMode === 'signin' ? 'primary' : 'ghost'} onClick={() => setAuthMode('signin')}>Sign in</button>
            <button className={authMode === 'signup' ? 'primary' : 'ghost'} onClick={() => setAuthMode('signup')}>Sign up</button>
          </div>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
          {authMode === 'signup' && <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          {authError && <div className="notice">{authError}</div>}
          <button className="primary" onClick={doAuth}>{authMode === 'signup' ? 'Create profile' : 'Sign in'}</button>
          {authStatus.googleConfigured ? (
            <div ref={googleBtnRef} />
          ) : (
            <button className="ghost" disabled>Continue with Google (coming soon — credentials needed)</button>
          )}
          <p className="muted">Forgot your password? Password reset is currently disabled (phone OTP was removed). If you linked Google, sign in with Google above.</p>
          <p className="muted">Sessions last 30 days and can be revoked from Profile → Sign-in &amp; security.</p>
        </div>
      </div>
    );
  }

  const visibleFeed = shortcut === 'trending' ? [...feed].sort((a, b) => b.fireCount - a.fireCount) : feed;

  return (
    <div className="app">
      <header className="header">
        <button className="ghost" onClick={() => setView('clubrooms')}>Clubs</button>
        <div className="logo" onClick={() => setView('home')}>D<span>R</span>OP</div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="ghost" onClick={() => setDark((d) => !d)}>{dark ? 'White' : 'Dark'}</button>
          <button className="ghost" onClick={() => setView('notifications')} aria-label="Notifications">🔔{unread > 0 ? ` ${unread}` : ''}</button>
        </span>
      </header>

      {view === 'home' && (
        <>
          <div className="stories">
            <button className="story-circle yours" onClick={() => setEditing('story')}>＋</button>
            {stories.map((s, i) => (
              <button key={s.id} className="story-circle" onClick={() => setViewerIndex(i)}>{(s.author?.displayName ?? 'S')[0]}</button>
            ))}
          </div>

          <div className="pill-bar">
            {([
              ['my', 'My Drops'],
              ['scheduled', 'Scheduled'],
              ['active', 'Active'],
              ['trending', 'Trending'],
            ] as const).map(([id, label]) => (
              <button key={id} className={shortcut === id ? 'active' : ''} onClick={() => setShortcut(id)}>{label}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, padding: '0 12px' }}>
            <button className="primary" onClick={() => setEditing('post')}>+ Post</button>
            <button className="ghost" onClick={() => setEditing('story')}>+ Story</button>
            <button className="ghost" onClick={() => setView('hub')}>+ Drop</button>
          </div>

          {editing && <StoryEditor initialFilter="original" onPublish={publishEditor} onCancel={() => setEditing(null)} />}

          {visibleFeed.length === 0 && <p className="muted" style={{ padding: 16 }}>No posts yet — create the first one.</p>}
          {visibleFeed.map((p) => (
            <PostCard
              key={p.id} post={p} following={following.has(p.authorId)}
              onFollow={async (id) => { await followUser(id); setFollowing((prev) => new Set(prev).add(id)); }}
            />
          ))}
        </>
      )}

      {view === 'discover' && <ReelsView />}
      {view === 'hub' && <DropHub drops={drops} onRefresh={() => void refresh()} />}
      {view === 'search' && <SearchView users={users} onOpenProfile={(username) => { setViewedUsername(username); setView('profile'); }} />}
      {view === 'messages' && <MessagesView conversations={conversations} users={users} me={me} />}
      {view === 'clubrooms' && <ClubroomsView me={me} onJoinIdentity={(room) => { setRoomIdentity(room); setView('room-identity'); }} />}
      {view === 'notifications' && <NotificationsView />}
      {view === 'saved' && <SavedView />}
      {view === 'admin' && (
        <div style={{ padding: 12 }}>
          <h2>Admin — user insights</h2>
          {!isOwnerEmail(me.email) ? (
            <p className="muted">Admin only.</p>
          ) : adminLoading ? (
            <p className="muted">Loading…</p>
          ) : adminError ? (
            <p className="muted">{adminError}</p>
          ) : adminData && !adminData.dbConfigured ? (
            <>
              <p className="muted">Shared database not configured — counts are this device only.</p>
              <p style={{ fontSize: 36, fontWeight: 700, margin: '8px 0' }}>{getLocalUserCount()} <span style={{ fontSize: 16 }}>users on this device (local only)</span></p>
              <p className="muted">Set DATABASE_URL in Vercel (see README → "Shared user tracking") and redeploy, then every Google sign-in is counted centrally here.</p>
            </>
          ) : adminData ? (
            <>
              <p style={{ fontSize: 36, fontWeight: 700, margin: '8px 0' }}>{adminData.totalUsers} <span style={{ fontSize: 16 }}>total users</span></p>
              <h3>Sign-ups by day</h3>
              {adminData.signupsByDay.length === 0 && <p className="muted">No sign-ups yet.</p>}
              {adminData.signupsByDay.map((d) => (
                <p key={d.day}>{d.day}: {d.count}</p>
              ))}
              <h3>Users</h3>
              {adminData.users.length === 0 && <p className="muted">No users yet.</p>}
              {adminData.users.map((u) => (
                <div key={u.id} className="card">
                  <strong>@{u.username}</strong> — {u.displayName}<br />
                  <span className="muted">{u.email ?? '—'} · {u.authMethod} · {new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
              <p className="muted">Users who signed up before the shared database was connected were local-only and do not appear here.</p>
            </>
          ) : null}
          <button className="ghost" onClick={() => setView('profile')}>Back to Profile</button>
        </div>
      )}
      {view === 'profile' && (
        <>
          {profileError ? (
            <div style={{ padding: 12 }}>
              <div className="notice">{profileError}</div>
              <button className="ghost" onClick={() => { setViewedUsername(null); setView('home'); }}>Back to Home</button>
            </div>
          ) : !viewedProfile ? (
            <p className="muted" style={{ padding: 16 }}>Loading profile…</p>
          ) : (
            <>
              <ProfilePage
                profile={viewedProfile}
                me={me}
                isOwner={viewedProfile.id === me.id}
                onEdit={() => setView('edit-profile')}
                onPrivacy={() => setView('privacy')}
                onAdmin={() => setView('admin')}
                onOpenUser={(username) => { setViewedUsername(username); setView('profile'); }}
                onMessage={() => setView('messages')}
              />
              {viewedProfile.id === me.id && (
                <div style={{ padding: '0 12px 12px' }}>
                  <h3>Sign-in &amp; security</h3>
                  <p>Google: {authLinks.hasGoogle ? `linked${me.email ? ` (${me.email})` : ''}` : authStatus.googleConfigured ? 'not linked' : 'coming soon — credentials needed'}</p>
                  {authStatus.googleConfigured && !authLinks.hasGoogle && <div ref={linkGoogleBtnRef} />}
                  <button className="ghost" onClick={async () => { await revokeSession(); setMe(null); }}>Sign out / revoke session</button>
                  {isOwnerEmail(me.email) && (
                    <button className="primary" style={{ marginLeft: 8 }} onClick={() => setView('admin')}>Admin — user insights</button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      {view === 'edit-profile' && (
        <EditProfilePage
          me={me}
          onBack={() => setView('profile')}
          onSaved={(u) => { setMe(u); void refresh(); setView('profile'); }}
        />
      )}
      {view === 'privacy' && (
        <PrivacyPage me={me} onBack={() => setView('profile')} onSignOut={() => setMe(null)} />
      )}
      {view === 'room-identity' && roomIdentity && (
        <RoomIdentityPage me={me} clubroomId={roomIdentity.id} clubroomName={roomIdentity.name} onBack={() => setView('clubrooms')} />
      )}

      {viewerIndex !== null && (
        <StoryViewer stories={stories} index={viewerIndex} onClose={() => setViewerIndex(null)} onIndex={setViewerIndex} />
      )}

      {!panelOpen && (
        <div
          className="dock-ball" role="button" aria-label="Navigation"
          style={{ left: `${ball.x * 100}vw`, top: `${ball.y * 100}vh` }}
          onPointerDown={onBallPointerDown}
          onPointerMove={onBallPointerMove}
          onPointerUp={onBallPointerUp}
        >
          💧{unread > 0 ? <span style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 11, padding: '2px 6px' }}>{unread}</span> : null}
        </div>
      )}
      {panelOpen && (
        <div className="dock-panel" style={{ [panelSide]: 12, top: '50%', transform: 'translateY(-50%)' } as React.CSSProperties}>
          {NAV.map((n) => (
            <button key={n.id} className={view === n.id ? 'active' : ''} aria-label={n.label} onClick={() => { if (n.id === 'profile') setViewedUsername(null); setView(n.id); setPanelOpen(false); }}>{n.icon}</button>
          ))}
        </div>
      )}
    </div>
  );
}
