import { useState } from 'react';
import type { User } from '../lib/api';
import {
  listReels, createReel, listClubrooms, createClubroom, joinClubroom,
  searchAll, listNotifications, markNotificationsRead, listSaved,
  followUser, blockUser, reportUser,
} from '../lib/api';
import type { Post } from '../lib/api';

export function ReelsView() {
  const [reels, setReels] = useState<{ id: number; mediaUrl: string; author?: User }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = async () => { setReels(await listReels()); setLoaded(true); };
  if (!loaded) void load();
  return (
    <div style={{ padding: 12 }}>
      <h2>Reels</h2>
      <button className="primary" onClick={async () => { await createReel('reel-media'); setReels(await listReels()); }}>+ New Reel</button>
      {reels.length === 0 && <p className="muted">No Reels yet — create one.</p>}
      {reels.map((r) => <div key={r.id} className="card">🎬 Reel by {r.author?.displayName ?? 'you'}</div>)}
    </div>
  );
}

export function ClubroomsView({ me }: { me: User }) {
  const [rooms, setRooms] = useState<{ id: number; name: string; memberIds: number[] }[]>([]);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);
  if (!loaded) { void listClubrooms().then((r) => { setRooms(r); setLoaded(true); }); }
  return (
    <div style={{ padding: 12 }}>
      <h2>Clubrooms</h2>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Clubroom name" />
        <button className="primary" onClick={async () => { if (!name.trim()) return; await createClubroom(name); setName(''); setRooms(await listClubrooms()); }}>Create</button>
      </div>
      {rooms.map((r) => (
        <div key={r.id} className="card">
          {r.name} — {r.memberIds.length} member(s)
          <button className="ghost" style={{ marginLeft: 8 }} onClick={async () => { await joinClubroom(r.id); setRooms(await listClubrooms()); }}>Join</button>
          <span className="muted"> {r.memberIds.includes(me.id) ? '· you are in' : ''}</span>
        </div>
      ))}
    </div>
  );
}

export function SearchView({ users }: { users: User[] }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ users: User[]; posts: Post[] }>({ users: [], posts: [] });
  return (
    <div style={{ padding: 12 }}>
      <h2>Search</h2>
      <input value={q} onChange={async (e) => { setQ(e.target.value); setResults(await searchAll(e.target.value)); }} placeholder="Search people and posts…" />
      {results.users.map((u) => (
        <div key={u.id} className="card">
          <span className="avatar">{u.displayName[0]}</span> {u.displayName} (@{u.username})
          <button className="ghost" style={{ marginLeft: 8 }} onClick={() => followUser(u.id)}>Follow</button>
          <button className="ghost" style={{ marginLeft: 4 }} onClick={() => blockUser(u.id)}>Block</button>
          <button className="ghost" style={{ marginLeft: 4 }} onClick={() => reportUser(u.id, 'Inappropriate content')}>Report</button>
        </div>
      ))}
      {users.length === 0 && <p className="muted">No users yet.</p>}
    </div>
  );
}

export function NotificationsView() {
  const [notes, setNotes] = useState<{ id: number; type: string; body: string; read: boolean }[]>([]);
  const [loaded, setLoaded] = useState(false);
  if (!loaded) { void listNotifications().then((n) => { setNotes(n); setLoaded(true); }); }
  return (
    <div style={{ padding: 12 }}>
      <h2>Notifications</h2>
      <button className="ghost" onClick={async () => { await markNotificationsRead(); setNotes(await listNotifications()); }}>Mark all read</button>
      {notes.length === 0 && <p className="muted">No notifications.</p>}
      {notes.map((n) => <div key={n.id} className="card">{n.read ? '' : '● '}{n.type}: {n.body}</div>)}
    </div>
  );
}

export function SavedView() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loaded, setLoaded] = useState(false);
  if (!loaded) { void listSaved().then((p) => { setPosts(p); setLoaded(true); }); }
  return (
    <div style={{ padding: 12 }}>
      <h2>Saved</h2>
      {posts.length === 0 && <p className="muted">Nothing saved yet.</p>}
      {posts.map((p) => <div key={p.id} className="card">{p.caption}</div>)}
    </div>
  );
}
