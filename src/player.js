// First-person player, flashlight, and the other player's avatar.
import * as THREE from 'three';
import { clamp, damp, dampAngle, R } from './rng.js';

const EYE = 1.62, EYE_CROUCH = 1.0, RADIUS = 0.3;

export class Player {
  constructor(camera, castle, audio, T, quality) {
    this.camera = camera;
    this.castle = castle;
    this.audio = audio;
    this.pos = { x: 0, z: 0 };
    this.vel = { x: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.eye = EYE;
    this.stamina = 100; this.exhausted = false; this.staminaCd = 0;
    this.battery = 100; this.flashOn = true;
    this.crouch = false; this.sprinting = false; this.moving = false;
    this.frozen = 0;
    this.bob = 0; this.lastStep = 0;
    this.trauma = 0;
    this.noise = 0;
    this.breathT = 0;
    this.flicker = 1; this.flickerT = 0;
    this.fovKick = 0;
    // flashlight
    const L = this.light = new THREE.SpotLight(0xf2f0ea, 0, 34, 0.5, 0.6, 1.35);
    L.map = T.cookie;
    L.castShadow = true;
    L.shadow.mapSize.set(quality === 'low' ? 512 : 1024, quality === 'low' ? 512 : 1024);
    L.shadow.camera.near = 0.25; L.shadow.camera.far = 32;
    L.shadow.bias = -0.0004; L.shadow.normalBias = 0.03;
    this.target = new THREE.Object3D();
    L.target = this.target;
    this.fill = new THREE.PointLight(0xe8ecf0, 0, 7, 2);
    this.lag = new THREE.Vector3(0, 0, -1);
  }
  addTo(scene) { scene.add(this.light, this.target, this.fill); }
  removeFrom(scene) { scene.remove(this.light, this.target, this.fill); }

  reset(x, z, yaw) {
    this.pos.x = x; this.pos.z = z; this.yaw = yaw; this.pitch = 0;
    this.vel.x = this.vel.z = 0;
    this.stamina = 100; this.battery = 100; this.flashOn = true; this.frozen = 0; this.trauma = 0; this.exhausted = false;
  }
  lightOn() { return this.flashOn && this.battery > 0; }
  toggleLight() {
    if (this.battery <= 0) { this.audio.click(); return; }
    this.flashOn = !this.flashOn;
    this.audio.click();
  }
  look(dx, dy, sens) {
    if (this.frozen > 0) return;
    this.yaw -= dx * 0.0022 * sens;
    this.pitch = clamp(this.pitch - dy * 0.0022 * sens, -1.45, 1.45);
  }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  update(dt, input, opts = {}) {
    const audio = this.audio;
    this.frozen = Math.max(0, this.frozen - dt);
    const canMove = this.frozen <= 0 && !opts.locked;
    let ix = 0, iz = 0;
    if (canMove) {
      if (input.f) iz -= 1; if (input.b) iz += 1;
      if (input.l) ix -= 1; if (input.r) ix += 1;
    }
    const len = Math.hypot(ix, iz) || 1;
    ix /= len; iz /= len;
    const wantMove = ix !== 0 || iz !== 0;
    this.crouch = canMove && input.crouch;
    // stamina
    this.staminaCd -= dt;
    const trySprint = canMove && input.sprint && wantMove && !this.crouch && iz < 0.1 && !this.exhausted;
    if (trySprint) { this.stamina = Math.max(0, this.stamina - dt * 14); this.staminaCd = 0.8; if (this.stamina <= 0) this.exhausted = true; }
    else if (this.staminaCd <= 0) this.stamina = Math.min(100, this.stamina + dt * 15);
    if (this.exhausted && this.stamina > 35) this.exhausted = false;
    this.sprinting = trySprint;
    const speed = this.crouch ? 1.45 : trySprint ? 5.6 : 3.0;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const tx = (ix * c + iz * s) * speed, tz = (-ix * s + iz * c) * speed;
    const acc = wantMove ? 10 : 12;
    this.vel.x = damp(this.vel.x, wantMove ? tx : 0, acc, dt);
    this.vel.z = damp(this.vel.z, wantMove ? tz : 0, acc, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.castle.collide(this.pos, RADIUS);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moving = hs > 0.4;
    // head bob + footsteps
    this.noise = 0;
    if (hs > 0.3) {
      this.bob += hs * dt * (trySprint ? 2.1 : 2.4);
      const step = Math.floor(this.bob / Math.PI);
      if (step !== this.lastStep) {
        this.lastStep = step;
        const vol = this.crouch ? 0.035 : trySprint ? 0.24 : 0.12;
        audio.footstep(vol);
        this.noise = this.crouch ? 1.5 : trySprint ? 15 : 5.5;
      }
    }
    const bobAmp = this.crouch ? 0.015 : trySprint ? 0.055 : 0.035;
    const by = Math.abs(Math.sin(this.bob)) * bobAmp * Math.min(1, hs / 2);
    const bx = Math.cos(this.bob) * bobAmp * 0.6 * Math.min(1, hs / 2);
    this.eye = damp(this.eye, this.crouch ? EYE_CROUCH : EYE, 10, dt);
    // exhaustion breathing
    this.breathT -= dt;
    if (this.stamina < 40 && this.breathT <= 0) { audio.breathing(0.12 * (1 - this.stamina / 40) + 0.03); this.breathT = 1.1; }
    // battery
    if (this.flashOn && this.battery > 0) {
      this.battery = Math.max(0, this.battery - dt * 0.3);
      if (this.battery <= 0) { this.flashOn = false; audio.click(); }
    }
    // camera
    this.trauma = Math.max(0, this.trauma - dt * 1.1);
    const sh = this.trauma * this.trauma;
    const cam = this.camera;
    if (!opts.cameraOverride) {
      cam.position.set(this.pos.x + bx * c + R(-1, 1) * sh * 0.08, this.eye + by + R(-1, 1) * sh * 0.08, this.pos.z - bx * s + R(-1, 1) * sh * 0.08);
      cam.rotation.set(this.pitch + R(-1, 1) * sh * 0.05, this.yaw + R(-1, 1) * sh * 0.05, R(-1, 1) * sh * 0.08 - this.vel.x * c * 0.004 + this.vel.z * s * 0.004, 'YXZ');
    }
    this.fovKick = damp(this.fovKick, trySprint ? 5 : 0, 4, dt);
  }

  // place the flashlight at the camera, with a little lag so it sways
  updateLight(dt, t, opts) {
    const cam = this.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    this.lag.lerp(fwd, 1 - Math.exp(-16 * dt)).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    this.light.position.copy(cam.position).addScaledVector(right, 0.2).add(new THREE.Vector3(0, -0.18, 0)).addScaledVector(fwd, 0.1);
    this.target.position.copy(this.light.position).addScaledVector(this.lag, 10);
    this.target.updateMatrixWorld();
    // flicker: low battery, or Him nearby
    let f = 1;
    const danger = opts.danger || 0;
    this.flickerT -= dt;
    if ((danger > 0 || this.battery < 20) && this.flickerT <= 0) {
      const chance = Math.max(danger * 0.6, this.battery < 20 ? 0.25 : 0);
      this.flicker = Math.random() < chance ? R(0, 0.3) : R(0.8, 1);
      this.flickerT = R(0.03, 0.14);
    } else if (danger <= 0 && this.battery >= 20) this.flicker = 1;
    f = this.flicker;
    const batt = this.battery < 20 ? 0.45 + this.battery / 40 : 1;
    const on = opts.forceOn || this.lightOn();
    this.light.intensity = on ? 60 * f * batt : 0;
    this.fill.position.copy(cam.position);
    this.fill.intensity = on ? 0.5 * f * batt : 0;
  }
}

function label(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '32px "IM Fell English SC", Georgia, serif';
  x.textAlign = 'center'; x.fillStyle = 'rgba(230,220,200,0.9)';
  x.shadowColor = '#000'; x.shadowBlur = 6;
  x.fillText(text.slice(0, 16), 128, 42);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false, opacity: 0.75 }));
  s.scale.set(0.9, 0.22, 1);
  return s;
}

