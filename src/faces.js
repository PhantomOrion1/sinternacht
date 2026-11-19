// Almost-human heads: a sphere sculpted into a face, a painted skin texture,
// glossy eyes that follow you, eyelids, teeth, and a jaw that opens too far.
import * as THREE from 'three';
import { noiseSet, fbm, vnoise, normalFromHeight } from './textures.js';
import { makeRng } from './rng.js';

const g2 = (dx, dy, sx, sy) => Math.exp(-((dx * dx) / (sx * sx) + (dy * dy) / (sy * sy)));
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const DEFAULTS = {
  seed: 1, w: 0.86, h: 1.12, d: 0.98, jawW: 0.8, chin: 1, nose: 1, noseLen: 1, cheek: 1, hollow: 1, brow: 1,
  eyeGap: 1, eyeR: 0.135, eyeAsym: 0, lidUp: 22, lidDown: -24, iris: [120, 140, 160], irisR: 0.5, pupil: 0.32, milky: 0,
  mouthY: -0.42, mouthW: 1, smile: 0, lip: 1, slit: 0.035, teeth: null, gape: 1.1,
  skin: [200, 170, 150], rouge: null, lipCol: [150, 80, 80], browCol: null, browThick: 1, browArch: 0.4,
  wrinkles: 0, bags: 0.3, soot: 0, ears: true, gloss: 0.5,
};

function mouthY(x, o) { return o.mouthY + o.smile * 0.12 * Math.pow(x / (0.2 * o.mouthW), 2); }
function mouthWin(x, o) { return Math.exp(-Math.pow(Math.abs(x) / (0.21 * o.mouthW), 4)); }

function displace(x, y, z, o) {
  const f = sstep(-0.05, 0.45, z);
  if (f <= 0) return 0;
  let d = 0;
  for (const s of [-1, 1]) {
    const ex = s * 0.33 * o.eyeGap, ey = 0.12 + (s > 0 ? -o.eyeAsym * 0.04 : 0);
    d += -0.11 * g2(x - ex, y - ey, 0.15, 0.1);
    d += 0.045 * o.brow * g2(x - s * 0.32 * o.eyeGap, y - 0.27, 0.22, 0.055);
    d += 0.05 * o.cheek * g2(x - s * 0.45, y + 0.03, 0.16, 0.09);
    d += -0.035 * o.hollow * g2(x - s * 0.4, y + 0.3, 0.13, 0.12);
    d += 0.1 * o.nose * g2(x - s * 0.085, y + 0.17 * o.noseLen, 0.05, 0.045);
    d += 0.03 * g2(x - s * 0.6, y + 0.52, 0.12, 0.14);
    d += -0.04 * g2(x - s * 0.72, y - 0.28, 0.12, 0.15);
  }
  d += 0.02 * g2(x, y - 0.22, 0.08, 0.06);
  d += 0.13 * o.nose * g2(x, y - 0.02, 0.06, 0.17);
  d += 0.2 * o.nose * g2(x, y + 0.14 * o.noseLen, 0.085, 0.075);
  d += 0.035 * g2(x, y + 0.25, 0.045, 0.03);
  const m = mouthY(x, o), w = mouthWin(x, o);
  d += 0.05 * o.lip * w * g2(0, y - (m + 0.042), 1, 0.032);
  d += 0.06 * o.lip * w * g2(0, y - (m - 0.05), 1, 0.038);
  d += -0.05 * w * g2(0, y - m, 1, 0.014);
  d += 0.06 * o.chin * g2(x, y + 0.72, 0.16, 0.1);
  return d * f;
}

