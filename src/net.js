// Two-player peer-to-peer link (PeerJS). The host runs the monsters; the guest mirrors them.
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

export class Net {
  constructor() {
    this.peer = null; this.conn = null; this.isHost = false; this.code = '';
    this.onMessage = null; this.onOpen = null; this.onClose = null; this.onError = null;
  }
  get connected() { return !!this.conn && this.conn.open; }

  host() {
    return new Promise((resolve, reject) => {
      const tryOnce = (attempt) => {
        this.code = makeCode();
        const peer = new window.Peer(PREFIX + this.code, { config: { iceServers: ICE }, debug: 0 });
        this.peer = peer;
        this.isHost = true;
        peer.on('open', () => resolve(this.code));
        peer.on('connection', (c) => {
          if (this.conn && this.conn.open) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
          this.attach(c);
        });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && attempt < 4) { peer.destroy(); tryOnce(attempt + 1); return; }
          if (!this.conn) reject(e);
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
        this.attach(c, () => { clearTimeout(timer); resolve(); });
      });
      peer.on('error', (e) => { clearTimeout(timer); if (!this.conn?.open) reject(e); this.onError?.(e); });
    });
  }

  attach(c, opened) {
    this.conn = c;
    c.on('open', () => { opened?.(); this.onOpen?.(); });
    c.on('data', (d) => this.onMessage?.(d));
    c.on('close', () => { if (this.conn === c) { this.conn = null; this.onClose?.(); } });
    c.on('error', () => { /* surfaced through close */ });
  }

  send(obj) { if (this.conn && this.conn.open) { try { this.conn.send(obj); } catch (e) { /* dropped */ } } }

  close() {
    try { this.conn?.close(); } catch (e) { /* ignore */ }
    try { this.peer?.destroy(); } catch (e) { /* ignore */ }
    this.conn = null; this.peer = null;
  }
}
