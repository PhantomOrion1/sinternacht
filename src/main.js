// SINTERNACHT — main loop, menus, co-op sync, scares.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildTextures, setAnisotropy, scareFace } from './textures.js';
import { Castle, CELL, WALL_H } from './castle.js';
import { AudioEngine } from './audio.js';
import { Santa } from './santa.js';
import { Elves } from './elves.js';
import { Items, PART_NAMES, buildCrossbow } from './items.js';
import { Player, RemotePlayer } from './player.js';
import { Net, loadIceConfig } from './net.js';
import { Particles, FinalShader } from './fx.js';
import { R, clamp, damp, lerp, angleDiff } from './rng.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- settings
const settings = { sens: 1, vol: 0.9, scareVol: 1, quality: 'high', invertY: false, name: '' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('sinternacht') || '{}')); } catch (e) { /* private mode */ }
const saveSettings = () => { try { localStorage.setItem('sinternacht', JSON.stringify(settings)); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, settings.quality === 'low' ? 0.75 : 1.5);
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('game').appendChild(renderer.domElement);
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x020101, 0.072);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 90);
camera.rotation.order = 'YXZ';
scene.add(camera);
const hemi = new THREE.HemisphereLight(0x46526e, 0x160e08, 0.07);
scene.add(hemi);
// harsh up-light used only during jumpscares (always in the scene so shaders never recompile mid-scare)
const scareLight = new THREE.PointLight(0xfff4e8, 0, 3, 2);
scene.add(scareLight);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.5, 0.45, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finalPass = new ShaderPass(FinalShader);
composer.addPass(finalPass);
const U = finalPass.uniforms;
bloom.enabled = settings.quality !== 'low';

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

let T = null;
const audio = new AudioEngine();
audio.setVolume(settings.vol);
audio.setScareVolume(settings.scareVol);
let particles = null;
// faint blood trails on the floor: red for you, blue for your friend
const TRAIL_MAX = 900;
let trails = null;
function makeTrails() {
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ map: T.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
  const mesh = new THREE.InstancedMesh(g, m, TRAIL_MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < TRAIL_MAX; i++) { mesh.setMatrixAt(i, zero); mesh.setColorAt(i, new THREE.Color(0, 0, 0)); }
  scene.add(mesh);
  trails = { mesh, next: 0, life: new Float32Array(TRAIL_MAX), base: [], last: {}, m4: new THREE.Matrix4(), col: new THREE.Color() };
}
function dropTrail(key, x, z, rgb) {
  const L = trails.last[key];
  if (L && Math.hypot(L[0] - x, L[1] - z) < 0.55) return;
  trails.last[key] = [x, z];
  const i = trails.next; trails.next = (i + 1) % TRAIL_MAX;
  const s = R(0.12, 0.22);
  trails.m4.makeRotationY(Math.random() * 6).scale(new THREE.Vector3(s, 1, s * R(0.7, 1.3))).setPosition(x + R(-0.12, 0.12), 0.012, z + R(-0.12, 0.12));
  trails.mesh.setMatrixAt(i, trails.m4);
  trails.life[i] = 1; trails.base[i] = rgb;
  trails.mesh.instanceMatrix.needsUpdate = true;
}
function updateTrails(dt) {
  if (!trails) makeTrails();
  if (meAlive()) dropTrail('me', player.pos.x, player.pos.z, [0.55, 0.02, 0.02]);
  if (G.remote && G.status[G.remote.id] === 'alive') dropTrail('friend', G.remote.v.x, G.remote.v.z, [0.03, 0.12, 0.6]);
  let dirty = false;
  for (let i = 0; i < TRAIL_MAX; i++) {
    if (trails.life[i] <= 0) continue;
    trails.life[i] = Math.max(0, trails.life[i] - dt / 90);
    const b = trails.base[i], k = Math.min(1, trails.life[i] * 1.5);
    trails.mesh.setColorAt(i, trails.col.setRGB(b[0] * k, b[1] * k, b[2] * k));
    dirty = true;
  }
  if (dirty) trails.mesh.instanceColor.needsUpdate = true;
}
// a glowing path on the floor leading to your friend's sack
const GUIDE_MAX = 400;
let guide = null;
function updateGuide(dt, t) {
  if (!guide) {
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ map: T.glow, color: 0xffc860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const mesh = new THREE.InstancedMesh(g, m, GUIDE_MAX); mesh.frustumCulled = false; mesh.count = 0;
    scene.add(mesh);
    guide = { mesh, t: 0, pts: [] };
  }
  const sack = [...world.items.sacks.values()].find((s) => s.pid !== G.localId);
  if (!sack || !meAlive()) { guide.mesh.count = 0; return; }
  guide.t -= dt;
  if (guide.t <= 0) {
    guide.t = 0.5;
    const C = world.castle;
    const [cx, cy] = C.cellAt(player.pos.x, player.pos.z);
    const way = [[player.pos.x, player.pos.z], ...C.path(cx, cy, sack.x, sack.z)];
    const pts = [];
    for (let i = 0; i < way.length - 1; i++) {
      const [ax, az] = way[i], [bx, bz] = way[i + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.floor(L / 0.7));
      for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    guide.pts = pts.slice(1, GUIDE_MAX);
  }
  const m4 = new THREE.Matrix4();
  guide.pts.forEach(([x, z], i) => {
    const s = 0.22 + 0.08 * Math.sin(t * 4 - i * 0.5);
    m4.makeScale(s, 1, s).setPosition(x, 0.015, z);
    guide.mesh.setMatrixAt(i, m4);
  });
  guide.mesh.count = guide.pts.length;
  guide.mesh.instanceMatrix.needsUpdate = true;
}
function clearTrails() {
  if (guide) { scene.remove(guide.mesh); guide.mesh.dispose(); guide = null; }
  if (!trails) return;
  scene.remove(trails.mesh); trails.mesh.dispose(); trails = null;
}
let player = null;
let world = null;
let G = null; // the running game
let net = null;
let menu = null;

// ---------------------------------------------------------------- torch light pool
const POOL = 6, LIGHT_K = 2.4;
const pool = Array.from({ length: POOL }, () => { const l = new THREE.PointLight(0xff8a3a, 0, 9, 2); scene.add(l); return { l, a: null, fade: 0 }; });
let poolT = 0, lightning = -1;
function updateLights(dt, t) {
  const C = world?.castle;
  if (!C) return;
  poolT -= dt;
  const cam = camera.position;
  if (poolT <= 0) {
    poolT = 0.3;
    const cand = C.lights.filter((a) => !a.out && (a.power > 0)).map((a) => [a, (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2]).filter((e) => e[1] < 30 * 30).sort((a, b) => a[1] - b[1]).slice(0, POOL).map((e) => e[0]);
    const keep = new Set(cand);
    for (const p of pool) if (p.a && !keep.has(p.a)) p.a = null;
    for (const a of cand) if (!pool.some((p) => p.a === a)) { const free = pool.find((p) => !p.a); if (free) { free.a = a; free.fade = 0; } }
  }
  const L = lightning >= 0 ? lightningLevel(lightning) : 0;
  for (const p of pool) {
    const a = p.a;
    if (!a) { p.l.intensity = 0; continue; }
    p.fade = Math.min(1, p.fade + dt * 2.5);
    p.l.position.set(a.x, a.y, a.z);
    p.l.color.setHex(a.color);
    p.l.distance = a.range;
    const fl = a.flicker ? 1 - a.flicker * (0.35 + 0.35 * Math.sin(t * 11 + a.x * 3) * Math.sin(t * 7.3 + a.z) + Math.random() * 0.3) : 1;
    p.l.intensity = (a.out ? 0 : a.power * LIGHT_K * fl * p.fade) * (a.moon ? 1 + L * 40 : 1);
  }
}
function lightningLevel(t) {
  if (t < 0.07) return 1;
  if (t < 0.16) return 0.08;
  if (t < 0.26) return 0.75;
  return Math.max(0, 0.75 * (1 - (t - 0.26) / 0.5));
}

// ---------------------------------------------------------------- input
const keys = {};
const input = () => ({
  f: keys.KeyW || keys.ArrowUp, b: keys.KeyS || keys.ArrowDown, l: keys.KeyA || keys.ArrowLeft, r: keys.KeyD || keys.ArrowRight,
  sprint: keys.ShiftLeft || keys.ShiftRight, crouch: keys.KeyC,
});
const locked = () => document.pointerLockElement === renderer.domElement;
function lock() {
  const el = renderer.domElement;
  try {
    const p = el.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { el.requestPointerLock()?.catch?.(() => {}); } catch (e) { /* ignore */ } });
  } catch (e) { try { el.requestPointerLock(); } catch (e2) { /* ignore */ } }
}
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (!G || G.ended) return;
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyF' && meAlive() && !e.repeat) player.toggleLight();
  if (e.code === 'KeyE' && !e.repeat) interactPress();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
