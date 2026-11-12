// Loading and preparing generated scenery pieces (GLB) for the game. Every piece is optional: if a file is missing
// the caller keeps its placeholder geometry, so the game always runs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MAP_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
];

/** Load named GLBs from `base`; a piece that fails to load is null (and a warning is returned). */
export async function loadPieces(names, base = '/assets/scenery/') {
  const loader = new GLTFLoader();
  const pieces = {};
  const warnings = [];
  await Promise.all(
    names.map(async name => {
      try {
        const gltf = await loader.loadAsync(`${base}${name}.glb`);
        pieces[name] = gltf.scene;
      } catch (err) {
        pieces[name] = null;
        warnings.push(
          `scenery piece "${name}" not loaded (${String(err).slice(0, 80)}); using the placeholder`
        );
      }
    })
  );
  return { pieces, warnings };
}

/** Downscale any texture larger than `maxSize` on its long side (integrated-GPU memory budget). */
export function shrinkTextures(root, maxSize = 1024) {
  const seen = new Set();
  let shrunk = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      for (const key of MAP_KEYS) {
        const tex = m[key];
        if (!tex || seen.has(tex)) continue;
        seen.add(tex);
        const img = tex.image;
        const w = img && (img.width || img.naturalWidth);
        const h = img && (img.height || img.naturalHeight);
        if (!w || !h || Math.max(w, h) <= maxSize) continue;
        const k = maxSize / Math.max(w, h);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * k));
        canvas.height = Math.max(1, Math.round(h * k));
        canvas
          .getContext('2d')
          .drawImage(img, 0, 0, canvas.width, canvas.height);
        tex.image = canvas;
        tex.needsUpdate = true;
        shrunk += 1;
      }
    }
  });
  return shrunk;
}

/**
 * Wrap a loaded scene in a group that is scaled so one dimension equals `size` metres, optionally turned so its
 * longest horizontal side lies along Z, and anchored at the bottom centre ('bottom') or the centre ('center').
 * Returns the group; `group.userData.size` holds the final bounding-box size.
 */
export function normalise(
  root,
  { dimension = 'height', size = 1, alongZ = false, anchor = 'bottom' } = {}
) {
  const inner = new THREE.Group();
  inner.add(root);
  inner.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(inner);
  let dims = box.getSize(new THREE.Vector3());
  if (alongZ && dims.x > dims.z) {
    inner.rotation.y = Math.PI / 2;
    inner.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(inner);
    dims = box.getSize(new THREE.Vector3());
  }
  const current =
    dimension === 'longest'
      ? Math.max(dims.x, dims.y, dims.z)
      : dimension === 'width'
        ? Math.max(dims.x, dims.z)
        : dims.y;
  const k = size / (current || 1);
  const outer = new THREE.Group();
  outer.add(inner);
  inner.scale.multiplyScalar(k);
  outer.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(outer);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.x -= c.x;
  inner.position.z -= c.z;
  inner.position.y -= anchor === 'bottom' ? box.min.y : c.y;
  outer.updateMatrixWorld(true);
  outer.userData.size = new THREE.Box3()
    .setFromObject(outer)
    .getSize(new THREE.Vector3());
  return outer;
}

/** Bake a normalised piece's meshes into InstancedMeshes, one per source mesh, at the given matrices. */
export function instancedFrom(piece, matrices) {
  piece.updateMatrixWorld(true);
  const out = [];
  piece.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const mesh = new THREE.InstancedMesh(geo, o.material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.push(mesh);
  });
  return out;
}

/** Count triangles in a piece (for budgets and logging). */
export function triangleCount(root) {
  let n = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry;
    n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return Math.round(n);
}
