// De Sint. Almost a man: a towering old bishop on thin bare legs, a grin far too wide,
// glassy eyes that follow you, a head that turns too far.
import * as THREE from 'three';
import { R, clamp, damp, dampAngle, angleDiff, lerp, makeRng } from './rng.js';
import { makeSinter } from './sinter3d.js';

export const SANTA_MODES = ['wander', 'investigate', 'notice', 'chase', 'search', 'feed', 'stunned', 'retreat', 'dead', 'watch'];

const eyeTmp = new THREE.Vector3();
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
  // The Demonic Sinterklaas: MakeHuman body on a full skeleton (see sinter3d.js), driven bone by bone here.
  build(T) {
    const M = this.model = makeSinter('demonic');
    this.root.add(M.root);
    this.mats = [...M.mats];
    const B = M.bones;
    this.parts = { torso: B.spine02, hips: B.spine05 || B.root, head: B.head };
    // eyeshine: a dying ember deep in each socket, so you know where He is in the dark
    const glowMat = new THREE.SpriteMaterial({ map: T.glow, color: 0xff5020, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.6 });
    this.glowMat = glowMat; this.mats.push(glowMat);
    this.parts.glows = M.eyes.map((e) => {
      const s = new THREE.Sprite(glowMat);
      s.position.set(0, 0, 0.004);
      s.scale.setScalar(0.06);
      e.holder.add(s);
      return s;
    });
    M.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.feet = [B['foot.L'], B['foot.R']];
    this.toes = [B['toe1-1.L'] || B['foot.L'], B['toe1-1.R'] || B['foot.R']];
  }

  // ------------------------------------------------------------------ net
  netState() {
    const s = this.s, r2 = (v) => Math.round(v * 100) / 100;
    return [r2(s.x), r2(s.z), r2(s.yaw), r2(s.headYaw), r2(s.headPitch), SANTA_MODES.indexOf(s.mode), r2(s.speed), s.hp, ['walk', 'run', 'sprint', 'crawl', 'stalk'].indexOf(s.style || 'walk')];
  }
  applyNet(a) {
    const s = this.s;
    [s.x, s.z, s.yaw, s.headYaw, s.headPitch] = a;
    s.mode = SANTA_MODES[a[5]] || 'wander';
    s.speed = a[6]; s.hp = a[7]; s.style = ['walk', 'run', 'sprint', 'crawl', 'stalk'][a[8]] || 'walk';
  }

  // ------------------------------------------------------------------ AI (host only)
  setMode(m) { this.s.mode = m; this.ai.modeT = 0; this.ai.path = null; if (m !== 'chase') this.s.style = 'walk'; else this.ai.styleT = 0; }
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
        // He never chases the same way twice: running, sprinting, crawling, slow staring stalks
        ai.styleT = (ai.styleT ?? 0) - dt;
        if (ai.styleT <= 0) {
          const r = Math.random();
          ai.style = r < 0.35 ? 'run' : r < 0.55 ? 'sprint' : r < 0.78 ? 'crawl' : 'stalk';
          ai.styleT = ai.style === 'sprint' ? R(1.0, 1.6) : ai.style === 'stalk' ? R(1.8, 3.2) : R(2.5, 4.5);
        }
        s.style = ai.style;
        let speed = { run: 3.6, sprint: 4.9, crawl: 3.0, stalk: 1.1 }[ai.style] + ai.rage * 0.25;
        const canLunge = ai.style === 'run' || ai.style === 'sprint' || ai.style === 'crawl';
        if (ai.lungeT > 0) { ai.lungeT -= dt; speed = 5.6; if (ai.lungeT <= 0) ai.lungeCd = 2.4; }
        else if (ai.lungeCd > 1.3) speed = Math.min(speed, 2.6);
        else if (d < 2.3 && los && ai.lungeCd <= 0 && canLunge) ai.lungeT = 0.28;
        if (los) {
          ai.lastSeen = [target.x, target.z]; ai.lostT = 0; ai.path = null;
          this.moveToward(target.x, target.z, speed, dt);
        } else {
          ai.lostT += dt;
          ai.repathT -= dt;
          if (!ai.path || ai.repathT <= 0) { this.setPath(ai.lastSeen[0], ai.lastSeen[1]); ai.repathT = 0.8; }
          if (this.followPath(speed * 0.9, dt) || ai.lostT > 4) { ai.huntAfter = target.id; this.startSearch(R(2.5, 4)); ai.relief = 0; }
        }
        if (d < 0.95 && !target.safe) {
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
    const a = P.torso.getWorldPosition(new THREE.Vector3());
    const b = this.headWorld(new THREE.Vector3());
    const c = P.hips.getWorldPosition(new THREE.Vector3());
    return [[a, 0.62], [b, 0.24], [c, 0.4]];
  }
  // between the eyes
  headWorld(out) {
    const e = this.model.eyes;
    e[0].holder.getWorldPosition(out);
    return out.add(e[1].holder.getWorldPosition(eyeTmp)).multiplyScalar(0.5);
  }

  animate(dt, t, camPos) {
    const s = this.s, v = this.v, P = this.parts, C = this.castle, M = this.model, rot = M.rot;
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
    v.reach = damp(v.reach, chase ? (s.style === 'stalk' ? 1 : s.style === 'crawl' ? 0 : 0.6) : mode === 'notice' ? 0.5 : mode === 'feed' ? 0.7 : 0, 6, dt);
    // He is far too tall for the doorways: fold down under the lintels
    const [cx, cy] = C.cellAt(v.x, v.z);
    let dd = 9;
    for (let d = 0; d < 4; d++) {
      if (C.edge(cx, cy, d) !== 1) continue;
      const [mx, mz] = C.edgeMid(cx, cy, d);
      dd = Math.min(dd, Math.hypot(mx - v.x, mz - v.z));
    }
    v.duck = damp(v.duck, clamp(1 - (dd - 0.8) / 1.7, 0, 1), 8, dt);
    if (dead) v.death = Math.min(1.6, v.death + dt * 0.55);
    // stop-motion: when standing still, the pose updates in jerky 11fps steps
    const style = chase ? s.style || 'run' : 'walk';
    const stepped = !chase && !this.scare && mode !== 'stunned' && mode !== 'watch' && s.speed < 0.3;
    v.accum = (v.accum || 0) + dt;
    if (stepped && v.accum < 1 / 11) { this.place(); return; }
    const pdt = stepped ? v.accum : dt;
    v.accum = 0;
    const speed = dead ? 0 : s.speed;
    const running = speed > 3 && style !== 'crawl';
    const crawling = style === 'crawl';
    const amp = speed > 0.05 ? (running ? 1.0 + 0.3 * Math.min(1, (speed - 3) / 2.5) : 0.6 + 0.45 * Math.min(1, speed / 4.5)) : 0;
    v.amp = damp(v.amp || 0, amp, 6, pdt);
    v.crawl = damp(v.crawl || 0, crawling ? 1 : 0, 5, pdt);
    // long legs: a longer stride per cycle
    if (speed > 0.05) v.phase += (speed * pdt * Math.PI) / ((running ? 2.0 : crawling ? 1.0 : 1.4) * Math.max(0.5, v.amp));
    // twitches
    this.nextTwitch -= pdt;
    if (this.nextTwitch <= 0 && !dead) {
      this.nextTwitch = chase ? R(0.25, 0.7) : R(0.5, 2.2);
      const kind = Math.random();
      this.twitches.push({ kind: kind < 0.5 ? 'head' : kind < 0.78 ? 'arm' : 'shudder', amt: (Math.random() < 0.5 ? -1 : 1) * R(0.5, 1.3), side: Math.random() < 0.5 ? 0 : 1, t: 0, dur: R(0.2, 0.8) });
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

    M.resetPose();
    const SD = ['L', 'R'];
    // legs: thin, human knees, stiff stride
    const duck = Math.min(1.4, v.duck + (mode === 'feed' ? 0.55 : 0) + (dead ? v.death * 0.8 : 0));
    const run = running ? 1 : 0, cr = v.crawl;
    for (let i = 0; i < 2; i++) {
      const ph = v.phase + i * Math.PI;
      const sw = Math.sin(ph) * v.amp, lift = Math.max(0, Math.cos(ph)) * v.amp;
      const a1 = lerp(0.04 + duck * 0.7 - sw * (0.42 + run * 0.25) + run * 0.1, 1.25 - sw * 0.4, cr);
      const a2 = lerp(0.1 + duck * 1.3 + lift * (1.0 + run * 0.7), 2.0 - lift * 0.4, cr);
      rot(`upperleg01.${SD[i]}`, -a1, 0, (i ? -1 : 1) * (0.03 + duck * 0.08));
      rot(`lowerleg01.${SD[i]}`, a2);
      rot(`foot.${SD[i]}`, -(a2 - a1) * 0.85 - lift * 0.3);
      const planted = Math.cos(ph) < 0;
      if (planted && !v.lastPlant[i] && v.amp > 0.3 && this.onStep) this.onStep(v.x, v.z, chase ? 1.3 : 0.9);
      v.lastPlant[i] = planted;
    }
    // torso: huge, hunched, swaying over the thin legs
    const lean = lerp(0.22 + duck * 0.62 + v.reach * 0.3 + (running ? 0.22 : 0) + (dead ? v.death * 0.55 : 0), 1.35, cr);
    const swayY = Math.sin(v.phase) * 0.12 * v.amp, swayZ = Math.sin(v.phase) * 0.06 * v.amp + (dead ? v.death * 0.35 : 0);
    for (const n of ['spine04', 'spine03', 'spine02', 'spine01']) rot(n, lean / 4, swayY / 4, swayZ / 4);
    rot('clavicle.L', 0, 0, 0.22 + v.reach * 0.1); rot('clavicle.R', 0, 0, -0.22 - v.reach * 0.1);
    // arms: far too long, hanging past the knees
    const armDown = 0.66;
    for (let i = 0; i < 2; i++) {
      const sg = i ? 1 : -1; // z sign that lowers this arm out of the A-pose
      const opp = Math.sin(v.phase + (i ? 0 : Math.PI)) * v.amp;
      const hang = -lean + opp * 0.3 + twArm[i] * 0.5;
      const reachA = -lean - 1.3 + Math.sin(t * 9 + i) * 0.1;
      const feedA = -lean - 0.8;
      let ax = lerp(hang, mode === 'feed' ? feedA : reachA, v.reach);
      if (running) ax = lerp(-lean - opp * 1.0 - 0.15, reachA, 0.25);
      if (mode === 'stunned') ax = -lean - 2.5 + Math.sin(t * 20 + i) * 0.3;
      ax = lerp(ax, -lean - 0.35 - opp * 0.6, cr); // crawling: long arms pulling along the floor
      let az = sg * (armDown - v.reach * 0.25);
      if (mode === 'stunned') az = sg * 0.2;
      rot(`upperarm01.${SD[i]}`, ax, 0, az);
      rot(`lowerarm01.${SD[i]}`, -0.15 - v.reach * 0.3 - (i === 1 && v.reach < 0.5 ? 0.3 : 0));
      rot(`wrist.${SD[i]}`, -0.15 + v.reach * 0.25);
      const curl = v.reach > 0.5 ? 0.1 + Math.sin(t * 14 + i) * 0.12 : 0.35 + Math.sin(t * 1.3 + i * 2) * 0.15;
      const grip = i === 1 && v.reach < 0.5 && !dead;
      for (let f = 1; f <= 5; f++) {
        const c = grip && f > 1 ? 1.1 : curl + (twArm[i] ? Math.sin(f * 3 + t * 30) * 0.4 : 0);
        rot(`finger${f}-1.${SD[i]}`, c * 0.5); rot(`finger${f}-2.${SD[i]}`, c); rot(`finger${f}-3.${SD[i]}`, c * 0.8);
      }
    }
    // neck pushed forward from the shoulders
    rot('neck01', 0.32 + duck * 0.2, 0, 0); rot('neck02', 0.1);
    // jaw: hangs open, wider when he wants you
    let jaw = 0.18 + Math.sin(t * 2.1) * 0.03 + v.reach * 0.2 + (mode === 'notice' ? 0.4 : 0) + (mode === 'feed' ? 0.25 + Math.sin(t * 16) * 0.2 : 0) + (mode === 'stunned' ? 0.5 : 0) + (dead ? 0.4 * Math.min(1, v.death) : 0);
    if (chase) jaw += Math.sin(t * 19) * 0.05;
    let hy = v.headYaw, hp = v.headPitch, hz = 0.16 + twHead * 0.3 + Math.sin(t * 0.7) * 0.06; // head cocked, always
    if (chase) { hz += Math.sin(t * 31) * 0.08; hy += Math.sin(t * 23) * 0.05; }
    if (mode === 'stunned') { hp = 0.8; hz += Math.sin(t * 25) * 0.4; }
    if (mode === 'watch') { hz = 0.2 + Math.sin(t * 0.35) * 0.4; hy = Math.sin(t * 0.21) * 0.25; hp = -0.1 + Math.sin(t * 0.5) * 0.1; }
    if (dead) hp = 1.1 * Math.min(1, v.death);
    if (this.scare) {
      jaw = 0.62 + Math.sin(t * 40) * 0.05;
      hy = 0; hp = 0; hz = 0.15 + R(-0.25, 0.25);
      // arms flung forward and wide, fingers splayed, reaching for the lens
      for (let i = 0; i < 2; i++) {
        const sg = i ? 1 : -1;
        rot(`upperarm01.${SD[i]}`, -lean - 0.9 + Math.sin(t * 23 + i) * 0.05, 0, -sg * 0.35);
        rot(`lowerarm01.${SD[i]}`, -0.2); rot(`wrist.${SD[i]}`, -0.5);
        for (let f = 1; f <= 5; f++) { rot(`finger${f}-1.${SD[i]}`, 0.05, 0, 0); rot(`finger${f}-2.${SD[i]}`, 0.1); rot(`finger${f}-3.${SD[i]}`, 0.1); }
      }
    }
    rot('jaw', Math.max(0, jaw));
    M.staff.visible = !dead && v.reach < 0.5 && !this.scare;
    // place, then stand the feet on the floor
    this.place();
    M.root.position.set(shudder * R(-0.03, 0.03) + (mode === 'watch' ? Math.sin(t * 0.6) * 0.06 : 0), 0, shudder * R(-0.03, 0.03));
    this.root.updateMatrixWorld(true);
    let low = Infinity;
    for (const b of [...this.feet, ...this.toes]) low = Math.min(low, b.getWorldPosition(tmpV).y);
    M.root.position.y = 0.07 - low + (running ? Math.abs(Math.cos(v.phase)) * 0.06 : 0) - (dead ? Math.max(0, v.death - 0.9) * 1.1 : 0);
    // head: held in world space, the way an owl does
    this.root.updateMatrixWorld(true);
    const head = P.head;
    head.parent.getWorldQuaternion(tmpQ);
    tmpQ2.setFromEuler(tmpE.set(-hp + 0.05, v.yaw + hy, -hz, 'YXZ')).multiply(head.userData.bindWorld);
    // the model root may be scaled but not rotated relative to this.root, so the world rotation is enough
    head.quaternion.copy(tmpQ.invert().multiply(tmpQ2));
    M.finish(camPos ? tmpV.copy(camPos) : null);
    // eyeshine
    const glow = dead ? Math.max(0, 1 - v.death) : this.scare ? 0 : chase || mode === 'watch' ? 1 : 0.6;
    this.glowMat.opacity = glow * (0.85 + Math.random() * 0.15);
    this.glowMat.color.setHex(chase ? 0xff3010 : 0xff7040);
    P.glows.forEach((g) => g.scale.setScalar(chase ? 0.09 : mode === 'watch' ? 0.1 : 0.06));
    if (this.scare) this.placeForScare(t);
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
    // lunge in to arm's length, hang there shaking, then a second lunge right into your face
    const dist = lerp(1.6, 0.62, k) - (st > 1.0 ? Math.min(1, (st - 1.0) / 0.12) * 0.3 : 0) + Math.sin(st * 31) * 0.02;
    const want = cam.position.clone().addScaledVector(fwd, dist).add(new THREE.Vector3(R(-0.015, 0.015), 0.02 + R(-0.015, 0.015), 0));
    this.root.position.add(want.sub(head));
    this.root.updateMatrixWorld(true);
  }
  dispose() {
    this.root.traverse((o) => o.geometry?.dispose());
    this.mats.forEach((m) => m.dispose());
  }
}
