// DROP — Page 04: Profile, Edit Profile, Privacy & Security, Room Identity.
// All data comes from real records (server when the shared DB is
// configured, local store otherwise). No dummy users, no fake counts,
// no stock images: avatars are the user's Google photo or their own
// initial; empty tabs show real empty states.

import { useEffect, useState } from 'react';
import type { Post, PrivacyPrefs, PublicProfile, User } from '../lib/api';
import {
  DEFAULT_PRIVACY, followUser, unfollowUser, listPostsByUser, listReels,
  listDrops, listSaved, updateProfile, uploadProfilePhoto, getMyPrivacy,
  updateMyPrivacy, listFollowRequests, respondFollowRequest,
  listBlockedMuted, unblockUser, unmuteUser, muteUser, blockUser,
  reportUser, listFollowersFollowing, getRoomIdentity,
  joinClubroomWithIdentity, updateRoomIdentity, revokeSession,
} from '../lib/api';
import type { FollowRequestItem, RoomIdentity } from '../lib/api';

function initials(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function Avatar({ user, size }: { user: { displayName: string; avatarUrl?: string | null }; size: number }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  }
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size / 3 }}>
      {initials(user.displayName)}
    </span>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        minWidth: 52, minHeight: 32, borderRadius: 999, border: '1px solid var(--border)',
        background: on ? 'linear-gradient(135deg, var(--accent), var(--accent2))' : 'var(--surface)',
        color: on ? '#fff' : 'inherit', fontWeight: 700,
      }}
    >
      {on ? 'On' : 'Off'}
    </button>
  );
}

