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
      // The scripted player does not gather what Ossa asks for: it is handed the hoard, the fruit and the book.
      if (desire !== 'loneliness') Object.assign(s, { coins: C.elder.tribute.coins + 10, fruit: C.elder.feed.fruit + 1, book: true });
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
  assert.deepEqual(s.lastShort, { kind: 'coins', have: 12, need: C.elder.tribute.coins });
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

function atOssa(course) {
  const isle = course.platforms.find((q) => q.id === course.elder.plat);
  const s = createState(course);
  Object.assign(s, { x: course.elder.x + 2, z: course.elder.z, y: isle.y, standing: isle.id, onGround: true });
  return s;
}
const pressX = (s, c) => step(s, { fwd: 0, right: 0, jump: false, wave: true }, c);
const releaseX = (s, c) => step(s, { fwd: 0, right: 0, jump: false, wave: false }, c);

test('a hungry Ossa takes five fruit once, and says how many Kai has when he is short', () => {
  const C = worldCourse(seedFor['west/hunger']);
  const s = atOssa(C);
  s.fruit = 3;
  pressX(s, C);
  assert.ok(s.events.includes('elder-short'));
  assert.deepEqual(s.lastShort, { kind: 'fruit', have: 3, need: C.elder.feed.fruit });
  assert.ok(!s.keysHeld.citadel);
  releaseX(s, C);
  s.fruit = C.elder.feed.fruit + 2;
  pressX(s, C);
  assert.ok(s.events.includes('elder-pleased') && s.keysHeld.citadel);
  assert.equal(s.fruit, 2, 'the fruit was given');
});

test('a bored Ossa wants the book read to it, and keeps nothing from Kai', () => {
  const C = worldCourse(seedFor['east/boredom']);
  const s = atOssa(C);
  pressX(s, C);
  assert.ok(s.events.includes('elder-short'));
  assert.deepEqual(s.lastShort, { kind: 'book', have: 0, need: 1 });
  releaseX(s, C);
  s.book = true;
  pressX(s, C);
  assert.ok(s.events.includes('elder-pleased') && s.keysHeld.citadel);
  assert.equal(s.book, true, 'the book is only read aloud');
});

test('each desire asks only for its own gift: coins do nothing to a hungry Ossa, fruit nothing to a covetous one', () => {
  const hungry = worldCourse(seedFor['west/hunger']);
  const h = atOssa(hungry);
  Object.assign(h, { coins: 99, book: true });
  pressX(h, hungry);
  assert.ok(!h.keysHeld.citadel && h.spent === 0);
  const greedy = worldCourse(seedFor['west/covetousness']);
  const g = atOssa(greedy);
  Object.assign(g, { fruit: 20, book: true });
  pressX(g, greedy);
  assert.ok(!g.keysHeld.citadel && g.fruit === 20);
});

test('fruit and the book lie about the grounds on solid ground, enough fruit for a hungry Ossa, and are picked up by walking into them', () => {
  const C = worldCourse(DEFAULT_RUN);
  const fruit = C.gifts.filter((g) => g.kind === 'fruit');
  const books = C.gifts.filter((g) => g.kind === 'book');
  assert.ok(fruit.length >= C.elder.feed.fruit + 3, 'plenty more fruit than a hungry Ossa asks for');
  assert.equal(books.length, 1);
  for (const g of C.gifts) {
    const p = C.platforms.find((q) => g.x >= q.x0 && g.x <= q.x1 && g.z >= q.z0 && g.z <= q.z1);
    assert.ok(p, `${g.kind} at ${g.x},${g.z} is over a platform`);
    const ground = p.hm ? surfaceY(p, g.x, g.z) : p.y;
    assert.ok(ground !== null && g.y - ground > 0.3 && g.y - ground < 2.3, `${g.kind} at ${g.x},${g.z} hangs ${(g.y - ground).toFixed(2)} m above the ground`);
  }
  const s = createState(C);
  const f = fruit[0];
  const p = C.platforms.find((q) => f.x >= q.x0 && f.x <= q.x1 && f.z >= q.z0 && f.z <= q.z1);
  Object.assign(s, { x: f.x, z: f.z, y: p.y, standing: p.id, onGround: true });
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.fruit, 1);
  assert.ok(s.events.includes('gift') && s.lastGift === 'fruit');
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.fruit, 1, 'taken once');
  const b = books[0];
  const bp = C.platforms.find((q) => b.x >= q.x0 && b.x <= q.x1 && b.z >= q.z0 && b.z <= q.z1);
  Object.assign(s, { x: b.x, z: b.z, y: surfaceY(bp, b.x, b.z), standing: bp.id, onGround: true });
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.book, true);
});

