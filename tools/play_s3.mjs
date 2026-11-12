// Headless playtest of S3: the scripted player plays ?level=s3 with deterministic stepping; screenshots at the start, just
// after the grapple, mid-swing, in flight and at the end; writes out/playtest_s3.json. Software WebGL: frame rate is NOT valid.
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
  console.error('S3 playtest watchdog: 180 s exceeded, closing');
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

await page.goto(`${base}/?level=s3&autostart&manual&bot`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 90000 });
const report = { level: await page.evaluate(() => window.__game.state.level) };
await shot('s3_00_start.png');

const taken = new Set();
let s = await page.evaluate(() => window.__game.advance(1));
for (let i = 0; i < 1500 && s.status === 'playing'; i++) {
  s = await page.evaluate(() => window.__game.advance(1));
  if (!taken.has('swing') && s.pos.z > 3 && !s.onGround) { taken.add('swing'); report.swing = s; await shot('s3_01_swing.png'); }
  if (!taken.has('low') && s.pos.z > 6 && s.pos.y < -1.8) { taken.add('low'); report.low = s; await shot('s3_02_lowest.png'); }
  if (!taken.has('up') && s.pos.z > 11 && !s.onGround) { taken.add('up'); report.up = s; await shot('s3_03_release.png'); }
}
report.final = s;
await shot('s3_04_end.png');
report.consoleErrors = consoleErrors;
report.pageErrors = await page.evaluate(() => window.__game.errors);
fs.writeFileSync(path.join(OUT, 'playtest_s3.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ level: report.level, final: report.final, shots: [...taken], errors: consoleErrors.length, pageErrors: report.pageErrors.length }, null, 2));
clearTimeout(watchdog);
await browser.close();
server.close();
