// Records a play-through as a video, deterministically: the game is stepped two 60 Hz ticks per frame (30 fps),
// each frame is rendered and screenshotted in headless Chromium (software WebGL, slow but exact), and ffmpeg
// assembles the frames. Because stepping is manual, render speed does not affect the video's timing.
//
// Usage: node tools/record.mjs [scenario] [tag]
//   scenario "forgetful"  : plays gap 3 with single jumps only, falls, respawns at the checkpoint, then clears it
//   scenario "clean"      : plays the whole section with the double jump where needed (default)
// Output: out/<tag>.mp4 (no audio: the game has none yet) and out/<tag>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { start } from '../serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
const scenario = process.argv[2] || 'clean';
const tag = process.argv[3] || `s1_playthrough_${scenario}`;
const FRAMES = path.join(OUT, `frames_${tag}`);
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const FPS = 30;
const TICKS_PER_FRAME = 2; // 60 Hz logic
const MAX_SECONDS = 60;
const HOLD_SECONDS = 2; // linger on the completion banner

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const watchdog = setTimeout(async () => { console.error('record watchdog: 20 min exceeded'); await browser.close().catch(() => {}); process.exit(3); }, 20 * 60 * 1000);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${base}/?level=s1c&autostart&manual&bot`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
if (scenario === 'forgetful') await page.evaluate(() => window.__game.setBotOptions({ doubleJump: false }));

const t0 = Date.now();
let frame = 0;
let switched = false;
let completeFrame = -1;
let state = await page.evaluate(() => window.__game.state);
const shotFrame = async () => {
  await page.evaluate((dt) => window.__game.render(dt), TICKS_PER_FRAME / 60);
  await page.screenshot({ path: path.join(FRAMES, String(frame).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 90 });
  frame += 1;
};
await shotFrame(); // frame 0: the start
while (frame < MAX_SECONDS * FPS) {
  state = await page.evaluate((n) => window.__game.advance(n), TICKS_PER_FRAME);
  if (scenario === 'forgetful' && !switched && state.deaths >= 1) {
    switched = true;
    await page.evaluate(() => window.__game.setBotOptions({}));
  }
  await shotFrame();
  if (frame === 30) console.log(`first 30 frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (state.status === 'complete') {
    if (completeFrame < 0) completeFrame = frame;
    if (frame - completeFrame >= HOLD_SECONDS * FPS) break;
  }
}
const captureSeconds = (Date.now() - t0) / 1000;

const mp4 = path.join(OUT, `${tag}.mp4`);
const ff = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (ff.status !== 0) { console.error('ffmpeg failed:', ff.stderr); process.exit(2); }
const meta = {
  scenario, frames: frame, fps: FPS, videoSeconds: +(frame / FPS).toFixed(2), captureSeconds: +captureSeconds.toFixed(1),
  final: state, consoleErrors: errors, pageErrors: await page.evaluate(() => window.__game.errors),
  note: 'No audio (the game has none). Rendered with software WebGL, so the video shows correct motion and timing but not real-GPU rendering quality or frame rate.',
};
fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(meta, null, 2));
fs.rmSync(FRAMES, { recursive: true, force: true });
console.log(JSON.stringify({ mp4: path.relative(ROOT, mp4), ...meta, final: { status: state.status, t: state.t, deaths: state.deaths, coins: state.coins, coinsTotal: state.coinsTotal } }, null, 2));

clearTimeout(watchdog);
await browser.close();
server.close();
