// Real-time sync: try a WebSocket viewer channel first, fall back to
// polling when the socket is unavailable. The Muse build subscribes the
// platform viewer channel at sign-in; this standalone uses the same
// contract: onUpdate() is called whenever anything may have changed.

export type Unsubscribe = () => void;

const POLL_MS = 5000;

export function subscribeToUpdates(onUpdate: () => void, wsUrl?: string): Unsubscribe {
  let stopped = false;
  let socket: WebSocket | null = null;
  let poll: number | null = null;

  const startPolling = () => {
    if (poll !== null || stopped) return;
    poll = window.setInterval(() => { if (!stopped) onUpdate(); }, POLL_MS);
  };

  if (wsUrl) {
    try {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => { if (poll !== null) { window.clearInterval(poll); poll = null; } };
      socket.onmessage = () => { if (!stopped) onUpdate(); };
      socket.onerror = () => startPolling();
      socket.onclose = () => startPolling();
    } catch {
      startPolling();
    }
  } else {
    startPolling();
  }

  return () => {
    stopped = true;
    if (poll !== null) window.clearInterval(poll);
    if (socket) socket.close();
  };
}
