// Headless playtest of S2: the scripted player plays ?level=s2 with deterministic stepping; screenshots at the spring
// launch, on the boardwalk beside the flyer, on the raft and at the dock; writes out/playtest_s2.json.
// Software WebGL: frame rate is NOT meaningful here.
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
  console.error('S2 playtest watchdog: 180 s exceeded, closing');
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

await page.goto(`${base}/?level=s2&autostart&manual&bot`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
const report = { level: await page.evaluate(() => window.__game.state.level) };
await shot('s2_00_start.png');

const taken = new Set();
let s = await page.evaluate(() => window.__game.advance(1));
for (let i = 0; i < 4000 && s.status === 'playing'; i++) {
  s = await page.evaluate(() => window.__game.advance(1));
  if (!taken.has('spring') && s.vel.y > 12) { taken.add('spring'); report.spring = s; await shot('s2_01_spring.png'); }
  if (!taken.has('walk') && s.pos.z > 49 && s.onGround) { taken.add('walk'); report.boardwalk = s; await shot('s2_02_boardwalk.png'); }
  if (!taken.has('raft') && s.pos.z > 79 && s.onGround && s.pos.z < 90) { taken.add('raft'); report.raft = s; await shot('s2_03_raft.png'); }
}
report.final = s;
await shot('s2_04_end.png');
report.consoleErrors = consoleErrors;
report.pageErrors = await page.evaluate(() => window.__game.errors);
fs.writeFileSync(path.join(OUT, 'playtest_s2.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ level: report.level, final: report.final, shots: [...taken], errors: consoleErrors.length, pageErrors: report.pageErrors.length }, null, 2));
clearTimeout(watchdog);
await browser.close();
server.close();
