// Skyground Citadel L1/S1: renderer, input, animation and the window.__game state contract.
// Game rules live in logic.mjs (pure, tested in Node). Scenery is built from generated GLB pieces in
// assets/scenery/ (see scenery.js); any piece that is missing falls back to PLACEHOLDER geometry
// (boxes, cones, spheres), so the game always runs. Kai is a generated model too.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  loadPieces,
  normalise,
  shrinkTextures,
  instancedFrom,
  triangleCount,
} from './scenery.js';
import { COURSE as COURSE_S1 } from './course.mjs';
import { COURSE_S1_OPEN } from './course.s1o.mjs';
import { COURSE_S2 } from './course.s2.mjs';
import { COURSE_S3 } from './course.s3.mjs';
import { COURSE_S4 } from './course.s4.mjs';
import { COURSE_S5 } from './course.s5.mjs';
import { COURSE_S6 } from './course.s6.mjs';
import { COURSE_WORLD } from './course.world.mjs';
import {
  mergeGeometries,
  mergeVertices,
} from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { createAudio } from './audio.js';
import { createFx } from './fx.js';
import { createAmbient } from './ambient.js';
import {
  PARAMS,
  createState,
  step,
  autopilot,
  navigate,
  pilot,
  platformBounds,
  enemyPos,
  surfaceBelow,
  supportAt,
  surfaceY,
  gatesOf,
  checkpointAt,
  neighbours,
  creatureY,
  habitatOk,
  SPECIES,
} from './logic.mjs';

const q = new URLSearchParams(location.search);
const AUTOSTART = q.has('autostart');
const MANUAL = q.has('manual'); // tests drive __game.advance(n); no rAF stepping
const LEVEL = ['s2', 's3', 's4', 's5', 's6'].includes(q.get('level'))
  ? q.get('level')
  : 's1'; // ?level=s2 to s6 plays that single section (the older side-view builds)
// The default is the whole journey (course.world.mjs). It is built by the open-S1 code path (LEVEL 's1') plus the world block
// further down; ?level=s1 is act 1 alone and ?level=s1c the first corridor.
const WORLD = !q.get('level') || q.get('level') === 'world';
const COURSE =
  LEVEL === 's6'
    ? COURSE_S6
    : LEVEL === 's5'
      ? COURSE_S5
      : LEVEL === 's4'
        ? COURSE_S4
        : LEVEL === 's3'
          ? COURSE_S3
          : LEVEL === 's2'
            ? COURSE_S2
            : q.get('level') === 's1c'
              ? COURSE_S1
              : WORLD
                ? COURSE_WORLD
                : COURSE_S1_OPEN;
const ROUTE = q.get('route') || 'centre'; // which route the scripted player (?bot) follows in the open S1
if (LEVEL === 's1' && COURSE.routes) {
  document.getElementById('hint').textContent = WORLD
    ? 'You are the steward of the citadel grounds. Take creatures that are out of place home, wake the dry springs with sky gems, and make your way to the citadel'
    : 'Many ways around: the fenced path, stairs or a pad up to the high road, drops to lower islands, a hidden islet · arrows move · Space jumps (again in the air)';
}
if (LEVEL === 's6') {
  document.getElementById('hint').textContent =
    'Climb the islands · Space: jump (again in the air) · jump ON the purple guardian to defeat it and open the gate';
}
if (LEVEL === 's5') {
  document.getElementById('hint').textContent =
    'Arrows move in any direction · Space: jump (again in the air) · ride the sliding slabs across the gaps · jump the orbs and sprouts';
}
if (LEVEL === 's4') {
  document.getElementById('hint').textContent =
    'Find the key to open the gate · jump onto the glowing rail and ride it · Space: jump off (over the blue orb)';
}
if (LEVEL === 's3') {
  document.getElementById('hint').textContent =
    'E or Shift: grapple at the golden orb · arrows move in any direction, hold → to swing · Space: let go';
}
document.getElementById('hint').textContent +=
  ' · R / F or drag the mouse: turn the camera (C: reset)';
const BOT = q.has('bot'); // scripted player from logic.mjs
const SHADOWS = q.get('shadows') !== '0';
const PERF_SECONDS = Number(q.get('perf') || 0);
const SEED = Number(q.get('seed') || 1);
const KAI_HEIGHT = 1.7; // metres; the model is normalised to height 1.0
const KAI_GLOW = Number(q.get('glow') ?? 0.65); // self-lit share of Kai's texture (?glow=0 turns it off)

const game = { ready: false, errors: [], warnings: [] };
window.__game = game;
window.addEventListener('error', e => game.errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', e =>
  game.errors.push(String(e.reason))
);

// ---------- small helpers ----------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0,
    ...extra,
  });

// Bake a small figure made of many primitive meshes (a creature, a bramble, a bloom) into ONE mesh: each part's colour becomes a
// vertex colour, so the figure costs one draw call instead of a dozen. Call it while `root` is still at the origin.
const bakedMat = new THREE.MeshLambertMaterial({
  vertexColors: true,
  emissive: 0x2c2c2c,
});
function bake(root) {
  root.updateMatrixWorld(true);
  const geos = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    const c = (Array.isArray(o.material) ? o.material[0] : o.material).color;
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) {
      col[i] = c.r;
      col[i + 1] = c.g;
      col[i + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos), bakedMat);
  mesh.castShadow = true;
  return mesh;
}

// ---------- renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = SHADOWS;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
{
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5aa2e8');
  grad.addColorStop(0.55, '#9ccbf3');
  grad.addColorStop(1, '#e4f1fb');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}
scene.fog = new THREE.Fog(0xc9d7f3, 90, 620);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  900
);
camera.position.set(0, 4.5, -8);

const hemi = new THREE.HemisphereLight(0xbccff6, 0x8a7aa8, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd9a3, 2.6);
sun.castShadow = SHADOWS;
sun.shadow.mapSize.set(1024, 1024);
// The shadow map covers 22 m around Kai (was 32 m): about 2 cm a texel, so his shadow has a clean outline.
sun.shadow.camera.left = -11;
sun.shadow.camera.right = 11;
sun.shadow.camera.top = 11;
sun.shadow.camera.bottom = -11;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// ---------- sky: a gradient dome with the sun in it, drifting from blue day to a pink and violet dusk along the road, as the video
// does (its last seconds are pink, orange and violet). `tod` runs 0 (start) to 1 (the citadel). ----------
const SKY_KEYS = [
  {
    at: 0,
    top: 0x4a98e6,
    mid: 0x9ccbf3,
    low: 0xe4f1fb,
    fog: 0xc9d7f3,
    hemiSky: 0xbccff6,
    hemiGround: 0x8a7aa8,
    sun: 0xffd9a3,
    sunI: 2.6,
    skyline: 0xdbe4ff,
    dir: [0.5, 0.8, -0.3],
  },
  {
    at: 0.55,
    top: 0x4f86d8,
    mid: 0xf3cfae,
    low: 0xffe6cc,
    fog: 0xf0d9d2,
    hemiSky: 0xcfc9f0,
    hemiGround: 0x8f7aa0,
    sun: 0xffc784,
    sunI: 2.6,
    skyline: 0xffe6da,
    dir: [0.62, 0.62, -0.05],
  },
  {
    at: 1,
    top: 0x5b62c4,
    mid: 0xec9fbd,
    low: 0xffc9a2,
    fog: 0xe9bccb,
    hemiSky: 0xd9b8ea,
    hemiGround: 0x7d5e96,
    sun: 0xffa973,
    sunI: 2.4,
    skyline: 0xffcfe0,
    dir: [0.7, 0.5, 0.2], // not lower: a long raking shadow slides far from Kai's feet and reads as wrong
  },
];
const skyU = {
  top: { value: new THREE.Color() },
  mid: { value: new THREE.Color() },
  low: { value: new THREE.Color() },
  sunDir: { value: new THREE.Vector3(0.5, 0.8, -0.3).normalize() },
  sunCol: { value: new THREE.Color() },
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(820, 24, 14),
  new THREE.ShaderMaterial({
    uniforms: skyU,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: `varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `uniform vec3 top;
uniform vec3 mid;
uniform vec3 low;
uniform vec3 sunDir;
uniform vec3 sunCol;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = mix(low, mid, smoothstep(-0.06, 0.2, d.y));
  c = mix(c, top, smoothstep(0.16, 0.72, d.y));
  float s = max(0.0, dot(d, sunDir));
  c += sunCol * (pow(s, 10.0) * 0.22 + pow(s, 90.0) * 0.4 + pow(s, 900.0) * 1.2);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
  })
);
skyDome.renderOrder = -100;
skyDome.frustumCulled = false;
scene.add(skyDome);
const sky = { tod: -1, mat: null, c: new THREE.Color(), c2: new THREE.Color() };
function applySky(tod) {
  if (Math.abs(tod - sky.tod) < 0.002) return;
  sky.tod = tod;
  let a = SKY_KEYS[0];
  let b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (tod >= SKY_KEYS[i].at && tod <= SKY_KEYS[i + 1].at) {
      a = SKY_KEYS[i];
      b = SKY_KEYS[i + 1];
    }
  }
  const k =
    b.at === a.at ? 0 : Math.max(0, Math.min(1, (tod - a.at) / (b.at - a.at)));
  const mix = (target, key) =>
    target.copy(sky.c.set(a[key])).lerp(sky.c2.set(b[key]), k);
  mix(skyU.top.value, 'top');
  mix(skyU.mid.value, 'mid');
  mix(skyU.low.value, 'low');
  mix(scene.fog.color, 'fog');
  mix(hemi.color, 'hemiSky');
  mix(hemi.groundColor, 'hemiGround');
  mix(sun.color, 'sun');
  skyU.sunCol.value.copy(sun.color);
  sun.intensity = a.sunI + (b.sunI - a.sunI) * k;
  if (sky.mat) mix(sky.mat.color, 'skyline');
  if (sky.ambient) sky.ambient.setColors(sun.color, scene.fog.color); // the air takes the light's colour
  skyU.sunDir.value
    .set(
      a.dir[0] + (b.dir[0] - a.dir[0]) * k,
      a.dir[1] + (b.dir[1] - a.dir[1]) * k,
      a.dir[2] + (b.dir[2] - a.dir[2]) * k
    )
    .normalize();
}
applySky(0);

// ---------- feel: sound, particles and the small state behind squash, lean, shake and the HUD ----------
const audio = createAudio();
const fx = createFx(scene, mulberry32(4242));
fx.resize(window.innerHeight, camera.fov);
game.audio = audio;
game.fx = fx;
const feel = {
  squash: 1, // Kai's vertical stretch (1 = at rest), a damped spring kicked by jumps and landings
  squashV: 0,
  lean: 0,
  bank: 0,
  prevYaw: 0,
  stepT: 0,
  stepAlt: false,
  shake: 0,
  hitStop: 0, // seconds the game holds still (a stomp, a hit)
  hurtFlash: 0,
  whiteFlash: 0,
  lastVy: 0,
  fallWhistled: false,
  area: -1,
  camDist: 5.8,
  camH: 3.2,
  camBaseY: 0,
  camSide: 0,
  snap: new THREE.Vector3(),
  carryTip: '',
  waveT: 0,
  ropeT: 1,
  ropeHit: true,
  sprayT: 0,
  toastT: 0,
  bumpT: 0,
  gemBumpT: 0,
  hudKey: '',
  clockKey: '',
  celebrate: 0,
  confettiT: 0,
};

// ---------- generated scenery pieces (optional; placeholders are used for any that are missing) ----------
const { pieces, warnings: sceneryWarnings } = await loadPieces([
  'fence',
  'island_a',
  'island_b',
  'island_c',
  'island_d',
  'castle',
  'coin',
  'waypoint',
  ...(LEVEL === 's1' && COURSE.springs ? ['spring'] : []),
  ...(LEVEL === 's1' && COURSE.routes ? ['cliffwall', 'bush'] : []),
  ...(WORLD
    ? ['flyer', 'boardwalk', 'raft', 'post', 'waterfall', 'lantern']
    : []),
  ...(LEVEL !== 's1'
    ? [
        'spring',
        'flyer',
        'boardwalk',
        'raft',
        'post',
        'waterfall',
        'bush',
        'cliffwall',
        'lantern',
      ]
    : []),
]);
game.warnings.push(...sceneryWarnings);
game.scenery = { loaded: [], shrunkTextures: 0, triangles: {} };
for (const [name, piece] of Object.entries(pieces)) {
  if (!piece) continue;
  game.scenery.loaded.push(name);
  game.scenery.shrunkTextures += shrinkTextures(piece, 1024);
  game.scenery.triangles[name] = triangleCount(piece);
}