// unit direction -> sculpted surface point (head units)
function sculpt(nx, ny, nz, o) {
  let x = nx * o.w, y = ny * o.h, z = nz * o.d;
  const jt = sstep(0.05, -0.85, ny);
  x *= 1 - (1 - o.jawW) * jt;
  if (nz < 0) { const k = 1 + 0.07 * sstep(-0.3, 0.5, ny) * sstep(0, -0.8, nz); x *= k; z *= k; }
  if (nz > 0.55) z *= 1 - 0.07 * sstep(0.55, 1, nz);
  if (ny < -0.55 && nz > 0.2) z *= 1 + 0.06 * o.chin * sstep(-0.55, -0.85, ny);
  const dd = displace(nx, ny, nz, o);
  return [x + nx * dd, y + ny * dd, z + nz * dd];
}

function paintSkin(o) {
  const W = 512, H = 256;
  const N = noiseSet(o.seed * 13 + 7, [4, 8, 16, 32, 64]);
  const F = noiseSet(o.seed * 17 + 3, [64, 128]);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const hgt = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const theta = ((py + 0.5) / H) * Math.PI;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W, phi = u * Math.PI * 2;
      const x = -Math.cos(phi) * Math.sin(theta), y = Math.cos(theta), z = Math.sin(phi) * Math.sin(theta);
      const ax = Math.abs(x);
      const f = sstep(-0.05, 0.4, z);
      const n = fbm(N, u, py / H);
      const fine = vnoise(F[1], u * 128, (py / H) * 128);
      let col = o.skin.map((v) => v * (0.88 + n * 0.24));
      let h = fine * 0.03;
      if (o.rouge) col = mix(col, o.rouge, 0.42 * g2(ax - 0.42, y + 0.12, 0.13, 0.1) * f);
      col = col.map((v) => v * (1 - 0.22 * o.bags * g2(ax - 0.33, y + 0.03, 0.12, 0.045) * f));
      col = col.map((v) => v * (1 - 0.25 * g2(ax - 0.33, y - 0.12, 0.17, 0.12) * f));
      // lips + mouth line
      const m = mouthY(x, o), w = mouthWin(x, o);
      const lips = Math.max(g2(0, y - (m + 0.036), 1, 0.026), g2(0, y - (m - 0.045), 1, 0.032)) * w;
      col = mix(col, o.lipCol, Math.min(1, lips * 1.3) * f);
      col = mix(col, [18, 6, 6], g2(0, y - m, 1, 0.012) * w * f);
      // corners of a wide grin dig into the cheeks
      if (o.smile > 0) for (const s of [-1, 1]) col = col.map((v) => v * (1 - 0.35 * g2(x - s * 0.2 * o.mouthW * 1.05, y - mouthY(s * 0.2 * o.mouthW, o) - 0.02, 0.03, 0.03) * f));
      // nostrils
      col = col.map((v) => v * (1 - 0.75 * g2(ax - 0.045, y + 0.215 * o.noseLen, 0.022, 0.014) * f));
      // eyebrows
      if (o.browCol) {
        const bx = ax - 0.32 * o.eyeGap;
        const band = g2(bx, y - 0.29 - bx * bx * o.browArch * 2, 0.16, 0.024 * o.browThick);
        const hair = 0.5 + 0.5 * Math.sin(px * 1.7 + n * 20);
        col = mix(col, o.browCol, Math.min(1, band * 1.4 * (0.55 + hair * 0.45)) * f);
        h += band * hair * 0.12 * f;
      }
      // wrinkles
      if (o.wrinkles) {
        const fw = sstep(0.4, 0.5, y) * sstep(0.68, 0.58, y) * f * sstep(0.45, 0.6, fbm(N, u * 3, py / H));
        const line = Math.pow(0.5 + 0.5 * Math.sin(y * 70 + n * 9 + x * 4), 14);
        const crow = Math.pow(0.5 + 0.5 * Math.sin(Math.atan2(y - 0.1, ax - 0.48) * 14), 12) * g2(ax - 0.52, y - 0.1, 0.07, 0.08);
        const fold = g2(ax - (0.12 + (-0.2 - y) * 0.45), 0, 0.012, 1) * sstep(-0.16, -0.24, y) * sstep(-0.56, -0.42, y);
        const wr = (line * fw + crow * f + fold * f * 1.3) * o.wrinkles;
        h -= wr * 0.45;
        col = col.map((v) => v * (1 - 0.07 * wr));
      }
      // soot: grime, smudges, ash streaks (the helpers)
      if (o.soot) {
        const sm = fbm(N, u * 2, (py / H) * 2);
        col = col.map((v) => v * (0.75 + sm * 0.5));
        const ash = Math.pow(Math.max(0, fbm(N, u * 3 + 0.3, (py / H) * 1.5) - 0.55), 1.5) * 3;
        col = mix(col, [120, 116, 112], Math.min(0.5, ash) * o.soot);
        const streak = Math.pow(Math.max(0, Math.sin(px * 0.35 + n * 12)), 30) * sstep(0.2, -0.5, y);
        col = col.map((v) => v * (1 - 0.3 * streak * o.soot));
      }
      const i = (py * W + px) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
      hgt[py * W + px] = h;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  return { map, normal: normalFromHeight(hgt, W, 2.2, H) };
}

