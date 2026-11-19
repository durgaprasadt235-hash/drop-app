// DROP — Page 04: Profile, Edit Profile, Privacy & Security, Room Identity.
// All data comes from real records (server when the shared DB is
// configured, local store otherwise). No dummy users, no fake counts,
// no stock images: avatars are the user's Google photo or their own
// initial; empty tabs show real empty states.

import { useEffect, useState } from 'react';
import type { Drop, Post, PrivacyPrefs, PublicProfile, User } from '../lib/api';
import {
  DEFAULT_PRIVACY, followUser, unfollowUser, listPostsByUser, listReelsByUser,
  listDropsByUser, listSaved, updateProfile, uploadProfilePhoto, getMyPrivacy,
  updateMyPrivacy, listFollowRequests, respondFollowRequest,
  listBlockedMuted, unblockUser, unmuteUser, muteUser, blockUser,
  reportUser, listFollowersFollowing, getRoomIdentity,
  joinClubroomWithIdentity, updateRoomIdentity, revokeSession,
  createConversation, openDrop, isMutedLocal, deletePost,
} from '../lib/api';
import type { FollowRequestItem, RoomIdentity } from '../lib/api';
import PostCard from './PostCard';
import { filterCss } from '../lib/filters';

function isImageUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && (/^(https?:\/\/|data:image\/)/.test(url));
}

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
  /** Opened with a real conversation id (created via createConversation). */
  onOpenConversation: (conversationId: number) => void;
  /** Owner only: open the post editor. */
  onCreatePost: () => void;
  /** Reload this profile from the server (after upload / unblock). */
  onRefresh: () => void;
}) {
  const { profile, me, isOwner } = props;
  const [tab, setTab] = useState<'posts' | 'reels' | 'drops' | 'saved'>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [reels, setReels] = useState<{ id: number; authorId: number; mediaUrl: string; createdAt: string; author?: User }[]>([]);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [saved, setSaved] = useState<Post[]>([]);
  const [rel, setRel] = useState(profile.relationship);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [listKind, setListKind] = useState<'followers' | 'following' | null>(null);
  const [listUsers, setListUsers] = useState<User[]>([]);
  const [listRel, setListRel] = useState<Record<number, string>>({});
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [selectedReel, setSelectedReel] = useState<{ id: number; mediaUrl: string; createdAt: string } | null>(null);
  const [selectedDrop, setSelectedDrop] = useState<Drop | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(() => isMutedLocal(profile.id));

  useEffect(() => { setRel(profile.relationship); setBlocked(false); setMuted(isMutedLocal(profile.id)); }, [profile.id, profile.relationship]);
  // Content comes from the server (Neon) first — listPostsByUser and
  // friends are server-first in api.ts — so tabs and header counts
  // agree, and another user's content is visible on any device.
  useEffect(() => {
    void listPostsByUser(profile.id).then(setPosts).catch(() => setPosts([]));
    void listReelsByUser(profile.id).then(setReels).catch(() => setReels([]));
    void listDropsByUser(profile.id).then(setDrops).catch(() => setDrops([]));
    if (isOwner) void listSaved().then(setSaved).catch(() => setSaved([]));
  }, [profile.id, isOwner]);

  const openList = async (kind: 'followers' | 'following') => {
    try {
      const users = await listFollowersFollowing(profile.id, kind);
      const rels: Record<number, string> = {};
      users.forEach((u) => { rels[u.id] = u.id === me.id ? 'self' : (u.relationship ?? 'none'); });
      setListRel(rels);
      setListUsers(users);
      setListKind(kind);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not load that list.');
    }
  };

  const toggleListFollow = async (u: User) => {
    try {
      if (listRel[u.id] === 'following' || listRel[u.id] === 'requested') {
        await unfollowUser(u.id);
        setListRel((r) => ({ ...r, [u.id]: 'none' }));
      } else {
        const status = await followUser(u.id);
        setListRel((r) => ({ ...r, [u.id]: status }));
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Follow failed.');
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

  const doMessage = async () => {
    if (profile.canMessage === false) {
      setNotice('This account does not accept messages from you. Check their privacy settings.');
      return;
    }
    try {
      const id = await createConversation(profile.id);
      props.onOpenConversation(id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not open this conversation.');
    }
  };

  const reloadDrops = async () => {
    const d = await listDropsByUser(profile.id).catch(() => [] as Drop[]);
    setDrops(d);
    setSelectedDrop((s) => (s ? d.find((x) => x.id === s.id) ?? null : null));
  };

  const counts = profile.counts ?? { posts: posts.length, followers: 0, following: 0 };
  // A private account hides its bio, counts and content from anyone who
  // is not an approved follower — Instagram shows a lock state instead.
  const locked = profile.isPrivate && !isOwner && rel !== 'following';

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
                  try { await uploadProfilePhoto('avatar', f); setNotice('Photo updated.'); props.onRefresh(); } catch (err) { setNotice(err instanceof Error ? err.message : 'Upload failed.'); }
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

        {/* Stats — real server counts, tap opens the real list.
            A private account hides its counts from non-followers (the
            server strips them), so the stats row is hidden in the lock
            state below instead of showing 0s. */}
        {!locked && !blocked && (
          <div className="profile-stats" role="group" aria-label="Profile statistics">
            <button type="button" onClick={() => setTab('posts')}><strong>{counts.posts}</strong><span>Posts</span></button>
            <button type="button" onClick={() => void openList('followers')}><strong>{counts.followers}</strong><span>Followers</span></button>
            <button type="button" onClick={() => void openList('following')}><strong>{counts.following}</strong><span>Following</span></button>
          </div>
        )}
        {listKind && (
          <div className="card">
            <strong>{listKind === 'followers' ? 'Followers' : 'Following'}</strong>
            <button className="ghost" style={{ float: 'right' }} onClick={() => setListKind(null)}>Close</button>
            {listUsers.length === 0 && <p className="muted">Nobody here yet.</p>}
            {listUsers.map((u) => (
              <div key={u.id} className="profile-user-row">
                <button
                  type="button"
                  onClick={() => { setListKind(null); props.onOpenUser(u.username); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', textAlign: 'left', color: 'inherit', padding: 0 }}
                >
                  <Avatar user={u} size={40} />
                  <span className="who" style={{ overflow: 'hidden' }}>
                    <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.displayName}</strong>
                    <span className="muted">@{u.username}</span>
                  </span>
                </button>
                {listRel[u.id] !== 'self' && (
                  listRel[u.id] === 'following' || listRel[u.id] === 'requested' ? (
                    <button className="ghost" onClick={() => void toggleListFollow(u)}>{listRel[u.id] === 'following' ? 'Following' : 'Requested'}</button>
                  ) : (
                    <button className="primary" style={{ padding: '8px 14px' }} onClick={() => void toggleListFollow(u)}>Follow</button>
                  )
                )}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        {blocked ? (
          <div className="card" style={{ margin: '12px 0' }}>
            <strong>You blocked @{profile.username}.</strong>
            <p className="muted">You will not see each other&apos;s profiles, posts or messages.</p>
            <button className="ghost" onClick={async () => { try { await unblockUser(profile.id); setBlocked(false); props.onRefresh(); } catch (err) { setNotice(err instanceof Error ? err.message : 'Unblock failed.'); } }}>Unblock</button>
          </div>
        ) : locked ? (
          <div className="card" style={{ margin: '12px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 32 }}>🔒</div>
            <strong>This account is private</strong>
            <p className="muted">Follow to see their photos, Reels and Drops.</p>
            {rel === 'requested' ? (
              <button className="ghost" onClick={async () => { await unfollowUser(profile.id); setRel('none'); }}>Requested — tap to cancel</button>
            ) : (
              <button className="primary" onClick={doFollow}>Follow</button>
            )}
          </div>
        ) : isOwner ? (
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
            <button className="ghost" onClick={doMessage}>Message</button>
            <button className="ghost" onClick={() => setMoreOpen((v) => !v)}>More</button>
          </div>
        )}
        {moreOpen && !isOwner && !blocked && !locked && (
          <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="ghost" onClick={async () => { try { if (muted) { await unmuteUser(profile.id); setMuted(false); setNotice(`Unmuted @${profile.username}.`); } else { await muteUser(profile.id); setMuted(true); setNotice(`Muted @${profile.username}. Their posts will not appear in your feed.`); } } catch (err) { setNotice(err instanceof Error ? err.message : 'Could not change mute.'); } setMoreOpen(false); }}>{muted ? 'Unmute' : 'Mute'}</button>
            <button className="ghost" onClick={async () => { try { await blockUser(profile.id); setBlocked(true); } catch (err) { setNotice(err instanceof Error ? err.message : 'Block failed.'); } setMoreOpen(false); }}>Block</button>
            <button className="ghost" onClick={async () => { try { await reportUser(profile.id, 'Inappropriate content'); setNotice('Reported. Our team will review it.'); } catch (err) { setNotice(err instanceof Error ? err.message : 'Report failed.'); } setMoreOpen(false); }}>Report</button>
          </div>
        )}

        {/* Content tabs — Instagram-style: icon + label, 3-column grid.
            Every tile is a real record (server first); taps open the real
            post / Reel / Drop. No placeholder tiles, no fake images:
            posts in this app carry text + filter + effects (no photo
            upload for posts yet), so a text tile shows the caption on the
            post's own filter; an image tile renders the real photo. */}
        {!locked && !blocked && (
          <>
            <div className="profile-tabs" role="tablist">
              {([
                ['posts', '▦', 'Posts'],
                ['reels', '🎬', 'Reels'],
                ['drops', '💧', 'Drops'],
                ...(isOwner ? [['saved', '🔖', 'Saved']] as const : []),
              ] as const).map(([t, icon, label]) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t as any)}>
                  {icon} {label}
                </button>
              ))}
            </div>
            {tab === 'posts' && (
              posts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <p className="muted">No posts yet.</p>
                  {isOwner && <button className="primary" onClick={props.onCreatePost}>Create your first post</button>}
                </div>
              ) : (
                <div className="profile-grid">
                  {posts.map((p) => (
                    <button key={p.id} type="button" className="profile-tile" onClick={() => setSelectedPost(p)} aria-label={`Open post: ${p.caption.slice(0, 40)}`}>
                      {isImageUrl(p.mediaUrl) ? (
                        <img src={p.mediaUrl} alt="" style={{ filter: filterCss(p.filter ?? 'original') }} />
                      ) : (
                        <span style={{ filter: filterCss(p.filter ?? 'original') }}>{p.caption ? p.caption.slice(0, 60) : '✦'}</span>
                      )}
                    </button>
                  ))}
                </div>
              )
            )}
            {tab === 'reels' && (
              reels.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <p className="muted">No Reels yet.</p>
                  {isOwner && <p className="muted">Create one from Discover → Reels.</p>}
                </div>
              ) : (
                <div className="profile-grid">
                  {reels.map((r) => (
                    <button key={r.id} type="button" className="profile-tile" onClick={() => setSelectedReel(r)} aria-label="Open Reel">
                      {isImageUrl(r.mediaUrl) ? <img src={r.mediaUrl} alt="" /> : <span>🎬<br />Reel</span>}
                    </button>
                  ))}
                </div>
              )
            )}
            {tab === 'drops' && (
              drops.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <p className="muted">No Drops yet.</p>
                  {isOwner && <p className="muted">Create one from the Hub (+ Drop).</p>}
                </div>
              ) : (
                <div className="profile-grid">
                  {drops.map((d) => (
                    <button key={d.id} type="button" className="profile-tile" onClick={() => setSelectedDrop(d)} aria-label={`Open Drop, ${d.status}`}>
                      <span>💧<br />{d.status === 'waiting' ? 'Sealed' : d.status === 'ready' ? 'Ready to Blast' : 'Revealed'}</span>
                    </button>
                  ))}
                </div>
              )
            )}
            {tab === 'saved' && (
              saved.length === 0 ? (
                <p className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>Nothing saved yet.</p>
              ) : (
                <div className="profile-grid">
                  {saved.map((p) => (
                    <button key={p.id} type="button" className="profile-tile" onClick={() => setSelectedPost(p)} aria-label={`Open saved post: ${p.caption.slice(0, 40)}`}>
                      {isImageUrl(p.mediaUrl) ? (
                        <img src={p.mediaUrl} alt="" style={{ filter: filterCss(p.filter ?? 'original') }} />
                      ) : (
                        <span style={{ filter: filterCss(p.filter ?? 'original') }}>{p.caption ? p.caption.slice(0, 60) : '✦'}</span>
                      )}
                    </button>
                  ))}
                </div>
              )
            )}
          </>
        )}
        {/* Post detail — the real post with Fire and comments. */}
        {selectedPost && (
          <div className="profile-modal" onClick={() => setSelectedPost(null)}>
            <div className="profile-modal-card" onClick={(e) => e.stopPropagation()}>
              <button className="ghost" onClick={() => setSelectedPost(null)}>✕ Close</button>
              <PostCard
                post={{ ...selectedPost, author: { id: profile.id, username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl ?? null } }}
                following={rel === 'following'}
                onFollow={async (id) => { if (id === me.id) return; await followUser(id); setRel('following'); }}
              />
              {isOwner && (
                <button className="ghost" style={{ marginTop: 8 }} onClick={async () => { try { await deletePost(selectedPost.id); setPosts((ps) => ps.filter((x) => x.id !== selectedPost.id)); setSelectedPost(null); } catch (err) { setNotice(err instanceof Error ? err.message : 'Delete failed.'); } }}>Delete this post</button>
              )}
            </div>
          </div>
        )}
        {/* Reel detail — Reels in this build carry no video upload yet,
            so the tile is honest about that instead of faking a player. */}
        {selectedReel && (
          <div className="profile-modal" onClick={() => setSelectedReel(null)}>
            <div className="profile-modal-card" onClick={(e) => e.stopPropagation()}>
              <button className="ghost" onClick={() => setSelectedReel(null)}>✕ Close</button>
              <div style={{ textAlign: 'center', padding: 24 }}>
                <div style={{ fontSize: 48 }}>🎬</div>
                <p>Reel by {profile.displayName}</p>
                <p className="muted">{new Date(selectedReel.createdAt).toLocaleString()}</p>
                {isImageUrl(selectedReel.mediaUrl) && <img src={selectedReel.mediaUrl} alt="" style={{ maxWidth: '100%', borderRadius: 12 }} />}
                <p className="muted">Video upload is not available for Reels yet — this Reel was created without media.</p>
              </div>
            </div>
          </div>
        )}
        {/* Drop detail — sealed content stays sealed until blast time. */}
        {selectedDrop && (
          <div className="profile-modal" onClick={() => setSelectedDrop(null)}>
            <div className="profile-modal-card" onClick={(e) => e.stopPropagation()}>
              <button className="ghost" onClick={() => setSelectedDrop(null)}>✕ Close</button>
              <div style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 48 }}>💧</div>
                <p><strong>{selectedDrop.kind === 'protected' ? 'Protected' : 'Public'} Drop</strong> — {selectedDrop.status === 'waiting' ? 'Sealed' : selectedDrop.status === 'ready' ? 'Ready to Blast' : 'Revealed'}</p>
                <p className="muted">Blasts {new Date(selectedDrop.blastAt).toLocaleString()}</p>
                {selectedDrop.status === 'waiting' && selectedDrop.creatorId !== me.id ? (
                  <p className="muted">This Drop is sealed until it Blasts.</p>
                ) : (
                  <>
                    {selectedDrop.caption && <p>{selectedDrop.caption}</p>}
                    {isImageUrl(selectedDrop.mediaUrl) && <img src={selectedDrop.mediaUrl} alt="" style={{ maxWidth: '100%', borderRadius: 12 }} />}
                    {selectedDrop.status !== 'revealed' && (
                      <button className="primary" onClick={async () => { try { await openDrop(selectedDrop.id); await reloadDrops(); } catch (err) { setNotice(err instanceof Error ? err.message : 'Could not open this Drop.'); } }}>Open Drop</button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        <p className="muted" style={{ marginTop: 16 }}>Signed in as {me.displayName} (@{me.username})</p>
      </div>
    </div>
  );
}

// -------------------------------------------------------- edit profile ----
export function EditProfilePage({ me, onBack, onSaved, onRefresh }: { me: User; onBack: () => void; onSaved: (u: User) => void; onRefresh?: () => void }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio ?? '');
  const [location, setLocation] = useState(me.location ?? '');
  const [birthday, setBirthday] = useState(me.birthday ?? '');
  const [linksText, setLinksText] = useState((me.links ?? []).map((l) => l.url).join('\n'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Avatar preview updates immediately after an upload instead of
  // showing the old photo until the next navigation.
  const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl ?? null);
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
          <Avatar user={{ displayName: me.displayName, avatarUrl }} size={88} />
          <label className="ghost" style={{ cursor: 'pointer', fontSize: 13 }}>
            Change Profile Photo
            <input
              type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { const url = await uploadProfilePhoto('avatar', f); setAvatarUrl(url); setError(''); onRefresh?.(); } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
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
                try { await uploadProfilePhoto('cover', f); setError(''); onRefresh?.(); } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
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