// ---------- course geometry ----------
const GRASS = mat(0x6bbf4a);
const ROCK = mat(0x8b8f9a);
const WOOD = mat(0x8a5a33);
// Generated tileable textures; each material keeps its flat colour if the file is missing.
const TILE_M = 4;
const texLoader = new THREE.TextureLoader();
// Load each texture once, before the course is built, so every material has its map from the start (a map attached
// later forces a shader recompile mid-play) and the three images are shared rather than loaded per platform.
const baseTex = {};
await Promise.all(
  ['grass', 'path', 'cliff'].map(async name => {
    try {
      const t = await texLoader.loadAsync(`/assets/textures/${name}.png`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      baseTex[name] = t;
    } catch {
      console.warn(`texture ${name} missing; flat colour`);
    }
  })
);
function tiledMat(url, color, rx, ry) {
  const base = baseTex[url.split('/').pop().replace('.png', '')];
  if (!base) return mat(color);
  const t = base.clone(); // shares the image, so one GPU upload per texture
  t.needsUpdate = true;
  t.repeat.set(Math.max(1, rx), Math.max(1, ry));
  const m = mat(0xffffff);
  m.map = t;
  return m;
}
const cliffMat = (h, len) =>
  tiledMat('/assets/textures/cliff.png', 0x8b8f9a, len / TILE_M, h / TILE_M);
// Deck variation: low-frequency golden and dark patches, grass at the edges, plank seams across the path.
function deckOverlay(repeatY) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = rand() * 256;
    const y = rand() * 512;
    const r = 30 + rand() * 70;
    const gold = rand() > 0.45;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, gold ? 'rgba(255,205,95,0.38)' : 'rgba(120,70,25,0.22)');
    gr.addColorStop(1, 'rgba(255,205,95,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let side = 0; side < 2; side++) {
    // a ragged strip along each edge whose width wanders, so it never reads as repeated patches
    let w = 14 + rand() * 18;
    for (let y = 0; y < 512; y += 6) {
      w = Math.max(4, Math.min(46, w + (rand() - 0.5) * 9));
      const a = 0.55 + rand() * 0.3;
      const gr =
        side === 0
          ? g.createLinearGradient(0, 0, w, 0)
          : g.createLinearGradient(256, 0, 256 - w, 0);
      gr.addColorStop(0, `rgba(88,160,44,${a})`);
      gr.addColorStop(1, 'rgba(88,160,44,0)');
      g.fillStyle = gr;
      g.fillRect(side === 0 ? 0 : 256 - w, y, w, 6);
    }
  }
  g.lineWidth = 3;
  for (let y = 16; y < 512; y += 64) {
    g.strokeStyle = `rgba(110,62,20,${0.15 + rand() * 0.3})`;
    g.beginPath();
    g.moveTo(0, y + (rand() - 0.5) * 6);
    g.lineTo(256, y + (rand() - 0.5) * 6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, Math.max(1, repeatY));
  return t;
}
const course = new THREE.Group();
scene.add(course);
const springPads = []; // { group, t } for every spring pad in the level; t counts down the squash after it fires
const seaLayers = []; // the cloud sea's texture layers, drifted every frame
const lodGroups = []; // { g, x, z, mover } small props drawn only near Kai
const tuftMatrices = []; // every still island's grass tufts, drawn as one batch (built after the level)
const RIM_REMOVE = Number(q.get('rim') ?? 0.68); // share of the cliff wall's vertices removed by simplification (?rim=0 keeps all)
const rimCache = {};
let skirtMat = null;
const LOD_NEAR = Number(q.get('lod') || 110); // metres within which islands show their detailed rim and bushes
let tuftGeo = null;
let tuftMat = null;
let pinkBush = null; // the bush with its foliage turned to blossom pink (made on first use)
// Shared by every grass batch: the clock for the wind and where Kai is, so the grass sways and parts around his feet.
const grassU = { uTime: { value: 0 }, uKai: { value: new THREE.Vector3() } };
const GRASS_PROJECT = `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  {
    vec3 root = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
    float hh = position.y; // 0 at the root, 1 at the tip
    float sway = sin( uTime * 1.7 + root.x * 0.7 + root.z * 0.9 ) * 0.09 + sin( uTime * 3.3 + root.x * 1.9 - root.z * 1.3 ) * 0.035;
    mvPosition.x += sway * hh;
    mvPosition.z += sway * 0.6 * hh;
    vec2 away = root.xz - uKai.xz;
    float dist = length( away );
    float push = ( 1.0 - smoothstep( 0.25, 1.4, dist ) ) * step( abs( root.y - uKai.y ), 1.5 ) * 0.5 * hh;
    mvPosition.xz += ( dist > 0.001 ? away / dist : vec2( 0.0 ) ) * push;
    mvPosition.y -= push * 0.35;
  }
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
let slabTufts = null; // shared tuft texture for slabDress
// One fence segment is 2 m along the path, posts included; the generated piece is scaled to fit.
const FENCE_SEGMENT_M = 2;
const fenceTemplate = pieces.fence
  ? normalise(pieces.fence, {
      dimension: 'longest',
      size: FENCE_SEGMENT_M,
      alongZ: true,
      anchor: 'bottom',
    })
  : null;

for (const p of LEVEL !== 's1' ? [] : COURSE.platforms) {
  const w = p.x1 - p.x0,
    d = p.z1 - p.z0,
    cx = (p.x0 + p.x1) / 2,
    cz = (p.z0 + p.z1) / 2;
  if (p.kind || p.move) continue; // decks, bridges and sliding islands: the world block builds them
  if (p.model && pieces[p.model.name]) {
    // A visit island: the generated island model as a real place (its walkable rectangle is the platform); its ruin, arch, waterfall
    // and trees are scenery around that area.
    const g = normalise(pieces[p.model.name].clone(true), {
      dimension: 'width',
      size: 8,
      anchor: 'center',
    });
    g.scale.setScalar(p.model.s);
    g.position.set(p.model.x, p.model.y, p.model.z);
    g.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    course.add(g);
    continue;
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), [
    cliffMat(0.3, d),
    cliffMat(0.3, d),
    tiledMat('/assets/textures/grass.png', 0x6bbf4a, w / TILE_M, d / TILE_M),
    GRASS,
    cliffMat(0.3, w),
    cliffMat(0.3, w),
  ]);
  top.position.set(cx, p.y - 0.15, cz);
  top.receiveShadow = true;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 3.2, d * 0.96), [
    cliffMat(3.2, d),
    cliffMat(3.2, d),
    ROCK,
    ROCK,
    cliffMat(3.2, w),
    cliffMat(3.2, w),
  ]);
  body.position.set(cx, p.y - 1.9, cz);
  body.castShadow = true;
  course.add(top, body);
  if (COURSE.routes && !p.fenced) {
    // The open S1's islands: the dressed island (grass dome, cliff rim, keel, bushes, tufts) instead of the plain slab.
    top.visible = false;
    body.visible = false;
    const dressed = new THREE.Group();
    slabDress(p, w, d, dressed);
    dressed.position.set(cx, 0, cz);
    course.add(dressed);
  }
  if (p.fenced) {
    const path = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.55, 0.04, d),
      tiledMat(
        '/assets/textures/path.png',
        0xc9a36b,
        (w * 0.55) / 2,
        d / TILE_M
      )
    );
    path.material.color.set(0xffd9a0); // warm ochre over the beige texture
    {
      const pw = w * 0.55;
      const overlay = new THREE.Mesh(
        new THREE.PlaneGeometry(pw, d),
        new THREE.MeshBasicMaterial({
          map: deckOverlay(d / 8),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        })
      );
      overlay.rotation.x = -Math.PI / 2;
      overlay.position.set(cx, p.y + 0.035, cz);
      course.add(overlay);
    }
    path.position.set(cx, p.y + 0.01, cz);
    path.receiveShadow = true;
    course.add(path);
    for (const sx of [p.x0 + 0.2, p.x1 - 0.2]) {
      if (fenceTemplate) {
        // Generated fence segment, instanced along the side (one draw call per side).
        const segLen = FENCE_SEGMENT_M;
        const count = Math.floor((d - 1) / segLen);
        const matrices = [];
        for (let i = 0; i < count; i++) {
          matrices.push(
            new THREE.Matrix4().makeTranslation(
              sx,
              p.y,
              p.z0 + 0.5 + segLen / 2 + i * segLen
            )
          );
        }
        for (const mesh of instancedFrom(fenceTemplate, matrices))
          course.add(mesh);
        continue;
      }
      for (let z = p.z0 + 1; z <= p.z1 - 0.5; z += 2) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 1.0, 0.16),
          WOOD
        );
        post.position.set(sx, p.y + 0.5, z);
        post.castShadow = true;
        course.add(post);
      }
      for (const ry of [0.45, 0.85]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.08, d - 1.2),
          WOOD
        );
        rail.position.set(sx, p.y + ry, cz);
        course.add(rail);
      }
    }
  }
}

if (LEVEL === 's1') for (const sp of COURSE.springs || []) makeSpringPad(sp);

// Coins.
const coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.08, 20);
coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({
  color: 0xffc933,
  emissive: 0xaa7a00,
  emissiveIntensity: 0.6,
  roughness: 0.35,
  metalness: 0.6,
});
const coinTemplate =
  LEVEL !== 's1' && pieces.lantern
    ? normalise(pieces.lantern, {
        dimension: 'height',
        size: 0.85,
        anchor: 'center',
      })
    : pieces.coin
      ? normalise(pieces.coin, {
          dimension: 'height',
          size: 0.55,
          anchor: 'center',
        })
      : null;
// Soft radial puff used by the cloud banks and the waypoint halo.
const cloudTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(255,255,255,0.95)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
if (coinTemplate) {
  coinTemplate.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.metalness = 0.15;
      m.roughness = 0.45;
      m.emissive = new THREE.Color(0xffb000);
      m.emissiveIntensity = 0.45;
    }
  });
}
if (coinTemplate && LEVEL !== 's1' && pieces.lantern) {
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffb340 })
  );
  flame.scale.set(0.8, 1.25, 0.8);
  flame.position.y = -0.04;
  coinTemplate.add(flame);
}
// In the open levels every coin is drawn in one instanced batch (110 coins would otherwise be 110 draw calls); each frame the
// matrices are rewritten for the spin, the bob and the pop when one is collected. The older single sections keep one mesh per coin.
const COIN_BATCH = LEVEL === 's1' && !!coinTemplate;
// From act 2 on the pickups are glowing lanterns, as in the video (the boardwalk and the islands have lanterns, not coins).
const LANTERNS_FROM_Z = 98;
let lanternTemplate = null;
if (WORLD && pieces.lantern) {
  lanternTemplate = normalise(pieces.lantern.clone(true), {
    dimension: 'height',
    size: 0.85,
    anchor: 'center',
  });
  lanternTemplate.traverse(o => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.metalness = 0.15;
    o.material.roughness = 0.45;
    o.material.emissive = new THREE.Color(0xffb000);
    o.material.emissiveIntensity = 0.55;
  });
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffc860 })
  );
  flame.scale.set(0.8, 1.25, 0.8);
  flame.position.y = -0.04;
  lanternTemplate.add(flame);
}
const coinBatches = []; // { meshes, idx (coin indices), lantern }
if (COIN_BATCH) {
  const all = COURSE.coins.map((c, i) => i);
  const groups = lanternTemplate
    ? [
        {
          tpl: coinTemplate,
          idx: all.filter(i => COURSE.coins[i].z < LANTERNS_FROM_Z),
        },
        {
          tpl: lanternTemplate,
          idx: all.filter(i => COURSE.coins[i].z >= LANTERNS_FROM_Z),
          lantern: true,
        },
      ]
    : [{ tpl: coinTemplate, idx: all }];
  for (const gr of groups) {
    // One batch per 80 m of the road, so pickups far behind or far ahead are neither drawn nor animated.
    const bands = new Map();
    for (const i of gr.idx) {
      const b = Math.floor(COURSE.coins[i].z / 80);
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push(i);
    }
    for (const [b, idx] of bands) {
      const meshes = instancedFrom(
        gr.tpl,
        idx.map(i =>
          new THREE.Matrix4().makeTranslation(
            COURSE.coins[i].x,
            COURSE.coins[i].y,
            COURSE.coins[i].z
          )
        )
      );
      for (const mesh of meshes) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false; // each batch spans a band of the level
        course.add(mesh);
      }
      coinBatches.push({ meshes, idx, lantern: !!gr.lantern, zc: b * 80 + 40 });
    }
  }
}
const coinPop = COURSE.coins.map(() => -1); // seconds since collected (-1: still there)
const coinMeshes = COIN_BATCH
  ? []
  : COURSE.coins.map(c => {
      // Clones share the generated geometry and materials; the placeholder is a plain gold disc.
      const m = coinTemplate
        ? coinTemplate.clone(true)
        : new THREE.Mesh(coinGeo, coinMat);
      m.position.set(c.x, c.y, c.z);
      m.traverse(o => {
        if (o.isMesh) o.castShadow = true;
      });
      course.add(m);
      return m;
    });

// Blue waypoint marker above the first gap (the clip shows a blue triangle marker above the path).
let waypoint;
if (pieces.waypoint) {
  waypoint = normalise(pieces.waypoint, {
    dimension: 'height',
    size: 1.2,
    anchor: 'center',
  });
} else {
  waypoint = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 0.9, 3),
    new THREE.MeshStandardMaterial({
      color: 0x35a7ff,
      emissive: 0x1166aa,
      emissiveIntensity: 0.8,
    })
  );
  waypoint.rotation.x = Math.PI; // point down
}
if (pieces.waypoint) {
  waypoint.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.metalness = 0.1;
      m.roughness = 0.4;
      m.emissive = new THREE.Color(0x2c8cff);
      m.emissiveIntensity = 0.7;
    }
  });
}
const halo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: cloudTex,
    color: 0x6cc4ff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
halo.scale.set(2.1, 2.1, 1);
waypoint.add(halo);
const MARKER = COURSE.marker || { x: 0, y: 6.4, z: 24 };
waypoint.position.set(MARKER.x, MARKER.y, MARKER.z); // high enough not to hide the landing from the chase camera
course.add(waypoint);
if (LEVEL !== 's1') waypoint.visible = false;

// ---------- S2 geometry (placeholders until generated pieces replace them) ----------
const s2 = { movers: [], flyers: [] };
// Spring pad: grey base, dark coil, red-orange top that squashes when it fires (the generated pad when present).
function makeSpringPad(sp) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 1.05, 0.16, 20),
    mat(0x7b6c5d)
  );
  base.position.y = 0.08;
  const coil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.3, 12),
    mat(0x3b3b46)
  );
  coil.position.y = 0.3;
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.8, 0.12, 20),
    mat(0xff5a3c, { emissive: 0xaa2a10, emissiveIntensity: 0.6 })
  );
  top.position.y = 0.5;
  group.add(base, coil, top);
  if (pieces.spring) {
    [base, coil, top].forEach(m => (m.visible = false));
    const pad = normalise(pieces.spring.clone(true), {
      dimension: 'width',
      size: 2.0,
      anchor: 'bottom',
    });
    // The model is as tall as it is wide; squash it to the cushion height Kai steps up onto.
    pad.scale.y = (sp.h || 0.62) / pad.userData.size.y;
    group.add(pad);
  }
  group.position.set(sp.x, (sp.y || 0) + 0.02, sp.z);
  course.add(group);
  springPads.push({ group, t: 0, x: sp.x, z: sp.z });
  return group;
}
const boardClip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 100); // constant 100 keeps everything
renderer.localClippingEnabled = true;
const FLYER_YAW = 0; // turns the generated flyer so its nose leads the patrol direction
function woodMat(w, d) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b97b3d';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = `rgba(${95 + i * 9},${58 + i * 5},26,0.35)`;
    g.fillRect(0, i * 32, 128, 30);
    g.fillStyle = 'rgba(58,30,10,0.75)';
    g.fillRect(0, i * 32, 128, 3);
  }
  for (let i = 0; i < 44; i++) {
    g.fillStyle = 'rgba(70,40,15,0.2)';
    g.fillRect(rand() * 128, rand() * 128, 16 + rand() * 30, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, Math.max(1, d / 1.4)); // boards laid across the walkway, about 0.35 m wide
  return mat(0xffffff, { map: t });
}
// ---------- S2 plateau dressing: a domed, ragged-edged top that never rises above the physics surface (y = 0),
// plus tall grass tufts. Private generators (mulberry32 with their own seeds) keep the shared island layout unchanged. ----------
function plateauHeight(x, z, p) {
  const w = p.x1 - p.x0;
  const d = p.z1 - p.z0;
  const u = Math.abs(x - (p.x0 + p.x1) / 2) / (w / 2);
  const v = Math.abs(z - (p.z0 + p.z1) / 2) / (d / 2);
  const sm = (a, b, t) => {
    const k = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  const n =
    Math.sin(x * 1.7) * Math.cos(z * 1.3) * 0.5 +
    Math.sin(x * 3.1 + z * 2.3) * 0.25;
  const edge = Math.max(sm(0.62, 1.0, u), sm(0.95, 1.0, v)); // 0 on the flat centre and the spring pad
  return p.y - edge * (0.55 + 0.45 * Math.min(1, Math.abs(n) * 1.4));
}
function tuftTexture() {
  // Blades from the lawn's own green at the root to a pale tip, so a tuft reads as taller grass, not a dark spike on it.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rnd = mulberry32(7);
  for (let i = 0; i < 30; i++) {
    const bx = 14 + rnd() * 100;
    const lean = (rnd() - 0.5) * 46;
    const top = 6 + rnd() * 70;
    const wdt = 2.2 + rnd() * 2.6;
    const grad = g.createLinearGradient(0, 127, 0, top);
    grad.addColorStop(0, '#4fae27');
    grad.addColorStop(0.5, '#7bcf3e');
    grad.addColorStop(1, '#dcf58a');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(bx - wdt, 127);
    g.quadraticCurveTo(
      bx + lean * 0.25 - wdt * 0.5,
      (127 + top) / 2,
      bx + lean,
      top
    );
    g.quadraticCurveTo(bx + lean * 0.25 + wdt, (127 + top) / 2, bx + wdt, 127);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function plateauDress(p, w, d, cx, cz, top, body) {
  top.visible = false; // the flat slab is replaced by the domed top below
  body.position.y = p.y - 2.8; // sit below the lowest dip of the dome (about -1.0)
  const geo = new THREE.PlaneGeometry(w, d, 40, 100);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    const u = Math.abs(x - cx) / (w / 2);
    if (u > 0.97)
      x -= Math.sign(x - cx) * (0.15 + 0.35 * Math.abs(Math.sin(z * 2.1))); // ragged side edges
    pos.setXYZ(i, x - cx, plateauHeight(x, z, p) - p.y, z - cz);
  }
  geo.computeVertexNormals();
  const dome = new THREE.Mesh(
    geo,
    tiledMat('/assets/textures/grass.png', 0x6bbf4a, w / TILE_M, d / TILE_M)
  );
  dome.position.set(cx, p.y, cz);
  dome.receiveShadow = true;
  course.add(dome);
  if (pieces.cliffwall) {
    body.visible = false; // the generated cliff wall replaces the rock box
    const H = 4.2;
    const tpl = normalise(pieces.cliffwall.clone(true), {
      dimension: 'height',
      size: H,
      anchor: 'bottom',
    });
    tpl.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.emissive = new THREE.Color(0x544c80); // lift the shaded faces so the rock still reads
      o.material.emissiveIntensity = 0.45;
    });
    const len = tpl.userData.size.z; // the slab's long side runs along z
    const topY = p.y - 0.9;
    const place = (x, z, ry, length) => {
      const c = tpl.clone(true);
      c.scale.set(1, 1, length / len);
      c.rotation.y = ry;
      c.position.set(x, topY - H, z);
      course.add(c);
    };
    const segsZ = Math.max(1, Math.round(d / len));
    const lenZ = d / segsZ;
    const segsX = Math.max(1, Math.round(w / len));
    const lenX = w / segsX;
    for (let i = 0; i < segsZ; i++) {
      const z = p.z0 + lenZ * (i + 0.5);
      place(p.x0 + 0.3, z, Math.PI, lenZ); // the model's front faces +x at rotation 0, so the x0 side needs a half turn
      place(p.x1 - 0.3, z, 0, lenZ);
    }
    for (let i = 0; i < segsX; i++) {
      const x = p.x0 + lenX * (i + 0.5);
      place(x, p.z0 + 0.3, -Math.PI / 2, lenX);
      place(x, p.z1 - 0.3, Math.PI / 2, lenX);
    }
  }
  if (pieces.bush) {
    // round teal trees near the edges, as in the footage
    // (positions are fractions of the platform's depth, so they stay on a smaller platform such as S3's bank)
    for (const [dx, fz, bh] of [
      [3.8, 0.59, 2.6],
      [-4.2, 0.76, 2.2],
      [4.4, 0.29, 1.9],
      [-3.9, 0.35, 1.7],
      [3.2, 0.82, 2.0],
    ]) {
      const bx = cx + dx;
      const bz = p.z0 + fz * d;
      const b = normalise(pieces.bush.clone(true), {
        dimension: 'height',
        size: bh,
        anchor: 'bottom',
      });
      b.position.set(bx, plateauHeight(bx, bz, p) - 0.05, bz);
      b.rotation.y = bz;
      b.traverse(o => {
        if (o.isMesh) o.castShadow = true;
      });
      course.add(b);
    }
  }
  // Tall grass tufts: three crossed quads per tuft, instanced; more of them near the edges.
  const rnd = mulberry32(2026);
  const tex = tuftTexture();
  const matTuft = new THREE.MeshLambertMaterial({
    map: tex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const N = 520;
  const spots = [];
  for (let i = 0; i < N; i++) {
    const edgeBias = i % 2 === 0; // half of them hug the edges, the rest are open-field clumps
    let x = p.x0 + 0.4 + rnd() * (w - 0.8);
    if (edgeBias)
      x = rnd() > 0.5 ? p.x0 + 0.4 + rnd() * 2.2 : p.x1 - 0.4 - rnd() * 2.2;
    const z = p.z0 + 0.5 + rnd() * (d - 1.0);
    if (
      COURSE.springs &&
      Math.abs(x - COURSE.springs[0].x) < 1.4 &&
      Math.abs(z - COURSE.springs[0].z) < 1.4
    )
      continue; // keep the pad clear
    spots.push({
      x,
      z,
      s: 0.7 + rnd() * 0.7,
      h: 0.35 + rnd() * 0.5,
      r: rnd() * Math.PI,
    });
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  for (let k = 0; k < 3; k++) {
    const mesh = new THREE.InstancedMesh(quad, matTuft, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r + (k * Math.PI) / 3);
      m.compose(
        new THREE.Vector3(t.x, plateauHeight(t.x, t.z, p) - 0.02, t.z),
        q,
        new THREE.Vector3(t.s, t.h, t.s)
      );
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    course.add(mesh);
  }
}
// Height of the walkable surface of a generated deck piece (a ray cast down its centre line), so Kai's feet meet the planks.
function deckTopOf(obj) {
  obj.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 30, 0),
    new THREE.Vector3(0, -1, 0)
  );
  const hit = ray.intersectObject(obj, true)[0];
  return hit ? hit.point.y : 0;
}
// Generated boardwalk segments (tiled along z), raft and dock, or null when the pieces are missing.
function generatedDeck(p, w, d) {
  if ((p.id === 'boardwalk' || p.kind === 'bridge') && pieces.boardwalk) {
    const segs = Math.max(1, Math.round(d / 6));
    const segLen = d / segs;
    const tpl = normalise(pieces.boardwalk.clone(true), {
      dimension: 'longest',
      size: 6,
      alongZ: true,
      anchor: 'bottom',
    });
    const top = deckTopOf(tpl);
    tpl.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.clippingPlanes = [boardClip];
    });
    const g = new THREE.Group();
    for (let i = 0; i < segs; i++) {
      const c = tpl.clone(true);
      c.scale.set(w / tpl.userData.size.x, 1, segLen / tpl.userData.size.z);
      c.position.set(0, p.y - top, -d / 2 + segLen * (i + 0.5));
      g.add(c);
    }
    return g;
  }
  if ((p.id === 'raft' || p.id === 'dock') && pieces.raft) {
    const c = normalise(pieces.raft.clone(true), {
      dimension: 'longest',
      size: d,
      alongZ: true,
      anchor: 'bottom',
    });
    const top = deckTopOf(c);
    c.scale.set(w / c.userData.size.x, 1, 1);
    c.position.y = p.y - top;
    return c;
  }
  return null;
}
if (LEVEL === 's2') {
  const DARK_WOOD = mat(0x6a4122);
  const postGeo = new THREE.BoxGeometry(0.16, 0.9, 0.16);
  for (const p of COURSE.platforms) {
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2;
    const cz = (p.z0 + p.z1) / 2;
    if (p.id === 'plateau') {
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), [
        cliffMat(0.3, d),
        cliffMat(0.3, d),
        tiledMat(
          '/assets/textures/grass.png',
          0x6bbf4a,
          w / TILE_M,
          d / TILE_M
        ),
        GRASS,
        cliffMat(0.3, w),
        cliffMat(0.3, w),
      ]);
      top.position.set(cx, p.y - 0.15, cz);
      top.receiveShadow = true;
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.96, 3.6, d * 0.96),
        [
          cliffMat(3.6, d),
          cliffMat(3.6, d),
          ROCK,
          ROCK,
          cliffMat(3.6, w),
          cliffMat(3.6, w),
        ]
      );
      body.position.set(cx, p.y - 2.1, cz);
      body.castShadow = true;
      course.add(top, body);
      plateauDress(p, w, d, cx, cz, top, body);
      continue;
    }
    const group = new THREE.Group();
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.25, d),
      woodMat(w, d)
    );
    deck.position.y = p.y - 0.125;
    deck.receiveShadow = true;
    deck.castShadow = true;
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.88, 0.5, d),
      DARK_WOOD
    );
    beam.position.y = p.y - 0.5;
    group.add(deck, beam);
    if (p.id !== 'raft') {
      // low rails along both sides (the clip's boardwalk has them)
      for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, d),
          DARK_WOOD
        );
        rail.position.set(sx * (w / 2 - 0.08), p.y + 0.75, 0);
        group.add(rail);
        for (let z = -d / 2 + 0.2; z <= d / 2; z += 3) {
          const post = new THREE.Mesh(postGeo, DARK_WOOD);
          post.position.set(sx * (w / 2 - 0.08), p.y + 0.45, z);
          group.add(post);
        }
      }
    }
    const gen = generatedDeck(p, w, d);
    if (gen) {
      group.children.forEach(c => (c.visible = false)); // the generated deck replaces the placeholder box and rails
      group.add(gen);
    }
    group.position.set(cx, 0, cz);
    course.add(group);
    if (p.move) s2.movers.push({ group, p });
  }
  // River under the boardwalk end, the raft and the dock, with soft edges so it reads as a stream, not a rectangle.
  {
    const fc = document.createElement('canvas');
    fc.width = fc.height = 128;
    const fg = fc.getContext('2d');
    const fr = fg.createRadialGradient(64, 64, 8, 64, 64, 64);
    fr.addColorStop(0, '#fff');
    fr.addColorStop(0.6, '#fff');
    fr.addColorStop(1, '#000');
    fg.fillStyle = fr;
    fg.fillRect(0, 0, 128, 128);
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 110),
      new THREE.MeshBasicMaterial({
        color: 0x4fa9dc,
        transparent: true,
        opacity: 0.95,
        alphaMap: new THREE.CanvasTexture(fc),
        depthWrite: false,
      })
    );
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, -3.2, 82);
    scene.add(river);
    // A waterfall falling off the plateau's right-hand edge (screen right is world -X).
    const fall = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 24, 3.4),
      new THREE.MeshBasicMaterial({
        color: 0xd6efff,
        transparent: true,
        opacity: 0.8,
      })
    );
    fall.position.set(-6.2, -12, 20);
    scene.add(fall);
    if (pieces.waterfall) {
      fall.visible = false;
      // Generated waterfall cliffs: one beside the plateau, one on the far side for the side view.
      for (const [x, y, z, ry] of [
        [-15, -37, 22, 0],
        [27, -31, 62, Math.PI],
      ]) {
        const c = normalise(pieces.waterfall.clone(true), {
          dimension: 'height',
          size: 36,
          anchor: 'bottom',
        });
        c.position.set(x, y, z);
        c.rotation.y = ry;
        scene.add(c);
      }
    }
  }
  makeSpringPad(COURSE.springs[0]);
  // The blue flyer: glossy body, two flapping wings and a tail.
  for (const e of COURSE.enemies) makeFlyer(e);
}
function makeFlyer(e, i) {
  {
    const g = new THREE.Group();
    const bodyMat = mat(0x58c0ff, {
      emissive: 0x1d6fb3,
      emissiveIntensity: 0.7,
    });
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 16, 12),
      bodyMat
    );
    body.scale.set(1, 0.8, 1.3);
    const wingMat = new THREE.MeshBasicMaterial({
      color: 0xbfe6ff,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), wingMat);
    const wr = wl.clone();
    wl.position.set(0.55, 0.15, 0);
    wr.position.set(-0.55, 0.15, 0);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 8), bodyMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.z = -0.7;
    g.add(body, wl, wr, tail);
    if (pieces.flyer) {
      [body, wl, wr, tail].forEach(m => (m.visible = false));
      const holder = new THREE.Group();
      holder.add(
        normalise(pieces.flyer.clone(true), {
          dimension: 'longest',
          size: 1.7,
          anchor: 'center',
        })
      );
      holder.rotation.y = FLYER_YAW;
      g.add(holder);
    }
    scene.add(g);
    s2.flyers.push({ g, e, wl, wr, i });
  }
}
if (LEVEL === 's2') {
  // The golden post at the end of the dock.
  {
    const gold = mat(0xffc83d, {
      emissive: 0xaa7a00,
      emissiveIntensity: 0.6,
      metalness: 0.2,
      roughness: 0.4,
    });
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 2.2, 10),
      gold
    );
    pole.position.set(0, 1.1, 98.8);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), gold);
    knob.position.set(0, 2.3, 98.8);
    course.add(pole, knob);
    if (pieces.post) {
      pole.visible = knob.visible = false;
      const post = normalise(pieces.post.clone(true), {
        dimension: 'height',
        size: 2.6,
        anchor: 'bottom',
      });
      post.position.set(0, 0, 98.6);
      course.add(post);
    }
  }
}

// Floating islands around the path: generated pieces (two variants, 8 m across before scaling) if present.
const islandTemplates = ['island_a', 'island_b', 'island_c', 'island_d']
  .filter(n => pieces[n])
  .map(n =>
    normalise(pieces[n], { dimension: 'width', size: 8, anchor: 'center' })
  );
const cloudLit = (() => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 22 + rand() * 14;
    const r = 26 + rand() * 26;
    const y = 76 - Math.sin((i / 8) * Math.PI) * 18 + rand() * 8;
    const gr = g.createRadialGradient(x, y, 2, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = 'source-atop';
  const tone = g.createLinearGradient(0, 30, 0, 110);
  tone.addColorStop(0, 'rgba(255,244,236,1)'); // sun-lit top
  tone.addColorStop(0.55, 'rgba(238,232,255,1)');
  tone.addColorStop(1, 'rgba(168,158,222,1)'); // lavender underside
  g.fillStyle = tone;
  g.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
let islandCount = 0;
function cloudBank(x, y, z, w, op, col) {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: cloudLit,
      transparent: true,
      opacity: op,
      depthWrite: false,
      color: col,
    })
  );
  sp.scale.set(w, w * 0.5, 1);
  sp.position.set(x, y, z);
  scene.add(sp);
}
function island(x, y, z, s, fine = false) {
  // Scenery islands are not solid, so none may sit near anything the player can stand on: a rock that looks walkable and is not
  // is a bug to the player ("I just jump right through them"). Only distant scenery is kept.
  for (const p of COURSE.platforms) {
    const dx = Math.max(0, p.x0 - x, x - p.x1);
    const dz = Math.max(0, p.z0 - z, z - p.z1);
    if (Math.hypot(dx, dz) < 30 + s * 5 && Math.abs(y - p.y) < 50) return;
  }
  // Banks sit under distant islands only; near the camera they would wash out the whole frame.
  if (++islandCount % 3 === 0 && z > 45)
    cloudBank(x, y - 6, z, 40 + rand() * 40, 0.42, 0xffffff);
  if (islandTemplates.length) {
    const pool =
      fine && islandTemplates.length > 2
        ? islandTemplates.slice(2)
        : islandTemplates;
    const g = pool[Math.floor(rand() * pool.length)].clone(true);
    g.scale.setScalar(s);
    g.rotation.y = rand() * Math.PI * 2;
    g.position.set(x, y, z);
    const f = Math.max(0, Math.min(1, (Math.abs(x) - 20) / 110 + z / 420));
    if (f > 0.12) {
      // Paler, cooler, lower-contrast with distance: blend towards the haze colour.
      const haze = new THREE.Color(0xb8c6ee);
      g.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.color.lerp(haze, f * 0.45);
        o.material.emissive = haze.clone();
        o.material.emissiveIntensity = 0.4 * f;
      });
    }
    scene.add(g);
    return;
  }
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(4 * s, 4.2 * s, 0.7 * s, 10),
    GRASS
  );
  const rock = new THREE.Mesh(new THREE.ConeGeometry(4.2 * s, 7 * s, 10), ROCK);
  rock.rotation.x = Math.PI;
  rock.position.y = -3.9 * s;
  g.add(top, rock);
  if (rand() > 0.35) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25 * s, 0.3 * s, 1.6 * s, 6),
      WOOD
    );
    trunk.position.set((rand() - 0.5) * 2 * s, 1.1 * s, (rand() - 0.5) * 2 * s);
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.2 * s, 0),
      mat(rand() > 0.5 ? 0xf4a1c0 : 0x4fa83d)
    );
    crown.position.copy(trunk.position);
    crown.position.y += 1.5 * s;
    g.add(trunk, crown);
  }
  g.position.set(x, y, z);
  g.traverse(o => {
    if (o.isMesh) o.castShadow = false;
  });
  scene.add(g);
}
// Islands below the route (the video looks down onto them), two of them near and large.
const ZS = WORLD ? 2.7 : 1; // the whole journey is about 2.7 times as long as act 1: the scenery spreads along it
island(-14, -19, 10, 1.7, true);
island(17, -24, 24, 1.3, true);
for (let i = 0; i < (WORLD ? 16 : 10); i++) {
  const side = rand() > 0.5 ? 1 : -1;
  island(
    side * (12 + rand() * 34),
    -18 + rand() * 9,
    rand() * 170 * ZS,
    0.9 + rand() * 1.1
  );
}
for (let i = 0; i < (WORLD ? 70 : 44); i++) {
  const side = rand() > 0.5 ? 1 : -1;
  const far = rand() > 0.5; // a near band for parallax and a far band for depth
  island(
    side * (far ? 55 + rand() * 70 : 17 + rand() * 24),
    far ? -4 + rand() * 22 : -3 + rand() * 12,
    -10 + rand() * (far ? 250 : 150) * ZS,
    far ? 1.8 + rand() * 2.0 : 0.8 + rand() * 0.9
  );
}

for (let i = 0; i < 10; i++) {
  // pink-white clouds overhead, high and far like the sky clouds in the clip
  // kept off to the sides so they frame the skyline instead of burying it
  cloudBank(
    (rand() > 0.5 ? 1 : -1) * (110 + rand() * 170),
    50 + rand() * 40,
    (260 + rand() * 200) * (WORLD ? 1.8 : 1),
    90 + rand() * 70,
    0.5,
    0xffe9f2
  );
}
// Clouds: soft sprite banks at several depths below and beside the path (cheap volumetric look); the castle follows.
for (let i = 0; i < 14; i++) {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.35 + rand() * 0.35,
      depthWrite: false,
      color: rand() > 0.7 ? 0xf6e9ff : 0xffffff,
    })
  );
  const w = 40 + rand() * 90;
  sp.scale.set(w, w * (0.35 + rand() * 0.25), 1);
  const high = i >= 10; // the last few sit high and far, like the sky clouds in the clip
  sp.position.set(
    (rand() - 0.5) * (high ? 400 : 320),
    high ? 20 + rand() * 40 : -36 + rand() * 30,
    (high ? 260 + rand() * 120 : -30 + rand() * 300) * (WORLD ? 1.7 : 1)
  );
  scene.add(sp);
}
{
  const SZ = 256;
  const c = document.createElement('canvas');
  c.width = c.height = SZ;
  const g = c.getContext('2d');
  const img = g.createImageData(SZ, SZ);
  const grid = [];
  for (let o = 0; o < 5; o++) {
    const m = 3 << o;
    const arr = [];
    for (let i = 0; i < m * m; i++) arr.push(rand());
    grid.push({ m, arr });
  }
  const at = (L, x, y) =>
    L.arr[(((y % L.m) + L.m) % L.m) * L.m + (((x % L.m) + L.m) % L.m)];
  for (let y = 0; y < SZ; y++) {
    for (let x = 0; x < SZ; x++) {
      let v = 0;
      let amp = 0.5;
      for (const L of grid) {
        const fx = (x / SZ) * L.m;
        const fy = (y / SZ) * L.m;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = at(L, x0, y0) * (1 - sx) + at(L, x0 + 1, y0) * sx;
        const b = at(L, x0, y0 + 1) * (1 - sx) + at(L, x0 + 1, y0 + 1) * sx;
        v += (a * (1 - sy) + b * sy) * amp;
        amp *= 0.5;
      }
      const a = Math.max(0, Math.min(1, (v - 0.46) * 3.4));
      const i = (y * SZ + x) * 4;
      img.data[i] = 250;
      img.data[i + 1] = 247;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  // Radial alpha so the planes dissolve towards their edges and the tiling never shows.
  const fc = document.createElement('canvas');
  fc.width = fc.height = 128;
  const fg = fc.getContext('2d');
  const fr = fg.createRadialGradient(64, 64, 6, 64, 64, 64);
  fr.addColorStop(0, '#fff');
  fr.addColorStop(0.55, '#aaa');
  fr.addColorStop(1, '#000');
  fg.fillStyle = fr;
  fg.fillRect(0, 0, 128, 128);
  const edgeFade = new THREE.CanvasTexture(fc);
  const seaTex = new THREE.CanvasTexture(c);
  seaTex.wrapS = seaTex.wrapT = THREE.RepeatWrapping;
  seaTex.colorSpace = THREE.SRGBColorSpace;
  [
    [-44, 0.95, 2.2, 0xe6ebff],
    [-33, 0.8, 3, 0xf3f4ff],
    [-23, 0.6, 3.6, 0xffffff],
    [-14, 0.4, 4.4, 0xf6efff],
  ].forEach(([y, op, rep2, col], k) => {
    const t = seaTex.clone();
    t.needsUpdate = true;
    const SEA = WORLD ? 1500 : 900;
    t.repeat.set((rep2 * SEA) / 900, (rep2 * SEA) / 900);
    t.offset.set(k * 0.37, k * 0.61);
    seaLayers.push({
      tex: t,
      ox: k * 0.37,
      oy: k * 0.61,
      v: 0.0012 + k * 0.0009,
    }); // each layer drifts at its own speed
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(SEA, SEA),
      new THREE.MeshBasicMaterial({
        map: t,
        color: col,
        transparent: true,
        opacity: op,
        depthWrite: false,
        alphaMap: edgeFade,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, y, WORLD ? 215 : 120);
    scene.add(m);
  });
}
let castle;
if (pieces.castle) {
  // Generated citadel, about 110 m tall at 330 m: the same apparent size as the old silhouette.
  castle = normalise(pieces.castle, {
    dimension: 'height',
    size: 110,
    anchor: 'bottom',
  });
} else {
  castle = new THREE.Group();
  const castleMat = mat(0xd9d4e6, { roughness: 0.9 });
  for (const [x, h, w] of [
    [-18, 34, 8],
    [-6, 52, 9],
    [8, 62, 10],
    [22, 40, 8],
    [0, 28, 40],
  ]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), castleMat);
    t.position.set(x, h / 2, 0);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.7, h * 0.35, 8),
      mat(0x6f86d6)
    );
    roof.position.set(x, h + h * 0.17, 0);
    castle.add(t, roof);
  }
}
castle.position.set(0, 4, 330);
scene.add(castle);

let skyRig = null;
// Painted skyline: a distant floating-kingdom panorama (generated) on a big plane behind the castle, edges faded to sky.
try {
  const img = await new THREE.ImageLoader().loadAsync(
    '/assets/scenery/skyline.png'
  );
  const W = 2048;
  const H = Math.round((W * img.height) / img.width);
  const sc = document.createElement('canvas');
  sc.width = W;
  sc.height = H;
  const sg = sc.getContext('2d');
  sg.drawImage(img, 0, 0, W, H);
  const mask = sg.createLinearGradient(0, 0, 0, H);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(0.28, 'rgba(0,0,0,1)');
  mask.addColorStop(0.8, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  sg.globalCompositeOperation = 'destination-in';
  sg.fillStyle = mask;
  sg.fillRect(0, 0, W, H);
  const side = sg.createLinearGradient(0, 0, W, 0); // fade the left and right edges into the sky too
  side.addColorStop(0, 'rgba(0,0,0,0)');
  side.addColorStop(0.14, 'rgba(0,0,0,1)');
  side.addColorStop(0.86, 'rgba(0,0,0,1)');
  side.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = side;
  sg.fillRect(0, 0, W, H);
  const skyTex = new THREE.CanvasTexture(sc);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky_ = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, (1000 * H) / W),
    new THREE.MeshBasicMaterial({
      map: skyTex,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: WORLD ? 0.4 : 0.62,
      color: 0xdbe4ff,
    })
  );
  sky.mat = sky_.material;
  // A ring of four skyline planes (alternate ones mirrored so the same panorama does not repeat obviously) that follows Kai,
  // so there are distant islands whichever way the camera looks. The citadel stays a fixed landmark and still grows as he nears it.
  skyRig = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const plane = sky_.clone();
    plane.rotation.y = a + Math.PI; // the front faces the middle of the ring
    plane.position.set(Math.sin(a) * 640, 55, Math.cos(a) * 640);
    plane.renderOrder = -10;
    if (i % 2 === 1) plane.scale.x = -1;
    skyRig.add(plane);
  }
  scene.add(skyRig);
  game.scenery.skyline = true;
} catch {
  game.warnings.push('skyline backdrop not loaded; plain sky');
}

// ---------- S3 geometry: the dock, a lower grassy far bank, the river, two golden posts, the anchor and the rope ----------
const s3 = { rope: null, anchor: null };
if (LEVEL === 's3') {
  const DARK = mat(0x6a4122);
  for (const p of COURSE.platforms) {
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2;
    const cz = (p.z0 + p.z1) / 2;
    if (p.id === 'bank') {
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), GRASS);
      top.position.set(cx, p.y - 0.15, cz);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.96, 3.6, d * 0.96),
        ROCK
      );
      body.position.set(cx, p.y - 2.1, cz);
      course.add(top, body);
      plateauDress(p, w, d, cx, cz, top, body);
      continue;
    }
    const group = new THREE.Group();
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.25, d),
      woodMat(w, d)
    );
    deck.position.y = p.y - 0.125;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 0.88, 0.5, d), DARK);
    beam.position.y = p.y - 0.5;
    group.add(deck, beam);
    const gen = generatedDeck(p, w, d);
    if (gen) {
      group.children.forEach(c => (c.visible = false));
      group.add(gen);
    }
    group.position.set(cx, 0, cz);
    course.add(group);
  }
  {
    // River with soft edges, as in S2
    const fc = document.createElement('canvas');
    fc.width = fc.height = 128;
    const fg = fc.getContext('2d');
    const fr = fg.createRadialGradient(64, 64, 8, 64, 64, 64);
    fr.addColorStop(0, '#fff');
    fr.addColorStop(0.6, '#fff');
    fr.addColorStop(1, '#000');
    fg.fillStyle = fr;
    fg.fillRect(0, 0, 128, 128);
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 90),
      new THREE.MeshBasicMaterial({
        color: 0x4fa9dc,
        transparent: true,
        opacity: 0.95,
        alphaMap: new THREE.CanvasTexture(fc),
        depthWrite: false,
      })
    );
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, -3.2, 10);
    scene.add(river);
  }
  // Two golden posts: one at the dock's end, one on the far bank (the footage's grapple posts).
  const gold = mat(0xffc83d, {
    emissive: 0xaa7a00,
    emissiveIntensity: 0.6,
    metalness: 0.2,
    roughness: 0.4,
  });
  for (const [pz, py] of [
    [-0.9, 0],
    [22.5, -2],
  ]) {
    if (pieces.post) {
      const post = normalise(pieces.post.clone(true), {
        dimension: 'height',
        size: 2.6,
        anchor: 'bottom',
      });
      post.position.set(1.4, py, pz);
      course.add(post);
    } else {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 2.2, 10),
        gold
      );
      pole.position.set(1.4, py + 1.1, pz);
      course.add(pole);
    }
  }
  // The grapple anchor: a golden orb with a halo, hanging over the middle of the river.
  const a = COURSE.anchors[0];
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd45a })
  );
  const aHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: cloudTex,
      color: 0xffc83d,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  aHalo.scale.set(3.4, 3.4, 1);
  orb.add(aHalo);
  orb.position.set(a.x, a.y, a.z);
  scene.add(orb);
  s3.anchor = orb;
  // The rope: a thin golden cylinder stretched between Kai's hand and the anchor while grappled.
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd45a })
  );
  rope.visible = false;
  scene.add(rope);
  s3.rope = rope;
}

// Enemy meshes: `orb` is a glossy blue ball with white eyes and a green leaf; `sprout` is a small green creature with leaf antennae.
function makeEnemy(e) {
  const g = new THREE.Group();
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  if (e.kind === 'bramble') {
    // The reference sheet's Bramble Orb: a dark spiked ball with red thorns, moss and glowing eyes. It guards a nest of eggs.
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(e.r * 0.92, 14, 10),
      mat(0x3b2f45, { roughness: 0.9 })
    );
    g.add(body);
    const thorn = mat(0xd8405a, { emissive: 0x7a1020, emissiveIntensity: 0.5 });
    const rr = mulberry32(Math.round(e.z * 7));
    for (let k = 0; k < 16; k++) {
      const u = rr() * 2 - 1;
      const th = rr() * Math.PI * 2;
      const dir = new THREE.Vector3(
        Math.sqrt(1 - u * u) * Math.cos(th),
        Math.abs(u) * 0.9 + 0.05,
        Math.sqrt(1 - u * u) * Math.sin(th)
      ).normalize();
      if (dir.z > 0.55 && dir.y < 0.5) continue; // keep the face clear
      const sp = new THREE.Mesh(
        new THREE.ConeGeometry(0.09 * e.r * 2, 0.36 * e.r * 2, 5),
        thorn
      );
      sp.position.copy(dir).multiplyScalar(e.r * 0.95);
      sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(sp);
    }
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe36a });
    for (const ex of [-0.32 * e.r, 0.32 * e.r]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.17 * e.r, 8, 6),
        eyeMat
      );
      eye.position.set(ex, 0.12 * e.r, e.r * 0.82);
      g.add(eye);
    }
    const moss = new THREE.Mesh(
      new THREE.SphereGeometry(e.r * 0.5, 8, 6),
      mat(0x5c9a3a)
    );
    moss.scale.set(1.2, 0.35, 1.2);
    moss.position.y = e.r * 0.8;
    g.add(moss);
    {
      const one = bake(g);
      g.clear();
      g.add(one);
    }
    // The nest it guards, at the middle of its beat.
    const nest = new THREE.Group();
    const twig = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.16, 6, 14),
      mat(0x7a5a36)
    );
    twig.rotation.x = Math.PI / 2;
    twig.position.y = 0.14;
    nest.add(twig);
    for (const [ox, oz] of [
      [-0.16, 0.05],
      [0.17, 0.1],
      [0, -0.17],
    ]) {
      const egg = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 8, 6),
        mat(0xe8d8f0, { emissive: 0x6a5a80, emissiveIntensity: 0.3 })
      );
      egg.scale.y = 1.25;
      egg.position.set(ox, 0.2, oz);
      nest.add(egg);
    }
    const nestOne = bake(nest);
    nestOne.position.set(
      e.x + (e.ax ? 0 : 1.6),
      e.y - e.r * 1.2,
      e.z + (e.az ? 0 : 1.3)
    );
    course.add(nestOne);
    return g;
  }
  if (e.kind === 'sprout') {
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(e.r * 1.1, 14, 10),
      mat(0x5fd36f, { emissive: 0x1f7a33, emissiveIntensity: 0.6 })
    );
    body.scale.set(1, 0.85, 1);
    for (const ex of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), white);
      eye.position.set(ex, 0.05, e.r * 0.95);
      g.add(eye);
      const ant = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.32, 5),
        mat(0x3fbf5a)
      );
      ant.position.set(ex * 1.6, e.r * 1.25, 0);
      ant.rotation.z = -ex * 3;
      g.add(ant);
    }
    g.add(body);
    return g;
  }
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(e.r * 0.95, 18, 14),
    e.kind === 'guardian'
      ? mat(0xa56bff, { emissive: 0x4a2a99, emissiveIntensity: 0.7 })
      : mat(0x58c0ff, { emissive: 0x1d6fb3, emissiveIntensity: 0.7 })
  );
  for (const ex of [-0.34 * e.r, 0.34 * e.r]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 * e.r, 10, 8),
      white
    );
    eye.position.set(ex, 0.16 * e.r, e.r * 0.82);
    g.add(eye);
  }
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.5, 6),
    mat(0x4fd16a)
  );
  leaf.position.set(0.1, e.r * 1.05, 0);
  leaf.rotation.z = -0.5;
  g.add(ball, leaf);
  if (e.kind === 'guardian') {
    // A gold crown of three spikes.
    for (const kx of [-0.5, 0, 0.5]) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.12 * e.r, 0.5 * e.r, 5),
        mat(0xffc83d, { emissive: 0xaa7a00, emissiveIntensity: 0.6 })
      );
      spike.position.set(kx * e.r, e.r * 1.0, 0);
      g.add(spike);
    }
  }
  return g;
}

// ---------- S4 geometry: islands on a chain, a rope bridge, the grind rail, the key and gate, and blue orbs ----------
const s4 = { orbs: [], key: null, gate: null };
if (LEVEL === 's4') {
  const DARK = mat(0x6a4122);
  const gold = mat(0xffc83d, {
    emissive: 0xaa7a00,
    emissiveIntensity: 0.6,
    metalness: 0.2,
    roughness: 0.4,
  });
  for (const p of COURSE.platforms) {
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2;
    const cz = (p.z0 + p.z1) / 2;
    if (p.id === 'bridge') {
      const group = new THREE.Group();
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.25, d),
        woodMat(w, d)
      );
      deck.position.y = p.y - 0.125;
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.88, 0.5, d),
        DARK
      );
      beam.position.y = p.y - 0.5;
      group.add(deck, beam);
      const gen = generatedDeck(p, w, d);
      if (gen) {
        group.children.forEach(c => (c.visible = false));
        group.add(gen);
      }
      // Rope handrails on both sides, with a post every 3 m.
      for (const sx of [p.x0 + 0.05, p.x1 - 0.05]) {
        const rope = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, d, 6),
          DARK
        );
        rope.rotation.x = Math.PI / 2;
        rope.position.set(sx - cx, p.y + 0.95, 0);
        group.add(rope);
        for (let k = 0; k <= d; k += 3) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.07, 1, 6),
            DARK
          );
          post.position.set(sx - cx, p.y + 0.5, p.z0 + k - cz);
          group.add(post);
        }
      }
      group.position.set(cx, 0, cz);
      course.add(group);
      continue;
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), GRASS);
    top.position.set(cx, p.y - 0.15, cz);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.96, 3.6, d * 0.96),
      ROCK
    );
    body.position.set(cx, p.y - 2.1, cz);
    // A tapering rock keel under each island so it reads as floating.
    const keel = new THREE.Mesh(
      new THREE.ConeGeometry(Math.min(w, d) * 0.5, 7, 7),
      ROCK
    );
    keel.rotation.x = Math.PI;
    keel.scale.set(1, 1, d / w);
    keel.position.set(cx, p.y - 7.4, cz);
    course.add(top, body, keel);
    plateauDress(p, w, d, cx, cz, top, body);
  }
  // The grind rail: a glowing bar with ties and two end pylons.
  {
    const r = COURSE.rails[0];
    const a = new THREE.Vector3(r.x, r.y0, r.z0);
    const b = new THREE.Vector3(r.x, r.y1, r.z1);
    const len = a.distanceTo(b);
    const railMat = mat(0x39e6d0, {
      emissive: 0x15a090,
      emissiveIntensity: 0.9,
      metalness: 0.3,
      roughness: 0.35,
    });
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, len, 8),
      railMat
    );
    bar.position.copy(a).add(b).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize()
    );
    course.add(bar);
    for (let k = 0; k <= len; k += 2) {
      const f = k / len;
      const tie = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.05, 0.12),
        railMat
      );
      tie.position.set(
        r.x,
        r.y0 + (r.y1 - r.y0) * f - 0.08,
        r.z0 + (r.z1 - r.z0) * f
      );
      course.add(tie);
    }
    for (const [pz, py] of [
      [r.z0, r.y0],
      [r.z1, r.y1],
    ]) {
      const pylon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.12, py + 3, 8),
        gold
      );
      pylon.position.set(r.x, (py - 3) / 2, pz);
      course.add(pylon);
    }
  }
  // The golden post at the goal.
  {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 2.2, 10),
      gold
    );
    pole.position.set(1.4, 1.1, COURSE.goal.z + 1);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), gold);
    knob.position.set(1.4, 2.3, COURSE.goal.z + 1);
    course.add(pole, knob);
  }
  // The key: a gold ring, shaft and two teeth with a halo, spinning and bobbing.
  {
    const k = COURSE.key;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.055, 8, 16),
      gold
    );
    ring.position.y = 0.3;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.55, 8),
      gold
    );
    shaft.position.y = -0.1;
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.05), gold);
    t1.position.set(0.1, -0.3, 0);
    const t2 = t1.clone();
    t2.position.set(0.08, -0.17, 0);
    g.add(ring, shaft, t1, t2);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: cloudTex,
        color: 0xffc83d,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.scale.set(2.4, 2.4, 1);
    g.add(halo);
    g.scale.setScalar(1.5);
    g.position.set(k.x, k.y + 0.3, k.z);
    scene.add(g);
    s4.key = g;
  }
  // The gate: two stone pillars and a violet energy barrier across island A, gone once Kai holds the key.
  {
    const gz = COURSE.gate.z;
    const g = new THREE.Group();
    const barrier = new THREE.Mesh(
      new THREE.PlaneGeometry(9.6, 3.2),
      new THREE.MeshBasicMaterial({
        color: 0xa56bff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    barrier.rotation.y = Math.PI / 2;
    barrier.position.set(0, 1.6, gz);
    g.add(barrier);
    for (const px of [-4.9, 4.9]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), ROCK);
      pillar.position.set(px, 1.7, gz);
      g.add(pillar);
    }
    scene.add(g);
    s4.gate = g;
  }
  // Blue orbs (procedural placeholder art, as in the footage).
  for (const e of COURSE.enemies) {
    const g = makeEnemy(e);
    scene.add(g);
    s4.orbs.push({ g, e });
  }
}

// A sliding slab dressed as a small floating island, built around its own centre inside `group`: a domed grass top with a
// ragged edge, the generated cliff wall as a rim, a rock keel underneath, a couple of teal bushes and tall grass tufts.
function slabDress(p, w, d, group) {
  const sm = (a, b, x) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  const geo = new THREE.PlaneGeometry(w, d, 14, 14);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const edge = Math.max(
      sm(0.7, 1, Math.abs(x) / (w / 2)),
      sm(0.7, 1, Math.abs(z) / (d / 2))
    );
    const n = 0.65 + 0.35 * Math.abs(Math.sin(x * 2.3 + z * 1.7));
    pos.setY(i, p.y - edge * 0.45 * n);
  }
  geo.computeVertexNormals();
  // Mottle the lawn: soft lighter and deeper patches a few metres across, so it is not one flat tiled green.
  {
    const col = new Float32Array(pos.count * 3);
    const ph = p.z0 * 0.37 + p.x0 * 0.21;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const n =
        0.5 +
        0.5 * Math.sin(x * 0.55 + ph) * Math.cos(z * 0.47 - ph) +
        0.18 * Math.sin(x * 1.3 - z * 1.1 + ph);
      col[i * 3] = 0.84 + 0.24 * n;
      col[i * 3 + 1] = 0.9 + 0.14 * n;
      col[i * 3 + 2] = 0.78 + 0.16 * n;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const domeMat = tiledMat(
    '/assets/textures/grass.png',
    0x6bbf4a,
    w / TILE_M,
    d / TILE_M
  );
  domeMat.vertexColors = true;
  const dome = new THREE.Mesh(geo, domeMat);
  dome.receiveShadow = true;
  group.add(dome);
  // Cliff wall rim (or the plain rock slab when the piece is missing), then a rock keel under it. The rim's segments are baked into
  // ONE mesh per island from a simplified copy of the generated wall (see rimSource): 16 segments of 3,518 triangles each were most of
  // the frame's triangles and draw calls.
  const H = 2.4;
  const detail = new THREE.Group(); // the detailed rim and the bushes: drawn only near Kai (see lodGroups)
  let far = null; // what stands in for the rim at a distance
  const rim = rimSource(H);
  if (rim) {
    const len = rim.len;
    const geos = rim.parts.map(() => []);
    const m4 = new THREE.Matrix4();
    const q4 = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (x, z, ry, length) => {
      q4.setFromAxisAngle(up, ry);
      m4.compose(
        new THREE.Vector3(x, p.y - 0.4 - H, z),
        q4,
        new THREE.Vector3(1, 1, length / len)
      );
      rim.parts.forEach((part, k) =>
        geos[k].push(part.geo.clone().applyMatrix4(m4))
      );
    };
    const segsZ = Math.max(1, Math.round(d / len));
    const segsX = Math.max(1, Math.round(w / len));
    for (let i = 0; i < segsZ; i++) {
      const z = -d / 2 + (d / segsZ) * (i + 0.5);
      place(-w / 2 + 0.3, z, Math.PI, d / segsZ);
      place(w / 2 - 0.3, z, 0, d / segsZ);
    }
    for (let i = 0; i < segsX; i++) {
      const x = -w / 2 + (w / segsX) * (i + 0.5);
      place(x, -d / 2 + 0.3, -Math.PI / 2, w / segsX);
      place(x, d / 2 - 0.3, Math.PI / 2, w / segsX);
    }
    rim.parts.forEach((part, k) => {
      const mesh = new THREE.Mesh(mergeGeometries(geos[k]), part.mat);
      mesh.castShadow = true;
      detail.add(mesh);
      geos[k].forEach(g => g.dispose());
    });
    // Far away the rim is a plain skirt in the same rock (12 triangles instead of about 14,000 per island).
    if (!skirtMat) {
      skirtMat = cliffMat(H, 8);
      skirtMat.color.set(0xb7a6d6);
      skirtMat.emissive = new THREE.Color(0x544c80);
      skirtMat.emissiveIntensity = 0.45;
    }
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.5, H, d - 0.5),
      skirtMat
    );
    skirt.position.y = p.y - 0.4 - H / 2;
    skirt.visible = false;
    group.add(skirt);
    far = skirt;
  }
  // The underside: a generated island's rocky outcrop (the same pieces as the distant islands), stretched to the platform and tucked
  // just under the cliff rim so only its hanging rock shows; a plain cone only when no island piece is loaded.
  const rockNames = ['island_a', 'island_b', 'island_c', 'island_d'].filter(
    n => pieces[n]
  );
  if (rockNames.length) {
    const name =
      rockNames[
        Math.abs(Math.round(p.z0 * 7 + p.x0 * 3 + p.y)) % rockNames.length
      ];
    const rock = normalise(pieces[name].clone(true), {
      dimension: 'width',
      size: 8,
      anchor: 'center',
    });
    const box = new THREE.Box3().setFromObject(rock);
    const sy = (Math.min(w, d) / 8) * 1.1;
    rock.scale.set((w * 1.05) / 8, sy, (d * 1.05) / 8);
    rock.rotation.y = Math.round(p.z0) % 2 ? 0 : Math.PI; // a half turn so neighbours do not match
    // The island models carry their own ruins, arches, trees and waterfalls on top, which looked like separate islands hanging under the
    // platform (and cannot be stood on). Keep only the rocky lower part: cut the model at 62% of its height, line that cut up just under
    // the cliff rim, and clip everything above it away.
    const cutLocal = box.min.y + (box.max.y - box.min.y) * 0.62;
    const rimY = p.y - 0.4 - H + 0.3;
    rock.position.set(0, rimY - cutLocal * sy, 0);
    const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), rimY); // keeps y <= rimY (platforms only move in x and z)
    rock.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.clippingPlanes = [cutPlane];
    });
    group.add(rock);
  } else {
    const keel = new THREE.Mesh(
      new THREE.ConeGeometry(Math.min(w, d) * 0.5, 4.5, 7),
      ROCK
    );
    keel.rotation.x = Math.PI;
    keel.scale.set(1.15, 1, (d / w) * 1.15);
    keel.position.set(0, p.y - 0.4 - H - 2.0, 0);
    group.add(keel);
  }
  if (pieces.bush) {
    for (const [bx, bz, bh] of [
      [w / 2 - 0.9, -d / 2 + 0.7, 1.5],
      [-w / 2 + 0.9, d / 2 - 0.7, 1.2],
    ]) {
      const blossom =
        WORLD && ((COURSE.habitats || {})[p.id] || []).includes('blossom'); // the islands the sprouts can live on
      const b = normalise((blossom ? blossomBush() : pieces.bush).clone(true), {
        dimension: 'height',
        size: blossom ? bh * 1.25 : bh,
        anchor: 'bottom',
      });
      b.position.set(bx, p.y - 0.25, bz);
      b.rotation.y = bx * 3;
      detail.add(b);
    }
  }
  group.add(detail);
  lodGroups.push({
    g: detail,
    far,
    x: (p.x0 + p.x1) / 2,
    z: (p.z0 + p.z1) / 2,
    mover: p.move ? group : null,
  });
  // Tall grass tufts, instanced: a sliding island carries its own batch; every still island shares one batch for the level.
  const rnd = mulberry32(Math.round(p.z0 * 10) + 11);
  const spots = [];
  // About 1.25 tufts a square metre: mostly short grass (ankle height) with one in four taller, and a third hugging the edges.
  for (
    let i = 0;
    i < Math.round(Math.min(340, Math.max(60, w * d * 1.25)));
    i++
  ) {
    const edgeBias = i % 3 === 0;
    const tall = i % 4 === 1;
    let x = (rnd() - 0.5) * (w - 0.8);
    if (edgeBias) x = (rnd() > 0.5 ? 1 : -1) * (w / 2 - 0.5 - rnd() * 0.9);
    spots.push({
      x,
      z: (rnd() - 0.5) * (d - 0.8),
      s: tall ? 0.6 + rnd() * 0.6 : 0.45 + rnd() * 0.4,
      h: tall ? 0.32 + rnd() * 0.38 : 0.14 + rnd() * 0.16,
      r: rnd() * Math.PI,
    });
  }
  const cx = (p.x0 + p.x1) / 2;
  const cz = (p.z0 + p.z1) / 2;
  const own = p.move ? [] : null;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const wet = (COURSE.streams || []).filter(st => st.plat === p.id); // no grass standing in a stream
  for (const t of spots) {
    if (wet.some(st => t.z + cz > st.z0 - 0.25 && t.z + cz < st.z1 + 0.25))
      continue;
    const edge = Math.max(
      sm(0.7, 1, Math.abs(t.x) / (w / 2)),
      sm(0.7, 1, Math.abs(t.z) / (d / 2))
    );
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r);
    m.compose(
      new THREE.Vector3(
        t.x + (own ? 0 : cx),
        p.y - edge * 0.3 - 0.02,
        t.z + (own ? 0 : cz)
      ),
      q,
      new THREE.Vector3(t.s, t.h, t.s)
    );
    (own || tuftMatrices).push(m.clone());
  }
  if (own) group.add(tuftBatch(own));
}
// The generated bush with its foliage hue turned from teal to blossom pink (the textures are redrawn once through a canvas filter).
function blossomBush() {
  if (pinkBush) return pinkBush;
  pinkBush = pieces.bush.clone(true);
  const done = new Map();
  pinkBush.traverse(o => {
    if (!o.isMesh) return;
    const mt = o.material.clone();
    if (mt.map && mt.map.image) {
      if (!done.has(mt.map)) {
        const img = mt.map.image;
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.filter = 'hue-rotate(168deg) saturate(1.15) brightness(1.12)';
        g.drawImage(img, 0, 0);
        const t = new THREE.CanvasTexture(c);
        t.flipY = mt.map.flipY;
        t.colorSpace = mt.map.colorSpace;
        t.wrapS = mt.map.wrapS;
        t.wrapT = mt.map.wrapT;
        done.set(mt.map, t);
      }
      mt.map = done.get(mt.map);
    }
    o.material = mt;
  });
  return pinkBush;
}
// One tuft is three crossed quads; a batch draws any number of them in one call.
function tuftBatch(matrices) {
  if (!tuftGeo) {
    const quads = [0, 1, 2].map(k => {
      const g = new THREE.PlaneGeometry(1, 1);
      g.translate(0, 0.5, 0);
      g.rotateY((k * Math.PI) / 3);
      return g;
    });
    tuftGeo = mergeGeometries(quads);
    tuftMat = new THREE.MeshLambertMaterial({
      map: slabTufts || (slabTufts = tuftTexture()),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    tuftMat.onBeforeCompile = shader => {
      shader.uniforms.uTime = grassU.uTime;
      shader.uniforms.uKai = grassU.uKai;
      shader.vertexShader =
        'uniform float uTime;\nuniform vec3 uKai;\n' +
        shader.vertexShader.replace('#include <project_vertex>', GRASS_PROJECT);
    };
  }
  const mesh = new THREE.InstancedMesh(tuftGeo, tuftMat, matrices.length);
  const tint = new THREE.Color();
  const rnd = mulberry32(matrices.length + 5);
  matrices.forEach((mt, i) => {
    mesh.setMatrixAt(i, mt);
    mesh.setColorAt(
      i,
      tint.setRGB(0.84 + rnd() * 0.28, 0.9 + rnd() * 0.18, 0.72 + rnd() * 0.25)
    ); // no two tufts quite the same green
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // the wind moves the blades outside the still bounds
  return mesh;
}
// The generated cliff wall, normalised to height H, simplified (about a third of its vertices kept) and baked to plain geometry,
// once. Returns { parts: [{ geo, mat }], len } or null when the piece is missing.
function rimSource(H) {
  if (!pieces.cliffwall) return null;
  if (rimCache[H]) return rimCache[H];
  const tpl = normalise(pieces.cliffwall.clone(true), {
    dimension: 'height',
    size: H,
    anchor: 'bottom',
  });
  tpl.updateMatrixWorld(true);
  const parts = [];
  tpl.traverse(o => {
    if (!o.isMesh) return;
    let geo = o.geometry.clone();
    for (const name of Object.keys(geo.attributes)) {
      if (!['position', 'uv', 'normal'].includes(name))
        geo.deleteAttribute(name);
    }
    try {
      const merged = mergeVertices(geo);
      const remove = Math.floor(merged.attributes.position.count * RIM_REMOVE);
      if (remove > 0) geo = new SimplifyModifier().modify(merged, remove);
      geo.computeVertexNormals();
    } catch (err) {
      game.warnings.push('cliff rim not simplified: ' + err);
    }
    geo.applyMatrix4(o.matrixWorld);
    const mt = o.material.clone();
    mt.emissive = new THREE.Color(0x544c80); // lift the shaded faces so the rock still reads
    mt.emissiveIntensity = 0.45;
    parts.push({ geo, mat: mt });
  });
  rimCache[H] = { parts, len: tpl.userData.size.z };
  game.scenery.rimTriangles = parts.reduce(
    (n, part) =>
      n +
      (part.geo.index
        ? part.geo.index.count
        : part.geo.attributes.position.count) /
        3,
    0
  );
  return rimCache[H];
}

// ---------- S5 geometry: an island chain, two sliding slabs, orbs and sprouts ----------
const s5 = { movers: [] };
if (LEVEL === 's5') {
  const gold = mat(0xffc83d, {
    emissive: 0xaa7a00,
    emissiveIntensity: 0.6,
    metalness: 0.2,
    roughness: 0.4,
  });
  for (const p of COURSE.platforms) {
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2;
    const cz = (p.z0 + p.z1) / 2;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), GRASS);
    top.position.set(cx, p.y - 0.15, cz);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.96, 3.6, d * 0.96),
      ROCK
    );
    body.position.set(cx, p.y - 2.1, cz);
    const keel = new THREE.Mesh(
      new THREE.ConeGeometry(Math.min(w, d) * 0.5, 7, 7),
      ROCK
    );
    keel.rotation.x = Math.PI;
    keel.scale.set(1, 1, d / w);
    keel.position.set(cx, p.y - 7.4, cz);
    if (p.move) {
      // A sliding slab, dressed as a small floating island around its own centre and moved each frame from platformBounds.
      const group = new THREE.Group();
      slabDress(p, w, d, group);
      course.add(group);
      s5.movers.push({ p, group });
      continue;
    }
    course.add(top, body, keel);
    plateauDress(p, w, d, cx, cz, top, body);
  }
  {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 2.2, 10),
      gold
    );
    pole.position.set(1.4, 1.1, COURSE.goal.z + 1);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), gold);
    knob.position.set(1.4, 2.3, COURSE.goal.z + 1);
    course.add(pole, knob);
  }
  for (const e of COURSE.enemies) {
    const g = makeEnemy(e);
    scene.add(g);
    s4.orbs.push({ g, e });
  }
}

// ---------- S6 geometry: a staircase of rising islands up to the summit, the guardian and the gate ----------
if (LEVEL === 's6') {
  const gold = mat(0xffc83d, {
    emissive: 0xaa7a00,
    emissiveIntensity: 0.6,
    metalness: 0.2,
    roughness: 0.4,
  });
  for (const p of COURSE.platforms) {
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2;
    const cz = (p.z0 + p.z1) / 2;
    if (p.id.startsWith('step')) {
      // The climbing steps are small islands (the same dressing as S5's sliding slabs).
      const group = new THREE.Group();
      slabDress(p, w, d, group);
      group.position.set(cx, 0, cz);
      course.add(group);
      continue;
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), GRASS);
    top.position.set(cx, p.y - 0.15, cz);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.96, 3.6, d * 0.96),
      ROCK
    );
    body.position.set(cx, p.y - 2.1, cz);
    const keel = new THREE.Mesh(
      new THREE.ConeGeometry(Math.min(w, d) * 0.5, 7, 7),
      ROCK
    );
    keel.rotation.x = Math.PI;
    keel.scale.set(1, 1, d / w);
    keel.position.set(cx, p.y - 7.4, cz);
    course.add(top, body, keel);
    plateauDress(p, w, d, cx, cz, top, body);
  }
  // The goal: a golden post at the end of the summit, and the gate (a violet barrier between two pillars) before it.
  {
    const gy = COURSE.platforms[COURSE.platforms.length - 1].y;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 2.2, 10),
      gold
    );
    pole.position.set(1.4, gy + 1.1, COURSE.goal.z + 1);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), gold);
    knob.position.set(1.4, gy + 2.3, COURSE.goal.z + 1);
    course.add(pole, knob);
    const g = new THREE.Group();
    const barrier = new THREE.Mesh(
      new THREE.PlaneGeometry(9.6, 3.2),
      new THREE.MeshBasicMaterial({
        color: 0xa56bff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    barrier.rotation.y = Math.PI / 2;
    barrier.position.set(0, gy + 1.6, COURSE.gate.z);
    g.add(barrier);
    for (const px of [-4.9, 4.9]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), ROCK);
      pillar.position.set(px, gy + 1.7, COURSE.gate.z);
      g.add(pillar);
    }
    scene.add(g);
    s4.gate = g;
  }
  for (const e of COURSE.enemies) {
    const g = makeEnemy(e);
    scene.add(g);
    s4.orbs.push({ g, e });
  }
  // The citadel is closer and larger here: the climb is toward it.
  castle.position.set(0, -20, 175);
  castle.scale.setScalar(0.55);
}

// ---------- the continuous world: acts 2 to 6 on top of the open S1 (decks, sliding islands, enemies, grapple, rail, keys,
// gates, gems, the sky river and the citadel gate) ----------
const GOLD = mat(0xffc83d, {
  emissive: 0xaa7a00,
  emissiveIntensity: 0.6,
  metalness: 0.2,
  roughness: 0.4,
});
// A vine bloom: a flower with hanging tendrils. It opens when Kai is within its reach, which is how the player sees he can use it.
function buildBloom(a) {
  const g = new THREE.Group();
  const big = a.bloom ? 1 : 1.5; // the great bloom over the sky river
  const fixed = new THREE.Group(); // the heart and the tendrils (the petals open and close, so they are baked on their own)
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.3 * big, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe9a0 })
  );
  fixed.add(core);
  const petalMat = mat(0xff8fba, {
    emissive: 0xb0406a,
    emissiveIntensity: 0.5,
    roughness: 0.6,
  });
  const petals = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const pt = new THREE.Mesh(
      new THREE.SphereGeometry(0.34 * big, 10, 8),
      petalMat
    );
    pt.scale.set(0.55, 0.22, 1);
    const ang = (k / 6) * Math.PI * 2;
    pt.position.set(
      Math.sin(ang) * 0.42 * big,
      -0.08,
      Math.cos(ang) * 0.42 * big
    );
    pt.rotation.y = ang;
    pt.rotation.x = 0.5;
    petals.add(pt);
  }
  {
    const one = bake(petals);
    petals.clear();
    petals.add(one);
  }
  g.add(petals);
  const vineMat = mat(0x58a83a);
  for (let k = 0; k < 3; k++) {
    const len = (0.9 + k * 0.45) * big;
    const v = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.045, len, 5),
      vineMat
    );
    v.position.set((k - 1) * 0.14, -len / 2 - 0.1, (k % 2) * 0.12 - 0.06);
    fixed.add(v);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), vineMat);
    leaf.scale.set(1, 0.4, 1.6);
    leaf.position.set(v.position.x, -len - 0.1, v.position.z);
    fixed.add(leaf);
  }
  g.add(bake(fixed));
  const halo2 = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: cloudTex,
      color: 0xffb6d2,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo2.scale.set(3 * big, 3 * big, 1);
  g.add(halo2);
  g.position.set(a.x, a.y, a.z);
  scene.add(g);
  world.blooms.push({ g, a, petals, halo: halo2, open: 0 });
  if (!s3.rope) {
    const rope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 1, 6),
      new THREE.MeshBasicMaterial({ color: 0x6fbf3a })
    );
    rope.visible = false;
    scene.add(rope);
    s3.rope = rope;
  }
}
function buildGrapple(a) {
  if (WORLD) return buildBloom(a);
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd45a })
  );
  const aHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: cloudTex,
      color: 0xffc83d,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  aHalo.scale.set(3.4, 3.4, 1);
  orb.add(aHalo);
  orb.position.set(a.x, a.y, a.z);
  scene.add(orb);
  s3.anchor = orb;
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd45a })
  );
  rope.visible = false;
  scene.add(rope);
  s3.rope = rope;
}
function buildRail(r) {
  const a = new THREE.Vector3(r.x, r.y0, r.z0);
  const b = new THREE.Vector3(r.x, r.y1, r.z1);
  const len = a.distanceTo(b);
  const railMat = mat(0x39e6d0, {
    emissive: 0x15a090,
    emissiveIntensity: 0.9,
    metalness: 0.3,
    roughness: 0.35,
  });
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, len, 8),
    railMat
  );
  bar.position.copy(a).add(b).multiplyScalar(0.5);
  bar.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.clone().sub(a).normalize()
  );
  course.add(bar);
  const tieGeo = new THREE.BoxGeometry(0.5, 0.05, 0.12);
  const ties = new THREE.InstancedMesh(
    tieGeo,
    railMat,
    Math.floor(len / 2) + 1
  );
  const m4 = new THREE.Matrix4();
  for (let k = 0, i = 0; k <= len; k += 2, i++) {
    const f = k / len;
    m4.makeTranslation(
      r.x,
      r.y0 + (r.y1 - r.y0) * f - 0.08,
      r.z0 + (r.z1 - r.z0) * f
    );
    ties.setMatrixAt(i, m4);
  }
  course.add(ties);
  for (const [pz, py, base] of [
    [r.z0, r.y0, r.base ?? 0],
    [r.z1, r.y1, r.base ?? 0],
  ]) {
    const h = py - base + 3;
    const pylon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, h, 8),
      GOLD
    );
    pylon.position.set(r.x, py - h / 2, pz);
    course.add(pylon);
  }
}
function buildKey(k) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.055, 8, 16),
    GOLD
  );
  ring.position.y = 0.3;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.55, 8),
    GOLD
  );
  shaft.position.y = -0.1;
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.05), GOLD);
  t1.position.set(0.1, -0.3, 0);
  const t2 = t1.clone();
  t2.position.set(0.08, -0.17, 0);
  g.add(ring, shaft, t1, t2);
  const kHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: cloudTex,
      color: 0xffc83d,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  kHalo.scale.set(2.4, 2.4, 1);
  g.add(kHalo);
  g.scale.setScalar(1.5);
  g.position.set(k.x, k.y + 0.3, k.z);
  scene.add(g);
  return g;
}
function buildGate(gate) {
  const g = new THREE.Group();
  const y = gate.y ?? 0;
  const w = (gate.x1 ?? 4.8) - (gate.x0 ?? -4.8) - 3.4;
  const barrier = new THREE.Mesh(
    new THREE.PlaneGeometry(w, 3.2),
    new THREE.MeshBasicMaterial({
      color: 0xa56bff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  barrier.position.set(0, y + 1.6, gate.z);
  g.add(barrier);
  scene.add(g);
  // The pillars stay when the barrier goes.
  for (const px of [-w / 2 - 0.1, w / 2 + 0.1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.6, 0.6), ROCK);
    pillar.position.set(px, y + 1.8, gate.z);
    pillar.castShadow = true;
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), GOLD);
    cap.position.set(px, y + 3.95, gate.z);
    course.add(pillar, cap);
  }
  return g;
}
const world = {
  movers: [],
  keys: [],
  gates: [],
  gems: [],
  blooms: [],
  creatures: [],
  springs: [],
};
if (WORLD) {
  const DARK = mat(0x6a4122);
  for (const p of COURSE.platforms) {
    if (!p.kind && !p.move) continue; // plain islands were built with act 1
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2;
    const cz = (p.z0 + p.z1) / 2;
    const group = new THREE.Group();
    if (p.kind === 'deck' || p.kind === 'bridge') {
      const gen = generatedDeck(p, w, d);
      if (gen) group.add(gen);
      else {
        const deck = new THREE.Mesh(
          new THREE.BoxGeometry(w, 0.25, d),
          woodMat(w, d)
        );
        deck.position.y = p.y - 0.125;
        deck.receiveShadow = true;
        deck.castShadow = true;
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.88, 0.5, d),
          DARK
        );
        beam.position.y = p.y - 0.5;
        group.add(deck, beam);
      }
    } else slabDress(p, w, d, group);
    if (p.kind)
      group.traverse(o => {
        if (o.isMesh) o.receiveShadow = true; // Kai's shadow falls on the planks too
      });
    group.position.set(cx, 0, cz);
    course.add(group);
    if (p.move) world.movers.push({ p, group });
  }
  COURSE.enemies.forEach((e, i) => {
    if (e.kind === 'flyer') return makeFlyer(e, i);
    const g = makeEnemy(e);
    scene.add(g);
    s4.orbs.push({ g, e, i });
  });
  if (fenceTemplate && COURSE.walls) {
    const matrices = [];
    for (const wl of COURSE.walls) {
      for (let z = wl.z0 + 1; z <= wl.z1 - 0.99; z += FENCE_SEGMENT_M)
        matrices.push(new THREE.Matrix4().makeTranslation(wl.x, wl.y - 0.3, z)); // the lawn dips toward its edge
    }
    for (const mesh of instancedFrom(fenceTemplate, matrices)) {
      mesh.frustumCulled = false;
      course.add(mesh);
    }
  }
  for (const a of COURSE.anchors || []) buildGrapple(a);
  for (const r of COURSE.rails || []) buildRail({ ...r, base: -2 });
  for (const k of COURSE.keys || []) world.keys.push({ k, g: buildKey(k) });
  for (const gate of COURSE.gates || [])
    world.gates.push({ gate, g: buildGate(gate) });
  // Sky gems: a teal crystal with a halo.
  {
    const gemGeo = new THREE.OctahedronGeometry(0.42, 0);
    gemGeo.scale(1, 1.45, 1);
    const gemMat = new THREE.MeshStandardMaterial({
      color: 0x4ff2e0,
      emissive: 0x18b8a8,
      emissiveIntensity: 0.9,
      roughness: 0.15,
      metalness: 0.3,
      flatShading: true,
    });
    for (const c of COURSE.gems || []) {
      const m = new THREE.Mesh(gemGeo, gemMat);
      const gHalo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: cloudTex,
          color: 0x5ff5e6,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      gHalo.scale.set(3, 3, 1);
      m.add(gHalo);
      m.position.set(c.x, c.y, c.z);
      scene.add(m);
      world.gems.push(m);
    }
  }
  // The golden posts at the dock's end and on the far bank (the footage's grapple posts).
  for (const [px, py, pz] of [
    [1.6, 0, 158.2],
    [1.6, -2, 181.6],
  ]) {
    if (!pieces.post) break;
    const post = normalise(pieces.post.clone(true), {
      dimension: 'height',
      size: 2.6,
      anchor: 'bottom',
    });
    post.position.set(px, py, pz);
    course.add(post);
  }
  // The sky river: soft-edged water under the boardwalk, the raft, the dock and the swing, and the waterfall cliffs beside it.
  for (const wtr of COURSE.water || []) {
    // Soft edges (an alpha map) and a streaked surface that flows toward the falls.
    const fc = document.createElement('canvas');
    fc.width = fc.height = 128;
    const fg = fc.getContext('2d');
    const fr = fg.createRadialGradient(64, 64, 10, 64, 64, 64);
    fr.addColorStop(0, '#fff');
    fr.addColorStop(0.55, '#ddd');
    fr.addColorStop(1, '#000');
    fg.fillStyle = fr;
    fg.fillRect(0, 0, 128, 128);
    const rc = document.createElement('canvas');
    rc.width = rc.height = 256;
    const rg = rc.getContext('2d');
    const grad = rg.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, '#2f7fc4');
    grad.addColorStop(0.5, '#4aa3e0');
    grad.addColorStop(1, '#2f7fc4');
    rg.fillStyle = grad;
    rg.fillRect(0, 0, 256, 256);
    const rr = mulberry32(77);
    for (let i = 0; i < 140; i++) {
      const x = rr() * 256;
      const y = rr() * 256;
      const len = 14 + rr() * 46;
      rg.strokeStyle = `rgba(255,255,255,${0.1 + rr() * 0.3})`;
      rg.lineWidth = 1 + rr() * 2.2;
      rg.beginPath();
      rg.moveTo(x, y);
      rg.bezierCurveTo(
        x + 3,
        y + len * 0.3,
        x - 3,
        y + len * 0.7,
        x + (rr() - 0.5) * 6,
        y + len
      );
      rg.stroke();
    }
    const rippleTex = new THREE.CanvasTexture(rc);
    rippleTex.colorSpace = THREE.SRGBColorSpace;
    rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping;
    rippleTex.repeat.set(wtr.w / 16, wtr.d / 16);
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(wtr.w, wtr.d),
      new THREE.MeshBasicMaterial({
        map: rippleTex,
        transparent: true,
        opacity: 0.86,
        alphaMap: new THREE.CanvasTexture(fc),
        depthWrite: false,
      })
    );
    river.rotation.x = -Math.PI / 2;
    river.position.set(wtr.x, wtr.y, wtr.z);
    scene.add(river);
    world.river = river;
    world.ripple = rippleTex;
  }
  if (pieces.waterfall) {
    for (const [x, y, z, ry] of [
      // Well out of reach and with their tops below the road: they look like ground but are scenery, and Kai fell through them.
      [-34, -46, 118, 0],
      [40, -44, 172, Math.PI],
    ]) {
      const c = normalise(pieces.waterfall.clone(true), {
        dimension: 'height',
        size: 36,
        anchor: 'bottom',
      });
      c.position.set(x, y, z);
      c.rotation.y = ry;
      scene.add(c);
    }
  }
  // Streams: shallow water running across an island and pouring off its edge. The strip's texture flows toward the lip; the fall
  // is a ribbon that curls over the edge and drops into the cloud; two layers at different speeds give it depth.
  world.streams = [];
  if (COURSE.streams) {
    const rr = mulberry32(53);
    const fcv = document.createElement('canvas');
    fcv.width = 512;
    fcv.height = 128;
    const fg = fcv.getContext('2d');
    const base = fg.createLinearGradient(0, 0, 0, 128);
    base.addColorStop(0, '#6cc2f2');
    base.addColorStop(0.5, '#3f95da');
    base.addColorStop(1, '#6cc2f2');
    fg.fillStyle = base;
    fg.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 150; i++) {
      // long soft streaks along the flow
      fg.strokeStyle = `rgba(255,255,255,${0.1 + rr() * 0.28})`;
      fg.lineWidth = 1 + rr() * 2.2;
      fg.lineCap = 'round';
      const x = rr() * 512;
      const y = 14 + rr() * 100;
      const len = 30 + rr() * 110;
      fg.beginPath();
      fg.moveTo(x, y);
      fg.bezierCurveTo(
        x + len * 0.3,
        y + 3,
        x + len * 0.7,
        y - 3,
        x + len,
        y + (rr() - 0.5) * 5
      );
      fg.stroke();
    }
    for (const edgeY of [5, 123]) {
      // soft foam along both banks: many small overlapping blobs, not blocks
      for (let x = 0; x < 512; x += 3) {
        const r = 3 + rr() * 5;
        const gr = fg.createRadialGradient(
          x,
          edgeY + (rr() - 0.5) * 5,
          0,
          x,
          edgeY,
          r
        );
        gr.addColorStop(0, `rgba(255,255,255,${0.5 + rr() * 0.4})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        fg.fillStyle = gr;
        fg.fillRect(x - r, edgeY - r - 3, r * 2, r * 2 + 6);
      }
    }
    const flowBase = new THREE.CanvasTexture(fcv);
    flowBase.colorSpace = THREE.SRGBColorSpace;
    flowBase.wrapS = flowBase.wrapT = THREE.RepeatWrapping;
    const wcv = document.createElement('canvas');
    wcv.width = 64;
    wcv.height = 256;
    const wg = wcv.getContext('2d');
    wg.fillStyle = 'rgba(120,190,240,0.5)';
    wg.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 46; i++) {
      wg.fillStyle = `rgba(255,255,255,${0.25 + rr() * 0.6})`;
      wg.fillRect(rr() * 64, rr() * 256, 1.5 + rr() * 3.5, 30 + rr() * 110);
    }
    const fallBase = new THREE.CanvasTexture(wcv);
    fallBase.colorSpace = THREE.SRGBColorSpace;
    fallBase.wrapS = fallBase.wrapT = THREE.RepeatWrapping;
    world.flows = [];
    for (const st of COURSE.streams) {
      const pl = COURSE.platforms.find(q => q.id === st.plat);
      const wd = st.z1 - st.z0;
      const cz = (st.z0 + st.z1) / 2;
      const lip = st.side > 0 ? pl.x1 : pl.x0; // the edge it pours off
      const from = st.side > 0 ? pl.x0 + 0.9 : pl.x1 - 0.9; // it rises at the far side
      const to = lip - st.side * 0.9;
      const len = Math.abs(to - from);
      const wet = new THREE.Group(); // everything that is only there while the spring flows
      course.add(wet);
      const flow = flowBase.clone();
      flow.needsUpdate = true;
      flow.repeat.set(len / 9, 1);
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(len, wd),
        new THREE.MeshBasicMaterial({
          map: flow,
          transparent: true,
          opacity: 0.86,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        })
      );
      strip.rotation.set(-Math.PI / 2, 0, st.side > 0 ? 0 : Math.PI); // the texture's u runs toward the lip
      strip.position.set((from + to) / 2, pl.y + 0.05, cz);
      strip.renderOrder = 1;
      wet.add(strip);
      world.flows.push({ tex: flow, axis: 'x', v: 0.3 });
      // The fall: a ribbon along this profile (distance out from the lip, drop below the lawn).
      const profile = [
        [-0.9, 0.05],
        [-0.25, 0.0],
        [0.2, -0.45],
        [0.42, -1.6],
        [0.55, -5],
        [0.62, -12],
        [0.66, -26],
      ];
      for (const [layer, half, speed, opacity] of [
        [0, wd * 0.46, 0.5, 0.88],
        [0.14, wd * 0.36, 0.8, 0.5],
      ]) {
        const pos = [];
        const uv = [];
        const idx = [];
        let run = 0;
        profile.forEach(([out, drop], k) => {
          if (k)
            run += Math.hypot(
              out - profile[k - 1][0],
              drop - profile[k - 1][1]
            );
          const x = lip + st.side * (out + layer);
          pos.push(x, pl.y + drop, cz - half, x, pl.y + drop, cz + half);
          uv.push(0, run / 7, 2, run / 7);
          if (k) {
            const a = (k - 1) * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        const tex = fallBase.clone();
        tex.needsUpdate = true;
        const sheet = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        );
        sheet.renderOrder = 1;
        wet.add(sheet);
        world.flows.push({ tex, axis: 'y', v: speed });
      }
      // Where it rises: a ring of stones round a pool, with the water welling up in the middle. A dry spring shows the stones, an
      // empty bed and no fall, until a sky gem wakes it.
      if (st.spring) {
        const stone = mat(0x9a96a6, { roughness: 0.95 });
        const rocks = new THREE.Group();
        for (let k = 0; k < 7; k++) {
          const ang = (k / 7) * Math.PI * 2 + 0.3;
          const rock = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.34 + (k % 3) * 0.09, 0),
            stone
          );
          rock.position.set(
            st.spring.x + Math.cos(ang) * 1.25,
            pl.y + 0.12,
            st.spring.z + Math.sin(ang) * 1.25
          );
          rock.rotation.set(k, k * 2, k * 3);
          rocks.add(rock);
        }
        course.add(bake(rocks));
        const pool = new THREE.Mesh(
          new THREE.CircleGeometry(1.2, 20),
          new THREE.MeshBasicMaterial({
            color: 0x4fa6e6,
            transparent: true,
            opacity: 0.88,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          })
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(st.spring.x, pl.y + 0.06, st.spring.z);
        pool.renderOrder = 1;
        wet.add(pool);
        const bed = new THREE.Mesh(
          new THREE.PlaneGeometry(len, wd * 0.8),
          new THREE.MeshBasicMaterial({
            color: 0xa8926a,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          })
        );
        bed.rotation.x = -Math.PI / 2;
        bed.position.set((from + to) / 2, pl.y + 0.04, cz);
        course.add(bed);
        world.springs.push({
          i: COURSE.streams.indexOf(st),
          wet,
          bed,
          x: st.spring.x,
          y: pl.y,
          z: st.spring.z,
        });
      }
      world.streams.push({
        i: COURSE.streams.indexOf(st),
        x0: Math.min(from, lip),
        x1: Math.max(from, lip),
        z0: st.z0,
        z1: st.z1,
        y: pl.y,
        lip,
        side: st.side,
        cz,
      });
    }
  }
  // The citadel stands at the end of the road: bigger and further than in act 1 alone, so it reads the same from the start
  // and grows as Kai comes nearer.
  castle.position.set(0, -34, 500);
  castle.scale.setScalar(1.5);
  // The goal: a golden arch on the summit and a beam of light above it that is in view from the first island.
  {
    const gy = COURSE.platforms.find(q => q.id === 'summit').y;
    const gz = COURSE.goal.z + 1.2;
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(2.3, 0.17, 8, 28, Math.PI),
      GOLD
    );
    arch.position.set(COURSE.goal.x, gy + 2.2, gz);
    course.add(arch);
    for (const sx of [-2.3, 2.3]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.2, 2.2, 10),
        GOLD
      );
      post.position.set(COURSE.goal.x + sx, gy + 1.1, gz);
      post.castShadow = true;
      course.add(post);
    }
    const beamMat = opacity =>
      new THREE.MeshBasicMaterial({
        color: 0xffe9a8,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      });
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.9, 160, 12, 1, true),
      beamMat(0.34)
    );
    const outer = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 2.6, 160, 12, 1, true),
      beamMat(0.12)
    );
    inner.position.set(COURSE.goal.x, gy + 80, gz);
    outer.position.copy(inner.position);
    scene.add(inner, outer);
    world.beam = [inner, outer];
  }
  // Distant life: a few blue flyers circling beside the road (the video has them in the sky).
  world.birds = [];
  if (pieces.flyer) {
    for (const [cx, cy, cz, r, sp] of [
      [-34, 12, 60, 16, 0.5],
      [38, 16, 140, 20, -0.4],
      [-30, 9, 205, 14, 0.55],
      [34, 14, 300, 18, -0.45],
      [-28, 18, 380, 15, 0.5],
    ]) {
      const g = new THREE.Group();
      g.add(
        normalise(pieces.flyer.clone(true), {
          dimension: 'longest',
          size: 2.6,
          anchor: 'center',
        })
      );
      scene.add(g);
      world.birds.push({ g, cx, cy, cz, r, sp, ph: cx * 0.3 });
    }
  }
}

