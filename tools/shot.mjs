// Headless look at the game: load a URL query, run a list of operations, take screenshots, print render counters.
//   node tools/shot.mjs "<query>" <prefix> <op> [<op> ...]
// Operations:
//   adv:N            advance N fixed steps (the scripted player drives when the query has &bot)
//   shot:name        render and save out/<prefix>_<name>.png (a name starting with 'live' draws one frame only, after play:N)
//   play:N           advance N steps drawing every frame (slow, but the camera and effects are as in live play)
//   tp:x,y,z         teleport Kai (he falls to the ground below)
//   yaw:rad          set the camera heading
//   cam:x,y,z,lx,ly,lz   fixed camera position and look-at (cam:off to release)
//   info             print state and renderer counters (draw calls, triangles)
//   eval:js          evaluate an expression in the page and print it
//   until:z>N        advance until Kai's z exceeds N (or 6000 steps)
// Software WebGL: frame rate is NOT valid here; draw calls and triangles are.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from '../serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });
const [query, prefix, ...ops] = process.argv.slice(2);
const W = Number(process.env.SHOT_W || 1280);
const H = Number(process.env.SHOT_H || 720);

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const watchdog = setTimeout(async () => {
  console.error('shot watchdog: 540 s exceeded, closing');
  await browser.close().catch(() => {});
  process.exit(3);
}, 540000);
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const sep = query.includes('manual') ? '' : '&manual';
await page.goto(`${base}/?${query}${sep}`, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 });
} catch (e) {
  console.error('game never became ready:', errors.join('\n') || e.message);
  await browser.close();
  server.close();
  process.exit(2);
}
for (const op of ops) {
  const i = op.indexOf(':');
  const name = i < 0 ? op : op.slice(0, i);
  const arg = i < 0 ? '' : op.slice(i + 1);
  if (name === 'adv') {
    let left = Number(arg);
    while (left > 0) {
      const n = Math.min(left, 300);
      await page.evaluate((k) => window.__game.advance(k), n);
      left -= n;
    }
  } else if (name === 'play') {
    // N steps, each one drawn at 1/60 s: slow in software, but the camera, particles and animation are as in live play.
    for (const dt of [0.3, 0.3, 0.3]) await page.evaluate((d) => window.__game.render(d), dt); // let the camera catch up with steps that were not drawn
    await page.evaluate((n) => {
      for (let k = 0; k < n; k++) window.__game.advance(1, true);
    }, Number(arg));
  } else if (name === 'until') {
    const target = Number(arg.replace('z>', ''));
    for (let k = 0; k < 200; k++) {
      const s = await page.evaluate(() => window.__game.advance(30));
      if (s.pos.z > target || s.status !== 'playing') break;
    }
  } else if (name === 'shot') {
    for (const dt of arg.startsWith('live') ? [0.016] : [0.3, 0.3, 0.3, 0.05]) await page.evaluate((d) => window.__game.render(d), dt);
    await page.screenshot({ path: path.join(OUT, `${prefix}_${arg}.png`) });
  } else if (name === 'tp') {
    const [x, y, z] = arg.split(',').map(Number);
    await page.evaluate(([a, b, c]) => window.__game.teleport(a, b, c), [x, y, z]);
  } else if (name === 'yaw') {
    await page.evaluate((a) => window.__game.setCamYaw(a), Number(arg));
  } else if (name === 'cam') {
    if (arg === 'off') await page.evaluate(() => window.__game.setCamera(null));
    else {
      const v = arg.split(',').map(Number);
      await page.evaluate((a) => window.__game.setCamera(a.slice(0, 3), a.slice(3)), v);
    }
  } else if (name === 'info') {
    await page.evaluate(() => window.__game.render(0.016));
    const r = await page.evaluate(() => ({ s: window.__game.state, r: window.__game.renderInfo(), w: window.__game.warnings }));
    console.log(JSON.stringify({ pos: r.s.pos, status: r.s.status, t: r.s.t, coins: r.s.coins, deaths: r.s.deaths, render: r.r }));
    if (r.w.length) console.log('warnings:', r.w.join(' | '));
  } else if (name === 'eval') {
    console.log(JSON.stringify(await page.evaluate(arg)));
  } else {
    console.error('unknown op', op);
  }
}
const pageErrors = await page.evaluate(() => window.__game.errors);
if (errors.length || pageErrors.length) console.log('ERRORS:', [...errors, ...pageErrors].join('\n'));
clearTimeout(watchdog);
await browser.close();
server.close();
