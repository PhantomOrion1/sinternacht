// De Sint. Almost a man: a towering old bishop on thin bare legs, a grin far too wide,
// glassy eyes that follow you, a head that turns too far.
import * as THREE from 'three';
import { R, clamp, damp, dampAngle, angleDiff, lerp, makeRng } from './rng.js';
import { makeHead, hairStrands } from './faces.js';

export const SANTA_MODES = ['wander', 'investigate', 'notice', 'chase', 'search', 'feed', 'stunned', 'retreat', 'dead', 'watch'];
const L1 = 0.72, L2 = 0.68, FOOT_H = 0.06, HEAD_R = 0.165;

function limb(len, r0, r1, mat, seg = 8, up = false) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  g.translate(0, up ? len / 2 : -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
function ball(r, mat, sx = 1, sy = 1, sz = 1, seg = 12) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4));
  g.scale(sx, sy, sz);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ'), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

export class Santa {
  constructor(T, castle) {
    this.castle = castle;
    this.root = new THREE.Group();
    this.build(T);
    const [cx, cz] = castle.center(...castle.santaCell);
    this.s = { x: cx, z: cz, yaw: 0, headYaw: 0, headPitch: 0, mode: 'wander', speed: 0, hp: 1 };
    this.v = { x: cx, z: cz, yaw: 0, headYaw: 0, headPitch: 0, phase: 0, reach: 0, jaw: 0, duck: 0, death: 0, shake: 0, lastPlant: [0, 0], blinkT: 6, blink: -1 };
    this.ai = { t: 0, modeT: 0, menace: 0, sus: {}, path: null, pi: 0, percT: 0, lostT: 0, relief: 26, rage: 0, lungeT: 0, lungeCd: 0, stuckT: 0, lastPos: [cx, cz], repathT: 0 };
    this.twitches = [];
    this.nextTwitch = 1;
    this.onStep = null;
    this.isHost = true;
    this.scare = null;
  }

