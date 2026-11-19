import { useEffect, useRef, useState } from 'react';
import type { Story, User } from '../lib/api';
import { filterCss } from '../lib/filters';
import { getPublicProfile, createConversation, sendMessage, listFollowersFollowing } from '../lib/api';
import { IconClose, IconDrop, IconImage, IconReplay } from './icons';

// 24h Story viewer: 30s per segment, progress + countdown, replay within
// 24h, hold-to-pause, tap right = next / left = previous, swipe-down close.
// Story replies: a reply box sends a DM to the story author, shown only
// when the author's storyReplies setting allows this viewer. Sharing:
// when the author turned story shares off, the share action is hidden.
export default function StoryViewer({
  stories, index, onClose, onIndex, me,
}: {
  stories: Story[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
  me?: User | null;
}) {
  const story = stories[index];
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyNote, setReplyNote] = useState('');
  const [replyAllowed, setReplyAllowed] = useState<boolean | null>(null);
  const [allowShares, setAllowShares] = useState(true);
  const [shareNote, setShareNote] = useState('');
  const holdTimer = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => { setElapsed(0); setPaused(false); setReplyText(''); setReplyNote(''); setShareNote(''); }, [index]);

  // Resolve the author's story-reply + share settings for this viewer.
  useEffect(() => {
    if (!story || !me || story.authorId === me.id) { setReplyAllowed(null); setAllowShares(true); return; }
    let cancelled = false;
    const authorUsername = story.author?.username;
    if (!authorUsername) { setReplyAllowed(null); return; }
    void (async () => {
      try {
        const p = await getPublicProfile(authorUsername);
        if (cancelled) return;
        const replies = p.interaction?.storyReplies ?? 'followers';
        const iFollow = p.relationship === 'following';
        let allowed = false;
        if (replies === 'followers') allowed = iFollow;
        else if (replies === 'mutual' && iFollow) {
          // Mutual needs both directions: check whether the author
          // follows me back (server list, when the DB is on).
          try {
            const theirFollowers = await listFollowersFollowing(p.id, 'followers');
            allowed = theirFollowers.some((u) => u.id === me.id);
          } catch {
            allowed = false;
          }
        }
        if (!cancelled) {
          setReplyAllowed(allowed);
          setAllowShares(p.interaction?.allowStoryShares ?? true);
        }
      } catch {
        if (!cancelled) { setReplyAllowed(null); setAllowShares(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [story?.authorId, story?.author?.username, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (paused || !story) return;
    const t = window.setInterval(() => {
      setElapsed((e) => {
        if (e >= 30) {
          window.clearInterval(t);
          if (index + 1 < stories.length) onIndex(index + 1);
          else onClose();
          return e;
        }
        return e + 0.1;
      });
    }, 100);
    return () => window.clearInterval(t);
  }, [paused, story, index, stories.length, onIndex, onClose]);

  if (!story) return null;
  const remaining = Math.max(0, Math.ceil(30 - elapsed));
  const isOwn = !!me && story.authorId === me.id;

  const onPointerDown = () => {
    holdTimer.current = window.setTimeout(() => setPaused(true), 220);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    if (paused) { setPaused(false); return; }
    if ((e.target as HTMLElement).closest('input, button, textarea')) return;
    const x = e.clientX;
    const w = window.innerWidth;
    if (x > w * 0.6 && index + 1 < stories.length) onIndex(index + 1);
    else if (x < w * 0.4 && index > 0) onIndex(index - 1);
    else if (x > w * 0.6) onClose();
  };

  const sendReply = async () => {
    if (!replyText.trim() || !me) return;
    setReplyNote('');
    try {
      const result = await createConversation(story.authorId);
      if (typeof result === 'object') {
        setReplyNote('Request sent — this account only accepts messages from friends, so your reply was sent as a message request.');
        setReplyText('');
        return;
      }
      await sendMessage(result, replyText.trim());
      setReplyText('');
      setReplyNote('Reply sent.');
    } catch (err) {
      setReplyNote(err instanceof Error ? err.message : 'Could not send that reply.');
    }
  };

  const shareStory = async () => {
    setShareNote('');
    try {
      const text = `DROP story by @${story.author?.username ?? 'someone'}`;
      if (navigator.share) await navigator.share({ title: 'DROP story', text });
      else { await navigator.clipboard.writeText(text); setShareNote('Story link copied.'); }
    } catch { /* share cancelled */ }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#000', color: '#fff', zIndex: 100, display: 'flex', flexDirection: 'column' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY; }}
      onTouchEnd={(e) => {
        if (touchStartY.current !== null && e.changedTouches[0].clientY - touchStartY.current > 80) onClose();
        touchStartY.current = null;
      }}
    >
      <div style={{ display: 'flex', gap: 4, padding: 12 }}>
        {stories.map((s, i) => (
          <div key={s.id} style={{ flex: 1, height: 3, background: '#444', borderRadius: 2 }}>
            <div style={{ height: '100%', width: i < index ? '100%' : i === index ? `${(elapsed / 30) * 100}%` : '0%', background: '#fff' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 16px', alignItems: 'center' }}>
        <span>{story.author?.displayName ?? story.author?.username ?? 'Story'} · {story.filter}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 999, padding: '2px 8px' }}>{remaining}s</span>
          <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18 }} onClick={(e) => { e.stopPropagation(); onClose(); }}><IconClose size={18} /></button>
        </span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72, filter: filterCss(story.filter) }}>
        {story.mediaUrl ? <IconImage size={72} /> : <IconDrop size={72} />}
      </div>
      {paused && <div style={{ textAlign: 'center', padding: 8 }}>Paused — hold to pause, release to resume</div>}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: 16, flexWrap: 'wrap' }}>
        <button
          style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px' }}
          onClick={(e) => { e.stopPropagation(); setElapsed(0); setReplayed(true); }}
        >
          <IconReplay size={16} /> Replay{replayed ? 'ed' : ''}
        </button>
        {!isOwn && allowShares && (
          <button
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px' }}
            onClick={(e) => { e.stopPropagation(); void shareStory(); }}
          >
            Share
          </button>
        )}
        {!isOwn && !allowShares && (
          <span style={{ color: '#aaa', fontSize: 12, alignSelf: 'center' }}>The author turned off story sharing.</span>
        )}
        <span style={{ color: '#aaa', fontSize: 12, alignSelf: 'center' }}>Tap right: next · Tap left: previous · Swipe down: close</span>
      </div>
      {!isOwn && me && (
        <div style={{ padding: '0 16px 16px' }} onPointerDown={(e) => e.stopPropagation()}>
          {replyAllowed === false ? (
            <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', margin: 0 }}>Replies are off for this story.</p>
          ) : replyAllowed === true ? (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${story.author?.displayName ?? 'this story'}…`}
                  style={{ flex: 1, background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void sendReply(); }}
                />
                <button
                  style={{ background: '#ec4899', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px' }}
                  onClick={(e) => { e.stopPropagation(); void sendReply(); }}
                >
                  Send
                </button>
              </div>
              {replyNote && <p style={{ color: '#ddd', fontSize: 13, textAlign: 'center', margin: '8px 0 0' }}>{replyNote}</p>}
            </>
          ) : (
            <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', margin: 0 }}>Loading reply settings…</p>
          )}
          {shareNote && <p style={{ color: '#ddd', fontSize: 13, textAlign: 'center', margin: '8px 0 0' }}>{shareNote}</p>}
        </div>
      )}
    </div>
  );
}