function paintEye(o, rng) {
  const W = 256, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#b89a92'); g.addColorStop(0.25, '#ece6dc'); g.addColorStop(0.5, '#c8aaa2'); g.addColorStop(0.75, '#b8968e'); g.addColorStop(1, '#b89a92');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // bloodshot veins creeping toward the iris
  x.strokeStyle = 'rgba(150,30,30,0.55)';
  for (let i = 0; i < 26; i++) {
    let px = W * 0.25 + (rng.chance(0.5) ? 1 : -1) * rng.range(30, 60), py = rng.range(10, H - 10);
    x.lineWidth = rng.range(0.4, 1.4);
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 5; k++) { px += (W * 0.25 - px) * 0.18 + rng.range(-4, 4); py += (H * 0.5 - py) * 0.12 + rng.range(-5, 5); x.lineTo(px, py); }
    x.stroke();
  }
  const cx = W * 0.25, cy = H / 2, r = (o.irisR * H) / Math.PI;
  const [ir, ig, ib] = o.iris;
  const ig2 = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  ig2.addColorStop(0, `rgb(${ir * 0.6},${ig * 0.6},${ib * 0.6})`);
  ig2.addColorStop(0.45, `rgb(${ir},${ig},${ib})`);
  ig2.addColorStop(0.85, `rgb(${ir * 0.75},${ig * 0.75},${ib * 0.75})`);
  ig2.addColorStop(1, 'rgb(25,22,22)');
  x.fillStyle = ig2; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = `rgba(${ir * 0.4},${ig * 0.4},${ib * 0.4},0.6)`; x.lineWidth = 0.8;
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; x.beginPath(); x.moveTo(cx + Math.cos(a) * r * 0.35, cy + Math.sin(a) * r * 0.35); x.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95); x.stroke(); }
  if (o.milky) { x.fillStyle = `rgba(225,228,230,${o.milky})`; x.beginPath(); x.arc(cx, cy, r * 1.02, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#050505'; x.beginPath(); x.arc(cx, cy, r * o.pupil, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const tmpV = new THREE.Vector3();
// faces are expensive to paint: build each distinct face once and share it
const CACHE = new Map();

function buildShared(o) {
  const rng = makeRng(o.seed * 7 + 1);
  const geo = new THREE.SphereGeometry(1, 72, 56);
  const pos = geo.attributes.position;
  const unit = new Float32Array(pos.array);
  const jawMorph = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const nx = unit[i * 3], ny = unit[i * 3 + 1], nz = unit[i * 3 + 2];
    const [x, y, z] = sculpt(nx, ny, nz, o);
    pos.setXYZ(i, x, y, z);
    // how much this vertex belongs to the jaw
    const m = mouthY(nx, o);
    const jw = sstep(m + 0.005, m - 0.05, ny) * sstep(-0.35, 0.3, nz) * (1 - 0.6 * sstep(0.5, 0.9, Math.abs(nx)));
    jawMorph[i * 3] = x;
    jawMorph[i * 3 + 1] = y - o.gape * jw;
    jawMorph[i * 3 + 2] = z - 0.12 * o.gape * jw;
  }
  // cut the lips apart
  const idx = geo.index.array, keep = [];
  const mw = 0.2 * o.mouthW * 1.02;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const cx = (unit[a * 3] + unit[b * 3] + unit[c * 3]) / 3, cy = (unit[a * 3 + 1] + unit[b * 3 + 1] + unit[c * 3 + 1]) / 3, cz = (unit[a * 3 + 2] + unit[b * 3 + 2] + unit[c * 3 + 2]) / 3;
    if (cz > 0.3 && Math.abs(cx) < mw && Math.abs(cy - mouthY(cx, o)) < o.slit) continue;
    keep.push(a, b, c);
  }
  geo.setIndex(keep);
  geo.morphAttributes.position = [new THREE.Float32BufferAttribute(jawMorph, 3)];
  geo.computeVertexNormals();
  const tex = paintSkin(o);
  const skinMat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: o.gloss, metalness: 0 });
  const cavityMat = new THREE.MeshBasicMaterial({ color: 0x0e0303 });
  const teethMat = o.teeth ? new THREE.MeshStandardMaterial({ color: o.teeth, roughness: 0.35 }) : null;
  const eyeMat = new THREE.MeshStandardMaterial({ map: paintEye(o, rng), roughness: 0.06, metalness: 0 });
  return { geo, skinMat, cavityMat, teethMat, eyeMat };
}