document.addEventListener('mousemove', (e) => {
  if (!locked() || !G || G.ended) return;
  player.look(e.movementX, e.movementY * (settings.invertY ? -1 : 1), settings.sens);
});
document.addEventListener('mousedown', (e) => { if (locked() && e.button === 0) shoot(); });
renderer.domElement.addEventListener('click', () => { if (G && !G.ended) lock(); });
document.addEventListener('pointerlockchange', () => {
  if (!G || G.ended) return;
  if (locked()) { $('paused').hidden = true; G.paused = false; }
  else {
    $('paused').hidden = false;
    $('pauseNote').textContent = G.mode === 'solo' ? '' : "The castle doesn't pause. Hurry back.";
    if (G.mode === 'solo') G.paused = true;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G && G.mode === 'solo' && !G.ended) {
    G.paused = true;
    $('paused').hidden = false;
    $('pauseNote').textContent = '';
  }
});

// ---------------------------------------------------------------- screens
const SCREENS = ['splash', 'menu', 'howto', 'settings', 'lobby', 'paused', 'dead', 'end'];
function show(id) { for (const s of SCREENS) $(s).hidden = s !== id; }
let msgTimer = 0;
function showMsg(text, dur = 3.5) {
  const m = $('msg');
  m.textContent = text;
  m.classList.add('on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => m.classList.remove('on'), dur * 1000);
}

// ---------------------------------------------------------------- world
function disposeWorld() {
  if (!world) return;
  scene.remove(world.castle.group, world.santa.root, world.elves.group, world.items.group);
  world.castle.dispose(); world.santa.dispose(); world.elves.dispose(); world.items.dispose();
  particles?.clear();
  world = null;
}
function buildWorld(seed) {
  disposeWorld();
  const castle = new Castle(seed, T);
  const santa = new Santa(T, castle);
  const elves = new Elves(T, castle, seed);
  const items = new Items(castle, T);
  scene.add(castle.group, santa.root, elves.group, items.group);
  world = { seed, castle, santa, elves, items };
  player.castle = castle;
  santa.onStep = (x, z, heavy) => audio.santaStep({ x, y: 0.1, z }, santaOccl(), heavy);
  elves.onSound = null;
  return world;
}
let lastSantaOccl = 0;
const santaOccl = () => lastSantaOccl;
function occlFrom(x, z) {
  const c = camera.position;
  if (!world.castle.lineOfSight(c.x, c.z, x, z)) return clamp((Math.hypot(c.x - x, c.z - z) - 2) / 8, 0.45, 1);
  return 0;
}
function elfSound(type, x, z) {
  if (!world) return;
  const o = occlFrom(x, z);
  if (type === 'giggle') audio.elfGiggle({ x, y: 1, z }, o, 0.45);
  else if (type === 'scratch') audio.elfScratch({ x, y: 0.2, z }, o);
  else if (type === 'whisper') audio.whisper({ x, y: 1.3, z }, o, 0.22, 5);
  else if (type === 'poof') { particles.burst(x, 0.8, z, { count: 50, size: 0.5, speed: 1.4, life: 2 }); audio.whisper({ x, y: 1, z }, o, 0.3, 1); }
}

// ---------------------------------------------------------------- menu scene
function startMenuScene() {
  G = null;
  show('menu');
  $('hud').hidden = true;
  U.blackout.value = 0; U.white.value = 0; U.red.value = 0; U.scare.value = 0;
  buildWorld(Math.floor(Math.random() * 1e9));
  const C = world.castle;
  // find a doorway with a cell behind it; He stands just past it
  let spot = null;
  for (let tries = 0; tries < 200 && !spot; tries++) {
    const x = Math.floor(Math.random() * C.N), y = Math.floor(Math.random() * C.N);
    for (let d = 0; d < 4; d++) if (C.edge(x, y, d) === 1 && C.passable(x, y, d)) { spot = { x, y, d }; break; }
  }
  spot ||= { x: 0, y: 0, d: 1 };
  const D = [[0, -1], [1, 0], [0, 1], [-1, 0]][spot.d];
  const [cx, cz] = C.center(spot.x, spot.y);
  menu = { cam: new THREE.Vector3(cx - D[0] * 2.4, 1.6, cz - D[1] * 2.4), look: new THREE.Vector3(cx + D[0] * 9.5, 2.3, cz + D[1] * 9.5), t: 0 };
  const S = world.santa;
  S.s.x = S.v.x = cx + D[0] * 9.5; S.s.z = S.v.z = cz + D[1] * 9.5;
  S.s.yaw = Math.atan2(-D[0], -D[1]);
  S.s.mode = 'search';
  player.reset(menu.cam.x, menu.cam.z, 0);
  audio.stopAll();
}
function updateMenu(dt, t) {
  if (!world || !menu) return;
  menu.t += dt;
  const S = world.santa;
  camera.position.set(menu.cam.x + Math.sin(t * 0.21) * 0.25, 1.6 + Math.sin(t * 0.37) * 0.04, menu.cam.z + Math.cos(t * 0.17) * 0.25);
  camera.lookAt(menu.look.x + Math.sin(t * 0.13) * 0.4, menu.look.y + Math.sin(t * 0.3) * 0.1, menu.look.z);
  camera.fov = 60; camera.updateProjectionMatrix();
  // He watches. Every so often the head turns too far.
  const toCam = Math.atan2(camera.position.x - S.s.x, camera.position.z - S.s.z);
  const phase = Math.sin(t * 0.23);
  S.s.headYaw = phase > 0.6 ? 0 : angleDiff(S.s.yaw, toCam) + Math.sin(t * 0.9) * 0.2;
  S.s.headPitch = -0.2;
  S.s.mode = phase > 0.6 ? 'search' : 'wander';
  S.s.speed = 0;
  S.animate(dt, t, camera.position);
  world.elves.animate(dt, t, camera.position, null);
  world.castle.update(t);
  player.updateLight(dt, t, { forceOn: true, danger: 0.15 });
  audio.setListener(camera.position, camera.getWorldDirection(new THREE.Vector3()));
  if (audio.ready) {
    audio.startAmbience();
    audio.updateSantaVoice({ x: S.s.x, z: S.s.z }, 0, 'wander', false);
    audio.setMood(0.15, 0, 0, 0.25);
    audio.tick();
  }
  updateLights(dt, t);
}

// ---------------------------------------------------------------- game start / end
const otherId = (id) => (id === 'p1' ? 'p2' : 'p1');
const isHost = () => G && G.mode !== 'guest';
const meAlive = () => G && G.status[G.localId] === 'alive';

function startGame({ seed, mode, localId, names }) {
  show(null);
  menu = null;
  $('hud').hidden = false;
  buildWorld(seed);
  const C = world.castle;
  const [sx, sz] = C.spawnPos;
  const off = mode === 'solo' ? 0 : localId === 'p1' ? -0.9 : 0.9;
  player.reset(sx + Math.cos(C.spawnYaw) * off, sz - Math.sin(C.spawnYaw) * off, C.spawnYaw);
  G = {
    mode, localId, names, seed,
    status: { [localId]: 'alive' },
    remote: null,
    parts: 0, crossbow: false, bolts: 0, reloadT: 0, recoil: 0,
    time: 0, ended: false, paused: false,
    doorId: 0, doorT: R(210, 270), passT: 0, lightT: R(35, 60), fakeT: R(30, 45), bellT: 150, holdKey: '', grindT: 0,
    noises: [], timers: [], grabUntil: {}, safeUntil: {},
    scare: null, escaping: null, spectate: false, holdT: 0, focus: null,
    sendT: 0, losT: 0, santaLos: false, sackCryT: 5,
    stats: { hits: 0 }, phantom: null, introT: 0,
  };
  if (mode !== 'solo') {
    const oid = otherId(localId);
    G.status[oid] = 'alive';
    G.remote = new RemotePlayer(names[oid], T);
    G.remote.id = oid;
    G.remote.addTo(scene);
    G.remote.set([sx - Math.cos(C.spawnYaw) * off, sz + Math.sin(C.spawnYaw) * off, C.spawnYaw, 0, 1, 0, 0, 0]);
  }
  world.santa.isHost = mode !== 'guest';
  world.elves.isHost = mode !== 'guest';
  // HUD
  $('parts').innerHTML = PART_NAMES.map((n, i) => `<div class="part" data-i="${i}"><span class="pip"></span>${n}</div>`).join('');
  $('objAlt').textContent = '…or find the old way out, sealed deep inside, behind a wall.';
  $('ammo').hidden = true;
  $('partner').hidden = mode === 'solo';
  // crossbow view model
  if (G.bow) camera.remove(G.bow);
  G.bow = buildCrossbow({
    wood: new THREE.MeshLambertMaterial({ map: T.wood.map, color: 0x6a5a4a }),
    steel: new THREE.MeshLambertMaterial({ color: 0x4a4e54 }),
    gut: new THREE.MeshLambertMaterial({ color: 0x6a604a }),
    silver: new THREE.MeshLambertMaterial({ color: 0x8a9098, emissive: 0x0c0e10 }),
  });
  G.bow.position.set(0.24, -0.24, -0.5);
  G.bow.rotation.set(0.04, 0.06, 0);
  G.bow.visible = false;
  camera.add(G.bow);
  camera.fov = 72; camera.updateProjectionMatrix();
  // phantom for fake scares
  clearTrails();
  G.phantom = world.elves.makePhantom();
  world.items.addDoor({ id: 1, fx: C.exitFace.x, fy: C.exitFace.y, side: C.exitFace.side, life: 1e9, born: Date.now() - 10000, permanent: true });
  G.vaultAlarm = 0; G.vaultIdle = 0;
  try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
  U.blackout.value = 1; U.white.value = 0; U.red.value = 0; U.scare.value = 0;
  audio.stopAll();
  audio.startAmbience();
  setTimeout(() => audio.bellToll(), 800);
  intro();
  lock();
}

function intro() {
  const box = $('intro');
  box.hidden = false;
  const lines = ['5 December. Pakjesavond.', 'Your name is in His book.', 'Find the four parts of the Silver Crossbow…', 'Some walls are not walls. He cannot follow you through them.', 'Somewhere deep inside, behind a wall, is the old way out.'];
  box.innerHTML = '<p></p>';
  const p = box.firstChild;
  let i = 0;
  const next = () => {
    if (!G || i >= lines.length) { p.classList.remove('on'); setTimeout(() => { box.hidden = true; }, 1200); return; }
    p.textContent = lines[i++];
    p.classList.add('on');
    setTimeout(() => { p.classList.remove('on'); setTimeout(next, 900); }, 1700);
  };
  next();
}

function quitToMenu() {
  if (G?.remote) G.remote.removeFrom(scene);
  if (G?.bow) camera.remove(G.bow);
  if (G?.phantom) world?.elves.group.remove(G.phantom.root);
  G = null;
  try { document.exitPointerLock(); } catch (e) { /* ignore */ }
  net?.close(); net = null;
  $('hud').hidden = true;
  $('fade').style.opacity = 0;
  $('intro').hidden = true;
  startMenuScene();
}

function showEnd(ev) {
  if (!G || G.ended) return;
  G.ended = true;
  try { document.exitPointerLock(); } catch (e) { /* ignore */ }
  audio.stopAll();
  const me = (ev.status || G.status)[G.localId];
  const friend = G.remote ? G.names[G.remote.id] : null;
  const fstat = G.remote ? (ev.status || G.status)[G.remote.id] : null;
  let title = 'Meegenomen', text = "He stuffed you in His sack. You're going to Spain.", win = false;
  if (ev.result === 'kill') { title = 'De Sint is dood'; text = 'One silver bolt. He folded up like a broken umbrella and crumbled into soot. The castle is quiet. For now.'; win = true; }
  else if (ev.result === 'escape') {
    if (me === 'escaped') {
      win = true; title = 'Ontsnapt';
      text = 'You crawled out into the snow. Behind you, somewhere in the walls, something is humming.';
      if (friend && fstat === 'taken') text = `You got out. ${friend} didn't. You can still hear them screaming inside the sack.`;
    } else { title = 'Meegenomen'; text = `${friend || 'Your friend'} got out. You're in the sack, on your way to Spain.`; }
  } else if (ev.result === 'disconnect') { title = 'Verbroken'; text = 'The connection to your friend is gone. So is your friend.'; }
  else if (friend) text = `He got both of you. Two sacks, one long trip to Spain.`;
  $('endTitle').textContent = title;
  $('endText').textContent = text;
  $('endStats').innerHTML = `Survived ${fmtTime(ev.time ?? G.time)} · Crossbow parts ${G.parts}/4 · Bolts that hit ${G.stats.hits}`;
  $('end').classList.toggle('win', win);
  $('again').hidden = G.mode === 'guest' || ev.result === 'disconnect';
  $('again').textContent = 'Play again';
  if (G.mode === 'guest' && ev.result !== 'disconnect') $('endStats').innerHTML += '<br>Waiting for the host to start again…';
  $('dead').hidden = true;
  setTimeout(() => {
    show('end');
    $('hud').hidden = true;
    U.blackout.value = 0.6; U.white.value = 0; U.red.value = 0; U.scare.value = 0;
    if (win) audio.victory();
  }, ev.result === 'escape' && me === 'escaped' ? 400 : 1200);
}

// ---------------------------------------------------------------- events (host decides, everyone applies)
function emit(ev) {
  applyEvent(ev);
  net?.send({ t: 'ev', ev });
}
function name(id) { return G.names[id] || (id === 'p1' ? 'Host' : 'Friend'); }

function applyEvent(ev) {
  if (!G || !world) return;
  const W = world, S = W.santa;
  const local = G.localId;
  switch (ev.k) {
    case 'part': {
      if (!W.items.takePart(ev.i)) break;
      G.parts++;
      document.querySelector(`.part[data-i="${ev.i}"]`)?.classList.add('got');
      audio.pickup();
      showMsg(ev.by === local ? `You found the ${PART_NAMES[ev.i]}.` : `${name(ev.by)} found the ${PART_NAMES[ev.i]}.`);
      break;
    }
    case 'assembled': {
      G.crossbow = true; G.bolts = 3; G.reloadT = 0;
      audio.sting();
      setTimeout(() => showMsg('The Silver Crossbow is whole. Hunt Him. (Left click)', 5), 1800);
      $('objAlt').textContent = 'One silver bolt will put Him down. You have three.';
      break;
    }
    case 'battery': {
      if (!W.items.takeBattery(ev.i)) break;
      if (ev.by === local) { player.battery = Math.min(100, player.battery + 45); audio.battery(); showMsg('Fresh battery.', 1.8); }
      break;
    }
    case 'door+': W.items.addDoor({ ...ev.d, born: Date.now() - (ev.d.age || 0) * 1000 }); break;
    case 'door-': W.items.removeDoor(ev.id); break;
    case 'doorOpen': {
      const d = W.items.openDoor(ev.id);
      if (d) audio.stoneGrind({ x: d.x, y: 1.2, z: d.z }, 1.6);
      break;
    }
    case 'escaping': {
      G.status[ev.id] = 'escaping';
      if (ev.id === local) {
        const d = W.items.doors.get(ev.door);
        G.escaping = { t: 0, from: camera.position.clone(), yaw: player.yaw, pitch: player.pitch, door: d };
        player.frozen = 99;
      }
      break;
    }
    case 'escaped': {
      G.status[ev.id] = 'escaped';
      if (ev.id === local) {
        G.escaping = null;
        U.white.value = 0;
        $('deadTitle').textContent = 'Ontsnapt';
        $('deadText').textContent = G.remote && G.status[G.remote.id] === 'alive' ? `You're out. ${name(G.remote.id)} is still inside.` : "You're out.";
        $('dead').hidden = false;
        U.blackout.value = 1;
        setTimeout(() => { if (G && !G.ended) { $('dead').hidden = true; U.blackout.value = 0; } }, 3500);
      } else showMsg(`${name(ev.id)} escaped through a hidden passage.`, 4);
      break;
    }
    case 'caught': {
      G.status[ev.id] = 'taken';
      if (ev.id === local) startSantaScare();
      else {
        const r = G.remote?.v;
        if (r) audio.distantScream({ x: r.x, y: 1.6, z: r.z });
        audio.sting();
        showMsg(`${name(ev.id)} was taken.`, 4);
      }
      if (isHost() && G.mode !== 'solo') {
        G.timers.push({ at: G.time + 4, fn: () => {
          const spot = sackSpot();
          if (spot && G.status[ev.id] === 'taken') emit({ k: 'sack', id: ev.id, x: spot[0], z: spot[1] });
        } });
      }
      break;
    }
    case 'sack': {
      W.items.addSack(ev.id, ev.x, ev.z);
      if (ev.id !== local) showMsg(`${name(ev.id)} is in His sack. Follow the glowing path and cut them down.`, 6);
      else showMsg(`You're in His sack. ${G.remote ? name(G.remote.id) : 'Your friend'} can follow a path to you. Watch them.`, 6);
      break;
    }
    case 'freed': {
      W.items.removeSack(ev.id);
      G.status[ev.id] = 'alive';
      G.safeUntil[ev.id] = G.time + 4;
      if (ev.id === local) {
        player.pos.x = ev.x; player.pos.z = ev.z + 0.6;
        player.frozen = 0; player.trauma = 0.5;
        G.spectate = false;
        $('dead').hidden = true; U.blackout.value = 0;
        showMsg(`${name(ev.by)} cut you down. Move.`, 4);
      } else showMsg(`You cut ${name(ev.id)} down.`, 3);
      break;
    }
    case 'grab': {
      if (ev.id === local) startElfScare(ev.elf);
      if (isHost()) { G.grabUntil[ev.id] = G.time + 2.4; const p = aiPlayers().find((q) => q.id === ev.id); if (p) G.noises.push({ x: p.x, z: p.z, r: 32 }); }
      break;
    }
    case 'shot': {
      if (ev.by !== local) {
        const o = new THREE.Vector3(...ev.o), d = new THREE.Vector3(...ev.d);
        W.items.fireBolt(o, d, ev.len);
        if (ev.hit) W.items.bolts[W.items.bolts.length - 1].hidden = true;
        audio.crossbow(o);
      }
      break;
    }
    case 'santaHit': {
      S.s.hp = ev.hp;
      const p = S.parts.torso.getWorldPosition(new THREE.Vector3());
      audio.santaHurt({ x: p.x, y: 2.5, z: p.z });
      particles.burst(p.x, p.y + 0.6, p.z, { count: 40, color: 0x2a0303, size: 0.3, speed: 2.2, life: 1.4 });
      if (ev.hp > 0) showMsg(ev.hp === 1 ? 'He shrieks. One more.' : `He shrieks. ${ev.hp} more.`, 3);
      break;
    }
    case 'santaDead': {
      S.s.mode = 'dead'; S.setMode && isHost() && S.setMode('dead');
      G.santaDeadAt = G.time;
      const p = S.parts.torso.getWorldPosition(new THREE.Vector3());
      audio.santaDeath({ x: p.x, y: 2, z: p.z });
      setTimeout(() => { if (world) particles.burst(world.santa.v.x, 1.2, world.santa.v.z, { count: 160, size: 0.9, speed: 2.5, life: 3.5, up: 1.2 }); }, 1800);
      showMsg('He is falling apart…', 4);
      break;
    }
    case 'shriek': {
      audio.santaShriek({ x: S.v.x, y: 2.6, z: S.v.z }, santaOccl());
      break;
    }
    case 'lightning': {
      lightning = 0;
      audio.thunder(R(0.6, 2));
      break;
    }
    case 'passActive': W.items.setPassagesActive(ev.ids); break;
    case 'vaultIn': {
      const S2 = W.santa;
      audio.doorSlam({ x: S2.s.x, y: 1.5, z: S2.s.z }, 0);
      audio.sting();
      if (W.castle.inVault(camera.position.x, camera.position.z)) showMsg('Something came through the wall.', 2.5);
      break;
    }
    case 'passOpen': { const P = W.items.openPassage(ev.id, ev.a); if (P) audio.stoneGrind({ x: P.x, y: 1.2, z: P.z }, 0.7); break; }
    case 'passClose': { const P = W.items.closePassage(ev.id); if (P) audio.stoneGrind({ x: P.x, y: 1.2, z: P.z }, 0.6); break; }
    case 'end': showEnd(ev); break;
  }
}

function sackSpot() {
  const C = world.castle;
  const alive = aiPlayers().filter((p) => p.alive);
  const dists = alive.map((p) => { const [x, y] = C.cellAt(p.x, p.z); return C.bfs(x, y); });
  const opts = [];
  for (let y = 0; y < C.N; y++) for (let x = 0; x < C.N; x++) {
    if (dists.every((d) => d[y * C.N + x] >= 3)) opts.push(C.center(x, y));
  }
  if (!opts.length) return C.center(Math.floor(C.N / 2), Math.floor(C.N / 2));
  return opts[Math.floor(Math.random() * opts.length)];
}

// players as the monsters see them
let aiCache = null, aiCacheT = -1;
function aiPlayers() {
  if (aiCacheT === G.time && aiCache) return aiCache;
  const mk = (id, x, z, yaw, flash, crouch, sprint) => ({
    id, x, z, camYaw: yaw, flash, crouch, sprint,
    alive: G.status[id] === 'alive',
    safe: G.status[id] !== 'alive' || (G.safeUntil[id] || 0) > G.time,
    grabbed: (G.grabUntil[id] || 0) > G.time,
  });
  const out = [mk(G.localId, player.pos.x, player.pos.z, player.yaw, player.lightOn(), player.crouch, player.sprinting)];
  if (G.remote && G.status[G.remote.id] !== 'gone') {
    const s = G.remote.state;
    out.push(mk(G.remote.id, s.x, s.z, s.yaw, s.flash, s.crouch, s.sprint));
  }
  aiCache = out; aiCacheT = G.time;
  return out;
}

// requests: guest asks, host decides
function request(req) {
  if (isHost()) handleRequest(G.localId, req);
  else net?.send({ t: 'req', req });
}
function handleRequest(from, req) {
  if (!G || G.ended || !world) return;
  const W = world;
  const pos = aiPlayers().find((p) => p.id === from);
  switch (req.k) {
    case 'part': {
      const p = W.items.parts[req.id];
      if (!p || p.taken || G.status[from] !== 'alive') break;
      emit({ k: 'part', i: req.id, by: from });
      if (pos) G.noises.push({ x: pos.x, z: pos.z, r: 9 });
      if (W.items.parts.every((q) => q.taken)) emit({ k: 'assembled' });
      break;
    }
    case 'battery': {
      const b = W.items.batteries[req.id];
      if (!b || b.taken) break;
      emit({ k: 'battery', i: req.id, by: from });
      break;
    }
    case 'door': {
      const d = W.items.doors.get(req.id);
      if (!d || G.status[from] !== 'alive') break;
      if (!d.open) emit({ k: 'doorOpen', id: req.id });
      d.life = Math.max(d.life, (Date.now() - d.born) / 1000 + 20);
      emit({ k: 'escaping', id: from, door: req.id });
      if (pos) G.noises.push({ x: pos.x, z: pos.z, r: 14 });
      G.timers.push({ at: G.time + 1.8, fn: () => emit({ k: 'escaped', id: from }) });
      break;
    }
    case 'sack': {
      const s = W.items.sacks.get(req.id);
      if (!s || G.status[req.id] !== 'taken' || G.status[from] !== 'alive') break;
      emit({ k: 'freed', id: req.id, by: from, x: s.x, z: s.z });
      break;
    }
    case 'shot': {
      net?.send({ t: 'ev', ev: { k: 'shot', by: from, o: req.o, d: req.d, len: req.len, hit: req.hit } });
      if (pos) G.noises.push({ x: pos.x, z: pos.z, r: 26 });
      break;
    }
    case 'pass': {
      const P = W.items.passages.find((q) => q.id === req.id);
      if (!P || !P.active || P.open || G.status[from] !== 'alive' || !pos) break;
      const side = (pos.x - P.x) * P.nx + (pos.z - P.z) * P.nz > 0 ? 1 : -1;
      emit({ k: 'passOpen', id: P.id, a: (P.alongX ? side : -side) * Math.PI / 2 * 0.94 });
      G.noises.push({ x: P.x, z: P.z, r: 7 });
      const tryClose = () => {
        if (aiPlayers().some((p) => Math.hypot(p.x - P.x, p.z - P.z) < 1.1)) G.timers.push({ at: G.time + 1, fn: tryClose });
        else emit({ k: 'passClose', id: P.id });
      };
      G.timers.push({ at: G.time + 5.5, fn: tryClose });
      break;
    }
    case 'hit': applyHit(req.pos); break;
    case 'noise': G.noises.push({ x: req.x, z: req.z, r: req.r }); break;
  }
}
function applyHit(shooterPos) {
  const S = world.santa;
  if (S.s.mode === 'dead' || S.s.mode === 'stunned') return;
  if (!S.hit(shooterPos)) return;
  emit({ k: 'santaHit', hp: S.s.hp });
  if (S.s.hp <= 0) emit({ k: 'santaDead' });
}

// ---------------------------------------------------------------- networking glue
function onNetMessage(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'hello': {
      const oid = net.isHost ? 'p2' : 'p1';
      lobbyNames[oid] = String(m.name || '').slice(0, 14) || (oid === 'p1' ? 'Host' : 'Friend');
      if (net.isHost) {
        $('lobbyStatus').textContent = `${lobbyNames.p2} is at the gate.`;
        $('begin').disabled = false;
        if (audio.ready) audio.pickup();
      } else $('lobbyStatus').textContent = `You're in ${lobbyNames.p1}'s castle. Waiting for them to begin…`;
      break;
    }
    case 'full': $('menuMsg').textContent = 'That game already has two players.'; net.close(); show('menu'); break;
    case 'start': {
      if (net.isHost) break;
      lobbyNames = m.names;
      if (G) { if (G.remote) G.remote.removeFrom(scene); if (G.bow) camera.remove(G.bow); G = null; }
      startGame({ seed: m.seed, mode: 'guest', localId: 'p2', names: m.names });
      break;
    }
    case 'ev': if (G && !net.isHost) applyEvent(m.ev); break;
    case 'req': if (G && net.isHost) handleRequest('p2', m.req); break;
    case 'p': if (G?.remote && net.isHost) G.remote.set(m.p); break;
    case 's': {
      if (!G || net.isHost || !world) break;
      world.santa.applyNet(m.s);
      world.elves.applyNet(m.e);
      G.remote?.set(m.p);
      for (const [id, st] of Object.entries(m.st)) {
        if (id === G.localId && G.escaping && st === 'escaping') continue;
        G.status[id] = st;
      }
      break;
    }
  }
}
let lobbyNames = {};
function myName() { return (settings.name || '').trim().slice(0, 14) || 'Stranger'; }

