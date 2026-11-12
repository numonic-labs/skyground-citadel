// Tests for S4: the key, the gate and the grind rail. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_S4 as C } from '../src/course.s4.mjs';
import { PARAMS, createState, step, autopilot, railY, enemyPos } from '../src/logic.mjs';

const H = PARAMS.hangReach;
const enemyPosZ = (t) => enemyPos(C.enemies[2], t).z;

const rail = C.rails[0];
const islandA = C.platforms.find((p) => p.id === 'islandA');
const islandB = C.platforms.find((p) => p.id === 'islandB');

function run(options, seconds = 60) {
  const s = createState(C);
  for (let i = 0; i < Math.round(seconds / PARAMS.dt) && s.status === 'playing'; i++) step(s, autopilot(s, C, options), C);
  return s;
}

function stand(z) {
  const s = createState(C);
  s.z = z;
  s.x = 0;
  s.standing = 'islandA';
  return s;
}

test('the scripted player collects the key, grinds the rail and completes S4', () => {
  const s = run({});
  assert.equal(s.status, 'complete');
  assert.ok(s.hasKey, 'holds the key');
});

test('the gap between island A and island B cannot be jumped, even with a double jump', () => {
  assert.ok(islandB.z0 - islandA.z1 > 8.6, 'the gap is wider than the double-jump reach');
});

