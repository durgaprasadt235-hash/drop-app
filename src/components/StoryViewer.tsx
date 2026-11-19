import { useEffect, useRef, useState } from 'react';
import type { Story } from '../lib/api';
import { filterCss } from '../lib/filters';

// 24h Story viewer: 30s per segment, progress + countdown, replay within
// 24h, hold-to-pause, tap right = next / left = previous, swipe-down close.
export default function StoryViewer({
  stories, index, onClose, onIndex,
}: {
  stories: Story[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const story = stories[index];
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => { setElapsed(0); setPaused(false); }, [index]);

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

  const onPointerDown = () => {
    holdTimer.current = window.setTimeout(() => setPaused(true), 220);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    if (paused) { setPaused(false); return; }
    const x = e.clientX;
    const w = window.innerWidth;
    if (x > w * 0.6 && index + 1 < stories.length) onIndex(index + 1);
    else if (x < w * 0.4 && index > 0) onIndex(index - 1);
    else if (x > w * 0.6) onClose();
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
          <button style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18 }} onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
        </span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72, filter: filterCss(story.filter) }}>
        {story.mediaUrl ? '🖼️' : '✦'}
      </div>
      {paused && <div style={{ textAlign: 'center', padding: 8 }}>Paused — hold to pause, release to resume</div>}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: 16 }}>
        <button
          style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px' }}
          onClick={(e) => { e.stopPropagation(); setElapsed(0); setReplayed(true); }}
        >
          ↻ Replay{replayed ? 'ed' : ''}
        </button>
        <span style={{ color: '#aaa', fontSize: 12, alignSelf: 'center' }}>Tap right: next · Tap left: previous · Swipe down: close</span>
      </div>
    </div>
  );
}