if (tuftMatrices.length) course.add(tuftBatch(tuftMatrices));

// ---------- the air: drifting motes everywhere; in the whole journey, banks of mist between the islands, thin mist over the
// lawns, and spray clouds at the lip and the foot of every waterfall ----------
const mistSpots = [];
if (WORLD) {
  const mr = mulberry32(31);
  const roadY = z =>
    z < 165 ? 0 : z < 340 ? -2 : -2 + Math.min(6, ((z - 340) / 46) * 6);
  for (let i = 0; i < 58; i++) {
    const z = -30 + mr() * 480;
    const side = mr() > 0.5 ? 1 : -1;
    mistSpots.push({
      x: side * (7 + mr() * 46),
      y: roadY(z) - 6 + mr() * 7.2,
      z,
      size: 15 + mr() * 16,
      alpha: 0.1 + mr() * 0.08,
      drift: 4,
    });
  }
  for (let i = 0; i < 9; i++) {
    const z = 20 + mr() * 380;
    mistSpots.push({
      x: (mr() - 0.5) * 8,
      y: roadY(z) + 0.4,
      z,
      size: 9 + mr() * 4,
      alpha: 0.075,
      drift: 5,
    });
  }
  for (const st of world.streams) {
    mistSpots.push({
      x: st.lip + st.side * 0.8,
      y: st.y - 0.9,
      z: st.cz,
      size: 4.5,
      alpha: 0.2,
      drift: 0.4,
    });
    for (let k = 0; k < 3; k++)
      mistSpots.push({
        x: st.lip + st.side * (1.5 + k),
        y: st.y - 11 - k * 4.5,
        z: st.cz + (mr() - 0.5) * 3,
        size: 11 + k * 3,
        alpha: 0.24,
        drift: 1,
      });
  }
  for (const wtr of COURSE.water || []) {
    for (let k = 0; k < 5; k++)
      mistSpots.push({
        x: wtr.x + (mr() - 0.5) * wtr.w * 0.6,
        y: wtr.y + 1.2,
        z: wtr.z + (mr() - 0.5) * wtr.d * 0.7,
        size: 16,
        alpha: 0.12,
        drift: 5,
      });
  }
}
const ambient = createAmbient(scene, renderer, mistSpots, mulberry32(77));
game.ambient = {
  motes: 260,
  mist: mistSpots.length,
  maxPointPx: ambient.maxPx,
};
sky.ambient = ambient;
sky.tod = -1;
applySky(0);

