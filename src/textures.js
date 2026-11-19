// Every texture in the game is painted here at load time — no image files needed.
import * as THREE from 'three';
import { makeRng } from './rng.js';

let maxAniso = 4;
export function setAnisotropy(n) { maxAniso = n; }

export function noiseSet(seed, periods) {
  const rng = makeRng(seed);
  return periods.map((period) => {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rng.next();
    return { period, g };
  });
}
export function vnoise(n, x, y) {
  const p = n.period, g = n.g;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % p) + p) % p, x1 = (x0 + 1) % p;
  const y0 = ((yi % p) + p) % p, y1 = (y0 + 1) % p;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = g[y0 * p + x0], b = g[y0 * p + x1], c = g[y1 * p + x0], d = g[y1 * p + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// Tileable fractal noise; (x, y) in [0,1)
export function fbm(set, x, y, sx = 1, sy = 1) {
  let sum = 0, amp = 1, tot = 0;
  for (const n of set) {
    sum += amp * vnoise(n, x * n.period * sx, y * n.period * sy);
    tot += amp;
    amp *= 0.55;
  }
  return sum / tot;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finish(c, color = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function normalFromHeight(h, size, strength, height = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, height);
  const d = img.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < size; x++) {
      const xl = h[y * size + ((x - 1 + size) % size)];
      const xr = h[y * size + ((x + 1) % size)];
      const yu = h[((y - 1 + height) % height) * size + x];
      const yd = h[((y + 1) % height) * size + x];
      let nx = -(xr - xl) * strength, ny = (yd - yu) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, false);
}

// Irregular stone blocks: used for walls (big blocks) and floor (flagstones).
function stoneBlocks({ size, seed, rows, minPer, maxPer, mortar, base, mortarCol, stain, wet }) {
  const rng = makeRng(seed);
  const N = noiseSet(seed + 1, [4, 8, 16, 32, 64]);
  const N2 = noiseSet(seed + 2, [2, 4, 8]);
  // courses of varying height
  const rw = Array.from({ length: rows }, () => rng.range(0.75, 1.3));
  const rwSum = rw.reduce((a, b) => a + b, 0);
  const rowStart = [];
  { let acc = 0; for (let r = 0; r < rows; r++) { rowStart.push(acc); acc += (rw[r] / rwSum) * size; } }
  const rowOf = new Int16Array(size);
  for (let y = 0; y < size; y++) { let r = rows - 1; for (let k = 1; k < rows; k++) if (y < rowStart[k]) { r = k - 1; break; } rowOf[y] = r; }
  const rowsDef = [];
  for (let r = 0; r < rows; r++) {
    const count = rng.int(minPer, maxPer);
    const w = [];
    let tot = 0;
    for (let i = 0; i < count; i++) { const v = rng.range(0.7, 1.3); w.push(v); tot += v; }
    const off = rng.range(0, size);
    const starts = [];
    let acc = 0;
    for (let i = 0; i < count; i++) { starts.push(acc); acc += (w[i] / tot) * size; }
    const tints = w.map(() => [rng.range(-16, 16), rng.range(0.72, 1.15), rng.range(-6, 6)]);
    rowsDef.push({ off, starts, tints, count });
  }
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const h = new Float32Array(size * size);
  const rough = wet ? new Uint8ClampedArray(size * size) : null;
  for (let y = 0; y < size; y++) {
    const r = rowOf[y];
    const row = rowsDef[r];
    const rh = (r + 1 < rows ? rowStart[r + 1] : size) - rowStart[r];
    const yIn = y - rowStart[r];
    const ey = Math.min(yIn, rh - yIn);
    for (let x = 0; x < size; x++) {
      // which brick
      const local = (((x - row.off) % size) + size) % size;
      let bi = row.count - 1;
      for (let i = 1; i < row.count; i++) if (local < row.starts[i]) { bi = i - 1; break; }
      const s0 = row.starts[bi], s1 = bi + 1 < row.count ? row.starts[bi + 1] : size;
      const ex = Math.min(local - s0, s1 - local);
      const u = x / size, v = y / size;
      const n = fbm(N, u, v);
      const big = fbm(N2, u, v);
      const edge = Math.min(ex, ey);
      const jag = (n - 0.5) * 11 + (vnoise(N[3], u * 32 * 3, v * 32 * 3) - 0.5) * 5;
      const e = edge + jag;
      let height, col;
      const i4 = (y * size + x) * 4;
      if (e < mortar) {
        height = 0.05 + n * 0.1;
        col = [mortarCol[0] * (0.7 + n * 0.6), mortarCol[1] * (0.7 + n * 0.6), mortarCol[2] * (0.7 + n * 0.6)];
      } else {
        const bev = Math.min(1, (e - mortar) / 9);
        height = 0.45 + 0.55 * Math.sqrt(bev) * (0.8 + n * 0.4);
        const [tAdd, tMul, hue] = row.tints[bi];
        const fine = vnoise(N[4], u * 64 * 4, v * 64 * 4);
        const k = (0.55 + n * 0.8 + (fine - 0.5) * 0.18) * tMul;
        col = [(base[0] + tAdd + hue) * k, (base[1] + tAdd) * k, (base[2] + tAdd * 0.8 - hue) * k];
        height += (fine - 0.5) * 0.08;
        // pits and chips
        if (n > 0.73) { const p = (n - 0.73) * 3; col = col.map((c) => c * (1 - p)); height -= p * 0.4; }
      }
      // large damp / soot stains
      const s = Math.max(0, big - 0.5) * stain;
      col = [col[0] * (1 - s), col[1] * (1 - s * 0.9), col[2] * (1 - s * 0.8)];
      h[y * size + x] = height;
      d[i4] = col[0]; d[i4 + 1] = col[1]; d[i4 + 2] = col[2]; d[i4 + 3] = 255;
      if (rough) rough[y * size + x] = Math.max(60, Math.min(255, 235 - Math.max(0, big - 0.45) * 520 + (e < mortar ? 20 : 0)));
    }
  }
  ctx.putImageData(img, 0, 0);
  const out = { map: finish(c), normal: normalFromHeight(h, size, 3.2) };
  if (rough) {
    const rc = canvas(size), rctx = rc.getContext('2d');
    const ri = rctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) { ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough[i]; ri.data[i * 4 + 3] = 255; }
    rctx.putImageData(ri, 0, 0);
    out.rough = finish(rc, false);
  }
  return out;
}

