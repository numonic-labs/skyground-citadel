// Tests for S2: spring pad, patrolling flyer with hearts, sliding raft. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_S2 as C } from '../src/course.s2.mjs';
import { PARAMS, createState, step, autopilot, platformBounds, enemyPos } from '../src/logic.mjs';

const raft = C.platforms.find((p) => p.id === 'raft');
const boardwalk = C.platforms.find((p) => p.id === 'boardwalk');
const dock = C.platforms.find((p) => p.id === 'dock');
const plateau = C.platforms.find((p) => p.id === 'plateau');

function run(options, seconds = 60) {
  const s = createState(C);
  for (let i = 0; i < Math.round(seconds / PARAMS.dt) && s.status === 'playing'; i++) {
    step(s, autopilot(s, C, options), C);
  }
  return s;
}

test('the scripted player completes S2 with no deaths and no hits', () => {
  const s = run({});
  assert.equal(s.status, 'complete');
  assert.equal(s.deaths, 0);
  assert.equal(s.hits, 0);
});

test('the first gap (9 m) cannot be crossed without the spring pad, even with a double jump', () => {
  assert.ok(boardwalk.z0 - plateau.z1 > 8.6, 'gap is wider than the double-jump reach');
  // Run along x=3, which misses the pad (radius 1.1 at x=0): jump at the edge, double jump at the apex.
  const s = run({ aimX: 3 }, 40);
  assert.equal(s.checkpoint, 0, 'never reaches the boardwalk');
  assert.ok(s.deaths >= 1);
});

test('the spring launches to its full height even when jump is not held, and a double jump never lowers it', () => {
  const s = createState(C);
  s.x = 0; s.z = C.springs[0].z - 0.05; // just before the pad, on the ground
  let peak = 0;
  let sprang = false;
  for (let i = 0; i < 200; i++) {
    // Press jump on the frame right after the launch: the double jump must not cut the launch speed.
    const inp = { fwd: 1, right: 0, jump: sprang && i < 40 && i % 2 === 0 };
    step(s, inp, C);
    if (s.events.includes('spring')) sprang = true;
    peak = Math.max(peak, s.y);
  }
  assert.ok(sprang, 'the pad fired');
  const expected = (C.springs[0].boost ** 2) / (2 * PARAMS.gravity); // 6.75 m
  assert.ok(peak >= expected - 0.2, `peak ${peak.toFixed(2)} m reaches the spring apex ${expected.toFixed(2)} m`);
});

test('the spring carries a plain straight run onto the boardwalk', () => {
  const s = createState(C);
  for (let i = 0; i < 60 * 12 && s.checkpoint < 1; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.equal(s.checkpoint, 1, 'reaches the boardwalk checkpoint');
  assert.equal(s.deaths, 0);
});

test('the raft slides: its gap to the boardwalk and to the dock both swing between 3.5 m and 9.5 m', () => {
  let minNear = Infinity, maxNear = -Infinity, minFar = Infinity, maxFar = -Infinity;
  for (let t = 0; t < raft.move.period; t += 0.05) {
    const b = platformBounds(raft, t);
    const near = b.z0 - boardwalk.z1;
    const far = dock.z0 - b.z1;
    minNear = Math.min(minNear, near); maxNear = Math.max(maxNear, near);
    minFar = Math.min(minFar, far); maxFar = Math.max(maxFar, far);
  }
  assert.ok(Math.abs(minNear - 3.5) < 0.1 && Math.abs(maxNear - 9.5) < 0.1);
  assert.ok(Math.abs(minFar - 3.5) < 0.1 && Math.abs(maxFar - 9.5) < 0.1);
});

test('a moving raft carries Kai along with it', () => {
  const s = createState(C);
  s.t = 2; // the raft is mid-slide
  const b = platformBounds(raft, s.t);
  s.x = 0; s.z = (b.z0 + b.z1) / 2; s.y = 0; s.standing = 'raft'; s.onGround = true;
  const z0 = s.z;
  const o0 = platformBounds(raft, s.t).z0;
  for (let i = 0; i < 60; i++) step(s, { fwd: 0, right: 0, jump: false }, C);
  const moved = platformBounds(raft, s.t).z0 - o0;
  assert.ok(Math.abs(moved) > 1, 'the raft actually moved');
  assert.ok(Math.abs(s.z - z0 - moved) < 0.2, `Kai moved ${(s.z - z0).toFixed(2)} m with the raft's ${moved.toFixed(2)} m`);
  assert.equal(s.standing, 'raft');
});

test('stepping off the boardwalk when the raft is far falls into the river', () => {
  const s = createState(C);
  // t = 4: the raft is at its far end (z0 about 81.5), 9.5 m from the boardwalk.
  s.t = 4; s.z = boardwalk.z1 - 0.5; s.x = 0; s.standing = 'boardwalk';
  for (let i = 0; i < 60 * 4 && s.deaths === 0; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(s.deaths >= 1);
});

test('a flyer hit costs a heart, knocks Kai back, and a grace period prevents a second hit', () => {
  const s = createState(C);
  const e = C.enemies[0];
  s.t = 0; s.x = e.x; s.z = e.z; s.y = 0; s.standing = 'boardwalk'; s.checkpoint = 1;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.hearts, PARAMS.hearts - 1);
  assert.ok(s.events.includes('hurt'));
  assert.ok(s.vz < 0 && s.vy > 0, 'knocked back and up');
  // Teleport Kai onto the flyer again inside the grace period: no further damage.
  const p = enemyPos(e, s.t);
  s.x = p.x; s.z = p.z; s.y = 0;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.hearts, PARAMS.hearts - 1);
});