// ---------- Kai ----------
const kaiRoot = new THREE.Group();
scene.add(kaiRoot);
const kaiPose = new THREE.Group(); // squash, stretch and lean are applied here, around his feet
kaiRoot.add(kaiPose);
// A ring on the ground under Kai while he is in the air, so the player can judge where he will land.
const landRing = new THREE.Mesh(
  new THREE.RingGeometry(0.26, 0.42, 28),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
);
landRing.rotation.x = -Math.PI / 2;
landRing.renderOrder = 3;
landRing.visible = false;
scene.add(landRing);
// A soft dark disc on the ground directly under Kai, always: on every surface (the decks included), from every sun angle, and
// with the shadow map switched off by the quality governor. It shrinks and fades as he rises, which is how the eye reads height.
const blob = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({
    map: (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      r.addColorStop(0, 'rgba(18,28,22,0.85)');
      r.addColorStop(0.55, 'rgba(18,28,22,0.45)');
      r.addColorStop(1, 'rgba(18,28,22,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  })
);
blob.rotation.x = -Math.PI / 2;
blob.renderOrder = 2;
scene.add(blob);
// Checkpoint markers: a post with a crystal at every checkpoint region; the one Kai will return to glows teal.
const cpMarks = { crystals: null, pos: [] };
if (LEVEL === 's1' && COURSE.checkpoints.some(c => c.r !== undefined)) {
  const n = COURSE.checkpoints.length;
  const cGeo = new THREE.OctahedronGeometry(0.24, 0);
  cGeo.scale(1, 1.5, 1);
  const crystals = new THREE.InstancedMesh(
    cGeo,
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    n
  );
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.05, 0.08, 1.5, 6),
    mat(0x6a4122),
    n
  );
  const m4 = new THREE.Matrix4();
  COURSE.checkpoints.forEach((cp, i) => {
    const off = Math.min(1.15, (cp.r ?? 2) * 0.55) * (i % 2 ? -1 : 1);
    let x = cp.x + off;
    const under =
      supportAt(COURSE, x, cp.z, 0, 0) ||
      supportAt(COURSE, cp.x, cp.z, 0.15, 0);
    if (under && (x < under.x0 + 0.3 || x > under.x1 - 0.3)) x = cp.x;
    const h = under
      ? under.hm
        ? (surfaceY(under, x, cp.z) ?? under.y)
        : under.y
      : 0;
    cpMarks.pos.push({ x, y: h, z: cp.z });
    m4.makeTranslation(x, h + 0.75, cp.z);
    poles.setMatrixAt(i, m4);
    m4.makeTranslation(x, h + 1.85, cp.z);
    crystals.setMatrixAt(i, m4);
    crystals.setColorAt(i, new THREE.Color(i === 0 ? 0x4ff2e0 : 0x6f86a8));
  });
  crystals.frustumCulled = false;
  poles.frustumCulled = false;
  course.add(crystals, poles);
  cpMarks.crystals = crystals;
}
function lightCheckpoint(i) {
  if (!cpMarks.crystals) return;
  const c = new THREE.Color();
  for (let k = 0; k < COURSE.checkpoints.length; k++)
    cpMarks.crystals.setColorAt(k, c.set(k === i ? 0x4ff2e0 : 0x6f86a8));
  cpMarks.crystals.instanceColor.needsUpdate = true;
}
let mixer = null;
const actions = {};
let current = null;

let ropePose = false; // true while the hang pose is held on the rope
const gripPoint = new THREE.Vector3(); // where the rope meets Kai's hands (world)
const _gp = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  pq: new THREE.Quaternion(),
  bq: new THREE.Quaternion(),
};
// Rotate `bone` so the line bone -> child points along `dir` (world space).
function aimBone(bone, child, dir) {
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(_gp.a);
  child.getWorldPosition(_gp.b);
  _gp.b.sub(_gp.a).normalize();
  _gp.q.setFromUnitVectors(_gp.b, dir);
  bone.getWorldQuaternion(_gp.bq);
  bone.parent.getWorldQuaternion(_gp.pq).invert();
  bone.quaternion.copy(_gp.pq.multiply(_gp.q.multiply(_gp.bq)));
  bone.updateWorldMatrix(false, true);
}
// While roped: both arms reach up along the rope and the rope ends between the hands.
function gripRope() {
  const a = state.rope
    ? COURSE.anchors[state.rope.i]
    : state.hang
      ? hangPoint()
      : null;
  gripPoint.set(state.x, state.y + PARAMS.handHeight, state.z);
  for (const side of ['R', 'L']) {
    const up = kaiRoot.getObjectByName(`${side}_Upperarm`);
    const fore = kaiRoot.getObjectByName(`${side}_Forearm`);
    const hand = kaiRoot.getObjectByName(`${side}_Hand`);
    if (!up || !fore || !hand) return;
    up.getWorldPosition(_gp.c);
    let dir;
    if (a) dir = new THREE.Vector3(a.x, a.y, a.z).sub(_gp.c).normalize();
    else {
      // Hanging from a rail: arms straight up to the bar, the two sides alternating forward and back (hand over hand).
      const swing = Math.sin(state.t * 9 + (side === 'R' ? 0 : Math.PI)) * 0.5;
      dir = new THREE.Vector3(0, 1, swing).normalize();
    }
    aimBone(up, fore, dir);
    aimBone(fore, hand, dir);
  }
  const rh = kaiRoot.getObjectByName('R_Hand');
  const lh = kaiRoot.getObjectByName('L_Hand');
  if (rh && lh) {
    rh.getWorldPosition(_gp.a);
    lh.getWorldPosition(_gp.b);
    gripPoint.copy(_gp.a).add(_gp.b).multiplyScalar(0.5);
  }
}
function setAction(name, fade = 0.15, force = false) {
  const next = actions[name];
  if (!next || (current === next && !force)) return;
  next.reset().setEffectiveWeight(1).play();
  if (current) current.crossFadeTo(next, fade, false);
  current = next;
}

