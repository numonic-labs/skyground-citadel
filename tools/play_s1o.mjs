// Headless playtest of the open S1: the scripted player follows each of the three routes (?route=centre|west|secret) with
// deterministic stepping; screenshots at the start and at the moments that show the route; writes out/playtest_s1o.json.
// Software WebGL: frame rate is NOT valid.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from '../serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const watchdog = setTimeout(async () => {
  console.error('S1 open playtest watchdog: 600 s exceeded, closing');
  await browser.close().catch(() => {});
  process.exit(3);
}, 600000);

const report = {};
for (const route of ['centre', 'west', 'secret', 'ruinisle', 'archisle']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  const shot = async (name) => {
    for (const dt of [0.25, 0.25, 0.25]) await page.evaluate((d) => window.__game.render(d), dt);
    await page.screenshot({ path: path.join(OUT, `s1o_${route}_${name}.png`) });
  };
  await page.goto(`${base}/?level=s1&route=${route}&autostart&manual&bot`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 90000 });
  await shot('00_start');
  const taken = new Set();
  const once = async (name, cond) => {
    if (taken.has(name) || !cond) return;
    taken.add(name);
    await shot(name);
  };
  let s = await page.evaluate(() => window.__game.advance(1));
  for (let i = 0; i < 3600 && s.status === 'playing'; i++) {
    s = await page.evaluate(() => window.__game.advance(1));
    if (route === 'west') {
      await once('01_launch', s.pos.y > 3 && s.pos.z < 14);
      await once('02_ledges', s.onGround && s.pos.y > 4.4 && s.pos.z > 26 && s.pos.z < 30);
      await once('03_drop', !s.onGround && s.pos.z > 44 && s.pos.z < 50);
    } else if (route === 'secret') {
      await once('01_leap', !s.onGround && s.pos.x > 8 && s.pos.x < 12);
      await once('02_islet', s.onGround && s.pos.x > 14);
    } else {
      await once('01_path', s.onGround && s.pos.z > 20 && s.pos.z < 24);
      await once('02_plank', s.onGround && s.pos.z > 70 && s.pos.z < 74);
    }
  }
  await shot('09_end');
  report[route] = { final: s, shots: [...taken], consoleErrors, pageErrors: await page.evaluate(() => window.__game.errors) };
  await page.close();
}
fs.writeFileSync(path.join(OUT, 'playtest_s1o.json'), JSON.stringify(report, null, 2));
for (const [route, r] of Object.entries(report)) {
  console.log(route, r.final.status, 'deaths', r.final.deaths, 'coins', r.final.coins, 'shots', r.shots.length, 'errors', r.consoleErrors.length, 'pageErrors', r.pageErrors.length);
}
clearTimeout(watchdog);
await browser.close();
server.close();