// What you see of your friend.
export class RemotePlayer {
  constructor(name, T) {
    this.group = new THREE.Group();
    const coat = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.8, 4, 10), coat); body.position.y = 0.95; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin); head.position.y = 1.58; head.castShadow = true;
    this.body = body; this.head = head;
    const arm = new THREE.Group(); arm.position.set(0.22, 1.32, 0);
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.55, 6), coat); a.rotation.x = Math.PI / 2; a.position.z = -0.25; arm.add(a);
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6 }));
    torch.rotation.x = Math.PI / 2; torch.position.z = -0.55; arm.add(torch);
    // seen from your side, a teammate's torch is a small glint, not a glare
    this.lens = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: 0xfff0d8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.35 }));
    this.lens.scale.setScalar(0.14); this.lens.position.z = -0.66; arm.add(this.lens);
    this.arm = arm;
    this.group.add(body, head, arm);
    this.tag = label(name || 'Friend'); this.tag.position.y = 2.0; this.group.add(this.tag);
    this.light = new THREE.SpotLight(0xfff0d8, 0, 26, 0.5, 0.55, 1.7);
    this.target = new THREE.Object3D(); this.light.target = this.target;
    this.state = { x: 0, z: 0, yaw: 0, pitch: 0, flash: true, crouch: false, moving: false, sprint: false };
    this.v = { x: 0, z: 0, yaw: 0, pitch: 0, bob: 0, eye: 1.62 };
    this.stepAcc = 0;
  }
  addTo(scene) { scene.add(this.group, this.light, this.target); }
  removeFrom(scene) { scene.remove(this.group, this.light, this.target); }
  set(a) {
    if (!a) return;
    this.raw = a;
    const s = this.state;
    [s.x, s.z, s.yaw, s.pitch] = a;
    s.flash = !!a[4]; s.crouch = !!a[5]; s.moving = !!a[6]; s.sprint = !!a[7];
  }
  update(dt, visible) {
    const s = this.state, v = this.v;
    if (Math.hypot(s.x - v.x, s.z - v.z) > 5) { v.x = s.x; v.z = s.z; }
    const ox = v.x, oz = v.z;
    v.x = damp(v.x, s.x, 14, dt); v.z = damp(v.z, s.z, 14, dt);
    v.yaw = dampAngle(v.yaw, s.yaw, 14, dt); v.pitch = damp(v.pitch, s.pitch, 14, dt);
    v.eye = damp(v.eye, s.crouch ? 1.0 : 1.62, 10, dt);
    const moved = Math.hypot(v.x - ox, v.z - oz);
    this.stepAcc += moved;
    v.bob += moved * 2.4;
    this.group.position.set(v.x, 0, v.z);
    this.group.rotation.y = v.yaw;
    const k = v.eye / 1.62;
    this.body.scale.y = k; this.body.position.y = 0.95 * k;
    this.head.position.y = 1.58 * k + Math.abs(Math.sin(v.bob)) * 0.03;
    this.arm.position.y = 1.32 * k;
    this.arm.rotation.x = v.pitch;
    this.group.visible = visible;
    const on = s.flash;
    this.lens.visible = on;
    const fwd = new THREE.Vector3(-Math.sin(v.yaw) * Math.cos(v.pitch), Math.sin(v.pitch), -Math.cos(v.yaw) * Math.cos(v.pitch));
    this.light.position.set(v.x, v.eye - 0.2, v.z).addScaledVector(fwd, 0.5);
    this.target.position.copy(this.light.position).addScaledVector(fwd, 10);
    this.target.updateMatrixWorld();
    this.light.intensity = on ? 24 : 0;
  }
  eyePos() { return { x: this.v.x, y: this.v.eye, z: this.v.z }; }
}
