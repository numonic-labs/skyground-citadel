// Skyground Citadel: particles. Two point clouds (additive sparks and soft dust), each one draw call, updated on the CPU.
// The video shows a gold flash on every pickup, a golden dust trail on leaps and a golden burst on landing; this is where they live.
import * as THREE from 'three';

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
}`;
const FRAG = `
uniform float uSharp;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), uSharp);
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

class Cloud {
  constructor(n, additive) {
    this.n = n;
    this.next = 0;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); // seconds left
    this.span = new Float32Array(n); // total life
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.a0 = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    );
    geo.setAttribute(
      'aColor',
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage)
    );
    geo.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage)
    );
    geo.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage)
    );
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: 600 },
        uSharp: { value: additive ? 1.6 : 1.0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.live = 0;
  }
  emit(p) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx || 0;
    this.vel[i * 3 + 1] = p.vy || 0;
    this.vel[i * 3 + 2] = p.vz || 0;
    this.col[i * 3] = p.r;
    this.col[i * 3 + 1] = p.g;
    this.col[i * 3 + 2] = p.b;
    this.life[i] = this.span[i] = p.life;
    this.size0[i] = p.size;
    this.size1[i] = p.size1 === undefined ? p.size * 0.2 : p.size1;
    this.grav[i] = p.gravity || 0;
    this.drag[i] = p.drag || 0;
    this.a0[i] = p.alpha === undefined ? 1 : p.alpha;
  }
  update(dt) {
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      live++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.span[i]); // 1 -> 0
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.size1[i] + (this.size0[i] - this.size1[i]) * k;
      this.alpha[i] = this.a0[i] * Math.min(1, k * 2.2);
    }
    this.live = live;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    this.points.visible = live > 0;
  }
}

const hex = c => ({
  r: ((c >> 16) & 255) / 255,
  g: ((c >> 8) & 255) / 255,
  b: (c & 255) / 255,
});

