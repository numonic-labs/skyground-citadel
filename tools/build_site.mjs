// Build the folder that is deployed as the public, playable game: `node tools/build_site.mjs [outDir]` (default: site/).
// The game is static files. Locally it loads three.js from node_modules; a deployed copy cannot, so this copies index.html,
// src/, the assets the game loads, and only the three.js modules the game imports (traced through their relative imports)
// into one folder, and points the import map at them. Nothing is bundled or minified: what is deployed is the source.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'site'));
const THREE = path.join(ROOT, 'node_modules', 'three');
const SKIP_ASSETS = new Set(['v1_cape']); // superseded models the game no longer loads

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to, skip = new Set()) {
  let bytes = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) bytes += copyDir(a, b, skip);
    else {
      copy(a, b);
      bytes += fs.statSync(a).size;
    }
  }
  return bytes;
}

/** Copy a three.js module and everything it imports by relative path. Returns the set of files copied. */
function trace(entry, seen = new Set()) {
  const file = path.resolve(entry);
  if (seen.has(file)) return seen;
  if (!file.startsWith(THREE + path.sep)) throw new Error('import leaves three.js: ' + file);
  seen.add(file);
  copy(file, path.join(OUT, 'vendor', 'three', path.relative(THREE, file)));
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) trace(path.join(path.dirname(file), m[1]), seen);
  return seen;
}

/** The `three/addons/...` modules the game's own source imports. */
function addonsUsed() {
  const used = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    for (const m of src.matchAll(/from\s*['"]three\/addons\/([^'"]+)['"]/g)) used.add(m[1]);
  }
  return [...used];
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mapped = html
  .replace('/node_modules/three/build/three.module.js', '/vendor/three/build/three.module.js')
  .replace('/node_modules/three/examples/jsm/', '/vendor/three/examples/jsm/');
if (mapped === html || mapped.includes('node_modules')) throw new Error('the import map in index.html was not rewritten');
fs.writeFileSync(path.join(OUT, 'index.html'), mapped);

const srcBytes = copyDir(path.join(ROOT, 'src'), path.join(OUT, 'src'));
const assetBytes = copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'), SKIP_ASSETS);
const seen = trace(path.join(THREE, 'build', 'three.module.js'));
for (const a of addonsUsed()) trace(path.join(THREE, 'examples', 'jsm', a), seen);
copy(path.join(THREE, 'LICENSE'), path.join(OUT, 'vendor', 'three', 'LICENSE'));

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log(`site: ${OUT}`);
console.log(`  src ${mb(srcBytes)}, assets ${mb(assetBytes)}, three.js modules ${seen.size}`);