async function hostGame() {
  net?.close();
  net = new Net();
  show('lobby');
  $('begin').hidden = false;
  $('roomCode').textContent = '····';
  $('lobbyStatus').textContent = 'Opening the gates…';
  $('begin').disabled = true;
  lobbyNames = { p1: myName() };
  net.onMessage = onNetMessage;
  net.onOpen = () => { net.send({ t: 'hello', name: myName() }); $('lobbyStatus').textContent = 'Someone is at the gate…'; };
  net.onClose = onDisconnect;
  try {
    const code = await net.host();
    $('roomCode').textContent = code;
    $('lobbyStatus').textContent = 'Send this code to your friend. Waiting…';
  } catch (e) {
    $('lobbyStatus').textContent = "Couldn't reach the matchmaking server. Check your connection and try again.";
  }
}
async function joinGame(code) {
  if (!/^[A-Z0-9]{4}$/i.test(code)) { $('menuMsg').textContent = 'Codes are 4 letters/numbers.'; return; }
  net?.close();
  net = new Net();
  lobbyNames = { p2: myName() };
  net.onMessage = onNetMessage;
  net.onClose = onDisconnect;
  show('lobby');
  $('roomCode').textContent = code.toUpperCase();
  $('lobbyStatus').textContent = 'Knocking…';
  $('begin').hidden = true;
  try {
    await net.join(code);
    net.send({ t: 'hello', name: myName() });
    $('lobbyStatus').textContent = 'You\'re in. Waiting for the host to begin…';
  } catch (e) {
    show('menu');
    $('begin').hidden = false;
    $('menuMsg').textContent = e?.type === 'peer-unavailable' ? 'No game with that code. Check it and try again.' : "Couldn't connect. Try again, or make sure the host is waiting in the lobby.";
  }
}
function onDisconnect() {
  if (G && !G.ended) {
    if (isHost()) {
      if (G.remote) { G.status[G.remote.id] = 'gone'; G.remote.removeFrom(scene); }
      showMsg('Your friend lost the connection. You are alone now.', 5);
      $('partner').hidden = true;
    } else emitLocalEnd('disconnect');
  } else if (!G && !$('lobby').hidden) {
    $('lobbyStatus').textContent = net?.isHost ? 'Your friend left. Waiting…' : 'The host closed the game.';
    $('begin').disabled = true;
  }
}
function emitLocalEnd(result) { showEnd({ result, status: G.status, time: G.time }); }
function beginHosted() {
  if (!net?.connected) return;
  const seed = Math.floor(Math.random() * 1e9);
  lobbyNames.p1 = myName();
  net.send({ t: 'start', seed, names: lobbyNames });
  startGame({ seed, mode: 'host', localId: 'p1', names: { ...lobbyNames } });
}