function wood(size, seed, base, planks = 4) {
  const N = noiseSet(seed, [4, 8, 16, 32]);
  const rng = makeRng(seed + 9);
  const tints = Array.from({ length: planks }, () => rng.range(0.75, 1.15));
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  const pw = size / planks;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = Math.floor(x / pw);
    const xin = x - p * pw;
    const u = x / size, v = y / size;
    const grain = fbm(N, u, v, 6, 0.4);
    const rings = Math.sin((grain * 18 + u * 30)) * 0.5 + 0.5;
    const n = fbm(N, u, v);
    const seam = Math.min(xin, pw - xin) < 2 ? 0.35 : 1;
    const k = (0.55 + rings * 0.25 + n * 0.35) * tints[p] * seam;
    const i = (y * size + x) * 4;
    img.data[i] = base[0] * k; img.data[i + 1] = base[1] * k; img.data[i + 2] = base[2] * k; img.data[i + 3] = 255;
    h[y * size + x] = seam < 1 ? 0 : 0.5 + rings * 0.2;
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c), normal: normalFromHeight(h, size, 2) };
}

function cloth(size, seed, base, stains = 0.5) {
  const N = noiseSet(seed, [4, 8, 16, 32, 64]);
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const weave = ((x % 4 < 2) !== (y % 4 < 2)) ? 1 : 0.86;
    const n = fbm(N, u, v);
    const st = Math.max(0, n - 0.55) * stains * 3;
    const k = (0.6 + n * 0.6) * weave * (1 - st);
    const i = (y * size + x) * 4;
    img.data[i] = base[0] * k; img.data[i + 1] = base[1] * k * (1 - st * 0.3); img.data[i + 2] = base[2] * k; img.data[i + 3] = 255;
    h[y * size + x] = weave * 0.3 + n * 0.7;
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c), normal: normalFromHeight(h, size, 1.5) };
}

// the page costume: purple / orange velvet panels separated by gold braid
function pietVelvet(size, seed) {
  const N = noiseSet(seed, [4, 8, 16, 32]);
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  const panels = 6, pw = size / panels, bw = 6;
  const cols = [[74, 30, 116], [186, 74, 24]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = Math.floor(x / pw), xin = x - p * pw;
    const u = x / size, v = y / size;
    const n = fbm(N, u, v);
    const grime = 0.78 + fbm(N, u * 0.5 + 0.3, v * 0.5) * 0.3;
    let col, hh;
    const edge = Math.min(xin, pw - xin);
    if (edge < bw) {
      const zig = (y + Math.abs(edge - bw / 2) * 2) % 6 < 3 ? 1 : 0.62;
      col = [205 * zig, 162 * zig, 64 * zig]; hh = 0.9;
    } else {
      const fold = 0.72 + 0.28 * Math.sin(((xin - bw) / (pw - 2 * bw)) * Math.PI);
      const k = (0.6 + n * 0.5) * fold;
      col = cols[p % 2].map((c2) => c2 * k); hh = fold * 0.6 + n * 0.15;
    }
    const i = (y * size + x) * 4;
    img.data[i] = col[0] * grime; img.data[i + 1] = col[1] * grime; img.data[i + 2] = col[2] * grime; img.data[i + 3] = 255;
    h[y * size + x] = hh;
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c), normal: normalFromHeight(h, size, 2.5) };
}

