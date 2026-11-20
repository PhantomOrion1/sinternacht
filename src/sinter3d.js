// High-detail Sinterklaas characters built on MakeHuman's CC0 human (see tools/build_sinter.py).
// Each variant: skinned body on a 163-bone skeleton, painted aged skin, wet eyes, hair-card beard,
// velvet cassock with folds, embroidered mitre, gold crozier, and its own idle behaviour.
import * as THREE from 'three';
import { noiseSet, fbm, vnoise, normalFromHeight } from './textures.js';
import { makeRng } from './rng.js';

const UP = new THREE.Vector3(0, 1, 0);
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ looks per variant
export const LOOKS = {
  nightmare: {
    skin: [206, 190, 174], skinRough: 0.62, sheen: 0.25, mottle: 0.55, spots: 1, veins: 0.7, cracks: 0,
    eyeRing: [0.55, 0.35, 0.33], lip: [0.62, 0.42, 0.42], nose: [1.05, 0.82, 0.8], cheeks: null, gloves: false,
    iris: [146, 156, 160], pupil: 0.18, sclera: [214, 200, 178], bloodshot: 1, voidEyes: false, milky: 0.25,
    teeth: 0x8a7a55, hair: [205, 198, 182], hairDirt: 0.5, beardL: 0.4, beardGap: 0.012, stache: [0.04, 0.09], beardNarrow: 0.5, beardThick: 0.02, beardCards: 240, hairL: 0.2, hairStyle: 'matted',
    robe: [118, 18, 20], robeDirt: 0.8, robeTorn: 0.6, gold: [168, 128, 58], goldWorn: 0.6, mitreH: 0.42, mitreTilt: [-0.08, 0.06],
    height: 1.0, stretch: null,
  },
  demonic: {
    skin: [150, 152, 140], skinRough: 0.7, sheen: 0.1, mottle: 0.8, spots: 0.4, veins: 1, cracks: 1,
    eyeRing: [0.08, 0.06, 0.06], lip: [0.25, 0.2, 0.2], nose: [0.9, 0.85, 0.85], cheeks: null, gloves: false,
    iris: [20, 10, 8], pupil: 0.9, sclera: [8, 6, 6], bloodshot: 0, voidEyes: true, milky: 0,
    teeth: 0x4a4030, hair: [120, 116, 108], hairDirt: 0.8, beardL: 0.62, beardGap: 0.012, stache: [0.05, 0.1], beardNarrow: 0.7, beardThick: 0.012, beardCards: 150, hairL: 0.36, hairStyle: 'stringy',
    robe: [56, 6, 8], robeDirt: 1, robeTorn: 1, gold: [90, 70, 40], goldWorn: 0.9, mitreH: 0.62, mitreTilt: [-0.12, 0.1],
    height: 1.1, stretch: { leg: 1.12, arm: 1.32, hand: 1.55, neck: 1.9, spine: 1.16 },
  },
  uncanny: {
    skin: [236, 210, 196], skinRough: 0.36, sheen: 0.45, mottle: 0.12, spots: 0, veins: 0.1, cracks: 0,
    eyeRing: [0.95, 0.88, 0.88], lip: [0.86, 0.5, 0.52], nose: [1, 0.92, 0.9], cheeks: [1.0, 0.62, 0.62], gloves: true,
    iris: [70, 120, 190], pupil: 0.13, sclera: [244, 240, 236], bloodshot: 0, voidEyes: false, milky: 0,
    teeth: 0xf4f0e6, hair: [246, 244, 240], hairDirt: 0, beardL: 0.3, beardGap: 0.022, stache: [0.025, 0.04], beardNarrow: 0.7, beardThick: 0.024, beardCards: 300, hairL: 0.08, hairStyle: 'neat',
    robe: [176, 20, 26], robeDirt: 0, robeTorn: 0, gold: [222, 176, 70], goldWorn: 0, mitreH: 0.44, mitreTilt: [0, 0],
    height: 1.07, stretch: { neck: 1.18 },
  },
};

// ------------------------------------------------------------------ painted textures
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function paintSkin(L, seed) {
  const S = 1024;
  const N = noiseSet(seed, [8, 16, 32, 64, 128]), F = noiseSet(seed + 9, [256]), C = noiseSet(seed + 3, [16, 32]);
  const c = canvas(S), x = c.getContext('2d'), img = x.createImageData(S, S), h = new Float32Array(S * S);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const u = px / S, v = py / S;
    const n = fbm(N, u, v), fine = vnoise(F[0], u * 256, v * 256);
    let col = L.skin.map((k) => k * (0.86 + (n - 0.5) * 0.45 * L.mottle + 0.1));
    // age spots
    const sp = Math.max(0, fbm(C, u * 3.1, v * 3.1) - 0.66) * 5 * L.spots;
    col = [col[0] * (1 - sp * 0.45), col[1] * (1 - sp * 0.55), col[2] * (1 - sp * 0.65)];
    // veins
    const vn = 1 - Math.min(1, Math.abs(fbm(C, u * 2 + 0.3, v * 2) - 0.5) * 30);
    col = [col[0] * (1 - vn * 0.18 * L.veins), col[1] * (1 - vn * 0.14 * L.veins), col[2] * (1 + vn * 0.04 * L.veins)];
    // cracked, dead skin
    let ck = 0;
    if (L.cracks) { ck = Math.max(0, 1 - Math.abs(fbm(N, u * 1.7 + 0.5, v * 1.7) - 0.5) * 40); col = col.map((k) => k * (1 - ck * 0.55)); }
    const i = (py * S + px) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    h[py * S + px] = fine * 0.3 + n * 0.04 - vn * 0.06 * L.veins - ck * 0.5 - sp * 0.04;
  }
  x.putImageData(img, 0, 0);
  return { map: tex(c), normal: normalFromHeight(h, S, L.cracks ? 3 : 1.6) };
}

