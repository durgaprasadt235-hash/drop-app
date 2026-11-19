import { useState } from 'react';
import type { Conversation, Message, User } from '../lib/api';
import { listMessages, sendMessage, deleteMessage, createSlashInvitation } from '../lib/api';

// Persistent DMs + Slash: type / to invite someone instantly, no permanent
// group is created, and when they leave it vanishes. Message delete is
// sender-only and removes the message for everyone.
export default function MessagesView({
  conversations, users, me,
}: {
  conversations: Conversation[];
  users: User[];
  me: User;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [slashFor, setSlashFor] = useState('');

  const open = async (id: number) => {
    setOpenId(id);
    setMessages(await listMessages(id));
  };

  const send = async () => {
    if (!openId || !text.trim()) return;
    if (text.startsWith('/')) {
      // Slash: /username invites that person into this chat instantly.
      const target = users.find((u) => u.username === text.slice(1).trim());
      if (target) {
        await createSlashInvitation(openId, target.id);
        setText('');
        return;
      }
    }
    await sendMessage(openId, text);
    setText('');
    setMessages(await listMessages(openId));
  };

  if (openId === null) {
    return (
      <div style={{ padding: 12 }}>
        <h2>Messages</h2>
        {conversations.length === 0 && <p className="muted">No conversations yet.</p>}
        {conversations.map((c) => (
          <button key={c.id} className="card" style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)' }} onClick={() => open(c.id)}>
            Chat #{c.id} — {c.memberIds.filter((id) => id !== me.id).map((id) => users.find((u) => u.id === id)?.username ?? id).join(', ') || 'you'}
          </button>
        ))}
        <p className="muted">Tip: open a chat and type /username to Slash-invite someone.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button className="ghost" onClick={() => setOpenId(null)}>← Back</button>
      {messages.map((m) => (
        <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1, background: m.senderId === me.id ? '#ec4899' : 'var(--surface)', color: m.senderId === me.id ? '#fff' : undefined, padding: '8px 12px', borderRadius: 12 }}>{m.body}</span>
          {m.senderId === me.id && (
            <button className="ghost" onClick={async () => { await deleteMessage(m.id); setMessages(await listMessages(openId)); }}>Delete</button>
          )}
        </div>
      ))}
      <input value={slashFor} onChange={(e) => setSlashFor(e.target.value)} placeholder="Slash: /username to invite…" />
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message… (type / to Slash-invite)" onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
        <button className="primary" onClick={send}>Send</button>
      </div>
      {slashFor && <p className="muted">Slash target: {slashFor} — invite is instant, and vanishes when they leave.</p>}
    </div>
  );
}