test('losing the last heart respawns Kai at the checkpoint with full hearts', () => {
  const s = createState(C);
  const e = C.enemies[0];
  s.t = 0; s.x = e.x; s.z = e.z; s.y = 0; s.standing = 'boardwalk'; s.checkpoint = 1; s.hearts = 1;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.deaths, 1);
  assert.equal(s.hearts, PARAMS.hearts);
  assert.equal(s.z, C.checkpoints[1].z);
  assert.ok(s.events.includes('respawn'));
});

test('the flyer is real: a player standing in its path is hit within one patrol period', () => {
  const s = createState(C);
  s.x = 0; s.z = C.enemies[0].z; s.y = 0; s.standing = 'boardwalk'; s.checkpoint = 1;
  s.t = 0.6; // the flyer is off to one side and sweeps back across x=0
  for (let i = 0; i < Math.round((C.enemies[0].period + 0.2) / PARAMS.dt) && s.hits === 0; i++) {
    s.x = 0; s.z = C.enemies[0].z; // hold Kai in place on the boardwalk
    step(s, { fwd: 0, right: 0, jump: false }, C);
  }
  assert.ok(s.hits >= 1);
});

test('jumping clears the flyer (its top is below a single jump apex)', () => {
  const e = C.enemies[0];
  const top = e.y + e.r;
  const apex = PARAMS.jumpSpeed ** 2 / (2 * PARAMS.gravity);
  assert.ok(top + 0.2 < apex, `flyer top ${top} m is under the ${apex.toFixed(2)} m jump apex`);
});

test('every ground coin lies over a platform at some time', () => {
  for (const c of C.coins.filter((q) => q.y <= 1.0)) {
    let over = false;
    for (let t = 0; t < raft.move.period && !over; t += 0.25) {
      over = C.platforms.some((p) => {
        const b = platformBounds(p, t);
        return c.x >= b.x0 && c.x <= b.x1 && c.z >= b.z0 && c.z <= b.z1;
      });
    }
    assert.ok(over, `coin at z=${c.z} floats over nothing`);
  }
});

test('S2 is deterministic: the same inputs give the same final state', () => {
  const a = run({});
  const b = run({});
  assert.equal(a.t, b.t);
  assert.equal(a.coins, b.coins);
  assert.equal(a.z, b.z);
});

test('running into the pad steps Kai up onto the cushion and launches him from its top', () => {
  const s = createState(C);
  const sp = C.springs[0];
  s.x = 0; s.z = sp.z - 3; s.y = 0; s.standing = 'plateau';
  let fired = false;
  let yAtLaunch = -1;
  for (let i = 0; i < 120 && !fired; i++) {
    step(s, { fwd: 1, right: 0, jump: false }, C);
    if (s.events.includes('spring')) { fired = true; yAtLaunch = s.y; }
  }
  assert.ok(fired, 'the pad fired');
  assert.ok(yAtLaunch >= sp.h - 1e-9, `Kai is at or above the cushion top (${yAtLaunch.toFixed(2)} m, cushion ${sp.h} m), not inside the pad`);
  assert.ok(s.vy > 15, 'launched upward');
});

test('landing on the pad from above launches Kai, passing high over it does not', () => {
  const sp = C.springs[0];
  const high = createState(C);
  high.x = sp.x; high.z = sp.z; high.y = 2.5; high.vy = 0; high.onGround = false; high.standing = null;
  step(high, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(!high.events.includes('spring'), 'above the cushion: no launch');

  const low = createState(C);
  low.x = sp.x; low.z = sp.z; low.y = 1.2; low.vy = -4; low.onGround = false; low.standing = null;
  let fired = false;
  for (let i = 0; i < 40 && !fired; i++) {
    step(low, { fwd: 0, right: 0, jump: false }, C);
    fired = low.events.includes('spring');
  }
  assert.ok(fired, 'coming down onto the cushion launches');
});

test('the spring still carries a plain straight run onto the boardwalk after the cushion height was added', () => {
  const s = createState(C);
  for (let i = 0; i < 60 * 12 && s.checkpoint < 1; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.equal(s.checkpoint, 1);
  assert.equal(s.deaths, 0);
});
