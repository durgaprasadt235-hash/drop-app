import { useEffect, useRef, useState } from 'react';
import type { Post, ServerComment } from '../lib/api';
import { toggleLike, addComment, listComments, voteStoryPoll, getMySettings } from '../lib/api';
import { filterCss } from '../lib/filters';
import { IconComment, IconDrop, IconFire, IconImage, IconMore, IconSave, IconSend, IconShare } from './icons';

// Feed post: Fire instead of heart, double-tap Fire, 500ms long-press
// Comments, creator row with Follow, Poll / Questions / Slider widgets.
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

  return (
    <article className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 56 }}>
        <span className="avatar">{(post.author?.displayName ?? 'D')[0]}</span>
        <strong style={{ flex: 1 }}>{post.author?.displayName ?? post.author?.username}</strong>
        <button className="ghost" onClick={() => onFollow(post.authorId)}>{following ? 'Following' : 'Follow'}</button>
        <button className="ghost" aria-label="More"><IconMore size={22} /></button>
      </div>

      <div
        className="post-media"
        style={{ filter: filterCss(post.filter ?? 'original'), position: 'relative' }}
        onDoubleClick={async () => { if (!fired) { await fire(); setShowFire(true); setTimeout(() => setShowFire(false), 800); } }}
        onPointerDown={() => { longPress.current = window.setTimeout(() => openComments(), 500); }}
        onPointerUp={() => { if (longPress.current) window.clearTimeout(longPress.current); }}
        onPointerLeave={() => { if (longPress.current) window.clearTimeout(longPress.current); }}
      >
        {post.mediaUrl ? <IconImage size={48} /> : <IconDrop size={48} />}
        {showFire && <span style={{ position: 'absolute' }}><IconFire size={64} filled /></span>}
        {extras.poll && <div style={{ position: 'absolute', bottom: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '6px 10px', borderRadius: 8 }}>{extras.poll.question}</div>}
      </div>

      <div className="engagement">
        <button className={fired ? 'fire-on' : ''} onClick={fire} aria-label="Fire"><IconFire size={22} filled={fired} />{hideLikeCounts ? '' : ` ${count}`}</button>
        <button onClick={openComments} aria-label="Comment"><IconComment size={22} /></button>
        <button aria-label="Reshare"><IconShare size={22} /></button>
        <button aria-label="Send"><IconSend size={22} /></button>
        <button aria-label="Save"><IconSave size={22} /></button>
      </div>
      <p style={{ minHeight: 48, margin: '8px 0 0' }}>{post.caption}</p>
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