// ---------------------------------------------------------------- scares
let faceCanvas = null;
function startSantaScare() {
  G.scare = { type: 'santa', t: 0, dur: 1.9 };
  world.santa.scare = { camera, t: 0 };
  player.frozen = 99;
  player.trauma = 1;
  audio.jumpscare();
}
function startElfScare(i) {
  G.scare = { type: 'elf', t: 0, dur: 2.3, elf: i };
  world.elves.scare = { index: i, camera };
  player.frozen = 2.3;
  player.trauma = 1;
  audio.grabScare();
}
function updateScare(dt, t) {
  const sc = G.scare;
  const face = $('scareface');
  if (!sc) {
    scareLight.intensity = 0;
    U.scare.value = damp(U.scare.value, 0, 6, dt);
    if (!G.escaping) U.red.value = damp(U.red.value, 0, 3, dt);
    U.invert.value = 0;
    face.style.opacity = 0;
    camera.fov = damp(camera.fov, 72 + player.fovKick, 6, dt);
    camera.updateProjectionMatrix();
    return;
  }
  sc.t += dt;
  const k = sc.t;
  {
    const f = camera.getWorldDirection(new THREE.Vector3());
    scareLight.position.copy(camera.position).addScaledVector(f, 0.25).add(new THREE.Vector3(0, -0.32, 0));
    scareLight.intensity = (sc.type === 'santa' ? 0.55 : 0.6) * (Math.random() < 0.12 ? 0.15 : 1);
    if (k > sc.dur - dt * 1.5) scareLight.intensity = 0;
  }
  player.trauma = Math.max(player.trauma, sc.type === 'santa' ? 1 : 0.8);
  if (sc.type === 'santa') {
    world.santa.scare.t = k;
    U.scare.value = 1;
    U.red.value = k < 0.08 ? 0.95 : 0.2 + Math.random() * 0.25;
    U.invert.value = (k > 0.42 && k < 0.47) || (k > 1.12 && k < 1.16) ? 1 : 0;
    const flash = (k > 0.3 && k < 0.36) || (k > 0.95 && k < 1.0) || (k > 1.55 && k < 1.61);
    face.style.opacity = flash ? 1 : 0;
    face.style.transform = `translate(-50%, -50%) scale(${1 + Math.random() * 0.15}) rotate(${R(-6, 6)}deg)`;
    camera.fov = 58 + Math.random() * 6;
    camera.updateProjectionMatrix();
    if (k > sc.dur) {
      G.scare = null;
      world.santa.scare = null;
      face.style.opacity = 0;
      U.scare.value = 0; U.red.value = 0; U.invert.value = 0; U.blackout.value = 1;
      audio.tinnitus();
      $('deadTitle').textContent = 'Meegenomen';
      const partnerAlive = G.remote && G.status[G.remote.id] === 'alive';
      $('deadText').textContent = partnerAlive ? `He stuffed you in His sack. ${name(G.remote.id)} can still cut you down.` : 'He stuffed you in His sack.';
      $('dead').hidden = false;
      // co-op: after a moment you watch your friend through their eyes. Solo: the end screen follows.
      setTimeout(() => { if (G && !G.ended && G.remote && ['alive', 'escaping'].includes(G.status[G.remote.id])) { $('dead').hidden = true; U.blackout.value = 0; } }, 3800);
    }
  } else {
    U.scare.value = Math.max(0, 0.85 - k * 0.35);
    U.red.value = k < 0.06 ? 0.7 : 0.05;
    const flash = k > 0.5 && k < 0.55;
    face.style.opacity = 0;
    U.invert.value = flash ? 1 : 0;
    camera.fov = 62 + Math.random() * 4;
    camera.updateProjectionMatrix();
    if (k > sc.dur) {
      G.scare = null;
      world.elves.scare = null;
      U.invert.value = 0;
      if (meAlive()) showMsg('It let go of you. He heard that.', 3);
    }
  }
}

