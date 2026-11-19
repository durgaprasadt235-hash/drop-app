// DROP — Settings hub + every settings screen.
// Design (user-confirmed): plain white background, simple black text
// (big bold headings, regular body, grey explanations), generous white
// space, one setting per row in clean rounded cards, simple toggles /
// radio controls. Dark navy #0B1327 stays the dark option via the
// existing body.dark rules. No dummy data anywhere: every list shows
// only the user's real DROP records; empty states show real empty data.
// Anything that cannot be enforced yet says so honestly in the UI.

import { useEffect, useState } from 'react';
import type { User, UserSettings } from '../lib/api';
import {
  DEFAULT_SETTINGS, SETTINGS_LANGUAGES,
  getMySettings, updateMySettings,
  getMyPrivacy, updateMyPrivacy,
  listCloseFriends, addCloseFriend, removeCloseFriend,
  listHiddenFrom, addHiddenFrom, removeHiddenFrom,
  listRestricted, unrestrictUser,
  listHiddenWords, addHiddenWord, removeHiddenWord,
  listMutedUsers, unmuteUser,
  listBlockedMuted, unblockUser,
  listServerNotifications, markNotificationsRead,
  listArchive, deleteArchived,
  listConnectedApps, getAccountStatus,
  listMessageRequests, answerMessageRequest,
  listFollowersFollowing, getMyProfileServer,
  listFollowers, listFollowing, revokeSession,
} from '../lib/api';
import type { ArchivedStory, ConnectedApp, AccountStatus, MessageRequestItem, ServerNotification } from '../lib/api';
import { PrivacyPage } from './ProfileViews';

export type SettingsScreen =
  | 'hub' | 'notifications' | 'archive' | 'accessibility' | 'language' | 'apps'
  | 'privacy' | 'close-friends' | 'blocked' | 'hide-story-from'
  | 'messages' | 'message-requests' | 'story-replies' | 'tags-mentions'
  | 'comments' | 'sharing' | 'restricted' | 'hidden-words' | 'muted'
  | 'content-prefs' | 'like-counts' | 'profile-type'
  | 'help' | 'status' | 'family-center';

const SCREEN_TITLES: Record<Exclude<SettingsScreen, 'hub'>, string> = {
  notifications: 'Notifications',
  archive: 'Archiving and downloading',
  accessibility: 'Accessibility',
  language: 'Language',
  apps: 'Apps and websites',
  privacy: 'Profile privacy',
  'close-friends': 'Close Friends',
  blocked: 'Blocked',
  'hide-story-from': 'Hide story from',
  messages: 'Messages and story replies',
  'message-requests': 'Message requests',
  'story-replies': 'Story replies',
  'tags-mentions': 'Tags and mentions',
  comments: 'Comments',
  sharing: 'Sharing',
  restricted: 'Restricted',
  'hidden-words': 'Hidden Words',
  muted: 'Muted',
  'content-prefs': 'Content preferences',
  'like-counts': 'Like and share counts',
  'profile-type': 'Profile type and tools',
  help: 'Help',
  status: 'Profile status',
  'family-center': 'Family Center',
};

// ------------------------------------------------------------ helpers -----
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        minWidth: 52, minHeight: 32, borderRadius: 999, border: '1px solid var(--border)',
        background: on ? 'linear-gradient(135deg, var(--accent), var(--accent2))' : 'var(--surface)',
        color: on ? '#fff' : 'inherit', fontWeight: 700, flexShrink: 0,
      }}
    >
      {on ? 'On' : 'Off'}
    </button>
  );
}

function Row({ title, explain, control }: { title: string; explain?: string; control?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block' }}>{title}</strong>
        {explain && <span className="muted">{explain}</span>}
      </span>
      {control}
    </div>
  );
}

function RadioRow({ label, explain, checked, onSelect }: { label: string; explain?: string; checked: boolean; onSelect: () => void }) {
  return (
    <button
      type="button" onClick={onSelect}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', padding: '12px 0', border: 'none', borderBottom: '1px solid var(--border)', background: 'none', textAlign: 'left', color: 'inherit' }}
    >
      <span style={{ flex: 1 }}>
        <strong style={{ display: 'block' }}>{label}</strong>
        {explain && <span className="muted">{explain}</span>}
      </span>
      <span aria-hidden style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        border: checked ? '7px solid var(--accent)' : '2px solid var(--border)',
      }} />
    </button>
  );
}

function Screen({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="ghost" aria-label="Back" onClick={onBack}>←</button>
        <h2 style={{ flex: 1, margin: 0 }}>{title}</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '4px 12px' }}>{children}</div>;
}

function Avatar({ user, size }: { user: { displayName: string; avatarUrl?: string | null }; size: number }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  }
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size / 3 }}>
      {(user.displayName.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function useSettings(): { settings: UserSettings | null; error: string; patch: (p: Partial<UserSettings>) => Promise<void> } {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void getMySettings().then(setSettings).catch((e) => setError(e instanceof Error ? e.message : 'Could not load settings.'));
  }, []);
  const patch = async (p: Partial<UserSettings>) => {
    if (!settings) return;
    const prev = settings;
    setSettings({ ...settings, ...p });
    try {
      setSettings(await updateMySettings(p));
    } catch (e) {
      setSettings(prev);
      setError(e instanceof Error ? e.message : 'Could not save that setting.');
    }
  };
  return { settings, error, patch };
}