async function loadKai() {
  const loader = new GLTFLoader();
  try {
    const [idle, run, jump, flip, fall] = await Promise.all(
      ['idle', 'run', 'jump', 'flip', 'fall'].map(n =>
        loader.loadAsync(`/assets/kai_${n}.glb`)
      )
    );
    const kai = idle.scene;
    kai.scale.setScalar(KAI_HEIGHT);
    kai.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false; // grass and scenery shadows must not darken him
        o.frustumCulled = false;
        // Keep him readable from every angle: a self-glow from his own texture on top of the scene lights.
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m && m.map) {
            m.emissive = new THREE.Color(0xffffff);
            m.emissiveMap = m.map;
            m.emissiveIntensity = KAI_GLOW;
            m.needsUpdate = true;
          }
        }
      }
    });
    const inner = new THREE.Group();
    inner.rotation.y = -Math.PI / 2; // the model faces +X; the game faces +Z
    inner.add(kai);
    kaiPose.add(inner);
    mixer = new THREE.AnimationMixer(kai);
    actions.idle = mixer.clipAction(idle.animations[0]);
    actions.run = mixer.clipAction(run.animations[0]);
    actions.jump = mixer.clipAction(jump.animations[0]);
    actions.jump.setLoop(THREE.LoopOnce, 1);
    actions.jump.clampWhenFinished = true;
    // The flip preset is 4.5 s: about 1.2 s of wind-up, a full rotation from 1.2 s to 3.4 s, then recovery.
    // Use only the rotation (frames 34..104 at 30 fps) and play it fast so it fits one air jump (~0.8 s).
    const flipCore = THREE.AnimationUtils.subclip(
      flip.animations[0],
      'flipcore',
      34,
      104,
      30
    );
    actions.flip = mixer.clipAction(flipCore);
    actions.flip.setLoop(THREE.LoopOnce, 1);
    actions.flip.clampWhenFinished = true;
    actions.flip.timeScale = 2.9;
    actions.fall = mixer.clipAction(fall.animations[0]);
    // The hurt clip is optional (an older asset folder does not have it).
    try {
      const hurt = await loader.loadAsync('/assets/kai_hurt.glb');
      actions.hurt = mixer.clipAction(hurt.animations[0]);
      actions.hurt.setLoop(THREE.LoopOnce, 1);
      actions.hurt.clampWhenFinished = true;
      actions.hurt.timeScale = Math.max(1, hurt.animations[0].duration / 0.7);
    } catch {
      game.warnings.push('kai_hurt.glb not found; no hurt animation');
    }
    setAction('idle', 0);
    game.kai = 'model';
    game.boneNames = () => {
      const names = [];
      kai.traverse(o => {
        if (o.isBone) names.push(o.name);
      });
      return names;
    };
  } catch (err) {
    game.warnings.push('Kai model failed to load, using a capsule: ' + err);
    const cap = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 1.1, 4, 12),
      mat(0x3d6fd6)
    );
    cap.position.y = 0.85;
    cap.castShadow = true;
    kaiPose.add(cap);
    game.kai = 'capsule';
  }
}

// ---------- state, input ----------
let state = createState(COURSE);
let started = AUTOSTART;
let autopilotOn = BOT;
let botOptions = {}; // e.g. { doubleJump: false } to play like a player who forgets the air jump
const keys = new Set();
const banner = document.getElementById('banner');
// Where players tell us what broke: the link on the title screen, read once because the finish card replaces the banner.
const COMMUNITY_URL = document.getElementById('community')?.href || '';
const coinsEl = document.getElementById('coins');
const perfEl = document.getElementById('perf');
if (AUTOSTART) banner.hidden = true;

let paused = false;
let woke = false; // the title has had its first key or click (browsers only allow sound after one), so its music is playing
const pressEl = () => banner.querySelector('.press');
function wake() {
  if (woke) return;
  woke = true;
  audio.resume();
  const pe = pressEl();
  if (pe && !started) pe.textContent = 'Enter or Space to start';
}
function begin() {
  if (started) return;
  started = true;
  banner.hidden = true;
  audio.resume();
  audio.sfx('start');
}
// Travel between way-crystals: the panel that is open while the player chooses where to go.
const travel = { open: false, here: -1, list: [], sel: 0, pending: null };
const travelEl = document.getElementById('travel');
function drawTravel() {
  travelEl.hidden = !travel.open;
  if (!travel.open) return;
  const purse = state.coins - state.spent;
  travelEl.replaceChildren(
    el(
      'small',
      '',
      `Way-crystal · ${COURSE.checkpoints[travel.here].name || 'here'} · ${purse} coin${purse === 1 ? '' : 's'}`
    ),
    el(
      'div',
      'dest',
      `◀  ${COURSE.checkpoints[travel.list[travel.sel]].name}  ▶`
    ),
    el(
      'div',
      'how',
      purse >= PARAMS.travelCost
        ? 'Left / Right: choose · Enter: travel for 1 coin · Esc: stay'
        : 'You need a coin to travel · Esc: stay'
    )
  );
}
function openTravel() {
  const here = checkpointAt(state, COURSE);
  if (here < 0 || !state.onGround || state.status !== 'playing') return false;
  const list = neighbours(COURSE, here).filter(i => state.reached[i]);
  if (!list.length) {
    toast('No other way-crystal reached nearby yet');
    return true;
  }
  Object.assign(travel, { open: true, here, list, sel: 0 });
  keys.clear();
  drawTravel();
  return true;
}
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key))
    e.preventDefault();
  audio.resume(); // browsers only allow sound after a key press or click
  if (e.repeat) return;
  // By the letter on the key, not its position: on an AZERTY keyboard the M key is where QWERTY has the semicolon, so the
  // position code never matched and M did nothing.
  if (e.key === 'm' || e.key === 'M') {
    toast(audio.toggleMute() ? 'Sound off' : 'Sound on');
    return;
  }
  if (!started) {
    // The first key wakes the sound (the title's music starts); Enter or Space then starts the game.
    if (!woke) return wake();
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')
      begin();
    return;
  }
  if (travel.open) {
    if (e.code === 'Escape') travel.open = false;
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA')
      travel.sel = (travel.sel + travel.list.length - 1) % travel.list.length;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD')
      travel.sel = (travel.sel + 1) % travel.list.length;
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      travel.pending = travel.list[travel.sel];
      travel.open = false;
    }
    drawTravel();
    return;
  }
  if (
    (e.code === 'Enter' || e.code === 'NumpadEnter') &&
    state.status === 'playing' &&
    !paused &&
    openTravel()
  )
    return;
  if (state.status === 'complete') {
    if (e.code === 'Enter') {
      // Play again: reload straight into the level.
      const u = new URL(location.href);
      u.searchParams.set('autostart', '');
      location.href = u.toString();
    }
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    paused = !paused;
    banner.hidden = !paused;
    banner.classList.remove('title');
    if (paused) {
      banner.replaceChildren(
        el('div', 'big', 'Paused'),
        el('div', 'press', 'P to carry on'),
        el(
          'div',
          'keys',
          'WASD or arrows: move · Space: jump, and again in the air · E: take a vine bloom · X: pick up or set down a creature, wake a spring, or a gust · Enter at a way-crystal: travel · mouse drag, R / F, T / G: camera · M: sound'
        )
      );
    }
    return;
  }
  keys.add(e.code);
});
window.addEventListener('blur', () => keys.clear()); // a key held while the window loses focus must not stay down
function el(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}
const toastEl = document.getElementById('toast');
function toast(text, small) {
  toastEl.replaceChildren();
  if (small) toastEl.appendChild(el('small', '', small));
  toastEl.appendChild(document.createTextNode(text));
  toastEl.classList.add('show');
  feel.toastT = 2.6;
}
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  fx.resize(window.innerHeight, camera.fov);
});