// ---------------------------------------------------------------- interaction & weapon
function interactPress() {
  const it = G?.focus;
  if (!it || it.hold || !meAlive() || G.scare || G.escaping) return;
  request({ k: it.type, id: it.id });
}
function updateInteract(dt) {
  const prompt = $('prompt'), ring = $('holdring');
  if (!meAlive() || G.scare || G.escaping) { prompt.hidden = true; ring.hidden = true; G.focus = null; G.holdT = 0; return; }
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const it = world.items.findInteract(camera.position, fwd, { alive: true, names: G.names });
  G.focus = it;
  if (!it) { prompt.hidden = true; ring.hidden = true; G.holdT = Math.max(0, G.holdT - dt * 0.3); return; }
  const key = it.type + ':' + it.id;
  if (G.holdKey !== key) { G.holdKey = key; G.holdT = 0; }
  prompt.hidden = false;
  const label = it.label.replace('Hold [E] to ', '');
  prompt.innerHTML = `<kbd>E</kbd>${it.hold ? 'Hold to ' : ''}${label}`;
  if (it.type === 'door' && it.hold) {
    // forced stone stays forced: progress is kept if you run and come back
    if (keys.KeyE) {
      if (!G.doorMsg) { G.doorMsg = true; showMsg('The grinding echoes through the whole castle…', 3); }
      G.doorProg = (G.doorProg || 0) + dt;
      G.grindT -= dt;
      if (G.grindT <= 0) { G.grindT = 1.1; audio.stoneGrind({ x: it.x, y: 1.2, z: it.z }, 1.1); player.trauma = Math.max(player.trauma, 0.18); makeNoise(it.x, it.z, 42); }
    }
    ring.hidden = !(G.doorProg > 0);
    ring.firstElementChild.style.strokeDashoffset = 100.5 * (1 - Math.min(1, (G.doorProg || 0) / it.hold));
    if (G.doorProg >= it.hold) { G.doorProg = 0; request({ k: 'door', id: it.id }); }
  } else if (it.hold) {
    if (keys.KeyE) {
      G.holdT += dt;
      if (it.type === 'door') {
        G.grindT -= dt;
        if (G.grindT <= 0) { G.grindT = 1.1; audio.stoneGrind({ x: it.x, y: 1.2, z: it.z }, 1.1); player.trauma = Math.max(player.trauma, 0.18); makeNoise(it.x, it.z, 42); }
      }
    } else G.holdT = Math.max(0, G.holdT - dt * (it.type === 'door' ? 0.3 : 2));
    ring.hidden = G.holdT <= 0;
    ring.firstElementChild.style.strokeDashoffset = 100.5 * (1 - Math.min(1, G.holdT / it.hold));
    if (G.holdT >= it.hold) { G.holdT = 0; request({ k: it.type, id: it.id }); }
  } else { ring.hidden = true; G.holdT = 0; }
}
function makeNoise(x, z, r) {
  if (isHost()) G.noises.push({ x, z, r });
  else net?.send({ t: 'req', req: { k: 'noise', x, z, r } });
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t > 0 ? t : null;
}
function shoot() {
  if (!G || G.ended || !G.crossbow || G.bolts <= 0 || G.reloadT > 0 || !meAlive() || G.scare || G.escaping) return;
  const C = world.castle, S = world.santa;
  G.bolts--; G.reloadT = 1.5; G.recoil = 1;
  audio.crossbow();
  setTimeout(() => G && G.bolts > 0 && audio.reload(), 350);
  player.trauma = Math.max(player.trauma, 0.3);
  const o = camera.position.clone(), d = camera.getWorldDirection(new THREE.Vector3());
  const h = Math.hypot(d.x, d.z);
  let wallT = h > 0.01 ? C.rayWall(o.x, o.z, d.x, d.z, 60) / h : 60;
  if (d.y < -0.001) wallT = Math.min(wallT, (o.y - 0.02) / -d.y);
  if (d.y > 0.001) wallT = Math.min(wallT, (WALL_H - 0.02 - o.y) / d.y);
  let hitT = Infinity;
  if (S.s.mode !== 'dead') for (const [c, r] of S.hitSpheres()) { const tt = raySphere(o, d, c, r); if (tt !== null && tt < hitT) hitT = tt; }
  const hit = hitT < wallT && hitT < 45;
  const len = Math.max(0.2, (hit ? hitT : wallT) - 0.4);
  const start = o.clone().addScaledVector(d, 0.4);
  world.items.fireBolt(start, d, len);
  if (hit) {
    world.items.bolts[world.items.bolts.length - 1].hidden = true;
    G.stats.hits++;
    const hp = o.clone().addScaledVector(d, hitT);
    setTimeout(() => particles?.burst(hp.x, hp.y, hp.z, { count: 30, color: 0x300404, size: 0.25, speed: 1.8, life: 1.2 }), hitT / 48 * 1000);
  } else setTimeout(() => audio.thunk(o.clone().addScaledVector(d, wallT)), (wallT / 48) * 1000);
  const ev = { o: [start.x, start.y, start.z], d: [d.x, d.y, d.z], len, hit };
  if (isHost()) {
    net?.send({ t: 'ev', ev: { k: 'shot', by: G.localId, ...ev } });
    G.noises.push({ x: o.x, z: o.z, r: 26 });
    if (hit) setTimeout(() => G && applyHit([o.x, o.z]), hitT / 48 * 1000);
  } else {
    net?.send({ t: 'req', req: { k: 'shot', ...ev } });
    if (hit) setTimeout(() => G && net?.send({ t: 'req', req: { k: 'hit', pos: [o.x, o.z] } }), hitT / 48 * 1000);
  }
}
function updateWeapon(dt, t) {
  const bow = G.bow;
  const show = G.crossbow && meAlive() && !G.spectate && !G.escaping && !G.scare;
  bow.visible = show;
  if (!show) return;
  G.reloadT = Math.max(0, G.reloadT - dt);
  G.recoil = Math.max(0, G.recoil - dt * 5);
  const rl = G.reloadT > 0 ? Math.sin(Math.min(1, (1.5 - G.reloadT) / 1.5) * Math.PI) : 0;
  const bobX = Math.cos(player.bob) * 0.012, bobY = Math.abs(Math.sin(player.bob)) * 0.012;
  bow.position.set(0.24 + bobX, -0.24 - bobY - rl * 0.12, -0.5 + G.recoil * 0.08);
  bow.rotation.set(0.04 + G.recoil * 0.25 - rl * 0.5, 0.06, rl * 0.3);
  bow.userData.bolt.visible = G.reloadT <= 0 && G.bolts > 0;
  $('ammo').hidden = false;
  $('ammo').textContent = `Silver bolts ${G.bolts}`;
}

