// Tests for S6: the final ascent (rising steps, the stompable guardian and the gate). Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_S6 as C } from '../src/course.s6.mjs';
import { PARAMS, createState, step, autopilot, enemyPos } from '../src/logic.mjs';

function run(options, seconds = 90) {
  const s = createState(C);
  for (let i = 0; i < Math.round(seconds / PARAMS.dt) && s.status === 'playing'; i++) step(s, autopilot(s, C, options), C);
  return s;
}

const guardianIdx = C.enemies.findIndex((e) => e.stomp);
const guardian = C.enemies[guardianIdx];
const summit = C.platforms.find((p) => p.id === 'summit');

test('the scripted player climbs to the summit, stomps the guardian and completes S6', () => {
  const s = run({});
  assert.equal(s.status, 'complete');
  assert.ok(s.defeated[guardianIdx], 'the guardian was stomped');
  assert.ok(s.hasKey, 'the gate opened');
});

test('every step up is within a single jump (apex 1.7 m) and every gap within its reach', () => {
  const steps = C.platforms;
  for (let i = 1; i < steps.length; i++) {
    const rise = steps[i].y - steps[i - 1].y;
    const gap = steps[i].z0 - steps[i - 1].z1;
    assert.ok(rise <= 1.6, `step ${steps[i].id} rises ${rise} m`);
    assert.ok(gap <= 5, `step ${steps[i].id} is ${gap} m away`);
  }
});

test('the guardian cannot be jumped over: its top is above a single jump from the summit', () => {
  const top = guardian.y + guardian.r;
  assert.ok(top > summit.y + 1.7, 'a single jump does not clear it');
});

test('the gate stops Kai at the end of the summit until the guardian is defeated', () => {
  const s = createState(C);
  s.z = 78; s.x = 3.8; s.y = summit.y; s.standing = 'summit';
  for (let i = 0; i < 90; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(s.z <= C.gate.z, `held at the gate (z=${s.z.toFixed(2)})`);
  s.defeated[guardianIdx] = true;
  s.hasKey = true; s.keysHeld.key = true;
  for (let i = 0; i < 90; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(s.z > C.gate.z, 'passes once the guardian is defeated');
});

test('landing on the guardian from above defeats it, bounces Kai and restores the air jump', () => {
  const s = createState(C);
  const g = enemyPos(guardian, 0);
  s.x = g.x; s.z = g.z; s.y = g.y + 0.5; s.vy = -2; s.onGround = false; s.airJumps = 0; s.standing = null;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(s.defeated[guardianIdx]);
  assert.ok(s.events.includes('stomp'));
  assert.ok(s.vy > 8, 'bounced');
  assert.equal(s.airJumps, PARAMS.airJumps);
  assert.ok(s.hasKey);
  assert.equal(s.hits, 0);
});

test('touching the guardian from the side hurts instead of defeating it', () => {
  const s = createState(C);
  const g = enemyPos(guardian, 0);
  s.x = g.x; s.z = g.z - 1.0; s.y = summit.y; s.onGround = true; s.standing = 'summit';
  for (let i = 0; i < 30 && s.hits === 0; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(s.hits >= 1, 'hurt');
  assert.equal(s.defeated[guardianIdx], false);
});

test('only the guardian can be stomped: ordinary enemies still hurt from above', () => {
  const orb = C.enemies.findIndex((e) => e.kind === 'orb');
  const s = createState(C);
  const o = enemyPos(C.enemies[orb], 0);
  s.x = o.x; s.z = o.z; s.y = o.y + 0.3; s.vy = -2; s.onGround = false; s.standing = null;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.defeated[orb], false);
});

test('challenge: a player who never dodges takes hits and falls at least once', () => {
  const s = run({ dodge: false });
  assert.ok(s.hits >= 3, `hits=${s.hits}`);
  assert.ok(s.deaths >= 1, `deaths=${s.deaths}`);
});

test('falling off a raised step respawns Kai standing on the checkpoint, not below it (no endless fall)', () => {
  for (const cpIndex of [1, 2]) {
    const s = createState(C);
    s.checkpoint = cpIndex;
    s.y = C.killY - 1; // fell off
    s.onGround = false;
    step(s, { fwd: 0, right: 0, jump: false }, C);
    assert.equal(s.deaths, 1);
    const under = C.platforms.find((p) => s.x >= p.x0 && s.x <= p.x1 && s.z >= p.z0 && s.z <= p.z1);
    assert.ok(under, 'respawned over a platform');
    assert.equal(s.y, under.y, `standing on ${under.id} at its height`);
    for (let i = 0; i < 120; i++) step(s, { fwd: 0, right: 0, jump: false }, C);
    assert.equal(s.deaths, 1, 'does not fall again');
    assert.ok(s.onGround);
  }
});

test('S6 is deterministic: the same inputs give the same final state', () => {
  const a = run({});
  const b = run({});
  assert.equal(a.t, b.t);
  assert.equal(a.coins, b.coins);
  assert.equal(a.z, b.z);
});

test('every pickup lies over a platform at a reachable height', () => {
  for (const c of C.coins) {
    const over = C.platforms.find((p) => c.x >= p.x0 && c.x <= p.x1 && c.z >= p.z0 && c.z <= p.z1);
    assert.ok(over, `pickup at z=${c.z} is over nothing`);
    assert.ok(c.y - over.y <= 1.8, `pickup at z=${c.z} floats ${c.y - over.y} m over ${over.id}`);
  }
});
