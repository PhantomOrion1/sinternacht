// Crossbow parts, batteries, secret doors, the sack, and the crossbow itself.
import * as THREE from 'three';
import { R } from './rng.js';

export const PART_NAMES = ['Oak Stock', 'Steel Limbs', 'Gut Bowstring', 'Silver Bolts'];
const DOOR_W = 1.15, DOOR_H = 2.15;

function partModel(i, M) {
  const g = new THREE.Group();
  if (i === 0) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.5), M.wood); g.add(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.12), M.wood); b.position.set(0, -0.08, -0.15); b.rotation.x = 0.4; g.add(b);
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.12), M.iron); c.position.set(0, -0.045, 0.05); g.add(c);
  } else if (i === 1) {
    const a = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.016, 5, 20, Math.PI * 0.75), M.steel); a.rotation.z = Math.PI * 0.125; g.add(a);
    g.rotation.x = Math.PI / 2;
  } else if (i === 2) {
    for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.08 - k * 0.004, 0.006, 4, 18), M.gut); t.rotation.x = Math.PI / 2; t.position.y = k * 0.014; g.add(t); }
  } else {
    for (let k = -1; k <= 1; k++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 5), M.silver); s.rotation.x = Math.PI / 2; s.position.x = k * 0.03; g.add(s);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 5), M.silver); tip.rotation.x = Math.PI / 2; tip.position.set(k * 0.03, 0, 0.21); g.add(tip);
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.05), M.feather); fl.position.set(k * 0.03, 0, -0.16); g.add(fl);
    }
  }
  return g;
}

export function buildCrossbow(M) {
  const g = new THREE.Group();
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.62), M.wood); stock.position.z = 0.05; g.add(stock);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.08), M.wood); grip.position.set(0, -0.08, 0.22); grip.rotation.x = 0.3; g.add(grip);
  const limbs = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.013, 5, 20, Math.PI * 0.62), M.steel);
  limbs.rotation.set(Math.PI / 2, 0, Math.PI * 0.19 + Math.PI); limbs.position.set(0, 0.0, -0.05); g.add(limbs);
  const str = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.004, 0.004), M.gut); str.position.set(0, 0.02, 0.11); g.add(str);
  g.userData.string = str;
  const bolt = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.4, 5), M.silver); shaft.rotation.x = Math.PI / 2; bolt.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 5), M.silver); tip.rotation.x = -Math.PI / 2; tip.position.z = -0.22; bolt.add(tip);
  bolt.position.set(0, 0.035, -0.08);
  g.add(bolt);
  g.userData.bolt = bolt;
  return g;
}

