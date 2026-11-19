import { useCallback, useEffect, useRef, useState } from 'react';
import type { Drop, Post, Story, User } from './lib/api';
import {
  createProfile, signInWithProfile, signInWithGoogle, linkGoogle, getAuthLinks,
  getSessionUser, revokeSession,
  listFeed, listStories, createStory, createPost, listDrops, listUsers,
  listConversations, getUnreadCounts, followUser, getAuthStatus,
  getAdminUsers, getLocalUserCount, isOwnerEmail,
  getPublicProfile, getMyProfileServer, setDbConfigured,
  listFollowers, listFollowing, getMySettings,
} from './lib/api';
import type { AdminUsersData, PublicProfile } from './lib/api';
import { ProfilePage, EditProfilePage, RoomIdentityPage } from './components/ProfileViews';
import SettingsHub from './components/SettingsViews';
import type { SettingsScreen } from './components/SettingsViews';
import { renderGoogleButton } from './lib/google';
import { subscribeToUpdates } from './lib/realtime';
import StoryViewer from './components/StoryViewer';
import StoryEditor from './components/StoryEditor';
import type { EditorExtras } from './components/StoryEditor';
import PostCard from './components/PostCard';
import DropHub from './components/DropHub';
import MessagesView from './components/MessagesView';
import { ReelsView, ClubroomsView, SearchView, NotificationsView, SavedView } from './components/OtherViews';
import { IconBell, IconPlus, IconHome, IconReels, IconDrop, IconSearch, IconProfile, IconMessages, IconGrid, IconCalendar, IconLayers, IconFire, IconChevronRight, LogoDrop } from './components/icons';
import type { IconProps } from './components/icons';
import type { ComponentType } from 'react';

type View = 'home' | 'discover' | 'hub' | 'search' | 'profile' | 'messages' | 'clubrooms' | 'notifications' | 'saved' | 'admin' | 'edit-profile' | 'privacy' | 'room-identity' | 'settings';

