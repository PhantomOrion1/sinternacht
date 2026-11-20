// Side-by-side preview of the three Sinterklaas designs, under the game's own lighting and post FX.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildTextures, setAnisotropy } from './textures.js';
import { FinalShader } from './fx.js';
import { loadSinter } from './sinter3d.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('view').appendChild(renderer.domElement);
setAnisotropy(8);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x020101, 0.06);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.03, 80);
camera.position.set(0, 1.9, 6.2);
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.53;
controls.minDistance = 0.5; controls.maxDistance = 12;

// the castle room, with the game's stone
const T = buildTextures();
const stone = (w, h, rep) => { const m = new THREE.MeshStandardMaterial({ map: T.wall.map.clone(), normalMap: T.wall.normal.clone(), roughness: 0.92, normalScale: new THREE.Vector2(1.4, 1.4) }); for (const t of [m.map, m.normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / 3, h / 3); t.needsUpdate = true; } return m; };
const floorMat = new THREE.MeshStandardMaterial({ map: T.floor.map.clone(), normalMap: T.floor.normal.clone(), roughnessMap: T.floor.rough.clone(), roughness: 1 });
for (const t of [floorMat.map, floorMat.normalMap, floorMat.roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(16 / 3.2, 12 / 3.2); t.needsUpdate = true; }
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const back = new THREE.Mesh(new THREE.PlaneGeometry(16, 4.2), stone(16, 4.2)); back.position.set(0, 2.1, -3.2); back.receiveShadow = true; scene.add(back);
for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.2), stone(12, 4.2)); w.position.set(s * 6.5, 2.1, 1); w.rotation.y = -s * Math.PI / 2; w.receiveShadow = true; scene.add(w); }
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ map: T.darkWood.map, color: 0x6a5a4a })); ceil.rotation.x = Math.PI / 2; ceil.position.y = 4.2; scene.add(ceil);

// lighting rigs
const hemi = new THREE.HemisphereLight(0x46526e, 0x160e08, 0.07); scene.add(hemi);
// neutral studio rig, for judging the models themselves
const studio = new THREE.Group();
{ const key = new THREE.DirectionalLight(0xfff1e0, 0); key.position.set(2.5, 4, 5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -5, right: 5, top: 4, bottom: -1 });
  const fill = new THREE.DirectionalLight(0xc8d4ff, 0); fill.position.set(-4, 2, 3);
  const rim = new THREE.DirectionalLight(0xffffff, 0); rim.position.set(0, 4, -5);
  studio.add(key, fill, rim); studio.userData.lights = [[key, 2.6], [fill, 0.8], [rim, 1.6]]; }