// a single lock of hair: strands spread at the root, gathering to a ragged point, transparent at the sides
function paintHair(L, seed) {
  const W = 128, H = 512, c = canvas(W, H), x = c.getContext('2d');
  const rng = makeRng(seed);
  x.clearRect(0, 0, W, H);
  const n = L.hairStyle === 'neat' ? 60 : L.hairStyle === 'stringy' ? 22 : 40;
  for (let i = 0; i < n; i++) {
    const x0 = W / 2 + rng.range(-1, 1) * W * 0.36, len = rng.range(0.55, 1) * H;
    const x1 = W / 2 + (x0 - W / 2) * rng.range(0.05, 0.35) + rng.range(-6, 6);
    const k = rng.range(0.75, 1.1) * (1 - L.hairDirt * rng.range(0, 0.35));
    const col = L.hair.map((v) => Math.round(Math.min(255, v * k)));
    const grad = x.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, `rgba(${col},0.0)`); grad.addColorStop(0.06, `rgba(${col},1)`); grad.addColorStop(0.8, `rgba(${col},1)`); grad.addColorStop(1, `rgba(${col},0)`);
    x.strokeStyle = grad;
    x.lineWidth = rng.range(0.8, L.hairStyle === 'stringy' ? 2.4 : 1.8);
    const wob = L.hairStyle === 'neat' ? 3 : 8;
    x.beginPath(); x.moveTo(x0, 0);
    x.bezierCurveTo(x0 + rng.range(-wob, wob), len * 0.33, x1 + rng.range(-wob, wob), len * 0.66, x1, len);
    x.stroke();
  }
  const t = tex(c); t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

// a hair mass that tiles across u: clumps of strands from the root (top) to ragged tips
function paintHairShell(L, seed) {
  const W = 512, H = 1024, c = canvas(W, H), x = c.getContext('2d'), rng = makeRng(seed);
  const stringy = L.hairStyle === 'stringy', neat = L.hairStyle === 'neat';
  const clumps = neat ? 46 : stringy ? 30 : 38;
  const strand = (x0, y0, x1, y1, w, col, a) => {
    for (const off of [-W, 0, W]) {
      const g = x.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.85, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      x.strokeStyle = g; x.lineWidth = w;
      x.beginPath(); x.moveTo(x0 + off, y0);
      x.bezierCurveTo(x0 + off + rng.range(-6, 6), y0 + (y1 - y0) * 0.35, x1 + off + rng.range(-8, 8), y0 + (y1 - y0) * 0.7, x1 + off, y1);
      x.stroke();
    }
  };
  const shade = (k) => L.hair.map((v) => Math.round(Math.min(255, v * k))).join(',');
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < clumps; i++) {
      const cx = rng.range(0, W), cw = rng.range(10, neat ? 26 : 34), len = H * rng.range(stringy ? 0.45 : 0.62, 1);
      const sway = rng.range(-14, 14), n = pass ? (stringy ? 10 : 26) : (stringy ? 5 : 12);
      for (let k = 0; k < n; k++) {
        const x0 = cx + rng.range(-cw, cw), y0 = rng.range(0, H * (stringy ? 0.1 : 0.05));
        const x1 = cx + sway + (x0 - cx) * rng.range(0.1, 0.4), y1 = len * rng.range(0.82, 1);
        const dirt = 1 - L.hairDirt * rng.range(0, 0.4);
        if (pass === 0) strand(x0, y0, x1, y1, rng.range(4, stringy ? 6 : 9), shade(0.74 * dirt), 1);
        else strand(x0, y0, x1, y1, rng.range(0.6, 1.6), shade(rng.range(0.82, 1.02) * dirt), 1);
      }
    }
  }
  return tex(c, true, true);
}

function paintEye(L, seed) {
  const W = 512, H = 256, c = canvas(W, H), x = c.getContext('2d'), rng = makeRng(seed);
  x.fillStyle = `rgb(${L.sclera})`; x.fillRect(0, 0, W, H);
  if (L.bloodshot) {
    for (let i = 0; i < 70; i++) {
      let px = W * 0.25 + (rng.chance(0.5) ? 1 : -1) * rng.range(50, 120), py = rng.range(20, H - 20);
      x.strokeStyle = `rgba(${rng.range(140, 190)},20,25,${rng.range(0.3, 0.8) * L.bloodshot})`; x.lineWidth = rng.range(0.6, 2);
      x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 6; k++) { px += (W * 0.25 - px) * 0.14 + rng.range(-6, 6); py += (H / 2 - py) * 0.1 + rng.range(-7, 7); x.lineTo(px, py); }
      x.stroke();
    }
    const g = x.createRadialGradient(W * 0.25, H / 2, 30, W * 0.25, H / 2, 140);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(150,40,40,0.35)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  const cx = W * 0.25, cy = H / 2, r = 0.43 * H / Math.PI * 1.15;
  const ir = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  const [a, b, d] = L.iris;
  ir.addColorStop(0, `rgb(${a * 0.5},${b * 0.5},${d * 0.5})`); ir.addColorStop(0.5, `rgb(${a},${b},${d})`); ir.addColorStop(0.88, `rgb(${a * 0.7},${b * 0.7},${d * 0.7})`); ir.addColorStop(1, 'rgb(20,18,18)');
  x.fillStyle = ir; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = `rgba(${a * 0.35},${b * 0.35},${d * 0.35},0.6)`; x.lineWidth = 1;
  for (let i = 0; i < 70; i++) { const t = (i / 70) * Math.PI * 2; x.beginPath(); x.moveTo(cx + Math.cos(t) * r * 0.3, cy + Math.sin(t) * r * 0.3); x.lineTo(cx + Math.cos(t) * r * 0.95, cy + Math.sin(t) * r * 0.95); x.stroke(); }
  if (L.milky) { x.fillStyle = `rgba(225,228,226,${L.milky})`; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#030303'; x.beginPath(); x.arc(cx, cy, r * L.pupil, 0, Math.PI * 2); x.fill();
  return tex(c);
}

// velvet cassock: u wraps around the body (front at 0), v runs hem (0) to collar (1)
function paintRobe(L, seed, withTrim) {
  const S = 1024, rng = makeRng(seed);
  const N = noiseSet(seed, [4, 8, 16, 32, 64]), F = noiseSet(seed + 5, [128, 256]);
  const c = canvas(S), x = c.getContext('2d'), img = x.createImageData(S, S), h = new Float32Array(S * S);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const u = px / S, v = 1 - py / S;
    const n = fbm(N, u, v), fine = vnoise(F[1], u * 256, v * 256), mid = vnoise(F[0], u * 128, v * 128);
    const fold = Math.sin(u * Math.PI * 2 * 11 + n * 4) * 0.5 + 0.5;
    let col = L.robe.map((k) => k * (0.6 + fold * 0.35 + (n - 0.5) * 0.4 + (fine - 0.5) * 0.12));
    let hh = fold * 0.6 + fine * 0.15 + mid * 0.1;
    // grime climbing up from the hem, stains
    const dirt = L.robeDirt * (sstep(0.35, 0, v) * 0.7 + Math.max(0, fbm(N, u * 2 + 0.4, v * 2) - 0.6) * 1.6);
    col = [col[0] * (1 - dirt * 0.55) + 18 * dirt, col[1] * (1 - dirt * 0.35) + 10 * dirt, col[2] * (1 - dirt * 0.4) + 6 * dirt];
    if (withTrim) {
      const du = Math.min(u, 1 - u);
      const band = (du < 0.03) || (v < 0.045 && v > 0.012);
      if (band) {
        const pat = (Math.sin(py * 0.6) * Math.sin(px * 0.6) > 0.2) ? 1 : 0.72;
        const worn = 1 - L.goldWorn * Math.max(0, n - 0.4) * 1.4;
        col = L.gold.map((k) => k * pat * worn * (0.8 + fine * 0.3));
        hh = 0.9 + pat * 0.1;
      }
    }
    const i = (py * S + px) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    h[py * S + px] = hh;
  }
  x.putImageData(img, 0, 0);
  // tears and burn holes
  for (let i = 0; i < 40 * L.robeTorn; i++) {
    x.fillStyle = `rgba(10,4,4,${rng.range(0.3, 0.8)})`;
    x.beginPath(); x.ellipse(rng.range(0, S), S - rng.range(0, S * 0.5), rng.range(3, 14), rng.range(6, 30), rng.range(0, 3), 0, Math.PI * 2); x.fill();
  }
  return { map: tex(c, true, true), normal: normalFromHeight(h, S, 3) };
}

