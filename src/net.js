// Peer-to-peer links for up to three players (PeerJS). The host runs the monsters; guests mirror them.
const PREFIX = 'sinternacht-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Optional: drop a config.json next to index.html with {"iceServers": [...]} to add a TURN relay.
export async function loadIceConfig() {
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j.iceServers) && j.iceServers.length) ICE = j.iceServers;
  } catch (e) { /* no config: STUN only */ }
}

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export const MAX_PLAYERS = 3;
const GUEST_IDS = ['p2', 'p3'];

// Host: one link per guest (up to two), keyed by player id. Guest: a single link to the host ('p1').
export class Net {
  constructor() {
    this.peer = null; this.conns = new Map(); this.isHost = false; this.code = '';
    this.myId = null; // a guest learns its id from the host's 'welcome'
    this.accept = null; // host: () => bool, whether new guests may come in right now
    this.onMessage = null; this.onOpen = null; this.onClose = null; this.onError = null;
  }
  get connected() { for (const c of this.conns.values()) if (c.open) return true; return false; }
  ids() { return [...this.conns.keys()].filter((id) => this.conns.get(id).open); }

  host() {
    return new Promise((resolve, reject) => {
      const tryOnce = (attempt) => {
        this.code = makeCode();
        const peer = new window.Peer(PREFIX + this.code, { config: { iceServers: ICE }, debug: 0 });
        this.peer = peer;
        this.isHost = true;
        this.myId = 'p1';
        peer.on('open', () => resolve(this.code));
        peer.on('connection', (c) => {
          const id = GUEST_IDS.find((g) => !this.conns.has(g));
          if (!id || (this.accept && !this.accept())) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
          this.attach(c, id, () => c.send({ t: 'welcome', id }));
        });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && attempt < 4) { peer.destroy(); tryOnce(attempt + 1); return; }
          if (!this.conns.size) reject(e);
          this.onError?.(e);
        });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
      };
      tryOnce(0);
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      this.code = code.toUpperCase().trim();
      this.isHost = false;
      const peer = new window.Peer(undefined, { config: { iceServers: ICE }, debug: 0 });
      this.peer = peer;
      const timer = setTimeout(() => reject(new Error('timeout')), 15000);
      peer.on('open', () => {
        const c = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
        this.attach(c, 'p1', () => { clearTimeout(timer); resolve(); });
      });
      peer.on('error', (e) => { clearTimeout(timer); if (!this.connected) reject(e); this.onError?.(e); });
    });
  }

  attach(c, id, opened) {
    this.conns.set(id, c);
    c.lastSeen = Date.now();
    const drop = () => { if (this.conns.get(id) === c) { this.conns.delete(id); try { c.close(); } catch (e) { /* ignore */ } this.onClose?.(id); } };
    c.on('open', () => {
      c.lastSeen = Date.now();
      // a closed tab often never sends 'close': watch the underlying connection too
      const pc = c.peerConnection;
      if (pc) pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) drop(); });
      opened?.(); this.onOpen?.(id);
      this.startHeartbeat();
    });
    c.on('data', (d) => {
      c.lastSeen = Date.now();
      if (d && d.t === 'ping') return;
      if (d && d.t === 'welcome' && !this.isHost) this.myId = d.id;
      this.onMessage?.(d, id);
    });
    c.on('close', drop);
    c.on('error', () => { /* surfaced through close */ });
  }

  // everyone pings every 2 s; a link that's been silent for 15 s is treated as gone
  startHeartbeat() {
    if (this.hb) return;
    this.hb = setInterval(() => {
      const now = Date.now();
      for (const [id, c] of [...this.conns]) {
        if (!c.open) continue;
        try { c.send({ t: 'ping' }); } catch (e) { /* dropped */ }
        if (now - c.lastSeen > 15000) { this.conns.delete(id); try { c.close(); } catch (e) { /* ignore */ } this.onClose?.(id); }
      }
    }, 2000);
  }

  // to everyone (host: all guests; guest: the host)
  send(obj, except) {
    for (const [id, c] of this.conns) {
      if (id === except || !c.open) continue;
      try { c.send(obj); } catch (e) { /* dropped */ }
    }
  }
  sendTo(id, obj) { const c = this.conns.get(id); if (c?.open) { try { c.send(obj); } catch (e) { /* dropped */ } } }

  close() {
    clearInterval(this.hb); this.hb = null;
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    try { this.peer?.destroy(); } catch (e) { /* ignore */ }
    this.conns.clear(); this.peer = null;
  }
}
