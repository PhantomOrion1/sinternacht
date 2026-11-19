// Procedural castle: a maze of dark rooms. Same seed => same castle for both players.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from './rng.js';

export const CELL = 7;
export const WALL_H = 4.2;
export const DOOR_W = 1.9;
export const DOOR_H = 2.9;
export const PILLAR = 0.9;
export const WALL_T = 0.5;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
const FACE_ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

// ---------- geometry bucket with world-space UVs ----------
class Bucket {
  constructor(scale = 2) { this.s = scale; this.pos = []; this.nor = []; this.uv = []; this.extra = []; }
  face(o, a, b, n, s = this.s) {
    const la = Math.hypot(...a) || 1, lb = Math.hypot(...b) || 1;
    const ua = a.map((v) => v / la), ub = b.map((v) => v / lb);
    const p = [o, [o[0] + a[0], o[1] + a[1], o[2] + a[2]], [o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2]], [o[0] + b[0], o[1] + b[1], o[2] + b[2]]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const q = p[i];
      this.pos.push(q[0], q[1], q[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push((q[0] * ua[0] + q[1] * ua[1] + q[2] * ua[2]) / s, (q[0] * ub[0] + q[1] * ub[1] + q[2] * ub[2]) / s);
    }
  }
  box(x0, y0, z0, x1, y1, z1, opt = {}) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    this.face([x1, y0, z1], [0, 0, -dz], [0, dy, 0], [1, 0, 0]);
    this.face([x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0]);
    this.face([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1]);
    this.face([x1, y0, z0], [-dx, 0, 0], [0, dy, 0], [0, 0, -1]);
    if (opt.top !== false) this.face([x0, y1, z1], [dx, 0, 0], [0, 0, -dz], [0, 1, 0]);
    if (opt.bottom) this.face([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0]);
  }
  geo(g) {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.uv) return;
    this.extra.push(ng);
  }
  build() {
    const parts = [];
    if (this.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      parts.push(g);
    }
    for (const e of this.extra) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', e.attributes.position);
      g.setAttribute('normal', e.attributes.normal);
      g.setAttribute('uv', e.attributes.uv);
      parts.push(g);
    }
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : mergeGeometries(parts);
  }
}

function webTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = 'rgba(220,220,220,0.55)';
  x.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * (Math.PI / 2);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); x.stroke();
  }
  for (let r = 10; r < 128; r += 11) {
    x.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      const rr = r + Math.sin(i * 3.1 + r) * 3;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) x.moveTo(px, py); else x.quadraticCurveTo(Math.cos(a - 0.1) * (rr - 4), Math.sin(a - 0.1) * (rr - 4), px, py);
    }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Castle {
  constructor(seed, T, N = 9) {
    this.seed = seed;
    this.N = N;
    this.size = N * CELL;
    this.T = T;
    this.rng = makeRng(seed);
    this.group = new THREE.Group();
    this.colliders = [];
    this.cellCol = Array.from({ length: N * N }, () => []);
    this.lights = []; // light anchors for the torch light pool
    this.flames = []; // animated flame sprites
    this.windows = [];
    this.makeMaze();
    this.makeCells();
    this.buildStructure();
    this.decorate();
    this.planSpawns();
    this.finalize();
  }

  // ---------- maze ----------
  makeMaze() {
    const N = this.N, rng = this.rng;
    this.h = Array.from({ length: N + 1 }, () => new Array(N).fill(0));
    this.v = Array.from({ length: N }, () => new Array(N + 1).fill(0));
    const seen = new Uint8Array(N * N);
    const stack = [[rng.int(0, N - 1), rng.int(0, N - 1)]];
    seen[stack[0][1] * N + stack[0][0]] = 1;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const opts = [];
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && !seen[ny * N + nx]) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      const d = rng.pick(opts);
      this.setEdge(x, y, d, 1);
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      seen[ny * N + nx] = 1;
      stack.push([nx, ny]);
    }
    // extra loops so you can circle around Him
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (x < N - 1 && this.edge(x, y, 1) === 0 && rng.chance(0.16)) this.setEdge(x, y, 1, 1);
      if (y < N - 1 && this.edge(x, y, 2) === 0 && rng.chance(0.16)) this.setEdge(x, y, 2, 1);
    }
    // great halls (2x2 open blocks)
    this.halls = [];
    const taken = new Set();
    for (let tries = 0; tries < 60 && this.halls.length < 3; tries++) {
      const bx = rng.int(1, N - 3), by = rng.int(1, N - 3);
      let ok = true;
      for (let yy = by - 1; yy <= by + 2; yy++) for (let xx = bx - 1; xx <= bx + 2; xx++) if (taken.has(xx + ',' + yy)) ok = false;
      if (!ok) continue;
      for (let yy = by; yy <= by + 1; yy++) for (let xx = bx; xx <= bx + 1; xx++) taken.add(xx + ',' + yy);
      this.v[by][bx + 1] = 2; this.v[by + 1][bx + 1] = 2;
      this.h[by + 1][bx] = 2; this.h[by + 1][bx + 1] = 2;
      this.halls.push({ bx, by });
    }
  }
  edge(x, y, d) {
    switch (d) {
      case 0: return this.h[y][x];
      case 1: return this.v[y][x + 1];
      case 2: return this.h[y + 1][x];
      default: return this.v[y][x];
    }
  }
  setEdge(x, y, d, val) {
    switch (d) {
      case 0: this.h[y][x] = val; break;
      case 1: this.v[y][x + 1] = val; break;
      case 2: this.h[y + 1][x] = val; break;
      default: this.v[y][x] = val;
    }
  }
  passable(x, y, d) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    if (nx < 0 || ny < 0 || nx >= this.N || ny >= this.N) return false;
    return this.edge(x, y, d) !== 0;
  }
  cellAt(px, pz) {
    const N = this.N;
    return [Math.max(0, Math.min(N - 1, Math.floor(px / CELL))), Math.max(0, Math.min(N - 1, Math.floor(pz / CELL)))];
  }
  center(x, y) { return [(x + 0.5) * CELL, (y + 0.5) * CELL]; }
  edgeMid(x, y, d) {
    const [cx, cz] = this.center(x, y);
    return [cx + DIRS[d][0] * CELL / 2, cz + DIRS[d][1] * CELL / 2];
  }
  bfs(sx, sy) {
    const N = this.N;
    const dist = new Int16Array(N * N).fill(-1);
    const q = [sx + sy * N];
    dist[q[0]] = 0;
    for (let i = 0; i < q.length; i++) {
      const c = q[i], x = c % N, y = (c / N) | 0;
      for (let d = 0; d < 4; d++) {
        if (!this.passable(x, y, d)) continue;
        const n = (x + DIRS[d][0]) + (y + DIRS[d][1]) * N;
        if (dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); }
      }
    }
    return dist;
  }
  // returns a list of [x,z] waypoints from cell s to point (tx,tz)
  path(sx, sy, tx, tz) {
    const N = this.N;
    const [gx, gy] = this.cellAt(tx, tz);
    const prev = new Int16Array(N * N).fill(-1);
    const start = sx + sy * N, goal = gx + gy * N;
    prev[start] = start;
    const q = [start];
    for (let i = 0; i < q.length && prev[goal] < 0; i++) {
      const c = q[i], x = c % N, y = (c / N) | 0;
      for (let d = 0; d < 4; d++) {
        if (!this.passable(x, y, d)) continue;
        const n = (x + DIRS[d][0]) + (y + DIRS[d][1]) * N;
        if (prev[n] < 0) { prev[n] = c; q.push(n); }
      }
    }
    if (prev[goal] < 0) return [[tx, tz]];
    const cells = [];
    for (let c = goal; c !== start; c = prev[c]) cells.push(c);
    cells.push(start);
    cells.reverse();
    const pts = [];
    for (let i = 0; i < cells.length - 1; i++) {
      const a = cells[i], b = cells[i + 1];
      const ax = a % N, ay = (a / N) | 0, bx = b % N, by = (b / N) | 0;
      const d = DIRS.findIndex(([dx, dy]) => dx === bx - ax && dy === by - ay);
      const [mx, mz] = this.edgeMid(ax, ay, d);
      // approach the doorway head-on so nobody clips the frame
      pts.push([mx - DIRS[d][0] * 1.0, mz - DIRS[d][1] * 1.0]);
      pts.push([mx + DIRS[d][0] * 1.0, mz + DIRS[d][1] * 1.0]);
    }
    pts.push([tx, tz]);
    return pts;
  }

  // ---------- cells ----------
  makeCells() {
    const N = this.N;
    this.cells = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const faces = [];
      for (let d = 0; d < 4; d++) faces.push({ solid: this.edge(x, y, d) === 0, used: false, top: 0, outer: (d === 0 && y === 0) || (d === 2 && y === N - 1) || (d === 1 && x === N - 1) || (d === 3 && x === 0) });
      this.cells.push({ x, y, faces, corners: [false, false, false, false], hall: -1, theme: 'empty' });
    }
    this.halls.forEach((h, i) => {
      for (let yy = h.by; yy <= h.by + 1; yy++) for (let xx = h.bx; xx <= h.bx + 1; xx++) this.cells[yy * N + xx].hall = i;
    });
  }
  cell(x, y) { return this.cells[y * this.N + x]; }
  // local frame of a wall face: a = along wall, d = into room
  faceFrame(x, y, side) {
    const x0 = x * CELL, z0 = y * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const cx = x0 + CELL / 2, cz = z0 + CELL / 2, t = WALL_T / 2;
    const c = [[cx, z0 + t], [x1 - t, cz], [cx, z1 - t], [x0 + t, cz]][side];
    const rot = FACE_ROT[side];
    const ca = Math.cos(rot), sa = Math.sin(rot);
    return {
      rot,
      p: (a, d) => [c[0] + a * ca + d * sa, c[1] - a * sa + d * ca],
      m: (a, y0, d) => new THREE.Matrix4().makeRotationY(rot).setPosition(c[0] + a * ca + d * sa, y0, c[1] - a * sa + d * ca),
    };
  }
  cornerPos(x, y, k) {
    const off = PILLAR / 2 + 0.7;
    const x0 = x * CELL, z0 = y * CELL;
    return [[x0 + off, z0 + off], [x0 + CELL - off, z0 + off], [x0 + CELL - off, z0 + CELL - off], [x0 + off, z0 + CELL - off]][k];
  }

  // ---------- collision ----------
  addCollider(x0, z0, x1, z1, wall = false) {
    const c = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), wall };
    this.colliders.push(c);
    const N = this.N, m = 1.0;
    const cx0 = Math.max(0, Math.floor((c.x0 - m) / CELL)), cx1 = Math.min(N - 1, Math.floor((c.x1 + m) / CELL));
    const cz0 = Math.max(0, Math.floor((c.z0 - m) / CELL)), cz1 = Math.min(N - 1, Math.floor((c.z1 + m) / CELL));
    for (let yy = cz0; yy <= cz1; yy++) for (let xx = cx0; xx <= cx1; xx++) this.cellCol[yy * N + xx].push(c);
  }
  // push a circle out of everything; returns true if it hit something
  collide(p, r) {
    const [cx, cy] = this.cellAt(p.x, p.z);
    const list = this.cellCol[cy * this.N + cx];
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of list) {
        const nx = Math.max(c.x0, Math.min(p.x, c.x1));
        const nz = Math.max(c.z0, Math.min(p.z, c.z1));
        const dx = p.x - nx, dz = p.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          hit = true;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (r - d);
            p.z += (dz / d) * (r - d);
          } else {
            // centre inside box: push out along the shallowest axis
            const l = p.x - c.x0, rr = c.x1 - p.x, t = p.z - c.z0, b = c.z1 - p.z;
            const m = Math.min(l, rr, t, b);
            if (m === l) p.x = c.x0 - r; else if (m === rr) p.x = c.x1 + r; else if (m === t) p.z = c.z0 - r; else p.z = c.z1 + r;
          }
        }
      }
    }
    const S = this.size;
    p.x = Math.max(r, Math.min(S - r, p.x));
    p.z = Math.max(r, Math.min(S - r, p.z));
    return hit;
  }
  solidAt(x, z, wallsOnly = true) {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return true;
    const [cx, cy] = this.cellAt(x, z);
    for (const c of this.cellCol[cy * this.N + cx]) {
      if (wallsOnly && !c.wall) continue;
      if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return true;
    }
    return false;
  }
  lineOfSight(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.solidAt(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }
  // distance along a ray until it hits a wall (2D) — used for crossbow bolts
  rayWall(x, z, dx, dz, max = 60) {
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    for (let t = 0.1; t < max; t += 0.08) if (this.solidAt(x + dx * t, z + dz * t, false)) return t;
    return max;
  }

  // ---------- build ----------
  buildStructure() {
    const N = this.N, S = this.size, H = WALL_H;
    const B = this.B = {
      wall: new Bucket(3.0), floor: new Bucket(3.2), ceil: new Bucket(2.2), beam: new Bucket(1.5),
      wood: new Bucket(1.2), dark: new Bucket(1.4), iron: new Bucket(1), red: new Bucket(1.2), carpet: new Bucket(1.6),
      gold: new Bucket(0.5), books: new Bucket(2.4), jute: new Bucket(0.8), wax: new Bucket(0.3), web: new Bucket(1),
      black: new Bucket(1), stoneDark: new Bucket(1.2), paper: new Bucket(0.5), carrot: new Bucket(0.3), portrait: new Bucket(1),
    };
    // floor + ceiling
    B.floor.face([0, 0, S], [S, 0, 0], [0, 0, -S], [0, 1, 0]);
    B.ceil.face([0, H, 0], [S, 0, 0], [0, 0, S], [0, -1, 0]);
    // ceiling beams
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const [cx, cz] = this.center(x, y);
      for (const oz of [-CELL / 4, CELL / 4]) B.beam.box(x * CELL, H - 0.38, cz + oz - 0.16, (x + 1) * CELL, H, cz + oz + 0.16, { top: false, bottom: true });
    }
    // pillars at grid vertices
    const hp = PILLAR / 2;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const touching = [];
      if (i > 0) touching.push(this.h[j][i - 1]);
      if (i < N) touching.push(this.h[j][i]);
      if (j > 0) touching.push(this.v[j - 1][i]);
      if (j < N) touching.push(this.v[j][i]);
      const outer = i === 0 || j === 0 || i === N || j === N;
      if (!outer && touching.every((t) => t === 2)) continue;
      const px = i * CELL, pz = j * CELL;
      B.wall.box(px - hp, 0, pz - hp, px + hp, H, pz + hp);
      B.stoneDark.box(px - hp - 0.06, 0, pz - hp - 0.06, px + hp + 0.06, 0.35, pz + hp + 0.06);
      this.addCollider(px - hp, pz - hp, px + hp, pz + hp, true);
    }
    // wall segments
    const seg = (alongX, fixed, a0, a1, val) => {
      if (val === 2) return;
      const t = WALL_T / 2;
      const s0 = a0 + hp, s1 = a1 - hp;
      const add = (b0, b1, y0, y1, collide) => {
        if (alongX) {
          B.wall.box(b0, y0, fixed - t, b1, y1, fixed + t, { bottom: y0 > 0 });
          if (collide) this.addCollider(b0, fixed - t, b1, fixed + t, true);
        } else {
          B.wall.box(fixed - t, y0, b0, fixed + t, y1, b1, { bottom: y0 > 0 });
          if (collide) this.addCollider(fixed - t, b0, fixed + t, b1, true);
        }
      };
      const trim = (b0, b1) => {
        if (alongX) B.stoneDark.box(b0, 0, fixed - t - 0.05, b1, 0.22, fixed + t + 0.05);
        else B.stoneDark.box(fixed - t - 0.05, 0, b0, fixed + t + 0.05, 0.22, b1);
      };
      if (val === 0) { add(s0, s1, 0, H, true); trim(s0, s1); return; }
      const mid = (a0 + a1) / 2, g0 = mid - DOOR_W / 2, g1 = mid + DOOR_W / 2;
      add(s0, g0, 0, H, true); add(g1, s1, 0, H, true); add(g0, g1, DOOR_H, H, false);
      trim(s0, g0); trim(g1, s1);
      // timber door frame
      const ft = t + 0.07, pw = 0.16;
      if (alongX) {
        B.dark.box(g0, 0, fixed - ft, g0 + pw, DOOR_H, fixed + ft);
        B.dark.box(g1 - pw, 0, fixed - ft, g1, DOOR_H, fixed + ft);
        B.dark.box(g0, DOOR_H - 0.2, fixed - ft, g1, DOOR_H + 0.02, fixed + ft, { bottom: true });
        this.addCollider(g0, fixed - ft, g0 + pw, fixed + ft, true);
        this.addCollider(g1 - pw, fixed - ft, g1, fixed + ft, true);
      } else {
        B.dark.box(fixed - ft, 0, g0, fixed + ft, DOOR_H, g0 + pw);
        B.dark.box(fixed - ft, 0, g1 - pw, fixed + ft, DOOR_H, g1);
        B.dark.box(fixed - ft, DOOR_H - 0.2, g0, fixed + ft, DOOR_H + 0.02, g1, { bottom: true });
        this.addCollider(fixed - ft, g0, fixed + ft, g0 + pw, true);
        this.addCollider(fixed - ft, g1 - pw, fixed + ft, g1, true);
      }
    };
    for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) seg(true, j * CELL, i * CELL, (i + 1) * CELL, this.h[j][i]);
    for (let j = 0; j < N; j++) for (let i = 0; i <= N; i++) seg(false, i * CELL, j * CELL, (j + 1) * CELL, this.v[j][i]);
  }

  // ---------- decoration ----------
  decorate() {
    const rng = this.rng, B = this.B;
    const themes = [['library', 14], ['dining', 9], ['bedroom', 11], ['chapel', 7], ['storage', 15], ['fireplace', 11], ['study', 8], ['dungeon', 7], ['empty', 18]];
    const totalW = themes.reduce((s, t) => s + t[1], 0);
    const pickTheme = () => {
      let r = rng.next() * totalW;
      for (const [t, w] of themes) { if ((r -= w) < 0) return t; }
      return 'empty';
    };
    this.webTex = webTexture();
    // keep about a third of the bare walls free: secret doors can open there later
    for (const c of this.cells) for (const f of c.faces) if (f.solid && rng.chance(0.34)) { f.reserved = true; f.used = true; }
    for (const c of this.cells) {
      c.theme = c.hall >= 0 ? 'hall' : pickTheme();
      const free = () => rng.shuffle([0, 1, 2, 3].filter((s) => c.faces[s].solid && !c.faces[s].used));
      const use = (s, top) => { c.faces[s].used = true; c.faces[s].top = top; };
      const F = (s) => this.faceFrame(c.x, c.y, s);
      switch (c.theme) {
        case 'library': for (const s of free().slice(0, 3)) { this.bookshelf(F(s)); use(s, 2.7); } break;
        case 'dining': { const f = free(); if (f[0] !== undefined) { this.table(F(f[0]), true); use(f[0], 1.0); } if (f[1] !== undefined) { this.cabinet(F(f[1])); use(f[1], 1.9); } break; }
        case 'bedroom': { const f = free(); if (f[0] !== undefined) { this.bed(F(f[0])); use(f[0], 1.2); } if (f[1] !== undefined) { this.wardrobe(F(f[1])); use(f[1], 2.3); } break; }
        case 'chapel': { const f = free(); if (f[0] !== undefined) { this.altar(F(f[0])); use(f[0], 1.2); } for (const s of f.slice(1, 3)) { this.bench(F(s)); use(s, 0.9); } break; }
        case 'storage': for (const s of free().slice(0, rng.int(2, 3))) { this.crates(F(s)); use(s, 1.6); } break;
        case 'fireplace': { const f = free(); if (f[0] !== undefined) { this.fireplace(F(f[0])); use(f[0], 2.2); } if (f[1] !== undefined && rng.chance(0.6)) { this.crates(F(f[1])); use(f[1], 1.6); } break; }
        case 'study': { const f = free(); if (f[0] !== undefined) { this.lectern(F(f[0])); use(f[0], 1.3); } if (f[1] !== undefined) { this.bookshelf(F(f[1])); use(f[1], 2.7); } break; }
        case 'dungeon': { const f = free(); if (f[0] !== undefined) { this.cage(F(f[0])); use(f[0], 3); } if (f[1] !== undefined) { this.chains(F(f[1])); use(f[1], 0.4); } break; }
        case 'hall': break;
        default: if (rng.chance(0.4)) { const f = free(); if (f[0] !== undefined) { this.crates(F(f[0])); use(f[0], 1.6); } }
      }
      // wall dressing above low furniture / on bare walls
      for (let s = 0; s < 4; s++) {
        const face = c.faces[s];
        if (!face.solid || face.top > 1.35 || face.deco || face.reserved) continue;
        if (face.outer && rng.chance(0.3)) { this.window(F(s)); face.deco = 'window'; face.used = true; continue; }
        const r = rng.next();
        if (r < 0.3) { this.torch(F(s)); face.deco = 'torch'; }
        else if (r < 0.4) { this.portrait(F(s)); face.deco = 'portrait'; }
        else if (r < 0.52 || (c.theme === 'hall' && r < 0.75)) { this.banner(F(s)); face.deco = 'banner'; }
      }
      if (rng.chance(0.55)) this.cobweb(c, rng.int(0, 3));
      if (rng.chance(0.25)) this.cobweb(c, rng.int(0, 3));
      if (rng.chance(0.18)) this.pepernoten(c);
    }
    for (const h of this.halls) this.hallCentre(h);
  }

  // ---- prefabs (local coords: a along wall, d into room, y up) ----
  lbox(F, bucket, a0, a1, y0, y1, d0, d1, collide = false, opt) {
    const [xa, za] = F.p(a0, d0), [xb, zb] = F.p(a1, d1);
    this.B[bucket].box(Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb), opt);
    if (collide) this.addCollider(xa, za, xb, zb, false);
  }
  lgeo(F, bucket, geo, a, y, d, rx = 0, ry = 0, rz = 0) {
    const m = F.m(a, y, d).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    geo.applyMatrix4(m);
    this.B[bucket].geo(geo);
  }
  candle(F, a, y, d, h = 0.18) {
    this.lgeo(F, 'wax', new THREE.CylinderGeometry(0.025, 0.028, h, 6), a, y + h / 2, d);
    const [x, z] = F.p(a, d);
    (this.candles ||= []).push(x, y + h + 0.04, z);
  }
  bookshelf(F) {
    const r = this.rng;
    const w = r.range(1.6, 2.2), a = r.range(-0.4, 0.4);
    this.lbox(F, 'wood', a - w / 2, a + w / 2, 0, 2.7, 0, 0.45, true);
    this.lbox(F, 'books', a - w / 2 + 0.06, a + w / 2 - 0.06, 0.12, 2.55, 0.45, 0.47);
    if (r.chance(0.4)) this.candle(F, a + r.range(-0.6, 0.6), 2.7, 0.25);
  }
  table(F, chairs) {
    const r = this.rng;
    const w = r.range(2.2, 3.4);
    this.lbox(F, 'wood', -w / 2, w / 2, 0.76, 0.84, 0.25, 1.2, true);
    for (const a of [-w / 2 + 0.1, w / 2 - 0.18]) for (const d of [0.3, 1.08]) this.lbox(F, 'dark', a, a + 0.08, 0, 0.76, d, d + 0.08);
    for (let i = 0; i < 3; i++) this.candle(F, r.range(-w / 2 + 0.3, w / 2 - 0.3), 0.84, r.range(0.5, 0.95), r.range(0.08, 0.25));
    for (let i = 0; i < 4; i++) this.lgeo(F, 'iron', new THREE.CylinderGeometry(0.12, 0.09, 0.03, 10), r.range(-w / 2 + 0.3, w / 2 - 0.3), 0.855, r.range(0.4, 1.0));
    if (chairs) for (const a of [-w / 3, 0, w / 3]) if (r.chance(0.7)) {
      this.lbox(F, 'dark', a - 0.22, a + 0.22, 0.45, 0.5, 1.25, 1.65);
      this.lbox(F, 'dark', a - 0.22, a + 0.22, 0.5, 1.15, 1.6, 1.66);
      this.lbox(F, 'dark', a - 0.2, a - 0.15, 0, 0.45, 1.27, 1.32); this.lbox(F, 'dark', a + 0.15, a + 0.2, 0, 0.45, 1.27, 1.32);
    }
    this.lights.push({ ...this.anchor(F, 0, 1.3, 0.8), color: 0xffa050, power: 5, range: 6, flicker: 0.35 });
  }
  cabinet(F) {
    const a = this.rng.range(-1, 1);
    this.lbox(F, 'dark', a - 0.7, a + 0.7, 0, 1.9, 0, 0.5, true);
    this.lbox(F, 'wood', a - 0.66, a - 0.02, 0.1, 1.8, 0.5, 0.52);
    this.lbox(F, 'wood', a + 0.02, a + 0.66, 0.1, 1.8, 0.5, 0.52);
  }
  bed(F) {
    const r = this.rng, a = r.range(-0.6, 0.6);
    this.lbox(F, 'dark', a - 1.05, a + 1.05, 0.2, 0.5, 0.05, 1.05, true);
    this.lbox(F, 'paper', a - 1.0, a + 1.0, 0.5, 0.68, 0.08, 1.02);
    this.lbox(F, 'red', a - 0.4, a + 1.02, 0.6, 0.72, 0.06, 1.04);
    this.lbox(F, 'paper', a - 0.98, a - 0.6, 0.66, 0.8, 0.2, 0.9);
    for (const aa of [a - 1.05, a + 0.97]) for (const d of [0.05, 0.97]) this.lbox(F, 'dark', aa, aa + 0.08, 0, 2.4, d, d + 0.08);
    this.lbox(F, 'red', a - 1.05, a + 1.05, 2.3, 2.42, 0.05, 1.05, false, { bottom: true });
  }
  wardrobe(F) {
    const a = this.rng.range(-1.2, 1.2);
    this.lbox(F, 'dark', a - 0.65, a + 0.65, 0, 2.3, 0, 0.62, true);
    this.lbox(F, 'wood', a - 0.6, a - 0.02, 0.1, 2.2, 0.62, 0.64);
    this.lbox(F, 'wood', a + 0.02, a + 0.6, 0.1, 2.2, 0.62, 0.64);
    this.lbox(F, 'iron', a - 0.08, a - 0.04, 1.1, 1.3, 0.64, 0.67);
    this.lbox(F, 'iron', a + 0.04, a + 0.08, 1.1, 1.3, 0.64, 0.67);
  }
  altar(F) {
    const r = this.rng;
    this.lbox(F, 'stoneDark', -1.1, 1.1, 0, 1.0, 0.15, 1.0, true);
    this.lbox(F, 'red', -1.15, 1.15, 0.6, 1.03, 0.12, 1.04);
    this.lbox(F, 'gold', -0.06, 0.06, 1.03, 1.8, 0.3, 0.36);
    this.lbox(F, 'gold', -0.3, 0.3, 1.5, 1.58, 0.3, 0.36);
    for (let i = 0; i < 9; i++) this.candle(F, r.range(-1, 1), 1.03, r.range(0.25, 0.95), r.range(0.06, 0.35));
    this.lights.push({ ...this.anchor(F, 0, 1.6, 0.8), color: 0xffb060, power: 7, range: 7, flicker: 0.3 });
  }
  bench(F) {
    const a = this.rng.range(-0.5, 0.5);
    this.lbox(F, 'wood', a - 1.1, a + 1.1, 0.42, 0.5, 0.15, 0.6, true);
    this.lbox(F, 'wood', a - 1.1, a + 1.1, 0.5, 0.95, 0.12, 0.18);
    for (const aa of [a - 1.0, a + 0.92]) this.lbox(F, 'dark', aa, aa + 0.08, 0, 0.42, 0.2, 0.55);
  }
  crates(F) {
    const r = this.rng;
    let a = r.range(-1.9, -1.5);
    while (a < 1.3) {
      const k = r.next();
      if (k < 0.4) {
        const s = r.range(0.6, 0.95);
        if (a + s > 1.9) break;
        this.lbox(F, 'wood', a, a + s, 0, s, 0.05, 0.05 + s, true);
        if (r.chance(0.35)) { const s2 = s * 0.7; this.lbox(F, 'wood', a + 0.1, a + 0.1 + s2, s, s + s2, 0.1, 0.1 + s2); }
        a += s + r.range(0.05, 0.3);
      } else if (k < 0.7) {
        const rad = 0.32;
        if (a + 2 * rad > 1.9) break;
        const g = new THREE.CylinderGeometry(rad, rad * 0.9, 0.95, 12);
        this.lgeo(F, 'dark', g, a + rad, 0.475, 0.05 + rad);
        this.lgeo(F, 'iron', new THREE.CylinderGeometry(rad + 0.01, rad + 0.01, 0.05, 12), a + rad, 0.2, 0.05 + rad);
        this.lgeo(F, 'iron', new THREE.CylinderGeometry(rad + 0.01, rad + 0.01, 0.05, 12), a + rad, 0.75, 0.05 + rad);
        this.addColliderLocal(F, a, a + 2 * rad, 0.05, 0.05 + 2 * rad);
        a += 2 * rad + r.range(0.05, 0.2);
      } else {
        // Sinterklaas' jute sacks — lumpy, ominous
        if (a + 0.8 > 1.9) break;
        const g = new THREE.SphereGeometry(0.4, 10, 8);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          const s = 1 + Math.sin(p.getX(i) * 9 + p.getZ(i) * 7) * 0.12;
          p.setXYZ(i, p.getX(i) * s, y < 0 ? y * 0.5 : y * 1.5, p.getZ(i) * s);
        }
        g.computeVertexNormals();
        this.lgeo(F, 'jute', g, a + 0.4, 0.2, 0.45);
        this.lgeo(F, 'jute', new THREE.CylinderGeometry(0.05, 0.12, 0.2, 8), a + 0.4, 0.85, 0.45);
        this.addColliderLocal(F, a + 0.05, a + 0.75, 0.1, 0.8);
        a += 0.85;
      }
    }
  }
  addColliderLocal(F, a0, a1, d0, d1) {
    const [xa, za] = F.p(a0, d0), [xb, zb] = F.p(a1, d1);
    this.addCollider(xa, za, xb, zb, false);
  }
  fireplace(F) {
    const r = this.rng;
    this.lbox(F, 'wall', -1.3, -0.8, 0, 1.9, 0, 0.7, true);
    this.lbox(F, 'wall', 0.8, 1.3, 0, 1.9, 0, 0.7, true);
    this.lbox(F, 'stoneDark', -1.45, 1.45, 1.9, 2.15, 0, 0.82);
    this.lbox(F, 'black', -0.8, 0.8, 0, 1.9, 0, 0.12);
    this.lbox(F, 'stoneDark', -0.8, 0.8, 0, 0.12, 0.12, 0.7);
    this.addColliderLocal(F, -0.8, 0.8, 0, 0.7);
    // smouldering logs
    for (let i = 0; i < 3; i++) this.lgeo(F, 'black', new THREE.CylinderGeometry(0.07, 0.08, 0.9, 6), r.range(-0.2, 0.2), 0.2 + i * 0.07, 0.35 + r.range(-0.1, 0.1), 0, 0, Math.PI / 2 + r.range(-0.3, 0.3));
    const [ex, ez] = F.p(0, 0.38);
    (this.embers ||= []).push([ex, 0.25, ez]);
    this.lights.push({ ...this.anchor(F, 0, 0.6, 0.9), color: 0xff4810, power: 9, range: 7, flicker: 0.6 });
    // the shoes left out for Sinterklaas. Children's clogs, each with a carrot for his horse.
    const n = r.int(4, 7);
    for (let i = 0; i < n; i++) {
      const a = -1.2 + (2.4 * i) / (n - 1) + r.range(-0.05, 0.05);
      for (const side of [-0.07, 0.07]) {
        const g = new THREE.BoxGeometry(0.1, 0.09, 0.26);
        this.lgeo(F, 'wood', g, a + side, 0.045, 1.05, 0, r.range(-0.2, 0.2), 0);
      }
      if (r.chance(0.7)) this.lgeo(F, 'carrot', new THREE.ConeGeometry(0.025, 0.2, 6), a, 0.13, 1.05, Math.PI / 2 + 0.4, 0, 0);
    }
    if (r.chance(0.7)) this.portrait(F, 2.35);
  }
  lectern(F) {
    this.lbox(F, 'dark', -0.18, 0.18, 0, 1.05, 0.55, 0.85, true);
    this.lbox(F, 'dark', -0.4, 0.4, 0, 0.08, 0.45, 0.95);
    // Het Grote Boek — the book with every child's name in it
    this.lgeo(F, 'red', new THREE.BoxGeometry(0.42, 0.06, 0.6), -0.22, 1.12, 0.7, 0, 0, 0.18);
    this.lgeo(F, 'red', new THREE.BoxGeometry(0.42, 0.06, 0.6), 0.22, 1.12, 0.7, 0, 0, -0.18);
    this.lgeo(F, 'paper', new THREE.BoxGeometry(0.38, 0.05, 0.55), -0.2, 1.16, 0.7, 0, 0, 0.18);
    this.lgeo(F, 'paper', new THREE.BoxGeometry(0.38, 0.05, 0.55), 0.2, 1.16, 0.7, 0, 0, -0.18);
    this.lgeo(F, 'gold', new THREE.BoxGeometry(0.05, 0.07, 0.62), 0, 1.12, 0.7);
    this.candle(F, 0.6, 0, 0.7, 0.9);
    this.lights.push({ ...this.anchor(F, 0.6, 1.2, 0.7), color: 0xffa860, power: 3, range: 5, flicker: 0.4 });
  }
  cage(F) {
    const r = this.rng, a = r.range(-1, 1);
    const top = r.range(2.2, 2.8);
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2;
      this.lgeo(F, 'iron', new THREE.CylinderGeometry(0.015, 0.015, 1.7, 4), a + Math.cos(t) * 0.5, top - 0.85, 0.75 + Math.sin(t) * 0.5);
    }
    this.lgeo(F, 'iron', new THREE.TorusGeometry(0.5, 0.025, 4, 16), a, top, 0.75, Math.PI / 2);
    this.lgeo(F, 'iron', new THREE.TorusGeometry(0.5, 0.025, 4, 16), a, top - 1.7, 0.75, Math.PI / 2);
    this.lgeo(F, 'iron', new THREE.CylinderGeometry(0.01, 0.01, WALL_H - top, 4), a, (WALL_H + top) / 2, 0.75);
    this.addColliderLocal(F, a - 0.55, a + 0.55, 0.2, 1.3);
    if (r.chance(0.6)) {
      const g = new THREE.SphereGeometry(0.11, 8, 6); g.scale(1, 1.15, 1.1);
      this.lgeo(F, 'paper', g, a + 0.1, top - 1.6, 0.8);
    }
  }
  chains(F) {
    const r = this.rng;
    for (let i = 0; i < 3; i++) {
      const a = r.range(-1.8, 1.8), len = r.range(0.8, 1.8);
      for (let k = 0; k < len / 0.09; k++) this.lgeo(F, 'iron', new THREE.TorusGeometry(0.035, 0.01, 4, 6), a, 3.2 - k * 0.09, 0.08, 0, (k % 2) * Math.PI / 2, Math.PI / 2);
      this.lgeo(F, 'iron', new THREE.TorusGeometry(0.07, 0.015, 4, 10), a, 3.2 - len - 0.06, 0.08, 0, 0, 0);
    }
    this.lbox(F, 'black', -2, 2, 0, 0.01, 0.0, 0.9);
  }
  anchor(F, a, y, d) { const [x, z] = F.p(a, d); return { x, y, z }; }
  torch(F) {
    this.lbox(F, 'iron', -0.06, 0.06, 1.95, 2.25, 0, 0.12);
    this.lgeo(F, 'dark', new THREE.CylinderGeometry(0.035, 0.025, 0.5, 6), 0, 2.2, 0.2, 0.5, 0, 0);
    this.lgeo(F, 'iron', new THREE.CylinderGeometry(0.07, 0.05, 0.1, 8), 0, 2.42, 0.3);
    const p = this.anchor(F, 0, 2.62, 0.31);
    const lit = this.rng.chance(0.8);
    this.flames.push({ ...p, lit, scale: 0.5 });
    if (lit) this.lights.push({ ...this.anchor(F, 0, 2.6, 0.55), color: 0xff8a3a, power: 10, range: 9, flicker: 0.45 });
  }
  banner(F) {
    const a = this.rng.range(-1.2, 1.2);
    this.lbox(F, 'red', a - 0.45, a + 0.45, 1.2, 3.5, 0, 0.03);
    this.lbox(F, 'gold', a - 0.45, a + 0.45, 1.2, 1.28, 0.03, 0.04);
    this.lbox(F, 'gold', a - 0.06, a + 0.06, 1.7, 3.1, 0.03, 0.04);
    this.lbox(F, 'gold', a - 0.25, a + 0.25, 2.55, 2.65, 0.03, 0.04);
    this.lbox(F, 'iron', a - 0.55, a + 0.55, 3.48, 3.54, 0.0, 0.07);
  }
  portrait(F, y = 1.5) {
    const a = this.rng.range(-1.4, 1.4);
    this.lbox(F, 'gold', a - 0.5, a + 0.5, y, y + 1.25, 0, 0.06);
    const g = new THREE.PlaneGeometry(0.84, 1.08);
    this.lgeo(F, 'portrait', g, a, y + 0.625, 0.065);
  }
  window(F) {
    // tall barred window to the night outside; lightning shows through it
    this.lbox(F, 'stoneDark', -0.75, 0.75, 1.15, 1.3, 0, 0.3);
    const g = new THREE.PlaneGeometry(1.1, 2.1);
    const m = F.m(0, 2.3, 0.02);
    g.applyMatrix4(m);
    this.windows.push(g);
    for (let i = -2; i <= 2; i++) this.lbox(F, 'iron', i * 0.22 - 0.02, i * 0.22 + 0.02, 1.25, 3.35, 0.03, 0.07);
    for (const y of [1.9, 2.7]) this.lbox(F, 'iron', -0.55, 0.55, y, y + 0.04, 0.03, 0.07);
    this.lights.push({ ...this.anchor(F, 0, 2.3, 0.8), color: 0x6a88c0, power: 1.4, range: 6, flicker: 0, moon: true });
  }
  cobweb(c, k) {
    const x0 = c.x * CELL + PILLAR / 2 - 0.05, z0 = c.y * CELL + PILLAR / 2 - 0.05;
    const x1 = (c.x + 1) * CELL - PILLAR / 2 + 0.05, z1 = (c.y + 1) * CELL - PILLAR / 2 + 0.05;
    const corners = [[x0, z0, 1, 1], [x1, z0, -1, 1], [x1, z1, -1, -1], [x0, z1, 1, -1]];
    const [x, z, sx, sz] = corners[k];
    const s = this.rng.range(0.9, 1.6);
    const g = new THREE.BufferGeometry();
    const y = WALL_H - 0.05;
    const pA = [x, y, z], pB = [x + sx * s, y, z], pC = [x, y - s, z], pD = [x, y, z + sz * s];
    // two quarter-fans: one hugging each wall, one across the corner
    const pos = [...pA, ...pB, ...pD, ...pA, ...pC, ...pB, ...pA, ...pD, ...pC];
    const uv = [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    this.B.web.extra.push(g);
  }
  pepernoten(c) {
    const r = this.rng;
    const [cx, cz] = this.center(c.x, c.y);
    const px = cx + r.range(-2, 2), pz = cz + r.range(-2, 2);
    for (let i = 0; i < 14; i++) {
      const g = new THREE.SphereGeometry(0.02, 5, 4); g.scale(1, 0.6, 1);
      g.translate(px + r.range(-0.5, 0.5), 0.012, pz + r.range(-0.5, 0.5));
      this.B.carrot.geo(g);
    }
  }
  hallCentre(h) {
    const x = (h.bx + 1) * CELL, z = (h.by + 1) * CELL;
    const g = new THREE.CylinderGeometry(0.55, 0.6, WALL_H, 14);
    g.translate(x, WALL_H / 2, z);
    this.B.wall.geo(g);
    const b = new THREE.CylinderGeometry(0.8, 0.85, 0.4, 14); b.translate(x, 0.2, z); this.B.stoneDark.geo(b);
    this.addCollider(x - 0.62, z - 0.62, x + 0.62, z + 0.62, true);
    // carpet runners
    this.B.carpet.box(x - CELL + 1.2, 0, z - 0.8, x + CELL - 1.2, 0.012, z + 0.8);
    // chandeliers
    for (const [ox, oz] of [[-CELL / 2, -CELL / 2], [CELL / 2, CELL / 2]]) {
      const cx = x + ox, cz = z + oz, y = 3.1;
      const ring = new THREE.TorusGeometry(0.7, 0.03, 4, 20); ring.rotateX(Math.PI / 2); ring.translate(cx, y, cz); this.B.iron.geo(ring);
      const rod = new THREE.CylinderGeometry(0.015, 0.015, WALL_H - y, 4); rod.translate(cx, (WALL_H + y) / 2, cz); this.B.iron.geo(rod);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const cg = new THREE.CylinderGeometry(0.025, 0.025, 0.14, 6); cg.translate(cx + Math.cos(a) * 0.7, y + 0.09, cz + Math.sin(a) * 0.7); this.B.wax.geo(cg);
        if (this.rng.chance(0.7)) (this.candles ||= []).push(cx + Math.cos(a) * 0.7, y + 0.2, cz + Math.sin(a) * 0.7);
      }
      this.lights.push({ x: cx, y: y - 0.2, z: cz, color: 0xffa860, power: 8, range: 9, flicker: 0.25 });
    }
  }

  // ---------- spawns ----------
  planSpawns() {
    const rng = this.rng, N = this.N;
    const corners = [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]];
    const sp = rng.pick(corners);
    this.spawnCell = sp;
    this.spawnDist = this.bfs(sp[0], sp[1]);
    const [sx, sz] = this.center(sp[0], sp[1]);
    this.spawnPos = [sx, sz];
    // face the open doorway
    let yaw = 0;
    for (let d = 0; d < 4; d++) if (this.passable(sp[0], sp[1], d)) { yaw = Math.atan2(-DIRS[d][0], -DIRS[d][1]); break; }
    this.spawnYaw = yaw;
    // Sinterklaas starts as far away as possible
    let far = 0, fc = 0;
    this.spawnDist.forEach((d, i) => { if (d > far) { far = d; fc = i; } });
    this.santaCell = [fc % N, (fc / N) | 0];

    const takeCorner = (c) => {
      const free = [0, 1, 2, 3].filter((k) => !c.corners[k]);
      if (!free.length) return null;
      const k = rng.pick(free);
      c.corners[k] = true;
      return this.cornerPos(c.x, c.y, k);
    };
    // weapon parts: far from spawn and from each other
    const cand = this.cells.filter((c) => this.spawnDist[c.y * N + c.x] >= 4);
    this.partSpots = [];
    const chosen = [];
    for (let i = 0; i < 4; i++) {
      let best = null, bestScore = -1;
      for (let t = 0; t < 40; t++) {
        const c = rng.pick(cand);
        if (chosen.includes(c)) continue;
        let md = 99;
        for (const o of chosen) md = Math.min(md, Math.abs(o.x - c.x) + Math.abs(o.y - c.y));
        const deadEnd = [0, 1, 2, 3].filter((d) => this.passable(c.x, c.y, d)).length === 1 ? 2 : 0;
        const score = md + deadEnd + rng.next();
        if (score > bestScore) { bestScore = score; best = c; }
      }
      chosen.push(best);
      const p = takeCorner(best);
      this.partSpots.push({ x: p[0], z: p[1], cell: [best.x, best.y] });
      this.pedestal(p[0], p[1]);
    }
    // batteries
    this.batterySpots = [];
    const bc = rng.shuffle(this.cells.filter((c) => this.spawnDist[c.y * N + c.x] >= 1 && !chosen.includes(c)));
    for (const c of bc.slice(0, 13)) { const p = takeCorner(c); if (p) this.batterySpots.push({ x: p[0], z: p[1] }); }
    // soot helpers
    this.elfSpots = [];
    const ec = rng.shuffle(this.cells.filter((c) => this.spawnDist[c.y * N + c.x] >= 3));
    for (const c of ec.slice(0, 10)) {
      const p = rng.chance(0.5) ? takeCorner(c) : null;
      const [cx, cz] = this.center(c.x, c.y);
      this.elfSpots.push(p ? { x: p[0], z: p[1] } : { x: cx + rng.range(-1, 1), z: cz + rng.range(-1, 1) });
    }
    // possible secret-door spots: bare solid wall faces
    this.doorFaces = [];
    for (const c of this.cells) for (let s = 0; s < 4; s++) {
      const f = c.faces[s];
      if (f.solid && (f.reserved || (!f.used && !f.deco))) this.doorFaces.push({ x: c.x, y: c.y, side: s });
    }
  }
  pedestal(x, z) {
    this.B.stoneDark.box(x - 0.28, 0, z - 0.28, x + 0.28, 0.85, z + 0.28);
    this.B.wall.box(x - 0.34, 0.85, z - 0.34, x + 0.34, 0.93, z + 0.34, { bottom: true });
    this.addCollider(x - 0.3, z - 0.3, x + 0.3, z + 0.3, false);
    this.candles ||= [];
    this.candles.push(x + 0.22, 1.1, z + 0.22);
    this.B.wax.box(x + 0.2, 0.93, z + 0.2, x + 0.24, 1.06, z + 0.24);
  }

  // ---------- materials & meshes ----------
  finalize() {
    const T = this.T;
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
    const mats = {
      wall: std({ map: T.wall.map, normalMap: T.wall.normal, normalScale: new THREE.Vector2(1.4, 1.4) }),
      floor: std({ map: T.floor.map, normalMap: T.floor.normal, roughnessMap: T.floor.rough, roughness: 1, metalness: 0.05 }),
      ceil: std({ map: T.darkWood.map, color: 0x6a5a4a }),
      beam: std({ map: T.darkWood.map, normalMap: T.darkWood.normal, color: 0x8a7868 }),
      wood: std({ map: T.wood.map, normalMap: T.wood.normal, roughness: 0.8 }),
      dark: std({ map: T.darkWood.map, normalMap: T.darkWood.normal, roughness: 0.75 }),
      iron: std({ color: 0x2b2a2a, roughness: 0.55, metalness: 0.7 }),
      red: std({ map: T.red.map, normalMap: T.red.normal, roughness: 0.95 }),
      carpet: std({ map: T.carpet.map, normalMap: T.carpet.normal, roughness: 1 }),
      gold: std({ map: T.gold.map, color: 0xc8a050, roughness: 0.4, metalness: 0.85 }),
      books: std({ map: T.books.map, roughness: 0.85 }),
      jute: std({ map: T.wood.map, color: 0xb89a70, roughness: 1 }),
      wax: std({ color: 0xd8cdb0, emissive: 0x3a2a10, roughness: 0.6 }),
      web: new THREE.MeshBasicMaterial({ map: this.webTex, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, color: 0x8a8a8a }),
      black: std({ color: 0x050505, roughness: 1 }),
      stoneDark: std({ map: T.wall.map, normalMap: T.wall.normal, color: 0x6a6460 }),
      paper: std({ color: 0xb8ad95, roughness: 0.95 }),
      carrot: std({ color: 0x8a3a10, roughness: 0.8 }),
      portrait: std({ map: T.portrait, roughness: 0.6, color: 0x8a8080 }),
    };
    this.mats = mats;
    for (const [k, b] of Object.entries(this.B)) {
      const g = b.build();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mats[k]);
      mesh.receiveShadow = k !== 'web';
      mesh.castShadow = !['wall', 'floor', 'ceil', 'beam', 'web', 'carpet'].includes(k);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    // night windows
    if (this.windows.length) {
      this.windowMat = new THREE.MeshBasicMaterial({ color: 0x0c1220, fog: false });
      const wm = new THREE.Mesh(mergeGeometries(this.windows), this.windowMat);
      this.group.add(wm);
    }
    // flames
    this.flameMat = new THREE.SpriteMaterial({ map: T.flame, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0xffd0a0 });
    for (const f of this.flames) {
      if (!f.lit) continue;
      const s = new THREE.Sprite(this.flameMat);
      s.position.set(f.x, f.y, f.z);
      s.scale.set(0.28, 0.45, 1);
      f.sprite = s;
      this.group.add(s);
    }
    if (this.candles?.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.candles, 3));
      this.candlePts = new THREE.Points(g, new THREE.PointsMaterial({ map: T.flame, size: 0.13, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffc080, fog: false }));
      this.group.add(this.candlePts);
    }
    if (this.embers?.length) {
      for (const [x, y, z] of this.embers) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: 0xff4010, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.7 }));
        s.position.set(x, y, z); s.scale.set(1.4, 0.6, 1);
        this.group.add(s);
        this.flames.push({ x, y, z, lit: true, sprite: s, ember: true });
      }
    }
  }

  // world-space info for a secret door on a wall face
  doorPlacement(f) {
    const F = this.faceFrame(f.x, f.y, f.side);
    const [x, z] = F.p(0, 0);
    return { x, z, rot: F.rot, F };
  }

  update(t) {
    for (const f of this.flames) {
      if (!f.sprite) continue;
      const k = 1 + Math.sin(t * 13 + f.x * 3) * 0.08 + Math.sin(t * 23 + f.z) * 0.06;
      if (f.ember) f.sprite.material.opacity = 0.55 + Math.sin(t * 2.3 + f.x) * 0.15 + Math.random() * 0.05;
      else f.sprite.scale.set(0.28 * k, 0.45 * (2 - k), 1);
    }
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); });
    for (const m of Object.values(this.mats || {})) m.dispose();
  }
}
