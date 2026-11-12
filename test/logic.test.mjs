import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE } from '../src/course.mjs';
import { PARAMS, createState, step, autopilot, simulate } from '../src/logic.mjs';

const idle = () => ({ fwd: 0, right: 0, jump: false });
const forward = () => ({ fwd: 1, right: 0, jump: false });

test('standing still stays grounded on the start platform', () => {
  const s = simulate(COURSE, idle, 3);
  assert.equal(s.onGround, true);
  assert.equal(s.y, 0);
  assert.equal(s.deaths, 0);
});

test('running forward without jumping falls into the first gap and respawns at the start checkpoint', () => {
  const s = simulate(COURSE, forward, 8);
  assert.ok(s.deaths >= 1, 'expected at least one fall');
  assert.equal(s.checkpoint, 0);
});

test('the autopilot clears both gaps and completes S1 without dying', () => {
  const s = simulate(COURSE, autopilot, 30);
  assert.equal(s.status, 'complete');
  assert.equal(s.deaths, 0);
  assert.ok(s.z >= COURSE.goal.z);
});

test('the autopilot collects the coins along the line it runs', () => {
  const s = simulate(COURSE, autopilot, 30);
  // Coins off the autopilot line (|x| = 1.5 on the wide platform) are skipped; every centre-line coin counts.
  const centreLine = COURSE.coins.filter((c) => Math.abs(c.x) < 0.5).length;
  assert.equal(s.coins, centreLine, `collected ${s.coins} of ${centreLine} centre-line coins`);
  assert.ok(s.coins < COURSE.coins.length);
});

// Reach on the flat at run speed: a full single jump, and a full jump plus a double jump at the apex.
const GAPS = COURSE.platforms.slice(1).map((p, i) => p.z0 - COURSE.platforms[i].z1);
const SINGLE_REACH = ((2 * PARAMS.jumpSpeed) / PARAMS.gravity) * PARAMS.runSpeed;
const DOUBLE_REACH = (() => {
  const g = PARAMS.gravity;
  const rise1 = PARAMS.jumpSpeed / g; // time to the first apex
  const h1 = PARAMS.jumpSpeed ** 2 / (2 * g);
  const rise2 = PARAMS.doubleJumpSpeed / g;
  const h2 = h1 + PARAMS.doubleJumpSpeed ** 2 / (2 * g);
  return (rise1 + rise2 + Math.sqrt((2 * h2) / g)) * PARAMS.runSpeed;
})();

test('gaps 1 and 2 are clearable with a single jump and gap 3 needs a double jump; none can be walked', () => {
  assert.equal(GAPS.length, 3);
  for (const g of GAPS) assert.ok(g > 0.5, 'a gap that short could be walked');
  assert.ok(GAPS[0] < SINGLE_REACH - 0.3, `gap 1 ${GAPS[0]} vs single reach ${SINGLE_REACH.toFixed(2)}`);
  assert.ok(GAPS[1] < SINGLE_REACH - 0.3, `gap 2 ${GAPS[1]} vs single reach ${SINGLE_REACH.toFixed(2)}`);
  assert.ok(GAPS[2] > SINGLE_REACH + 0.5, `gap 3 ${GAPS[2]} should exceed single reach ${SINGLE_REACH.toFixed(2)}`);
  assert.ok(GAPS[2] < DOUBLE_REACH - 0.8, `gap 3 ${GAPS[2]} vs double reach ${DOUBLE_REACH.toFixed(2)}`);
});

test('a player who only ever single-jumps cannot finish: gap 3 always drops them', () => {
  const singleOnly = (s, course) => autopilot(s, course, { doubleJump: false });
  const s = simulate(COURSE, singleOnly, 40);
  assert.ok(s.deaths >= 1, `expected falls, got ${s.deaths}`);
  assert.notEqual(s.status, 'complete');
  assert.equal(s.checkpoint, 2, 'the fall should respawn at the checkpoint before gap 3');
});

test('drifting sideways on the unrailed plank falls', () => {
  const s = createState(COURSE);
  const plank = COURSE.platforms[3];
  s.x = 0; s.z = plank.z0 + 1; s.y = 0; s.checkpoint = 3;
  let fell = false;
  for (let n = 0; n < 240 && !fell; n++) {
    step(s, { fwd: 0, right: 1, jump: false }, COURSE); // right = world -x, off the plank edge
    if (s.events.includes('respawn')) fell = true;
  }
  assert.ok(fell, 'walking off the side of the plank should respawn Kai');
  assert.equal(s.z, COURSE.checkpoints[3].z);
});