// The footage switches to a side view along the boardwalk: Kai runs left to right. In S2 the camera blends to the side
// from just before the boardwalk; controls follow (left and right run along the course, depth is auto-centred).
let sideMix = 0;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// A free orbit camera: the player can look any way, and movement is relative to where the camera points. `camYaw` is the
// heading the camera looks along (0 = +Z, PI/2 = +X, the footage's side view). Until the player touches the camera it eases
// to the level's default (behind Kai in S1, the footage's side view from the boardwalk on). The camera is mostly automatic:
// when Kai keeps travelling in a direction that does not suit the view (toward or away from a side-on camera, say) it swings
// round so the travel reads well. R and F (the same physical keys on QWERTY and AZERTY) or a mouse drag take over; after four
// idle seconds the camera is handed back smoothly from wherever the player left it, and C hands it back at once.
let camYaw = 0;
let camUser = false;
let camAssist = 0; // how far the automatic camera has swung from the level's default heading
let camOffT = 0; // seconds Kai has travelled off the camera's grammar
let camIdle = 0; // seconds since the player last moved the camera
let dragging = false;
// The camera's tilt: 0 is the usual view; positive lifts the camera to look down, negative drops it to look up at the sky.
let camPitch = 0;
const PITCH_MIN = -0.4;
const PITCH_MAX = 0.95;
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const defaultYaw = () => sideMix * (Math.PI / 2);
window.addEventListener('pointerdown', e => {
  audio.resume();
  if (!started) return woke ? begin() : wake();
  if (e.button === 0 || e.button === 2) dragging = true;
});
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', e => {
  if (!dragging) return;
  camYaw = wrapPi(camYaw + e.movementX * 0.006);
  camPitch = Math.max(
    PITCH_MIN,
    Math.min(PITCH_MAX, camPitch + e.movementY * 0.004)
  ); // drag down: look from higher
  camUser = true;
  camIdle = 0;
});
window.addEventListener('contextmenu', e => e.preventDefault());
game.getCamYaw = () => camYaw;
game.getCamPitch = () => camPitch;
game.titleWoke = () => woke;
// Development: list the meshes of each generated island model (name, material, triangles, bounding box) so the ground can be told from the
// trees, ruins and rock.
game.listIslandMeshes = () => {
  const out = {};
  for (const name of ['island_a', 'island_b', 'island_c', 'island_d']) {
    if (!pieces[name]) continue;
    const m = normalise(pieces[name].clone(true), {
      dimension: 'width',
      size: 8,
      anchor: 'center',
    });
    m.updateMatrixWorld(true);
    const list = [];
    m.traverse(o => {
      if (!o.isMesh) return;
      const b = new THREE.Box3().setFromObject(o);
      const mat0 = Array.isArray(o.material) ? o.material[0] : o.material;
      list.push({
        name: o.name,
        material: mat0 && mat0.name,
        color: mat0 && mat0.color ? mat0.color.getHexString() : null,
        tris:
          (o.geometry.index
            ? o.geometry.index.count
            : o.geometry.attributes.position.count) / 3,
        box: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(
          v => +v.toFixed(2)
        ),
      });
    });
    out[name] = list;
  }
  return out;
};
// Development: sample the top surface of each generated island model (an N x N grid of downward rays, in the model's own units after
// normalisation to width 8) so tools/measure_islands.mjs can find its largest flat, walkable area.
game.measureIslands = (N = 40) => {
  const out = {};
  for (const name of ['island_a', 'island_b', 'island_c', 'island_d']) {
    if (!pieces[name]) continue;
    const m = normalise(pieces[name].clone(true), {
      dimension: 'width',
      size: 8,
      anchor: 'center',
    });
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const ray = new THREE.Raycaster();
    const up = []; // per cell: the heights of every upward-facing surface the ray crosses, highest first
    const nrm = new THREE.Vector3();
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x = box.min.x + ((ix + 0.5) / N) * (box.max.x - box.min.x);
        const z = box.min.z + ((iz + 0.5) / N) * (box.max.z - box.min.z);
        ray.set(
          new THREE.Vector3(x, box.max.y + 1, z),
          new THREE.Vector3(0, -1, 0)
        );
        const hs = [];
        for (const h of ray.intersectObject(m, true)) {
          if (!h.face) continue;
          nrm.copy(h.face.normal).transformDirection(h.object.matrixWorld);
          if (nrm.y > 0.5) hs.push(+h.point.y.toFixed(3));
        }
        up.push(hs);
      }
    }
    out[name] = {
      N,
      box: [
        box.min.x,
        box.min.y,
        box.min.z,
        box.max.x,
        box.max.y,
        box.max.z,
      ].map(v => +v.toFixed(3)),
      up,
    };
  }
  return out;
};
game.setCamYaw = yaw => {
  camYaw = wrapPi(yaw);
  camUser = true;
  camIdle = 0;
};
// A gamepad, if one is connected: left stick moves, A jumps, X or a shoulder button grapples, the right stick turns the camera.
function readPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    const dz = v => (Math.abs(v) < 0.22 ? 0 : v);
    const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    return {
      x: dz(gp.axes[0] || 0),
      y: dz(gp.axes[1] || 0),
      cam: dz(gp.axes[2] || 0),
      tilt: dz(gp.axes[3] || 0),
      jump: b(0),
      grapple: b(2) || b(4) || b(5),
      wave: b(1) || b(3),
      any: gp.buttons.some(q => q.pressed),
    };
  }
  return null;
}
let inputYaw = null; // camera heading latched while a direction key is held
function readInput() {
  const k = (...codes) => codes.some(c => keys.has(c));
  const pad = readPad();
  const grapple =
    k('KeyE', 'ShiftLeft', 'ShiftRight') || !!(pad && pad.grapple);
  const up = Math.max(
    -1,
    Math.min(
      1,
      (k('ArrowUp', 'KeyW') ? 1 : 0) -
        (k('ArrowDown', 'KeyS') ? 1 : 0) -
        (pad ? pad.y : 0)
    )
  );
  const rt = Math.max(
    -1,
    Math.min(
      1,
      (k('ArrowRight', 'KeyD') ? 1 : 0) -
        (k('ArrowLeft', 'KeyA') ? 1 : 0) +
        (pad ? pad.x : 0)
    )
  );
  // Camera-relative world direction: forward is the way the camera looks, right is the screen's right. The mapping is
  // latched to the camera heading when a direction is first pressed and kept while any is held, so an automatic camera swing
  // never changes what the keys mean under the player's finger.
  if (up === 0 && rt === 0) inputYaw = null;
  else if (inputYaw === null) inputYaw = camYaw;
  const yaw = inputYaw === null ? camYaw : inputYaw;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  let dx = up * fx + rt * -fz;
  let dz = up * fz + rt * fx;
  const len = Math.hypot(dx, dz);
  if (len > 1) {
    dx /= len;
    dz /= len;
  }
  // The logic's input is fwd along +Z and right toward world -X.
  return {
    fwd: dz,
    right: -dx,
    jump: k('Space') || !!(pad && pad.jump),
    wave: k('KeyX', 'KeyK') || !!(pad && pad.wave),
    travelTo: (() => {
      const to = travel.pending;
      travel.pending = null;
      return to;
    })(),
    grapple,
  };
}

function onEvents(events) {
  const kx = state.x;
  const ky = state.y;
  const kz = state.z;
  for (const e of events) {
    if (e === 'coin') {
      state.collected.forEach((c, i) => {
        if (!c) return;
        const k = COURSE.coins[i];
        if (COIN_BATCH) {
          if (coinPop[i] >= 0) return;
          coinPop[i] = 0;
        } else {
          if (!coinMeshes[i].visible) return;
          coinMeshes[i].visible = false;
        }
        fx.burst(k.x, k.y, k.z, { n: 10, speed: 3.6, life: 0.45 }); // the video's gold flash on a pickup
      });
      audio.sfx('coin');
      feel.bumpT = 0.14;
    } else if (e === 'gem') {
      fx.burst(kx, ky + 1, kz, {
        n: 28,
        color: 0x5ff5e6,
        speed: 6,
        life: 0.9,
        size: 0.34,
        gravity: 3,
      });
      fx.ring(kx, ky + 1, kz, { color: 0x9ffff4, speed: 7, n: 20 });
      audio.sfx('gem');
      feel.gemBumpT = 0.2;
      toast(`${state.gems} / ${COURSE.gems.length}`, 'Sky gem');
    } else if (e === 'key') {
      fx.burst(kx, ky + 1, kz, { n: 22, speed: 5, life: 0.8 });
      audio.sfx('key');
      toast('The gate opens', 'Lantern key');
      openGates();
    } else if (e === 'jump') {
      if (actions.jump) {
        actions.jump.reset();
        setAction('jump', 0.08);
      }
      fx.puff(kx, ky, kz, { n: 5, speed: 1.6, size: 0.4 });
      feel.squashV += 4.5;
      audio.sfx('jump');
    } else if (e === 'doublejump') {
      // A dedicated flip clip is used if present; otherwise the jump clip restarts.
      const name = actions.flip ? 'flip' : 'jump';
      if (actions[name]) {
        actions[name].reset();
        setAction(name, 0.05, true);
      }
      fx.ring(kx, ky + 0.2, kz, { speed: 4.5 });
      feel.squashV += 3;
      audio.sfx('doublejump');
    } else if (e === 'land' && streamAt(kx, ky, kz)) {
      const hard = Math.max(0, Math.min(1, -feel.lastVy / 20));
      fx.splash(kx, ky, kz, {
        n: Math.round(10 + hard * 14),
        speed: 3.4 + hard * 2.5,
        size: 0.24,
      });
      feel.squashV -= 2.5 + hard * 5;
      audio.sfx('splash', 0.6 + hard * 0.4);
    } else if (e === 'land') {
      const hard = Math.max(0, Math.min(1, -feel.lastVy / 20)); // 0 a step down, 1 a long fall
      fx.puff(kx, ky, kz, {
        n: Math.round(4 + hard * 10),
        speed: 1.6 + hard * 2.4,
        size: 0.4 + hard * 0.3,
      });
      if (hard > 0.45)
        fx.burst(kx, ky + 0.1, kz, {
          n: Math.round(hard * 12),
          speed: 3,
          life: 0.4,
          size: 0.2,
          up: 2.5,
        }); // the video's golden burst at his feet
      feel.squashV -= 2.5 + hard * 5;
      if (hard > 0.7) feel.shake = Math.max(feel.shake, 0.1);
      audio.sfx('land', hard);
    } else if (e === 'spring') {
      {
        let best = null;
        let bestD = Infinity;
        for (const pad of springPads) {
          const d = Math.hypot(pad.x - state.x, pad.z - state.z);
          if (d < bestD) {
            best = pad;
            bestD = d;
          }
        }
        if (best) best.t = 0.3;
      }
      fx.burst(kx, ky, kz, { n: 18, speed: 4, life: 0.6, up: 5 });
      fx.puff(kx, ky - 0.4, kz, { n: 8, speed: 3 });
      feel.squashV += 7;
      feel.shake = Math.max(feel.shake, 0.06);
      audio.sfx('spring');
      game.lastEvent = 'spring';
    } else if (e === 'hurt') {
      fx.burst(kx, ky + 1, kz, {
        n: 16,
        color: 0xff5a7a,
        speed: 5,
        life: 0.5,
      });
      if (actions.hurt) {
        actions.hurt.reset();
        setAction('hurt', 0.05, true);
      }
      feel.hurtFlash = 1;
      feel.shake = Math.max(feel.shake, 0.22);
      feel.hitStop = 0.06;
      audio.sfx('hurt');
      game.lastEvent = 'hurt';
    } else if (e === 'respawn') {
      feel.whiteFlash = 1;
      feel.fallWhistled = false;
      fx.puff(kx, ky + 0.2, kz, {
        n: 16,
        speed: 3,
        size: 0.7,
        color: 0xffffff,
      });
      fx.ring(kx, ky + 0.3, kz, { color: 0x9ffff4 });
      audio.sfx('respawn');
      game.lastEvent = 'respawn';
    } else if (e === 'checkpoint') {
      lightCheckpoint(state.checkpoint);
      const m = cpMarks.pos[state.checkpoint];
      if (m) {
        fx.ring(m.x, m.y + 1.85, m.z, { color: 0x4ff2e0, speed: 3.5, n: 14 });
        fx.burst(m.x, m.y + 1.85, m.z, {
          n: 8,
          color: 0x4ff2e0,
          speed: 2.5,
          life: 0.6,
          gravity: 1,
        });
      }
      audio.sfx('checkpoint');
    } else if (e === 'stomp') {
      fx.burst(kx, ky, kz, {
        n: 34,
        color: 0xb98bff,
        speed: 7,
        life: 0.8,
        size: 0.36,
      });
      fx.ring(kx, ky, kz, { color: 0xffffff, speed: 8, n: 22 });
      feel.hitStop = 0.09;
      feel.shake = Math.max(feel.shake, 0.25);
      feel.squashV += 5;
      audio.sfx('stomp');
      if (Object.keys(state.keysHeld).length) {
        toast('The citadel gate opens', 'Guardian defeated');
        openGates();
      }
    } else if (e === 'grapple') {
      audio.sfx('grapple');
      feel.ropeT = 0; // the golden beam reaches for the anchor before the rope pulls taut
      feel.ropeHit = false;
    } else if (e === 'wave') {
      feel.waveT = 0.34;
      fx.cone(
        kx + Math.sin(state.yaw) * 0.55,
        ky + 1.15,
        kz + Math.cos(state.yaw) * 0.55,
        state.yaw
      );
      feel.squashV += 1.5;
      audio.sfx('wave');
    } else if (e === 'banish') {
      // The gust dazes brambles (it does not remove them).
      for (const i of state.lastWave) {
        const ep = enemyPos(COURSE.enemies[i], state.t);
        fx.burst(ep.x, ep.y, ep.z, {
          n: 12,
          color: 0xfff3a0,
          speed: 4,
          life: 0.5,
        });
      }
      audio.sfx('banish');
      feel.shake = Math.max(feel.shake, 0.05);
    } else if (e === 'vinecatch') {
      feel.snap.set(
        kaiRoot.position.x - kx,
        kaiRoot.position.y - ky,
        kaiRoot.position.z - kz
      );
      const hp = hangPoint();
      fx.burst(hp.x, hp.y, hp.z, {
        n: 14,
        color: 0x8fe36a,
        color2: 0xffb6d2,
        speed: 3,
        life: 0.7,
        gravity: 3,
      });
      feel.shake = Math.max(feel.shake, 0.12);
      feel.fallWhistled = false;
      audio.sfx('vinecatch');
    } else if (e === 'mount') {
      fx.puff(kx, ky, kz, { n: 6, speed: 1.6 });
      audio.sfx('land', 0.4);
    } else if (e === 'climb') {
      feel.climbT = (feel.climbT || 0) + PARAMS.dt;
      if (feel.climbT > 0.28) {
        feel.climbT = 0;
        audio.sfx('step', 1);
        fx.mote(kx, ky + 1.6, kz, { color: 0x8fe36a, life: 0.5, vy: -0.6 });
      }
    } else if (e === 'catch') {
      const c = state.creatures[state.lastCaught];
      fx.ring(kx, ky + 1, kz, { color: 0xbfeaff, speed: 3, n: 12 });
      audio.sfx('catch');
      toast(
        habitatOk(state, COURSE, c.species, state.standing)
          ? 'It lives here: X sets it down'
          : `It needs ${HABITAT_WORDS[SPECIES[c.species].habitat]}`,
        `A ${c.species}`
      );
    } else if (e === 'rehome') {
      fx.burst(kx, ky + 0.6, kz, {
        n: 26,
        color: 0xff9fc6,
        color2: 0xfff3a0,
        speed: 4.5,
        life: 0.9,
        gravity: 2,
      });
      fx.ring(kx, ky + 0.3, kz, { color: 0xff9fc6, speed: 5, n: 18 });
      audio.sfx('rehome');
      toast(`${state.rehomed} of ${state.toRehome} rehomed`, 'Home');
    } else if (e === 'release') {
      audio.sfx('release');
      toast('It is not at home here', 'Set down');
    } else if (e === 'kit') {
      const k = state.creatures[state.creatures.length - 1];
      fx.burst(k.x, creatureY(COURSE, k, state.t) + 0.4, k.z, {
        n: 16,
        color: 0xff9fc6,
        speed: 3,
        life: 0.9,
        gravity: 1,
      });
      if (Math.hypot(k.x - kx, k.z - kz) < 60) {
        audio.sfx('rehome');
        toast(`A ${k.species} kit is born`, 'New life');
      }
    } else if (e === 'travel') {
      feel.snap.set(0, 0, 0);
      feel.whiteFlash = 0.6;
      fx.ring(kx, ky + 0.3, kz, { color: 0x4ff2e0, speed: 5, n: 20 });
      audio.sfx('travel');
      camera.position.set(
        kx - Math.sin(camYaw) * 6,
        ky + 3.2,
        kz - Math.cos(camYaw) * 6
      );
    } else if (e === 'travel-refused') {
      toast('You need a coin to travel');
    } else if (e === 'spring-awake') {
      const sp = COURSE.streams[state.lastSpring].spring;
      fx.splash(sp.x, ky, sp.z, { n: 30, speed: 6, size: 0.3 });
      fx.ring(sp.x, ky + 0.2, sp.z, { color: 0x9fe8ff, speed: 6, n: 22 });
      audio.sfx('spring-awake');
      toast('The stream runs again', 'Spring woken');
    } else if (e === 'spring-needs-gem') {
      toast('A dry spring: it needs a sky gem');
    } else if (e === 'waveblock') {
      const gi = COURSE.enemies.findIndex(q => q.stomp);
      if (gi >= 0) {
        const ep = enemyPos(COURSE.enemies[gi], state.t);
        fx.ring(ep.x, ep.y, ep.z, { color: 0xb98bff, speed: 6, n: 20 });
      }
      audio.sfx('block');
      toast('Land on it from above', 'The guardian shrugs it off');
    } else if (e === 'release') {
      audio.sfx('release');
      feel.squashV += 3;
    } else if (e === 'complete') {
      audio.sfx('complete');
      audio.music(7);
      feel.celebrate = 0.001;
      showFinish();
    }
  }
}