test('the gate stops Kai at the end of island A until he holds the key', () => {
  const s = stand(43.6);
  s.hasKey = false;
  for (let i = 0; i < 120; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(s.z <= C.gate.z, `held at the gate (z=${s.z.toFixed(2)})`);
  assert.ok(s.onGround);
  const k = stand(43.6);
  k.hasKey = true; k.keysHeld.key = true;
  for (let i = 0; i < 60; i++) step(k, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(k.z > C.gate.z, 'passes the gate with the key');
});

test('picking up the key sets hasKey and fires a key event', () => {
  const s = stand(C.key.z - 2);
  let got = false;
  for (let i = 0; i < 90 && !got; i++) {
    step(s, { fwd: 1, right: 0, jump: false }, C);
    if (s.events.includes('key')) got = true;
  }
  assert.ok(got && s.hasKey);
});

test('falling onto the rail catches it, and the rail carries Kai at its speed', () => {
  const s = stand(45.2);
  s.hasKey = true; s.keysHeld.key = true;
  let grinding = false;
  for (let i = 0; i < 90 && !grinding; i++) {
    step(s, { fwd: 1, right: 0, jump: i === 0 }, C);
    if (s.rail) grinding = true;
  }
  assert.ok(grinding, 'caught the rail');
  assert.ok(Math.abs(s.y - (railY(rail, s.z) - PARAMS.hangReach)) < 1e-9, 'hangs from the line by his hands');
  assert.ok(Math.abs(s.x - rail.x) < 1e-9);
});

test('being close to the rail is enough: a sloppy approach still lands on it', () => {
  const tries = [
    { x: 1.4, y: railY(rail, 50) - H, z: 50 }, // to the side
    { x: -1.4, y: railY(rail, 50) - H, z: 50 },
    { x: 0, y: railY(rail, 50) - H + 0.8, z: 50 }, // a little above
    { x: 0, y: railY(rail, 50) - H - 0.8, z: 50 }, // hands a little below the line, jumping up
    { x: 0, y: railY(rail, rail.z0) - H + 0.3, z: rail.z0 - 1.2 }, // just before it starts
  ];
  for (const t of tries) {
    const s = createState(C);
    s.hasKey = true; s.keysHeld.key = true; s.z = t.z; s.x = t.x; s.y = t.y; s.onGround = false; s.vy = -1;
    step(s, { fwd: 0, right: 0, jump: false }, C);
    assert.ok(s.rail, `caught from x=${t.x} y=${t.y.toFixed(2)} z=${t.z}`);
    assert.ok(Math.abs(s.x - rail.x) < 1e-9, 'snapped to the line');
  }
});

test('a plain single jump from the edge of island A (no double jump, no steering) lands on the rail', () => {
  for (const x of [-1.2, 0, 1.2]) {
    const s = stand(45.0);
    s.x = x; s.hasKey = true; s.keysHeld.key = true;
    let caught = false;
    for (let i = 0; i < 120 && !caught && s.deaths === 0; i++) {
      step(s, { fwd: 1, right: 0, jump: i < 2 || (!s.onGround && s.vy > 0) }, C);
      if (s.rail) caught = true;
    }
    assert.ok(caught, `caught the rail from x=${x}`);
  }
});

test('jumping off the rail leaves it with a full jump and the same speed', () => {
  const s = createState(C);
  s.hasKey = true; s.keysHeld.key = true; s.z = 50; s.x = 0; s.y = railY(rail, 50) - H; s.onGround = false; s.vy = -1;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(s.rail, 'on the rail');
  step(s, { fwd: 0, right: 0, jump: true }, C);
  assert.equal(s.rail, null);
  assert.ok(s.vy > 8, 'jumped');
  assert.ok(s.vz > 7, 'kept the rail speed');
  assert.ok(s.events.includes('jump'));
});

test('the rail does not catch Kai at once after he jumps off it', () => {
  const s = createState(C);
  s.hasKey = true; s.keysHeld.key = true; s.z = 50; s.x = 0; s.y = railY(rail, 50) - H; s.onGround = false; s.vy = -1;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  step(s, { fwd: 0, right: 0, jump: true }, C);
  for (let i = 0; i < 5; i++) step(s, { fwd: 0, right: 0, jump: true }, C);
  assert.equal(s.rail, null, 'still free in the first moments');
});

test('the rail ends by dropping Kai onto island B', () => {
  const s = run({}, 60);
  assert.ok(s.z >= islandB.z0);
  assert.equal(s.rail, null);
});

test('a hit while grinding costs a heart and knocks Kai off the rail', () => {
  const orb = C.enemies[2];
  const s = createState(C);
  s.hasKey = true; s.keysHeld.key = true; s.z = orb.z - 1; s.x = 0; s.y = railY(rail, s.z) - H; s.onGround = false; s.vy = -1;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(s.rail);
  let hit = false;
  for (let i = 0; i < 90 && !hit; i++) {
    step(s, { fwd: 0, right: 0, jump: false }, C);
    if (s.events.includes('hurt')) hit = true;
  }
  assert.ok(hit, 'the orb on the rail hurts');
  assert.equal(s.rail, null);
  assert.equal(s.hearts, PARAMS.hearts - 1);
});

test('an autopilot that never jumps over the orbs loses hearts (they are a real obstacle)', () => {
  const s = run({ dodge: false, railJumpAhead: 0 });
  assert.ok(s.hits >= 1, `hits=${s.hits}`);
});

test('a player who jumps over every orb completes S4 with no hits and no falls', () => {
  const s = run({});
  assert.equal(s.hits, 0);
  assert.equal(s.deaths, 0);
});

test('the orb above the rail has a fair jump window: at least 3 m of timing clears it, early or late hits', () => {
  let clear = 0;
  let hit = 0;
  for (let a = 1.0; a <= 6.01; a += 0.25) {
    const s = createState(C);
    s.hasKey = true; s.keysHeld.key = true;
    let jumped = false;
    for (let i = 0; i < 60 * 40 && s.status === 'playing'; i++) {
      const inp = autopilot(s, C, { railJumpAhead: 0 });
      if (s.rail && !jumped && enemyPosZ(s.t) - s.z <= a) { inp.jump = true; jumped = true; }
      step(s, inp, C);
    }
    if (s.hits === 0) clear++;
    else hit++;
  }
  assert.ok(clear * 0.25 >= 3, `clear window ${(clear * 0.25).toFixed(2)} m`);
  assert.ok(hit >= 4, 'not jumping at the right time still hurts');
});

test('S4 is deterministic: the same inputs give the same final state', () => {
  const a = run({});
  const b = run({});
  assert.equal(a.t, b.t);
  assert.equal(a.coins, b.coins);
  assert.equal(a.z, b.z);
});

test('every pickup is reachable: ground pickups lie over a platform, rail pickups lie at the rail line', () => {
  for (const c of C.coins) {
    const over = C.platforms.find((p) => c.x >= p.x0 && c.x <= p.x1 && c.z >= p.z0 && c.z <= p.z1);
    if (over) {
      assert.ok(c.y - over.y <= 1.5, `pickup at z=${c.z} floats ${c.y - over.y} m over its platform`);
    } else {
      assert.ok(c.z >= rail.z0 && c.z <= rail.z1, `pickup at z=${c.z} is over nothing`);
      assert.ok(Math.abs(c.y - (railY(rail, c.z) - H + PARAMS.chestHeight)) < 0.25, `rail pickup at z=${c.z} is off the line`);
    }
  }
});
