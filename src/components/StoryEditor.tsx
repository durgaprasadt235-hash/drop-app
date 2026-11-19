import { useRef, useState } from 'react';
import { STORY_FILTERS, STORY_EFFECTS, EFFECT_CATEGORIES } from '../lib/filters';

export interface EditorExtras {
  text?: string;
  font?: string;
  textColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  textAnimation?: 'none' | 'fade' | 'pop' | 'rise' | 'pulse';
  textBackground?: 'none' | 'solid' | 'translucent';
  mentionUserId?: number;
  location?: string;
  stickers?: string[];
  avatarPlaced?: boolean;
  avatarPosition?: 'top' | 'center' | 'bottom';
  poll?: { question: string; options: [string, string] };
  question?: string;
  sliderEmoji?: string;
  link?: string;
  hashtag?: string;
  countdownTo?: string;
  drawStrokes?: number;
}

export const FONTS = ['Modern', 'Classic', 'Signature', 'Strong', 'Mono', 'Poster'];
export const PEN_TYPES = ['Pen', 'Arrow', 'Marker', 'Neon', 'Eraser'] as const;
export const DRAW_COLORS = ['#ffffff', '#000000', '#2196f3', '#4caf50', '#ffeb3b', '#ff9800', '#f44336', '#e91e63', '#9c27b0'];
export const STICKER_ENTRIES = [
  'Location', 'Mention', 'Add Yours', 'Frames', 'Photostrip', 'Cutouts', 'Photo',
  'Highlight', 'Questions', 'Poll', 'Emoji slider', 'Link', 'Hashtag', 'Countdown',
  'GIFs', 'Avatar', 'Music', 'Donation', 'Emoji Stickers',
];