scene.add(studio);
const torches = [];
const flameMat = new THREE.SpriteMaterial({ map: T.flame, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0xffd0a0 });
for (const [x, z, wall] of [[-6.3, 1.6, 1], [6.3, 1.6, -1], [-2.4, -3.0, 0], [2.4, -3.0, 0]]) {
  const l = new THREE.PointLight(0xff8a3a, 0, 11, 2); l.position.set(x + (wall ? wall * 0.35 : 0), 2.7, z + (wall ? 0 : 0.3)); l.castShadow = wall !== 0; l.shadow.mapSize.set(1024, 1024); scene.add(l);
  const f = new THREE.Sprite(flameMat); f.position.set(x + wall * 0.2, 2.65, z + (wall ? 0 : 0.12)); f.scale.set(0.28, 0.45, 1); scene.add(f);
  const br = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), new THREE.MeshStandardMaterial({ color: 0x2b2a2a, metalness: 0.7, roughness: 0.5 })); br.position.set(x, 2.25, z); scene.add(br);
  torches.push({ l, f, front: wall !== 0 });
}
const flash = new THREE.SpotLight(0xf2f0ea, 0, 34, 0.5, 0.6, 1.35); flash.map = T.cookie; flash.castShadow = true; flash.shadow.mapSize.set(2048, 2048); flash.shadow.bias = -0.0004;
const flashTarget = new THREE.Object3D(); flash.target = flashTarget; scene.add(flash, flashTarget);
const moon = new THREE.DirectionalLight(0x6a88c0, 0); moon.position.set(-4, 6, 4); moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -6, right: 6, top: 5, bottom: -1 }); scene.add(moon);
let mode = 'flash';
function applyLights(t) {
  torches.forEach((tr, i) => {
    const fl = 1 - 0.45 * (0.35 + 0.35 * Math.sin(t * 11 + i * 3) * Math.sin(t * 7.3 + i) + Math.random() * 0.3);
    tr.l.intensity = mode === 'torch' ? (tr.front ? 46 : 16) * fl : mode === 'flash' ? 3 * fl : mode === 'studio' ? 4 * fl : 0;
    tr.f.visible = mode !== 'moon';
  });
  // close up, a real torch would blow the face out; ease it off so the detail stays readable
  flash.intensity = mode === 'flash' ? 60 * Math.min(1, Math.max(0.06, (camera.position.distanceTo(controls.target) / 5) ** 1.6)) : 0;
  flash.position.copy(camera.position).add(new THREE.Vector3(0.2, -0.18, 0).applyQuaternion(camera.quaternion));
  flashTarget.position.copy(controls.target); flashTarget.updateMatrixWorld();
  moon.intensity = mode === 'moon' ? 0.9 : 0;
  hemi.intensity = mode === 'moon' ? 0.15 : mode === 'studio' ? 0.6 : 0.1;
  for (const [l, k] of studio.userData.lights) l.intensity = mode === 'studio' ? k : 0;
}
document.querySelectorAll('[data-light]').forEach((b) => b.addEventListener('click', () => {
  mode = b.dataset.light;
  document.querySelectorAll('[data-light]').forEach((o) => o.classList.toggle('on', o === b));
}));
let spin = false;
document.getElementById('spin').addEventListener('click', (e) => { spin = !spin; e.target.classList.toggle('on', spin); });

// the game's post FX
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.5, 0.45, 0.9));
composer.addPass(new OutputPass());
const fin = new ShaderPass(FinalShader); composer.addPass(fin);
fin.uniforms.grain.value = 0.045; fin.uniforms.vig.value = 0.2;
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// the three of Him
const names = ['nightmare', 'demonic', 'uncanny'];
const blurbs = { nightmare: 'Human, aged, filthy', demonic: 'Too tall, hollow-eyed', uncanny: 'Almost normal. Almost.' };
const chars = await Promise.all(names.map((n) => loadSinter(n)));
chars.forEach((c, i) => {
  c.root.position.set((i - 1) * 2.4, 0, 0);
  scene.add(c.root);
  const b = document.createElement('button');
  b.innerHTML = `${c.title}<small>${blurbs[c.name]}</small>`;
  b.addEventListener('click', () => focus(c));
  document.getElementById('labels').appendChild(b);
});
document.getElementById('loading').remove();
window.__lineup = { chars, camera, controls, renderer, scene, composer, setMode: (m) => { mode = m; applyLights(0); } };

let focusAnim = null;
function focus(c) {
  const head = new THREE.Vector3(); c.bones.head.getWorldPosition(head);
  focusAnim = { t: 0, fromT: controls.target.clone(), toT: head.clone().add(new THREE.Vector3(0, -0.1, 0)), fromP: camera.position.clone(), toP: head.clone().add(new THREE.Vector3(0.35, 0.05, 1.25)) };
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  if (focusAnim) {
    focusAnim.t = Math.min(1, focusAnim.t + dt * 1.2);
    const k = focusAnim.t * focusAnim.t * (3 - 2 * focusAnim.t);
    controls.target.lerpVectors(focusAnim.fromT, focusAnim.toT, k);
    camera.position.lerpVectors(focusAnim.fromP, focusAnim.toP, k);
    if (focusAnim.t >= 1) focusAnim = null;
  }
  controls.update();
  for (const c of chars) { if (spin) c.root.rotation.y += dt * 0.5; c.pose(dt, camera.position); }
  applyLights(t);
  fin.uniforms.time.value = t;
  composer.render();
}
frame();