/** The game's particle effects. `rnd` is a 0..1 generator (visual only: it never touches the game state). */
export function createFx(scene, rnd = Math.random) {
  const sparks = new Cloud(700, true);
  const dust = new Cloud(400, false);
  scene.add(sparks.points, dust.points);
  const R = (a, b) => a + (b - a) * rnd();

  const fx = {
    sparks,
    dust,
    get live() {
      return sparks.live + dust.live;
    },
    /** Call when the canvas size or the camera's field of view changes, so sizes stay in metres. */
    resize(height, fovDeg) {
      const s = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
      sparks.material.uniforms.uScale.value = s;
      dust.material.uniforms.uScale.value = s;
    },
    update(dt) {
      sparks.update(dt);
      dust.update(dt);
    },
    /** A burst of sparks flying out in every direction. */
    burst(
      x,
      y,
      z,
      {
        n = 12,
        color = 0xffd45a,
        color2 = 0xffffff,
        speed = 4,
        life = 0.5,
        size = 0.28,
        gravity = 6,
        up = 1.5,
      } = {}
    ) {
      const c1 = hex(color);
      const c2 = hex(color2);
      for (let i = 0; i < n; i++) {
        const a = R(0, Math.PI * 2);
        const e = R(-0.6, 1.0);
        const s = speed * R(0.5, 1);
        const c = rnd() > 0.35 ? c1 : c2;
        sparks.emit({
          x,
          y,
          z,
          vx: Math.cos(a) * Math.cos(e) * s,
          vy: Math.sin(e) * s + up,
          vz: Math.sin(a) * Math.cos(e) * s,
          ...c,
          life: life * R(0.6, 1),
          size: size * R(0.7, 1.3),
          gravity,
          drag: 1.5,
        });
      }
    },
    /** A flat ring of sparks spreading outward (double jump, checkpoint, stomp). */
    ring(
      x,
      y,
      z,
      { n = 16, color = 0xbfeaff, speed = 5, life = 0.4, size = 0.26 } = {}
    ) {
      const c = hex(color);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + R(-0.1, 0.1);
        sparks.emit({
          x,
          y,
          z,
          vx: Math.cos(a) * speed,
          vy: R(-0.2, 0.4),
          vz: Math.sin(a) * speed,
          ...c,
          life: life * R(0.8, 1),
          size,
          gravity: 0,
          drag: 3.5,
        });
      }
    },
    /** Soft puffs spreading along the ground (landing, take-off, footsteps). */
    puff(
      x,
      y,
      z,
      {
        n = 8,
        color = 0xf2ead8,
        speed = 2.2,
        life = 0.55,
        size = 0.5,
        alpha = 0.55,
      } = {}
    ) {
      const c = hex(color);
      for (let i = 0; i < n; i++) {
        const a = R(0, Math.PI * 2);
        const s = speed * R(0.4, 1);
        dust.emit({
          x: x + Math.cos(a) * 0.15,
          y: y + R(0.02, 0.12),
          z: z + Math.sin(a) * 0.15,
          vx: Math.cos(a) * s,
          vy: R(0.2, 0.9),
          vz: Math.sin(a) * s,
          ...c,
          life: life * R(0.7, 1),
          size: size * R(0.5, 0.9),
          size1: size * 1.7,
          gravity: -0.4,
          drag: 3,
          alpha,
        });
      }
    },
    /** One mote left behind a moving thing (the golden leap trail, the rail's sparks). */
    mote(
      x,
      y,
      z,
      {
        color = 0xffd98a,
        life = 0.5,
        size = 0.22,
        spread = 0.25,
        vy = 0.3,
      } = {}
    ) {
      sparks.emit({
        x: x + R(-spread, spread),
        y: y + R(-spread, spread),
        z: z + R(-spread, spread),
        vx: R(-0.3, 0.3),
        vy,
        vz: R(-0.3, 0.3),
        ...hex(color),
        life: life * R(0.7, 1),
        size: size * R(0.6, 1.2),
        gravity: 0.6,
        drag: 1,
      });
    },
    /** A fan of sparks thrown forward from a point along a heading (Kai's wave): `yaw` 0 is +Z, `half` is the fan's half angle. */
    cone(
      x,
      y,
      z,
      yaw,
      {
        n = 46,
        half = 0.95,
        speed = 13,
        life = 0.42,
        size = 0.3,
        colors = [0xffe9a8, 0x9ffff4, 0xffffff],
      } = {}
    ) {
      const cs = colors.map(hex);
      for (let i = 0; i < n; i++) {
        const a = yaw + R(-half, half);
        const s = speed * R(0.55, 1);
        sparks.emit({
          x,
          y: y + R(-0.2, 0.2),
          z,
          vx: Math.sin(a) * s,
          vy: R(-0.6, 1.6),
          vz: Math.cos(a) * s,
          ...cs[Math.floor(rnd() * cs.length)],
          life: life * R(0.6, 1),
          size: size * R(0.6, 1.3),
          gravity: 0,
          drag: 2.6,
        });
      }
    },
    /** Water thrown up by a foot or a landing in a stream. */
    splash(x, y, z, { n = 8, speed = 3.2, size = 0.2 } = {}) {
      const c1 = hex(0xdff4ff);
      const c2 = hex(0x8fd0ff);
      for (let i = 0; i < n; i++) {
        const a = R(0, Math.PI * 2);
        const s = speed * R(0.3, 1);
        sparks.emit({
          x,
          y: y + 0.05,
          z,
          vx: Math.cos(a) * s,
          vy: R(2.2, 5.2) * (speed / 3.2),
          vz: Math.sin(a) * s,
          ...(rnd() > 0.5 ? c1 : c2),
          life: R(0.35, 0.6),
          size: size * R(0.6, 1.2),
          size1: size * 0.3,
          gravity: 14,
          drag: 0.6,
          alpha: 0.9,
        });
      }
      for (let i = 0; i < Math.ceil(n / 3); i++) {
        const a = R(0, Math.PI * 2);
        dust.emit({
          x: x + Math.cos(a) * 0.2,
          y: y + 0.1,
          z: z + Math.sin(a) * 0.2,
          vx: Math.cos(a) * 1.2,
          vy: R(0.3, 1.0),
          vz: Math.sin(a) * 1.2,
          ...c1,
          life: R(0.4, 0.7),
          size: 0.35,
          size1: 0.9,
          gravity: -0.3,
          drag: 3,
          alpha: 0.4,
        });
      }
    },
    /** Coloured paper falling slowly (the finish). */
    confetti(x, y, z, n = 60) {
      const colors = [
        0xff5a7a, 0xffd45a, 0x4ff2e0, 0x7fb8ff, 0xb98bff, 0x8fe36a,
      ].map(hex);
      for (let i = 0; i < n; i++) {
        const a = R(0, Math.PI * 2);
        const s = R(1.5, 6);
        sparks.emit({
          x,
          y,
          z,
          vx: Math.cos(a) * s,
          vy: R(4, 9),
          vz: Math.sin(a) * s,
          ...colors[Math.floor(rnd() * colors.length)],
          life: R(1.4, 2.4),
          size: R(0.2, 0.36),
          size1: 0.14,
          gravity: 7,
          drag: 1.2,
        });
      }
    },
  };
  return fx;
}