export function makeHead(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const key = JSON.stringify(o);
  if (!CACHE.has(key)) CACHE.set(key, buildShared(o));
  const { geo, skinMat, cavityMat, teethMat, eyeMat } = CACHE.get(key);
  const rng = makeRng(o.seed * 7 + 1);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geo, skinMat);
  mesh.castShadow = true;
  mesh.morphTargetInfluences = [0];
  group.add(mesh);
  // --- mouth interior + teeth
  const m0 = mouthY(0, o);
  const s0 = sculpt(0, m0, Math.sqrt(1 - m0 * m0), o);
  const cavity = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), cavityMat);
  cavity.position.set(0, s0[1] - 0.04, s0[2] - 0.38);
  cavity.scale.set(1, 0.6, 1);
  group.add(cavity);
  const jaw = new THREE.Group();
  group.add(jaw);
  const mats = [];
  if (o.teeth) {
    const tm = teethMat;
    const n = Math.round(9 * o.mouthW);
    for (let k = 0; k < n; k++) {
      const tx = (k / (n - 1) - 0.5) * 2 * 0.18 * o.mouthW;
      const my = mouthY(tx, o);
      const len = Math.sqrt(Math.max(0.01, 1 - tx * tx - my * my));
      const sp = sculpt(tx, my, len, o);
      const wdt = 0.36 * o.mouthW / n;
      for (const upper of [true, false]) {
        if (rng.chance(0.12)) continue; // missing tooth
        const h = rng.range(0.06, upper ? 0.11 : 0.08);
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(wdt * 0.85, h, 0.035), tm);
        tooth.position.set(sp[0] * 0.97, sp[1] + (upper ? 0.012 - h / 2 + o.slit * 0.6 : -0.012 + h / 2 - o.slit * 0.6), sp[2] - 0.045);
        tooth.rotation.set(rng.range(-0.15, 0.15), Math.atan2(tx, 0.6), rng.range(-0.18, 0.18));
        (upper ? group : jaw).add(tooth);
      }
    }
  }
  // --- eyes
  const eyes = [];
  for (const s of [-1, 1]) {
    const ex = s * 0.33 * o.eyeGap, ey = 0.12 + (s > 0 ? -o.eyeAsym * 0.04 : 0);
    const dir = new THREE.Vector3(ex, ey, Math.sqrt(1 - ex * ex - ey * ey)).normalize();
    const sp = sculpt(dir.x, dir.y, dir.z, o);
    const r = o.eyeR * (s > 0 ? 1 + o.eyeAsym * 0.25 : 1);
    const holder = new THREE.Group();
    holder.position.set(sp[0] - dir.x * r * 0.5, sp[1] - dir.y * r * 0.5, sp[2] - dir.z * r * 0.5);
    group.add(holder);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), eyeMat);
    holder.add(ball);
    // lids
    const up = new THREE.Mesh(new THREE.SphereGeometry(r * 1.07, 20, 10, 0, Math.PI * 2, 0, 1.25), skinMat);
    up.rotation.x = (Math.PI / 2 - 1.25) - THREE.MathUtils.degToRad(o.lidUp);
    holder.add(up);
    const lo = new THREE.Mesh(new THREE.SphereGeometry(r * 1.06, 20, 10, 0, Math.PI * 2, Math.PI - 1.25, 1.25), skinMat);
    lo.rotation.x = THREE.MathUtils.degToRad(o.lidDown) + (Math.PI / 2 - 1.25);
    holder.add(lo);
    eyes.push({ holder, ball, up, lo, upRest: up.rotation.x });
  }
  // --- ears
  if (o.ears) {
    for (const s of [-1, 1]) {
      const sp = sculpt(s * 0.99, 0.02, -0.12, o);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skinMat);
      ear.scale.set(0.35, 1.25, 0.8);
      ear.position.set(sp[0] + s * 0.02, sp[1] - 0.02, sp[2]);
      ear.rotation.set(0, s * 0.35, s * 0.08);
      ear.castShadow = true;
      group.add(ear);
    }
  }
  const api = {
    group, mesh, jaw, eyes, mats, o,
    setJaw(v) {
      mesh.morphTargetInfluences[0] = v;
      jaw.position.set(0, -o.gape * v, -0.12 * o.gape * v);
      cavity.scale.set(1 + v * 0.2, 0.6 + v * 2.4, 1);
      cavity.position.y = s0[1] - 0.04 - o.gape * v * 0.45;
    },
    // eyes turn to look at a world point (clamped like real eyes... almost)
    look(world, limit = 0.55) {
      for (const e of eyes) {
        e.holder.updateWorldMatrix(true, false);
        tmpV.copy(world);
        e.holder.parent.worldToLocal(tmpV);
        tmpV.sub(e.holder.position);
        const yaw = THREE.MathUtils.clamp(Math.atan2(tmpV.x, tmpV.z), -limit, limit);
        const pitch = THREE.MathUtils.clamp(Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z)), -limit * 0.7, limit * 0.7);
        e.ball.rotation.set(-pitch, yaw, 0, 'YXZ');
      }
    },
    blink(k) { for (const e of eyes) e.up.rotation.x = e.upRest + k * 1.1; },
    dispose() { /* shared + cached for the whole session */ },
  };
  api.setJaw(0);
  return api;
}

// a bunch of hair strands, merged into one mesh (head units)
export function hairStrands(count, fn, mat) {
  const geos = [];
  for (let i = 0; i < count; i++) {
    const s = fn(i);
    if (!s) continue;
    const g = new THREE.ConeGeometry(s.r, s.len, 3, 1, true);
    g.translate(0, -s.len / 2, 0);
    g.rotateX(s.rx || 0); g.rotateZ(s.rz || 0); g.rotateY(s.ry || 0);
    g.translate(s.x, s.y, s.z);
    geos.push(g.toNonIndexed());
  }
  const merged = new THREE.BufferGeometry();
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const P = new Float32Array(total * 3), Nn = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) { P.set(g.attributes.position.array, off * 3); Nn.set(g.attributes.normal.array, off * 3); off += g.attributes.position.count; g.dispose(); }
  merged.setAttribute('position', new THREE.BufferAttribute(P, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  return mesh;
}