  // ------------------------------------------------------------------ model
  build(T) {
    const rng = makeRng(4711);
    const skin = new THREE.MeshStandardMaterial({ map: T.skin.map, normalMap: T.skin.normal, color: 0xe2d0c2, roughness: 0.42 });
    const robe = new THREE.MeshStandardMaterial({ map: T.red.map, normalMap: T.red.normal, color: 0xb02020, roughness: 0.92 });
    const gold = new THREE.MeshStandardMaterial({ map: T.gold.map, color: 0xd0a850, roughness: 0.35, metalness: 0.9 });
    const black = new THREE.MeshBasicMaterial({ color: 0x050202 });
    const hairM = new THREE.MeshStandardMaterial({ color: 0xbdb3a0, roughness: 0.9, side: THREE.DoubleSide });
    const nail = new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.4 });
    const capeM = new THREE.MeshStandardMaterial({ map: T.red.map, color: 0x8a1414, roughness: 1, side: THREE.DoubleSide });
    const alb = new THREE.MeshStandardMaterial({ color: 0xbdb5a6, roughness: 0.95, side: THREE.DoubleSide });
    this.mats = [skin, robe, gold, black, hairM, nail, capeM, alb];

    const P = this.parts = {};
    const body = P.body = new THREE.Group();
    this.root.add(body);
    const hips = P.hips = new THREE.Group();
    body.add(hips);
    // thin, bare, human legs — far too thin for what they carry
    P.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group(); hip.position.set(side * 0.15, 0, 0);
      hip.add(limb(L1, 0.06, 0.04, skin));
      const knee = new THREE.Group(); knee.position.y = -L1; hip.add(knee);
      knee.add(ball(0.05, skin, 1, 1.2, 1.15));
      knee.add(limb(L2, 0.042, 0.025, skin));
      const calf = ball(0.044, skin, 1, 2.4, 1); calf.position.set(0, -0.2, -0.014); knee.add(calf);
      const ankle = new THREE.Group(); ankle.position.y = -L2; knee.add(ankle);
      ankle.add(ball(0.032, skin));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.25), skin); foot.position.set(0, -0.032, 0.07); foot.castShadow = true; ankle.add(foot);
      for (let k = 0; k < 4; k++) {
        const toe = limb(0.09 + (k === 0 ? 0.03 : 0), 0.012, 0.009, skin, 5);
        toe.rotation.x = -Math.PI / 2; toe.position.set((k - 1.5) * 0.019, -0.04, 0.19); ankle.add(toe);
      }
      return { hip, knee, ankle };
    });
    // massive, hunched upper body in the bishop's robe
    const torso = P.torso = new THREE.Group();
    hips.add(torso);
    const prof = [[0.12, 1.17], [0.3, 1.12], [0.52, 1.03], [0.6, 0.86], [0.58, 0.56], [0.5, 0.26], [0.43, 0.03], [0.47, -0.18], [0.52, -0.36], [0.55, -0.44]].map(([r, y]) => new THREE.Vector2(r, y));
    const lg = new THREE.LatheGeometry(prof, 24);
    const lp = lg.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i);
      const a = Math.atan2(z, x);
      const fold = 1 + Math.sin(a * 9) * 0.035 * (y < 0.6 ? 1 : 0.3);
      const hem = y < -0.3 ? Math.sin(a * 5 + 1) * 0.06 : 0;
      lp.setXYZ(i, x * fold * (z < 0 && y > 0.75 ? 1.06 : 1), y + hem, z * fold * 0.8);
    }
    lg.computeVertexNormals();
    const robeMesh = new THREE.Mesh(lg, capeM); robeMesh.castShadow = true; torso.add(robeMesh);
    const inner = ball(0.42, black, 1.15, 1.4, 0.8); inner.position.y = 0.55; torso.add(inner);
    const hump = ball(0.3, robe, 1.3, 0.9, 0.8); hump.position.set(0.05, 0.92, -0.27); torso.add(hump);
    const lace = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.58, 0.14, 24, 1, true), alb); lace.scale.z = 0.8; lace.position.y = -0.5; torso.add(lace);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.025, 5, 24), gold); trim.rotation.x = Math.PI / 2; trim.scale.set(1, 0.8, 1); trim.position.y = -0.4; torso.add(trim);
    for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.35, 0.025), gold); st.position.set(sx * 0.15, 0.45, 0.47); st.rotation.x = -0.06; torso.add(st); }
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.05, 6, 16), alb); collar.rotation.x = Math.PI / 2; collar.position.set(0, 1.13, 0.05); torso.add(collar);
    P.cape = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.PlaneGeometry(0.26, 1.45, 1, 6);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) if (p.getY(k) < -0.5) p.setY(k, p.getY(k) + Math.sin(i * 7 + p.getX(k) * 20) * 0.14);
      g.translate(0, -0.72, 0);
      const m = new THREE.Mesh(g, capeM); m.castShadow = true;
      const pivot = new THREE.Group(); pivot.position.set(-0.45 + i * 0.18, 1.02, -0.38); pivot.rotation.y = (i - 2.5) * 0.12; pivot.add(m);
      torso.add(pivot); P.cape.push(pivot);
    }
    // arms: human, with hands whose fingers are just a little too long
    P.arms = [-1, 1].map((side) => {
      const sh = new THREE.Group(); sh.position.set(side * 0.5, 0.98, 0.04); torso.add(sh);
      const slv = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.66, 12, 1, true), capeM);
      slv.geometry.translate(0, -0.33, 0); slv.castShadow = true; sh.add(slv);
      sh.add(limb(0.56, 0.05, 0.04, skin));
      const elbow = new THREE.Group(); elbow.position.y = -0.56; sh.add(elbow);
      elbow.add(ball(0.042, skin));
      elbow.add(limb(0.52, 0.038, 0.03, skin));
      const wrist = new THREE.Group(); wrist.position.y = -0.52; elbow.add(wrist);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.032), skin); palm.position.y = -0.055; palm.castShadow = true; wrist.add(palm);
      const fingers = [];
      for (let f = 0; f < 4; f++) {
        const fr = new THREE.Group(); fr.position.set(-0.03 + f * 0.02, -0.11, 0); fr.rotation.z = (f - 1.5) * 0.05;
        fr.add(limb(0.1, 0.0095, 0.0085, skin, 5));
        const j = new THREE.Group(); j.position.y = -0.1; fr.add(j);
        j.add(limb(0.09, 0.0085, 0.007, skin, 5));
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.025, 4), nail); c.position.y = -0.1; c.rotation.x = Math.PI; j.add(c);
        wrist.add(fr); fingers.push({ fr, j });
      }
      const th = new THREE.Group(); th.position.set(side * 0.045, -0.04, 0.015); th.rotation.z = side * 0.6;
      th.add(limb(0.09, 0.011, 0.009, skin, 5)); wrist.add(th);
      return { sh, elbow, wrist, fingers, side };
    });
    // crozier
    const staff = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 6), gold); pole.position.y = 0.45; staff.add(pole);
    const crook = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.022, 6, 18, Math.PI * 1.45), gold); crook.position.set(0.14, 1.6, 0); crook.rotation.z = -0.2; staff.add(crook);
    staff.position.y = -0.1; staff.rotation.x = Math.PI; staff.rotation.z = 0.1;
    P.arms[1].wrist.add(staff);
    P.staff = staff;
    // neck + the face
    const neck = P.neck = new THREE.Group(); neck.position.set(0, 1.12, 0.1); torso.add(neck);
    neck.add(limb(0.17, 0.07, 0.085, skin, 10, true));
    const head = P.head = new THREE.Group(); head.position.y = 0.16; neck.add(head);
    const F = P.face = makeHead({
      seed: 7, w: 0.84, h: 1.16, d: 1.0, jawW: 0.78, nose: 1.25, noseLen: 1.12, cheek: 1.3, hollow: 1.6, brow: 1.3,
      eyeGap: 1.04, eyeR: 0.158, eyeAsym: 0.45, lidUp: 36, lidDown: -34, iris: [150, 182, 205], irisR: 0.44, pupil: 0.2,
      mouthW: 1.6, smile: 1.2, lip: 0.8, slit: 0.06, teeth: 0xcfc29a, gape: 1.6,
      skin: [228, 208, 192], rouge: [210, 118, 118], lipCol: [180, 96, 102], browCol: [238, 234, 226], browThick: 1.9, browArch: 0.5,
      wrinkles: 1, bags: 0.9, gloss: 0.36,
    });
    F.group.scale.setScalar(HEAD_R);
    F.group.position.set(0, HEAD_R * 1.05, 0.015);
    head.add(F.group);
    this.mats.push(...F.mats);
    // long matted white beard, hanging from the jaw (so it drops when the jaw does)
    const mass = new THREE.SphereGeometry(1, 20, 16);
    const mp = mass.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      const x = mp.getX(i), y = mp.getY(i), z = mp.getZ(i);
      const taper = y < 0 ? 1 + y * 0.75 : 1;
      const lump = 1 + Math.sin(x * 9 + y * 5) * 0.06 + Math.sin(y * 13) * 0.04;
      mp.setXYZ(i, x * 0.55 * taper * lump, y * 1.35, z * 0.32 * taper * lump);
    }
    mass.computeVertexNormals();
    const beardMass = new THREE.Mesh(mass, hairM); beardMass.position.set(0, -2.15, 0.48); beardMass.rotation.x = 0.12; beardMass.castShadow = true;
    F.jaw.add(beardMass);
    const beard = hairStrands(110, (i) => {
      const a = (rng.next() - 0.5) * (rng.chance(0.6) ? 1.5 : 2.5);
      const centre = Math.abs(a) < 0.45;
      const y = centre ? -0.68 - rng.range(0, 0.08) : -0.3 - Math.abs(a) * 0.25 - rng.range(0, 0.15);
      return { x: Math.sin(a) * 0.7, y, z: Math.cos(a) * 0.72 * (centre ? 1.06 : 0.95), r: rng.range(0.07, 0.15), len: rng.range(1.4, 3.6) * (1 - Math.abs(a) * 0.18), rx: rng.range(0.05, 0.3), rz: rng.range(-0.18, 0.18) };
    }, hairM);
    F.jaw.add(beard);
    // moustache sweeping off the corners of the grin
    const stache = hairStrands(26, (i) => {
      const s = i % 2 ? 1 : -1;
      return { x: s * rng.range(0.1, 0.2), y: -0.26, z: 0.86, r: rng.range(0.025, 0.045), len: rng.range(0.35, 0.6), rz: s * rng.range(0.5, 0.8), rx: rng.range(0.25, 0.5) };
    }, hairM);
    F.group.add(stache);
    // wispy hair below the mitre
    const locks = hairStrands(70, () => {
      const a = rng.range(0.6, Math.PI * 2 - 0.6) + Math.PI / 2;
      return { x: Math.cos(a) * 0.86, y: rng.range(-0.05, 0.35), z: Math.sin(a) * 0.9 - 0.05, r: rng.range(0.03, 0.06), len: rng.range(1.2, 2.6), rx: -0.1, rz: Math.cos(a) * -0.2 };
    }, hairM);
    F.group.add(locks);
    // the mitre
    const shp = new THREE.Shape();
    shp.moveTo(-0.15, 0); shp.lineTo(0.15, 0); shp.quadraticCurveTo(0.17, 0.3, 0, 0.5); shp.quadraticCurveTo(-0.17, 0.3, -0.15, 0);
    const mg = new THREE.ExtrudeGeometry(shp, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.01, bevelSegments: 1, curveSegments: 8 });
    mg.translate(0, 0, -0.1);
    const mitre = new THREE.Group(); mitre.position.set(0.005, HEAD_R * 1.05 + 0.115, -0.01); mitre.rotation.set(-0.16, 0, 0.07); head.add(mitre);
    const mitreM = new THREE.MeshStandardMaterial({ map: T.red.map, color: 0xd83030, roughness: 0.6, emissive: 0x200404 });
    this.mats.push(mitreM);
    const mm = new THREE.Mesh(mg, mitreM); mm.castShadow = true; mitre.add(mm);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.05, 0.25), gold); band.position.y = 0.02; mitre.add(band);
    const vb = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.44, 0.015), gold); vb.position.set(0, 0.24, 0.115); mitre.add(vb);
    const cr1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.02), gold); cr1.position.set(0, 0.3, 0.125); mitre.add(cr1);
    const cr2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), gold); cr2.position.set(0, 0.33, 0.125); mitre.add(cr2);
    for (const sx of [-1, 1]) { const lp2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.01), robe); lp2.position.set(sx * 0.07, -0.2, -0.13); lp2.rotation.x = 0.15; mitre.add(lp2); }
    // eyeshine: a faint glint in the dark so you know where He is
    const glowMat = new THREE.SpriteMaterial({ map: T.glow, color: 0xffd8a0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.6 });
    this.glowMat = glowMat; this.mats.push(glowMat);
    P.glows = F.eyes.map((e) => {
      const s = new THREE.Sprite(glowMat);
      s.position.copy(e.holder.position).multiplyScalar(1).add(new THREE.Vector3(0, 0, F.o.eyeR * 0.9));
      s.scale.setScalar(0.3);
      F.group.add(s);
      return s;
    });
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  // ------------------------------------------------------------------ net
  netState() {
    const s = this.s, r2 = (v) => Math.round(v * 100) / 100;
    return [r2(s.x), r2(s.z), r2(s.yaw), r2(s.headYaw), r2(s.headPitch), SANTA_MODES.indexOf(s.mode), r2(s.speed), s.hp];
  }
  applyNet(a) {
    const s = this.s;
    [s.x, s.z, s.yaw, s.headYaw, s.headPitch] = a;
    s.mode = SANTA_MODES[a[5]] || 'wander';
    s.speed = a[6]; s.hp = a[7];
  }

  // ------------------------------------------------------------------ AI (host only)
  setMode(m) { this.s.mode = m; this.ai.modeT = 0; this.ai.path = null; }
  setPath(tx, tz) {
    const [cx, cy] = this.castle.cellAt(this.s.x, this.s.z);
    this.ai.path = this.castle.path(cx, cy, tx, tz);
    this.ai.pi = 0;
    this.ai.goal = [tx, tz];
    this.ai.repathT = 0;
  }
  moveToward(tx, tz, speed, dt) {
    const s = this.s;
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
    if (d < 0.02) return d;
    const step = Math.min(d, speed * dt);
    const p = { x: s.x + (dx / d) * step, z: s.z + (dz / d) * step };
    this.castle.collide(p, 0.42, true);
    s.x = p.x; s.z = p.z;
    s.yaw = dampAngle(s.yaw, Math.atan2(dx, dz), speed > 3 ? 9 : 5, dt);
    s.speed = speed;
    return d;
  }
  followPath(speed, dt) {
    const ai = this.ai, s = this.s;
    if (!ai.path) return true;
    let wp = ai.path[ai.pi];
    while (wp && Math.hypot(wp[0] - s.x, wp[1] - s.z) < 0.55) { ai.pi++; wp = ai.path[ai.pi]; }
    if (!wp) { ai.path = null; return true; }
    this.moveToward(wp[0], wp[1], speed, dt);
    return false;
  }
  randomCell(filter) {
    const C = this.castle;
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(Math.random() * C.N), y = Math.floor(Math.random() * C.N);
      if (!filter || filter(x, y)) return [x, y];
    }
    return [Math.floor(Math.random() * C.N), Math.floor(Math.random() * C.N)];
  }

  think(dt, W) {
    const s = this.s, ai = this.ai, C = this.castle;
    ai.t += dt; ai.modeT += dt; ai.menace += dt; ai.relief -= dt; ai.lungeCd -= dt;
    if (s.mode === 'dead') { s.speed = 0; return; }
    const alive = W.players.filter((p) => p.alive);
    ai.percT -= dt;
    if (ai.percT <= 0) { ai.percT = 0.1; this.perceive(0.1, alive, W); }
    for (const n of W.noises) this.hear(n);
    s.speed = 0;
    const target = alive.find((p) => p.id === ai.targetId);

    switch (s.mode) {
      case 'wander': {
        if (!ai.path) {
          let cell;
          if (ai.relief > 0 && alive.length) {
            // relief: drift away from the players for a while
            cell = this.randomCell((x, y) => alive.every((p) => { const [px, py] = C.cellAt(p.x, p.z); return Math.abs(px - x) + Math.abs(py - y) >= 4; }));
          } else if (alive.length && Math.random() < 0.45 + Math.min(0.45, ai.menace / 120)) {
            const p = alive[Math.floor(Math.random() * alive.length)];
            const [px, py] = C.cellAt(p.x, p.z);
            cell = this.randomCell((x, y) => { const d = Math.abs(px - x) + Math.abs(py - y); return d >= 1 && d <= 3; });
          } else cell = this.randomCell();
          const [cx, cz] = C.center(cell[0], cell[1]);
          this.setPath(cx + R(-1.5, 1.5), cz + R(-1.5, 1.5));
        }
        if (ai.glance) {
          const g = alive.find((p) => p.id === ai.glance);
          if (g) s.yaw = dampAngle(s.yaw, Math.atan2(g.x - s.x, g.z - s.z), 1.6, dt);
        } else if (this.followPath(1.45, dt)) this.startSearch(R(2.5, 5));
        this.director(alive, W);
        break;
      }
      case 'investigate': {
        if (!ai.path) this.setPath(ai.goal[0], ai.goal[1]);
        if (this.followPath(ai.invSpeed || 2.5, dt)) this.startSearch(R(3, 5.5));
        break;
      }
      case 'search': {
        if (ai.glance) {
          const g = alive.find((p) => p.id === ai.glance);
          if (g) s.yaw = dampAngle(s.yaw, Math.atan2(g.x - s.x, g.z - s.z), 2.2, dt);
          ai.modeT = Math.min(ai.modeT, ai.searchDur - 0.5);
        }
        if (ai.modeT > ai.searchDur) {
          if (ai.huntAfter && alive.length && Math.random() < 0.6) {
            // he always seems to know roughly where you went
            const p = alive.find((q) => q.id === ai.huntAfter) || alive[0];
            this.setMode('investigate'); ai.goal = [p.x + R(-3, 3), p.z + R(-3, 3)]; ai.invSpeed = 2.3;
          } else this.setMode('wander');
          ai.huntAfter = null;
        }
        break;
      }
      case 'notice': {
        if (!target) { this.startSearch(2); break; }
        if (ai.modeT > ai.noticeDur) {
          this.setMode('chase');
          ai.lastSeen = [target.x, target.z]; ai.lostT = 0;
          W.emit({ k: 'shriek' });
        }
        break;
      }
      case 'chase': {
        if (!target) { this.startSearch(3); break; }
        const dx = target.x - s.x, dz = target.z - s.z, d = Math.hypot(dx, dz);
        const los = target._los ?? C.lineOfSight(s.x, s.z, target.x, target.z);
        let speed = 4.0 + ai.rage * 0.3;
        if (ai.lungeT > 0) { ai.lungeT -= dt; speed = 6.4; if (ai.lungeT <= 0) ai.lungeCd = 2.0; }
        else if (ai.lungeCd > 1.3) speed = 2.6;
        else if (d < 2.8 && los && ai.lungeCd <= 0) ai.lungeT = 0.32;
        if (los) {
          ai.lastSeen = [target.x, target.z]; ai.lostT = 0; ai.path = null;
          this.moveToward(target.x, target.z, speed, dt);
        } else {
          ai.lostT += dt;
          ai.repathT -= dt;
          if (!ai.path || ai.repathT <= 0) { this.setPath(ai.lastSeen[0], ai.lastSeen[1]); ai.repathT = 0.8; }
          if (this.followPath(speed * 0.9, dt) || ai.lostT > 5) { ai.huntAfter = target.id; this.startSearch(R(2.5, 4)); ai.relief = 0; }
        }
        if (d < 1.1 && !target.safe) {
          W.emit({ k: 'caught', id: target.id });
          this.setMode('feed');
          ai.feedYaw = Math.atan2(dx, dz);
        }
        break;
      }
      case 'watch': {
        const p = alive.find((q) => q.id === ai.targetId);
        if (p) s.yaw = dampAngle(s.yaw, Math.atan2(p.x - s.x, p.z - s.z), 0.4, dt);
        const close = p && Math.hypot(p.x - s.x, p.z - s.z) < 11;
        if (!p || ai.modeT > ai.watchDur || close) {
          // gone, as if he was never there
          const C2 = this.castle;
          const cell = this.randomCell((x, y) => alive.every((q) => { const [qx, qy] = C2.cellAt(q.x, q.z); return Math.abs(qx - x) + Math.abs(qy - y) >= 4; }));
          const [nx, nz] = C2.center(cell[0], cell[1]);
          if (!alive.some((q) => C2.lineOfSight(q.x, q.z, s.x, s.z)) || ai.modeT > ai.watchDur + 6 || close) { s.x = nx; s.z = nz; ai.relief = 15; this.setMode('wander'); W.emit({ k: 'vanish' }); }
        }
        break;
      }
      case 'feed': {
        s.yaw = dampAngle(s.yaw, ai.feedYaw || s.yaw, 4, dt);
        if (ai.modeT > 3.6) { ai.relief = 22; this.setMode('wander'); }
        break;
      }
      case 'stunned': {
        if (ai.modeT > 2.3) {
          this.setMode('retreat');
          const cell = this.randomCell((x, y) => alive.every((p) => { const [px, py] = C.cellAt(p.x, p.z); return Math.abs(px - x) + Math.abs(py - y) >= 3; }));
          const [cx, cz] = C.center(cell[0], cell[1]);
          this.setPath(cx, cz);
        }
        break;
      }
      case 'retreat': {
        if (this.followPath(4.2, dt) || ai.modeT > 9) {
          this.setMode('investigate');
          ai.goal = ai.shooterPos || [s.x, s.z]; ai.invSpeed = 3.0;
        }
        break;
      }
    }
    // head behaviour
    let hy = 0, hp = 0;
    const look = (p) => { hy = angleDiff(s.yaw, Math.atan2(p.x - s.x, p.z - s.z)); hp = -0.35; };
    const glanced = ai.glance && alive.find((p) => p.id === ai.glance);
    if ((s.mode === 'notice' || s.mode === 'chase') && target) look(target);
    else if (s.mode === 'feed') hp = -0.9;
    else if (glanced && s.mode !== 'stunned') look(glanced);
    else if (s.mode === 'search') { hy = Math.sin(ai.modeT * 1.3) * 1.7; hp = Math.sin(ai.modeT * 0.7) * 0.25; }
    hy = clamp(hy, -2.8, 2.8);
    s.headYaw = dampAngle(s.headYaw, hy, s.mode === 'notice' ? 14 : 5, dt);
    s.headPitch = damp(s.headPitch, hp, 5, dt);
    // stuck guard
    if (s.speed > 0.5) {
      ai.stuckT += dt;
      if (ai.stuckT > 1.2) {
        const moved = Math.hypot(s.x - ai.lastPos[0], s.z - ai.lastPos[1]);
        if (moved < 0.35 && ai.goal) this.setPath(ai.goal[0], ai.goal[1]);
        ai.stuckT = 0; ai.lastPos = [s.x, s.z];
      }
    }
  }
  startSearch(dur) { this.setMode('search'); this.ai.searchDur = dur; }

  perceive(dt, alive) {
    const s = this.s, ai = this.ai, C = this.castle;
    const face = s.yaw + s.headYaw;
    let best = null;
    ai.glance = null;
    for (const p of alive) {
      const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz);
      p._d = d;
      if (d > 34) { ai.sus[p.id] = 0; p._los = false; continue; }
      const los = C.lineOfSight(s.x, s.z, p.x, p.z);
      p._los = los;
      const prev = ai.sus[p.id] || 0;
      if (!los || p.safe) { ai.sus[p.id] = Math.max(0, prev - dt * 0.5); continue; }
      const ang = Math.abs(angleDiff(face, Math.atan2(dx, dz)));
      let range = p.flash ? 26 : 9;
      if (p.crouch) range *= 0.6;
      if (p.sprint) range += 5;
      const inFov = ang < 1.2 || d < 3.2;
      // shining your light on Him: He feels it, even from behind
      const lit = p.flash && d < 20 && Math.abs(angleDiff(Math.atan2(-Math.sin(p.camYaw), -Math.cos(p.camYaw)), Math.atan2(-dx, -dz))) < 0.3;
      if (inFov && d < range) {
        const rate = d < 5 ? 6 : d < 11 ? 2.6 : 1.25;
        ai.sus[p.id] = prev + dt * rate;
        if (!best || d < best._d) best = p;
      } else if (lit) {
        ai.sus[p.id] = Math.min(0.9, prev + dt * 0.8);
        if (!best || d < best._d) best = p;
      } else ai.sus[p.id] = Math.max(0, prev - dt * 0.35);
    }
    const busy = ['notice', 'chase', 'feed', 'stunned', 'dead', 'watch'].includes(s.mode);
    if (s.mode === 'chase') {
      // switch to a closer visible victim
      if (best && best.id !== ai.targetId && best._d < 5) ai.targetId = best.id;
    } else if (best && ai.sus[best.id] >= 1 && !busy) {
      if (s.mode === 'retreat' && best._d > 6) return;
      this.setMode('notice');
      ai.targetId = best.id;
      ai.noticeDur = best._d < 5 ? 0.32 : R(0.55, 0.95);
      ai.menace = 0;
    } else if (best && ai.sus[best.id] > 0.3 && !busy) ai.glance = best.id;
  }

  hear(n) {
    const s = this.s, ai = this.ai;
    if (['chase', 'notice', 'feed', 'stunned', 'dead'].includes(s.mode)) return;
    if (s.mode === 'retreat' && n.r < 24) return;
    const d = Math.hypot(n.x - s.x, n.z - s.z);
    const r = this.castle.lineOfSight(s.x, s.z, n.x, n.z) ? n.r : n.r * 0.6;
    if (d < r) {
      if (s.mode === 'investigate' && ai.goal && Math.hypot(ai.goal[0] - n.x, ai.goal[1] - n.z) < 2) return;
      this.setMode('investigate');
      ai.goal = [n.x, n.z];
      ai.invSpeed = n.r > 20 ? 3.2 : 2.6;
      ai.menace = Math.min(ai.menace, 15);
    }
  }

  director(alive, W) {
    // If he hasn't been near anyone in a long time, he quietly relocates closer — out of sight.
    const ai = this.ai, s = this.s, C = this.castle;
    if (ai.menace < 75 || !alive.length || ai.relief > 0) return;
    if (alive.some((p) => C.lineOfSight(p.x, p.z, s.x, s.z) && Math.hypot(p.x - s.x, p.z - s.z) < 30)) return;
    const p = alive[Math.floor(Math.random() * alive.length)];
    const [px, py] = C.cellAt(p.x, p.z);
    const dist = C.bfs(px, py);
    const options = [];
    for (let y = 0; y < C.N; y++) for (let x = 0; x < C.N; x++) {
      const d = dist[y * C.N + x];
      if (d < 3 || d > 4) continue;
      const [cx, cz] = C.center(x, y);
      if (alive.some((q) => C.lineOfSight(q.x, q.z, cx, cz))) continue;
      options.push([cx, cz]);
    }
    if (!options.length) return;
    const [nx, nz] = options[Math.floor(Math.random() * options.length)];
    s.x = nx; s.z = nz;
    ai.menace = 25;
    this.setMode('investigate');
    ai.goal = [p.x + R(-2, 2), p.z + R(-2, 2)];
    ai.invSpeed = 1.9;
    W.emit({ k: 'tp' });
  }

  // stand far off in the player's line of sight and just... watch
  appearFar(p) {
    const C = this.castle, s = this.s, ai = this.ai;
    if (['chase', 'notice', 'feed', 'stunned', 'dead', 'watch'].includes(s.mode)) return false;
    const fx = -Math.sin(p.camYaw), fz = -Math.cos(p.camYaw);
    const free = C.rayWall(p.x, p.z, fx, fz, 34);
    if (free < 14) return false;
    const d = Math.min(free - 1.5, 13 + Math.random() * 7);
    s.x = p.x + fx * d; s.z = p.z + fz * d;
    s.yaw = Math.atan2(-fx, -fz);
    this.setMode('watch'); ai.targetId = p.id; ai.watchDur = 6 + Math.random() * 6; ai.menace = 0;
    return true;
  }

  hit(shooterPos) {
    const s = this.s, ai = this.ai;
    if (s.mode === 'dead') return false;
    s.hp -= 1;
    ai.rage += 1;
    ai.shooterPos = shooterPos;
    if (s.hp <= 0) { this.setMode('dead'); return true; }
    this.setMode('stunned');
    return true;
  }

  // ------------------------------------------------------------------ view
  hitSpheres() {
    const P = this.parts;
    this.root.updateMatrixWorld(true);
    const a = P.torso.localToWorld(tmpV.set(0, 0.55, 0)).clone();
    const b = P.face.group.getWorldPosition(tmpV).clone();
    const c = P.hips.getWorldPosition(tmpV).clone();
    return [[a, 0.65], [b, 0.22], [c, 0.34]];
  }
  headWorld(out) { return this.parts.face.group.localToWorld(out.set(0, -0.15, 0.85)); }

  animate(dt, t, camPos) {
    const s = this.s, v = this.v, P = this.parts, C = this.castle;
    const mode = s.mode;
    if (this.isHost) { v.x = s.x; v.z = s.z; v.yaw = s.yaw; }
    else {
      if (Math.hypot(s.x - v.x, s.z - v.z) > 4) { v.x = s.x; v.z = s.z; }
      v.x = damp(v.x, s.x, 12, dt); v.z = damp(v.z, s.z, 12, dt); v.yaw = dampAngle(v.yaw, s.yaw, 12, dt);
    }
    v.headYaw = dampAngle(v.headYaw, s.headYaw, 16, dt);
    v.headPitch = damp(v.headPitch, s.headPitch, 10, dt);
    const chase = mode === 'chase';
    const dead = mode === 'dead';
    v.reach = damp(v.reach, chase ? 1 : mode === 'notice' ? 0.5 : mode === 'feed' ? 0.7 : 0, 6, dt);
    // duck under door lintels
    const [cx, cy] = C.cellAt(v.x, v.z);
    let dd = 9;
    for (let d = 0; d < 4; d++) {
      if (C.edge(cx, cy, d) !== 1) continue;
      const [mx, mz] = C.edgeMid(cx, cy, d);
      dd = Math.min(dd, Math.hypot(mx - v.x, mz - v.z));
    }
    v.duck = damp(v.duck, clamp(1 - (dd - 0.7) / 1.5, 0, 1), 8, dt);
    if (dead) v.death = Math.min(1.6, v.death + dt * 0.55);
    // eyes always find you
    if (camPos) P.face.look(camPos, 0.62);
    // stop-motion: when stalking, the pose updates in jerky 11fps steps
    const stepped = !chase && !this.scare && mode !== 'stunned' && mode !== 'watch';
    v.accum = (v.accum || 0) + dt;
    if (stepped && v.accum < 1 / 11) { this.place(); return; }
    const pdt = stepped ? v.accum : dt;
    v.accum = 0;
    const speed = dead ? 0 : s.speed;
    const amp = speed > 0.05 ? 0.6 + 0.45 * Math.min(1, speed / 4.5) : 0;
    v.amp = damp(v.amp || 0, amp, 6, pdt);
    if (speed > 0.05) v.phase += (speed * pdt * Math.PI) / (1.15 * Math.max(0.5, v.amp));
    // twitches
    this.nextTwitch -= pdt;
    if (this.nextTwitch <= 0 && !dead) {
      this.nextTwitch = chase ? R(0.25, 0.7) : R(0.7, 2.8);
      const kind = Math.random();
      this.twitches.push({ kind: kind < 0.45 ? 'head' : kind < 0.75 ? 'arm' : 'shudder', amt: (Math.random() < 0.5 ? -1 : 1) * R(0.5, 1.3), side: Math.random() < 0.5 ? 0 : 1, t: 0, dur: R(0.25, 0.9) });
    }
    let twHead = 0, twArm = [0, 0], shudder = 0;
    for (const tw of this.twitches) {
      tw.t += pdt;
      const e = tw.t < 0.04 ? tw.t / 0.04 : tw.t > tw.dur - 0.12 ? Math.max(0, (tw.dur - tw.t) / 0.12) : 1;
      if (tw.kind === 'head') twHead += tw.amt * e;
      else if (tw.kind === 'arm') twArm[tw.side] += tw.amt * e;
      else shudder += e;
    }
    this.twitches = this.twitches.filter((tw) => tw.t < tw.dur);
    // legs (human knees, stiff stride)
    const duck = Math.min(1.3, v.duck + (mode === 'feed' ? 0.55 : 0) + (dead ? v.death * 0.8 : 0));
    let maxDrop = 0;
    P.legs.forEach((leg, i) => {
      const ph = v.phase + i * Math.PI;
      const sw = Math.sin(ph) * v.amp, lift = Math.max(0, Math.cos(ph)) * v.amp;
      const a1 = -0.04 - duck * 0.75 + sw * 0.42;
      const a2 = 0.1 + duck * 1.35 + lift * 1.0;
      leg.hip.rotation.set(a1, 0, (i ? -1 : 1) * (0.03 + duck * 0.07));
      leg.knee.rotation.x = a2;
      leg.ankle.rotation.x = -(a1 + a2) + lift * 0.3;
      const drop = L1 * Math.cos(a1) + L2 * Math.cos(a1 + a2) + FOOT_H;
      maxDrop = Math.max(maxDrop, drop);
      const planted = Math.cos(ph) < 0;
      if (planted && !v.lastPlant[i] && v.amp > 0.3 && this.onStep) this.onStep(v.x, v.z, chase ? 1.2 : 0.8);
      v.lastPlant[i] = planted;
    });
    P.hips.position.y = maxDrop - (dead ? Math.max(0, v.death - 0.9) * 1.1 : 0);
    // torso
    const lean = 0.3 + duck * 0.45 + v.reach * 0.35 + (dead ? v.death * 0.55 : 0);
    P.torso.rotation.set(lean, Math.sin(v.phase) * 0.1 * v.amp, Math.sin(v.phase) * 0.05 * v.amp + (dead ? v.death * 0.35 : 0));
    P.body.position.set(shudder * R(-0.03, 0.03), 0, shudder * R(-0.03, 0.03));
    // arms
    P.arms.forEach((arm, i) => {
      const opp = Math.sin(v.phase + (i ? 0 : Math.PI)) * v.amp;
      const hang = -lean + opp * 0.3 + twArm[i] * 0.6;
      const reachA = -lean - 1.4 + Math.sin(t * 9 + i) * 0.1;
      const feedA = -lean - 0.8;
      let ax = lerp(hang, mode === 'feed' ? feedA : reachA, v.reach);
      if (mode === 'stunned') ax = -lean - 2.6 + Math.sin(t * 20 + i) * 0.3;
      arm.sh.rotation.set(ax, 0, (i ? -1 : 1) * (0.1 + v.reach * 0.2));
      arm.elbow.rotation.x = -0.12 - v.reach * 0.3 - (i === 1 && v.reach < 0.5 ? 0.35 : 0);
      arm.wrist.rotation.x = -0.15 + v.reach * 0.25;
      const curl = v.reach > 0.5 ? 0.1 + Math.sin(t * 14 + i) * 0.12 : 0.35 + Math.sin(t * 1.3 + i * 2) * 0.15;
      arm.fingers.forEach((f, k) => {
        const c = i === 1 && v.reach < 0.5 ? 1.2 : curl + (twArm[i] ? Math.sin(k * 3 + t * 30) * 0.4 : 0);
        f.fr.rotation.x = c * 0.6; f.j.rotation.x = c;
      });
    });
    P.staff.visible = !dead && v.reach < 0.5;
    P.cape.forEach((c, i) => { c.rotation.x = 0.1 + speed * 0.06 + Math.sin(t * 2.2 + i * 1.7) * 0.05; });
    // neck/head: hold the head in world space, the way an owl does
    P.neck.rotation.set(0.45 + duck * 0.2, 0, 0);
    let hy = v.headYaw, hp = v.headPitch, hz = twHead * 0.6 + Math.sin(t * 0.7) * 0.12;
    if (chase) { hz += Math.sin(t * 31) * 0.1; hy += Math.sin(t * 23) * 0.06; }
    if (mode === 'stunned') { hp = 0.8; hz += Math.sin(t * 25) * 0.4; }
    if (mode === 'watch') { hz = Math.sin(t * 0.35) * 0.9; hy = Math.sin(t * 0.21) * 0.25; hp = -0.15 + Math.sin(t * 0.5) * 0.1; P.body.position.x += Math.sin(t * 0.6) * 0.06; }
    if (dead) hp = 1.1 * Math.min(1, v.death);
    // the grin never changes; the jaw does
    let jaw = 0.02 + Math.sin(t * 2.7) * 0.015 + v.reach * 0.25 + (mode === 'notice' ? 0.55 : 0) + (mode === 'feed' ? 0.3 + Math.sin(t * 16) * 0.25 : 0) + (mode === 'stunned' ? 0.8 : 0) + (dead ? 0.6 * Math.min(1, v.death) : 0);
    if (chase) jaw += Math.sin(t * 19) * 0.06;
    if (this.scare) {
      jaw = 1 + Math.sin(t * 40) * 0.06;
      hy = 0; hp = 0; hz = R(-0.25, 0.25);
      v.reach = 1;
    }
    P.face.setJaw(Math.max(0, jaw));
    // a rare, slow blink
    v.blinkT -= pdt;
    if (v.blinkT <= 0 && v.blink < 0) { v.blink = 0; v.blinkT = R(7, 16); }
    if (v.blink >= 0) { v.blink += pdt; P.face.blink(Math.sin(Math.min(1, v.blink / 0.5) * Math.PI)); if (v.blink > 0.5) { v.blink = -1; P.face.blink(0); } }
    this.place();
    P.neck.updateWorldMatrix(true, false);
    P.neck.getWorldQuaternion(tmpQ);
    tmpE.set(-hp, v.yaw + hy, hz, 'YXZ');
    tmpQ2.setFromEuler(tmpE);
    P.head.quaternion.copy(tmpQ.invert().multiply(tmpQ2));
    // eyeshine
    const glow = dead ? Math.max(0, 1 - v.death) : this.scare ? 0 : chase || mode === 'watch' ? 1 : 0.55;
    this.glowMat.opacity = glow * (0.85 + Math.random() * 0.15);
    this.glowMat.color.setHex(chase ? 0xff6040 : 0xffe0b0);
    P.glows.forEach((g) => g.scale.setScalar(chase ? 0.42 : mode === 'watch' ? 0.45 : 0.3));
    if (this.scare) { if (camPos) P.face.look(camPos, 0.62); this.placeForScare(t); }
  }
  place() {
    this.root.position.set(this.v.x, 0, this.v.z);
    this.root.rotation.set(0, this.v.yaw, 0);
  }
  // Ram his face right into the camera.
  placeForScare(t) {
    const cam = this.scare.camera;
    const fwd = cam.getWorldDirection(tmpV2);
    fwd.y = 0; fwd.normalize();
    this.v.yaw = Math.atan2(-fwd.x, -fwd.z);
    this.root.rotation.set(0, this.v.yaw, 0);
    this.root.updateMatrixWorld(true);
    const head = this.headWorld(new THREE.Vector3());
    const st = this.scare.t;
    const k = Math.min(1, st / 0.1);
    const dist = lerp(1.4, 0.36, k) - (st > 1.05 && st < 1.25 ? 0.1 : 0) + Math.sin(st * 31) * 0.015;
    const want = cam.position.clone().addScaledVector(fwd, dist).add(new THREE.Vector3(R(-0.015, 0.015), 0.02 + R(-0.015, 0.015), 0));
    this.root.position.add(want.sub(head));
    this.root.updateMatrixWorld(true);
  }
  dispose() {
    this.root.traverse((o) => o.geometry?.dispose());
    this.mats.forEach((m) => m.dispose());
    this.parts.face.dispose();
  }
}
