// Ossa, the Granmoss, per run: the seed picks its island and its desire, every island is reachable and completable, and each
// desire can be met. (test/world.test.mjs covers Ossa on the default run; this covers the variation.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldCourse, elderPlan, COURSE_WORLD, DEFAULT_RUN, ELDER_NEEDS, LIVE_DESIRES } from '../src/course.world.mjs';
import { createState, step, pilot, gatesOf, surfaceY } from '../src/logic.mjs';

const SITES = ['west', 'east', 'south'];

// The first seed for each island and desire, found by search so the tests do not hard-code seeds.
const seedFor = {};
for (let s = 1; s < 5000 && Object.keys(seedFor).length < SITES.length * LIVE_DESIRES.length; s++) {
  const p = elderPlan(s);
  seedFor[`${p.siteId}/${p.desire}`] ??= s;
}

test('every island and every live desire occurs in the seeds', () => {
  for (const site of SITES) for (const d of LIVE_DESIRES) assert.ok(seedFor[`${site}/${d}`], `a seed for ${site}/${d}`);
});

test('the plan is deterministic, and the seeds spread over the islands and the desires', () => {
  assert.deepEqual(elderPlan(12345), elderPlan(12345));
  const sites = new Set();
  const desires = new Set();
  for (let s = 1; s <= 200; s++) {
    const p = elderPlan(s);
    sites.add(p.siteId);
    desires.add(p.desire);
    for (const n of ELDER_NEEDS) assert.ok(p.needs[n] >= 0 && p.needs[n] <= 1);
    assert.equal(p.desire, LIVE_DESIRES.reduce((b, n) => (p.needs[n] > p.needs[b] ? n : b), LIVE_DESIRES[0]), 'the desire is the strongest live need');
  }
  assert.equal(sites.size, SITES.length);
  assert.equal(desires.size, LIVE_DESIRES.length);
});

test('the default run is Ossa on the west island, wanting company', () => {
  const p = elderPlan(DEFAULT_RUN);
  assert.equal(p.siteId, 'west');
  assert.equal(p.desire, 'loneliness');
  assert.equal(COURSE_WORLD.elder.site, 'west');
});

for (const site of SITES) {
  for (const desire of LIVE_DESIRES) {
    const seed = seedFor[`${site}/${desire}`];
    test(`run ${seed}: Ossa on the ${site} island wanting ${desire}: the scripted player meets it and finishes the game`, () => {
      const C = worldCourse(seed);
      assert.equal(C.elder.site, site);
      assert.equal(C.elder.desire, desire);
      const s = createState(C);
      if (desire === 'covetousness') s.coins = C.elder.tribute.coins + 10; // the scripted player does not gather the hoard
      for (let i = 0; i < 60 * 300 && s.status === 'playing'; i++) step(s, pilot(s, C, { route: 'centre' }), C);
      assert.equal(s.status, 'complete', `stopped at x=${s.x.toFixed(1)} z=${s.z.toFixed(1)} after ${s.deaths} falls`);
      assert.equal(s.elder.satisfied, true);
      assert.ok(s.keysHeld.citadel && s.keysHeld.lantern);
      assert.ok(s.deaths <= 1, `at most one fall (had ${s.deaths})`);
    });
  }
}

test('Ossa is far from the gate and from the start on every island, and its island has a crystal and solid ground', () => {
  for (const site of SITES) {
    const C = worldCourse(seedFor[`${site}/loneliness`]);
    const gate = gatesOf(C).find((g) => g.id === 'citadel');
    assert.ok(Math.hypot(C.elder.x, C.elder.z - gate.z) > 300, `${site}: far from the gate`);
    assert.ok(Math.hypot(C.elder.x, C.elder.z) > 30, `${site}: not on the start meadow`);
    const isle = C.platforms.find((q) => q.id === C.elder.plat);
    assert.ok(C.elder.x > isle.x0 && C.elder.x < isle.x1 && C.elder.z > isle.z0 && C.elder.z < isle.z1, `${site}: Ossa is on its island`);
    const cp = C.checkpoints.find((c) => c.name === 'Ossa’s isle');
    assert.ok(cp && cp.x > isle.x0 && cp.x < isle.x1 && cp.z > isle.z0 && cp.z < isle.z1, `${site}: a way-crystal on the island`);
    const ids = C.platforms.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, `${site}: platform ids are unique`);
  }
});

test('a covetous Ossa takes the hoard once, and says how short Kai is when he cannot pay', () => {
  const C = worldCourse(seedFor['west/covetousness']);
  const isle = C.platforms.find((q) => q.id === C.elder.plat);
  const s = createState(C);
  Object.assign(s, { x: C.elder.x + 2, z: C.elder.z, y: isle.y, standing: isle.id, onGround: true });
  s.coins = 12;
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('elder-short'));
  assert.deepEqual(s.lastShort, { have: 12, need: C.elder.tribute.coins });
  assert.ok(!s.keysHeld.citadel);
  step(s, { fwd: 0, right: 0, jump: false, wave: false }, C);
  s.coins = C.elder.tribute.coins + 5;
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('elder-pleased'));
  assert.ok(s.keysHeld.citadel);
  assert.equal(s.spent, C.elder.tribute.coins, 'the hoard was spent');
  assert.equal(s.coins - s.spent, 5);
  step(s, { fwd: 0, right: 0, jump: false, wave: false }, C);
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(!s.events.includes('elder-pleased'), 'pleased once');
});

test('a covetous Ossa has no use for company, and a lonely Ossa does not take coins', () => {
  const cov = worldCourse(seedFor['west/covetousness']);
  const isle = cov.platforms.find((q) => q.id === cov.elder.plat);
  const s = createState(cov);
  Object.assign(s, { x: cov.elder.x + 2, z: cov.elder.z, y: isle.y, standing: isle.id, onGround: true });
  const hi = s.creatures.findIndex((c) => c.species === 'hopper');
  s.carry = hi;
  s.creatures[hi].carried = true;
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, cov);
  assert.ok(s.events.includes('elder-refuses'));
  assert.ok(!s.keysHeld.citadel);
  const lone = worldCourse(seedFor['west/loneliness']);
  const t = createState(lone);
  Object.assign(t, { x: lone.elder.x + 2, z: lone.elder.z, y: isle.y, standing: isle.id, onGround: true });
  t.coins = 99;
  step(t, { fwd: 0, right: 0, jump: false, wave: true }, lone);
  assert.ok(!t.keysHeld.citadel && t.spent === 0);
});

test('a run is reproducible: the same seed gives the same course', () => {
  const a = worldCourse(777);
  const b = worldCourse(777);
  assert.deepEqual(a.elder, b.elder);
  assert.deepEqual(a.platforms.map((p) => p.id), b.platforms.map((p) => p.id));
  assert.ok(surfaceY(a.platforms.find((p) => p.id === 'elderIsle'), a.elder.x, a.elder.z) !== null);
});