// gold brocade for the shoulder cape
function brocade(size, seed) {
  const N = noiseSet(seed, [8, 16, 32]);
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  const cell = size / 8;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = (x % cell) / cell - 0.5, cy = (y % cell) / cell - 0.5;
    const n = fbm(N, x / size, y / size);
    const ring = Math.abs(Math.max(Math.abs(cx), Math.abs(cy)) - 0.32) < 0.06;
    const dot = Math.hypot(cx, cy) < 0.12;
    const cross = Math.abs(cx) < 0.03 || Math.abs(cy) < 0.03;
    let col = [196, 162, 96];
    if (ring) col = [92, 60, 34]; else if (dot) col = [40, 90, 96]; else if (cross) col = [150, 110, 60];
    const k = 0.7 + n * 0.45;
    const i = (y * size + x) * 4;
    img.data[i] = col[0] * k; img.data[i + 1] = col[1] * k; img.data[i + 2] = col[2] * k; img.data[i + 3] = 255;
    h[y * size + x] = ring || dot ? 0.8 : 0.4 + n * 0.2;
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c), normal: normalFromHeight(h, size, 2) };
}

function skin(size, seed) {
  const N = noiseSet(seed, [4, 8, 16, 32]);
  const V = noiseSet(seed + 3, [4, 8, 16]);
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const n = fbm(N, u, v);
    const vn = fbm(V, u, v);
    const vein = Math.max(0, 1 - Math.abs(vn - 0.5) * 40);
    const blotch = Math.max(0, n - 0.58) * 2.5;
    const i = (y * size + x) * 4;
    img.data[i] = 196 * (0.85 + n * 0.25) - vein * 70 - blotch * 60;
    img.data[i + 1] = 186 * (0.85 + n * 0.25) - vein * 60 - blotch * 80;
    img.data[i + 2] = 176 * (0.85 + n * 0.25) - vein * 20 - blotch * 70;
    img.data[i + 3] = 255;
    h[y * size + x] = n * 0.6 + vein * 0.4 - blotch * 0.3;
  }
  ctx.putImageData(img, 0, 0);
  return { map: finish(c), normal: normalFromHeight(h, size, 2.5) };
}

function books(size, seed) {
  const rng = makeRng(seed);
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#120c08';
  ctx.fillRect(0, 0, size, size);
  const shelves = 4, sh = size / shelves;
  const cols = [[90, 20, 18], [30, 50, 30], [70, 50, 30], [40, 30, 60], [100, 80, 50], [25, 25, 25]];
  for (let s = 0; s < shelves; s++) {
    let x = 0;
    while (x < size) {
      const w = rng.int(8, 22);
      const bh = sh * rng.range(0.62, 0.9);
      const col = rng.pick(cols);
      const k = rng.range(0.5, 1);
      ctx.fillStyle = `rgb(${col[0] * k},${col[1] * k},${col[2] * k})`;
      if (rng.chance(0.08)) { x += w; continue; }
      ctx.fillRect(x, s * sh + sh - bh - 6, w - 1, bh);
      ctx.fillStyle = `rgba(160,130,60,${rng.range(0.2, 0.6)})`;
      ctx.fillRect(x, s * sh + sh - bh + 6, w - 1, 2);
      ctx.fillRect(x, s * sh + sh - 18, w - 1, 2);
      x += w;
    }
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(0, s * sh + sh - 6, size, 6);
  }
  return { map: finish(c) };
}

function radial(size, stops) {
  const c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function flame(size) {
  const c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size * 0.62, 0, size / 2, size * 0.55, size * 0.45);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.25, 'rgba(255,190,90,0.95)');
  g.addColorStop(0.55, 'rgba(230,90,20,0.55)');
  g.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.bezierCurveTo(size * 0.85, size * 0.45, size * 0.85, size, size / 2, size);
  ctx.bezierCurveTo(size * 0.15, size, size * 0.15, size * 0.45, size / 2, 0);
  ctx.fill();
  return finish(c, true, false);
}