function paintMitre(L) {
  const W = 512, H = 768, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = `rgb(${L.robe})`; x.fillRect(0, 0, W, H);
  const N = noiseSet(77, [8, 16, 32]);
  const img = x.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) { const k = 0.75 + fbm(N, (i % W) / W, Math.floor(i / W) / H) * 0.5 - L.robeDirt * 0.2; img.data[i * 4] *= k; img.data[i * 4 + 1] *= k; img.data[i * 4 + 2] *= k; }
  x.putImageData(img, 0, 0);
  const g = `rgb(${L.gold})`;
  x.fillStyle = g;
  x.fillRect(0, H - 70, W, 50);           // base band
  x.fillRect(W / 2 - 22, 60, 44, H - 130); // vertical orphrey
  x.fillRect(W / 2 - 120, 250, 240, 40);   // cross bar
  x.strokeStyle = 'rgba(70,40,10,0.6)'; x.lineWidth = 3;
  for (let i = 0; i < 26; i++) { x.beginPath(); x.arc(W / 2, 90 + i * 24, 8, 0, Math.PI * 2); x.stroke(); }
  for (let i = 0; i < 10; i++) { x.fillStyle = i % 2 ? '#2a5a8a' : '#8a1a1a'; x.beginPath(); x.arc(30 + i * 50, H - 45, 9, 0, Math.PI * 2); x.fill(); }
  return tex(c);
}

