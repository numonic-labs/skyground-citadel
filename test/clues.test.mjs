// The three clues to where Ossa, the Granmoss, is: a gate-keeper, a creature you took home, a bramble you dazed. Each is heard once
// and gives only part of the answer; together they point at the island.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldCourse, elderPlan, DEFAULT_RUN } from '../src/course.world.mjs';
import { createState, step, surfaceY } from '../src/logic.mjs';

const C = worldCourse(DEFAULT_RUN); // the west island, wanting company
const press = (s, C2 = C) => step(s, { fwd: 0, right: 0, jump: false, wave: true }, C2);
const release = (s, C2 = C) => step(s, { fwd: 0, right: 0, jump: false, wave: false }, C2);

function standAt(course, x, z) {
  const s = createState(course);
  const p = course.platforms.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1);
  s.x = x;
  s.z = z;
  s.y = p.hm ? surfaceY(p, x, z) : p.y;
  s.standing = p.id;
  return s;
}

test('every run has the three clues, each with a source and a text', () => {
  for (const seed of [1, 2, 3, 5, 6, 7, 99, 1234]) {
    const c = worldCourse(seed).clues;
    for (const id of ['gate', 'thanks', 'bramble']) {
      assert.ok(c[id] && c[id].source && c[id].text.length > 20, `${seed}/${id}`);
    }
  }
});

test('the gate-keeper speaks once to anyone who comes near the gate, and not from afar', () => {
  const gk = C.gatekeeper;
  const far = standAt(C, 0, gk.z - 12);
  step(far, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(!far.clues.gate && !far.events.includes('clue'));
  const s = standAt(C, 0, gk.z - 2);
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(s.clues.gate);
  assert.ok(s.events.includes('clue'));
  assert.equal(s.lastClue, 'gate');
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(!s.events.includes('clue'), 'heard once');
  assert.deepEqual(s.clueLog, ['gate']);
});

test('the first creature taken home thanks Kai with a clue; later ones only thank him', () => {
  const s = createState(C);
  const di = s.creatures.findIndex((c) => c.species === 'dewling' && c.plat === 'A');
  const d = s.creatures[di];
  Object.assign(s, { x: d.x + 1, z: d.z });
  press(s);
  assert.equal(s.carry, di);
  release(s);
  const c = standAt(C, 0, 43);
  Object.assign(s, { x: c.x, y: c.y, z: c.z, standing: 'C', onGround: true });
  press(s);
  assert.ok(s.events.includes('rehome'));
  assert.ok(s.events.includes('clue') && s.lastClue === 'thanks');
  assert.ok(s.clues.thanks);
  release(s);
  // Set it down on the lawn again and take it home a second time: no second clue.
  const a = standAt(C, 0, 5);
  Object.assign(s, { x: s.creatures[di].x + 0.5, z: s.creatures[di].z, y: a.y, standing: 'C' });
  press(s);
  release(s);
  assert.deepEqual(s.clueLog.filter((x) => x === 'thanks'), ['thanks']);
});

test('dazing a bramble with the gust gives the bramble clue, once; a gust at nothing gives none', () => {
  const bi = C.enemies.findIndex((e) => e.kind === 'bramble');
  const o = C.enemies[bi];
  const nothing = standAt(C, 0, 0);
  press(nothing);
  assert.ok(!nothing.clues.bramble);
  const s = standAt(C, 0, o.z - 3.5);
  s.yaw = 0;
  press(s);
  assert.ok(s.stunUntil[bi] > s.t);
  assert.ok(s.clues.bramble && s.events.includes('clue') && s.lastClue === 'bramble');
  release(s);
  s.waveCd = 0;
  press(s);
  assert.deepEqual(s.clueLog, ['bramble'], 'heard once');
});

test('no single clue is a giveaway: the gate-keeper names no place, the thanks never names the true island, the bramble gives a landmark', () => {
  const sites = ['west', 'east', 'south'];
  for (let seed = 1; seed <= 300; seed++) {
    const course = worldCourse(seed);
    const { gate, thanks, bramble } = course.clues;
    const trueWhere = course.elder.where;
    // Phrases that name an island, taken from the other sites' own `where` (the true one's is the one to look for).
    const all = sites.map((id) => worldCourse(findSeedFor(id)).elder.where);
    for (const w of all) {
      assert.ok(!gate.text.includes(w.heading) && !gate.text.includes(w.landmark), `seed ${seed}: the gate-keeper names no place`);
    }
    assert.ok(!thanks.text.includes(trueWhere.heading), `seed ${seed}: the thanks never points at the true island`);
    assert.ok(!thanks.text.includes(trueWhere.landmark));
    assert.ok(bramble.text.includes(trueWhere.landmark), `seed ${seed}: the bramble gives the landmark`);
    assert.ok(!bramble.text.includes(trueWhere.heading), `seed ${seed}: and not a direction`);
    const word = { covetousness: 'hoard', loneliness: 'lonely', hunger: 'hungry', boredom: 'story' }[course.elder.desire];
    assert.ok(gate.text.includes(word), `seed ${seed}: the gate-keeper hints what it wants (${course.elder.desire})`);
  }
});

const seedCache = {};
function findSeedFor(id) {
  if (seedCache[id]) return seedCache[id];
  for (let s = 1; s < 5000; s++) {
    if (elderPlan(s).siteId === id) return (seedCache[id] = s);
  }
  throw new Error('no seed for ' + id);
}

test('the clues are a pure function of the seed', () => {
  assert.deepEqual(worldCourse(321).clues, worldCourse(321).clues);
});

test('a creature that already lives somewhere, lifted and put down, earns no thanks and no clue; only one taken from where it does not belong to where it does', () => {
  const s = createState(C);
  // A hopper at home on the start lawn: pick it up and set it down on the same lawn.
  const hi = s.creatures.findIndex((c) => c.species === 'hopper' && c.plat === 'A');
  assert.ok(s.creatures[hi].counted, 'it lives there already');
  Object.assign(s, { x: s.creatures[hi].x + 1, z: s.creatures[hi].z });
  press(s);
  assert.equal(s.carry, hi);
  release(s);
  press(s);
  assert.ok(s.events.includes('settle'), 'set down where it lives');
  assert.ok(!s.events.includes('rehome') && !s.events.includes('clue'));
  assert.equal(s.rehomed, 0);
  assert.deepEqual(s.clueLog, []);
  // A dewling out of place on that lawn, set down on the same dry lawn: not where it belongs, so no clue either.
  release(s);
  const di = s.creatures.findIndex((c) => c.species === 'dewling' && c.plat === 'A');
  Object.assign(s, { x: s.creatures[di].x + 1, z: s.creatures[di].z });
  press(s);
  release(s);
  press(s);
  assert.ok(s.events.includes('release'));
  assert.deepEqual(s.clueLog, []);
});
