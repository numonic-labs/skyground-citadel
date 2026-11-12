// Headless playtest of S6: the scripted player plays ?level=s6 with deterministic stepping; screenshots at the start, on the
// steps, at the guardian, just after the stomp and at the end; writes out/playtest_s6.json.
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
  console.error('S6 playtest watchdog: 180 s exceeded, closing');
  await browser.close().catch(() => {});
  process.exit(3);
}, 180000);

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
const shot = async (name) => {
  for (const dt of [0.25, 0.25, 0.25]) await page.evaluate((d) => window.__game.render(d), dt);
  await page.screenshot({ path: path.join(OUT, name) });
};

await page.goto(`${base}/?level=s6&autostart&manual&bot`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 90000 });
const report = { level: await page.evaluate(() => window.__game.state.level) };
await shot('s6_00_start.png');

const taken = new Set();
const once = async (name, cond, s, file) => {
  if (taken.has(name) || !cond) return;
  taken.add(name);
  report[name] = s;
  await shot(file);
};
let s = await page.evaluate(() => window.__game.advance(1));
for (let i = 0; i < 4800 && s.status === 'playing'; i++) {
  s = await page.evaluate(() => window.__game.advance(1));
  await once('step2', s.pos.z > 27 && s.pos.z < 31 && s.onGround, s, 's6_01_step2.png');
  await once('step4', s.pos.z > 48 && s.pos.z < 52 && s.onGround, s, 's6_02_step4.png');
  await once('summit', s.pos.z > 62 && s.pos.z < 66 && s.onGround, s, 's6_03_summit.png');
  await once('guardian', s.pos.z > 70 && s.pos.z < 73 && s.onGround, s, 's6_04_guardian.png');
  await once('stomped', s.hasKey, s, 's6_05_stomped.png');
}
report.final = s;
await shot('s6_06_end.png');
report.consoleErrors = consoleErrors;
report.pageErrors = await page.evaluate(() => window.__game.errors);
fs.writeFileSync(path.join(OUT, 'playtest_s6.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ level: report.level, final: report.final, shots: [...taken], errors: consoleErrors.length, pageErrors: report.pageErrors.length }, null, 2));
clearTimeout(watchdog);
await browser.close();
server.close();