// ------------------------------------------------------------------ geometry helpers
function geometryFrom(part, buf) {
  const g = new THREE.BufferGeometry();
  const f32 = ([o, n]) => new Float32Array(buf, o, n), u16 = ([o, n]) => new Uint16Array(buf, o, n), u32 = ([o, n]) => new Uint32Array(buf, o, n);
  g.setAttribute('position', new THREE.BufferAttribute(f32(part.pos).slice(), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(f32(part.uv).slice(), 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(u16(part.si).slice(), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(f32(part.sw).slice(), 4));
  g.setIndex(new THREE.BufferAttribute(u32(part.idx).slice(), 1));
  return g;
}
// smooth normals across UV seams
function weldedNormals(g) {
  const p = g.attributes.position.array, idx = g.index.array, n = p.length / 3;
  const key = new Int32Array(n), map = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(p[i * 3] * 2e4)},${Math.round(p[i * 3 + 1] * 2e4)},${Math.round(p[i * 3 + 2] * 2e4)}`;
    let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); }
    key[i] = id;
  }
  const acc = new Float32Array(map.size * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1 = [p[b * 3] - ax, p[b * 3 + 1] - ay, p[b * 3 + 2] - az], e2 = [p[c * 3] - ax, p[c * 3 + 1] - ay, p[c * 3 + 2] - az];
    const fx = e1[1] * e2[2] - e1[2] * e2[1], fy = e1[2] * e2[0] - e1[0] * e2[2], fz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const v of [a, b, c]) { const k = key[v] * 3; acc[k] += fx; acc[k + 1] += fy; acc[k + 2] += fz; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = key[i] * 3; const l = Math.hypot(acc[k], acc[k + 1], acc[k + 2]) || 1;
    out[i * 3] = acc[k] / l; out[i * 3 + 1] = acc[k + 1] / l; out[i * 3 + 2] = acc[k + 2] / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

// ------------------------------------------------------------------ the character
// painted textures are expensive; paint once per variant and share between builds
const texMemo = {};
const memo = (key, f) => (texMemo[key] ??= f());
const dataCache = {};
export function loadSinterData(name, base = 'assets/sinter/') {
  return (dataCache[name] ??= Promise.all([
    fetch(base + name + '.json').then((r) => r.json()),
    fetch(base + name + '.bin').then((r) => r.arrayBuffer()),
  ]).then(([header, buf]) => (dataCache[name] = { header, buf })));
}
// synchronous build once loadSinterData(name) has resolved
export function makeSinter(name) {
  const d = dataCache[name];
  if (!d || d instanceof Promise) throw new Error('sinter data not loaded: ' + name);
  return buildSinter(name, d.header, d.buf);
}
export async function loadSinter(name, base = 'assets/sinter/') {
  const [header, buf] = await Promise.all([
    fetch(base + name + '.json').then((r) => r.json()),
    fetch(base + name + '.bin').then((r) => r.arrayBuffer()),
  ]);
  return buildSinter(name, header, buf);
}

export function buildSinter(name, header, buf) {
  const L = LOOKS[name];
  const rng = makeRng(name.length * 977 + 13);
  const root = new THREE.Group();
  root.name = 'sinter-' + name;
  const B = {}, bonesArr = [];
  const bw = {};
  // skeleton: each bone's +Y runs head -> tail
  for (const b of header.bones) {
    const bone = new THREE.Bone(); bone.name = b.name;
    const head = V3(b.head), dir = V3(b.tail).sub(head);
    const q = dir.lengthSq() > 1e-10 ? new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()) : new THREE.Quaternion();
    bw[b.name] = { head, q };
    if (b.parent) {
      const P = bw[b.parent], pi = P.q.clone().invert();
      bone.position.copy(head.clone().sub(P.head).applyQuaternion(pi));
      bone.quaternion.copy(pi.multiply(q));
      B[b.parent].add(bone);
    } else { bone.position.copy(head); bone.quaternion.copy(q); root.add(bone); }
    bone.userData.bindLocal = bone.quaternion.clone();
    bone.userData.bindWorld = q.clone();
    bone.userData.bindWorldInv = q.clone().invert();
    bone.userData.headW = head.clone();
    B[b.name] = bone; bonesArr.push(bone);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bonesArr);
  const parts = header.parts;
  const mats = [];
  const skinned = (part, mat) => {
    const g = geometryFrom(part, buf);
    weldedNormals(g);
    const m = new THREE.SkinnedMesh(g, mat);
    m.bind(skeleton);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    root.add(m);
    mats.push(mat);
    return m;
  };
  const bh = (n) => bw[n].head;
  const eyeL = V3(header.meta.eyes.l.c), eyeR = V3(header.meta.eyes.r.c), eyeRad = header.meta.eyes.l.r;
  const mouth = bh('oris01').clone().lerp(bh('oris05'), 0.5);
  const chin = V3(header.bones.find((b) => b.name === 'jaw').tail);

  // --- skin: painted texture x regional vertex tint
  const skinTex = memo(name + ':skin', () => paintSkin(L, 11 + name.length));
  const skinMat = new THREE.MeshPhysicalMaterial({
    map: skinTex.map, normalMap: skinTex.normal, normalScale: new THREE.Vector2(L.cracks ? 0.6 : 0.35, L.cracks ? 0.6 : 0.35), roughness: L.skinRough,
    sheen: L.sheen, sheenColor: new THREE.Color(0.8, 0.35, 0.3), sheenRoughness: 0.5, vertexColors: true,
    clearcoat: name === 'uncanny' ? 0.35 : 0, clearcoatRoughness: 0.4,
  });
  const body = skinned(parts.body, skinMat);
  const teeth = skinned(parts.teeth, new THREE.MeshStandardMaterial({ color: L.teeth, roughness: 0.35 }));
  const tongue = skinned(parts.tongue, new THREE.MeshStandardMaterial({ color: 0x4a1418, roughness: 0.4 }));
  const lashes = skinned(parts.lashes, new THREE.MeshStandardMaterial({ color: name === 'uncanny' ? 0xd8d4cc : 0x2a2622, roughness: 1, side: THREE.DoubleSide }));
  lashes.castShadow = false;
  const bp = body.geometry.attributes.position.array;
  const eyeY = eyeL.y, eyeZ = eyeL.z, eyeX = Math.abs(eyeL.x), AZ = eyeZ - 0.09;
  // --- per-variant sculpting of the face (bind space)
  const sculpt = (fn) => { const v = new THREE.Vector3(); for (const m of [body, teeth, tongue, lashes]) { const a = m.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 3) { v.set(a[i], a[i + 1], a[i + 2]); const wz = sstep(AZ - 0.02, AZ + 0.04, v.z) * sstep(chin.y - 0.06, chin.y - 0.01, v.y); if (wz > 0) { fn(v, wz); a[i] = v.x; a[i + 1] = v.y; a[i + 2] = v.z; } } } };
  const lids = (v, wz, up, down) => { for (const e of [eyeL, eyeR]) { const d = Math.hypot(v.x - e.x, v.y - e.y); if (v.z < e.z - eyeRad) continue; const k = sstep(eyeRad * 1.8, eyeRad * 0.75, d) * wz; if (v.y > e.y) v.y += up * k; else v.y -= down * k; } };
  const eyeLift = { 'eye.L': 0, 'eye.R': 0 }, eyeSink = L.voidEyes ? 0.012 : 0;
  if (name === 'nightmare') sculpt((v, wz) => {
    lids(v, wz, 0, 0.0022);                     // lower lids sagging off the eye, red rims showing
    for (const sd of [1, -1]) { const d = Math.hypot(v.x - sd * 0.06, v.y - (eyeY + 0.02)); v.x -= sd * sstep(0.03, 0, d) * 0.004 * wz; } // sunken temples
  });
  if (name === 'demonic') sculpt((v, wz) => {
    for (const e of [eyeL, eyeR]) { const d = v.distanceTo(e); v.z -= sstep(eyeRad * 2.5, eyeRad * 0.8, d) * 0.017 * wz; } // hollow sockets
    for (const sd of [1, -1]) { const d = Math.hypot(v.x - sd * 0.046, (v.y - (mouth.y + 0.016)) * 0.9); const k = sstep(0.034, 0, d) * wz; v.x -= sd * k * 0.007; v.z -= k * 0.007; } // starved cheeks
    v.y -= 0.024 * sstep(eyeY - 0.03, mouth.y, v.y) * wz;  // the lower face drawn down, too long
    for (const sd of [1, -1]) { const d = Math.hypot(v.x - sd * 0.022, (v.y - mouth.y) * 1.4); const k = sstep(0.026, 0, d) * wz; v.x += sd * k * 0.012; v.y -= k * 0.008; } // mouth split wide, drooping
  });
  if (name === 'uncanny') {
    const sideL = Math.sign(eyeL.x);
    const asym = (x) => 0.0028 * sstep(0, 0.05, x * sideL);
    sculpt((v, wz) => {
      for (const sd of [1, -1]) { const d = Math.hypot((v.x - sd * 0.024) / 1.2, (v.y - mouth.y) * 1.2); const k = sstep(0.03, 0, d) * wz; v.x += sd * k * 0.016; v.y += k * 0.013; v.z -= k * 0.008; } // grin too wide, corners too high
      const dl = Math.hypot(v.x / 0.032, (v.y - mouth.y) / 0.012);
      if (v.z > mouth.z - 0.02 && v.y < mouth.y) { const k = sstep(1.5, 0.4, dl) * wz; v.y += 0.0015 * k; v.z -= 0.002 * k; } // lower lip pulled tight on the teeth
      for (const sd of [1, -1]) { const d = Math.hypot(v.x - sd * 0.045, v.y - (eyeY - 0.03)); const k = sstep(0.026, 0, d) * wz; v.z += k * 0.004; v.y += k * 0.003; } // cheeks bunched
      lids(v, wz, 0.0026, 0.0014);                // eyes held a little too wide
      v.y += asym(v.x) * wz;                      // one side of the face sits higher
    });
    eyeLift[sideL > 0 ? 'eye.L' : 'eye.R'] = asym(eyeX);
  }
  for (const m of [body, teeth, tongue, lashes]) weldedNormals(m.geometry);
  const bn = body.geometry.attributes.normal.array;
  {
    const p = body.geometry.attributes.position.array, si = body.geometry.attributes.skinIndex.array, n = p.length / 3;
    const col = new Float32Array(n * 3);
    const handBones = new Set(bonesArr.map((b, i) => (/finger|metacarpal|wrist/.test(b.name) ? i : -1)).filter((i) => i >= 0));
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      let c = [1, 1, 1];
      const mul = (k, w) => { c = c.map((x, j) => x * (1 + (k[j] - 1) * w)); };
      const de = Math.min(v.distanceTo(eyeL), v.distanceTo(eyeR));
      mul(L.eyeRing, sstep(eyeRad * 2.6, eyeRad * 1.1, de));
      const dm = Math.hypot((v.x - mouth.x) / 0.03, (v.y - mouth.y) / 0.011, (v.z - mouth.z) / 0.04);
      mul(L.lip, sstep(1.4, 0.7, dm));
      const dn = Math.hypot(v.x, (v.y - (eyeL.y - 0.035)) / 1.4, Math.max(0, mouth.z + 0.02 - v.z) * 3);
      mul(L.nose, sstep(0.03, 0.0, dn) * (v.z > mouth.z ? 1 : 0));
      if (L.cheeks) for (const s of [1, -1]) { const d = Math.hypot(v.x - s * 0.048, (v.y - (eyeL.y - 0.035)) * 1.1, Math.max(0, mouth.z - 0.03 - v.z)); mul(L.cheeks, sstep(0.03, 0.006, d)); }
      if (L.gloves && handBones.has(si[i * 4])) c = [3.2, 3.2, 3.3];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    body.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  // --- the cassock: geometric folds, torn hem
  const robeTex = memo(name + ':robe', () => paintRobe(L, 21, true)), plainTex = memo(name + ':plain', () => paintRobe(L, 23, false));
  const robeMat = new THREE.MeshPhysicalMaterial({ map: robeTex.map, normalMap: robeTex.normal, roughness: 0.92, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(...L.robe.map((v) => Math.min(1, v / 160))), side: THREE.DoubleSide });
  const robe = skinned(parts.robe, robeMat);
  {
    const p = robe.geometry.attributes.position.array, uv = robe.geometry.attributes.uv.array, n = p.length / 3;
    let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += p[i * 3]; cz += p[i * 3 + 2]; } cx /= n; cz /= n;
    for (let i = 0; i < n; i++) {
      const a = uv[i * 2] * Math.PI * 2, v = uv[i * 2 + 1];
      const fold = (Math.sin(a * 11 + Math.sin(a * 3) * 2) * 0.6 + Math.sin(a * 23) * 0.25) * (0.004 + (1 - v) * 0.016);
      const dx = p[i * 3] - cx, dz = p[i * 3 + 2] - cz, l = Math.hypot(dx, dz) || 1;
      p[i * 3] += (dx / l) * fold; p[i * 3 + 2] += (dz / l) * fold;
      if (v < 0.04 && L.robeTorn) p[i * 3 + 1] += (Math.sin(a * 17) * 0.5 + Math.sin(a * 41) * 0.5) * 0.06 * L.robeTorn + rng.range(0, 0.04) * L.robeTorn;
    }
    weldedNormals(robe.geometry);
  }
  skinned(parts.sleeves, new THREE.MeshPhysicalMaterial({ map: plainTex.map, normalMap: plainTex.normal, roughness: 0.92, sheen: 1, sheenRoughness: 0.55, sheenColor: robeMat.sheenColor, side: THREE.DoubleSide }));

  // --- hair. Beard and long hair are shells that follow the face and then hang under their own
  // weight, with clumps of hair cards laid along them; moustache and brows are cards combed along the skin.
  const shellMat = new THREE.MeshStandardMaterial({ map: memo(name + ':shell', () => paintHairShell(L, 7)), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82 });
  const hairMat = new THREE.MeshStandardMaterial({ map: memo(name + ':hair', () => paintHair(L, 5)), alphaTest: 0.32, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85 });
  mats.push(shellMat, hairMat);
  const bsi = body.geometry.attributes.skinIndex.array, bsw = body.geometry.attributes.skinWeight.array;
  const roots = (test) => { const out = []; for (let i = 0; i < bp.length / 3; i++) if (test(bp[i * 3], bp[i * 3 + 1], bp[i * 3 + 2])) out.push(i); return out; };
  // radial height-field of body + robe around a vertical axis through the skull
  const YS = 0.004, AS = 0.03, Y0 = chin.y - 0.9, NY = Math.ceil((eyeY + 0.3 - Y0) / YS), NA = Math.ceil((Math.PI * 2) / AS);
  const TAU = Math.PI * 2, wrapA = (a) => ((a % TAU) + TAU) % TAU;
  const radT = new Float32Array(NY * NA);
  const addR = (arr) => {
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2];
      if (Math.abs(x) > 0.17 || y < Y0) continue;
      const yi = Math.floor((y - Y0) / YS); if (yi >= NY) continue;
      const k = yi * NA + (Math.floor(wrapA(Math.atan2(x, z - AZ)) / AS) % NA), r = Math.hypot(x, z - AZ);
      if (r > radT[k]) radT[k] = r;
    }
  };
  addR(bp); addR(robe.geometry.attributes.position.array);
  const surfR = (y, a) => {
    const yi = Math.floor((y - Y0) / YS), ai = Math.floor(wrapA(a) / AS); let m = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = yi + dy; if (yy < 0 || yy >= NY) continue; for (let da = -1; da <= 1; da++) m = Math.max(m, radT[yy * NA + ((ai + da + NA) % NA)]); }
    return m;
  };
  const nearestIn = (set, x, y, z) => { let best = set[0], bd = 1e9; for (const i of set) { const d = (bp[i * 3] - x) ** 2 + (bp[i * 3 + 1] - y) ** 2 + (bp[i * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = i; } } return best; };
  const shellBuf = { pos: [], uv: [], si: [], sw: [], idx: [] }, cards = { pos: [], uv: [], si: [], sw: [], idx: [] };
  const pushW = (o, i) => { o.si.push(bsi[i * 4], bsi[i * 4 + 1], bsi[i * 4 + 2], bsi[i * 4 + 3]); o.sw.push(bsw[i * 4], bsw[i * 4 + 1], bsw[i * 4 + 2], bsw[i * 4 + 3]); };
  function shell(o) {
    const P = [], W = [];
    for (let c = 0; c < o.cols; c++) {
      const a = o.a0 + (o.a1 - o.a0) * (c / (o.cols - 1));
      let rPrev = 0; const cp = [], cw = [];
      for (let r = 0; r < o.rows; r++) {
        const t = r / (o.rows - 1), yT = o.top(a), yB = o.bottom(a), y = yT + (yB - yT) * t;
        const aa = a * (1 - (o.narrow || 0) * sstep(chin.y, yB, y));
        let rr = Math.max(surfR(y, aa) + o.off(t, a), rPrev * o.decay); if (r && o.maxGrow) rr = Math.min(rr, rPrev + o.maxGrow); rPrev = rr;
        const p = new THREE.Vector3(Math.sin(aa) * rr, y, AZ + Math.cos(aa) * rr);
        cp.push(p); cw.push(nearestIn(o.set, p.x, Math.max(p.y, o.wy), p.z));
      }
      P.push(cp); W.push(cw);
    }
    const base = shellBuf.pos.length / 3;
    for (let c = 0; c < o.cols; c++) for (let r = 0; r < o.rows; r++) {
      const p = P[c][r]; shellBuf.pos.push(p.x, p.y, p.z); shellBuf.uv.push((c / (o.cols - 1)) * o.tiles, 1 - r / (o.rows - 1)); pushW(shellBuf, W[c][r]);
    }
    for (let c = 0; c < o.cols - 1; c++) for (let r = 0; r < o.rows - 1; r++) {
      const a = base + c * o.rows + r, b = a + o.rows; shellBuf.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return { P, W, cols: o.cols, rows: o.rows };
  }
  // clumps of cards lying along a shell
  function shellCards(S, n, rowsRange, width, liftMax, rowMax = 0.75) {
    const tmp = new THREE.Vector3(), side = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const c = rng.range(0, S.cols - 1.001), c0 = Math.floor(c), fc = c - c0;
      const r0 = Math.floor(rng.range(0, S.rows * rowMax)), len = Math.max(2, Math.round(rng.range(...rowsRange)));
      const off0 = rng.range(0.002, 0.01), w = rng.range(...width), lift = rng.range(0, liftMax);
      const base = cards.pos.length / 3; let segs = 0;
      for (let s = 0; s <= len; s++) {
        const r = Math.min(S.rows - 1, r0 + s);
        tmp.lerpVectors(S.P[c0][r], S.P[c0 + 1][r], fc);
        nrm.set(tmp.x, 0, tmp.z - AZ).normalize();
        side.subVectors(S.P[c0 + 1][r], S.P[c0][r]).normalize().multiplyScalar(w / 2);
        tmp.addScaledVector(nrm, off0 + lift * (s / len) ** 2);
        cards.pos.push(tmp.x - side.x, tmp.y - side.y, tmp.z - side.z, tmp.x + side.x, tmp.y + side.y, tmp.z + side.z);
        cards.uv.push(0, 1 - s / len, 1, 1 - s / len);
        const wi = S.W[fc < 0.5 ? c0 : c0 + 1][r]; pushW(cards, wi); pushW(cards, wi);
        if (s) segs++;
      }
      for (let s = 0; s < segs; s++) { const a = base + s * 2; cards.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  // a card combed along the skin from a root vertex
  const addCard = (ri, dir, len, width, lift) => {
    const o = new THREE.Vector3(bp[ri * 3], bp[ri * 3 + 1], bp[ri * 3 + 2]);
    const nrm = new THREE.Vector3(bn[ri * 3], bn[ri * 3 + 1], bn[ri * 3 + 2]).normalize();
    o.addScaledVector(nrm, 0.0012);
    const d = dir.clone().addScaledVector(nrm, -dir.dot(nrm)).normalize().addScaledVector(nrm, lift).normalize();
    const side = new THREE.Vector3().crossVectors(d, nrm).normalize().multiplyScalar(width / 2);
    const base = cards.pos.length / 3, SEG = 4; const p = o.clone();
    for (let s = 0; s <= SEG; s++) {
      cards.pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
      cards.uv.push(0, 1 - s / SEG, 1, 1 - s / SEG);
      pushW(cards, ri); pushW(cards, ri);
      d.addScaledVector(nrm, -0.08).normalize();
      p.addScaledVector(d, len / SEG);
    }
    for (let s = 0; s < SEG; s++) { const a = base + s * 2; cards.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  };
  const pick = (arr) => arr[Math.floor(rng.next() * arr.length)];
  const scalpTop = (() => { let m = -1; for (let i = 0; i < bp.length / 3; i++) if (bp[i * 3 + 1] > m) m = bp[i * 3 + 1]; return m; })();
  // beard
  const BA = 1.5;
  const jawSet = roots((x, y, z) => y < mouth.y && y > chin.y - 0.03 && z > AZ - 0.02 && Math.abs(x) < 0.08);
  const beard = shell({
    a0: -BA, a1: BA, cols: 44, rows: 30, tiles: 2, decay: 0.996, maxGrow: 0.008, narrow: L.beardNarrow, set: jawSet, wy: chin.y,
    top: (a) => mouth.y - L.beardGap + (eyeY - 0.03 - (mouth.y - L.beardGap)) * sstep(0.35, 1.3, Math.abs(a)),
    bottom: (a) => chin.y - L.beardL * (1 - 0.88 * (a / BA) ** 2),
    off: (t) => 0.002 + L.beardThick * sstep(0, 0.4, t),
  });
  shellCards(beard, L.beardCards, [5, 14], [0.008, L.hairStyle === 'stringy' ? 0.012 : 0.018], L.hairStyle === 'neat' ? 0.004 : 0.02);
  // long hair from under the mitre
  const skullSet = roots((x, y, z) => y > eyeY - 0.07 && z < eyeZ - 0.03);
  const hair = shell({
    a0: 0.95, a1: TAU - 0.95, cols: 40, rows: 22, tiles: 2, decay: 0.998, maxGrow: 0.006, set: skullSet, wy: eyeY - 0.05,
    top: () => scalpTop - 0.07, bottom: (a) => chin.y - L.hairL * (0.75 + 0.25 * Math.abs(Math.cos(a))),
    off: (t) => 0.003 + 0.012 * sstep(0, 0.3, t),
  });
  shellCards(hair, 140, [4, 10], [0.008, 0.016], 0.01, 0.8);
  // moustache, eyebrows
  const stacheRoots = roots((x, y, z) => y > mouth.y + (L.hairStyle === 'neat' ? 0.011 : 0.004) && y < mouth.y + 0.022 && Math.abs(x) < 0.036 && z > mouth.z - 0.02);
  for (let i = 0; i < 240 && stacheRoots.length; i++) {
    const ri = pick(stacheRoots), s = Math.sign(bp[ri * 3]) || 1;
    addCard(ri, L.hairStyle === 'neat' ? new THREE.Vector3(s, -0.15, 0) : new THREE.Vector3(s * rng.range(0.7, 1.2), -1, 0), rng.range(...L.stache), rng.range(0.006, 0.012), 0.12);
  }
  const browRoots = roots((x, y, z) => y > eyeY + 0.014 && y < eyeY + 0.028 && Math.abs(Math.abs(x) - eyeX) < 0.024 && z > eyeZ - 0.014);
  for (let i = 0; i < 170 && browRoots.length; i++) {
    const ri = pick(browRoots), s = Math.sign(bp[ri * 3]) || 1;
    addCard(ri, new THREE.Vector3(s, L.hairStyle === 'neat' ? 0.12 : rng.range(-0.2, 0.5), 0), rng.range(0.014, name === 'nightmare' ? 0.032 : 0.022), 0.005, name === 'nightmare' ? 0.35 : 0.12);
  }
  for (const [o, mat] of [[shellBuf, shellMat], [cards, hairMat]]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(o.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(o.sw, 4));
    g.setIndex(o.idx);
    g.computeVertexNormals();
    const m = new THREE.SkinnedMesh(g, mat); m.bind(skeleton); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; root.add(m);
  }

  // --- eyes (or what's left of them)
  const attach = (obj, boneName, worldPos, worldQuat) => {
    const bone = B[boneName];
    bone.updateWorldMatrix(true, false);
    obj.position.copy(bone.worldToLocal(worldPos.clone()));
    if (worldQuat) obj.quaternion.copy(bone.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQuat));
    bone.add(obj);
    return obj;
  };
  const eyes = [];
  const eyeMat = L.voidEyes
    ? new THREE.MeshBasicMaterial({ color: 0x000000 })
    : new THREE.MeshPhysicalMaterial({ map: memo(name + ':eye', () => paintEye(L, 3)), roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 });
  mats.push(eyeMat);
  for (const [c, nm] of [[eyeL, 'eye.L'], [eyeR, 'eye.R']]) {
    const holder = new THREE.Group();
    attach(holder, 'head', c.clone().add(new THREE.Vector3(0, eyeLift[nm], -eyeSink)));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(eyeRad * (L.voidEyes ? 1.05 : 0.98), 32, 20), eyeMat);
    holder.add(ball);
    if (L.voidEyes) {
      // hollow sockets with a dying ember deep inside
      const ember = new THREE.Mesh(new THREE.SphereGeometry(eyeRad * 0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3a10 }));
      ember.position.z = eyeRad * 0.3; holder.add(ember);
    }
    eyes.push({ holder, ball, nm });
  }

  // --- mitre
  const mitreTex = memo(name + ':mitre', () => paintMitre(L));
  const mitreMat = new THREE.MeshPhysicalMaterial({ map: mitreTex, roughness: 0.75, sheen: 0.8, sheenColor: new THREE.Color(0.6, 0.1, 0.1) });
  mats.push(mitreMat);
  {
    // two stiff curved panels joined at the headband, parting towards the points
    const H = L.mitreH, Wd = 0.23, D = 0.25, NU = 28, NV = 30;
    const mitre = new THREE.Group(); mitre.name = 'mitre';
    mitreMat.side = THREE.DoubleSide;
    for (const sd of [1, -1]) {
      const pos = [], uv = [], idx = [];
      for (let j = 0; j <= NV; j++) {
        const v = j / NV, hw = (Wd / 2) * (v < 0.42 ? 1 + v * 0.12 : 1.05 * (1 - Math.pow((v - 0.42) / 0.58, 1.7)));
        for (let i = 0; i <= NU; i++) {
          const u = -1 + (2 * i) / NU, x = u * hw;
          const z = sd * ((D / 2) * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.72 * sstep(0, 0.65, v)) + 0.03 * sstep(0.3, 1, v));
          pos.push(x, v * H, z); uv.push(x / Wd + 0.5, v);
        }
      }
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + NU + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const panel = new THREE.Mesh(g, mitreMat); panel.castShadow = true; mitre.add(panel);
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(Wd / 2 + 0.004, Wd / 2 + 0.006, 0.05, 40, 1, true), new THREE.MeshStandardMaterial({ color: new THREE.Color(...L.gold.map((v) => v / 255)), metalness: 0.85, roughness: 0.35 + L.goldWorn * 0.3, side: THREE.DoubleSide }));
    band.scale.z = (D / 2 + 0.005) / (Wd / 2 + 0.005); band.position.y = 0.025; mitre.add(band);
    for (const sd of [-1, 1]) {
      const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.36, 1, 6), mitreMat); lp.position.set(sd * 0.045, -0.15, -D / 2 - 0.01); lp.rotation.x = 0.12; mitre.add(lp);
    }
    const wp = new THREE.Vector3(0, scalpTop - 0.1, AZ + 0.02);
    const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(L.mitreTilt[0], 0, L.mitreTilt[1]));
    attach(mitre, 'head', wp, wq);
  }

  // --- crozier in the right hand
  {
    const goldMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...L.gold.map((v) => v / 255)), metalness: 0.95, roughness: 0.3 + L.goldWorn * 0.3 });
    mats.push(goldMat);
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 2.0, 12), goldMat); shaft.position.y = 0.25; staff.add(shaft);
    for (let i = 0; i < 5; i++) { const k = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 16), goldMat); k.rotation.x = Math.PI / 2; k.position.y = -0.4 + i * 0.35; staff.add(k); }
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * Math.PI * 1.7, r = 0.14 * (1 - t * 0.55); pts.push(new THREE.Vector3(Math.sin(a) * r, 1.25 + (1 - Math.cos(a)) * r * 0.9 + t * 0.05, 0)); }
    pts[0].set(0, 1.25, 0);
    const crook = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.013, 10), goldMat); staff.add(crook);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), goldMat); knob.position.y = 1.22; staff.add(knob);
    staff.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const hand = bh('wrist.R').clone().add(new THREE.Vector3(-0.01, -0.06, 0.02));
    attach(staff, 'wrist.R', hand, new THREE.Quaternion());
    staff.userData.isStaff = true;
    var staffObj = staff;
  }

  // ------------------------------------------------------------------ pose
  const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  const rot = (n, x, y = 0, z = 0) => {
    const bone = B[n]; if (!bone) return;
    tmpQ.setFromEuler(tmpE.set(x, y, z, 'YXZ'));
    bone.quaternion.copy(bone.userData.bindLocal).multiply(bone.userData.bindWorldInv.clone().multiply(tmpQ).multiply(bone.userData.bindWorld));
  };
  // stretched proportions (demonic) — scale bones along their length
  if (L.stretch) {
    const S = L.stretch;
    const lengthen = (b, f) => { for (const c of b.children) if (c.isBone) c.position.multiplyScalar(f); };
    for (const b of bonesArr) {
      if (S.leg && /^(upperleg|lowerleg)/.test(b.name)) lengthen(b, S.leg);
      if (S.arm && /^(upperarm|lowerarm)/.test(b.name)) lengthen(b, S.arm);
      if (S.hand && /^finger/.test(b.name)) lengthen(b, S.hand);
      if (S.neck && /^neck/.test(b.name)) lengthen(b, S.neck);
      if (S.spine && /^spine0[1-4]/.test(b.name)) lengthen(b, S.spine);
    }
  }
  if (name === 'uncanny') B.head.scale.setScalar(0.93); // a head slightly too small for the body
  root.scale.setScalar(L.height);

  const state = { t: rng.next() * 10, twT: 1, tw: 0, look: new THREE.Vector3(0, 1.8, 3), jaw: 0 };
  const headWorld = new THREE.Vector3();
  function pose(dt, target) {
    state.t += dt;
    const t = state.t;
    resetPose();
    if (target) state.look.lerp(target, 1 - Math.exp(-6 * dt));
    // where is the viewer, relative to the head?
    B.head.getWorldPosition(headWorld);
    const lx = state.look.x - headWorld.x, lz = state.look.z - headWorld.z, ly = state.look.y - headWorld.y;
    const r0 = root.rotation.y;
    let yaw = Math.atan2(lx, lz) - r0; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const pitch = Math.atan2(ly, Math.hypot(lx, lz));
    const breath = Math.sin(t * (name === 'uncanny' ? 0.6 : 1.1)) * 0.02;
    // arms down out of the A-pose
    const armDown = 0.62;
    rot('upperarm01.L', 0.05, 0, -armDown); rot('upperarm01.R', 0.05, 0, armDown);
    if (name === 'nightmare') {
      // hunched old man, head pushed forward, glaring up from under the brows
      rot('spine04', 0.12 + breath); rot('spine03', 0.15); rot('spine02', 0.12); rot('spine01', 0.08);
      rot('neck01', 0.25); rot('neck02', -0.1);
      rot('head', -0.45 - pitch * 0.6, yaw * 0.7, Math.sin(t * 0.4) * 0.06);
      rot('jaw', 0.12 + Math.sin(t * 0.9) * 0.03);
      rot('lowerarm01.L', -0.25, 0, -0.1); rot('lowerarm01.R', -0.5, 0, 0.15);
      for (const s of ['L']) for (let f = 1; f <= 5; f++) { rot(`finger${f}-2.${s}`, 0.5 + Math.sin(t * 3 + f) * 0.15); rot(`finger${f}-3.${s}`, 0.6); }
      for (let f = 2; f <= 5; f++) { rot(`finger${f}-1.R`, 1.1); rot(`finger${f}-2.R`, 1.2); rot(`finger${f}-3.R`, 0.9); }
    } else if (name === 'demonic') {
      // too tall, shoulders hiked, head cocked at a broken angle, jaw hanging
      state.twT -= dt;
      if (state.twT <= 0) { state.twT = 0.4 + Math.random() * 1.8; state.tw = (Math.random() - 0.5) * 1.4; }
      rot('spine04', 0.18); rot('spine03', 0.2 + breath); rot('spine01', 0.15);
      rot('clavicle.L', 0, 0, 0.25); rot('clavicle.R', 0, 0, -0.25);
      rot('neck01', 0.42); rot('neck02', 0.12);
      rot('head', -0.62 - pitch * 0.5, yaw * 0.9, 0.3 + state.tw * 0.3 + Math.sin(t * 13) * 0.02);
      rot('jaw', 0.32 + Math.sin(t * 2) * 0.04);
      rot('lowerarm01.L', -0.15, 0, -0.15); rot('lowerarm01.R', -0.35, 0, 0.15);
      for (const s of ['L', 'R']) for (let f = 1; f <= 5; f++) { rot(`finger${f}-1.${s}`, 0.2); rot(`finger${f}-2.${s}`, 0.35 + Math.sin(t * 7 + f) * 0.2); rot(`finger${f}-3.${s}`, 0.5); }
    } else {
      // upright and still, too still; head tilted, eyes never leave you
      rot('spine04', breath * 0.3);
      rot('head', -pitch * 0.85, yaw * 0.85, 0.18);
      rot('neck01', -0.05);
      rot('jaw', 0.02);
      rot('lowerarm01.L', -0.9, 0.3, -0.4); rot('lowerarm01.R', -0.6, 0, 0.2);
      for (let f = 2; f <= 5; f++) { rot(`finger${f}-1.R`, 1.1); rot(`finger${f}-2.R`, 1.2); rot(`finger${f}-3.R`, 0.9); rot(`finger${f}-2.L`, 0.4); }
    }
    finish(state.look);
  }
  function resetPose() { for (const b of bonesArr) b.quaternion.copy(b.userData.bindLocal); }
  // after posing: crozier upright, eyes onto the target
  function finish(look) {
    root.updateMatrixWorld(true);
    // the crozier stays upright, leaning a touch
    if (staffObj) {
      const pq = staffObj.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, 0, -0.08)).premultiply(root.getWorldQuaternion(new THREE.Quaternion()));
      staffObj.quaternion.copy(pq.multiply(want));
      staffObj.updateMatrixWorld(true);
    }
    // eyes lock onto the viewer
    for (const e of eyes) {
      e.holder.updateWorldMatrix(true, false);
      if (!look) break;
      const lp = e.holder.worldToLocal(look.clone());
      const yy = Math.max(-0.6, Math.min(0.6, Math.atan2(lp.x, lp.z)));
      const pp = Math.max(-0.4, Math.min(0.4, Math.atan2(lp.y, Math.hypot(lp.x, lp.z))));
      e.ball.rotation.set(-pp, yy, 0, 'YXZ');
    }
  }

  return { root, bones: B, skeleton, pose, rot, resetPose, finish, eyes, staff: staffObj, title: header.meta.title, height: header.meta.height * L.height, name, mats };
}
