// The soot helpers: people, almost. Covered head to toe in chimney soot, dressed as old-fashioned
// pages, faces blank and still, milky eyes that never blink and never stop following you.
// Harmless... unless you touch one.
import * as THREE from 'three';
import { makeRng, R, clamp, damp, dampAngle, angleDiff } from './rng.js';
import { makeHead } from './faces.js';

export const ELF_MODES = ['idle', 'crawl', 'stand', 'charge', 'flee', 'grab', 'gone', 'dead'];
const TOUCH = 0.72;
const EL1 = 0.44, EL2 = 0.42, HEAD_R = 0.105;

function limb(len, r0, r1, mat, seg = 8) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = true;
  return m;
}
function ball(r, mat, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 12, 9); g.scale(sx, sy, sz);
  const m = new THREE.Mesh(g, mat); m.castShadow = true;
  return m;
}

const FACES = [
  { seed: 21, w: 0.84, h: 1.1, nose: 0.95, noseLen: 1, cheek: 1.1, hollow: 0.6, jawW: 0.82, chin: 1.1, mouthW: 0.9, lip: 0.6, eyeGap: 1.04 },
  { seed: 22, w: 0.88, h: 1.14, nose: 1.05, noseLen: 1.08, cheek: 0.9, hollow: 1.0, jawW: 0.78, chin: 0.9, mouthW: 0.85, lip: 0.55, eyeGap: 0.98 },
  { seed: 23, w: 0.82, h: 1.18, nose: 0.9, noseLen: 0.95, cheek: 1.3, hollow: 1.3, jawW: 0.74, chin: 1.2, mouthW: 0.95, lip: 0.5, eyeGap: 1.08, eyeAsym: 0.4 },
];

function buildElf(M, glowMat, rng) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const pelvis = new THREE.Group(); pelvis.position.y = 0.9; body.add(pelvis);
  const coat = rng.pick([M.maroon, M.teal, M.ochre]);
  const breeches = ball(0.17, coat, 1.15, 0.85, 0.95); breeches.position.y = -0.06; pelvis.add(breeches);
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.09, -0.08, 0); pelvis.add(hip);
    hip.add(limb(EL1, 0.058, 0.042, M.tights));
    const knee = new THREE.Group(); knee.position.y = -EL1; hip.add(knee);
    knee.add(ball(0.044, M.tights));
    knee.add(limb(EL2, 0.042, 0.03, M.tights));
    const calf = ball(0.042, M.tights, 1, 2.2, 1); calf.position.set(0, -0.14, -0.012); knee.add(calf);
    const ankle = new THREE.Group(); ankle.position.y = -EL2; knee.add(ankle);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.06, 0.24), M.shoe); shoe.position.set(0, -0.025, 0.06); shoe.castShadow = true; ankle.add(shoe);
    return { hip, knee, ankle };
  });
  const torso = new THREE.Group(); pelvis.add(torso);
  const doublet = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.135, 0.46, 12), coat); doublet.scale.z = 0.8; doublet.position.y = 0.23; doublet.castShadow = true; torso.add(doublet);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 12), M.shoe); belt.scale.z = 0.8; belt.position.y = 0.03; torso.add(belt);
  // pleated ruff collar, grey with soot
  const ruff = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.05, 8, 22), M.ruff); ruff.rotation.x = Math.PI / 2; ruff.scale.set(1, 1, 0.65); ruff.position.y = 0.47; torso.add(ruff);
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.2, 0.41, 0); torso.add(sh);
    const puff = ball(0.085, coat, 1, 1.25, 1); puff.position.y = -0.05; sh.add(puff);
    sh.add(limb(0.3, 0.042, 0.036, coat));
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    el.add(limb(0.28, 0.032, 0.026, M.soot));
    const hand = new THREE.Group(); hand.position.y = -0.28; el.add(hand);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.028), M.soot); palm.position.y = -0.045; palm.castShadow = true; hand.add(palm);
    for (let f = 0; f < 4; f++) {
      const fg = limb(0.13, 0.008, 0.006, M.soot, 5);
      fg.position.set(-0.024 + f * 0.016, -0.085, 0); fg.rotation.set(0.25, 0, (f - 1.5) * 0.05); hand.add(fg);
    }
    return { sh, el, hand };
  });
  const neck = new THREE.Group(); neck.position.y = 0.49; torso.add(neck);
  neck.add((() => { const g = new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10); g.translate(0, 0.05, 0); const m = new THREE.Mesh(g, M.soot); return m; })());
  const head = new THREE.Group(); head.position.y = 0.09; neck.add(head);
  const face = makeHead({
    ...rng.pick(FACES), d: 1.0, brow: 0.8, eyeR: 0.13, lidUp: 24, lidDown: -26, iris: [168, 166, 160], irisR: 0.46, pupil: 0.16, milky: 0.35,
    smile: 0, slit: 0.035, gape: 1.3, skin: [70, 64, 60], lipCol: [74, 60, 58], browCol: [34, 30, 30], browThick: 0.8, browArch: 0.2,
    wrinkles: 0, bags: 0.25, soot: 1, gloss: 0.85,
  });
  face.group.scale.setScalar(HEAD_R);
  face.group.position.set(0, HEAD_R * 1.02, 0.01);
  head.add(face.group);
  // beret with a long, broken feather
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.118, 0.045, 16), M.cap); cap.position.set(0.015, HEAD_R * 2.0, -0.01); cap.rotation.set(-0.18, 0, 0.2); cap.castShadow = true; head.add(cap);
  const fg = new THREE.PlaneGeometry(0.05, 0.34, 1, 5);
  const fp = fg.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setZ(i, -Math.pow(fp.getY(i) + 0.17, 2) * 1.2);
  const feather = new THREE.Mesh(fg, M.feather); feather.position.set(0.1, HEAD_R * 2.0 + 0.12, -0.07); feather.rotation.set(-0.9, 0.3, -0.5); head.add(feather);
  const glows = face.eyes.map((e) => {
    const g = new THREE.Sprite(glowMat);
    g.position.copy(e.holder.position).add(new THREE.Vector3(0, 0, face.o.eyeR * 0.9));
    g.scale.setScalar(0.25);
    face.group.add(g);
    return g;
  });
  return { root, body, pelvis, legs, torso, arms, neck, head, face, glows };
}