// Gates whose key is now held: a burst where the barrier was, once.
const gatesOpened = new Set();
function openGates() {
  for (const g of gatesOf(COURSE)) {
    if (!state.keysHeld[g.key] || gatesOpened.has(g.id)) continue;
    gatesOpened.add(g.id);
    for (const dx of [-2.5, 0, 2.5])
      fx.burst(dx, (g.y ?? 0) + 1.6, g.z, {
        n: 14,
        color: 0xb98bff,
        speed: 4,
        life: 0.9,
        gravity: 2,
      });
    audio.sfx('gate');
  }
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const r = sec - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

// The finish card: time, coins, gems and falls, and one star each for most of the coins, most of the gems and few falls.
function showFinish() {
  const gemsTotal = (COURSE.gems || []).length;
  // One star each for rehoming most of the creatures, finding most of the gems, and few slips and falls. (The older single
  // sections have no creatures: their first star is for coins, as before.)
  const stars =
    (state.toRehome
      ? state.rehomed >= Math.ceil(state.toRehome * 0.6)
        ? 1
        : 0
      : state.coins >= COURSE.coins.length * 0.6
        ? 1
        : 0) +
    (gemsTotal ? (state.gems >= Math.ceil(gemsTotal * 0.55) ? 1 : 0) : 1) +
    (state.deaths + state.slips <= 3 ? 1 : 0);
  const card = el('div', 'card');
  card.appendChild(
    el(
      'div',
      'rank',
      WORLD ? 'Steward of the citadel grounds' : 'Section complete'
    )
  );
  const st = el('div', 'stars');
  for (let i = 0; i < 3; i++)
    st.appendChild(i < stars ? document.createTextNode('★') : el('i', '', '★'));
  card.appendChild(st);
  const table = document.createElement('table');
  const row = (a, b) => {
    const tr = document.createElement('tr');
    tr.append(el('td', '', a), el('td', '', b));
    table.appendChild(tr);
  };
  row('Time', fmtTime(state.t));
  row('Coins', `${state.coins} / ${COURSE.coins.length}`);
  if (gemsTotal) row('Sky gems', `${state.gems} / ${gemsTotal}`);
  if (state.toRehome)
    row('Creatures rehomed', `${state.rehomed} / ${state.toRehome}`);
  if (COURSE.streams)
    row(
      'Springs woken',
      `${state.gemsSpent} / ${COURSE.streams.filter(q => q.dry).length}`
    );
  row('Slips and falls', `${state.slips} / ${state.deaths}`);
  card.appendChild(table);
  if (WORLD)
    card.appendChild(
      el('div', 'next', 'The citadel doors open. Next: inside the citadel.')
    );
  card.appendChild(el('div', 'press', 'Enter to play again'));
  if (WORLD && COMMUNITY_URL) {
    const c = el('div', 'community', 'A work in progress. ');
    const link = el('a', '', 'Tell us what you thought, in Discord');
    link.href = COMMUNITY_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    c.appendChild(link);
    card.appendChild(c);
  }
  banner.replaceChildren(card);
  banner.classList.remove('title');
  banner.classList.add('finish');
  banner.hidden = false;
  toastEl.classList.remove('show');
}

function stepOnce() {
  const input = autopilotOn
    ? WORLD
      ? pilot(state, COURSE, { route: ROUTE, ...botOptions })
      : COURSE.routes
        ? navigate(state, COURSE, COURSE.routes[ROUTE], botOptions)
        : autopilot(state, COURSE, botOptions)
    : readInput();
  feel.lastVy = state.vy;
  step(state, input, COURSE);
  if (state.events.length) onEvents(state.events);
}

// ---------- feel, every frame: Kai's squash and lean, his trail and footsteps, the landing ring, flashes, toasts and the HUD ----------
const coinsTotal = COURSE.coins.length;
const hudEl = document.getElementById('hud');
const tipEl = document.getElementById('tip');
const clockEl = document.getElementById('clock');
const clockT = document.getElementById('clockT');
const flashEl = document.getElementById('flash');
const hurtEl = document.getElementById('hurt');
function updateFeel(dtRaw, t) {
  const dt = Math.min(dtRaw, 1 / 30);
  const speed = Math.hypot(state.vx, state.vz);
  const playing = started && state.status === 'playing';
  // Squash and stretch: a damped spring around 1, kicked by jumps, landings and pads.
  feel.squashV += (-190 * (feel.squash - 1) - 15 * feel.squashV) * dt;
  feel.squash = Math.max(0.6, Math.min(1.45, feel.squash + feel.squashV * dt));
  const sq = feel.squash;
  kaiPose.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  // Lean into the run and bank into turns (not while hanging from a rope or a rail, where the arms are posed).
  const hanging = !!state.rope || !!state.rail;
  const wantLean = hanging
    ? 0
    : state.onGround
      ? (speed / PARAMS.runSpeed) * 0.14
      : Math.max(-0.2, Math.min(0.24, -state.vy * 0.012));
  const dyaw = wrapPi(state.yaw - feel.prevYaw) / Math.max(dt, 1e-3);
  feel.prevYaw = state.yaw;
  const wantBank =
    hanging || !state.onGround
      ? 0
      : Math.max(-0.28, Math.min(0.28, dyaw * 0.035));
  const k = 1 - Math.exp(-10 * dt);
  feel.lean += (wantLean - feel.lean) * k;
  feel.bank += (wantBank - feel.bank) * k;
  kaiPose.rotation.x = feel.lean;
  kaiPose.rotation.z = -feel.bank;
  feel.waveT = Math.max(0, feel.waveT - dt);
  grassU.uTime.value = t;
  grassU.uKai.value.set(state.x, state.y, state.z);
  // Blink while he cannot be hurt (after a hit, and for a moment after returning to a checkpoint).
  kaiPose.visible = !(state.hurtCd > 0 && Math.floor(t * 14) % 2 === 0);
  if (playing) {
    // Footsteps: a tick and a wisp of dust on every stride.
    if (state.onGround && speed > 2.5) {
      feel.stepT += (dt * speed) / PARAMS.runSpeed;
      if (feel.stepT > 0.29) {
        feel.stepT = 0;
        feel.stepAlt = !feel.stepAlt;
        if (streamAt(state.x, state.y, state.z)) {
          // Running through a stream: water flies and the step is a splash.
          fx.splash(state.x, state.y, state.z, { n: 7 });
          audio.sfx('splash', 0.35);
        } else {
          audio.sfx('step', feel.stepAlt ? 1 : 0);
          fx.puff(state.x, state.y, state.z, {
            n: 2,
            speed: 0.9,
            size: 0.28,
            alpha: 0.35,
            life: 0.4,
          });
        }
      }
    } else feel.stepT = 0.2;
    // The golden trail behind a leap (the video), brighter off a pad; teal sparks from his hands on the rail.
    if (!state.onGround && !hanging && (speed > 4 || state.vy > 6))
      fx.mote(state.x, state.y + 0.5, state.z, {
        life: state.springUp ? 0.8 : 0.45,
      });
    if (state.rail)
      fx.mote(state.x, state.y + PARAMS.hangReach, state.z, {
        color: 0x7ffff0,
        spread: 0.1,
        life: 0.35,
        vy: -1,
      });
    // A falling whistle once he is clearly below everything.
    if (state.y < -6.5 && state.vy < -8 && !feel.fallWhistled) {
      feel.fallWhistled = true;
      audio.sfx('fall');
    }
    if (state.onGround) feel.fallWhistled = false;
  }
  audio.setGrind(!!state.rail && playing);
  audio.setWind(
    playing && !state.onGround ? Math.hypot(speed, state.vy) / 22 : 0.04
  );
  // The landing ring.
  let ring = false;
  if (playing && !state.onGround && !hanging) {
    const hit = surfaceBelow(
      COURSE,
      state.x,
      state.z,
      state.y + 0.2,
      0.15,
      state.t
    );
    if (hit && state.y - hit.h > 0.4) {
      ring = true;
      const h = state.y - hit.h;
      landRing.position.set(state.x, hit.h + 0.05, state.z);
      landRing.scale.setScalar(1 + Math.min(1.4, h * 0.14));
      landRing.material.opacity = 0.3 + 0.35 * Math.min(1, h / 3);
    }
  }
  landRing.visible = ring;
  // The contact shadow.
  {
    const hit = surfaceBelow(
      COURSE,
      state.x,
      state.z,
      state.y + 0.3,
      0.15,
      state.t
    );
    blob.visible = !!hit && !state.rail;
    if (hit) {
      const h = Math.max(0, state.y - hit.h);
      blob.position.set(state.x, hit.h + 0.045, state.z);
      blob.scale.setScalar(1.25 - Math.min(0.55, h * 0.09));
      blob.material.opacity = 0.8 * Math.max(0.12, 1 - h / 7);
    }
  }
  // Named areas: a title as each is entered, and the music builds along the road.
  if (playing && COURSE.areas) {
    const idx = COURSE.areas.findIndex(a => state.z >= a.z0 && state.z < a.z1);
    if (idx >= 0 && idx !== feel.area) {
      feel.area = idx;
      toast(COURSE.areas[idx].name, `Act ${idx + 1}`);
      audio.sfx('area');
      audio.music(idx + 1); // each act has its own arrangement of the tune
    }
  } else if (playing && feel.area < 0) {
    feel.area = 0;
    audio.music(1);
  } else if (!started && woke) audio.music(0);
  // The finish: confetti and a hop.
  if (state.status === 'complete') {
    feel.celebrate += dt;
    feel.confettiT -= dt;
    if (feel.confettiT <= 0 && feel.celebrate < 6) {
      feel.confettiT = 0.45;
      const a = feel.celebrate * 2.4;
      fx.confetti(
        state.x + Math.cos(a) * 2.5,
        state.y + 1.2,
        state.z + Math.sin(a) * 2.5,
        36
      );
    }
    kaiPose.position.y = Math.abs(Math.sin(feel.celebrate * 4.2)) * 0.55;
    if (
      actions.flip &&
      Math.floor(feel.celebrate / 1.5) !==
        Math.floor((feel.celebrate - dt) / 1.5)
    ) {
      actions.flip.reset();
      setAction('flip', 0.05, true);
    }
  } else kaiPose.position.y = 0;
  fx.update(dt);
  // Flashes and the toast.
  feel.whiteFlash = Math.max(0, feel.whiteFlash - dt * 2.6);
  feel.hurtFlash = Math.max(0, feel.hurtFlash - dt * 1.8);
  flashEl.style.opacity = (feel.whiteFlash * 0.75).toFixed(3);
  hurtEl.style.opacity = feel.hurtFlash.toFixed(3);
  if (feel.toastT > 0) {
    feel.toastT -= dtRaw;
    if (feel.toastT <= 0) toastEl.classList.remove('show');
  }
  feel.bumpT = Math.max(0, feel.bumpT - dtRaw);
  feel.gemBumpT = Math.max(0, feel.gemBumpT - dtRaw);
  // The counters (rebuilt only when something changed).
  const held = Object.keys(state.keysHeld);
  const key = `${state.coins}|${state.spent}|${state.gems}|${state.hearts}|${held.join()}|${state.deaths}|${state.slips}|${state.rehomed}|${state.carry}|${feel.bumpT > 0}|${feel.gemBumpT > 0}`;
  if (key !== feel.hudKey) {
    feel.hudKey = key;
    const parts = [];
    const stat = (bump, icon, n, total) => {
      const sp = el('span', 'stat' + (bump ? ' bump' : ''));
      sp.appendChild(el('span', icon));
      sp.appendChild(document.createTextNode(String(n)));
      sp.appendChild(el('small', '', `/ ${total}`));
      return sp;
    };
    parts.push(
      stat(feel.bumpT > 0, 'ico-coin', state.coins - state.spent, coinsTotal)
    ); // what he has to spend
    if (COURSE.gems)
      parts.push(
        stat(feel.gemBumpT > 0, 'ico-gem', state.gems, COURSE.gems.length)
      );
    if (COURSE.enemies) {
      const h = el('span', 'hearts');
      for (let i = 0; i < PARAMS.hearts; i++)
        h.appendChild(
          i < state.hearts ? document.createTextNode('♥') : el('i', '', '♥')
        );
      parts.push(h);
    }
    for (const id of held)
      parts.push(
        el('span', 'keytag', id === 'key' ? 'KEY' : `${id.toUpperCase()} KEY`)
      );
    if (COURSE.key && !held.length)
      parts.push(el('span', 'keytag', 'FIND THE KEY'));
    if (state.toRehome)
      parts.push(
        el('span', 'steward', `Rehomed ${state.rehomed} / ${state.toRehome}`)
      );
    if (state.carry >= 0)
      parts.push(
        el(
          'span',
          'keytag',
          `CARRYING A ${state.creatures[state.carry].species.toUpperCase()}`
        )
      );
    if (state.slips) parts.push(el('small', '', `Slips ${state.slips}`));
    if (state.deaths) parts.push(el('small', '', `Falls ${state.deaths}`));
    coinsEl.replaceChildren(...parts);
  }
  // A tip at the bottom of the screen where a move is first needed.
  let tip = '';
  if (playing && COURSE.tips) {
    const hit = COURSE.tips.find(
      q =>
        state.z >= q.z0 &&
        state.z < q.z1 &&
        Math.abs(state.x - (q.x ?? 0)) < (q.w ?? 7) &&
        (!q.until || !q.until(state))
    );
    if (hit) tip = hit.text;
  }
  // What Kai is doing right now comes first: hanging from the vines, carrying a creature, standing at a way-crystal.
  if (playing && state.hang)
    tip =
      "The island's vines caught you: hold a direction or Space to climb back";
  else if (playing && state.carry >= 0) {
    const c = state.creatures[state.carry];
    tip = habitatOk(state, COURSE, c.species, state.standing)
      ? `This is a home for the ${c.species}: X sets it down`
      : `The ${c.species} needs ${HABITAT_WORDS[SPECIES[c.species].habitat]} · X sets it down`;
  } else if (playing && !tip && state.onGround) {
    const here = checkpointAt(state, COURSE);
    if (here >= 0 && neighbours(COURSE, here).some(i => state.reached[i]))
      tip =
        'Enter: travel from this way-crystal to another you have reached (1 coin)';
  }
  if (tip !== feel.tip) {
    feel.tip = tip;
    if (tip) tipEl.textContent = tip;
    tipEl.classList.toggle('show', !!tip);
  }
  hudEl.hidden = !started;
  const ck = started ? fmtTime(state.t) : '';
  if (ck !== feel.clockKey) {
    feel.clockKey = ck;
    clockEl.hidden = !started;
    clockT.textContent = ck;
  }
}

// ---------- living creatures ----------
function emoteTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.beginPath();
  g.arc(32, 30, 26, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(24, 52);
  g.lineTo(32, 63);
  g.lineTo(40, 52);
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 34px system-ui, sans-serif';
  if (kind === 'eat') {
    g.fillStyle = '#4fae27';
    g.beginPath();
    g.ellipse(32, 30, 9, 17, 0.6, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'play') {
    g.fillStyle = '#ff6fa3';
    g.fillText('♥', 32, 32);
  } else if (kind === 'rest') {
    g.fillStyle = '#5a6fb8';
    g.font = 'bold 24px system-ui, sans-serif';
    g.fillText('z z', 32, 30);
  } else if (kind === 'flee') {
    g.fillStyle = '#e0502a';
    g.fillText('!', 32, 31);
  } else {
    // mope: out of place
    g.fillStyle = '#3f8fd8';
    g.fillText('?', 32, 31);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const emoteTex = {};
function makeCreature(c) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupil = new THREE.MeshBasicMaterial({ color: 0x1c1826 });
  const eyes = (y, z, gap, r) => {
    for (const ex of [-gap, gap]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), white);
      eye.position.set(ex, y, z);
      const pu = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.55, 6, 5),
        pupil
      );
      pu.position.set(ex, y, z + r * 0.6);
      body.add(eye, pu);
    }
  };
  if (c.species === 'hopper') {
    // The orange fox-rabbit of the reference sheet (the Glint Hopper).
    const fur = mat(0xf08a3c, { emissive: 0x7a3a10, emissiveIntensity: 0.35 });
    const pale = mat(0xffe2c0, { emissive: 0x806040, emissiveIntensity: 0.3 });
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), fur);
    torso.scale.set(1, 0.9, 1.25);
    torso.position.y = 0.3;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), pale);
    belly.position.set(0, 0.24, 0.16);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), fur);
    head.position.set(0, 0.56, 0.24);
    body.add(torso, belly, head);
    for (const ex of [-0.09, 0.09]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 6), fur);
      ear.position.set(ex, 0.88, 0.18);
      ear.rotation.z = -ex * 3;
      ear.rotation.x = -0.25;
      body.add(ear);
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), pale);
    tail.position.set(0, 0.3, -0.38);
    body.add(tail);
    eyes(0.6, 0.4, 0.08, 0.045);
  } else if (c.species === 'dewling') {
    // The blue leafy orb of the video.
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 16, 12),
      mat(0x58c0ff, {
        emissive: 0x1d6fb3,
        emissiveIntensity: 0.7,
        roughness: 0.3,
      })
    );
    ball.position.y = 0.4;
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.42, 6),
      mat(0x4fd16a)
    );
    leaf.position.set(0.06, 0.82, 0);
    leaf.rotation.z = -0.5;
    body.add(ball, leaf);
    eyes(0.46, 0.3, 0.12, 0.07);
  } else {
    // The sprout: a small green creature with leaf antennae.
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 12, 10),
      mat(0x6fd66f, { emissive: 0x1f7a33, emissiveIntensity: 0.55 })
    );
    ball.scale.y = 0.85;
    ball.position.y = 0.24;
    body.add(ball);
    for (const ex of [-0.1, 0.1]) {
      const ant = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.3, 5),
        mat(0x3fbf5a)
      );
      ant.position.set(ex, 0.55, 0);
      ant.rotation.z = -ex * 4;
      body.add(ant);
    }
    eyes(0.28, 0.22, 0.08, 0.05);
  }
  {
    const one = bake(body);
    body.clear();
    body.add(one);
  }
  const emote = new THREE.Sprite(
    new THREE.SpriteMaterial({ transparent: true, depthWrite: false })
  );
  emote.scale.set(0.55, 0.55, 1);
  emote.position.y = 1.25;
  emote.visible = false;
  g.add(emote);
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0xbfeaff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    })
  );
  bubble.position.y = 0.4;
  bubble.visible = false;
  g.add(bubble);
  if (c.kit) g.scale.setScalar(0.55);
  scene.add(g);
  return { g, body, emote, bubble, mood: '' };
}
// Flowers that grow where a creature left a seed (one batch).
const FLOWER_MAX = 40;
let flowerBatch = null;
function updateLife(dt, t) {
  const cs = state.creatures || [];
  while (world.creatures.length < cs.length)
    world.creatures.push(makeCreature(cs[world.creatures.length])); // kits arrive
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const v = world.creatures[i];
    if (c.carried) {
      // In a soft bubble over Kai's raised hand.
      v.g.visible = true;
      v.g.position.set(
        kaiRoot.position.x,
        kaiRoot.position.y + 2.05 + Math.sin(t * 3) * 0.05,
        kaiRoot.position.z
      );
      v.g.rotation.y = t * 1.2;
      v.bubble.visible = true;
      v.emote.visible = false;
      v.body.position.y = 0;
      continue;
    }
    v.bubble.visible = false;
    const near = (c.x - state.x) ** 2 + (c.z - state.z) ** 2 < 95 * 95;
    v.g.visible = near;
    if (!near) continue;
    const gy = creatureY(COURSE, c, state.t);
    const hop =
      c.species === 'hopper'
        ? Math.abs(Math.sin(c.ph)) * 0.22
        : c.species === 'dewling'
          ? 0.28 + Math.sin(t * 2 + i) * 0.08
          : Math.abs(Math.sin(c.ph * 1.4)) * 0.06;
    v.g.position.set(c.x, gy, c.z);
    v.body.position.y = c.mood === 'rest' ? 0 : hop;
    v.body.scale.y = c.mood === 'rest' ? 0.8 : c.mood === 'mope' ? 0.9 : 1;
    if (c.yaw !== undefined)
      v.g.rotation.y +=
        wrapPi(c.yaw - v.g.rotation.y) * (1 - Math.exp(-8 * dt));
    // What it is doing, in a small bubble over it: only the readable moments (and always when it is out of place).
    const show =
      c.mood === 'mope' ||
      c.mood === 'eat' ||
      c.mood === 'rest' ||
      c.mood === 'flee' ||
      c.mood === 'play'
        ? c.mood
        : '';
    if (show !== v.mood) {
      v.mood = show;
      v.emote.visible = !!show;
      if (show) {
        v.emote.material.map =
          emoteTex[show] || (emoteTex[show] = emoteTexture(show));
        v.emote.material.needsUpdate = true;
      }
    }
    if (show)
      v.emote.position.y = (c.kit ? 1.9 : 1.2) + Math.sin(t * 2.5 + i) * 0.05;
  }
  // Flowers.
  const seeds = state.seeds || [];
  if (seeds.length && !flowerBatch) {
    const stem = new THREE.CylinderGeometry(0.02, 0.025, 0.3, 5);
    stem.translate(0, 0.15, 0);
    const head = new THREE.SphereGeometry(0.1, 8, 6);
    head.scale(1, 0.6, 1);
    head.translate(0, 0.33, 0);
    flowerBatch = new THREE.InstancedMesh(
      mergeGeometries([stem, head]),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      FLOWER_MAX
    );
    flowerBatch.frustumCulled = false;
    flowerBatch.count = 0;
    course.add(flowerBatch);
  }
  if (flowerBatch) {
    const m4 = _coin.m;
    const tint = new THREE.Color();
    flowerBatch.count = Math.min(seeds.length, FLOWER_MAX);
    for (let i = 0; i < flowerBatch.count; i++) {
      const sd = seeds[i];
      const k = Math.min(1, (state.t - sd.t) / 5); // five seconds to grow
      _coin.p.set(sd.x, creatureY(COURSE, sd, state.t) - 0.02, sd.z);
      _coin.q.identity();
      _coin.s.setScalar(0.2 + k * 1.1);
      m4.compose(_coin.p, _coin.q, _coin.s);
      flowerBatch.setMatrixAt(i, m4);
      flowerBatch.setColorAt(
        i,
        tint.set([0xff8fb8, 0xffd45a, 0xffffff, 0xb98bff][i % 4])
      );
    }
    flowerBatch.instanceMatrix.needsUpdate = true;
    if (flowerBatch.instanceColor) flowerBatch.instanceColor.needsUpdate = true;
  }
  // Springs: flowing or dry; a flowing one wells up.
  for (const sp of world.springs) {
    const on = state.springs[sp.i];
    sp.wet.visible = on;
    sp.bed.visible = !on;
    if (
      on &&
      Math.random() < 0.25 &&
      (sp.x - state.x) ** 2 + (sp.z - state.z) ** 2 < 50 * 50
    )
      fx.splash(sp.x, sp.y + 0.05, sp.z, { n: 2, speed: 1.6, size: 0.14 });
  }
  // Blooms open when Kai is within their reach.
  for (const b of world.blooms) {
    const d = Math.hypot(
      b.a.x - state.x,
      b.a.y - (state.y + PARAMS.handHeight),
      b.a.z - state.z
    );
    const want =
      d <= b.a.range && !state.onGround ? 1 : d <= b.a.range ? 0.6 : 0;
    b.open += (want - b.open) * (1 - Math.exp(-6 * dt));
    b.petals.scale.setScalar(1 + b.open * 0.7);
    b.halo.material.opacity = 0.3 + b.open * 0.55;
    b.g.rotation.y = t * 0.3;
  }
}

// Things that move on their own: the flowing river, the goal's beam, the distant flyers and the drifting cloud sea.
function updateAmbient(dt, t) {
  updateLife(dt, t);
  ambient.update(t, camera, window.innerHeight, camera.fov);
  for (const f of world.flows || []) {
    if (f.axis === 'x') f.tex.offset.x = -(t * f.v) % 1;
    else f.tex.offset.y = -(t * f.v) % 1;
  }
  // Spray at the lip of the nearest waterfalls, and their roar by distance.
  let nearest = Infinity;
  feel.sprayT -= dt;
  for (const st of world.streams || []) {
    if (!state.springs[st.i]) continue; // a dry spring has no fall
    const d = Math.hypot(st.lip - state.x, st.cz - state.z, st.y - state.y);
    nearest = Math.min(nearest, d);
    if (d < 60 && feel.sprayT <= 0) {
      fx.puff(
        st.lip + st.side * 0.5,
        st.y - 0.6,
        st.cz + (Math.random() - 0.5) * (st.z1 - st.z0),
        {
          n: 1,
          color: 0xe8f6ff,
          speed: 0.8,
          size: 0.7,
          alpha: 0.32,
          life: 0.9,
        }
      );
    }
  }
  if (feel.sprayT <= 0) feel.sprayT = 0.09;
  audio.setFalls(started ? Math.max(0, 1 - nearest / 30) : 0);
  if (world.ripple) world.ripple.offset.y = (t * 0.035) % 1;
  if (world.beam) {
    const pulse = 0.85 + Math.sin(t * 1.7) * 0.15;
    world.beam[0].material.opacity = 0.34 * pulse;
    world.beam[1].material.opacity = 0.12 * pulse;
    world.beam[0].rotation.y = t * 0.2;
  }
  for (const b of world.birds || []) {
    const a = t * b.sp + b.ph;
    b.g.position.set(
      b.cx + Math.cos(a) * b.r,
      b.cy + Math.sin(a * 1.7) * 1.6,
      b.cz + Math.sin(a) * b.r
    );
    b.g.rotation.y = -a + (b.sp > 0 ? 0 : Math.PI);
    b.g.rotation.z = Math.sin(a * 1.7) * 0.25;
  }
  for (const c of seaLayers) {
    c.tex.offset.x = c.ox + t * c.v;
    c.tex.offset.y = c.oy + t * c.v * 0.6;
  }
}

