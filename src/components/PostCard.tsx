import { useEffect, useRef, useState } from 'react';
import type { Post, ServerComment } from '../lib/api';
import { toggleLike, addComment, listComments, voteStoryPoll, getMySettings } from '../lib/api';
import { filterCss } from '../lib/filters';
import { IconComment, IconFire, IconMore, IconSave, IconSend, IconShare } from './icons';

// Feed post, full-bleed overlay layout (approved Home reference):
// the photo fills the card edge-to-edge; creator row, Follow, caption and
// the engagement row sit in a bottom overlay on top of the media.
// Fire instead of heart, double-tap Fire, 500ms long-press Comments,
// creator row with Follow, Poll / Questions / Slider widgets.
// Media honesty: only a genuine media URL ever renders as an <img>.
// 'reel-media' and any other placeholder/sentinel is NOT a real URL.
// Posts without real media get a solid dark text panel, never a fake photo.

/** A genuine media URL: http(s), blob:, or an inline data:image:. Anything
 *  else (e.g. the 'reel-media' sentinel) is a placeholder, not a photo. */
const REAL_MEDIA_RE = /^(https?:\/\/|blob:|data:image\/)/i;

function isRealMediaUrl(url?: string | null): url is string {
  if (!url) return false;
  const value = url.trim();
  if (!value) return false;
  return REAL_MEDIA_RE.test(value);
}

/** Relative time for the creator row, e.g. "2h" (matches the reference). */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export default function PostCard({ post, onFollow, following }: {
  post: Post;
  onFollow: (authorId: number) => void;
  following: boolean;
}) {
  const [fired, setFired] = useState(false);
  const [count, setCount] = useState(post.fireCount);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<ServerComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  const [showFire, setShowFire] = useState(false);
  const [hideLikeCounts, setHideLikeCounts] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const longPress = useRef<number | null>(null);

  useEffect(() => {
    void getMySettings().then((s) => setHideLikeCounts(s.hideLikeCounts)).catch(() => undefined);
  }, []);

  const fire = async () => {
    const r = await toggleLike(post.id);
    setFired(r.fired); setCount(r.count);
  };

  const openComments = async () => {
    setShowComments(true);
    setCommentError('');
    try {
      setComments(await listComments(post.id));
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Could not load comments.');
    }
  };

  const extras = post.extrasJson ? JSON.parse(post.extrasJson) as { poll?: { question: string }; question?: string; stickers?: string[] } : {};

  // Real photo only when mediaUrl is a genuine URL and it actually loads.
  // A failed load falls back to the honest text panel — never a broken image.
  const hasRealMedia = isRealMediaUrl(post.mediaUrl) && !mediaFailed;
  const authorName = post.author?.displayName ?? post.author?.username ?? 'Someone';
  const time = timeAgo(post.createdAt);

  // Gestures live on the media area only: ignore presses that start on a
  // button/input inside the overlay so taps there keep their own behaviour
  // (a 500ms hold on Fire must not open Comments, a double-tap on Fire
  // must not fire twice).
  const gestureTargetIsControl = (e: React.PointerEvent | React.MouseEvent) =>
    (e.target as HTMLElement).closest('button, a, input, textarea') !== null;

  return (
    <article className="card post-card fullbleed">
      <div
        className="post-media-wrap"
        onDoubleClick={async (e) => {
          if (gestureTargetIsControl(e)) return;
          if (!fired) { await fire(); setShowFire(true); setTimeout(() => setShowFire(false), 800); }
        }}
        onPointerDown={(e) => {
          if (gestureTargetIsControl(e)) return;
          longPress.current = window.setTimeout(() => openComments(), 500);
        }}
        onPointerUp={() => { if (longPress.current) window.clearTimeout(longPress.current); }}
        onPointerLeave={() => { if (longPress.current) window.clearTimeout(longPress.current); }}
      >
        {hasRealMedia ? (
          <img
            className="post-media-img"
            src={post.mediaUrl as string}
            alt={post.caption ? `${authorName}: ${post.caption}` : `Photo by ${authorName}`}
            style={{ filter: filterCss(post.filter ?? 'original') }}
            onError={() => setMediaFailed(true)}
          />
        ) : (
          <div className="post-text-panel" aria-label={post.caption ? `Post by ${authorName}` : undefined} />
        )}
        {showFire && <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}><IconFire size={64} filled /></span>}
        {extras.poll && <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '6px 10px', borderRadius: 8 }}>{extras.poll.question}</div>}

        <div className="post-overlay">
          <div className="post-creator-row">
            <span className="avatar">{(post.author?.displayName ?? 'D')[0]}</span>
            <strong>{authorName}</strong>
            {time && <span className="post-time">· {time}</span>}
            <button className="ghost" onClick={() => onFollow(post.authorId)}>{following ? 'Following' : 'Follow'}</button>
          </div>
          <p className="post-caption">{post.caption}</p>
          <div className="post-engagement engagement">
            <button className={fired ? 'fire-on' : ''} onClick={fire} aria-label="Fire"><IconFire size={22} filled={fired} />{hideLikeCounts ? '' : ` ${count}`}</button>
            <button onClick={openComments} aria-label="Comment"><IconComment size={22} />{` ${post.commentCount}`}</button>
            <button aria-label="Reshare"><IconShare size={22} /></button>
            <button aria-label="Send"><IconSend size={22} /></button>
            <button aria-label="Save"><IconSave size={22} /></button>
            <button aria-label="More"><IconMore size={22} /></button>
          </div>
        </div>
      </div>
      {extras.poll && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="ghost" onClick={() => voteStoryPoll(post.id, 0)}>Yes</button>
          <button className="ghost" onClick={() => voteStoryPoll(post.id, 1)}>No</button>
        </div>
      )}
      {extras.question && <p className="muted">Q: {extras.question} — answers are visible to the author only.</p>}

      {showComments && (
        <div style={{ marginTop: 10 }}>
          {commentError && <div className="notice">{commentError}</div>}
          {comments.map((c) => <p key={c.id}><strong>{c.author?.displayName ?? c.authorDisplayName ?? 'Someone'}</strong> {c.body}</p>)}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a comment…" />
            <button className="primary" onClick={async () => {
              if (!commentText.trim()) return;
              setCommentError('');
              try {
                await addComment(post.id, commentText);
                setCommentText('');
                setComments(await listComments(post.id));
              } catch (err) {
                setCommentError(err instanceof Error ? err.message : 'Could not post that comment.');
              }
            }}>Post</button>
          </div>
        </div>
      )}
    </article>
  );
}
