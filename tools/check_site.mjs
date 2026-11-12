// Check the built site (tools/build_site.mjs) the way a visitor's browser would load it: `node tools/check_site.mjs [siteDir]`.
// Serves the folder alone (no node_modules beside it), loads the title screen in headless Chromium, and fails on any request
// that does not return 200, any console or page error, or a game that never becomes ready. Then it starts the level, runs the
// scripted player for a few seconds and saves out/site_title.png and out/site_play.png.
// Software WebGL: this says the files are complete and the game runs, not how fast.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from '../serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.resolve(process.argv[2] || path.join(ROOT, 'site'));
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(SITE, 'index.html'))) {
  console.error('no built site at ' + SITE + ': run node tools/build_site.mjs first');
  process.exit(2);
}

const server = await start(0, SITE);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const problems = [];
let requests = 0;
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(240000);
  page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    requests += 1;
    if (r.status() !== 200) problems.push(`${r.status()} ${r.url().replace(base, '')}`);
  });
  await page.goto(`${base}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 });
  return page;
}

let result = {};
try {
  // 1. The title screen as a visitor sees it.
  const title = await open('?manual');
  result.title = await title.evaluate(() => document.title);
  result.logo = await title.evaluate(() => document.querySelector('#banner .logo')?.textContent);
  result.community = await title.evaluate(() => document.getElementById('community')?.href || '');
  await title.evaluate(() => window.__game.render());
  await title.screenshot({ path: path.join(OUT, 'site_title.png') });
  await title.close();
  // 2. The level, driven by the scripted player.
  const play = await open('?autostart&bot&manual');
  const z0 = await play.evaluate(() => window.__game.state.pos.z);
  await play.evaluate(() => window.__game.advance(600, false));
  await play.evaluate(() => window.__game.render());
  result.advancedMetres = Math.round(((await play.evaluate(() => window.__game.state.pos.z)) - z0) * 10) / 10;
  result.renderInfo = await play.evaluate(() => window.__game.renderInfo && window.__game.renderInfo());
  await play.screenshot({ path: path.join(OUT, 'site_play.png') });
  await play.close();
} catch (e) {
  problems.push('check failed: ' + e.message);
}
await browser.close();
server.close();

result.requests = requests;
result.problems = problems;
console.log(JSON.stringify(result, null, 1));
const ok = problems.length === 0 && result.advancedMetres > 20;
console.log(ok ? 'SITE OK' : 'SITE NOT OK');
process.exit(ok ? 0 : 1);