// ---------- visuals ----------
const _coin = {
  m: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  p: new THREE.Vector3(),
  s: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
};
let lodTick = 0;
function updateVisuals(dt) {
  // Small props (bushes) are only drawn near Kai.
  if (lodTick++ % 12 === 0) {
    for (const l of lodGroups) {
      const gx = l.mover ? l.mover.position.x : l.x;
      const gz = l.mover ? l.mover.position.z : l.z;
      const near =
        (gx - state.x) ** 2 + (gz - state.z) ** 2 < LOD_NEAR * LOD_NEAR;
      l.g.visible = near;
      if (l.far) l.far.visible = !near;
    }
  }
  // After a jump in position (caught by the vines, travel between crystals) Kai's figure glides to the new place.
  feel.snap.multiplyScalar(Math.exp(-11 * Math.max(dt, 1 / 120)));
  kaiRoot.position.set(
    state.x + feel.snap.x,
    state.y + feel.snap.y,
    state.z + feel.snap.z
  );
  kaiRoot.rotation.y = state.yaw;
  if (mixer) {
    const speed = Math.hypot(state.vx, state.vz);
    // Airborne: the flip plays through; otherwise fall when dropping fast, else the jump clip.
    const flipping =
      current === actions.flip && actions.flip.isRunning() && !state.onGround;
    const want = !state.onGround
      ? state.vy < -5
        ? 'fall'
        : 'jump'
      : speed > 0.5
        ? 'run'
        : 'idle';
    const inAirAnim = current === actions.jump || current === actions.fall;
    const hurting =
      !!actions.hurt && current === actions.hurt && actions.hurt.isRunning();
    if (
      !flipping &&
      !hurting &&
      !(want === 'jump' && inAirAnim) &&
      !game.poseHold &&
      !state.rope &&
      !state.rail
    )
      setAction(want);
    // Swinging on the rope: hold the jump clip's tucked mid-air pose (0.8 s) instead of letting the fall clip run on.
    if (
      (state.rope || state.rail || state.hang) &&
      actions.jump &&
      !game.poseHold
    ) {
      if (!ropePose) {
        actions.jump.reset();
        setAction('jump', 0.1, true);
        ropePose = true;
      }
      actions.jump.paused = true;
      actions.jump.time = 0.8;
    } else if (ropePose) {
      ropePose = false;
      if (actions.jump) actions.jump.paused = false; // let it play out after the release
    }
    if (actions.run)
      actions.run.timeScale = Math.min(
        1.3,
        Math.max(0.6, speed / PARAMS.runSpeed)
      );
    mixer.update(dt);
    if (state.rope || state.rail || state.hang) gripRope();
    else if (feel.waveT > 0) waveArm();
  }
  const t = performance.now() / 1000;
  updateFeel(dt, t);
  coinMeshes.forEach(m => {
    m.rotation.y = t * 2.2;
  });
  for (const batch of coinBatches) {
    // Spin and bob; a collected one pops (grows and rises for 0.18 s) and is then scaled away. Lanterns turn slowly.
    const m4 = _coin.m;
    const near = Math.abs(batch.zc - state.z) < 200;
    for (const mesh of batch.meshes) mesh.visible = near;
    if (!near) continue;
    batch.idx.forEach((i, k) => {
      const c = COURSE.coins[i];
      let sc = 1;
      let up = Math.sin(t * 2.4 + c.x * 0.7 + c.z * 0.31) * 0.12;
      if (coinPop[i] >= 0) {
        coinPop[i] += dt;
        const kk = Math.min(1, coinPop[i] / 0.18);
        sc = kk < 1 ? 1 + kk * 0.9 : 0;
        up += kk * 0.7;
      }
      _coin.q.setFromAxisAngle(
        _coin.up,
        t * (batch.lantern ? 0.9 : 2.2) +
          (coinPop[i] >= 0 ? coinPop[i] * 30 : 0) +
          i
      );
      _coin.p.set(c.x, c.y + up, c.z);
      _coin.s.setScalar(sc);
      m4.compose(_coin.p, _coin.q, _coin.s);
      for (const mesh of batch.meshes) mesh.setMatrixAt(k, m4);
    });
    for (const mesh of batch.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
  waypoint.position.y = MARKER.y + Math.sin(t * 2) * 0.25;
  if (s3.rope) {
    if (state.hang && !state.rope) {
      // The vine he hangs from, rim to hands.
      const hp = hangPoint();
      const hand = gripPoint.clone();
      const to = new THREE.Vector3(hp.x, hp.y, hp.z);
      s3.rope.position.copy(hand).add(to).multiplyScalar(0.5);
      s3.rope.scale.set(1.6, hand.distanceTo(to), 1.6);
      s3.rope.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        to.clone().sub(hand).normalize()
      );
      s3.rope.visible = true;
    } else if (state.rope) {
      const a = COURSE.anchors[state.rope.i];
      const hand = gripPoint.clone();
      // The beam leaves his hand and reaches the anchor in about a seventh of a second, with a golden flash where it catches.
      feel.ropeT += dt;
      const reach = Math.min(1, feel.ropeT / 0.14);
      const to = hand.clone().lerp(new THREE.Vector3(a.x, a.y, a.z), reach);
      if (reach >= 1 && !feel.ropeHit) {
        feel.ropeHit = true;
        fx.burst(a.x, a.y, a.z, { n: 18, speed: 5, life: 0.5 });
      }
      const mid = hand.clone().add(to).multiplyScalar(0.5);
      s3.rope.position.copy(mid);
      s3.rope.scale.set(1, hand.distanceTo(to), 1);
      s3.rope.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        to.clone().sub(hand).normalize()
      );
      s3.rope.visible = true;
    } else s3.rope.visible = false;
    if (s3.anchor) s3.anchor.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
  }
  for (const pad of springPads) {
    if (pad.t > 0) {
      pad.t = Math.max(0, pad.t - dt);
      pad.group.scale.y = 0.45 + 0.55 * (1 - pad.t / 0.3); // 0.45 = squashed, 1 = recovered
    } else pad.group.scale.y = 1;
  }
  if (LEVEL === 's5') {
    for (const m of s5.movers) {
      const b = platformBounds(m.p, state.t);
      m.group.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    }
  }
  if (LEVEL === 's4' || LEVEL === 's5' || LEVEL === 's6' || WORLD) {
    for (const [oi, o] of s4.orbs.entries()) {
      if (banishStep(o.g, o.i ?? oi, dt)) continue;
      o.g.visible = !state.defeated[o.i ?? oi];
      const p = enemyPos(o.e, state.t);
      const dazed = state.stunUntil[o.i ?? oi] > state.t;
      o.g.position.set(
        p.x,
        p.y + Math.sin(t * 3 + o.e.phase) * 0.1 - (dazed ? 0.15 : 0),
        p.z
      );
      if (o.e.kind === 'bramble') {
        // It faces the way it is rolling; dazed, it wobbles on the spot with a few stars over it.
        const p2 = enemyPos(o.e, state.t + 0.1);
        o.g.rotation.y = dazed
          ? t * 6
          : Math.atan2(p2.x - p.x, p2.z - p.z + 1e-4);
        o.g.rotation.z = dazed ? Math.sin(t * 9) * 0.35 : 0;
        if (dazed && Math.random() < 0.2)
          fx.mote(p.x, p.y + 0.8, p.z, {
            color: 0xfff3a0,
            life: 0.5,
            spread: 0.4,
          });
      } else o.g.rotation.y = t * 1.5;
    }
    if (s4.key) {
      s4.key.visible = !state.hasKey;
      s4.key.rotation.y = t * 2;
      s4.key.position.y = COURSE.key.y + 0.3 + Math.sin(t * 2.5) * 0.1;
    }
    if (s4.gate) s4.gate.visible = !state.hasKey;
  }
  if (WORLD) {
    for (const m of world.movers) {
      const b = platformBounds(m.p, state.t);
      m.group.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    }
    for (const k of world.keys) {
      k.g.visible = !state.keysHeld[k.k.id];
      k.g.rotation.y = t * 2;
      k.g.position.y = k.k.y + 0.3 + Math.sin(t * 2.5) * 0.1;
    }
    for (const g of world.gates) g.g.visible = !state.keysHeld[g.gate.key];
    world.gems.forEach((m, i) => {
      m.visible = !state.gemsCollected[i];
      m.rotation.y = t * 1.4;
      m.position.y = COURSE.gems[i].y + Math.sin(t * 2 + i) * 0.15;
    });
  }
  if (LEVEL === 's2' || WORLD) {
    boardClip.constant =
      LEVEL === 's2' &&
      sideMix > 0.5 &&
      Math.abs(wrapPi(camYaw - Math.PI / 2)) < 0.9
        ? 1.05
        : 100; // side view: clip the camera-side rail
    for (const m of s2.movers) {
      const b = platformBounds(m.p, state.t);
      m.group.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    }
    for (const f of s2.flyers) {
      if (f.i !== undefined && banishStep(f.g, f.i, dt)) continue;
      if (f.i !== undefined && state.defeated[f.i]) {
        f.g.visible = false;
        continue;
      }
      const p = enemyPos(f.e, state.t);
      const p2 = enemyPos(f.e, state.t + 0.05);
      f.g.position.set(p.x, p.y + Math.sin(t * 4) * 0.08, p.z);
      f.g.rotation.y = Math.atan2(p2.x - p.x, p2.z - p.z + 1e-3);
      const flap = Math.sin(t * 22) * 0.8;
      f.g.rotation.z = Math.sin(t * 5) * 0.12;
      f.wl.rotation.z = flap;
      f.wr.rotation.z = -flap;
    }
  }
  if (game.cameraOverride) {
    // Debug: fixed camera for inspecting the model (tools/inspect_kai.mjs).
    const { pos, look } = game.cameraOverride;
    camera.position.set(...pos);
    camera.lookAt(...look);
  } else if (!started) {
    // The title: a slow drift behind and above Kai, looking down the road to the citadel.
    const a = Math.sin(t * 0.11) * 0.4;
    camera.position.set(
      state.x + Math.sin(a) * 9,
      state.y + 5.6 + Math.sin(t * 0.17) * 0.5,
      state.z + 2 - Math.cos(a) * 11
    );
    camera.lookAt(state.x - Math.sin(a) * 3, state.y + 0.6, state.z + 20);
    feel.camBaseY = state.y;
  } else {
    const target =
      LEVEL === 's3' || LEVEL === 's4' || LEVEL === 's5' || LEVEL === 's6'
        ? 1
        : LEVEL === 's2'
          ? smooth(33, 39, state.z)
          : 0;
    sideMix += (target - sideMix) * (1 - Math.exp(-3 * Math.max(dt, 1 / 120)));
    // Orbit camera: automatic, with R / F or a mouse drag to take over.
    const ROT = 1.8;
    const padCam = readPad();
    const turn = keys.has('KeyF')
      ? 1
      : keys.has('KeyR')
        ? -1
        : padCam
          ? padCam.cam
          : 0;
    if (turn) {
      camYaw = wrapPi(camYaw + turn * ROT * dt);
      camUser = true;
      camIdle = 0;
    }
    if (keys.has('KeyC')) {
      camUser = false;
      camAssist = 0;
      camPitch = 0;
    }
    // Tilt: T looks up, G looks down (the same physical keys on QWERTY and AZERTY), or the right stick.
    const tilt =
      (keys.has('KeyG') ? 1 : 0) -
      (keys.has('KeyT') ? 1 : 0) +
      (padCam ? padCam.tilt : 0);
    if (tilt)
      camPitch = Math.max(
        PITCH_MIN,
        Math.min(PITCH_MAX, camPitch + tilt * 1.2 * dt)
      );
    if (camUser) {
      camIdle += dt;
      if (camIdle > 4) {
        // Hand back smoothly: the automatic camera carries on from where the player left it.
        camAssist = wrapPi(camYaw - defaultYaw());
        camUser = false;
        camOffT = 0;
      }
    }
    if (!camUser) {
      const speed = Math.hypot(state.vx, state.vz);
      if (speed > 3 && !state.rope && !state.rail) {
        // The grammar: behind Kai's travel in S1, and with the travel across the screen in the side-view levels.
        const want = wrapPi(
          Math.atan2(state.vx, state.vz) + sideMix * (Math.PI / 2)
        );
        const goal = wrapPi(defaultYaw() + camAssist);
        if (Math.abs(wrapPi(want - goal)) > 0.7) {
          camOffT += dt;
          if (camOffT > 0.8) {
            camAssist = wrapPi(want - defaultYaw());
            camOffT = 0;
          }
        } else camOffT = 0;
      } else camOffT = 0;
      const diff = wrapPi(defaultYaw() + camAssist - camYaw);
      camYaw = wrapPi(
        camYaw + diff * (1 - Math.exp(-1.6 * Math.max(dt, 1 / 120)))
      );
    }
    const fx_ = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    const rx = -fz; // screen-right
    const rz = fx_;
    // While swinging in S3 the camera pulls back and up so the rope and the anchor stay in frame.
    // While swinging the camera pulls back and up so the rope and the anchor stay in frame; on the rail it pulls back too; and on
    // the island hops of the last acts it sits higher and wider, as the video does (a diorama of the island, Kai small in it).
    const roped = !!s3.rope && !!state.rope;
    const wide = WORLD && state.z > 250 ? 1 : 0;
    const done = state.status === 'complete';
    const wantDist = done
      ? 7.5
      : roped
        ? 13
        : state.rail
          ? 9.5
          : 5.8 + (9 - 5.8) * sideMix + wide * 2.2;
    const wantH = done
      ? 2.6
      : roped
        ? 3.8
        : state.rail
          ? 4.4
          : 3.2 + (2.3 - 3.2) * sideMix + wide * 1.6;
    const kz = 1 - Math.exp(-2.4 * Math.max(dt, 1 / 120));
    feel.camDist += (wantDist - feel.camDist) * kz;
    feel.camH += (wantH - feel.camH) * kz;
    if (done) {
      camYaw = wrapPi(camYaw + dt * 0.4); // a slow turn round Kai at the finish
      camUser = true;
      camIdle = 0;
    }
    // The camera's height follows the ground under Kai, not every hop: quickly on foot, slowly in the air unless he has gone far.
    const dy = state.y - feel.camBaseY;
    const rate =
      state.onGround || hangingNow() ? 9 : Math.abs(dy) > 2.6 ? 5 : 1.2;
    feel.camBaseY += dy * (1 - Math.exp(-rate * Math.max(dt, 1 / 120)));
    const baseY = feel.camBaseY;
    // Look ahead the way Kai is travelling, so the destination is in frame (the video always frames it).
    const sideways = Math.max(
      -3,
      Math.min(3, (state.vx * rx + state.vz * rz) * 0.35)
    );
    const ahead = roped ? 0 : 6 * (1 - sideMix);
    const target3 = new THREE.Vector3(
      state.x + fx_ * ahead + rx * sideways,
      baseY * 0.55 +
        state.y * 0.45 +
        (roped ? 3.0 : 1.3) +
        Math.max(0, -camPitch) * 9,
      state.z + fz * ahead + rz * sideways
    );
    // On the rail the camera slides out to one side, so Kai and the way ahead are not hidden behind the bar.
    feel.camSide += ((state.rail ? 3.6 : 0) - feel.camSide) * kz;
    const desired = new THREE.Vector3(
      state.x - fx_ * feel.camDist * Math.cos(camPitch) + rx * feel.camSide,
      Math.max(
        baseY + 0.5,
        baseY + feel.camH + feel.camDist * Math.sin(camPitch) * 1.15
      ),
      state.z - fz * feel.camDist * Math.cos(camPitch) + rz * feel.camSide
    );
    camera.position.lerp(desired, 1 - Math.exp(-6 * Math.max(dt, 1 / 120)));
    camera.lookAt(target3);
    // Speed opens the field of view a little; a hard landing, a hit or a stomp shakes the frame.
    const sp3 = Math.hypot(state.vx, state.vy, state.vz);
    const wantFov = 55 + Math.max(0, Math.min(9, (sp3 - 8.5) * 0.8));
    if (Math.abs(wantFov - camera.fov) > 0.02) {
      camera.fov +=
        (wantFov - camera.fov) * (1 - Math.exp(-4 * Math.max(dt, 1 / 120)));
      camera.updateProjectionMatrix();
      fx.resize(window.innerHeight, camera.fov);
    }
    if (feel.shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * feel.shake;
      camera.position.y += (Math.random() - 0.5) * feel.shake;
      camera.position.z += (Math.random() - 0.5) * feel.shake;
      feel.shake *= Math.exp(-9 * Math.max(dt, 1 / 120));
    }
  }
  if (skyRig) skyRig.position.set(state.x, 0, state.z);
  // Day drifts to dusk along the road (the whole journey only); the light comes from where the sun stands in the sky.
  if (WORLD) {
    const want = Math.max(0, Math.min(1, (state.z - 60) / 330));
    applySky(
      sky.tod < 0
        ? want
        : sky.tod +
            (want - sky.tod) * (1 - Math.exp(-0.8 * Math.max(dt, 1 / 120)))
    );
  }
  skyDome.position.copy(camera.position);
  const sd = skyU.sunDir.value;
  sun.position.set(
    state.x + sd.x * 40,
    state.y + sd.y * 40,
    state.z + sd.z * 40
  );
  sun.target.position.set(state.x, state.y, state.z);
  updateAmbient(dt, t);
  if (state.t > 6) {
    const hint = document.getElementById('hint');
    hint.style.opacity = '0';
    hint.style.display = 'none'; // the panel shrinks to the title and counters
  }
}

// A creature caught by the wave tumbles away from Kai, shrinking, with a trail of sparks, and is gone in 0.7 s.
const banish = {}; // enemy index -> { t, dx, dz }
function banishStep(g, ei, dt) {
  const bn = banish[ei];
  if (!bn) return false;
  bn.t += dt;
  const k = bn.t / 0.7;
  if (k >= 1) {
    g.visible = false;
    delete banish[ei];
    return true;
  }
  g.visible = true;
  g.position.x += bn.dx * 15 * dt;
  g.position.z += bn.dz * 15 * dt;
  g.position.y += (6 - 10 * bn.t) * dt;
  g.rotation.x += dt * 13;
  g.rotation.z += dt * 9;
  g.scale.setScalar(Math.max(0.02, 1 - k));
  fx.mote(g.position.x, g.position.y, g.position.z, {
    color: 0x9ffff4,
    life: 0.4,
  });
  return true;
}
// While the wave is thrown, Kai's right arm points the way he faces.
const _wv = new THREE.Vector3();
function waveArm() {
  const up = kaiRoot.getObjectByName('R_Upperarm');
  const fore = kaiRoot.getObjectByName('R_Forearm');
  const hand = kaiRoot.getObjectByName('R_Hand');
  if (!up || !fore || !hand) return;
  _wv.set(Math.sin(state.yaw), 0.22, Math.cos(state.yaw)).normalize();
  aimBone(up, fore, _wv);
  aimBone(fore, hand, _wv);
}
const HABITAT_WORDS = {
  meadow: 'a lawn to graze',
  water: 'a running stream',
  blossom: 'blossom trees',
};
function streamAt(x, y, z) {
  for (const st of world.streams || []) {
    if (!state.springs[st.i]) continue;
    if (
      z >= st.z0 &&
      z <= st.z1 &&
      x >= st.x0 &&
      x <= st.x1 &&
      Math.abs(y - st.y) < 0.35
    )
      return st;
  }
  return null;
}
function hangingNow() {
  return !!state.rope || !!state.rail || !!state.hang;
}
// Where the vine Kai hangs from is rooted: the spot on the island's rim he will climb to.
function hangPoint() {
  const h = state.hang;
  const hp = COURSE.platforms.find(q => q.id === h.plat);
  const b = platformBounds(hp, state.t);
  return {
    x: b.x0 + h.ox + h.nx * 0.5,
    y: h.top + 0.1,
    z: b.z0 + h.oz + h.nz * 0.5,
  };
}
function render() {
  renderer.render(scene, camera);
}

// ---------- perf ----------
const frameMs = [];
const WARMUP_FRAMES = 60; // shader compilation and first uploads; reported separately, not in the statistics
function gpuName() {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
}
function perfReport() {
  if (frameMs.length < WARMUP_FRAMES + 10) return null;
  const sample = frameMs.slice(WARMUP_FRAMES); // real elapsed ms per frame (not clamped)
  const sorted = [...sample].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const worst1 = sorted[Math.floor(sorted.length * 0.99)];
  return {
    frames: sample.length,
    medianFps: +(1000 / median).toFixed(1),
    p1LowFps: +(1000 / worst1).toFixed(1),
    maxFrameMs: +sorted[sorted.length - 1].toFixed(1),
    framesOver100ms: sorted.filter(m => m > 100).length,
    warmupFrames: WARMUP_FRAMES,
    warmupWorstMs: +Math.max(...frameMs.slice(0, WARMUP_FRAMES)).toFixed(1),
    gpu: gpuName(),
    pixelRatio: renderer.getPixelRatio(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    qualityLevel: quality.level,
    note: 'Valid only on a GPU-accelerated browser; software rendering (headless) is far slower. The first 60 frames are excluded from the statistics.',
  };
}

// ---------- quality governor: if the machine cannot hold about 42 fps, render fewer pixels (then drop shadows) rather than stutter.
// It only ever steps down, so it cannot oscillate; ?quality=fixed turns it off, and it is off while ?perf= is measuring. ----------
const QUALITY_STEPS = [null, 1.2, 1.0, 0.8];
const quality = {
  level: 0,
  sum: 0,
  n: 0,
  skip: 150,
  on: q.get('quality') !== 'fixed' && !PERF_SECONDS,
};
function governQuality(rawMs) {
  if (
    !quality.on ||
    !started ||
    paused ||
    quality.level >= QUALITY_STEPS.length - 1
  )
    return;
  if (quality.skip > 0) {
    quality.skip--;
    return;
  }
  quality.sum += Math.min(rawMs, 200);
  if (++quality.n < 90) return;
  const avg = quality.sum / quality.n;
  quality.sum = 0;
  quality.n = 0;
  if (avg < 24) return;
  quality.level++;
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, QUALITY_STEPS[quality.level])
  );
  if (quality.level === QUALITY_STEPS.length - 1) {
    renderer.shadowMap.enabled = false;
    sun.castShadow = false;
  }
  quality.skip = 60;
  game.quality = quality.level;
}

// ---------- loop ----------
let acc = 0;
let last = performance.now();
let playedMs = 0;
function frame(now) {
  if (MANUAL) return; // tests drive stepping and drawing through window.__game
  const rawMs = now - last; // keep the real frame time for the perf report; clamp only what the game sees
  const dt = Math.min(0.1, rawMs / 1000);
  last = now;
  frameMs.push(rawMs);
  if (frameMs.length > 3600) frameMs.shift();
  governQuality(rawMs);
  if (!started) {
    const pad = readPad();
    if (pad && pad.any) {
      wake();
      begin();
    }
  }
  if (feel.hitStop > 0) feel.hitStop -= dt;
  else if (
    started &&
    !MANUAL &&
    !paused &&
    !travel.open &&
    state.status === 'playing'
  ) {
    acc += dt;
    playedMs += dt * 1000;
    while (acc >= PARAMS.dt) {
      stepOnce();
      acc -= PARAMS.dt;
    }
  }
  updateVisuals(dt);
  render();
  // Report after PERF_SECONDS of play, or as soon as the section is finished (it is only about 11 to 14 s long).
  if (
    PERF_SECONDS &&
    !game.perf &&
    (playedMs > PERF_SECONDS * 1000 || state.status === 'complete')
  ) {
    game.perf = perfReport();
    perfEl.hidden = false;
    perfEl.textContent = `perf over ${game.perf.frames} frames (${(playedMs / 1000).toFixed(1)} s of play, first ${game.perf.warmupFrames} skipped): ${game.perf.medianFps} fps median, ${game.perf.p1LowFps} fps 1% low, ${game.perf.maxFrameMs} ms worst, ${game.perf.framesOver100ms} frames over 100 ms, warm-up worst ${game.perf.warmupWorstMs} ms | GPU: ${game.perf.gpu}`;
    console.log('PERF', JSON.stringify(game.perf));
  }
  requestAnimationFrame(frame);
}

// ---------- contract ----------
// Object.assign would copy a getter's value once; define the live property explicitly.
Object.defineProperty(game, 'state', {
  enumerable: true,
  get() {
    return {
      status: state.status,
      t: +state.t.toFixed(3),
      pos: {
        x: +state.x.toFixed(3),
        y: +state.y.toFixed(3),
        z: +state.z.toFixed(3),
      },
      vel: {
        x: +state.vx.toFixed(3),
        y: +state.vy.toFixed(3),
        z: +state.vz.toFixed(3),
      },
      onGround: state.onGround,
      coins: state.coins,
      coinsTotal: COURSE.coins.length,
      deaths: state.deaths,
      hearts: state.hearts,
      hits: state.hits,
      level: WORLD ? 'world' : LEVEL,
      rail: !!state.rail,
      rope: !!state.rope,
      waveCd: +state.waveCd.toFixed(3),
      carrying: state.carry >= 0 ? state.creatures[state.carry].species : null,
      rehomed: state.rehomed,
      toRehome: state.toRehome,
      slips: state.slips,
      hanging: !!state.hang,
      purse: state.coins - state.spent,
      banished: state.banished,
      hasKey: !!state.hasKey,
      keys: Object.keys(state.keysHeld),
      gems: state.gems,
      gemsTotal: (COURSE.gems || []).length,
      checkpoint: state.checkpoint,
      yaw: +state.yaw.toFixed(3),
      anim:
        current === actions.flip
          ? 'flip'
          : current === actions.fall
            ? 'fall'
            : current === actions.jump
              ? 'jump'
              : current === actions.run
                ? 'run'
                : current === actions.idle
                  ? 'idle'
                  : 'none',
    };
  },
});
Object.assign(game, {
  advance(n = 1, draw = false) {
    // deterministic stepping for tests; draws only when asked (software WebGL is slow)
    started = true;
    banner.hidden = state.status === 'playing';
    for (let i = 0; i < n && state.status === 'playing'; i++) stepOnce();
    if (draw) {
      updateVisuals(n * PARAMS.dt);
      render();
    }
    return game.state;
  },
  render(dt = 0) {
    updateVisuals(dt);
    render();
  },
  // Debug helpers for inspecting the model: freeze Kai in a clip at a time, and set a fixed camera.
  poseKai(name, time) {
    const a = actions[name];
    if (!a) return false;
    game.poseHold = true;
    Object.values(actions).forEach(x => x.stop());
    a.reset().play();
    a.paused = true;
    a.time = time;
    current = a;
    mixer.update(0);
    return true;
  },
  setCamera(pos, look) {
    game.cameraOverride = pos ? { pos, look } : null;
  },
  setBotOptions(options) {
    botOptions = options || {};
  },
  setBot(on) {
    autopilotOn = !!on;
  },
  // Development: advance n steps with a given input (e.g. { wave: true } on the first step only), drawing each frame.
  advanceWith(input, n = 1, draw = true) {
    started = true;
    banner.hidden = true;
    for (let i = 0; i < n && state.status === 'playing'; i++) {
      feel.lastVy = state.vy;
      step(
        state,
        i === 0
          ? input
          : { ...input, wave: false, jump: input.holdJump || false },
        COURSE
      );
      if (state.events.length) onEvents(state.events);
      if (draw) {
        updateVisuals(PARAMS.dt);
        render();
      }
    }
    return game.state;
  },
  // Development: put Kai somewhere (he falls to the ground below), and read the renderer's counters for the last frame.
  teleport(x, y, z) {
    state.x = x;
    state.y = y;
    state.z = z;
    state.vx = state.vy = state.vz = 0;
    state.onGround = false;
    state.standing = null;
    state.rope = null;
    state.rail = null;
    camera.position.set(
      x - Math.sin(camYaw) * 6,
      y + 3.2,
      z - Math.cos(camYaw) * 6
    );
  },
  renderInfo() {
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs ? renderer.info.programs.length : 0,
    };
  },
  perfReport,
});

await loadKai();
updateVisuals(1 / 60);
// Compile the scene's shaders up front so the first frames do not hitch: a 256 ms frame was seen in the first
// 60 frames on the reference machine (2026-11-05). Effect not yet measured there.
try {
  await renderer.compileAsync(scene, camera);
} catch (err) {
  game.warnings.push('shader precompile failed: ' + err);
}
// Upload every texture now (first-draw uploads of 1024 px maps were the suspected cause of a 116.8 ms frame).
scene.traverse(o => {
  if (!o.isMesh) return;
  for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
    if (m.map) renderer.initTexture(m.map);
  }
});
// One hidden warm-up render with culling off, so every geometry buffer, texture and the shadow map is uploaded now
// (under the title screen) instead of the first time each piece comes into view during play. The cost grows with the
// amount of art: the load-time hitch was 452 ms, 537 ms and 768 ms over three art passes.
{
  const t0 = performance.now();
  const saved = [];
  scene.traverse(o => {
    saved.push([o, o.frustumCulled]);
    o.frustumCulled = false;
  });
  try {
    renderer.render(scene, camera);
    renderer.render(scene, camera);
  } catch (err) {
    game.warnings.push('warm-up render failed: ' + err);
  }
  for (const [o, v] of saved) o.frustumCulled = v;
  game.warmupMs = +(performance.now() - t0).toFixed(1);
}
game.ready = true;
last = performance.now(); // the first frame's elapsed time starts here, not at script start
requestAnimationFrame(frame);
