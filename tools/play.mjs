// Headless playtest: serves the game, drives it with the scripted player and deterministic stepping,
// takes screenshots, and writes out/playtest.json. Software WebGL, so frame rate here is NOT meaningful;
// what it checks is that the page loads, the model animates, the course is completable, and nothing throws.
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
// Watchdog: never hang the caller (a software-rendered page can stall).
const watchdog = setTimeout(async () => {
  console.error('playtest watchdog: 150 s exceeded, closing');
  await browser.close().catch(() => {});
  process.exit(3);
}, 150000);

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
const consoleWarnings = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
  if (m.type() === 'warning') consoleWarnings.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

const report = { startedAt: new Date().toISOString(), base, shots: [], notes: [] };
const t0 = Date.now();
const shot = async (name, settle = true) => {
  if (settle) {
    // Let the animation mixer settle into the current pose: a few draws with growing time steps.
    for (const dt of [0.25, 0.25, 0.25]) await page.evaluate((d) => window.__game.render(d), dt);
  } else {
    await page.evaluate(() => window.__game.render(0));
  }
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  report.shots.push({ file: path.relative(ROOT, file), atMs: Date.now() - t0 });
};

await page.goto(`${base}/?level=s1c&autostart&manual&bot`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
report.kai = await page.evaluate(() => window.__game.kai);
await shot('s1_00_start.png', false);

// Run along P0, screenshot mid-run, then step until Kai is airborne over the first gap.
let s = await page.evaluate(() => window.__game.advance(150));
await shot('s1_01_running.png');
for (let i = 0; i < 600 && !(s.pos.z > 22.8 && !s.onGround); i++) s = await page.evaluate(() => window.__game.advance(1));
report.overFirstGap = s;
await shot('s1_02_over_first_gap.png');

// Finish the section.
for (let i = 0; i < 600 && s.status === 'playing'; i++) s = await page.evaluate(() => window.__game.advance(10));
report.final = s;
await shot('s1_03_end.png');

// Scenario 2: a human-style double jump with real key presses. Jump 3 m before the first edge (which falls
// without a second jump), then press jump again at the apex.
await page.goto(`${base}/?level=s1c&autostart&manual`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
await page.keyboard.down('ArrowUp');
let d = await page.evaluate(() => window.__game.advance(1));
for (let i = 0; i < 600 && d.pos.z < 19.0; i++) d = await page.evaluate(() => window.__game.advance(1));
const jumpStartZ = d.pos.z;
await page.keyboard.down('Space');
for (let i = 0; i < 40 && d.vel.y >= 0; i++) d = await page.evaluate(() => window.__game.advance(1));
await page.keyboard.up('Space');
d = await page.evaluate(() => window.__game.advance(1)); // release for a frame at the apex
await page.keyboard.down('Space'); // second press
d = await page.evaluate(() => window.__game.advance(1));
const afterSecond = d;
for (let i = 0; i < 6; i++) await page.evaluate(() => window.__game.advance(3));
await shot('s1_04_double_jump.png');
const animDuring = await page.evaluate(() => window.__game.state.anim);
await page.keyboard.up('Space');
for (let i = 0; i < 300 && d.pos.z < 30; i++) d = await page.evaluate(() => window.__game.advance(2));
report.doubleJump = { jumpStartZ: +jumpStartZ.toFixed(2), velYAfterSecondPress: afterSecond.vel.y, animDuringFlip: animDuring, endZ: d.pos.z, deaths: d.deaths, onGround: d.onGround };
await page.keyboard.up('ArrowUp');

report.consoleErrors = consoleErrors;
report.consoleWarnings = consoleWarnings;
report.pageErrors = await page.evaluate(() => window.__game.errors);
report.gameWarnings = await page.evaluate(() => window.__game.warnings);
report.elapsedMs = Date.now() - t0;
report.notes.push('Software rendering: frame rate and render timing are not valid. Use ?perf=30 on a real GPU browser.');
fs.writeFileSync(path.join(OUT, 'playtest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ kai: report.kai, final: report.final, errors: consoleErrors.length, pageErrors: report.pageErrors.length, warnings: consoleWarnings.length + report.gameWarnings.length, elapsedMs: report.elapsedMs }, null, 2));

clearTimeout(watchdog);
await browser.close();
server.close();
