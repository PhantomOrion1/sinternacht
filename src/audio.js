// All sound is synthesised live with the Web Audio API. No audio files.
// Positional sounds get HRTF panning plus a low-pass "behind a wall" filter.

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const R = (a, b) => a + Math.random() * (b - a);

function distCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

// Original melodies (not taken from any song).
const BOX_TUNE = [
  [74, 1], [77, 1], [81, 1], [80, 1], [81, 1], [77, 1], [74, 1], [73, 2],
  [74, 1], [76, 1], [77, 1], [76, 1], [74, 1], [73, 1], [70, 1], [69, 2],
  [77, 1], [80, 1], [81, 1], [86, 1.5], [85, 0.5], [81, 1], [80, 1], [77, 2],
  [76, 1], [74, 1], [73, 1], [74, 1], [70, 1.5], [69, 0.5], [0, 1], [62, 3],
];
const HUM_TUNE = [[50, 1.2], [53, 0.8], [57, 1.6], [56, 0.8], [57, 0.8], [53, 1.6], [50, 1.2], [49, 2.4], [0, 1.2], [50, 0.8], [52, 0.8], [53, 1.6], [52, 0.8], [50, 0.8], [45, 2.8], [0, 2.5]];

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.volume = 0.9;
    this.scareVolume = 1;
    this.tension = 0; this.chase = 0; this.near = 0; this.boxWarp = 0;
  }

  init() {
    if (/[?&]mute\b/.test(location.search)) return; // silent test mode
    if (this.ready) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ready = true;
    // master chain: everything -> master -> limiter -> speakers
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.2;
    this.limiter.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.limiter);
    // jumpscares skip the gentle limiter: driven into a bit-crusher and a hard clipper, pinned at full scale
    this.scareBus = ctx.createGain(); this.scareBus.gain.value = this.scareVolume; this.scareBus.connect(ctx.destination);
    this.scareIn = ctx.createGain(); this.scareIn.gain.value = 1;
    const crush = ctx.createWaveShaper(); crush.curve = (() => { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = Math.round(x * 7) / 7; } return c; })();
    const clip = ctx.createWaveShaper(); clip.curve = (() => { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = Math.max(-0.97, Math.min(0.97, Math.tanh(x * 9))); } return c; })();
    clip.oversample = 'none';
    const presence = this.filt('peaking', 2800, 0.8); presence.gain.value = 9;
    this.scareIn.connect(crush); crush.connect(presence); presence.connect(clip); clip.connect(this.scareBus);
    this.music = ctx.createGain(); this.music.gain.value = 0.8; this.music.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.9; this.amb.connect(this.master);
    // castle reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR(3.4, 2.4);
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.55;
    this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.master);
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 1; this.verbSend.connect(this.reverb);
    // noise
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.dist = distCurve(60);
    this.softDist = distCurve(8);
    this.nextBeat = 0; this.nextHeart = 0; this.nextBox = ctx.currentTime + 2; this.chaseStep = 0;
  }

  makeIR(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 2400 ? (i % 380 < 40 ? 1.4 : 0.6) : 1);
      }
    }
    return b;
  }

  setVolume(v) { this.volume = v; if (this.ready) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setScareVolume(v) { this.scareVolume = v; if (this.ready) this.scareBus.gain.value = v; }
  get t() { return this.ctx.currentTime; }

  setListener(pos, fwd) {
    if (!this.ready) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // ---------- building blocks ----------
  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    s.start(t, Math.random() * 2);
    if (dur) s.stop(t + dur);
    return s;
  }
  osc(type, f, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f;
    o.start(t); if (dur) o.stop(t + dur);
    return o;
  }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filt(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  env(g, t, a, peak, d, hold = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  }
  // A positional output: returns the node to feed. occl 0..1 = how blocked by walls.
  out(pos, occl = 0, opt = {}) {
    const ctx = this.ctx;
    const input = this.gain(1);
    let node = input;
    if (pos) {
      const lp = this.filt('lowpass', 20000 - occl * 19300, 0.7);
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = opt.ref ?? 1.6; p.rolloffFactor = opt.roll ?? 1.25; p.maxDistance = 80;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1.5; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y ?? 1.5, pos.z);
      const og = this.gain(1 - occl * 0.55);
      input.connect(lp); lp.connect(og); og.connect(p);
      node = p;
    }
    node.connect(opt.bus || this.sfx);
    const send = this.gain(opt.verb ?? 0.35);
    node.connect(send); send.connect(this.verbSend);
    if (opt.life) setTimeout(() => { try { node.disconnect(); input.disconnect(); } catch (e) { /* gone */ } }, opt.life * 1000 + 500);
    return input;
  }

  // ---------- ambience & music ----------
  startAmbience() {
    if (this.ambOn || !this.ready) return;
    this.ambOn = true;
    const ctx = this.ctx, t = ctx.currentTime;
    // low drone
    this.droneF = this.filt('lowpass', 160, 3);
    this.droneG = this.gain(0);
    this.droneG.gain.setTargetAtTime(0.07, t, 3);
    for (const f of [55, 55.35, 82.4, 41.2]) { const o = this.osc('sawtooth', f, t); o.connect(this.droneF); }
    this.dissonance = this.gain(0);
    const o2 = this.osc('sawtooth', 58.27, t); o2.connect(this.dissonance); this.dissonance.connect(this.droneF);
    this.droneF.connect(this.droneG); this.droneG.connect(this.music);
    const lfo = this.osc('sine', 0.06, t), lg = this.gain(60); lfo.connect(lg); lg.connect(this.droneF.frequency);
    // wind through the stones
    const wn = this.noiseSrc(t);
    this.windF = this.filt('bandpass', 420, 0.9);
    const wg = this.gain(0.0); wg.gain.setTargetAtTime(0.055, t, 4);
    const wl = this.osc('sine', 0.045, t), wlg = this.gain(260); wl.connect(wlg); wlg.connect(this.windF.frequency);
    const wl2 = this.osc('sine', 0.13, t), wlg2 = this.gain(0.025); wl2.connect(wlg2); wlg2.connect(wg.gain);
    wn.connect(this.windF); this.windF.connect(wg); wg.connect(this.amb);
    const ws = this.gain(0.5); wg.connect(ws); ws.connect(this.verbSend);
    // high tension strings (tremolo cluster)
    this.strG = this.gain(0);
    const sf = this.filt('lowpass', 2600, 0.5);
    for (const m of [86, 87, 81, 92]) { const o = this.osc('sawtooth', midi(m), t); o.detune.value = R(-12, 12); o.connect(sf); }
    const trem = this.gain(0.5), tl = this.osc('sine', 7.5, t), tlg = this.gain(0.5);
    tl.connect(tlg); tlg.connect(trem.gain);
    sf.connect(trem); trem.connect(this.strG); this.strG.connect(this.music);
    const ss = this.gain(0.8); this.strG.connect(ss); ss.connect(this.verbSend);
    // chase bus
    this.chaseG = this.gain(0); this.chaseG.connect(this.music);
  }

  setMood(tension, chase, near, boxWarp) {
    this.tension = tension; this.chase = chase; this.near = near; this.boxWarp = boxWarp;
    if (!this.ambOn) return;
    const t = this.ctx.currentTime;
    // the music stays the same when He shows up — only the heartbeat reacts
    this.strG.gain.setTargetAtTime(0, t, 0.5);
    this.chaseG.gain.setTargetAtTime(0, t, 0.5);
  }

  // Called every frame: schedules music box, heartbeat, chase drums.
  tick() {
    if (!this.ready || !this.ambOn) return;
    const t = this.ctx.currentTime;
    if (t > this.nextBox) this.playMusicBox(t + 0.05);
    if (this.near > 0.12 && t + 0.05 > this.nextHeart) {
      const bpm = 62 + this.near * 95;
      this.heartbeat(this.nextHeart < t ? t + 0.02 : this.nextHeart, this.near);
      this.nextHeart = Math.max(this.nextHeart, t) + 60 / bpm;
    }
  }

  playMusicBox(t0) {
    const ctx = this.ctx;
    const tempo = 0.42 * (1 + this.boxWarp * 0.8);
    let t = t0;
    const out = this.gain(0.22);
    out.connect(this.music);
    const send = this.gain(1.2); out.connect(send); send.connect(this.verbSend);
    const n = BOX_TUNE.length;
    const start = Math.random() < 0.5 ? 0 : 16;
    const count = Math.random() < 0.4 ? n : 16;
    for (let i = 0; i < count; i++) {
      const [m, dur] = BOX_TUNE[(start + i) % n];
      const k = i / count;
      const wind = count === n ? k * k * 0.9 : 0; // winding down
      if (m && Math.random() > 0.04) {
        const f = midi(m) * Math.pow(2, (-wind * 0.6 - this.boxWarp * 0.9 + R(-0.04, 0.04)) / 12);
        this.bell(t, f, out, 0.9 - wind * 0.3);
      }
      t += dur * tempo * (1 + wind * 1.4) * R(0.95, 1.08);
    }
    this.nextBox = t + R(10, 22) * (1 - this.tension * 0.5);
    setTimeout(() => out.disconnect(), (t - ctx.currentTime + 5) * 1000);
  }
  bell(t, f, dest, vol = 1) {
    const g = this.gain(0);
    g.connect(dest);
    for (const [mult, amp, dec] of [[1, 0.6, 2.2], [4.02, 0.12, 0.6], [2.76, 0.08, 0.9], [5.4, 0.04, 0.3]]) {
      const o = this.osc('sine', f * mult, t, dec + 0.1);
      const og = this.gain(0); this.env(og, t, 0.003, amp * vol, dec);
      o.connect(og); og.connect(g);
    }
    g.gain.value = 1;
  }
  heartbeat(t, near) {
    const out = this.gain(0.35 + near * 0.6);
    out.connect(this.music);
    for (const [dt, v] of [[0, 1], [0.19, 0.6]]) {
      const o = this.osc('sine', 62, t + dt, 0.25);
      o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.18);
      const g = this.gain(0); this.env(g, t + dt, 0.012, v, 0.18);
      o.connect(g); g.connect(out);
    }
    setTimeout(() => out.disconnect(), 1500);
  }
  chaseHit(t, i) {
    const s = i % 16;
    const out = this.chaseG;
    const kick = [0, 3, 6, 8, 10, 14].includes(s);
    if (kick) {
      const o = this.osc('sine', 120, t, 0.35);
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
      const g = this.gain(0); this.env(g, t, 0.004, s === 0 ? 1.1 : 0.75, 0.28);
      const sh = this.ctx.createWaveShaper(); sh.curve = this.softDist;
      o.connect(sh); sh.connect(g); g.connect(out);
    }
    if (s === 4 || s === 12) {
      const n = this.noiseSrc(t, 0.25), f = this.filt('bandpass', 1800, 0.8), g = this.gain(0);
      this.env(g, t, 0.002, 0.5, 0.2); n.connect(f); f.connect(g); g.connect(out);
      const sv = this.gain(0.6); g.connect(sv); sv.connect(this.verbSend);
    }
    if (s % 2 === 1 && Math.random() < 0.7) {
      const n = this.noiseSrc(t, 0.05), f = this.filt('highpass', 6000), g = this.gain(0);
      this.env(g, t, 0.001, 0.12, 0.04); n.connect(f); f.connect(g); g.connect(out);
    }
    if (s === 0 && (i / 16) % 2 === 0) {
      // shrieking strings
      const base = R(1100, 1500);
      for (const det of [1, 1.06, 1.5]) {
        const o = this.osc('sawtooth', base * det, t, 1.8);
        o.frequency.exponentialRampToValueAtTime(base * det * R(1.3, 1.6), t + 1.6);
        const vib = this.osc('sine', 9, t, 1.8), vg = this.gain(base * 0.02); vib.connect(vg); vg.connect(o.frequency);
        const g = this.gain(0); this.env(g, t, 0.2, 0.05, 1.4);
        const f = this.filt('bandpass', 2400, 0.7);
        o.connect(f); f.connect(g); g.connect(out);
        const sv = this.gain(0.8); g.connect(sv); sv.connect(this.verbSend);
      }
    }
    if (s === 8 && Math.random() < 0.5) {
      // low brass stab
      for (const m of [26, 27, 32]) {
        const o = this.osc('sawtooth', midi(m), t, 0.9);
        const f = this.filt('lowpass', 500, 2), g = this.gain(0);
        this.env(g, t, 0.01, 0.25, 0.8); o.connect(f); f.connect(g); g.connect(out);
      }
    }
  }

  // ---------- Sinterklaas voice (continuous, positional) ----------
  makeSantaVoice() {
    const ctx = this.ctx, t = ctx.currentTime;
    const v = { };
    v.in = this.gain(1);
    v.lp = this.filt('lowpass', 20000, 0.7);
    v.p = ctx.createPanner();
    Object.assign(v.p, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2.2, rolloffFactor: 1.15, maxDistance: 80 });
    v.occ = this.gain(1);
    v.in.connect(v.lp); v.lp.connect(v.occ); v.occ.connect(v.p); v.p.connect(this.sfx);
    const send = this.gain(0.6); v.p.connect(send); send.connect(this.verbSend);
    // breathing
    v.breathF = this.filt('bandpass', 650, 1.6);
    v.breathG = this.gain(0);
    this.noiseSrc(t).connect(v.breathF); v.breathF.connect(v.breathG); v.breathG.connect(v.in);
    // growl
    v.growlG = this.gain(0);
    const gf = this.filt('lowpass', 260, 2);
    for (const f of [48, 49.3, 72.5]) this.osc('sawtooth', f, t).connect(gf);
    const am = this.osc('sine', 11, t), amg = this.gain(0.5); am.connect(amg); amg.connect(v.growlG.gain);
    gf.connect(v.growlG); v.growlG.connect(v.in);
    // humming voice
    v.hum = this.osc('sawtooth', midi(50), t);
    v.humG = this.gain(0);
    const f1 = this.filt('bandpass', 290, 4), f2 = this.filt('bandpass', 820, 7), f1g = this.gain(1.4), f2g = this.gain(0.5);
    const vib = this.osc('sine', 5.2, t), vibg = this.gain(2.2); vib.connect(vibg); vibg.connect(v.hum.frequency);
    v.hum.connect(f1); v.hum.connect(f2); f1.connect(f1g); f2.connect(f2g); f1g.connect(v.humG); f2g.connect(v.humG);
    v.humG.connect(v.in);
    v.nextBreath = t; v.humIdx = 0; v.nextHum = t + 2; v.mode = 'idle';
    this.santaVoice = v;
    return v;
  }
  updateSantaVoice(pos, occl, mode, dead) {
    if (!this.ready) return;
    const v = this.santaVoice || this.makeSantaVoice();
    const t = this.ctx.currentTime;
    if (v.p.positionX) { v.p.positionX.value = pos.x; v.p.positionY.value = 2.6; v.p.positionZ.value = pos.z; }
    else v.p.setPosition(pos.x, 2.6, pos.z);
    v.lp.frequency.setTargetAtTime(20000 - occl * 19400, t, 0.15);
    v.occ.gain.setTargetAtTime(dead ? 0 : 1 - occl * 0.5, t, 0.15);
    const chase = mode === 'chase';
    // breathing cycles: slow & wet when stalking, fast & ragged when hunting
    if (t > v.nextBreath) {
      const period = chase ? R(0.45, 0.7) : R(2.2, 3.4);
      const peak = chase ? 0.55 : 0.22;
      v.breathF.frequency.setValueAtTime(chase ? R(900, 1400) : R(450, 700), t);
      v.breathG.gain.cancelScheduledValues(t);
      v.breathG.gain.setTargetAtTime(peak, t, period * 0.15);
      v.breathG.gain.setTargetAtTime(0.0, t + period * 0.45, period * 0.12);
      v.nextBreath = t + period;
    }
    v.growlG.gain.setTargetAtTime(chase ? 0.5 : mode === 'search' ? 0.18 : 0.05, t, 0.3);
    // humming while he wanders
    const humming = mode === 'wander' || mode === 'search';
    if (!humming) { v.humG.gain.setTargetAtTime(0, t, 0.1); v.nextHum = t + 1.5; }
    else if (t > v.nextHum) {
      const [m, d] = HUM_TUNE[v.humIdx % HUM_TUNE.length];
      v.humIdx++;
      const dur = d * 0.55;
      if (m) {
        v.hum.frequency.setTargetAtTime(midi(m) * R(0.985, 1.015), t, 0.06);
        v.humG.gain.setTargetAtTime(0.3, t, 0.08);
        v.humG.gain.setTargetAtTime(0.1, t + dur * 0.7, 0.1);
      } else v.humG.gain.setTargetAtTime(0, t, 0.15);
      v.nextHum = t + dur;
      if (v.humIdx % HUM_TUNE.length === 0) v.nextHum += R(4, 12);
    }
  }

  // ---------- one-shots ----------
  footstep(vol, pos = null, occl = 0) {
    if (!this.ready) return;
    vol *= 1.6;
    const t = this.t, o = this.out(pos, occl, { life: 0.4, verb: 0.25 });
    const n = this.noiseSrc(t, 0.12), f = this.filt('bandpass', R(500, 900), 1.2), g = this.gain(0);
    this.env(g, t, 0.004, vol, 0.09); n.connect(f); f.connect(g); g.connect(o);
    const s = this.osc('sine', R(80, 100), t, 0.1), sg = this.gain(0);
    this.env(sg, t, 0.003, vol * 1.2, 0.07); s.connect(sg); sg.connect(o);
  }
  santaStep(pos, occl, heavy = 1) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, occl, { life: 0.8, ref: 2.5, roll: 1, verb: 0.6 });
    const s = this.osc('sine', 70, t, 0.45);
    s.frequency.setValueAtTime(85, t); s.frequency.exponentialRampToValueAtTime(32, t + 0.35);
    const sg = this.gain(0); this.env(sg, t, 0.004, 1.2 * heavy, 0.35); s.connect(sg); sg.connect(o);
    const n = this.noiseSrc(t, 0.1), nf = this.filt('lowpass', 1400), ng = this.gain(0);
    this.env(ng, t, 0.002, 0.35 * heavy, 0.08); n.connect(nf); nf.connect(ng); ng.connect(o);
    if (Math.random() < 0.55) {
      // bones cracking
      for (let i = 0; i < 3; i++) {
        const tt = t + 0.05 + i * R(0.015, 0.04);
        const c = this.noiseSrc(tt, 0.02), cf = this.filt('bandpass', R(2500, 4500), 3), cg = this.gain(0);
        this.env(cg, tt, 0.001, 0.6, 0.015); c.connect(cf); cf.connect(cg); cg.connect(o);
      }
    }
  }
  scream(t, o, { base = 500, dur = 1.4, vol = 1, rise = 1.35, voices = 5 } = {}) {
    const sh = this.ctx.createWaveShaper(); sh.curve = this.dist;
    const bp = this.filt('bandpass', 1400, 0.6);
    bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.6);
    const g = this.gain(0); this.env(g, t, 0.006, vol, dur * 0.35, dur * 0.6);
    sh.connect(bp); bp.connect(g); g.connect(o);
    for (let i = 0; i < voices; i++) {
      const f = base * R(0.8, 1.7);
      const os = this.osc('sawtooth', f, t, dur + 0.1);
      os.frequency.setValueAtTime(f * 0.8, t);
      os.frequency.exponentialRampToValueAtTime(f * rise, t + dur * 0.8);
      const v = this.osc('sine', R(16, 30), t, dur + 0.1), vg = this.gain(f * R(0.05, 0.12));
      v.connect(vg); vg.connect(os.frequency);
      const og = this.gain(0.35); os.connect(og); og.connect(sh);
    }
    const n = this.noiseSrc(t, dur), nf = this.filt('bandpass', 2600, 1.2), ng = this.gain(0.5);
    n.connect(nf); nf.connect(ng); ng.connect(sh);
  }
  santaShriek(pos, occl) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, occl, { life: 2, ref: 4, roll: 0.9, verb: 0.9 });
    this.scream(t, o, { base: 380, dur: 1.3, vol: 0.85, rise: 1.6 });
    const s = this.osc('sawtooth', 60, t, 1.3), sf = this.filt('lowpass', 300), sg = this.gain(0);
    this.env(sg, t, 0.02, 0.6, 1.1); s.connect(sf); sf.connect(sg); sg.connect(o);
  }
  santaHurt(pos) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, 0, { life: 2.5, ref: 4, verb: 0.9 });
    this.scream(t, o, { base: 260, dur: 1.6, vol: 0.9, rise: 0.6, voices: 4 });
  }
  santaDeath(pos) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, 0, { life: 6, ref: 5, verb: 1.2 });
    this.scream(t, o, { base: 420, dur: 4.5, vol: 1, rise: 0.25, voices: 6 });
    const n = this.noiseSrc(t, 5), f = this.filt('lowpass', 180, 1), g = this.gain(0);
    this.env(g, t, 0.5, 0.8, 4); n.connect(f); f.connect(g); g.connect(o);
  }
  elfGiggle(pos, occl = 0, vol = 0.5) {
    if (!this.ready) return;
    const t0 = this.t, o = this.out(pos, occl, { life: 2, ref: 1.2, verb: 0.6 });
    const n = 4 + Math.floor(Math.random() * 4);
    let t = t0, f0 = R(650, 900);
    for (let i = 0; i < n; i++) {
      const os = this.osc('triangle', f0, t, 0.14);
      os.frequency.setValueAtTime(f0 * 1.1, t); os.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + 0.1);
      const f1 = this.filt('bandpass', 1900, 3), g = this.gain(0);
      this.env(g, t, 0.01, vol, 0.09);
      os.connect(f1); f1.connect(g); g.connect(o);
      const ns = this.noiseSrc(t, 0.1), nf = this.filt('bandpass', 3000, 2), ngn = this.gain(0);
      this.env(ngn, t, 0.01, vol * 0.25, 0.07); ns.connect(nf); nf.connect(ngn); ngn.connect(o);
      t += R(0.1, 0.15); f0 *= R(0.93, 1.0);
    }
  }
  elfScratch(pos, occl = 0) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, occl, { life: 1, ref: 1, verb: 0.3 });
    for (let i = 0; i < 5; i++) {
      const tt = t + i * R(0.04, 0.09);
      const n = this.noiseSrc(tt, 0.04), f = this.filt('highpass', R(2000, 5000)), g = this.gain(0);
      this.env(g, tt, 0.002, 0.25, 0.03); n.connect(f); f.connect(g); g.connect(o);
    }
  }
  whisper(pos, occl = 0, vol = 0.25, syll = 6) {
    if (!this.ready) return;
    let t = this.t;
    const o = this.out(pos, occl, { life: 4, ref: 0.6, roll: 1.4, verb: 0.5 });
    for (let i = 0; i < syll; i++) {
      const d = R(0.08, 0.22);
      const n = this.noiseSrc(t, d + 0.05);
      const f1 = this.filt('bandpass', R(1200, 3200), R(4, 9)), f2 = this.filt('bandpass', R(500, 900), 5), g = this.gain(0);
      this.env(g, t, d * 0.4, vol, d * 0.6);
      n.connect(f1); n.connect(f2); f1.connect(g); f2.connect(g); g.connect(o);
      t += d + R(0.02, 0.12);
    }
  }
  pickup() {
    if (!this.ready) return;
    const t = this.t, o = this.out(null, 0, { life: 4, verb: 1 });
    [69, 72, 76, 81, 80].forEach((m, i) => this.bell(t + i * 0.11, midi(m + 12), o, 0.18));
  }
  battery() {
    if (!this.ready) return;
    const t = this.t, o = this.out(null, 0, { life: 1 });
    for (const dt of [0, 0.09]) {
      const n = this.noiseSrc(t + dt, 0.03), f = this.filt('highpass', 2500), g = this.gain(0);
      this.env(g, t + dt, 0.001, 0.4, 0.025); n.connect(f); f.connect(g); g.connect(o);
    }
    const h = this.osc('sawtooth', 120, t + 0.1, 0.4), hf = this.filt('lowpass', 800), hg = this.gain(0);
    this.env(hg, t + 0.1, 0.05, 0.08, 0.3); h.connect(hf); hf.connect(hg); hg.connect(o);
  }
  click() {
    if (!this.ready) return;
    const t = this.t, o = this.out(null, 0, { life: 0.3, verb: 0.1 });
    const n = this.noiseSrc(t, 0.02), f = this.filt('bandpass', 3500, 2), g = this.gain(0);
    this.env(g, t, 0.001, 0.35, 0.018); n.connect(f); f.connect(g); g.connect(o);
  }
  stoneGrind(pos, dur = 1.8) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, 0, { life: dur + 1, verb: 0.8 });
    const n = this.noiseSrc(t, dur), f = this.filt('lowpass', 320, 2), g = this.gain(0);
    this.env(g, t, 0.15, 0.9, dur * 0.5, dur * 0.4);
    const tr = this.osc('square', 13, t, dur), tg = this.gain(0.4); tr.connect(tg); tg.connect(g.gain);
    n.connect(f); f.connect(g); g.connect(o);
    const r = this.osc('sine', 38, t, dur), rg = this.gain(0); this.env(rg, t, 0.2, 0.6, dur * 0.7); r.connect(rg); rg.connect(o);
  }
  crossbow(pos = null) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, 0, { life: 1, verb: 0.5 });
    const s = this.osc('sawtooth', 115, t, 0.35), sf = this.filt('lowpass', 1200), sg = this.gain(0);
    s.frequency.exponentialRampToValueAtTime(90, t + 0.3);
    this.env(sg, t, 0.002, 0.6, 0.3); s.connect(sf); sf.connect(sg); sg.connect(o);
    const n = this.noiseSrc(t, 0.08), nf = this.filt('highpass', 1200), ng = this.gain(0);
    this.env(ng, t, 0.001, 0.5, 0.07); n.connect(nf); nf.connect(ng); ng.connect(o);
  }
  thunk(pos) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, 0, { life: 0.6 });
    const s = this.osc('sine', 220, t, 0.15); s.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    const g = this.gain(0); this.env(g, t, 0.002, 0.6, 0.12); s.connect(g); g.connect(o);
  }
  reload() {
    if (!this.ready) return;
    const t = this.t, o = this.out(null, 0, { life: 1.4 });
    for (const dt of [0, 0.35, 0.9]) {
      const n = this.noiseSrc(t + dt, 0.05), f = this.filt('bandpass', dt > 0.5 ? 2600 : 1200, 3), g = this.gain(0);
      this.env(g, t + dt, 0.002, 0.35, 0.05); n.connect(f); f.connect(g); g.connect(o);
    }
  }
  doorSlam(pos, occl) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, occl, { life: 3, ref: 3, verb: 1.3 });
    const n = this.noiseSrc(t, 0.4), f = this.filt('lowpass', 700), g = this.gain(0);
    this.env(g, t, 0.002, 1, 0.3); n.connect(f); f.connect(g); g.connect(o);
    const s = this.osc('sine', 55, t, 0.6); s.frequency.exponentialRampToValueAtTime(35, t + 0.5);
    const sg = this.gain(0); this.env(sg, t, 0.002, 0.9, 0.5); s.connect(sg); sg.connect(o);
  }
  distantScream(pos) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, 0.85, { life: 3, ref: 2, verb: 1.6 });
    this.scream(t, o, { base: R(600, 900), dur: 1.2, vol: 0.35, rise: 0.8, voices: 3 });
  }
  bellToll() {
    if (!this.ready) return;
    const t = this.t, o = this.out(null, 0, { life: 9, verb: 1.5, bus: this.amb });
    const f = 98;
    for (const [mult, amp] of [[0.5, 0.25], [1, 0.3], [1.19, 0.12], [1.5, 0.1], [2.0, 0.12], [2.74, 0.06], [3.76, 0.03]]) {
      const os = this.osc('sine', f * mult, t, 8.5), g = this.gain(0);
      this.env(g, t, 0.005, amp * 0.6, 8); os.connect(g); g.connect(o);
    }
  }
  thunder(delay = 0) {
    if (!this.ready) return;
    const t = this.t + delay, o = this.out(null, 0, { life: 7 + delay, verb: 1, bus: this.amb });
    const n = this.noiseSrc(t, 6), f = this.filt('lowpass', 900, 0.7), g = this.gain(0);
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(90, t + 3);
    this.env(g, t, 0.02, 0.9, 5);
    const am = this.osc('sine', 3.5, t, 6), amg = this.gain(0.4); am.connect(amg); amg.connect(g.gain);
    n.connect(f); f.connect(g); g.connect(o);
  }
  breathing(vol) {
    if (!this.ready) return;
    const t = this.t, o = this.out(null, 0, { life: 1.4, verb: 0.15 });
    for (const [dt, fr, d] of [[0, 1100, 0.35], [0.45, 700, 0.45]]) {
      const n = this.noiseSrc(t + dt, d + 0.1), f = this.filt('bandpass', fr, 1.2), g = this.gain(0);
      this.env(g, t + dt, d * 0.4, vol, d * 0.6); n.connect(f); f.connect(g); g.connect(o);
    }
  }
  creak(pos, occl = 0.5) {
    if (!this.ready) return;
    const t = this.t, o = this.out(pos, occl, { life: 3, ref: 2, verb: 1 });
    const s = this.osc('sawtooth', 90, t, 1.6), f = this.filt('bandpass', 700, 6), g = this.gain(0);
    s.frequency.setValueAtTime(R(70, 110), t); s.frequency.linearRampToValueAtTime(R(130, 220), t + 1.2);
    const am = this.osc('square', R(18, 30), t, 1.6), ag = this.gain(0.5); am.connect(ag); ag.connect(g.gain);
    this.env(g, t, 0.15, 0.25, 0.6, 0.6); s.connect(f); f.connect(g); g.connect(o);
  }
  chains(pos, occl = 0.5) {
    if (!this.ready) return;
    const t0 = this.t, o = this.out(pos, occl, { life: 3, ref: 2, verb: 1.1 });
    for (let i = 0; i < 9; i++) {
      const t = t0 + i * R(0.05, 0.16);
      for (const f of [R(2200, 3600), R(4200, 6000)]) {
        const s = this.osc('sine', f, t, 0.25), g = this.gain(0); this.env(g, t, 0.001, 0.06, 0.2); s.connect(g); g.connect(o);
      }
    }
  }
  knock(pos, occl = 0.6) {
    if (!this.ready) return;
    const t0 = this.t, o = this.out(pos, occl, { life: 3, ref: 2, verb: 1.2 });
    const n = Math.random() < 0.5 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.32;
      const s = this.osc('sine', 120, t, 0.2); s.frequency.exponentialRampToValueAtTime(60, t + 0.15);
      const g = this.gain(0); this.env(g, t, 0.002, 0.7, 0.15); s.connect(g); g.connect(o);
      const nn = this.noiseSrc(t, 0.05), nf = this.filt('lowpass', 900), ng = this.gain(0); this.env(ng, t, 0.001, 0.3, 0.04); nn.connect(nf); nf.connect(ng); ng.connect(o);
    }
  }
  drip(pos) {
    if (!this.ready) return;
    const t0 = this.t, o = this.out(pos, 0.2, { life: 4, ref: 1.5, verb: 1.4 });
    for (let i = 0; i < 4; i++) {
      const t = t0 + i * R(0.6, 1.1);
      const s = this.osc('sine', R(900, 1400), t, 0.12); s.frequency.exponentialRampToValueAtTime(R(1800, 2600), t + 0.06);
      const g = this.gain(0); this.env(g, t, 0.002, 0.12, 0.08); s.connect(g); g.connect(o);
    }
  }
  // soft, wet whimpering from above
  whimper(pos, occl = 0) {
    if (!this.ready) return;
    let t = this.t;
    const o = this.out(pos, occl, { life: 3, ref: 1.2, verb: 0.7 });
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
      const d = R(0.25, 0.5), f = R(380, 520);
      const s = this.osc('triangle', f, t, d + 0.05); s.frequency.setValueAtTime(f, t); s.frequency.exponentialRampToValueAtTime(f * 0.72, t + d);
      const v = this.osc('sine', 7, t, d), vg = this.gain(f * 0.03); v.connect(vg); vg.connect(s.frequency);
      const bp = this.filt('bandpass', 900, 3), g = this.gain(0); this.env(g, t, 0.05, 0.16, d * 0.8);
      s.connect(bp); bp.connect(g); g.connect(o);
      const n = this.noiseSrc(t, d), nf = this.filt('bandpass', 1800, 4), ng = this.gain(0); this.env(ng, t, 0.05, 0.05, d * 0.8); n.connect(nf); nf.connect(ng); ng.connect(o);
      t += d + R(0.15, 0.45);
    }
  }
  sting() {
    // sudden low piano cluster: a "something's wrong" sting
    if (!this.ready) return;
    const t = this.t, o = this.out(null, 0, { life: 5, verb: 1.4, bus: this.music });
    for (const m of [33, 34, 39, 45, 46]) {
      const os = this.osc('triangle', midi(m), t, 4), g = this.gain(0);
      this.env(g, t, 0.004, 0.22, 3.5); os.connect(g); g.connect(o);
    }
  }

  // ---------- THE JUMPSCARES ----------
  jumpscare() {
    if (!this.ready) return;
    const t = this.t;
    const o = this.gain(2.6);
    o.connect(this.scareIn);
    // rasp: a 45Hz chopper on everything — the sound physically flutters
    const chop = this.gain(0.55), lfo = this.osc('square', 45, t, 2), lg = this.gain(0.45);
    lfo.connect(lg); lg.connect(chop.gain);
    chop.connect(o);
    // ear-piercing beating cluster in the 2-4kHz band
    for (const [f, df] of [[2100, 37], [2900, 53], [3700, 29]]) {
      for (const ff of [f, f + df]) {
        const s = this.osc('sawtooth', ff, t, 1.9);
        s.frequency.setValueAtTime(ff * 0.8, t); s.frequency.exponentialRampToValueAtTime(ff * 1.25, t + 1.6);
        const g = this.gain(0); this.env(g, t, 0.01, 0.35, 0.3, 1.4); s.connect(g); g.connect(chop);
      }
    }
    // ring modulation: the scream turns metallic and wrong
    const ring = this.gain(0), ringOsc = this.osc('sine', 137, t, 2); ringOsc.frequency.linearRampToValueAtTime(410, t + 1.8);
    ringOsc.connect(ring.gain);
    this.scream(t + 0.02, ring, { base: 700, dur: 1.7, vol: 1.5, rise: 2.2, voices: 6 });
    const rg = this.gain(1.4); ring.connect(rg); rg.connect(o);
    // stutter gate that changes speed — the audio itself sounds broken
    const gate = this.gain(0), gl = this.osc('square', 12, t, 2), gg = this.gain(0.5);
    gl.frequency.setValueAtTime(12, t); gl.frequency.setValueAtTime(31, t + 0.5); gl.frequency.setValueAtTime(7, t + 0.9); gl.frequency.setValueAtTime(48, t + 1.25); gl.frequency.setValueAtTime(19, t + 1.5);
    gl.connect(gg); gg.connect(gate.gain);
    this.scream(t + 0.05, gate, { base: 300, dur: 1.75, vol: 1.6, rise: 0.4, voices: 5 });
    const gt = this.gain(1.2); gate.connect(gt); gt.connect(o);
    // digital glitch bursts
    for (let i = 0; i < 14; i++) {
      const tt = t + R(0, 1.7), d = R(0.02, 0.07);
      const sq = this.osc('square', R(80, 4000), tt, d), sqg = this.gain(0); this.env(sqg, tt, 0.001, 0.7, d);
      sq.connect(sqg); sqg.connect(o);
    }
    // pitch-diving sirens
    for (const f0 of [1800, 2400]) {
      const sv = this.osc('sawtooth', f0, t, 1.9); sv.frequency.exponentialRampToValueAtTime(f0 * 0.18, t + 1.8);
      const svg = this.gain(0); this.env(svg, t, 0.01, 0.4, 0.4, 1.3); sv.connect(svg); svg.connect(o);
    }
    // second hit when He lunges again
    const t2 = t + 1.0;
    const n2 = this.noiseSrc(t2, 0.4), n2f = this.filt('lowpass', 4000), n2g = this.gain(0);
    this.env(n2g, t2, 0.001, 1.8, 0.35); n2.connect(n2f); n2f.connect(n2g); n2g.connect(o);
    const sub2 = this.osc('sine', 70, t2, 0.8); sub2.frequency.exponentialRampToValueAtTime(28, t2 + 0.6);
    const s2g = this.gain(0); this.env(s2g, t2, 0.002, 1.6, 0.6); sub2.connect(s2g); s2g.connect(o);
    this.scream(t2, chop, { base: 800, dur: 0.75, vol: 1.4, rise: 1.8, voices: 6 });
    const vs = this.gain(0.4); o.connect(vs); vs.connect(this.verbSend);
    // impact
    const n = this.noiseSrc(t, 0.6), nf = this.filt('lowpass', 5000), ng = this.gain(0);
    this.env(ng, t, 0.001, 1.6, 0.5); n.connect(nf); nf.connect(ng); ng.connect(o);
    const sub = this.osc('sine', 90, t, 1.8); sub.frequency.exponentialRampToValueAtTime(30, t + 1.4);
    const sg = this.gain(0); this.env(sg, t, 0.003, 1.6, 1.5); sub.connect(sg); sg.connect(o);
    // the scream
    this.scream(t, chop, { base: 520, dur: 1.75, vol: 1.8, rise: 1.5, voices: 8 });
    this.scream(t + 0.03, chop, { base: 210, dur: 1.6, vol: 1.2, rise: 1.2, voices: 5 });
    // orchestral cluster
    for (const m of [36, 37, 42, 48, 49, 55, 61]) {
      const os = this.osc('sawtooth', midi(m), t, 1.8), f = this.filt('lowpass', 2200), g = this.gain(0);
      this.env(g, t, 0.003, 0.3, 1.6); os.connect(f); f.connect(g); g.connect(o);
    }
    setTimeout(() => o.disconnect(), 3000);
  }
  // the helpers sound nothing like Him: a shrill, giggling, chattering shriek — high, fast, insect-like
  grabScare() {
    if (!this.ready) return;
    const t = this.t;
    const o = this.gain(1.3);
    o.connect(this.scareIn);
    // a deep, raw scream under the shrieking
    this.scream(t, o, { base: 240, dur: 1.05, vol: 1.3, rise: 1.25, voices: 5 });
    const sub = this.osc('sine', 85, t, 0.7); sub.frequency.exponentialRampToValueAtTime(35, t + 0.6);
    const sg = this.gain(0); this.env(sg, t, 0.003, 1.3, 0.6); sub.connect(sg); sg.connect(o);
    // sharp crack on contact
    const n = this.noiseSrc(t, 0.12), nf = this.filt('highpass', 2500), ng = this.gain(0);
    this.env(ng, t, 0.001, 1.6, 0.1); n.connect(nf); nf.connect(ng); ng.connect(o);
    // shrill giggle-shriek: fast pulsing high voice, pitch jumping
    let tt = t;
    for (let i = 0; i < 11; i++) {
      const f = R(1600, 2600) * (1 + i * 0.03), d = R(0.06, 0.1);
      const os = this.osc('square', f, tt, d + 0.02); os.frequency.exponentialRampToValueAtTime(f * 0.7, tt + d);
      const bp = this.filt('bandpass', 3000, 2), g = this.gain(0); this.env(g, tt, 0.004, 0.9, d);
      os.connect(bp); bp.connect(g); g.connect(o);
      tt += d + R(0.005, 0.03);
    }
    // glassy screech underneath
    for (const f of [3200, 3350, 4700]) {
      const s2 = this.osc('sawtooth', f, t, 1.0); s2.frequency.linearRampToValueAtTime(f * 1.15, t + 0.9);
      const v = this.osc('sine', 45, t, 1), vg = this.gain(f * 0.04); v.connect(vg); vg.connect(s2.frequency);
      const g = this.gain(0); this.env(g, t, 0.01, 0.35, 0.3, 0.5); s2.connect(g); g.connect(o);
    }
    // insect chatter / teeth clicking
    for (let i = 0; i < 40; i++) {
      const c = t + i * 0.025 + R(0, 0.01);
      const cs = this.noiseSrc(c, 0.012), cf = this.filt('bandpass', R(4000, 8000), 6), cg = this.gain(0);
      this.env(cg, c, 0.001, 0.8, 0.01); cs.connect(cf); cf.connect(cg); cg.connect(o);
    }
    setTimeout(() => o.disconnect(), 2000);
  }
  tinnitus() {
    if (!this.ready) return;
    const t = this.t, o = this.out(null, 0, { life: 9, verb: 0 });
    const s = this.osc('sine', 6800, t, 8), g = this.gain(0);
    this.env(g, t, 0.05, 0.05, 7.5); s.connect(g); g.connect(o);
    // muffle everything else for a moment
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0.05, t);
    this.master.gain.linearRampToValueAtTime(this.volume, t + 6);
  }
  victory() {
    if (!this.ready) return;
    const t = this.t, o = this.out(null, 0, { life: 9, verb: 1.4, bus: this.music });
    [[57, 0], [60, 0.6], [64, 1.2], [69, 1.8], [64, 2.6], [72, 3.2]].forEach(([m, dt]) => this.bell(t + dt, midi(m + 12), o, 0.6));
  }
  stopAll() {
    if (!this.ready) return;
    const t = this.t;
    if (this.chaseG) this.chaseG.gain.setTargetAtTime(0, t, 0.05);
    if (this.strG) this.strG.gain.setTargetAtTime(0, t, 0.05);
    if (this.santaVoice) this.santaVoice.occ.gain.setTargetAtTime(0, t, 0.05);
    this.near = 0; this.chase = 0;
  }
}
