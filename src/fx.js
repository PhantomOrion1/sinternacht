// Particles + the final screen shader (grain, vignette, scare distortion).
import * as THREE from 'three';
import { R } from './rng.js';

export class Particles {
  constructor(scene, T) {
    this.scene = scene; this.T = T; this.bursts = [];
  }
  burst(x, y, z, { count = 40, color = 0x0a0a0a, size = 0.25, speed = 1.5, life = 1.6, up = 0.6, additive = false, tex } = {}) {
    const pos = new Float32Array(count * 3), vel = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = x + R(-0.2, 0.2); pos[i * 3 + 1] = y + R(-0.3, 0.3); pos[i * 3 + 2] = z + R(-0.2, 0.2);
      vel.push([R(-1, 1) * speed, R(0, 1) * speed * up + 0.2, R(-1, 1) * speed]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ map: tex || (additive ? this.T.glow : this.T.soot), size, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: 1 });
    const p = new THREE.Points(g, m);
    this.scene.add(p);
    this.bursts.push({ p, vel, t: 0, life });
  }
  update(dt) {
    for (let k = this.bursts.length - 1; k >= 0; k--) {
      const b = this.bursts[k];
      b.t += dt;
      const pos = b.p.geometry.attributes.position;
      for (let i = 0; i < b.vel.length; i++) {
        const v = b.vel[i];
        v[0] *= 0.97; v[2] *= 0.97; v[1] = v[1] * 0.97 + 0.1 * dt;
        pos.setXYZ(i, pos.getX(i) + v[0] * dt, pos.getY(i) + v[1] * dt, pos.getZ(i) + v[2] * dt);
      }
      pos.needsUpdate = true;
      b.p.material.opacity = Math.max(0, 1 - b.t / b.life);
      b.p.material.size *= 1 + dt * 0.6;
      if (b.t > b.life) { this.scene.remove(b.p); b.p.geometry.dispose(); b.p.material.dispose(); this.bursts.splice(k, 1); }
    }
  }
  clear() { for (const b of this.bursts) { this.scene.remove(b.p); b.p.geometry.dispose(); b.p.material.dispose(); } this.bursts = []; }
}

export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    scare: { value: 0 },
    grain: { value: 0.06 },
    vig: { value: 0.35 },
    red: { value: 0 },
    blackout: { value: 0 },
    white: { value: 0 },
    invert: { value: 0 },
    ca: { value: 0.004 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, scare, grain, vig, red, blackout, white, invert, ca;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float d = length(c);
      uv += c * scare * 0.06 * sin(time * 47.0 + d * 28.0);
      uv.x += scare * 0.015 * (hash(vec2(floor(uv.y * 40.0), floor(time * 30.0))) - 0.5);
      float off = (ca + scare * 0.035) * d;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * off).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 0.72);
      col *= mix(vec3(0.8, 0.92, 1.1), vec3(1.04, 1.0, 0.94), smoothstep(0.02, 0.45, l));
      col *= smoothstep(0.9, 0.22, d * (1.0 + vig));
      col = mix(col, vec3(l * 1.8 + 0.08, l * 0.1, l * 0.08), red);
      col = mix(col, 1.0 - col, invert);
      float g = hash(vUv * vec2(1733.0, 997.0) + fract(time * 7.13) * 91.0) - 0.5;
      col += g * (grain + scare * 0.25);
      col = mix(col, vec3(1.0, 0.97, 0.9), white);
      col *= 1.0 - blackout;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
