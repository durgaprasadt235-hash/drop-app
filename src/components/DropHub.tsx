import { useState } from 'react';
import type { Drop } from '../lib/api';
import { createDrop, openDrop } from '../lib/api';
import { IconDrop, IconFire, IconLock } from './icons';

// DROP Hub: Waiting / Ready to Open, Blast presets 1h / 6h / 24h / 3d / 7d,
// sealed Drops (no caption or media before reveal), Blast animation on
// first open, Public vs Protected rules.
export const BLAST_PRESETS = [
  { id: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { id: '6h', label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { id: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '3d', label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
];

export default function DropHub({ drops, onRefresh }: { drops: Drop[]; onRefresh: () => void }) {
  const [tab, setTab] = useState<'waiting' | 'ready'>('waiting');
  const [kind, setKind] = useState<'public' | 'protected'>('public');
  const [preset, setPreset] = useState('24h');
  const [caption, setCaption] = useState('');
  const [blasting, setBlasting] = useState<number | null>(null);

  const waiting = drops.filter((d) => d.status === 'waiting');
  const ready = drops.filter((d) => d.status === 'ready' || d.status === 'revealed');
  const shown = tab === 'waiting' ? waiting : ready;

  const create = async () => {
    const p = BLAST_PRESETS.find((x) => x.id === preset)!;
    await createDrop({ kind, blastAt: new Date(Date.now() + p.ms).toISOString(), caption });
    setCaption('');
    onRefresh();
  };

  const open = async (d: Drop) => {
    setBlasting(d.id);
    setTimeout(async () => { await openDrop(d.id); setBlasting(null); onRefresh(); }, 900);
  };

  return (
    <div style={{ padding: 12 }}>
      <h2>DROP Hub</h2>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={tab === 'waiting' ? 'primary' : 'ghost'} onClick={() => setTab('waiting')}>Waiting ({waiting.length})</button>
        <button className={tab === 'ready' ? 'primary' : 'ghost'} onClick={() => setTab('ready')}>Ready to Open ({ready.length})</button>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="New Drop caption…" />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {BLAST_PRESETS.map((p) => <button key={p.id} className={preset === p.id ? 'primary' : 'ghost'} onClick={() => setPreset(p.id)}>{p.label}</button>)}
          <button className={kind === 'public' ? 'primary' : 'ghost'} onClick={() => setKind('public')}>Public</button>
          <button className={kind === 'protected' ? 'primary' : 'ghost'} onClick={() => setKind('protected')}>Protected</button>
        </div>
        <button className="primary" onClick={create}>Create Drop</button>
        <p className="muted">Protected Drops hide Save / Share, and the server rejects saving them.</p>
      </div>

      {shown.length === 0 && <p className="muted">No {tab} Drops yet.</p>}
      {shown.map((d) => (
        <div key={d.id} className="card">
          {d.status === 'waiting' ? (
            <p><IconLock size={16} /> Sealed — blasts {new Date(d.blastAt).toLocaleString()}<br /><span className="muted">Caption and media are hidden until reveal.</span></p>
          ) : (
            <p>{blasting === d.id ? <><IconFire size={18} filled /> BLAST!</> : <><IconDrop size={16} /> {d.caption ?? 'Drop'} — {d.kind}</>}</p>
          )}
          {d.status !== 'waiting' && <button className="primary" onClick={() => open(d)}>Open Drop</button>}
        </div>
      ))}
    </div>
  );
}
