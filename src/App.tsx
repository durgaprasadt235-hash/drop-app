import { useCallback, useEffect, useRef, useState } from 'react';
import type { Drop, Post, Story, User } from './lib/api';
import {
  createProfile, signInWithProfile, getSessionUser, revokeSession,
  listFeed, listStories, createStory, createPost, listDrops, listUsers,
  listConversations, getUnreadCounts, followUser, getAuthStatus,
} from './lib/api';
import { subscribeToUpdates } from './lib/realtime';
import StoryViewer from './components/StoryViewer';
import StoryEditor from './components/StoryEditor';
import type { EditorExtras } from './components/StoryEditor';
import PostCard from './components/PostCard';
import DropHub from './components/DropHub';
import MessagesView from './components/MessagesView';
import { ReelsView, ClubroomsView, SearchView, NotificationsView, SavedView } from './components/OtherViews';

type View = 'home' | 'discover' | 'hub' | 'search' | 'profile' | 'messages' | 'clubrooms' | 'notifications' | 'saved';

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
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authStatus, setAuthStatus] = useState({ googleConfigured: false, smsConfigured: false });

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
    void getAuthStatus().then(setAuthStatus);
  }, []);

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
      } else if (authMode === 'forgot') {
        setAuthError('Forgot password needs a verified phone and SMS credentials — see .env.example (DROP_TWILIO_*).');
        return;
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
            <button className={authMode === 'forgot' ? 'primary' : 'ghost'} onClick={() => setAuthMode('forgot')}>Forgot password</button>
          </div>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
          {authMode === 'signup' && <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          {authError && <div className="notice">{authError}</div>}
          <button className="primary" onClick={doAuth}>{authMode === 'signup' ? 'Create profile' : authMode === 'forgot' ? 'Send OTP' : 'Sign in'}</button>
          <button className="ghost" onClick={() => alert(authStatus.googleConfigured ? 'Continue with Google' : 'Google sign-in is coming soon — credentials needed (DROP_GOOGLE_CLIENT_ID).')}>Continue with Google {authStatus.googleConfigured ? '' : '(coming soon — credentials needed)'}</button>
          <button className="ghost" onClick={() => alert(authStatus.smsConfigured ? 'Phone OTP' : 'Phone OTP is coming soon — credentials needed (DROP_TWILIO_*).')}>Continue with phone + OTP {authStatus.smsConfigured ? '' : '(coming soon — credentials needed)'}</button>
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
      {view === 'search' && <SearchView users={users} />}
      {view === 'messages' && <MessagesView conversations={conversations} users={users} me={me} />}
      {view === 'clubrooms' && <ClubroomsView me={me} />}
      {view === 'notifications' && <NotificationsView />}
      {view === 'saved' && <SavedView />}
      {view === 'profile' && (
        <div style={{ padding: 12 }}>
          <h2>{me.displayName} (@{me.username})</h2>
          <p className="muted">{me.bio ?? ''}</p>
          <h3>Sign-in &amp; security</h3>
          <p>Google: {authStatus.googleConfigured ? 'linked' : 'coming soon — credentials needed'}</p>
          <p>Phone: {authStatus.smsConfigured ? 'linked' : 'coming soon — credentials needed'}</p>
          <button className="ghost" onClick={() => alert('Google linking needs credentials — see .env.example.')}>Link Google</button>{' '}
          <button className="ghost" onClick={() => alert('Phone linking needs SMS credentials — see .env.example.')}>Link phone</button>{' '}
          <button className="ghost" onClick={async () => { await revokeSession(); setMe(null); }}>Sign out / revoke session</button>
          <h3>Your posts</h3>
          {feed.filter((p) => p.authorId === me.id).map((p) => <div key={p.id} className="card">{p.caption}</div>)}
          <button className="ghost" onClick={() => setView('saved')}>Saved items</button>
        </div>
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
            <button key={n.id} className={view === n.id ? 'active' : ''} aria-label={n.label} onClick={() => { setView(n.id); setPanelOpen(false); }}>{n.icon}</button>
          ))}
        </div>
      )}
    </div>
  );
}
