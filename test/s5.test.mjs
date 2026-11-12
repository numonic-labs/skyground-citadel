// Tests for S5: the enemy gauntlet (moving platforms, two enemy types). Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_S5 as C } from '../src/course.s5.mjs';
import { PARAMS, createState, step, autopilot, platformBounds } from '../src/logic.mjs';

function run(options, seconds = 90) {
  const s = createState(C);
  for (let i = 0; i < Math.round(seconds / PARAMS.dt) && s.status === 'playing'; i++) step(s, autopilot(s, C, options), C);
  return s;
}

test('the scripted player completes S5', () => {
  const s = run({});
  assert.equal(s.status, 'complete');
});

test('both wide gaps need a sliding platform: they exceed the double-jump reach', () => {
  const p = (id) => C.platforms.find((q) => q.id === id);
  assert.ok(p('i3').z0 - p('i2').z1 > 8.6);
  assert.ok(p('i4').z0 - p('i3').z1 > 8.6);
});

test('each sliding platform is within a single jump of both islands at its ends', () => {
  const pairs = [['i2', 'm1', 'i3'], ['i3', 'm2', 'i4']];
  for (const [a, m, b] of pairs) {
    const pa = C.platforms.find((q) => q.id === a);
    const pm = C.platforms.find((q) => q.id === m);
    const pb = C.platforms.find((q) => q.id === b);
    const near = platformBounds(pm, (pm.move.period * 3) / 4); // at its near end (t = 0 is also near)
    const t0 = platformBounds(pm, 0);
    const tHalf = platformBounds(pm, pm.move.period / 2);
    assert.ok(t0.z0 - pa.z1 < 5, `${m} near end is within reach of ${a}`);
    assert.ok(pb.z0 - tHalf.z1 < 5, `${m} far end is within reach of ${b}`);
    assert.ok(near);
  }
});

test('S5 has two enemy types', () => {
  const kinds = new Set(C.enemies.map((e) => e.kind));
  assert.ok(kinds.has('orb') && kinds.has('sprout'));
});

test('challenge floor: a player who never dodges and never jumps the enemies loses hearts and falls at least once', () => {
  const s = run({ dodge: false });
  assert.ok(s.hits >= 3, `hits=${s.hits}`);
  assert.ok(s.deaths >= 1, `deaths=${s.deaths}`);
});

test('a player who dodges completes with at most two hits', () => {
  const s = run({});
  assert.ok(s.hits <= 2, `hits=${s.hits}`);
  assert.equal(s.deaths, 0);
});

test('S5 is deterministic: the same inputs give the same final state', () => {
  const a = run({});
  const b = run({});
  assert.equal(a.t, b.t);
  assert.equal(a.coins, b.coins);
  assert.equal(a.z, b.z);
});

test('every pickup lies over a platform (or a sliding platform at some moment)', () => {
  for (const c of C.coins) {
    const over = C.platforms.find((p) => {
      const lo = p.move ? p.z0 - p.move.amp : p.z0;
      const hi = p.move ? p.z1 + p.move.amp : p.z1;
      return c.x >= p.x0 && c.x <= p.x1 && c.z >= lo && c.z <= hi;
    });
    assert.ok(over, `pickup at z=${c.z} is over nothing`);
    assert.ok(c.y - over.y <= 1.5);
  }
});
