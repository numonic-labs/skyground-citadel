// Skyground Citadel: what fills the air. The video's world never looks empty: drifting motes catch the light around Kai and
// banks of mist hang between the islands and at the foot of the waterfalls. Both are single point clouds (one draw call each)
// animated in the vertex shader, so they cost no CPU per frame.
import * as THREE from 'three';

const MOTE_VERT = `
attribute vec3 seed;
uniform vec3 uCam;
uniform vec3 uBox;
uniform float uTime;
uniform float uScale;
varying float vAlpha;
void main() {
  // Each mote drifts on the wind and wraps inside a box that follows the camera, so the air is full wherever Kai goes.
  vec3 p = seed * uBox;
  p += vec3(uTime * 0.45, uTime * 0.06 + sin(uTime * 0.5 + seed.x * 40.0) * 0.5, uTime * 0.18) * (0.5 + seed.y);
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = 0.045 + 0.075 * fract(seed.z * 7.31);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  float edge = 1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, length(p - uCam));
  float near = smoothstep(0.6, 2.5, -mv.z);
  vAlpha = (0.3 + 0.45 * (0.5 + 0.5 * sin(uTime * 1.6 + seed.x * 90.0))) * edge * near;
}`;
const MOTE_FRAG = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.5);
  gl_FragColor = vec4(uColor, a * vAlpha);
}`;

const MIST_VERT = `
attribute vec4 info; // size (m), phase, drift (m), alpha
uniform float uTime;
uniform float uScale;
uniform float uMaxPx;
varying float vAlpha;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.045 + info.y) * info.z;
  p.z += cos(uTime * 0.035 + info.y * 1.7) * info.z * 0.6;
  p.y += sin(uTime * 0.11 + info.y * 2.3) * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  float px = info.x * uScale / max(0.1, dist);
  gl_PointSize = min(px, uMaxPx);
  // Thin out a bank as the camera enters it (a puff that fills the screen is costly and hides the game), and never let the size
  // clamp make a near puff look denser than it is.
  vAlpha = info.w * smoothstep(5.0, 18.0, dist) * min(1.0, uMaxPx / max(px, 1.0));
}`;
const MIST_FRAG = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  float a = exp(-d2 * 3.2) - 0.04;
  gl_FragColor = vec4(uColor, max(0.0, a) * vAlpha);
}`;

/**
 * Build the motes and the mist. `mistSpots` is a list of { x, y, z, size, alpha?, drift? } puffs; `rnd` is a 0..1 generator.
 * Returns { update(t, camera, height, fov), setColors(mote, mist) }.
 */
export function createAmbient(
  scene,
  renderer,
  mistSpots,
  rnd = Math.random,
  moteCount = 260
) {
  const gl = renderer.getContext();
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  const maxPx = Math.min(range ? range[1] : 256, 700);

  const seeds = new Float32Array(moteCount * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(moteCount * 3), 3)
  );
  moteGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  const moteMat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(34, 13, 34) },
      uTime: { value: 0 },
      uScale: { value: 600 },
      uColor: { value: new THREE.Color(0xfff3cf) },
    },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  motes.renderOrder = 4;
  scene.add(motes);

  const n = mistSpots.length;
  const pos = new Float32Array(n * 3);
  const info = new Float32Array(n * 4);
  mistSpots.forEach((m, i) => {
    pos[i * 3] = m.x;
    pos[i * 3 + 1] = m.y;
    pos[i * 3 + 2] = m.z;
    info[i * 4] = m.size;
    info[i * 4 + 1] = rnd() * 6.28;
    info[i * 4 + 2] = m.drift ?? 3;
    info[i * 4 + 3] = m.alpha ?? 0.16;
  });
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  mistGeo.setAttribute('info', new THREE.BufferAttribute(info, 4));
  const mistMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 600 },
      uMaxPx: { value: maxPx },
      uColor: { value: new THREE.Color(0xf4f6ff) },
    },
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const mist = new THREE.Points(mistGeo, mistMat);
  mist.frustumCulled = false;
  mist.renderOrder = 3;
  mist.visible = n > 0;
  scene.add(mist);

  return {
    motes,
    mist,
    maxPx,
    update(t, camera, height, fovDeg) {
      const s = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
      moteMat.uniforms.uTime.value = t;
      moteMat.uniforms.uScale.value = s;
      moteMat.uniforms.uCam.value.copy(camera.position);
      mistMat.uniforms.uTime.value = t;
      mistMat.uniforms.uScale.value = s;
    },
    /** Tint with the light: motes take the sun's colour, mist the fog's (lifted toward white). */
    setColors(sunColor, fogColor) {
      moteMat.uniforms.uColor.value
        .copy(sunColor)
        .lerp(new THREE.Color(0xffffff), 0.45);
      mistMat.uniforms.uColor.value
        .copy(fogColor)
        .lerp(new THREE.Color(0xffffff), 0.55);
    },
  };
}