export class Elves {
  constructor(T, castle, seed) {
    this.castle = castle;
    this.group = new THREE.Group();
    const rng = makeRng(seed ^ 0x5eed);
    const M = this.M = {
      soot: new THREE.MeshStandardMaterial({ color: 0x2c2826, roughness: 0.9 }),
      tights: new THREE.MeshStandardMaterial({ color: 0x141214, roughness: 0.8 }),
      shoe: new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.5 }),
      maroon: new THREE.MeshStandardMaterial({ color: 0x3a0e14, roughness: 0.9 }),
      teal: new THREE.MeshStandardMaterial({ color: 0x0e2628, roughness: 0.9 }),
      ochre: new THREE.MeshStandardMaterial({ color: 0x3a2a0e, roughness: 0.9 }),
      ruff: new THREE.MeshStandardMaterial({ color: 0x6a665e, roughness: 1 }),
      cap: new THREE.MeshStandardMaterial({ color: 0x1a0c12, roughness: 0.7 }),
      feather: new THREE.MeshStandardMaterial({ color: 0x8a857a, roughness: 1, side: THREE.DoubleSide }),
    };
    this.glowMat = new THREE.SpriteMaterial({ map: T.glow, color: 0xe8eeff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.45 });
    const types = rng.shuffle(['crawler', 'crawler', 'crawler', 'stander', 'stander', 'stander', 'stander', 'runner', 'runner', 'runner']);
    this.list = castle.elfSpots.map((sp, i) => {
      const type = types[i % types.length];
      const model = buildElf(M, this.glowMat, rng);
      this.group.add(model.root);
      const mode = type === 'stander' ? 'stand' : 'idle';
      return {
        i, type, model,
        s: { x: sp.x, z: sp.z, yaw: rng.range(-Math.PI, Math.PI), mode },
        v: { x: sp.x, z: sp.z, yaw: 0, phase: rng.range(0, 6), head: 0, prevMode: mode, sndT: rng.range(1, 5), vis: 1 },
        ai: { t: 0, burst: 0, burstCd: 1, losT: 0, los: false, respawn: 0, reloc: rng.range(25, 45), path: null, pi: 0, repath: 0 },
      };
    });
    this.isHost = true;
    this.scare = null;
    this.onSound = null;
    this.onPoof = null;
  }

  netState() {
    const r2 = (v) => Math.round(v * 100) / 100;
    return this.list.map((e) => [r2(e.s.x), r2(e.s.z), r2(e.s.yaw), ELF_MODES.indexOf(e.s.mode)]);
  }
  applyNet(arr) {
    arr.forEach((a, i) => {
      const e = this.list[i];
      if (!e) return;
      e.s.x = a[0]; e.s.z = a[1]; e.s.yaw = a[2]; e.s.mode = ELF_MODES[a[3]];
    });
  }

  spotFor(e, players, minD) {
    const C = this.castle;
    const spots = C.elfSpots.filter((sp) => players.every((p) => Math.hypot(p.x - sp.x, p.z - sp.z) > minD && !C.lineOfSight(p.x, p.z, sp.x, sp.z)));
    return spots.length ? spots[Math.floor(Math.random() * spots.length)] : null;
  }
  move(e, tx, tz, speed, dt) {
    const s = e.s;
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
    if (d < 0.02) return d;
    const st = Math.min(d, speed * dt);
    const p = { x: s.x + (dx / d) * st, z: s.z + (dz / d) * st };
    this.castle.collide(p, 0.28);
    s.x = p.x; s.z = p.z;
    s.yaw = dampAngle(s.yaw, Math.atan2(dx, dz), 12, dt);
    return d;
  }
  chase(e, p, speed, dt, los) {
    const ai = e.ai;
    if (los) { ai.path = null; this.move(e, p.x, p.z, speed, dt); return; }
    ai.repath -= dt;
    if (!ai.path || ai.repath <= 0) {
      const [cx, cy] = this.castle.cellAt(e.s.x, e.s.z);
      ai.path = this.castle.path(cx, cy, p.x, p.z); ai.pi = 0; ai.repath = 1;
    }
    this.followPath(e, speed, dt);
  }
  followPath(e, speed, dt) {
    const ai = e.ai;
    let wp = ai.path?.[ai.pi];
    while (wp && Math.hypot(wp[0] - e.s.x, wp[1] - e.s.z) < 0.4) { ai.pi++; wp = ai.path[ai.pi]; }
    if (!wp) { ai.path = null; return true; }
    this.move(e, wp[0], wp[1], speed, dt);
    return false;
  }

  // host-side behaviour
  think(dt, W) {
    const alive = W.players.filter((p) => p.alive);
    const C = this.castle;
    for (const e of this.list) {
      const s = e.s, ai = e.ai;
      ai.t += dt;
      if (s.mode === 'dead') continue;
      if (W.santaDead) { s.mode = 'dead'; continue; }
      if (s.mode === 'gone') {
        ai.respawn -= dt;
        if (ai.respawn <= 0) {
          const sp = this.spotFor(e, alive, 10);
          if (sp) { s.x = sp.x; s.z = sp.z; s.mode = e.type === 'stander' ? 'stand' : 'idle'; ai.t = 0; ai.path = null; }
          else ai.respawn = 3;
        }
        continue;
      }
      if (s.mode === 'grab') {
        const p = W.players.find((q) => q.id === ai.victim);
        if (p) { s.x = p.x + Math.sin(p.camYaw + Math.PI) * 0.5; s.z = p.z + Math.cos(p.camYaw + Math.PI) * 0.5; }
        if (ai.t > 2.4) { s.mode = 'gone'; ai.respawn = R(22, 35); this.onPoof?.(e); }
        continue;
      }
      // nearest living player
      let p = null, d = 1e9;
      for (const q of alive) { const dd = Math.hypot(q.x - s.x, q.z - s.z); if (dd < d) { d = dd; p = q; } }
      ai.losT -= dt;
      if (ai.losT <= 0 && p) { ai.losT = 0.2; ai.los = d < 26 && C.lineOfSight(s.x, s.z, p.x, p.z); }
      const los = p && ai.los;
      // touching one = grabbed
      if (p && d < TOUCH && !p.safe && !p.grabbed && s.mode !== 'flee') {
        W.emit({ k: 'grab', id: p.id, elf: e.i });
        s.mode = 'grab'; ai.t = 0; ai.victim = p.id; p.grabbed = true;
        continue;
      }
      if (e.type === 'crawler') {
        if (s.mode === 'idle') { if (p && d < 13 && los) { s.mode = 'crawl'; ai.t = 0; } }
        else if (s.mode === 'crawl') {
          if (!p || d > 20) { s.mode = 'idle'; continue; }
          ai.burstCd -= dt;
          if (ai.burst > 0) ai.burst -= dt;
          else if (ai.burstCd <= 0) { ai.burst = R(0.4, 0.8); ai.burstCd = R(1.5, 3.2); }
          const sp = ai.burst > 0 ? 3.1 : ai.burstCd > 1.2 ? 0 : 0.85;
          if (sp > 0) this.chase(e, p, sp, dt, los);
          else if (p) s.yaw = dampAngle(s.yaw, Math.atan2(p.x - s.x, p.z - s.z), 4, dt);
        }
      } else if (e.type === 'stander') {
        if (p) s.yaw = dampAngle(s.yaw, Math.atan2(p.x - s.x, p.z - s.z), 0.6, dt);
        ai.reloc -= dt;
        if (ai.reloc <= 0) {
          ai.reloc = R(25, 45);
          const seen = alive.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 28 && C.lineOfSight(q.x, q.z, s.x, s.z));
          if (!seen) { const sp = this.spotFor(e, alive, 6); if (sp) { s.x = sp.x; s.z = sp.z; } }
        }
      } else if (e.type === 'runner') {
        if (s.mode === 'idle') {
          if (p) s.yaw = dampAngle(s.yaw, Math.atan2(p.x - s.x, p.z - s.z), 2, dt);
          if (p && d < 15 && d > 3 && los && ai.t > 4) { s.mode = 'charge'; ai.t = 0; }
        } else if (s.mode === 'charge') {
          if (!p) { s.mode = 'idle'; continue; }
          this.chase(e, p, 6.0, dt, los);
          if (d < R(1.9, 2.6) || ai.t > 3.5) {
            // veer away at the very last second
            s.mode = 'flee'; ai.t = 0;
            const away = C.elfSpots.filter((sp) => Math.hypot(sp.x - p.x, sp.z - p.z) > 14);
            const sp = away.length ? away[Math.floor(Math.random() * away.length)] : C.elfSpots[0];
            const [cx, cy] = C.cellAt(s.x, s.z);
            ai.path = C.path(cx, cy, sp.x, sp.z); ai.pi = 0;
          }
        } else if (s.mode === 'flee') {
          if (this.followPath(e, 6.4, dt) || ai.t > 5) {
            s.mode = 'idle'; ai.t = 0;
            const seen = alive.some((q) => C.lineOfSight(q.x, q.z, s.x, s.z));
            if (!seen) { const sp = this.spotFor(e, alive, 10); if (sp) { s.x = sp.x; s.z = sp.z; } }
          }
        }
      }
    }
  }

  // both sides: pose + sound cues
  animate(dt, t, camPos, hear) {
    for (const e of this.list) {
      const s = e.s, v = e.v, m = e.model;
      const mode = s.mode;
      if (this.isHost) { v.x = s.x; v.z = s.z; v.yaw = s.yaw; }
      else {
        if (Math.hypot(s.x - v.x, s.z - v.z) > 3) { v.x = s.x; v.z = s.z; }
        v.x = damp(v.x, s.x, 14, dt); v.z = damp(v.z, s.z, 14, dt); v.yaw = dampAngle(v.yaw, s.yaw, 14, dt);
      }
      const moved = Math.hypot(v.x - (v.px ?? v.x), v.z - (v.pz ?? v.z)) / Math.max(dt, 1e-4);
      v.px = v.x; v.pz = v.z;
      v.spd = damp(v.spd || 0, moved, 10, dt);
      // sound cues on transitions
      if (mode !== v.prevMode) {
        if (mode === 'charge' || mode === 'flee') hear?.('giggle', v.x, v.z);
        if (mode === 'gone') hear?.('poof', v.x, v.z);
        v.prevMode = mode;
      }
      const dCam = Math.hypot(camPos.x - v.x, camPos.z - v.z);
      v.sndT -= dt;
      if (v.sndT <= 0) {
        v.sndT = R(0.7, 1.4);
        if (mode === 'crawl' && dCam < 16 && v.spd > 0.2) hear?.('scratch', v.x, v.z);
        else if (mode === 'stand' && dCam < 7 && Math.random() < 0.25) { hear?.('whisper', v.x, v.z); v.sndT = R(6, 12); }
        else if (mode === 'idle' && e.type === 'runner' && dCam < 9 && Math.random() < 0.2) { hear?.('giggle', v.x, v.z); v.sndT = R(5, 10); }
      }
      const vis = mode !== 'gone';
      m.root.visible = vis;
      if (!vis) continue;
      m.root.position.set(v.x, 0, v.z);
      m.root.rotation.set(0, v.yaw, 0);
      this.pose(e, dt, t, camPos);
      if (this.scare && this.scare.index === e.i) this.placeForScare(e, t);
    }
  }

  pose(e, dt, t, camPos) {
    const m = e.model, v = e.v, mode = e.s.mode;
    const toCam = angleDiff(v.yaw, Math.atan2(camPos.x - v.x, camPos.z - v.z));
    const scared = this.scare && this.scare.index === e.i;
    const dCam = Math.hypot(camPos.x - v.x, camPos.z - v.z);
    m.face.setJaw(scared ? 0.85 + Math.sin(t * 40) * 0.08 : mode === 'grab' ? 0.6 : 0);
    if (dCam < 16 || scared) m.face.look(camPos, 0.6);
    m.glows.forEach((g) => g.scale.setScalar(scared ? 0 : 0.25));
    if (mode === 'dead') {
      m.pelvis.position.y = damp(m.pelvis.position.y, 0.15, 3, dt);
      m.torso.rotation.x = damp(m.torso.rotation.x, 1.5, 3, dt);
      m.legs.forEach((l) => { l.hip.rotation.x = damp(l.hip.rotation.x, -1.4, 3, dt); l.knee.rotation.x = damp(l.knee.rotation.x, 2.2, 3, dt); });
      return;
    }
    if (mode === 'crawl' || (mode === 'idle' && e.type === 'crawler')) {
      // on hands and knees, head twisted upside down, staring at you
      v.phase += dt * (0.5 + v.spd * 5);
      const ph = Math.floor(v.phase * 3) / 3; // jerky
      m.pelvis.position.y = 0.5 + Math.sin(ph * 2) * 0.015;
      m.torso.rotation.set(1.3, 0, Math.sin(ph) * 0.08);
      m.legs.forEach((l, i) => { const sw = Math.sin(ph + i * Math.PI) * 0.3; l.hip.rotation.set(-0.12 + sw, 0, (i ? -1 : 1) * 0.12); l.knee.rotation.x = 1.5 - sw * 0.3; l.ankle.rotation.x = 0.1; });
      m.arms.forEach((a, i) => { const sw = Math.sin(ph + (i ? 0 : Math.PI)) * 0.35; a.sh.rotation.set(-1.3 + sw, 0, (i ? -1 : 1) * 0.18); a.el.rotation.x = -0.2 - Math.max(0, sw) * 0.6; a.hand.rotation.x = 1.2; });
      m.neck.rotation.set(-1.15, 0, 0);
      m.head.rotation.set(0.1, clamp(toCam, -1.0, 1.0) * 0.5, Math.PI * 0.88 + Math.sin(t * 7) * 0.05);
      return;
    }
    const running = mode === 'charge' || mode === 'flee';
    const crouch = e.type === 'runner' && mode === 'idle' ? 1 : 0;
    if (running) v.phase += dt * 13; else v.phase += dt;
    let drop = 0;
    m.legs.forEach((l, i) => {
      const s2 = running ? Math.sin(v.phase + i * Math.PI) : 0;
      const lift = running ? Math.max(0, Math.cos(v.phase + i * Math.PI)) : 0;
      const a1 = -s2 * 0.75 - crouch * 0.95 - (running ? 0.15 : 0);
      const a2 = 0.05 + lift * 1.4 + crouch * 1.85 + (running ? 0.2 : 0);
      l.hip.rotation.set(a1, 0, 0);
      l.knee.rotation.x = a2;
      l.ankle.rotation.x = -(a1 + a2);
      drop = Math.max(drop, EL1 * Math.cos(a1) + EL2 * Math.cos(a1 + a2) + 0.05 + 0.08);
    });
    m.pelvis.position.y = drop;
    m.torso.rotation.set(running ? 0.4 : crouch ? 0.75 : 0.03, 0, running ? 0 : Math.sin(t * 0.8 + e.i) * 0.02);
    m.arms.forEach((a, i) => {
      a.hand.rotation.x = 0;
      if (running) { a.sh.rotation.set(0.7 + Math.sin(v.phase + i * Math.PI) * 0.9, 0, (i ? -1 : 1) * 0.25); a.el.rotation.x = -0.9; }
      else if (mode === 'grab' || scared) { a.sh.rotation.set(-1.4 + Math.sin(t * 30 + i) * 0.06, 0, (i ? 1 : -1) * 0.3); a.el.rotation.x = -0.35; }
      else if (crouch) { a.sh.rotation.set(-0.7, 0, (i ? -1 : 1) * 0.1); a.el.rotation.x = -0.2; }
      else { a.sh.rotation.set(Math.sin(t * 0.9 + i) * 0.02, 0, (i ? -1 : 1) * 0.06); a.el.rotation.x = -0.04; }
    });
    m.neck.rotation.set(running ? -0.3 : crouch ? -0.6 : 0, 0, 0);
    // standers never stop looking at you, head tilted like a curious bird
    const hy = mode === 'stand' || mode === 'idle' ? clamp(toCam, -2.2, 2.2) : 0;
    v.head = mode === 'stand' ? (Math.abs(hy - v.head) > 0.6 ? hy : damp(v.head, hy, 2, dt)) : damp(v.head, hy, 6, dt);
    m.head.rotation.set(running ? 0.25 : 0.08, v.head, mode === 'stand' ? (e.i % 2 ? 0.5 : -0.45) + Math.sin(t * 0.5 + e.i) * 0.04 : 0);
  }

  // a standing helper that isn't really there (used for fake scares)
  makePhantom() {
    const m = buildElf(this.M, this.glowMat, makeRng(Math.floor(Math.random() * 1e6)));
    m.root.visible = false;
    m.torso.rotation.z = 0.08;
    m.head.rotation.z = 0.45;
    this.group.add(m.root);
    return m;
  }

  placeForScare(e, t) {
    const cam = this.scare.camera, m = e.model;
    const fwd = cam.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    m.root.rotation.set(0, yaw, 0);
    m.root.position.set(cam.position.x, 0, cam.position.z);
    m.head.rotation.set(0, 0, Math.sin(t * 37) * 0.25);
    m.root.updateMatrixWorld(true);
    const head = m.face.group.localToWorld(new THREE.Vector3(0, -0.1, 0.8));
    const want = cam.position.clone().addScaledVector(fwd, 0.3 + Math.sin(t * 29) * 0.015);
    want.y -= 0.01;
    m.root.position.add(want.sub(head));
    m.root.position.x += R(-0.012, 0.012);
  }
  dispose() {
    this.group.traverse((o) => o.geometry?.dispose());
    Object.values(this.M).forEach((m) => m.dispose());
  }
}