// ---------------------------------------------------------------- fake scares (each player gets their own)
function fakeScare() {
  const C = world.castle, S = world.santa;
  const c = camera.position;
  const ds = Math.hypot(S.v.x - c.x, S.v.z - c.z);
  if (ds < 16 || S.s.mode === 'chase') return;
  const roll = Math.random();
  const ang = Math.random() * Math.PI * 2;
  if (roll < 0.16) audio.distantScream({ x: c.x + Math.cos(ang) * 22, y: 2, z: c.z + Math.sin(ang) * 22 });
  else if (roll < 0.32) {
    const [cx, cy] = C.cellAt(c.x, c.z);
    const dirs = [0, 1, 2, 3].filter((d) => C.passable(cx, cy, d));
    const d = dirs[Math.floor(Math.random() * dirs.length)] ?? 0;
    const [mx, mz] = C.edgeMid(cx, cy, d);
    const D = [[0, -1], [1, 0], [0, 1], [-1, 0]][d];
    audio.doorSlam({ x: mx + D[0] * 5, y: 1.5, z: mz + D[1] * 5 }, 0.7);
  } else if (roll < 0.45) {
    // a whisper right behind your ear
    const b = player.yaw;
    audio.whisper({ x: c.x + Math.sin(b) * 0.5 + Math.cos(b) * R(-0.3, 0.3), y: c.y, z: c.z + Math.cos(b) * 0.5 }, 0, 0.32, 9);
  } else if (roll < 0.55) audio.sting();
  else if (roll < 0.78) phantomPeek();
  else if (roll < 0.9) torchOut();
  else audio.elfGiggle({ x: c.x + Math.cos(ang) * 9, y: 1, z: c.z + Math.sin(ang) * 9 }, 0.8, 0.4);
}
function phantomPeek() {
  const C = world.castle, c = camera.position;
  const f = camera.getWorldDirection(new THREE.Vector3()); f.y = 0; f.normalize();
  const free = C.rayWall(c.x, c.z, f.x, f.z, 18);
  if (free < 9) return torchOut();
  const dist = Math.min(free - 1, R(10, 14));
  const ph = G.phantom;
  ph.root.visible = true;
  ph.root.position.set(c.x + f.x * dist, 0, c.z + f.z * dist);
  ph.root.rotation.y = Math.atan2(-f.x, -f.z);
  G.phantomT = R(2.5, 4);
}
function torchOut() {
  const C = world.castle, c = camera.position;
  let best = null, bd = 12;
  for (const fl of C.flames) {
    if (!fl.sprite || fl.ember || !fl.sprite.visible) continue;
    const d = Math.hypot(fl.x - c.x, fl.z - c.z);
    if (d < bd) { bd = d; best = fl; }
  }
  if (!best) return;
  const light = C.lights.reduce((b, a) => (Math.hypot(a.x - best.x, a.z - best.z) < (b ? Math.hypot(b.x - best.x, b.z - best.z) : 1.2) ? a : b), null);
  best.sprite.visible = false;
  if (light) light.out = true;
  audio.whisper({ x: best.x, y: best.y, z: best.z }, 0, 0.35, 1);
  setTimeout(() => { if (best.sprite) best.sprite.visible = true; if (light) light.out = false; }, R(6000, 11000));
}