const NAV: { id: View; label: string; Icon: ComponentType<IconProps> }[] = [
  { id: 'home', label: 'Home', Icon: IconHome },
  { id: 'discover', label: 'Discover', Icon: IconReels },
  { id: 'hub', label: 'DROP Hub', Icon: IconDrop },
  { id: 'search', label: 'Search', Icon: IconSearch },
  { id: 'profile', label: 'Profile', Icon: IconProfile },
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
  // DM opened from a profile's Message button (createConversation).
  const [openConversationId, setOpenConversationId] = useState<number | null>(null);
  const [roomIdentity, setRoomIdentity] = useState<{ id: number; name: string } | null>(null);
  // Settings hub sub-screen (null = hub). Profile "⚙️ Settings" opens
  // the hub; Privacy & Security lives inside it as a screen.
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen | null>(null);
  const [linkError, setLinkError] = useState('');
  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const linkGoogleBtnRef = useRef<HTMLDivElement | null>(null);

  // Approved dock — fixed capsule on mobile/tablet, slim left rail on
  // desktop (≥1025px). The old floating-ball form is gone entirely:
  // no drag-anywhere ball, no position key, no idle auto-collapse.
  // The capsule side persists in localStorage ('left' | 'right').
  const [dockSide, setDockSide] = useState<'left' | 'right'>(() => {
    try { return localStorage.getItem('drop-dock-side') === 'left' ? 'left' : 'right'; } catch { return 'right'; }
  });
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1025px)').matches);
  const [magnified, setMagnified] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const pressRef = useRef<{ index: number; startX: number; startY: number; longPressed: boolean; dragging: boolean } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const clickGuard = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1025px)');
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
    try { const counts = await getUnreadCounts(); setUnread(counts.notifications); } catch { setUnread(0); }
  }, []);

  useEffect(() => {
    void getSessionUser().then((u) => { if (u) setMe(u); });
    void getAuthStatus().then((s) => { setDbConfigured(s.dbConfigured); setAuthStatus(s); });
  }, []);

  // A dead server session (e.g. signed in before the shared DB was
  // connected) returns the user to the sign-in screen with a plain
  // message, instead of failing every screen with a raw server error.
  useEffect(() => {
    const onExpired = () => {
      setMe(null);
      setAuthError('Your session has expired. Please sign in again with Google.');
    };
    window.addEventListener('drop:session-expired', onExpired);
    return () => window.removeEventListener('drop:session-expired', onExpired);
  }, []);

  // Apply saved settings that affect the whole app shell (reduce motion).
  useEffect(() => {
    if (!me) return;
    void getMySettings().catch(() => undefined);
  }, [me]);

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
        setLinkError(err instanceof Error ? err.message : 'Google linking failed.');
      }
    }).catch(() => { /* button stays unavailable; sign-in still works */ });
    return () => { cancelled = true; };
  }, [me, view, authStatus.googleConfigured, authLinks.hasGoogle]);

  useEffect(() => {
    if (!me) return;
    void refresh();
    return subscribeToUpdates(() => { void refresh(); });
  }, [me, refresh]);

  // Dock gesture machine (approved spec): plain tap navigates immediately;
  // a 300ms long-press magnifies the selected icon (1.25x, neighbours
  // 1.12x) and shows its label, and release navigates; a horizontal drag
  // of >=14px relocates the capsule, snapping to the nearest edge.
  // Reduce-motion (Settings → Accessibility) disables the magnification.
  const reduceMotion = () => document.body.classList.contains('reduce-motion');

  const navigateDock = (id: View) => {
    if (id === 'profile') setViewedUsername(null);
    setView(id);
  };

  const clearLongPress = () => {
    if (longPressTimer.current) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    setMagnified(null);
  };

  const onDockPointerDown = (index: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pressRef.current = { index, startX: e.clientX, startY: e.clientY, longPressed: false, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    longPressTimer.current = window.setTimeout(() => {
      if (pressRef.current) { pressRef.current.longPressed = true; setMagnified(index); }
    }, 300);
  };

  const onDockPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = pressRef.current;
    if (!p || p.dragging) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (Math.abs(dx) >= 14 && Math.abs(dx) >= Math.abs(dy)) {
      p.dragging = true;
      clearLongPress();
    }
  };

  const onDockPointerUp = (index: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = pressRef.current;
    pressRef.current = null;
    clearLongPress();
    if (!p) return;
    if (p.dragging) {
      const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
      setDockSide(side);
      try { localStorage.setItem('drop-dock-side', side); } catch { /* ignore */ }
      return;
    }
    // Tap navigates immediately; a completed long-press navigates on release.
    clickGuard.current = true;
    navigateDock(NAV[index].id);
  };

  const onDockPointerCancel = () => {
    pressRef.current = null;
    clearLongPress();
  };

  const onDockClick = (index: number) => () => {
    // Pointer navigation already ran in pointerup; this covers keyboard activation.
    if (clickGuard.current) { clickGuard.current = false; return; }
    navigateDock(NAV[index].id);
  };

  const iconScale = (index: number): React.CSSProperties => {
    const base: React.CSSProperties = { display: 'inline-flex' };
    if (magnified === null || reduceMotion()) return base;
    const d = Math.abs(index - magnified);
    if (d === 0) return { ...base, transform: 'scale(1.25)', transition: 'transform 150ms ease' };
    if (d === 1) return { ...base, transform: 'scale(1.12)', transition: 'transform 150ms ease' };
    return base;
  };

  const renderDockButtons = (alwaysShowLabel: boolean) => NAV.map((n, i) => (
    <button
      key={n.id}
      type="button"
      className={`dock-item${view === n.id ? ' active' : ''}`}
      aria-label={n.label}
      aria-current={view === n.id ? 'page' : undefined}
      onPointerDown={onDockPointerDown(i)}
      onPointerMove={onDockPointerMove}
      onPointerUp={onDockPointerUp(i)}
      onPointerCancel={onDockPointerCancel}
      onClick={onDockClick(i)}
      onContextMenu={(e) => e.preventDefault()}
      onMouseEnter={() => setHovered(i)}
      onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
    >
      <span className="dock-icon" style={iconScale(i)}>
        <n.Icon size={22} filled={view === n.id} />
      </span>
      {(alwaysShowLabel || magnified === i || hovered === i) && <span className="dock-label">{n.label}</span>}
    </button>
  ));

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

  const publishEditor = async (args: { filter: string; effect: string; extras: EditorExtras; audience?: 'everyone' | 'close-friends' }) => {
    if (editing === 'story') {
      await createStory({ filter: args.filter, effect: args.effect, extrasJson: JSON.stringify(args.extras), audience: args.audience });
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
    <div className={view === 'home' ? 'app home' : 'app'}>
      <header className="header">
        <div className="header-side">
          <button className="ghost" onClick={() => setView('clubrooms')}><IconGrid size={22} />Clubs</button>
        </div>
        <div className="logo" onClick={() => setView('home')}>
          <span className="logo-mark"><LogoDrop size={28} /></span>
          <span className="logo-text">DROP®</span>
        </div>
        <div className="header-side">
          <button className="ghost" onClick={() => setView('notifications')} aria-label="Notifications">
            <span className="bell-wrap"><IconBell size={22} />{unread > 0 && <span className="bell-dot" aria-hidden="true" />}</span>
          </button>
          <button className="ghost" onClick={() => setView('messages')} aria-label="Messages"><IconMessages size={22} /></button>
          <button className="ghost" onClick={() => setDark((d) => !d)}>{dark ? 'White' : 'Dark'}</button>
        </div>
      </header>

      {view === 'home' && (
        <>
          <div className="stories">
            <button className="story-circle yours" onClick={() => setEditing('story')}><IconPlus size={28} /></button>
            {stories.map((s, i) => (
              <button key={s.id} className="story-circle" onClick={() => setViewerIndex(i)}>{(s.author?.displayName ?? 'S')[0]}</button>
            ))}
          </div>

          <div className="pill-bar">
            {([
              ['my', 'My Drops', IconDrop, false],
              ['scheduled', 'Scheduled', IconCalendar, false],
              ['active', 'Active', IconLayers, false],
              ['trending', 'Trending', IconFire, true],
            ] as const).map(([id, label, PillIcon, filled]) => (
              <button key={id} className={`pill-item${shortcut === id ? ' active' : ''}`} onClick={() => setShortcut(id)}>
                <span className="pill-icon"><PillIcon size={20} filled={filled} /></span>
                <span className="pill-label">{label}</span>
              </button>
            ))}
            <button type="button" className="pill-chevron" aria-label="More Drops" onClick={() => setView('hub')}><IconChevronRight size={20} /></button>
          </div>

          <div style={{ display: 'flex', gap: 8, padding: '0 12px' }}>
            <button className="primary" onClick={() => setEditing('post')}>+ Post</button>
            <button className="ghost" onClick={() => setEditing('story')}>+ Story</button>
            <button className="ghost" onClick={() => setView('hub')}>+ Drop</button>
          </div>

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
      {view === 'messages' && <MessagesView conversations={conversations} users={users} me={me} initialOpenId={openConversationId} onOpenRequests={() => { setSettingsScreen('message-requests'); setView('settings'); }} />}
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
              <p className="stat-number" style={{ margin: '8px 0' }}>{getLocalUserCount()} <span style={{ fontSize: 16 }}>users on this device (local only)</span></p>
              <p className="muted">Set DATABASE_URL in Vercel (see README → "Shared user tracking") and redeploy, then every Google sign-in is counted centrally here.</p>
            </>
          ) : adminData ? (
            <>
              <p className="stat-number" style={{ margin: '8px 0' }}>{adminData.totalUsers} <span style={{ fontSize: 16 }}>total users</span></p>
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
                onPrivacy={() => { setSettingsScreen(null); setView('settings'); }}
                onAdmin={() => setView('admin')}
                onOpenUser={(username) => { setViewedUsername(username); setView('profile'); }}
                onOpenConversation={async (conversationId) => {
                  setOpenConversationId(conversationId);
                  await refresh();
                  setView('messages');
                }}
                onCreatePost={() => setEditing('post')}
                onRefresh={() => void refresh()}
              />
              {viewedProfile.id === me.id && (
                <div style={{ padding: '0 12px 12px' }}>
                  <h3>Sign-in &amp; security</h3>
                  {linkError && <div className="notice">{linkError}</div>}
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
          onRefresh={() => void refresh()}
        />
      )}
      {view === 'settings' && (
        <SettingsHub
          me={me}
          initialScreen={settingsScreen}
          onBack={() => setView('profile')}
          onEditProfile={() => setView('edit-profile')}
          onSignOut={() => setMe(null)}
          onOpenConversation={async (conversationId) => {
            setOpenConversationId(conversationId);
            await refresh();
            setView('messages');
          }}
        />
      )}
      {view === 'privacy' && (
        <SettingsHub
          me={me}
          initialScreen="privacy"
          onBack={() => setView('profile')}
          onEditProfile={() => setView('edit-profile')}
          onSignOut={() => setMe(null)}
        />
      )}
      {view === 'room-identity' && roomIdentity && (
        <RoomIdentityPage me={me} clubroomId={roomIdentity.id} clubroomName={roomIdentity.name} onBack={() => setView('clubrooms')} />
      )}

      {/* Post / Story editor — mounted on every view (not just Home) so
          "Create your first post" works from the Profile page too. */}
      {editing && <StoryEditor initialFilter="original" kind={editing} onPublish={publishEditor} onCancel={() => setEditing(null)} />}

      {viewerIndex !== null && (
        <StoryViewer stories={stories} index={viewerIndex} onClose={() => setViewerIndex(null)} onIndex={setViewerIndex} me={me} />
      )}

      {/* Approved dock — global on every signed-in page. Fixed capsule
          below desktop widths; slim left rail at ≥1025px (no floating
          element over content on desktop). Full-screen Story/Blast
          viewers (z-index 100) still cover the dock by design. */}
      {!isDesktop ? (
        <div className={dockSide === 'left' ? 'dock-panel dock-left' : 'dock-panel'} style={dockSide === 'left' ? { left: 12, right: 'auto' } : undefined}>
          {renderDockButtons(false)}
        </div>
      ) : (
        <nav className="dock-rail" aria-label="Navigation">
          <div className="rail-logo" aria-hidden="true"><LogoDrop size={40} /></div>
          {renderDockButtons(true)}
        </nav>
      )}
    </div>
  );
}