function cookie(size) {
  // flashlight lens pattern: hot center, faint rings, dirty edge
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0, 'rgb(225,220,205)');
  g.addColorStop(0.18, 'rgb(215,205,185)');
  g.addColorStop(0.3, 'rgb(150,140,120)');
  g.addColorStop(0.36, 'rgb(190,180,160)');
  g.addColorStop(0.55, 'rgb(90,85,75)');
  g.addColorStop(0.62, 'rgb(115,108,96)');
  g.addColorStop(0.85, 'rgb(40,38,34)');
  g.addColorStop(1, 'rgb(0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const rng = makeRng(77);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.05, 0.2)})`;
    ctx.beginPath();
    ctx.arc(rng.range(0, size), rng.range(0, size), rng.range(2, 14), 0, Math.PI * 2);
    ctx.fill();
  }
  const t = finish(c, true, false);
  return t;
}

// A drawn face that flashes for a couple of frames during the big scare.
export function scareFace(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const rng = makeRng(666);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  const cx = size / 2;
  // mitre silhouette
  ctx.fillStyle = '#4a0505';
  ctx.beginPath(); ctx.moveTo(cx - 120, 140); ctx.quadraticCurveTo(cx - 100, -40, cx, -60); ctx.quadraticCurveTo(cx + 100, -40, cx + 120, 140); ctx.fill();
  // skull face
  const g = ctx.createRadialGradient(cx, 250, 20, cx, 260, 210);
  g.addColorStop(0, '#d8cfc2'); g.addColorStop(0.6, '#8f857a'); g.addColorStop(1, '#100d0b');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, 270, 160, 220, 0, 0, Math.PI * 2); ctx.fill();
  // eyes
  for (const [ex, er] of [[cx - 62, 46], [cx + 66, 36]]) {
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(ex, 225, er, er * 1.35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(ex, 225 + er); ctx.lineTo(ex + rng.range(-8, 8), 330); ctx.stroke();
    ctx.fillStyle = '#ffe9b0';
    ctx.beginPath(); ctx.arc(ex + 4, 228, 4, 0, Math.PI * 2); ctx.fill();
  }
  // mouth
  ctx.fillStyle = '#050000';
  ctx.beginPath(); ctx.ellipse(cx, 400, 90, 120, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#cfc4a8';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const x = cx + Math.cos(a) * 86, y = 400 + Math.sin(a) * 114;
    ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.lineTo(cx + Math.cos(a) * 55, 400 + Math.sin(a) * 75); ctx.fill();
  }
  // beard strands
  ctx.strokeStyle = 'rgba(200,190,170,0.5)'; ctx.lineWidth = 3;
  for (let i = 0; i < 80; i++) {
    const x = cx + rng.range(-150, 150);
    ctx.beginPath(); ctx.moveTo(x, 420 + rng.range(0, 60)); ctx.lineTo(x + rng.range(-30, 30), size); ctx.stroke();
  }
  return c;
}

export function buildTextures() {
  const T = {};
  T.wall = stoneBlocks({ size: 512, seed: 11, rows: 5, minPer: 2, maxPer: 3, mortar: 5, base: [88, 85, 80], mortarCol: [26, 24, 22], stain: 1.5 });
  T.floor = stoneBlocks({ size: 512, seed: 23, rows: 4, minPer: 2, maxPer: 3, mortar: 3, base: [78, 72, 66], mortarCol: [22, 20, 18], stain: 1.6, wet: true });
  T.wood = wood(256, 31, [92, 62, 40]);
  T.darkWood = wood(256, 37, [48, 32, 22], 6);
  T.red = cloth(256, 41, [120, 14, 16], 0.6);
  T.carpet = cloth(256, 43, [80, 12, 14], 1.0);
  T.gold = cloth(128, 47, [150, 115, 50], 0.2);
  T.skin = skin(256, 53);
  T.piet = pietVelvet(256, 61);
  T.brocade = brocade(256, 67);
  T.beret = cloth(256, 71, [176, 52, 26], 0.4);
  T.books = books(256, 59);
  T.flame = flame(64);
  T.glow = finish(radial(64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]), true, false);
  T.soot = finish(radial(64, [[0, 'rgba(10,10,10,0.9)'], [0.5, 'rgba(10,10,10,0.4)'], [1, 'rgba(0,0,0,0)']]), true, false);
  T.dust = finish(radial(32, [[0, 'rgba(255,240,220,0.9)'], [1, 'rgba(255,240,220,0)']]), true, false);
  T.cookie = cookie(256);
  // old oil portraits of Him, darkened with age
  const pc = scareFace(256), px = pc.getContext('2d');
  px.globalCompositeOperation = 'multiply';
  px.fillStyle = 'rgb(120,95,70)'; px.fillRect(0, 0, 256, 256);
  px.globalCompositeOperation = 'source-over';
  px.fillStyle = 'rgba(20,12,6,0.35)'; px.fillRect(0, 0, 256, 256);
  T.portrait = finish(pc, true, false);
  return T;
}