async function loadCandidates(me: User): Promise<User[]> {
  const [following, followers] = await Promise.all([
    listFollowersFollowing(me.id, 'following').catch(() => [] as User[]),
    listFollowersFollowing(me.id, 'followers').catch(() => [] as User[]),
  ]);
  const seen = new Set<number>();
  return [...following, ...followers].filter((u) => {
    if (u.id === me.id || seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

/** Searchable user picker: radio-circle rows, add/remove. Real records only. */
function UserPicker({ me, selectedIds, onAdd, onRemove, emptyNote }: {
  me: User;
  selectedIds: Set<number>;
  onAdd: (id: number) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  emptyNote: string;
}) {
  const [candidates, setCandidates] = useState<User[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    void loadCandidates(me).then(setCandidates).catch(() => setCandidates([]));
  }, [me]);
  const shown = candidates.filter((u) =>
    u.username.toLowerCase().includes(q.toLowerCase()) || u.displayName.toLowerCase().includes(q.toLowerCase()));
  const selected = candidates.filter((u) => selectedIds.has(u.id));
  const toggle = async (u: User) => {
    setBusy(u.id);
    setError('');
    try {
      if (selectedIds.has(u.id)) await onRemove(u.id);
      else await onAdd(u.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that change.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" />
      {error && <div className="notice">{error}</div>}
      {selected.length > 0 && (
        <Card>
          <p><strong>Selected ({selected.length})</strong></p>
          {selected.map((u) => (
            <div key={u.id} className="profile-user-row">
              <Avatar user={u} size={40} />
              <span className="who"><strong style={{ display: 'block' }}>{u.displayName}</strong><span className="muted">@{u.username}</span></span>
              <button className="ghost" disabled={busy === u.id} onClick={() => void toggle(u)}>Remove</button>
            </div>
          ))}
        </Card>
      )}
      <Card>
        {shown.length === 0 && <p className="muted">{candidates.length === 0 ? emptyNote : 'No one matches that search.'}</p>}
        {shown.filter((u) => !selectedIds.has(u.id)).map((u) => (
          <div key={u.id} className="profile-user-row">
            <Avatar user={u} size={40} />
            <span className="who"><strong style={{ display: 'block' }}>{u.displayName}</strong><span className="muted">@{u.username}</span></span>
            <button
              type="button" aria-label={selectedIds.has(u.id) ? 'Selected' : 'Select'} disabled={busy === u.id}
              onClick={() => void toggle(u)}
              style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                border: '2px solid var(--border)', background: 'none',
              }}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}

// --------------------------------------------------------- screens ------
function NotificationsScreen({ onBack }: { onBack: () => void }) {
  const { settings, error, patch } = useSettings();
  const [serverNotes, setServerNotes] = useState<ServerNotification[]>([]);
  useEffect(() => {
    void listServerNotifications().then(setServerNotes).catch(() => undefined);
  }, []);
  const unread = serverNotes.filter((n) => !n.read).length;
  return (
    <Screen title="Notifications" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <Card>
          <Row title="Follows" explain="When someone follows you." control={<Toggle label="Follow notifications" on={settings.notifyFollow} onChange={(v) => void patch({ notifyFollow: v })} />} />
          <Row title="Follow requests" explain="When someone requests to follow you." control={<Toggle label="Follow request notifications" on={settings.notifyFollowRequest} onChange={(v) => void patch({ notifyFollowRequest: v })} />} />
          <Row title="Comments" explain="When someone comments on your posts." control={<Toggle label="Comment notifications" on={settings.notifyComment} onChange={(v) => void patch({ notifyComment: v })} />} />
          <Row title="Mentions" explain="When someone mentions you." control={<Toggle label="Mention notifications" on={settings.notifyMention} onChange={(v) => void patch({ notifyMention: v })} />} />
          <Row title="Messages" explain="When someone messages you." control={<Toggle label="Message notifications" on={settings.notifyMessage} onChange={(v) => void patch({ notifyMessage: v })} />} />
          <Row title="Slash" explain="When someone invites you with Slash." control={<Toggle label="Slash notifications" on={settings.notifySlash} onChange={(v) => void patch({ notifySlash: v })} />} />
          <Row title="Drops" explain="When a Drop you follow Blasts." control={<Toggle label="Drop notifications" on={settings.notifyDrop} onChange={(v) => void patch({ notifyDrop: v })} />} />
        </Card>
      )}
      <Card>
        <Row title="Email notifications" explain="Email notifications aren't available in DROP yet — no email provider is connected." />
        <Row title="Push notifications" explain="Push notifications aren't available in DROP yet — no push provider is connected." />
      </Card>
      <p className="muted">
        {unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}. ` : 'No unread notifications. '}
        Turning a type off stops DROP from creating those notifications for you.
      </p>
      {unread > 0 && (
        <button className="ghost" onClick={async () => { await markNotificationsRead(); setServerNotes(await listServerNotifications().catch(() => [])); }}>Mark all read</button>
      )}
    </Screen>
  );
}

function ArchiveScreen({ onBack }: { onBack: () => void }) {
  const { settings, error: settingsError, patch } = useSettings();
  const [items, setItems] = useState<ArchivedStory[]>([]);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const load = async () => {
    try { setItems(await listArchive()); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load your archive.'); }
  };
  useEffect(() => { void load(); }, []);
  return (
    <Screen title="Archiving and downloading" onBack={onBack}>
      {(error || settingsError) && <div className="notice">{error || settingsError}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <Card>
          <Row
            title="Save stories to archive"
            explain="When on, each story you create is also saved here after it expires."
            control={<Toggle label="Save stories to archive" on={settings.saveStoryToArchive} onChange={(v) => void patch({ saveStoryToArchive: v })} />}
          />
        </Card>
      )}
      <Card>
        <p><strong>Story archive ({items.length})</strong></p>
        {items.length === 0 && <p className="muted">Nothing archived yet. Turn on “Save stories to archive” and your next story will appear here.</p>}
        {items.map((a) => (
          <div key={a.id} className="profile-user-row">
            <span className="who">
              <strong style={{ display: 'block' }}>Story · {a.filter ?? 'original'}</strong>
              <span className="muted">Archived {new Date(a.archivedAt).toLocaleDateString()}</span>
            </span>
            {confirmId === a.id ? (
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="primary" style={{ padding: '8px 12px' }} onClick={async () => { try { await deleteArchived(a.id); setConfirmId(null); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed.'); } }}>Confirm delete</button>
                <button className="ghost" onClick={() => setConfirmId(null)}>Cancel</button>
              </span>
            ) : (
              <button className="ghost" onClick={() => setConfirmId(a.id)}>Delete</button>
            )}
          </div>
        ))}
      </Card>
      <p className="muted">Downloading your data as a file isn&apos;t available in DROP yet.</p>
    </Screen>
  );
}

function AccessibilityScreen({ onBack }: { onBack: () => void }) {
  const { settings, error, patch } = useSettings();
  return (
    <Screen title="Accessibility" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <Card>
          <Row
            title="Reduce motion"
            explain="Turns off animations and transitions across DROP — editor animations, the Blast animation and dock transitions."
            control={<Toggle label="Reduce motion" on={settings.reduceMotion} onChange={(v) => void patch({ reduceMotion: v })} />}
          />
        </Card>
      )}
      <p className="muted">DROP uses the system font sizes on your device. There are no separate text-size controls in DROP yet.</p>
    </Screen>
  );
}

function LanguageScreen({ onBack }: { onBack: () => void }) {
  const { settings, error, patch } = useSettings();
  return (
    <Screen title="Language" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <Card>
          {SETTINGS_LANGUAGES.map((l) => (
            <RadioRow key={l.code} label={l.label} checked={settings.language === l.code} onSelect={() => void patch({ language: l.code })} />
          ))}
        </Card>
      )}
      <p className="muted">DROP is in English for now — your choice is saved and will apply when translations arrive.</p>
    </Screen>
  );
}

function AppsScreen({ onBack, onSignOut }: { onBack: () => void; onSignOut: () => void }) {
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [error, setError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  useEffect(() => {
    void listConnectedApps().then(setApps).catch((e) => setError(e instanceof Error ? e.message : 'Could not load connected apps.'));
  }, []);
  return (
    <Screen title="Apps and websites" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      <Card>
        {apps.length === 0 && <p className="muted">No apps or websites are connected to your DROP account.</p>}
        {apps.map((a) => (
          <div key={a.provider} className="profile-user-row">
            <span className="who">
              <strong style={{ display: 'block' }}>{a.name}</strong>
              <span className="muted">{a.email ?? 'Signed in with Google'}{a.connectedAt ? ` · connected ${new Date(a.connectedAt).toLocaleDateString()}` : ''}</span>
            </span>
            {confirmRevoke ? (
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="primary" style={{ padding: '8px 12px' }} onClick={async () => { await revokeSession(); onSignOut(); }}>Sign out</button>
                <button className="ghost" onClick={() => setConfirmRevoke(false)}>Cancel</button>
              </span>
            ) : (
              <button className="ghost" onClick={() => setConfirmRevoke(true)}>Revoke</button>
            )}
          </div>
        ))}
      </Card>
      <p className="muted">Revoking Google sign-in signs you out of DROP on this device. You can sign back in with Google at any time — your profile and posts stay.</p>
    </Screen>
  );
}

function CloseFriendsScreen({ me, onBack }: { me: User; onBack: () => void }) {
  const [ids, setIds] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    try { setIds(new Set((await listCloseFriends()).map((u) => u.id))); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load Close Friends.'); }
    setLoaded(true);
  };
  useEffect(() => { void refresh(); }, []);
  return (
    <Screen title="Close Friends" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      <p className="muted">Only these people see stories you share with Close Friends. Everyone else sees your public stories as normal.</p>
      {!loaded ? <p className="muted">Loading…</p> : (
        <UserPicker
          me={me} selectedIds={ids}
          onAdd={async (id) => { await addCloseFriend(id); await refresh(); }}
          onRemove={async (id) => { await removeCloseFriend(id); await refresh(); }}
          emptyNote="You don’t follow anyone yet, and no one follows you yet — follow people to add them here."
        />
      )}
    </Screen>
  );
}

function BlockedScreen({ onBack }: { onBack: () => void }) {
  const [blocked, setBlocked] = useState<User[]>([]);
  const [error, setError] = useState('');
  const load = async () => {
    try { setBlocked((await listBlockedMuted()).blocked); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load blocked accounts.'); }
  };
  useEffect(() => { void load(); }, []);
  return (
    <Screen title="Blocked" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      <p className="muted">Blocked accounts can&apos;t see your profile, posts or messages, and you won&apos;t see theirs.</p>
      <Card>
        {blocked.length === 0 && <p className="muted">No blocked accounts.</p>}
        {blocked.map((u) => (
          <div key={u.id} className="profile-user-row">
            <Avatar user={u} size={40} />
            <span className="who"><strong style={{ display: 'block' }}>{u.displayName}</strong><span className="muted">@{u.username}</span></span>
            <button className="ghost" onClick={async () => { try { await unblockUser(u.id); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unblock failed.'); } }}>Unblock</button>
          </div>
        ))}
      </Card>
    </Screen>
  );
}

function HideStoryFromScreen({ me, onBack }: { me: User; onBack: () => void }) {
  const [ids, setIds] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    try { setIds(new Set((await listHiddenFrom()).map((u) => u.id))); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load that list.'); }
    setLoaded(true);
  };
  useEffect(() => { void refresh(); }, []);
  return (
    <Screen title="Hide story from" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      <p className="muted">People you hide your stories from won&apos;t see them. They won&apos;t be told.</p>
      {!loaded ? <p className="muted">Loading…</p> : (
        <UserPicker
          me={me} selectedIds={ids}
          onAdd={async (id) => { await addHiddenFrom(id); await refresh(); }}
          onRemove={async (id) => { await removeHiddenFrom(id); await refresh(); }}
          emptyNote="You don’t follow anyone yet, and no one follows you yet — follow people to hide stories from them."
        />
      )}
    </Screen>
  );
}

function MessagesScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (s: SettingsScreen) => void }) {
  const [privacy, setPrivacy] = useState<import('../lib/api').PrivacyPrefs | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void getMyPrivacy().then(setPrivacy).catch((e) => setError(e instanceof Error ? e.message : 'Could not load privacy settings.'));
  }, []);
  const change = async (next: import('../lib/api').PrivacyPrefs) => {
    setPrivacy(next);
    try { await updateMyPrivacy(next); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
  };
  return (
    <Screen title="Messages and story replies" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!privacy ? <p className="muted">Loading…</p> : (
        <Card>
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 0' }}>
            <span><strong style={{ display: 'block' }}>Who can message you</strong><span className="muted">People outside this group send a message request instead.</span></span>
            <select value={privacy.whoCanMessage} onChange={(e) => void change({ ...privacy, whoCanMessage: e.target.value as import('../lib/api').PrivacyPrefs['whoCanMessage'] })} style={{ width: 'auto' }}>
              <option value="everyone">Everyone</option>
              <option value="friends">Friends only</option>
              <option value="nobody">Nobody</option>
            </select>
          </label>
        </Card>
      )}
      <Card>
        <button type="button" onClick={() => onOpen('message-requests')} style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', padding: '12px 0', color: 'inherit' }}>
          <strong style={{ display: 'block' }}>Message requests ›</strong>
          <span className="muted">Review requests from people you don&apos;t follow.</span>
        </button>
        <button type="button" onClick={() => onOpen('story-replies')} style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid var(--border)', textAlign: 'left', padding: '12px 0', color: 'inherit' }}>
          <strong style={{ display: 'block' }}>Story replies ›</strong>
          <span className="muted">Choose who can reply to your stories.</span>
        </button>
      </Card>
    </Screen>
  );
}

function MessageRequestsScreen({ onBack, onOpenConversation }: { onBack: () => void; onOpenConversation?: (id: number) => void }) {
  const [incoming, setIncoming] = useState<MessageRequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<MessageRequestItem[]>([]);
  const [hidden, setHidden] = useState<MessageRequestItem[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    try {
      const r = await listMessageRequests();
      setIncoming(r.incoming); setOutgoing(r.outgoing); setHidden(r.hidden);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load message requests.'); }
  };
  useEffect(() => { void load(); }, []);
  const answer = async (id: number, accept: boolean) => {
    setError(''); setNotice('');
    try {
      const r = await answerMessageRequest(id, accept);
      if (accept && r.conversationId && onOpenConversation) onOpenConversation(r.conversationId);
      else setNotice(accept ? 'Request accepted — conversation opened.' : 'Request declined.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not answer that request.'); }
  };
  const reqRow = (r: MessageRequestItem, actions: boolean) => (
    <div key={r.id} className="profile-user-row">
      <span className="who">
        <strong style={{ display: 'block' }}>{r.senderDisplayName ?? r.recipientDisplayName ?? 'Someone'}</strong>
        <span className="muted">@{r.senderUsername ?? r.recipientUsername ?? ''}</span>
        {r.body && <span style={{ display: 'block' }}>{r.body}</span>}
      </span>
      {actions && (
        <span style={{ display: 'flex', gap: 6 }}>
          <button className="primary" style={{ padding: '8px 12px' }} onClick={() => void answer(r.id, true)}>Accept</button>
          <button className="ghost" onClick={() => void answer(r.id, false)}>Decline</button>
        </span>
      )}
    </div>
  );
  return (
    <Screen title="Message requests" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {notice && <p className="muted">{notice}</p>}
      <Card>
        <p><strong>Incoming ({incoming.length})</strong></p>
        {incoming.length === 0 && <p className="muted">No pending requests.</p>}
        {incoming.map((r) => reqRow(r, true))}
      </Card>
      <Card>
        <p><strong>Sent — waiting ({outgoing.length})</strong></p>
        {outgoing.length === 0 && <p className="muted">No outgoing requests.</p>}
        {outgoing.map((r) => reqRow(r, false))}
      </Card>
      {hidden.length > 0 && (
        <Card>
          <p><strong>Hidden ({hidden.length})</strong></p>
          <p className="muted">These matched one of your hidden words, so they were kept out of your inbox. You can still find them here.</p>
          {hidden.map((r) => reqRow(r, true))}
        </Card>
      )}
    </Screen>
  );
}

function StoryRepliesScreen({ onBack }: { onBack: () => void }) {
  const { settings, error, patch } = useSettings();
  return (
    <Screen title="Story replies" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <Card>
          <RadioRow label="Followers" explain="Anyone who follows you can reply to your stories." checked={settings.storyReplies === 'followers'} onSelect={() => void patch({ storyReplies: 'followers' })} />
          <RadioRow label="People you follow back" explain="Only people you follow back can reply." checked={settings.storyReplies === 'mutual'} onSelect={() => void patch({ storyReplies: 'mutual' })} />
          <RadioRow label="Off" explain="Nobody can reply to your stories." checked={settings.storyReplies === 'off'} onSelect={() => void patch({ storyReplies: 'off' })} />
        </Card>
      )}
      <p className="muted">Replies arrive as a direct message to you.</p>
    </Screen>
  );
}

function TagsMentionsScreen({ onBack }: { onBack: () => void }) {
  const [privacy, setPrivacy] = useState<import('../lib/api').PrivacyPrefs | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void getMyPrivacy().then(setPrivacy).catch((e) => setError(e instanceof Error ? e.message : 'Could not load privacy settings.'));
  }, []);
  const change = async (next: import('../lib/api').PrivacyPrefs) => {
    setPrivacy(next);
    try { await updateMyPrivacy(next); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
  };
  const select = (label: string, explain: string, value: 'everyone' | 'friends' | 'nobody', onChange: (v: 'everyone' | 'friends' | 'nobody') => void) => (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <span><strong style={{ display: 'block' }}>{label}</strong><span className="muted">{explain}</span></span>
      <select value={value} onChange={(e) => onChange(e.target.value as 'everyone' | 'friends' | 'nobody')} style={{ width: 'auto' }}>
        <option value="everyone">Everyone</option>
        <option value="friends">Friends only</option>
        <option value="nobody">Nobody</option>
      </select>
    </label>
  );
  return (
    <Screen title="Tags and mentions" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!privacy ? <p className="muted">Loading…</p> : (
        <Card>
          {select('Who can mention you', 'Mentions in story text and posts.', privacy.whoCanMention, (v) => void change({ ...privacy, whoCanMention: v }))}
          {select('Who can tag you', 'Tags on posts and stories.', privacy.whoCanTag, (v) => void change({ ...privacy, whoCanTag: v }))}
        </Card>
      )}
      <p className="muted">There is no tag input in DROP yet — no one can tag you in a post or story today. When tagging arrives, this setting will apply.</p>
    </Screen>
  );
}

function CommentsScreen({ me, onBack }: { me: User; onBack: () => void }) {
  const { settings, error, patch } = useSettings();
  const [followers, setFollowers] = useState<number | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  useEffect(() => {
    void getMyProfileServer().then((p) => {
      if (p?.counts) { setFollowers(p.counts.followers); setFollowing(p.counts.following); }
    }).catch(() => undefined);
    void listFollowers(me.id).then((f) => setFollowers((v) => v ?? f.length)).catch(() => undefined);
    void listFollowing(me.id).then((f) => setFollowing((v) => v ?? f.length)).catch(() => undefined);
  }, [me.id]);
  const countNote = (label: string) => {
    if (label === 'followers') return followers === null ? 'People who follow you.' : `${followers} ${followers === 1 ? 'person follows' : 'people follow'} you.`;
    if (label === 'mutual') return following === null || followers === null ? 'People you follow back.' : 'Only people you follow back.';
    return '';
  };
  return (
    <Screen title="Comments" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <>
          <Card>
            <RadioRow label="Everyone" explain="Anyone can comment on your posts." checked={settings.whoCanComment === 'everyone'} onSelect={() => void patch({ whoCanComment: 'everyone' })} />
            <RadioRow label="People who follow you" explain={countNote('followers')} checked={settings.whoCanComment === 'followers'} onSelect={() => void patch({ whoCanComment: 'followers' })} />
            <RadioRow label="People you follow back" explain={countNote('mutual')} checked={settings.whoCanComment === 'mutual'} onSelect={() => void patch({ whoCanComment: 'mutual' })} />
            <RadioRow label="Off" explain="Nobody can comment on your posts." checked={settings.whoCanComment === 'off'} onSelect={() => void patch({ whoCanComment: 'off' })} />
          </Card>
          <Card>
            <Row
              title="GIF comments"
              explain="GIF comments aren't available in DROP yet — this setting will apply when they are."
              control={<Toggle label="GIF comments" on={settings.gifComments} onChange={(v) => void patch({ gifComments: v })} />}
            />
          </Card>
        </>
      )}
      <p className="muted">Comments that match your hidden words are kept out of your view, and comments by people you restricted are only visible to you and the commenter.</p>
    </Screen>
  );
}

function SharingScreen({ onBack }: { onBack: () => void }) {
  const { settings, error, patch } = useSettings();
  return (
    <Screen title="Sharing" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <Card>
          <Row
            title="Allow people to share your stories"
            explain="When off, the share action on your stories is hidden for everyone else."
            control={<Toggle label="Allow story shares" on={settings.allowStoryShares} onChange={(v) => void patch({ allowStoryShares: v })} />}
          />
        </Card>
      )}
      <p className="muted">Sharing a story copies a link to it. There is no repost feed in DROP yet.</p>
    </Screen>
  );
}

function RestrictedScreen({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const load = async () => {
    try { setUsers(await listRestricted()); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load restricted accounts.'); }
  };
  useEffect(() => { void load(); }, []);
  return (
    <Screen title="Restricted" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      <p className="muted">Restricted people can still see your posts, but their comments are only visible to you and them — nobody else sees them. They are not told they are restricted. Restrict someone from their profile&apos;s More menu.</p>
      <Card>
        {users.length === 0 && <p className="muted">No restricted accounts.</p>}
        {users.map((u) => (
          <div key={u.id} className="profile-user-row">
            <Avatar user={u} size={40} />
            <span className="who"><strong style={{ display: 'block' }}>{u.displayName}</strong><span className="muted">@{u.username}</span></span>
            <button className="ghost" onClick={async () => { try { await unrestrictUser(u.id); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unrestrict failed.'); } }}>Unrestrict</button>
          </div>
        ))}
      </Card>
    </Screen>
  );
}

function HiddenWordsScreen({ onBack }: { onBack: () => void }) {
  const [words, setWords] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    try { setWords(await listHiddenWords()); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load hidden words.'); }
  };
  useEffect(() => { void load(); }, []);
  const add = async () => {
    if (!input.trim()) return;
    setError('');
    try { await addHiddenWord(input); setInput(''); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not add that word.'); }
  };
  return (
    <Screen title="Hidden Words" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      <p className="muted">Comments and message requests containing one of these words are hidden from you automatically. Words are matched exactly, ignoring case. Maximum 100 words.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Add a word or phrase…" maxLength={50} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <button className="primary" onClick={() => void add()} disabled={words.length >= 100}>Add</button>
      </div>
      <Card>
        <p><strong>Your hidden words ({words.length}/100)</strong></p>
        {words.length === 0 && <p className="muted">No hidden words yet.</p>}
        {words.map((w) => (
          <div key={w} className="profile-user-row">
            <span className="who"><strong>{w}</strong></span>
            <button className="ghost" onClick={async () => { try { await removeHiddenWord(w); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove that word.'); } }}>Remove</button>
          </div>
        ))}
      </Card>
    </Screen>
  );
}

function MutedScreen({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const load = async () => {
    try { setUsers(await listMutedUsers()); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load muted accounts.'); }
  };
  useEffect(() => { void load(); }, []);
  return (
    <Screen title="Muted" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      <p className="muted">Muted accounts&apos; posts don&apos;t appear in your feed. They are not told. Muting doesn&apos;t unfollow them or block messages.</p>
      <Card>
        {users.length === 0 && <p className="muted">No muted accounts.</p>}
        {users.map((u) => (
          <div key={u.id} className="profile-user-row">
            <Avatar user={u} size={40} />
            <span className="who"><strong style={{ display: 'block' }}>{u.displayName}</strong><span className="muted">@{u.username}</span></span>
            <button className="ghost" onClick={async () => { try { await unmuteUser(u.id); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unmute failed.'); } }}>Unmute</button>
          </div>
        ))}
      </Card>
    </Screen>
  );
}

function ContentPrefsScreen({ onBack }: { onBack: () => void }) {
  const { settings, error, patch } = useSettings();
  return (
    <Screen title="Content preferences" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <Card>
          <RadioRow label="Less" explain="Hides posts from accounts you've reported." checked={settings.sensitiveContentLevel === 'less'} onSelect={() => void patch({ sensitiveContentLevel: 'less' })} />
          <RadioRow label="Standard" explain="Shows everything not blocked." checked={settings.sensitiveContentLevel === 'standard'} onSelect={() => void patch({ sensitiveContentLevel: 'standard' })} />
          <RadioRow label="More" explain="Shows everything not blocked." checked={settings.sensitiveContentLevel === 'more'} onSelect={() => void patch({ sensitiveContentLevel: 'more' })} />
        </Card>
      )}
      <p className="muted">DROP doesn&apos;t classify content yet. &apos;Less&apos; hides posts from accounts you&apos;ve reported; &apos;Standard&apos; and &apos;More&apos; show everything not blocked.</p>
    </Screen>
  );
}

function LikeCountsScreen({ onBack }: { onBack: () => void }) {
  const { settings, error, patch } = useSettings();
  return (
    <Screen title="Like and share counts" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <Card>
          <Row
            title="Hide like counts"
            explain="When on, Fire counts are hidden on posts — in the feed and on profiles. You can still Fire a post."
            control={<Toggle label="Hide like counts" on={settings.hideLikeCounts} onChange={(v) => void patch({ hideLikeCounts: v })} />}
          />
        </Card>
      )}
    </Screen>
  );
}

function ProfileTypeScreen({ onBack }: { onBack: () => void }) {
  const { settings, error, patch } = useSettings();
  return (
    <Screen title="Profile type and tools" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!settings ? <p className="muted">Loading…</p> : (
        <Card>
          <RadioRow label="Personal" explain="A personal DROP profile." checked={settings.accountType === 'personal'} onSelect={() => void patch({ accountType: 'personal' })} />
          <RadioRow label="Creator" explain="For people who make content on DROP." checked={settings.accountType === 'creator'} onSelect={() => void patch({ accountType: 'creator' })} />
          <RadioRow label="Business" explain="For businesses on DROP." checked={settings.accountType === 'business'} onSelect={() => void patch({ accountType: 'business' })} />
        </Card>
      )}
      <p className="muted">Creator tools and insights aren&apos;t built yet. Choosing Creator or Business only records the type for now — no insights, subscriptions or tools are attached.</p>
    </Screen>
  );
}

function HelpScreen({ onBack }: { onBack: () => void }) {
  const topics: { title: string; body: string }[] = [
    { title: 'Blast', body: 'A Drop is sealed until its Blast time. When it Blasts, it opens for everyone who can see it. Scheduled Blasts use the presets in the Hub — 1 hour to 7 days.' },
    { title: 'Slash', body: 'Type /username in any chat to invite that person in instantly. When they leave, the expansion vanishes — no group is left behind.' },
    { title: 'Stories', body: 'Stories last 24 hours. You can share a story with everyone or with Close Friends only, hide it from specific people, and choose who can reply.' },
    { title: 'Drops', body: 'Public Drops can be seen by everyone; Protected Drops only by people you approve. A Drop stays sealed until it Blasts.' },
    { title: 'Privacy', body: 'Make your profile private, choose who can message, mention or Slash-invite you, and block, mute or restrict accounts from their profile.' },
    { title: 'Messages', body: 'People outside your message setting send a message request first. You accept or decline it from Settings → Message requests.' },
  ];
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Screen title="Help" onBack={onBack}>
      <Card>
        {topics.map((t) => (
          <div key={t.title} style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
            <button type="button" onClick={() => setOpen(open === t.title ? null : t.title)} style={{ background: 'none', border: 'none', textAlign: 'left', width: '100%', color: 'inherit', fontSize: 16 }}>
              <strong>{t.title}</strong> {open === t.title ? '▾' : '›'}
            </button>
            {open === t.title && <p className="muted" style={{ margin: '8px 0 0' }}>{t.body}</p>}
          </div>
        ))}
      </Card>
      <p className="muted">DROP has no support email or chat yet. For account problems, sign out and sign back in with Google — your profile and posts are kept.</p>
    </Screen>
  );
}

function StatusScreen({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void getAccountStatus().then(setStatus).catch((e) => setError(e instanceof Error ? e.message : 'Could not load your account status.'));
  }, []);
  return (
    <Screen title="Profile status" onBack={onBack}>
      {error && <div className="notice">{error}</div>}
      {!status ? <p className="muted">Loading…</p> : (
        <Card>
          <Row title="Standing" explain={status.note} control={<strong>{status.standing === 'good' ? 'Good' : 'Under review'}</strong>} />
          <Row title="Reports against you" explain="Reports from other people about your account." control={<strong>{status.reportsAgainstMe}</strong>} />
          <Row title="Account type" explain="Your profile is currently public or private (see Profile privacy)." control={<strong>{status.isPrivate ? 'Private' : 'Public'}</strong>} />
          {status.createdAt && <Row title="Joined" explain="When this account was created." control={<span className="muted">{new Date(status.createdAt).toLocaleDateString()}</span>} />}
        </Card>
      )}
      <p className="muted">DROP has no strikes or violations system yet — this page only shows real reports made against your account.</p>
    </Screen>
  );
}

function FamilyCenterScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen title="Family Center" onBack={onBack}>
      <Card>
        <Row title="Supervision" explain="Supervision for teen accounts isn't available in DROP yet." />
      </Card>
      <p className="muted">There is no parent or guardian flow in DROP today. When supervision arrives, it will appear here.</p>
    </Screen>
  );
}

// ------------------------------------------------------------- hub -------
const HUB_SECTIONS: { heading: string; rows: { id: SettingsScreen | 'edit-profile'; label: string; explain: string }[] }[] = [
  {
    heading: 'Your account',
    rows: [
      { id: 'edit-profile', label: 'Edit profile', explain: 'Name, bio, links, photo and more.' },
      { id: 'notifications', label: 'Notifications', explain: 'Choose which events notify you.' },
    ],
  },
  {
    heading: 'How you use DROP',
    rows: [
      { id: 'archive', label: 'Archiving and downloading', explain: 'Save stories to your archive.' },
      { id: 'accessibility', label: 'Accessibility', explain: 'Reduce motion and more.' },
      { id: 'language', label: 'Language', explain: 'Your preferred language.' },
      { id: 'apps', label: 'Apps and websites', explain: 'What is connected to DROP.' },
    ],
  },
  {
    heading: 'Who can see your content',
    rows: [
      { id: 'privacy', label: 'Profile privacy', explain: 'Private account, activity status, messages.' },
      { id: 'close-friends', label: 'Close Friends', explain: 'Who sees your Close Friends stories.' },
      { id: 'blocked', label: 'Blocked', explain: 'Accounts you have blocked.' },
      { id: 'hide-story-from', label: 'Hide story from', explain: 'Hide your stories from specific people.' },
    ],
  },
  {
    heading: 'How others can interact with you',
    rows: [
      { id: 'messages', label: 'Messages and story replies', explain: 'Who can message you and reply to stories.' },
      { id: 'message-requests', label: 'Message requests', explain: 'Requests from people you don’t follow.' },
      { id: 'story-replies', label: 'Story replies', explain: 'Who can reply to your stories.' },
      { id: 'tags-mentions', label: 'Tags and mentions', explain: 'Who can mention or tag you.' },
      { id: 'comments', label: 'Comments', explain: 'Who can comment on your posts.' },
      { id: 'sharing', label: 'Sharing', explain: 'Who can share your stories.' },
      { id: 'restricted', label: 'Restricted', explain: 'Accounts with limited interaction.' },
      { id: 'hidden-words', label: 'Hidden Words', explain: 'Words hidden from your comments and requests.' },
    ],
  },
  {
    heading: 'What you see',
    rows: [
      { id: 'muted', label: 'Muted', explain: 'Accounts whose posts you don’t see.' },
      { id: 'content-prefs', label: 'Content preferences', explain: 'How much sensitive content you see.' },
      { id: 'like-counts', label: 'Like and share counts', explain: 'Hide Fire counts on posts.' },
    ],
  },
  {
    heading: 'For professionals',
    rows: [
      { id: 'profile-type', label: 'Profile type and tools', explain: 'Personal, Creator or Business.' },
    ],
  },
  {
    heading: 'More info and support',
    rows: [
      { id: 'help', label: 'Help', explain: 'How Blast, Slash, Stories and Drops work.' },
      { id: 'status', label: 'Profile status', explain: 'Reports and standing of your account.' },
      { id: 'family-center', label: 'Family Center', explain: 'Supervision for teen accounts.' },
    ],
  },
];

export default function SettingsHub(props: {
  me: User;
  initialScreen?: SettingsScreen | null;
  onBack: () => void;
  onEditProfile: () => void;
  onSignOut: () => void;
  onOpenConversation?: (id: number) => void;
}) {
  const [screen, setScreen] = useState<SettingsScreen>(props.initialScreen ?? 'hub');
  const [q, setQ] = useState('');
  const goHub = () => setScreen('hub');
  const open = (s: SettingsScreen) => {
    if (s === 'edit-profile' as SettingsScreen) { props.onEditProfile(); return; }
    setScreen(s);
  };

  if (screen === 'privacy') {
    return <PrivacyPage me={props.me} onBack={goHub} onSignOut={props.onSignOut} />;
  }
  if (screen !== 'hub') {
    const title = SCREEN_TITLES[screen as Exclude<SettingsScreen, 'hub'>];
    switch (screen) {
      case 'notifications': return <NotificationsScreen onBack={goHub} />;
      case 'archive': return <ArchiveScreen onBack={goHub} />;
      case 'accessibility': return <AccessibilityScreen onBack={goHub} />;
      case 'language': return <LanguageScreen onBack={goHub} />;
      case 'apps': return <AppsScreen onBack={goHub} onSignOut={props.onSignOut} />;
      case 'close-friends': return <CloseFriendsScreen me={props.me} onBack={goHub} />;
      case 'blocked': return <BlockedScreen onBack={goHub} />;
      case 'hide-story-from': return <HideStoryFromScreen me={props.me} onBack={goHub} />;
      case 'messages': return <MessagesScreen onBack={goHub} onOpen={setScreen} />;
      case 'message-requests': return <MessageRequestsScreen onBack={goHub} onOpenConversation={props.onOpenConversation} />;
      case 'story-replies': return <StoryRepliesScreen onBack={goHub} />;
      case 'tags-mentions': return <TagsMentionsScreen onBack={goHub} />;
      case 'comments': return <CommentsScreen me={props.me} onBack={goHub} />;
      case 'sharing': return <SharingScreen onBack={goHub} />;
      case 'restricted': return <RestrictedScreen onBack={goHub} />;
      case 'hidden-words': return <HiddenWordsScreen onBack={goHub} />;
      case 'muted': return <MutedScreen onBack={goHub} />;
      case 'content-prefs': return <ContentPrefsScreen onBack={goHub} />;
      case 'like-counts': return <LikeCountsScreen onBack={goHub} />;
      case 'profile-type': return <ProfileTypeScreen onBack={goHub} />;
      case 'help': return <HelpScreen onBack={goHub} />;
      case 'status': return <StatusScreen onBack={goHub} />;
      case 'family-center': return <FamilyCenterScreen onBack={goHub} />;
      default: return null;
    }
    void title;
  }

  const query = q.trim().toLowerCase();
  const sections = HUB_SECTIONS.map((s) => ({
    ...s,
    rows: s.rows.filter((r) => !query || r.label.toLowerCase().includes(query) || r.explain.toLowerCase().includes(query) || s.heading.toLowerCase().includes(query)),
  })).filter((s) => s.rows.length > 0);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="ghost" aria-label="Back" onClick={props.onBack}>←</button>
        <h2 style={{ flex: 1, margin: 0 }}>Settings</h2>
      </div>
      <input
        value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings…"
        style={{ marginTop: 12 }}
      />
      {sections.length === 0 && <p className="muted" style={{ marginTop: 16 }}>No settings match “{q}”.</p>}
      {sections.map((s) => (
        <section key={s.heading} style={{ marginTop: 20 }}>
          <h3 style={{ margin: '0 0 8px' }}>{s.heading}</h3>
          <div className="card" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '4px 12px' }}>
            {s.rows.map((r) => (
              <button
                key={r.id} type="button"
                onClick={() => open(r.id as SettingsScreen)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', padding: '12px 0', border: 'none', borderBottom: '1px solid var(--border)', background: 'none', textAlign: 'left', color: 'inherit' }}
              >
                <span>
                  <strong style={{ display: 'block' }}>{r.label}</strong>
                  <span className="muted">{r.explain}</span>
                </span>
                <span className="muted" aria-hidden>›</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export { DEFAULT_SETTINGS };
