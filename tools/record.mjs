// Records a play-through as a video, deterministically: the game is stepped two 60 Hz ticks per frame (30 fps),
// each frame is rendered and screenshotted in headless Chromium (software WebGL, slow but exact), and ffmpeg
// assembles the frames. Because stepping is manual, render speed does not affect the video's timing.
//
// Usage: node tools/record.mjs [scenario] [tag]
//   scenario "forgetful"  : plays gap 3 with single jumps only, falls, respawns at the checkpoint, then clears it
//   scenario "clean"      : plays the whole section with the double jump where needed (default)
//   scenario "world"      : the whole journey by the scripted player, including the errand to Ossa, the Granmoss
// Environment (all optional): RECORD_RUN (the world's run seed, default 5), RECORD_W and RECORD_H (default 1280x720),
// RECORD_FPS (default 30), RECORD_SECONDS (cap), RECORD_CRF (default 18), RECORD_JPEG (screenshot quality, default 90).
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

const FPS = Number(process.env.RECORD_FPS || 30);
const TICKS_PER_FRAME = Math.round(60 / FPS); // 60 Hz logic
const MAX_SECONDS = Number(process.env.RECORD_SECONDS || (scenario === 'world' ? 300 : 60));
const W = Number(process.env.RECORD_W || 1280);
const H = Number(process.env.RECORD_H || 720);
const RUN = Number(process.env.RECORD_RUN || 5);
const CRF = String(process.env.RECORD_CRF || 18);
const JPEG = Number(process.env.RECORD_JPEG || 90);
const HOLD_SECONDS = 2; // linger on the completion banner

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const WATCHDOG_MIN = Number(process.env.RECORD_WATCHDOG_MIN || 20); // software rendering is slow: the whole world run needs about 60
const watchdog = setTimeout(async () => { console.error(`record watchdog: ${WATCHDOG_MIN} min exceeded`); await browser.close().catch(() => {}); process.exit(3); }, WATCHDOG_MIN * 60 * 1000);
// Lay the game out at a normal window width (RECORD_LAYOUT_W, default 1280) and scale the picture down to W by H with the device
// scale factor: a 640 px wide window makes the on-screen messages overflow, and a smaller canvas is cheaper to render too.
const LAYOUT_W = Math.max(W, Number(process.env.RECORD_LAYOUT_W || 1280));
const page = await browser.newPage({ viewport: { width: LAYOUT_W, height: Math.round((LAYOUT_W * H) / W) }, deviceScaleFactor: W / LAYOUT_W });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const url = scenario === 'world' ? `${base}/?autostart&manual&bot&run=${RUN}` : `${base}/?level=s1c&autostart&manual&bot`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
if (scenario === 'forgetful') await page.evaluate(() => window.__game.setBotOptions({ doubleJump: false }));

const t0 = Date.now();
let frame = 0;
let switched = false;
let completeFrame = -1;
let state = await page.evaluate(() => window.__game.state);
const shotFrame = async () => {
  await page.evaluate((dt) => window.__game.render(dt), TICKS_PER_FRAME / 60);
  await page.screenshot({ path: path.join(FRAMES, String(frame).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: JPEG });
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
const ff = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', CRF, '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (ff.status !== 0) { console.error('ffmpeg failed:', ff.stderr); process.exit(2); }
const meta = {
  scenario, run: scenario === 'world' ? RUN : undefined, width: W, height: H, frames: frame, fps: FPS, videoSeconds: +(frame / FPS).toFixed(2), captureSeconds: +captureSeconds.toFixed(1),
  final: state, consoleErrors: errors, pageErrors: await page.evaluate(() => window.__game.errors),
  note: 'No audio (the game has none). Rendered with software WebGL, so the video shows correct motion and timing but not real-GPU rendering quality or frame rate.',
};
fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(meta, null, 2));
fs.rmSync(FRAMES, { recursive: true, force: true });
console.log(JSON.stringify({ mp4: path.relative(ROOT, mp4), ...meta, final: { status: state.status, t: state.t, deaths: state.deaths, coins: state.coins, coinsTotal: state.coinsTotal } }, null, 2));

clearTimeout(watchdog);
await browser.close();
server.close();