// ------------------------------------------------------------ profile -----
export function ProfilePage(props: {
  profile: PublicProfile;
  me: User;
  onEdit: () => void;
  onPrivacy: () => void;
  onAdmin: () => void;
  isOwner: boolean;
  onOpenUser: (username: string) => void;
  onMessage: (userId: number) => void;
}) {
  const { profile, me, isOwner } = props;
  const [tab, setTab] = useState<'posts' | 'reels' | 'drops' | 'saved'>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [reels, setReels] = useState<any[]>([]);
  const [drops, setDrops] = useState<any[]>([]);
  const [saved, setSaved] = useState<Post[]>([]);
  const [rel, setRel] = useState(profile.relationship);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [listKind, setListKind] = useState<'followers' | 'following' | null>(null);
  const [listUsers, setListUsers] = useState<User[]>([]);

  useEffect(() => { setRel(profile.relationship); }, [profile.relationship]);
  useEffect(() => {
    void listPostsByUser(profile.id).then(setPosts);
    void listReels().then((r) => setReels(r.filter((x: any) => x.authorId === profile.id)));
    void listDrops().then((d) => setDrops(d.filter((x: any) => x.creatorId === profile.id)));
    if (isOwner) void listSaved().then(setSaved);
  }, [profile.id, isOwner]);

  const openList = async (kind: 'followers' | 'following') => {
    try {
      setListUsers(await listFollowersFollowing(profile.id, kind));
      setListKind(kind);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not load that list.');
    }
  };

  const doFollow = async () => {
    try {
      const status = await followUser(profile.id);
      setRel(status);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Follow failed.');
    }
  };

  const counts = profile.counts ?? { posts: posts.length, followers: 0, following: 0 };

  return (
    <div>
      {/* Cover */}
      <div className="profile-cover">
        {profile.coverUrl ? <img src={profile.coverUrl} alt="" /> : <span className="muted">No cover photo yet</span>}
      </div>
      <div style={{ padding: '0 12px' }}>
        <div className="profile-avatar-wrap">
          <Avatar user={profile} size={88} />
          {isOwner && (
            <label className="ghost" style={{ cursor: 'pointer', fontSize: 13 }}>
              Change photo
              <input
                type="file" accept="image/jpeg,image/png,image/webp" hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try { await uploadProfilePhoto('avatar', f); setNotice('Photo updated.'); } catch (err) { setNotice(err instanceof Error ? err.message : 'Upload failed.'); }
                }}
              />
            </label>
          )}
        </div>
        <h2 style={{ margin: '8px 0 0' }}>{profile.displayName}</h2>
        <p className="muted" style={{ margin: '2px 0' }}>@{profile.username}{profile.isPrivate ? ' · 🔒 Private' : ''}</p>
        {profile.bio ? <p style={{ whiteSpace: 'pre-wrap' }}>{profile.bio}</p> : <p className="muted">No bio yet.</p>}
        {(profile.links ?? []).map((l) => (
          <p key={l.url} style={{ margin: '2px 0' }}><a href={l.url} target="_blank" rel="noreferrer">{l.label}</a></p>
        ))}
        {profile.location && <p className="muted">📍 {profile.location}</p>}
        {notice && <div className="notice">{notice}</div>}

        {/* Stats — real counts, tap opens the list */}
        <div className="profile-stats" role="group" aria-label="Profile statistics">
          <button type="button" onClick={() => setTab('posts')}><strong>{counts.posts}</strong><span>Posts</span></button>
          <button type="button" onClick={() => void openList('followers')}><strong>{counts.followers}</strong><span>Followers</span></button>
          <button type="button" onClick={() => void openList('following')}><strong>{counts.following}</strong><span>Following</span></button>
        </div>
        {listKind && (
          <div className="card">
            <strong>{listKind === 'followers' ? 'Followers' : 'Following'}</strong>
            <button className="ghost" style={{ float: 'right' }} onClick={() => setListKind(null)}>Close</button>
            {listUsers.length === 0 && <p className="muted">Nobody here yet.</p>}
            {listUsers.map((u) => (
              <p key={u.id}><button className="ghost" onClick={() => props.onOpenUser(u.username)}>@{u.username}</button> {u.displayName}</p>
            ))}
          </div>
        )}

        {/* Actions */}
        {isOwner ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
            <button className="primary" onClick={props.onEdit}>Edit Profile</button>
            <button
              className="ghost"
              onClick={async () => {
                const url = `${window.location.origin}/profile/${profile.username}`;
                try {
                  if (navigator.share) await navigator.share({ title: 'DROP profile', url });
                  else { await navigator.clipboard.writeText(url); setNotice('Profile link copied.'); }
                } catch { /* share cancelled */ }
              }}
            >
              Share Profile
            </button>
            <button className="ghost" onClick={props.onPrivacy}>⚙️ Settings</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
            {rel === 'following' ? (
              <button className="ghost" onClick={async () => { await unfollowUser(profile.id); setRel('none'); }}>Following</button>
            ) : rel === 'requested' ? (
              <button className="ghost" onClick={async () => { await unfollowUser(profile.id); setRel('none'); }}>Requested — tap to cancel</button>
            ) : (
              <button className="primary" onClick={doFollow}>Follow</button>
            )}
            <button className="ghost" onClick={() => props.onMessage(profile.id)}>Message</button>
            <button className="ghost" onClick={() => setMoreOpen((v) => !v)}>More</button>
          </div>
        )}
        {moreOpen && !isOwner && (
          <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="ghost" onClick={async () => { await muteUser(profile.id); setNotice(`Muted @${profile.username}. Their posts will not appear in your feed.`); setMoreOpen(false); }}>Mute</button>
            <button className="ghost" onClick={async () => { await blockUser(profile.id); setNotice(`Blocked @${profile.username}.`); setMoreOpen(false); }}>Block</button>
            <button className="ghost" onClick={async () => { await reportUser(profile.id, 'Inappropriate content'); setNotice('Reported. Thank you.'); setMoreOpen(false); }}>Report</button>
          </div>
        )}

        {/* Content tabs */}
        <div className="profile-tabs" role="tablist">
          {(['posts', 'reels', 'drops', ...(isOwner ? ['saved'] as const : [])] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t as any)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {tab === 'posts' && (
          posts.length === 0 ? <p className="muted">No posts yet.</p>
            : posts.map((p) => <div key={p.id} className="card">{p.caption}{p.mediaUrl ? <div className="post-media" style={{ fontSize: 20 }}>{p.mediaUrl}</div> : null}</div>)
        )}
        {tab === 'reels' && (
          reels.length === 0 ? <p className="muted">No Reels yet.</p>
            : reels.map((r: any) => <div key={r.id} className="card">🎬 Reel — {r.mediaUrl}</div>)
        )}
        {tab === 'drops' && (
          drops.length === 0 ? <p className="muted">No Drops yet.</p>
            : drops.map((d: any) => <div key={d.id} className="card">💧 {d.caption ?? 'Sealed Drop'} — {d.status}</div>)
        )}
        {tab === 'saved' && (
          saved.length === 0 ? <p className="muted">Nothing saved yet.</p>
            : saved.map((p) => <div key={p.id} className="card">{p.caption}</div>)
        )}
        <p className="muted" style={{ marginTop: 16 }}>Signed in as {me.displayName} (@{me.username})</p>
      </div>
    </div>
  );
}

