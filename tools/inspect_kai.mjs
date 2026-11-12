// Close-up inspection of the character in chosen clips and angles (headless, software WebGL).
// Usage: node tools/inspect_kai.mjs [tag]   -> out/inspect_<tag>_<shot>.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from '../serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });
const tag = process.argv[2] || 'kai';

// Kai stands at the start (0, 0, 2) facing +Z. Positions are metres.
const SHOTS = [
  { name: 'back_run', pose: ['run', 0.3], cam: [0.3, 1.5, -0.7], look: [0, 1.0, 2.2] },
  { name: 'rear34_run', pose: ['run', 0.3], cam: [-2.0, 1.5, 0.0], look: [0, 1.0, 2.0] },
  { name: 'back_jump', pose: ['jump', 1.0], cam: [0.3, 1.6, -0.7], look: [0, 1.1, 2.2] },
  { name: 'rear34_jump', pose: ['jump', 1.0], cam: [-2.2, 1.6, 0.0], look: [0, 1.1, 2.0] },
  { name: 'rear34_flip', pose: ['flip', 1.0], cam: [-2.2, 1.6, 0.0], look: [0, 1.1, 2.0] },
  { name: 'front_idle', pose: ['idle', 0], cam: [0.6, 1.4, 5.2], look: [0, 1.0, 2.0] },
];

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const watchdog = setTimeout(async () => { await browser.close().catch(() => {}); process.exit(3); }, 120000);
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(`${base}/?autostart&manual`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
for (const s of SHOTS) {
  await page.evaluate(({ s }) => { window.__game.poseKai(...s.pose); window.__game.setCamera(s.cam, s.look); window.__game.render(0); }, { s });
  const file = path.join(OUT, `inspect_${tag}_${s.name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
clearTimeout(watchdog);
await browser.close();
server.close();
