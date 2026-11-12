// Headless check of the real input path (the other tools drive the game through window.__game and never press a key):
// the title shows and plays music after a first key, Enter starts the game, the arrow keys move Kai, Space jumps, X throws the wave, P pauses and resumes, M mutes, and nothing logs an
// error. Software WebGL is slow, so this waits on game time, not wall time.
import { chromium } from 'playwright-core';
import { start } from '../serve.mjs';

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const watchdog = setTimeout(async () => {
  console.error('input smoke watchdog: 420 s exceeded');
  await browser.close().catch(() => {});
  process.exit(3);
}, 420000);
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`${base}/?shadows=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready);
const st = () => page.evaluate(() => ({ ...window.__game.state, banner: !document.getElementById('banner').hidden, hud: !document.getElementById('hud').hidden, toast: document.getElementById('toast').textContent }));
const waitT = (t) => page.waitForFunction((x) => window.__game.state.t >= x, t);
const results = {};
const check = (name, ok, detail = '') => {
  results[name] = ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
};

let s = await st();
check('title is showing and the game has not started', s.banner && !s.hud && s.t === 0);
await page.keyboard.press('KeyK');
await page.waitForTimeout(600);
s = await st();
check('the first key wakes the sound and keeps the title (so the title has music)', s.banner && s.t === 0 && (await page.evaluate(() => window.__game.titleWoke() && window.__game.audio.available)));
check('the title music is playing', await page.evaluate(() => window.__game.audio.musicState.on && window.__game.audio.musicState.playing === 'title'));
await page.keyboard.press('Enter');
await waitT(0.2);
s = await st();
check('Enter starts the game and hides the title', !s.banner && s.hud && s.t > 0);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('Enter at the start way-crystal says no other crystal is reached yet', (await st()).toast.includes('way-crystal'));
await page.keyboard.down('ArrowUp');
await waitT(1.2);
s = await st();
check('ArrowUp runs Kai forward', s.pos.z > -1, `z=${s.pos.z}`);
await page.keyboard.down('Space');
await page.waitForFunction(() => !window.__game.state.onGround);
s = await st();
check('Space jumps', !s.onGround && s.pos.y > 0, `y=${s.pos.y}`);
await page.keyboard.up('Space');
await page.keyboard.up('ArrowUp');
await page.waitForFunction(() => window.__game.state.onGround);
await page.keyboard.press('KeyP');
const t0 = (await st()).t;
await page.waitForTimeout(1500);
s = await st();
check('P pauses (game time stands still, the pause card shows)', s.t === t0 && s.banner, `t=${s.t}`);
await page.keyboard.press('KeyP');
await waitT(t0 + 0.2);
s = await st();
check('P resumes', s.t > t0 && !s.banner);
await page.keyboard.down('KeyX');
await page.waitForFunction(() => window.__game.state.waveCd > 0 || window.__game.state.carrying);
await page.keyboard.up('KeyX');
s = await st();
check('X uses Kai\'s hand (a gust, or picking up a creature within reach)', s.waveCd > 0 || !!s.carrying, s.carrying ? `picked up a ${s.carrying}` : 'gust');
// M by the letter on the key, wherever it sits: on AZERTY the M key reports the position code "Semicolon".
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'Semicolon' })));
check('M mutes (AZERTY position)', await page.evaluate(() => window.__game.audio.muted));
await page.keyboard.press('m');
check('M again restores sound (QWERTY position)', !(await page.evaluate(() => window.__game.audio.muted)));
const pitch0 = await page.evaluate(() => window.__game.getCamPitch());
await page.keyboard.down('KeyG');
await page.waitForFunction((p0) => window.__game.getCamPitch() > p0 + 0.05, pitch0);
await page.keyboard.up('KeyG');
check('G tilts the camera down', (await page.evaluate(() => window.__game.getCamPitch())) > pitch0);

check('audio started after a key press', await page.evaluate(() => window.__game.audio.available));
const pageErrors = await page.evaluate(() => window.__game.errors);
check('no errors logged', errors.length === 0 && pageErrors.length === 0, [...errors, ...pageErrors].join(' | '));
clearTimeout(watchdog);
await browser.close();
server.close();
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