// -------------------------------------------------------- edit profile ----
export function EditProfilePage({ me, onBack, onSaved }: { me: User; onBack: () => void; onSaved: (u: User) => void }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio ?? '');
  const [location, setLocation] = useState(me.location ?? '');
  const [birthday, setBirthday] = useState(me.birthday ?? '');
  const [linksText, setLinksText] = useState((me.links ?? []).map((l) => l.url).join('\n'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = displayName !== me.displayName || username !== me.username || bio !== (me.bio ?? '')
    || location !== (me.location ?? '') || birthday !== (me.birthday ?? '')
    || linksText !== (me.links ?? []).map((l) => l.url).join('\n');

  const save = async () => {
    setError('');
    const links = linksText.split('\n').map((s) => s.trim()).filter(Boolean).map((url) => ({ label: url, url }));
    if (bio.length > 150) { setError('Bio must be 150 characters or fewer.'); return; }
    setSaving(true);
    try {
      const updated = await updateProfile({ id: me.id, displayName: displayName.trim(), username: username.trim(), bio, location: location.trim(), birthday: birthday || undefined, links });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="ghost" aria-label="Back" onClick={() => { if (dirty) setConfirmDiscard(true); else onBack(); }}>←</button>
        <h2 style={{ flex: 1 }}>Edit Profile</h2>
        <button className="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {confirmDiscard && (
        <div className="notice">
          You have unsaved changes. Discard them?
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="primary" onClick={onBack}>Discard</button>
            <button className="ghost" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar user={me} size={88} />
          <label className="ghost" style={{ cursor: 'pointer', fontSize: 13 }}>
            Change Profile Photo
            <input
              type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { await uploadProfilePhoto('avatar', f); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
              }}
            />
          </label>
          <label className="ghost" style={{ cursor: 'pointer', fontSize: 13 }}>
            Change Cover Photo
            <input
              type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { await uploadProfilePhoto('cover', f); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
              }}
            />
          </label>
        </div>
        <label>Display Name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@username" /></label>
        <label>Bio<textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} /> <span className="muted">{bio.length}/150</span></label>
        <label>Links (one https:// URL per line, max 5)<textarea value={linksText} onChange={(e) => setLinksText(e.target.value)} rows={3} /></label>
        <label>Location<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, Country" /></label>
        <label>Birthday<input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></label>
        {error && <div className="notice">{error}</div>}
        <p className="muted">Changing your username does not break your posts or Drops — they are linked to your account, not your username.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------- privacy & security -----
export function PrivacyPage({ me, onBack, onSignOut }: { me: User; onBack: () => void; onSignOut: () => void }) {
  const [prefs, setPrefs] = useState<PrivacyPrefs | null>(null);
  const [incoming, setIncoming] = useState<FollowRequestItem[]>([]);
  const [blocked, setBlocked] = useState<User[]>([]);
  const [muted, setMuted] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [savedNote, setSavedNote] = useState('');

  useEffect(() => {
    void getMyPrivacy().then(setPrefs).catch((e) => setError(e instanceof Error ? e.message : 'Could not load privacy settings.'));
    void listFollowRequests().then((r) => setIncoming(r.incoming)).catch(() => undefined);
    void listBlockedMuted().then((r) => { setBlocked(r.blocked); setMuted(r.muted); }).catch(() => undefined);
  }, []);

  const change = async (next: PrivacyPrefs) => {
    setPrefs(next);
    try {
      await updateMyPrivacy(next);
      setSavedNote('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save privacy settings.');
    }
  };

  const select = (label: string, value: PrivacyPrefs['whoCanMessage'], onChange: (v: PrivacyPrefs['whoCanMessage']) => void) => (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as PrivacyPrefs['whoCanMessage'])} style={{ width: 'auto' }}>
        <option value="everyone">Everyone</option>
        <option value="friends">Friends only</option>
        <option value="nobody">Nobody</option>
      </select>
    </label>
  );

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="ghost" aria-label="Back" onClick={onBack}>←</button>
        <h2 style={{ flex: 1 }}>Privacy &amp; Security</h2>
      </div>
      {error && <div className="notice">{error}</div>}
      {savedNote && <p className="muted">{savedNote}</p>}
      {!prefs ? <p className="muted">Loading…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section>
            <h3>Account Privacy</h3>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>🔒 Profile Visibility — {prefs.isPrivate ? 'Private' : 'Public'}<br /><span className="muted">{prefs.isPrivate ? 'Only approved followers see your content.' : 'Anyone can see your profile, posts and Drops.'}</span></span>
                <Toggle label="Profile visibility" on={prefs.isPrivate} onChange={(v) => void change({ ...prefs, isPrivate: v })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>🟢 Activity Status — show when you&apos;re active</span>
                <Toggle label="Activity status" on={prefs.activityStatus} onChange={(v) => void change({ ...prefs, activityStatus: v })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>✓✓ Read Receipts — let others know when you&apos;ve read messages</span>
                <Toggle label="Read receipts" on={prefs.readReceipts} onChange={(v) => void change({ ...prefs, readReceipts: v })} />
              </div>
            </div>
          </section>
          <section>
            <h3>Connections</h3>
            <div className="card">
              <strong>Follow Requests ({incoming.length})</strong>
              {incoming.length === 0 && <p className="muted">No pending requests.</p>}
              {incoming.map((r) => (
                <p key={r.id}>
                  @{r.username} — {r.displayName}
                  <button className="primary" style={{ marginLeft: 8 }} onClick={async () => { await respondFollowRequest(r.id, true); setIncoming((x) => x.filter((y) => y.id !== r.id)); }}>Accept</button>
                  <button className="ghost" style={{ marginLeft: 4 }} onClick={async () => { await respondFollowRequest(r.id, false); setIncoming((x) => x.filter((y) => y.id !== r.id)); }}>Decline</button>
                </p>
              ))}
              <strong>Blocked Accounts ({blocked.length})</strong>
              {blocked.length === 0 && <p className="muted">No blocked accounts.</p>}
              {blocked.map((u) => (
                <p key={u.id}>@{u.username} <button className="ghost" style={{ marginLeft: 8 }} onClick={async () => { await unblockUser(u.id); setBlocked((x) => x.filter((y) => y.id !== u.id)); }}>Unblock</button></p>
              ))}
              <strong>Muted Accounts ({muted.length})</strong>
              {muted.length === 0 && <p className="muted">No muted accounts.</p>}
              {muted.map((u) => (
                <p key={u.id}>@{u.username} <button className="ghost" style={{ marginLeft: 8 }} onClick={async () => { await unmuteUser(u.id); setMuted((x) => x.filter((y) => y.id !== u.id)); }}>Unmute</button></p>
              ))}
            </div>
          </section>
          <section>
            <h3>Message &amp; Interaction</h3>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {select('Who Can Message You', prefs.whoCanMessage, (v) => void change({ ...prefs, whoCanMessage: v }))}
              {select('Slash Invitations', prefs.whoCanSlash, (v) => void change({ ...prefs, whoCanSlash: v }))}
              {select('Mentions', prefs.whoCanMention, (v) => void change({ ...prefs, whoCanMention: v }))}
              {select('Tagging', prefs.whoCanTag, (v) => void change({ ...prefs, whoCanTag: v }))}
            </div>
          </section>
          <section>
            <h3>Clubroom Privacy</h3>
            <div className="card">
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                Default room identity
                <select value={prefs.defaultRoomIdentity} onChange={(e) => void change({ ...prefs, defaultRoomIdentity: e.target.value as 'drop' | 'room' })} style={{ width: 'auto' }}>
                  <option value="drop">My DROP Profile</option>
                  <option value="room">Room Identity</option>
                </select>
              </label>
              <p className="muted">A room identity hides your main DROP profile from other members in that room.</p>
            </div>
          </section>
          <section>
            <h3>Account Security</h3>
            <div className="card">
              <p>Signed in as {me.displayName} (@{me.username}){me.email ? ` — ${me.email}` : ''}</p>
              <p className="muted">Google sign-in is linked. Sessions last 30 days and can be revoked.</p>
              <button className="ghost" onClick={async () => { await revokeSession(); onSignOut(); }}>Sign out / revoke session</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------- room identity ----
export function RoomIdentityPage({ me, clubroomId, clubroomName, onBack }: { me: User; clubroomId: number; clubroomName: string; onBack: () => void }) {
  const [mode, setMode] = useState<'drop' | 'room'>('drop');
  const [alias, setAlias] = useState('');
  const [members, setMembers] = useState<{ identityMode: string; displayName: string; username?: string; avatarUrl?: string | null }[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getRoomIdentity(clubroomId).then((d) => {
      if (d.myIdentity) { setMode(d.myIdentity.mode); setAlias(d.myIdentity.alias ?? ''); }
      setMembers(d.members);
      setIsMember(d.member);
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load room identity.'));
  }, [clubroomId]);

  const save = async () => {
    setError('');
    const identity: RoomIdentity = { mode, alias: mode === 'room' ? alias.trim() : null, avatarUrl: me.avatarUrl ?? null };
    try {
      if (isMember) await updateRoomIdentity(clubroomId, identity);
      else await joinClubroomWithIdentity(clubroomId, identity);
      setIsMember(true);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save room identity.');
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="ghost" aria-label="Back" onClick={onBack}>←</button>
        <h2 style={{ flex: 1 }}>Room Identity</h2>
      </div>
      <p className="muted">Choose how you appear in <strong>{clubroomName}</strong>.</p>
      {error && <div className="notice">{error}</div>}
      {saved && <p className="muted">Saved — you are in the room as {mode === 'room' ? alias : me.displayName}.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button className={mode === 'drop' ? 'primary' : 'ghost'} onClick={() => setMode('drop')} style={{ textAlign: 'left' }}>
          👤 Use My DROP Profile<br /><span style={{ fontWeight: 400 }}>Join rooms with your main profile (visible name, photo and identity).</span>
        </button>
        <button className={mode === 'room' ? 'primary' : 'ghost'} onClick={() => setMode('room')} style={{ textAlign: 'left' }}>
          🎭 Join with a Room Identity<br /><span style={{ fontWeight: 400 }}>Use a unique name and photo for specific rooms (your DROP profile stays hidden).</span>
        </button>
        {mode === 'room' && (
          <label>Room Identity (Alias)<input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. TravelExplorer" /></label>
        )}
        <div className="card">
          <strong>Privacy Note</strong>
          <p className="muted">Room identity hides your main DROP profile from other members. Your account remains secure and verified within DROP.</p>
        </div>
        <button className="primary" onClick={save}>{isMember ? 'Save Room Identity' : 'Join with this identity'}</button>
        <div>
          <h3>Members (as they appear in this room)</h3>
          {members.length === 0 && <p className="muted">No members yet.</p>}
          {members.map((m, i) => (
            <p key={i}>{m.identityMode === 'room' ? '🎭 ' : '👤 '}{m.displayName}{m.username ? ` (@${m.username})` : ''}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_PRIVACY };