// ---------------------------------------------------------------- main game update
const v3 = new THREE.Vector3();
function updateGame(dt, t) {
  const W = world, C = W.castle, S = W.santa, items = W.items;
  if (G.paused) { player.updateLight(dt, t, {}); return; }
  if (!G.ended) G.time += dt;
  const local = G.localId;
  const alive = meAlive();
  // spectate when you're out but your friend isn't
  const friendIn = G.remote && ['alive', 'escaping'].includes(G.status[G.remote.id]);
  G.spectate = !alive && !G.scare && !G.escaping && !!friendIn && G.status[local] !== 'escaping';
  player.update(dt, input(), { locked: !alive || !!G.scare, cameraOverride: G.spectate || !!G.escaping });
  if (G.spectate) {
    const r = G.remote.v;
    camera.position.set(r.x, r.eye, r.z);
    camera.rotation.set(r.pitch, r.yaw, 0, 'YXZ');
    $('spectate').hidden = false;
    $('spectate').textContent = `Watching ${name(G.remote.id)}`;
  } else $('spectate').hidden = true;
  // escape cutscene: walk into the light
  if (G.escaping) {
    const e = G.escaping;
    e.t += dt;
    const d = e.door;
    if (d) {
      const [ix, iz] = d.F.p(0, 1);
      const inward = { x: ix - d.x, z: iz - d.z };
      const yaw = Math.atan2(inward.x, inward.z);
      const k = Math.min(1, e.t / 1.7);
      const [tx, tz] = d.F.p(0, -0.6);
      camera.position.set(lerp(e.from.x, tx, k * k), lerp(e.from.y, 1.45, k), lerp(e.from.z, tz, k * k));
      const yy = e.yaw + Math.atan2(Math.sin(yaw - e.yaw), Math.cos(yaw - e.yaw)) * Math.min(1, e.t * 2);
      camera.rotation.set(lerp(e.pitch, 0, Math.min(1, e.t * 2)), yy, 0, 'YXZ');
    }
    U.white.value = clamp((e.t - 0.7) / 1.0, 0, 1);
  } else if (G.status[local] === 'escaped' && !G.spectate) U.white.value = 0;
  // simulation (host)
  if (isHost() && !G.ended) hostUpdate(dt);
  // noises from my footsteps
  if (alive && player.noise > 0) {
    if (isHost()) G.noises.push({ x: player.pos.x, z: player.pos.z, r: player.noise });
    else net?.send({ t: 'req', req: { k: 'noise', x: player.pos.x, z: player.pos.z, r: player.noise } });
  }
  // views
  S.animate(dt, t, camera.position);
  W.elves.animate(dt, t, camera.position, elfSound);
  items.update(dt, t);
  C.update(t);
  if (G.remote) {
    const st = G.status[G.remote.id];
    G.remote.update(dt, (st === 'alive' || st === 'escaping') && !G.spectate);
    if (G.remote.stepAcc > 1.25 && st === 'alive') {
      G.remote.stepAcc = 0;
      const r = G.remote.v;
      audio.footstep(G.remote.state.crouch ? 0.03 : G.remote.state.sprint ? 0.2 : 0.11, { x: r.x, y: 0.1, z: r.z }, occlFrom(r.x, r.z));
    }
  }
  // the sack cries out
  G.sackCryT -= dt;
  if (G.sackCryT <= 0) {
    G.sackCryT = R(4, 8);
    for (const s of items.sacks.values()) {
      if (s.pid === local) continue;
      const o = occlFrom(s.x, s.z);
      if (Math.random() < 0.5) audio.whisper({ x: s.x, y: 1.8, z: s.z }, o, 0.5, 7);
      else audio.distantScream({ x: s.x, y: 1.8, z: s.z });
      s.jolt = 0.6;
    }
  }
  // secret door whispers + wind, only close up
  for (const d of items.doors.values()) {
    d.whT = (d.whT ?? R(1, 3)) - dt;
    if (d.whT <= 0 && !d.open && d.alpha > 0.3) {
      d.whT = R(3.5, 7);
      const c = camera.position;
      if (Math.hypot(d.x - c.x, d.z - c.z) < 15) audio.whisper({ x: d.x, y: 1.2, z: d.z }, occlFrom(d.x, d.z), 0.11, 5);
    }
  }
  // phantom
  if (G.phantom?.root.visible) {
    G.phantomT -= dt;
    const p = G.phantom.root.position;
    const dd = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
    G.phantom.head.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z) - G.phantom.root.rotation.y;
    G.phantom.face.look(camera.position);
    if (G.phantomT <= 0 || dd < 6.5) G.phantom.root.visible = false;
  }
  updateInteract(dt);
  updateWeapon(dt, t);
  updateScare(dt, t);
  // sound + tension
  const c = camera.position;
  const ds = Math.hypot(S.v.x - c.x, S.v.z - c.z);
  G.losT -= dt;
  if (G.losT <= 0) { G.losT = 0.12; G.santaLos = C.lineOfSight(c.x, c.z, S.v.x, S.v.z); }
  lastSantaOccl = G.santaLos ? 0 : clamp((ds - 2) / 8, 0.45, 1);
  const dead = S.s.mode === 'dead';
  audio.setListener(c, camera.getWorldDirection(v3));
  audio.updateSantaVoice({ x: S.v.x, z: S.v.z }, lastSantaOccl, S.s.mode, dead || G.ended);
  const near = dead || G.ended ? 0 : clamp(1 - ds / 24, 0, 1) * (G.santaLos ? 1 : 0.7);
  const chasing = !dead && S.s.mode === 'chase' && ds < 40 ? 1 : 0;
  const tension = dead ? 0 : clamp(Math.max(near * 1.1, chasing, S.s.mode === 'notice' && ds < 25 ? 0.8 : 0), 0, 1);
  if (!G.ended) audio.setMood(tension, chasing, G.scare ? 0 : near, clamp(1 - ds / 32, 0, 1));
  audio.tick();
  const danger = dead ? 0 : clamp(1 - ds / 13, 0, 1);
  player.updateLight(dt, t, { danger, forceOn: G.spectate ? G.remote.state.flash : false });
  if (G.spectate) player.light.intensity = G.remote.state.flash ? 60 : 0;
  if (G.scare) { player.light.intensity *= 0.05; player.fill.intensity = 0; }
  updateLights(dt, t);
  // lightning
  if (lightning >= 0) {
    lightning += dt;
    const L = lightningLevel(lightning);
    hemi.intensity = 0.07 + L * 1.6;
    if (C.windowMat) C.windowMat.color.setRGB(0.05 + L * 0.8, 0.07 + L * 0.85, 0.12 + L);
    if (lightning > 0.8) { lightning = -1; hemi.intensity = 0.07; }
  }
  // fake scares
  G.bgT = (G.bgT ?? R(6, 12)) - dt;
  if (G.bgT <= 0 && !G.ended) {
    G.bgT = R(9, 22);
    const c = camera.position, a = Math.random() * Math.PI * 2, r = R(6, 20);
    const pos = { x: c.x + Math.cos(a) * r, y: R(0.5, 3.5), z: c.z + Math.sin(a) * r };
    const k = Math.random();
    if (k < 0.3) audio.creak(pos, 0.6); else if (k < 0.5) audio.chains(pos, 0.6); else if (k < 0.7) audio.knock(pos, 0.7); else if (k < 0.85) audio.drip(pos); else audio.whisper(pos, 0.6, 0.18, 6);
  }
  updateTrails(dt);
  updateGuide(dt, t);
  G.fakeT -= dt;
  if (G.fakeT <= 0 && alive && !G.scare && G.time > 20) { G.fakeT = R(24, 50); fakeScare(); }
  G.bellT -= dt;
  if (G.bellT <= 0) { G.bellT = R(150, 240); audio.bellToll(); }
  // intro fade
  if (!G.introDone) {
    U.blackout.value = clamp(1 - (G.time - 1.2) / 2.5, 0, 1);
    if (G.time >= 3.7) { G.introDone = true; U.blackout.value = 0; }
  }
  // send state
  G.sendT -= dt;
  if (net?.connected && G.sendT <= 0) {
    const me = [r2(player.pos.x), r2(player.pos.z), r2(player.yaw), r2(player.pitch), player.lightOn() ? 1 : 0, player.crouch ? 1 : 0, player.moving ? 1 : 0, player.sprinting ? 1 : 0];
    if (isHost()) { G.sendT = 1 / 15; net.send({ t: 's', s: S.netState(), e: W.elves.netState(), p: me, st: G.status }); }
    else { G.sendT = 1 / 20; net.send({ t: 'p', p: me }); }
  }
  updateHud();
}
const r2 = (v) => Math.round(v * 100) / 100;