// Full Story / Post editor. Music and Donation are honestly unavailable:
// DROP has no licensed music library and no payments provider, so they are
// shown as unavailable rather than faked.
export default function StoryEditor({
  initialFilter = 'original',
  onPublish,
  onCancel,
  kind = 'story',
}: {
  initialFilter?: string;
  onPublish: (args: { filter: string; effect: string; extras: EditorExtras; audience?: 'everyone' | 'close-friends' }) => void;
  onCancel: () => void;
  /** Audience picker only applies to stories; posts are always public. */
  kind?: 'story' | 'post';
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [effect, setEffect] = useState('none');
  const [effectTab, setEffectTab] = useState<string>('For You');
  const [effectSearch, setEffectSearch] = useState('');
  const [tab, setTab] = useState<'filters' | 'text' | 'stickers' | 'effects' | 'draw'>('filters');
  const [text, setText] = useState('');
  const [font, setFont] = useState('Modern');
  const [textColor, setTextColor] = useState('#ffffff');
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [textAnimation, setTextAnimation] = useState<'none' | 'fade' | 'pop' | 'rise' | 'pulse'>('none');
  const [textBackground, setTextBackground] = useState<'none' | 'solid' | 'translucent'>('none');
  const [mention, setMention] = useState('');
  const [location, setLocation] = useState('');
  const [stickers, setStickers] = useState<string[]>([]);
  const [stickerSearch, setStickerSearch] = useState('');
  const [avatarPlaced, setAvatarPlaced] = useState(false);
  const [avatarPosition, setAvatarPosition] = useState<'top' | 'center' | 'bottom'>('center');
  const [pen, setPen] = useState<string>('Pen');
  const [penColor, setPenColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(4);
  const [strokes, setStrokes] = useState(0);
  const [pollQ, setPollQ] = useState('');
  const [question, setQuestion] = useState('');
  const [link, setLink] = useState('');
  const [hashtag, setHashtag] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'close-friends'>('everyone');
  const [notice, setNotice] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const selectedFilter = STORY_FILTERS.find((f) => f.id === filter) ?? STORY_FILTERS[0];
  const selectedEffect = STORY_EFFECTS.find((e) => e.id === effect);
  const effectsShown = STORY_EFFECTS.filter(
    (e) => e.category === effectTab && e.name.toLowerCase().includes(effectSearch.toLowerCase()),
  );
  const stickersShown = STICKER_ENTRIES.filter((s) => s.toLowerCase().includes(stickerSearch.toLowerCase()));

  const toggleSticker = (name: string) => {
    if (name === 'Music') { setNotice('Music is unavailable — DROP has no licensed music library yet.'); return; }
    if (name === 'Donation') { setNotice('Donation is unavailable — DROP has no payments provider yet.'); return; }
    setNotice('');
    if (name === 'Avatar') { setAvatarPlaced((v) => !v); }
    setStickers((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
  };

  const publish = () => {
    if (link && !link.startsWith('https://')) { setNotice('Link stickers must use https://'); return; }
    onPublish({
      filter,
      effect,
      audience: kind === 'story' ? audience : undefined,
      extras: {
        text: text || undefined, font, textColor, textAlign, textAnimation, textBackground,
        mentionUserId: mention ? Number(mention) || undefined : undefined,
        location: location || undefined, stickers, avatarPlaced, avatarPosition,
        poll: pollQ ? { question: pollQ, options: ['Yes', 'No'] } : undefined,
        question: question || undefined, link: link || undefined,
        hashtag: hashtag || undefined, drawStrokes: strokes,
      },
    });
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, margin: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Editor</strong>
        <span>
          <button className="ghost" onClick={onCancel}>Cancel</button>{' '}
          <button className="primary" onClick={publish}>Publish</button>
        </span>
      </div>
      {notice && <div className="notice" style={{ marginTop: 8 }}>{notice}</div>}
      {kind === 'story' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <span className="muted" style={{ alignSelf: 'center' }}>Share with:</span>
          <button className={audience === 'everyone' ? 'primary' : 'ghost'} onClick={() => setAudience('everyone')}>Everyone</button>
          <button className={audience === 'close-friends' ? 'primary' : 'ghost'} onClick={() => setAudience('close-friends')}>Close Friends</button>
        </div>
      )}

      <div style={{ height: 220, borderRadius: 12, margin: '12px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, background: '#111', color: '#fff', filter: `${selectedFilter.css} ${selectedEffect?.css ?? ''}`, textAlign: textAlign }}>
        {text ? <span style={{ color: textColor, fontFamily: font === 'Mono' ? 'monospace' : font === 'Signature' ? 'cursive' : 'sans-serif', background: textBackground === 'solid' ? '#000' : textBackground === 'translucent' ? 'rgba(0,0,0,0.4)' : 'transparent', padding: 8 }}>{text}</span> : '✦'}
      </div>
      {avatarPlaced && <div style={{ textAlign: 'center' }}>Avatar sticker placed ({avatarPosition}) — your profile avatar</div>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {(['filters', 'text', 'stickers', 'effects', 'draw'] as const).map((t) => (
          <button key={t} className={tab === t ? 'primary' : 'ghost'} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
        <button className="ghost" onClick={() => setNotice('Download: your own media can be saved to this device in the full app.')}>Download</button>
        <button className="ghost" onClick={() => setNotice('More: Save draft, Discard, Settings.')}>More</button>
      </div>

      {tab === 'filters' && (
        <div className="filter-strip">
          {STORY_FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>{f.name}</button>
          ))}
        </div>
      )}

      {tab === 'text' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add text…" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FONTS.map((f) => <button key={f} className={font === f ? 'primary' : 'ghost'} onClick={() => setFont(f)}>{f}</button>)}
          </div>
          <label>Colour <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} style={{ width: 48 }} /></label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['left', 'center', 'right'] as const).map((a) => <button key={a} className={textAlign === a ? 'primary' : 'ghost'} onClick={() => setTextAlign(a)}>{a}</button>)}
            {(['none', 'fade', 'pop', 'rise', 'pulse'] as const).map((a) => <button key={a} className={textAnimation === a ? 'primary' : 'ghost'} onClick={() => setTextAnimation(a)}>{a}</button>)}
            {(['none', 'solid', 'translucent'] as const).map((a) => <button key={a} className={textBackground === a ? 'primary' : 'ghost'} onClick={() => setTextBackground(a)}>{a} bg</button>)}
          </div>
          <input value={mention} onChange={(e) => setMention(e.target.value)} placeholder="@ Mention user id (real person)" />
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" />
        </div>
      )}

      {tab === 'stickers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={stickerSearch} onChange={(e) => setStickerSearch(e.target.value)} placeholder="Search stickers…" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {stickersShown.map((s) => (
              <button key={s} className={stickers.includes(s) ? 'primary' : 'ghost'} onClick={() => toggleSticker(s)}>{s}</button>
            ))}
          </div>
          {avatarPlaced && (
            <div style={{ display: 'flex', gap: 6 }}>
              {(['top', 'center', 'bottom'] as const).map((p) => <button key={p} className={avatarPosition === p ? 'primary' : 'ghost'} onClick={() => setAvatarPosition(p)}>Avatar: {p}</button>)}
            </div>
          )}
          <input value={pollQ} onChange={(e) => setPollQ(e.target.value)} placeholder="Poll question" />
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question for viewers" />
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (https://…)" />
          <input value={hashtag} onChange={(e) => setHashtag(e.target.value)} placeholder="#hashtag" />
        </div>
      )}

      {tab === 'effects' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={effectSearch} onChange={(e) => setEffectSearch(e.target.value)} placeholder="See all effects — search…" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EFFECT_CATEGORIES.map((c) => <button key={c} className={effectTab === c ? 'primary' : 'ghost'} onClick={() => setEffectTab(c)}>{c}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={effect === 'none' ? 'primary' : 'ghost'} onClick={() => setEffect('none')}>None</button>
            {effectsShown.map((e) => <button key={e.id} className={effect === e.id ? 'primary' : 'ghost'} onClick={() => setEffect(e.id)}>{e.name}</button>)}
          </div>
        </div>
      )}

      {tab === 'draw' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <canvas
            ref={canvasRef} width={360} height={180} style={{ border: '1px solid var(--border)', borderRadius: 8, touchAction: 'none', background: '#000' }}
            onPointerDown={(e) => { drawing.current = true; const c = canvasRef.current; if (!c) return; const ctx = c.getContext('2d'); if (!ctx) return; ctx.beginPath(); ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY); }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const c = canvasRef.current; if (!c) return; const ctx = c.getContext('2d'); if (!ctx) return;
              ctx.strokeStyle = pen === 'Eraser' ? '#000000' : penColor;
              ctx.lineWidth = brushSize; ctx.lineCap = 'round';
              ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY); ctx.stroke();
              setStrokes((s) => s + 1);
            }}
            onPointerUp={() => { drawing.current = false; }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PEN_TYPES.map((p) => <button key={p} className={pen === p ? 'primary' : 'ghost'} onClick={() => setPen(p)}>{p}</button>)}
            {DRAW_COLORS.map((c) => <button key={c} aria-label={c} style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: penColor === c ? '3px solid #ec4899' : '1px solid #ccc' }} onClick={() => setPenColor(c)} />)}
          </div>
          <label>Brush size {brushSize} <input type="range" min={1} max={12} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} /></label>
          <button className="ghost" onClick={() => { const c = canvasRef.current; c?.getContext('2d')?.clearRect(0, 0, 360, 180); }}>Undo / Clear</button>
        </div>
      )}
    </div>
  );
}
