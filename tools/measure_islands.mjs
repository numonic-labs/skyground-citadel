// Measure the generated island models (assets/scenery/island_a..d.glb) so they can be real, walkable places in the game.
// The page casts a downward ray per grid cell and returns the heights of every upward-facing surface it crosses (game.measureIslands).
// Here the GROUND is inferred from that, because each model is a single mesh with its trees, ruins and arches fused to the terrain:
//   1. ground = the lowest upward-facing surface in the upper part of the model (sees through tree canopies to the grass below);
//   2. a cell whose ground is more than DECOR above its neighbours' median is decoration (a wall top, an arch): it is filled in from
//      the surrounding ground, so Kai walks through it at ground level instead of over its roof (and never falls through it);
//   3. cells with no upward surface are void (beyond the island's edge).
// Writes src/islands.data.mjs: per model its bounding box and the ground height grid, all in the model's own units (normalised to
// width 8, centred), to be scaled and placed by the course.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from '../serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = 40;
const UPPER = 0.4; // only surfaces in the upper 60% of the model's height count as ground (not the rock underneath)
const DECOR = 0.45; // model units: a cell this far above its neighbours' median is decoration
const LOW = 1.5; // model units: ground this far below the median is the sloping rock at the rim, not walkable top

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage();
await page.goto(`${base}/?level=s1&autostart&manual`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 90000 });
const raw = await page.evaluate((n) => window.__game.measureIslands(n), N);
await browser.close();
server.close();

const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
};

const result = {};
for (const [name, m] of Object.entries(raw)) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = m.box;
  const floor = minY + (maxY - minY) * UPPER;
  const at = (ix, iz) => (ix < 0 || iz < 0 || ix >= N || iz >= N ? null : ground[iz * N + ix]);
  // 1. lowest upward-facing surface in the upper part
  const ground = m.up.map((hs) => {
    const hi = hs.filter((h) => h >= floor);
    return hi.length ? Math.min(...hi) : null;
  });
  // 2. decoration: much higher than the neighbours' median
  const decor = new Set();
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const g = at(ix, iz);
      if (g === null) continue;
      const near = [];
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        if (!dx && !dz) continue;
        const v = at(ix + dx, iz + dz);
        if (v !== null) near.push(v);
      }
      if (near.length >= 8 && g - median(near) > DECOR) decor.add(iz * N + ix);
    }
  }
  // fill decoration from surrounding ground (repeat so a wide ruin is filled from its edge inwards)
  const filled = ground.slice();
  decor.forEach((i) => (filled[i] = null));
  let pending = [...decor];
  for (let pass = 0; pass < 12 && pending.length; pass++) {
    const next = [];
    const updates = [];
    for (const i of pending) {
      const ix = i % N;
      const iz = Math.floor(i / N);
      const vals = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= N || jz >= N) continue;
        const v = filled[jz * N + jx];
        if (v !== null && !(dx === 0 && dz === 0)) vals.push(v);
      }
      if (vals.length >= 2) updates.push([i, vals.reduce((a, b) => a + b, 0) / vals.length]);
      else next.push(i);
    }
    updates.forEach(([i, v]) => (filled[i] = v));
    pending = next;
  }
  const groundY0 = median(filled.filter((v) => v !== null));
  // 3b. the sloping rock around the rim is not the island's top: anything far below the median ground is void
  for (let i = 0; i < filled.length; i++) if (filled[i] !== null && filled[i] < groundY0 - LOW) filled[i] = null;
  const land = filled.filter((v) => v !== null);
  const groundY = median(land);
  result[name] = {
    N,
    box: { minX, minY, minZ, maxX, maxY, maxZ },
    groundY: +groundY.toFixed(2),
    ground: filled.map((v) => (v === null ? null : +v.toFixed(2))),
  };
  // an ASCII map for checking by eye: '.' void, '#' filled decoration, digits = height above the median in tenths of a unit (clamped)
  console.log(`== ${name}: ${land.length} ground cells of ${N * N}, median ground ${groundY.toFixed(2)}, ${decor.size} decoration cells filled`);
  for (let iz = 0; iz < N; iz += 2) {
    let row = '';
    for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix;
      if (filled[i] === null) row += '.';
      else if (decor.has(i)) row += '#';
      else row += String(Math.max(0, Math.min(9, Math.round((filled[i] - groundY) * 5 + 4))));
    }
    console.log(row);
  }
}
const out = `// Generated by tools/measure_islands.mjs from assets/scenery/island_*.glb: do not edit by hand.
// Per model (normalised to width 8, centred at its middle): its bounding box and a ${N} x ${N} grid of GROUND heights (row-major, z then x;
// null = no ground), in the model's own units. Trees, ruins and arches are filled in from the ground around them. The course scales
// these by an island's \`s\` and places them.
export const ISLAND_MODELS = ${JSON.stringify(result)};
`;
fs.writeFileSync(path.join(ROOT, 'src', 'islands.data.mjs'), out);
console.log('wrote src/islands.data.mjs');