function hostUpdate(dt) {
  const W = world, S = W.santa;
  const players = aiPlayers();
  const noises = G.noises; G.noises = [];
  S.think(dt, { players, noises, emit });
  W.elves.think(dt, { players, emit, santaDead: S.s.mode === 'dead' });
  // hidden passages: a few are live at any time, and they keep moving
  G.passT -= dt;
  if (G.passT <= 0) {
    G.passT = R(30, 50);
    const ps = W.items.passages;
    let act = ps.filter((p) => p.active).map((p) => p.id);
    if (act.length >= 6) {
      const closed = ps.filter((p) => p.active && !p.open);
      if (closed.length) { const drop = closed[Math.floor(Math.random() * closed.length)].id; act = act.filter((id) => id !== drop); }
    }
    const off = ps.filter((p) => !act.includes(p.id));
    while (act.length < 6 && off.length) act.push(off.splice(Math.floor(Math.random() * off.length), 1)[0].id);
    emit({ k: 'passActive', ids: act });
  }
  // forcing the vault door is loud: after a few seconds of it, He comes out of the walls
  const C = W.castle;
  for (const n of noises) if (n.r >= 40 && C.inVault(n.x, n.z)) G.vaultAlarm++;
  const inside = players.filter((p) => p.alive && C.inVault(p.x, p.z));
  if (G.vaultAlarm >= 4 && inside.length && !C.inVault(S.s.x, S.s.z) && !['dead', 'stunned', 'feed'].includes(S.s.mode)) {
    G.vaultAlarm = 0;
    const door = W.items.doors.get(1);
    const corners = [0, 1, 2, 3].map((k) => C.cornerPos(C.vault.x, C.vault.y, k));
    const far = corners.reduce((a, b) => (Math.hypot(b[0] - door.x, b[1] - door.z) > Math.hypot(a[0] - door.x, a[1] - door.z) ? b : a));
    S.s.x = far[0]; S.s.z = far[1];
    S.setMode('notice'); S.ai.targetId = inside[0].id; S.ai.noticeDur = 0.9; S.ai.menace = 0;
    emit({ k: 'vaultIn' });
  }
  if (C.inVault(S.s.x, S.s.z) && !inside.length) {
    G.vaultIdle += dt;
    if (G.vaultIdle > 4) {
      G.vaultIdle = 0;
      const [cx, cz] = C.center(C.vault.nx, C.vault.ny);
      S.s.x = cx; S.s.z = cz; S.startSearch(3);
    }
  } else G.vaultIdle = 0;
  for (const d of [...W.items.doors.values()]) {
    if (d.permanent) continue;
    const age = (Date.now() - d.born) / 1000;
    if ((!d.open && age > d.life) || (d.open && d.openT > 16)) emit({ k: 'door-', id: d.id });
  }
  // lightning
  G.lightT -= dt;
  if (G.lightT <= 0) { G.lightT = R(50, 110); emit({ k: 'lightning' }); }
  // timers
  for (let i = G.timers.length - 1; i >= 0; i--) if (G.time >= G.timers[i].at) { const tm = G.timers.splice(i, 1)[0]; tm.fn(); }
  // the end?
  if (!G.endAt) {
    const st = Object.values(G.status);
    if (G.santaDeadAt && G.time - G.santaDeadAt > 5) { G.endAt = G.time; G.endResult = 'kill'; }
    else if (st.every((s) => s === 'taken' || s === 'escaped' || s === 'gone')) {
      G.endAt = G.time + (G.scare || st.includes('taken') ? 4.2 : 1.5);
      G.endResult = st.includes('escaped') ? 'escape' : 'lose';
    }
  } else if (G.time >= G.endAt && !G.ended) emit({ k: 'end', result: G.endResult, status: { ...G.status }, time: G.time });
}
function spawnDoor() {
  const C = world.castle, items = world.items;
  const alive = aiPlayers().filter((p) => p.alive);
  if (!alive.length || items.doors.size >= 1) return;
  const dists = alive.map((p) => { const [x, y] = C.cellAt(p.x, p.z); return C.bfs(x, y); });
  const cands = C.doorFaces.filter((f) => f.outer && dists.every((d) => d[f.y * C.N + f.x] >= 3));
  if (!cands.length) return;
  const f = cands[Math.floor(Math.random() * cands.length)];
  emit({ k: 'door+', d: { id: ++G.doorId, fx: f.x, fy: f.y, side: f.side, life: R(75, 95), age: 0 } });
}

let hudCache = {};
function updateHud() {
  const set = (k, v, fn) => { if (hudCache[k] !== v) { hudCache[k] = v; fn(v); } };
  const b = Math.round(player.battery);
  set('batt', b, (v) => { $('batt').querySelector('i').style.width = v + '%'; $('batt').classList.toggle('low', v < 20); });
  const s = Math.round(player.stamina);
  set('stam', s, (v) => { $('stam').querySelector('i').style.width = v + '%'; $('stam').classList.toggle('full', v >= 100); });
  if (G.remote) {
    const st = G.status[G.remote.id];
    const label = { alive: 'alive', taken: '<span class="taken">in the sack</span>', escaped: 'escaped', escaping: 'escaping', gone: 'disconnected' }[st] || st;
    set('partner', st, () => { $('partner').innerHTML = `<b>${escapeHtml(name(G.remote.id))}</b> — ${label}`; });
  }
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const t = now / 1000;
  if (G && world) updateGame(dt, t);
  else updateMenu(dt, t);
  particles?.update(dt);
  U.time.value = t % 1000;
  composer.render();
}

// ---------------------------------------------------------------- boot
function wireUi() {
  $('enter').addEventListener('click', () => { audio.init(); audio.startAmbience(); show('menu'); });
  document.querySelectorAll('nav [data-act]').forEach((b) => b.addEventListener('click', () => {
    audio.init();
    $('menuMsg').textContent = '';
    const act = b.dataset.act;
    if (act === 'solo') startGame({ seed: Math.floor(Math.random() * 1e9), mode: 'solo', localId: 'p1', names: { p1: myName() } });
    else if (act === 'host') hostGame();
    else if (act === 'join') { $('joinbox').hidden = !$('joinbox').hidden; if (!$('joinbox').hidden) $('code').focus(); }
    else if (act === 'howto') show('howto');
    else if (act === 'settings') show('settings');
  }));
  $('joinGo').addEventListener('click', () => { audio.init(); joinGame($('code').value.trim()); });
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame($('code').value.trim()); });
  $('code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => show('menu')));
  $('name').value = settings.name;
  $('name').addEventListener('input', (e) => { settings.name = e.target.value; saveSettings(); });
  $('sens').value = settings.sens; $('vol').value = settings.vol; $('scareVol').value = settings.scareVol;
  $('quality').value = settings.quality; $('invertY').checked = settings.invertY;
  $('sens').addEventListener('input', (e) => { settings.sens = +e.target.value; saveSettings(); });
  $('vol').addEventListener('input', (e) => { settings.vol = +e.target.value; audio.setVolume(settings.vol); saveSettings(); });
  $('scareVol').addEventListener('input', (e) => { settings.scareVol = +e.target.value; audio.setScareVolume(settings.scareVol); saveSettings(); });
  $('quality').addEventListener('change', (e) => { settings.quality = e.target.value; saveSettings(); bloom.enabled = settings.quality !== 'low'; renderer.setPixelRatio(pixelRatio()); composer.setPixelRatio?.(pixelRatio()); composer.setSize(innerWidth, innerHeight); });
  $('invertY').addEventListener('change', (e) => { settings.invertY = e.target.checked; saveSettings(); });
  $('begin').addEventListener('click', () => { audio.init(); beginHosted(); });
  $('leave').addEventListener('click', () => { net?.close(); net = null; $('begin').hidden = false; show('menu'); });
  $('resume').addEventListener('click', () => lock());
  $('quit').addEventListener('click', quitToMenu);
  $('again').addEventListener('click', () => {
    if (!G) return;
    if (G.mode === 'solo') { const n = G.names; startGame({ seed: Math.floor(Math.random() * 1e9), mode: 'solo', localId: 'p1', names: n }); }
    else if (G.mode === 'host' && net?.connected) {
      const seed = Math.floor(Math.random() * 1e9);
      if (G.remote) G.remote.removeFrom(scene);
      if (G.bow) camera.remove(G.bow);
      net.send({ t: 'start', seed, names: G.names });
      startGame({ seed, mode: 'host', localId: 'p1', names: G.names });
    }
  });
  $('toMenu').addEventListener('click', quitToMenu);
}

async function boot() {
  wireUi();
  await new Promise((r) => setTimeout(r, 30));
  T = buildTextures();
  const fc = scareFace(512);
  const sf = $('scareface').getContext('2d');
  sf.drawImage(fc, 0, 0);
  faceCanvas = fc;
  particles = new Particles(scene, T);
  player = new Player(camera, null, audio, T, settings.quality);
  player.addTo(scene);
  loadIceConfig();
  startMenuScene();
  show('splash');
  $('loadMsg').textContent = '';
  requestAnimationFrame(frame);
}
boot();

// handy for debugging in the console
window.__sint = { get G() { return G; }, get world() { return world; }, get player() { return player; }, audio, camera, emit: (e) => emit(e), solo: (seed) => startGame({ seed: seed ?? Math.floor(Math.random() * 1e9), mode: 'solo', localId: 'p1', names: { p1: 'Test' } }),
  // advance the game by hand (for testing in a background tab)
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { const t = performance.now() / 1000 + i * dt; if (G && world) updateGame(dt, t); else updateMenu(dt, t); particles?.update(dt); } composer.render(); },
  U, keys, shoot: () => shoot(), spawnDoor: () => spawnDoor(), press: () => interactPress() };