test('jumping early (well before the edge) lands short and falls', () => {
  const early = (s, course) => {
    const i = autopilot(s, course, { doubleJump: false });
    // Jump 3 m before the edge of P0 instead of at the edge (a single jump only).
    if (s.onGround && course.platforms[0].z1 - s.z < 3.2 && s.z < course.platforms[0].z1 - 2.5) i.jump = true;
    return i;
  };
  const s = simulate(COURSE, early, 12);
  // A jump 3 m before the edge lands at about z=24, inside the 22-26 gap, every time.
  assert.ok(s.deaths >= 1, `expected a fall, got ${s.deaths} deaths`);
  assert.notEqual(s.status, 'complete');
});

// A player who jumps 3 m before the edge and double-jumps at the apex (release, then press again).
function earlyDoubleJumper() {
  let phase = 'run';
  let released = false;
  return (s, course) => {
    const i = { fwd: 1, right: Math.max(-1, Math.min(1, s.x * 2)), jump: false };
    const edge = course.platforms[0].z1;
    if (phase === 'run' && s.onGround && edge - s.z < 3.2) { i.jump = true; phase = 'rising'; return i; }
    if (phase === 'rising') {
      if (s.vy > 0) { i.jump = true; return i; } // hold for the full first jump
      phase = 'apex'; released = false; return i; // release one frame at the top
    }
    if (phase === 'apex') {
      if (!released) { released = true; return i; }
      i.jump = true; phase = 'done'; return i; // second press
    }
    if (phase === 'done' && s.vy > 0) i.jump = true;
    return i;
  };
}

test('a double jump from 3 m before the edge clears the first gap, where a single jump falls', () => {
  const s = createState(COURSE);
  const player = earlyDoubleJumper();
  let doubleJumps = 0;
  for (let n = 0; n < 60 * 6 && s.deaths === 0 && s.z < 30; n++) {
    step(s, player(s, COURSE), COURSE);
    if (s.events.includes('doublejump')) doubleJumps += 1;
  }
  assert.equal(doubleJumps, 1);
  assert.equal(s.deaths, 0, 'fell despite the double jump');
  assert.ok(s.z >= 26, `did not reach the second platform (z=${s.z.toFixed(2)})`);
});

test('there is exactly one air jump: extra presses in the air do nothing', () => {
  const s = createState(COURSE);
  let doubles = 0;
  let toggle = false;
  let jumped = false;
  for (let n = 0; n < 60 * 3; n++) {
    toggle = !toggle; // press, release, press, release ... as fast as possible
    step(s, { fwd: 0, right: 0, jump: toggle }, COURSE);
    if (s.events.includes('jump')) jumped = true;
    if (s.events.includes('doublejump')) doubles += 1;
    if (jumped && s.events.includes('land')) break; // one airborne period only
  }
  assert.ok(jumped, 'never left the ground');
  assert.equal(doubles, 1);
});

test('landing restores the air jump', () => {
  const s = createState(COURSE);
  step(s, { fwd: 0, right: 0, jump: true }, COURSE); // ground jump
  step(s, { fwd: 0, right: 0, jump: false }, COURSE);
  step(s, { fwd: 0, right: 0, jump: true }, COURSE); // double jump
  assert.equal(s.airJumps, 0);
  for (let n = 0; n < 200 && !s.onGround; n++) step(s, { fwd: 0, right: 0, jump: false }, COURSE);
  assert.equal(s.onGround, true);
  assert.equal(s.airJumps, PARAMS.airJumps);
});

test('fenced platforms keep Kai inside the rails', () => {
  const left = () => ({ fwd: 0, right: -1, jump: false }); // -right = +x
  const s = simulate(COURSE, left, 3);
  assert.ok(s.x <= COURSE.platforms[0].x1 - PARAMS.fenceMargin + 1e-9);
  assert.equal(s.deaths, 0);
});

test('the same inputs always produce the same final state (deterministic)', () => {
  const a = simulate(COURSE, autopilot, 30);
  const b = simulate(COURSE, autopilot, 30);
  assert.deepEqual({ ...a, events: [] }, { ...b, events: [] });
});

test('checkpoints advance as Kai moves along and are used on respawn', () => {
  const s = createState(COURSE);
  // Place Kai past the second checkpoint on P1, then run off the end of P1 into the gap.
  s.z = 40;
  s.x = 0;
  s.checkpoint = 1;
  let died = false;
  for (let i = 0; i < 600 && !died; i++) {
    step(s, forward(), COURSE);
    if (s.events.includes('respawn')) died = true;
  }
  assert.ok(died);
  assert.equal(s.z, COURSE.checkpoints[1].z);
  assert.equal(s.deaths, 1);
});