export class Items {
  constructor(castle, T) {
    this.castle = castle;
    this.T = T;
    this.group = new THREE.Group();
    const M = this.M = {
      wood: new THREE.MeshStandardMaterial({ map: T.wood.map, roughness: 0.7, emissive: 0x1a1008 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.4 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.25, emissive: 0x101418 }),
      gut: new THREE.MeshStandardMaterial({ color: 0xc8b890, roughness: 0.6, emissive: 0x1a160c }),
      silver: new THREE.MeshStandardMaterial({ color: 0xe0e4ea, metalness: 1, roughness: 0.15, emissive: 0x181c22 }),
      feather: new THREE.MeshStandardMaterial({ color: 0x7a1010, roughness: 1 }),
      battery: new THREE.MeshStandardMaterial({ color: 0x1a2a40, metalness: 0.4, roughness: 0.5 }),
      copper: new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.9, roughness: 0.3 }),
      jute: new THREE.MeshStandardMaterial({ map: T.wood.map, color: 0xb89a70, roughness: 1 }),
      rope: new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 1 }),
    };
    this.glowMat = new THREE.SpriteMaterial({ map: T.glow, color: 0xc8d8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 });
    this.parts = castle.partSpots.map((sp, i) => {
      const mesh = partModel(i, M);
      const holder = new THREE.Group();
      holder.position.set(sp.x, 1.12, sp.z);
      holder.add(mesh);
      const glow = new THREE.Sprite(this.glowMat.clone()); glow.scale.setScalar(0.75); holder.add(glow);
      this.group.add(holder);
      return { i, name: PART_NAMES[i], x: sp.x, z: sp.z, y: 1.12, holder, mesh, glow, taken: false };
    });
    const batGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.11, 10);
    const capGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.015, 10);
    const bglow = new THREE.SpriteMaterial({ map: T.glow, color: 0x60ff90, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 });
    this.batteries = castle.batterySpots.map((sp, i) => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(batGeo, M.battery); b.rotation.z = Math.PI / 2; g.add(b);
      const c = new THREE.Mesh(capGeo, M.copper); c.rotation.z = Math.PI / 2; c.position.x = 0.06; g.add(c);
      const gl = new THREE.Sprite(bglow); gl.scale.setScalar(0.18); gl.position.y = 0.02; g.add(gl);
      g.position.set(sp.x, 0.036, sp.z); g.rotation.y = R(0, 6);
      this.group.add(g);
      return { i, x: sp.x, z: sp.z, mesh: g, taken: false };
    });
    this.doors = new Map();
    this.sacks = new Map();
    this.bolts = [];
    this.crackMat = new THREE.MeshBasicMaterial({ color: 0xffb070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
    // light beyond the passage
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 80, 4, 32, 70, 80);
    gr.addColorStop(0, '#fffaf0'); gr.addColorStop(0.35, '#ffd9a0'); gr.addColorStop(0.8, '#7a4a20'); gr.addColorStop(1, '#1a0e06');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 128);
    this.portalTex = new THREE.CanvasTexture(c); this.portalTex.colorSpace = THREE.SRGBColorSpace;
  }

  takePart(i) { const p = this.parts[i]; if (!p || p.taken) return false; p.taken = true; p.holder.visible = false; return true; }
  takeBattery(i) { const b = this.batteries[i]; if (!b || b.taken) return false; b.taken = true; b.mesh.visible = false; return true; }

  // ---------- secret doors ----------
  addDoor(d) {
    if (this.doors.has(d.id)) return;
    const C = this.castle;
    const F = C.faceFrame(d.fx, d.fy, d.side);
    const [x, z] = F.p(0, 0);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = F.rot;
    // the loose panel: same stone, but the joints don't quite line up
    const pg = new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.08);
    const uv = pg.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (DOOR_W / 3.0) + 0.31, uv.getY(k) * (DOOR_H / 3.0) + 0.13);
    const panel = new THREE.Mesh(pg, C.mats.wall);
    panel.position.set(0, DOOR_H / 2, -0.034);
    panel.castShadow = true; panel.receiveShadow = true;
    g.add(panel);
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W - 0.06, DOOR_H - 0.04), new THREE.MeshBasicMaterial({ map: this.portalTex, fog: false }));
    portal.position.set(0, DOOR_H / 2, 0.002);
    g.add(portal);
    // hairline cracks of light around the panel
    const mat = this.crackMat.clone();
    const cracks = new THREE.Group();
    const seg = (x0, y0, x1, y1, w = 0.012) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.012);
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      cracks.add(m);
    };
    const hw = DOOR_W / 2;
    let py = 0.02;
    for (const sx of [-hw, hw]) {
      py = 0.02;
      while (py < DOOR_H - 0.1) {
        const ny = Math.min(DOOR_H, py + R(0.25, 0.6));
        if (Math.random() < 0.8) seg(sx + R(-0.01, 0.01), py, sx + R(-0.01, 0.01), ny);
        py = ny + R(0.02, 0.12);
      }
    }
    let px = -hw;
    while (px < hw - 0.05) { const nx = Math.min(hw, px + R(0.15, 0.4)); if (Math.random() < 0.85) seg(px, DOOR_H + R(-0.01, 0.01), nx, DOOR_H + R(-0.01, 0.01)); px = nx + R(0.02, 0.1); }
    for (let k = 0; k < 3; k++) { const sx = R(-hw, hw), sy = R(0.4, 2); seg(sx, sy, sx + R(-0.15, 0.15), sy + R(-0.2, 0.2), 0.007); }
    seg(-hw, 0.008, hw, 0.008, 0.02);
    g.add(cracks);
    // faint warm spill on the floor
    const leakMat = new THREE.MeshBasicMaterial({ map: this.T.glow, color: 0xffa060, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
    const leak = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), leakMat); leak.rotation.x = -Math.PI / 2; leak.position.set(0, 0.012, 0.3);
    g.add(leak);
    // drifting dust
    const n = 24, pos = new Float32Array(n * 3), seeds = [];
    for (let k = 0; k < n; k++) { seeds.push([R(-hw, hw), R(0, DOOR_H), R(0, 1), R(0.05, 0.2)]); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: this.T.dust, size: 0.03, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, color: 0xffd8a8 }));
    g.add(dust);
    this.group.add(g);
    const [lx, lz] = F.p(0, 1.2);
    this.doors.set(d.id, { ...d, x, z, F, g, panel, portal, cracks, mat, leak, leakMat, dust, seeds, alpha: 0, open: d.open || false, openT: 0, light: { x: lx, y: 1.3, z: lz, color: 0xffc890, power: 0, range: 9, flicker: 0.05 } });
    this.castle.lights.push(this.doors.get(d.id).light);
  }
  openDoor(id) {
    const d = this.doors.get(id);
    if (!d || d.open) return null;
    d.open = true; d.openT = 0;
    return d;
  }
  removeDoor(id) {
    const d = this.doors.get(id);
    if (!d) return;
    this.group.remove(d.g);
    d.g.traverse((o) => o.geometry?.dispose());
    const li = this.castle.lights.indexOf(d.light);
    if (li >= 0) this.castle.lights.splice(li, 1);
    this.doors.delete(id);
  }

  // ---------- the sack (a caught friend) ----------
  addSack(pid, x, z) {
    if (this.sacks.has(pid)) return;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pivot = new THREE.Group(); pivot.position.y = 4.15; g.add(pivot);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 5), this.M.rope); rope.position.y = -0.75; pivot.add(rope);
    const sg = new THREE.SphereGeometry(0.42, 14, 10);
    const p = sg.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 + Math.sin(p.getX(i) * 11 + y * 7) * 0.1; p.setXYZ(i, p.getX(i) * k, y * 1.9, p.getZ(i) * k); }
    sg.computeVertexNormals();
    const sack = new THREE.Mesh(sg, this.M.jute); sack.position.y = -2.3; sack.castShadow = true; pivot.add(sack);
    const knot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.14, 0.2, 8), this.M.jute); knot.position.y = -1.5; pivot.add(knot);
    this.group.add(g);
    this.sacks.set(pid, { pid, x, z, g, pivot, sack, t: 0, jolt: 0 });
  }
  removeSack(pid) {
    const s = this.sacks.get(pid);
    if (!s) return;
    this.group.remove(s.g);
    this.sacks.delete(pid);
  }

  // ---------- crossbow bolts in flight ----------
  fireBolt(from, dir, dist) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 5), this.M.silver); shaft.rotation.x = Math.PI / 2; g.add(shaft);
    g.position.copy(from);
    g.lookAt(from.clone().add(dir));
    this.group.add(g);
    this.bolts.push({ g, from: from.clone(), dir: dir.clone(), dist, t: 0, life: 25 });
  }

  update(dt, t) {
    for (const p of this.parts) {
      if (p.taken) continue;
      p.mesh.rotation.y += dt * 0.5;
      p.mesh.position.y = Math.sin(t * 1.4 + p.i) * 0.03;
      p.glow.material.opacity = 0.22 + Math.sin(t * 2 + p.i * 2) * 0.1;
    }
    for (const d of this.doors.values()) {
      const age = (Date.now() - d.born) / 1000;
      const left = d.life - age;
      const target = d.open ? 1 : Math.min(1, age / 4, Math.max(0, left / 4));
      d.alpha += (target - d.alpha) * Math.min(1, dt * 2);
      const flick = 0.75 + Math.sin(t * 7.3 + d.x) * 0.15 + Math.random() * 0.1;
      d.mat.opacity = d.alpha * 0.55 * flick * (d.open ? 0 : 1);
      d.leakMat.opacity = d.alpha * 0.1 * flick * (d.open ? 4 : 1);
      d.dust.material.opacity = d.alpha * 0.5;
      const pos = d.dust.geometry.attributes.position;
      d.seeds.forEach((s, k) => {
        s[2] = (s[2] + dt * s[3]) % 1;
        pos.setXYZ(k, s[0] + Math.sin(t + k) * 0.05, s[1] - s[2] * 0.3, 0.05 + s[2] * 1.3);
      });
      pos.needsUpdate = true;
      if (d.open) {
        d.openT += dt;
        const k = Math.min(1, d.openT / 1.4);
        const e = k * k * (3 - 2 * k);
        d.panel.position.set(e * (DOOR_W + 0.05), DOOR_H / 2 + Math.sin(d.openT * 40) * 0.004 * (1 - k), -0.034 + Math.min(1, d.openT * 4) * 0.1);
        d.light.power = 14 * e;
      }
    }
    for (const s of this.sacks.values()) {
      s.t += dt;
      s.jolt -= dt;
      if (s.jolt < -R(1, 4)) s.jolt = 0.4;
      const j = s.jolt > 0 ? Math.sin(s.t * 30) * 0.12 : 0;
      s.pivot.rotation.set(Math.sin(s.t * 0.8) * 0.06 + j, 0, Math.cos(s.t * 0.6) * 0.05 + j * 0.5);
      s.sack.scale.set(1 + j * 0.3, 1 - j * 0.2, 1);
    }
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      const b = this.bolts[k];
      b.t += dt;
      const travelled = Math.min(b.dist, b.t * 48);
      b.g.position.copy(b.from).addScaledVector(b.dir, travelled);
      if (b.t > b.life || (b.hidden && travelled >= b.dist)) { this.group.remove(b.g); this.bolts.splice(k, 1); }
    }
  }

  // best thing to interact with, if any
  findInteract(cam, fwd, opts) {
    let best = null, bestScore = -1;
    const consider = (type, id, x, y, z, range, minDot, label, hold = 0) => {
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range) return;
      const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (d || 1);
      if (dot < minDot && d > 0.9) return;
      const score = dot * 2 - d * 0.3;
      if (score > bestScore) { bestScore = score; best = { type, id, label, hold, x, z }; }
    };
    if (opts.alive) {
      for (const p of this.parts) if (!p.taken) consider('part', p.i, p.x, p.y, p.z, 2.4, 0.7, `Take the ${p.name}`);
      for (const b of this.batteries) if (!b.taken) consider('battery', b.i, b.x, 0.05, b.z, 2.1, 0.75, 'Take the battery');
      for (const d of this.doors.values()) {
        const [fx, fz] = d.F.p(0, 0.3);
        if (d.open) consider('door', d.id, fx, 1.2, fz, 2.8, 0.3, 'Escape through the passage');
        else if (d.alpha > 0.3) consider('door', d.id, fx, 1.2, fz, 2.0, 0.55, 'Push the cracked stones');
      }
      for (const s of this.sacks.values()) consider('sack', s.pid, s.x, 1.8, s.z, 2.4, 0.4, `Hold [E] to cut ${opts.names?.[s.pid] || 'your friend'} down`, 2.2);
    }
    return best;
  }

  dispose() {
    this.group.traverse((o) => o.geometry?.dispose());
    Object.values(this.M).forEach((m) => m.dispose());
  }
}