test('Ossa is solid on every island: Kai cannot run through it, is pushed out if he is put inside, and clears it by jumping high', () => {
  for (const site of SITES) {
    const C = worldCourse(seedFor[`${site}/loneliness`]);
    const isle = C.platforms.find((q) => q.id === C.elder.plat);
    const th = C.elder.facing;
    // Start 6 m in front of Ossa, along its facing, and run straight at its centre for four seconds.
    const s = createState(C);
    const sx = C.elder.x + Math.sin(th) * 6;
    const sz = C.elder.z + Math.cos(th) * 6;
    Object.assign(s, { x: sx, z: sz, y: isle.y, standing: isle.id, onGround: true });
    for (let i = 0; i < 240; i++) {
      const dx = C.elder.x - s.x;
      const dz = C.elder.z - s.z;
      const d = Math.hypot(dx, dz) || 1;
      step(s, { fwd: dz / d, right: -dx / d, jump: false }, C);
    }
    const dist = Math.hypot(s.x - C.elder.x, s.z - C.elder.z);
    assert.ok(dist > 2.5, `${site}: stopped at ${dist.toFixed(2)} m from Ossa's centre, not inside it`);
    assert.ok(dist < 4.1, `${site}: and still within its reach (${dist.toFixed(2)} m)`);
    // Put inside it: pushed out.
    const t = createState(C);
    Object.assign(t, { x: C.elder.x + 0.3, z: C.elder.z, y: isle.y, standing: isle.id, onGround: true });
    step(t, { fwd: 0, right: 0, jump: false }, C);
    assert.ok(Math.hypot(t.x - C.elder.x, t.z - C.elder.z) > 2, `${site}: pushed out of its body`);
  }
});

test('Ossa does not stop Kai when he is far above its shell, or elsewhere on the map', () => {
  const C = worldCourse(seedFor['west/loneliness']);
  const isle = C.platforms.find((q) => q.id === C.elder.plat);
  const high = createState(C);
  Object.assign(high, { x: C.elder.x, z: C.elder.z, y: isle.y + 5, standing: null, onGround: false });
  step(high, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(Math.abs(high.x - C.elder.x) < 0.5, 'high above it, he is not pushed sideways');
  const far = createState(C);
  const x0 = far.x;
  step(far, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(Math.abs(far.x - x0) < 1, 'nothing changes on the start meadow');
});

test('a press on Ossa\'s island that is too far to count says so, and one far away or on another island does not', () => {
  const C = worldCourse(seedFor['west/hunger']);
  const isle = C.platforms.find((q) => q.id === C.elder.plat);
  const place = (dist) => {
    const s = createState(C);
    const th = C.elder.facing;
    Object.assign(s, { x: C.elder.x + Math.sin(th + Math.PI) * dist, z: C.elder.z + Math.cos(th + Math.PI) * dist, y: isle.y, standing: isle.id, onGround: true });
    return s;
  };
  const mid = place(C.elder.reach + 2); // on its island, beyond its reach
  pressX(mid, C);
  assert.ok(mid.events.includes('elder-far'));
  assert.ok(!mid.keysHeld.citadel);
  const start = createState(C);
  pressX(start, C);
  assert.ok(!start.events.includes('elder-far'), 'nothing on the start meadow');
  const near = place(3);
  near.fruit = 9;
  pressX(near, C);
  assert.ok(near.events.includes('elder-pleased') && !near.events.includes('elder-far'));
  assert.equal(near.fruit, 4, 'five of the nine fruit were given');
});
