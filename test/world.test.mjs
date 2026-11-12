// The continuous level (course.world.mjs): every route reaches the citadel gate, the keys and gates work by id, pickups are
// reachable, and the level can still hurt a careless player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_WORLD as C } from '../src/course.world.mjs';
import { PARAMS, SPECIES, createState, step, pilot, surfaceY, platformBounds, gatesOf, keysOf, neighbours, habitatOk } from '../src/logic.mjs';

function run(route, options = {}, seconds = 240) {
  const s = createState(C);
  for (let i = 0; i < 60 * seconds && s.status === 'playing'; i++) step(s, pilot(s, C, { route, ...options }), C);
  return s;
}

function standAt(x, z) {
  const s = createState(C);
  const p = C.platforms.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1);
  s.x = x;
  s.z = z;
  s.y = p.hm ? surfaceY(p, x, z) : p.y;
  s.standing = p.id;
  return s;
}

for (const route of ['centre', 'west', 'stairs', 'lower', 'ruin', 'arch', 'secret', 'ruinisle', 'archisle', 'skyroad']) {
  test(`the scripted player reaches the citadel gate by the ${route} route`, () => {
    const s = run(route);
    assert.equal(s.status, 'complete', `stopped at z=${s.z.toFixed(1)} after ${s.deaths} falls`);
    assert.ok(s.deaths <= 1, `at most one fall (had ${s.deaths})`);
    assert.ok(s.keysHeld.lantern && s.keysHeld.citadel, 'both keys were needed');
  });
}

test('the main line is finished without a fall or a hit, in under two minutes', () => {
  const s = run('centre');
  assert.equal(s.deaths, 0);
  assert.equal(s.hits, 0);
  assert.ok(s.t < 120, `took ${s.t.toFixed(1)} s`);
});

test('the same inputs give the same run (deterministic)', () => {
  const a = run('centre');
  const b = run('centre');
  assert.equal(a.t, b.t);
  assert.equal(a.coins, b.coins);
});

test('the sky road skips the boardwalk, the flyer and the raft, and has a gem', () => {
  const s = run('skyroad');
  assert.equal(s.status, 'complete');
  assert.ok(s.gems >= 1);
});

test('the lantern gate holds Kai until he has the lantern key, and the lantern key does not open the citadel gate', () => {
  const [g1, g2] = gatesOf(C);
  const s = standAt(0, g1.z - 1.2);
  s.keysHeld = {};
  for (let i = 0; i < 90; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(s.z <= g1.z, `held at the lantern gate (z=${s.z.toFixed(2)})`);
  const k = standAt(0, g1.z - 1.2);
  k.keysHeld = { lantern: true };
  for (let i = 0; i < 40; i++) step(k, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(k.z > g1.z, 'passes with the lantern key');
  const c = standAt(0, g2.z - 2);
  c.keysHeld = { lantern: true };
  c.defeated = c.defeated.map(() => true); // no enemies in the way
  for (let i = 0; i < 90; i++) step(c, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(c.z <= g2.z, 'the citadel gate needs its own key');
});

test('a gate only blocks inside its span: far to the side it does nothing', () => {
  const g = gatesOf(C)[0];
  const s = createState(C);
  Object.assign(s, { x: 40, y: 30, z: g.z - 1, vy: 0, onGround: false });
  for (let i = 0; i < 20; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.ok(s.z > g.z, 'not stopped 40 m to the side');
});

test('the guardian drops the citadel key', () => {
  const gi = C.enemies.findIndex((e) => e.stomp);
  assert.equal(C.enemies[gi].drops, 'citadel');
  assert.ok(keysOf(C).some((k) => k.id === 'lantern'));
});

test('every coin and gem hangs over a platform, within reach of a jump from it', () => {
  const reach = 9.5; // the highest pickup is on a pad's arc
  for (const c of [...C.coins, ...C.gems]) {
    const under = C.platforms
      .map((p) => {
        const b = platformBounds(p, 0);
        const amp = p.move ? p.move.amp : 0;
        const inX = c.x >= b.x0 - 0.5 && c.x <= b.x1 + 0.5;
        const inZ = c.z >= b.z0 - amp - 0.5 && c.z <= b.z1 + amp + 0.5;
        if (!inX || !inZ) return null;
        return p.hm ? surfaceY(p, c.x, c.z) : p.y;
      })
      .filter((h) => h !== null && h !== undefined);
    const overGap = under.length === 0; // arc coins over a gap (the pad, the swing, the rail) are checked by the route runs
    if (overGap) continue;
    assert.ok(
      under.some((h) => c.y - h > 0.3 && c.y - h < reach),
      `pickup at (${c.x}, ${c.y}, ${c.z}) is not within reach of the ground under it (${under.join(', ')})`
    );
  }
});

test('gems are collected by walking into them and counted once', () => {
  const g = C.gems[0];
  const s = standAt(g.x, g.z - 0.5);
  for (let i = 0; i < 30; i++) step(s, { fwd: 1, right: 0, jump: false }, C);
  assert.equal(s.gems, 1);
  assert.equal(s.gemsCollected[0], true);
});

test('returning to a checkpoint gives a short grace period', () => {
  const s = createState(C);
  s.y = C.killY - 1;
  s.onGround = false;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.deaths, 1);
  assert.ok(s.hurtCd > PARAMS.hurtCooldown, 'grace is longer than the normal hit cooldown');
});

test('challenge floor: a player who never dodges is hit on the way to the citadel', () => {
  const s = run('centre', { dodge: false }, 120);
  assert.ok(s.hits >= 1, 'the enemies must be able to hurt a careless player');
});

test('checkpoints stand on solid ground and none sits on an enemy patrol', () => {
  for (const cp of C.checkpoints) {
    const p = C.platforms.find((q) => cp.x >= q.x0 && cp.x <= q.x1 && cp.z >= q.z0 && cp.z <= q.z1 && (!q.hm || surfaceY(q, cp.x, cp.z) !== null));
    assert.ok(p, `checkpoint (${cp.x}, ${cp.z}) has ground under it`);
    for (const e of C.enemies) {
      const span = Math.hypot(e.ax || 0, e.az || 0) + e.r + PARAMS.bodyRadius;
      const d = Math.hypot(e.x - cp.x, e.z - cp.z);
      const sameLevel = Math.abs(e.y - (p.hm ? surfaceY(p, cp.x, cp.z) : p.y)) < 2.5;
      assert.ok(!sameLevel || d > span, `checkpoint (${cp.x}, ${cp.z}) is inside an enemy's patrol`);
    }
  }
});

test('the gust dazes a bramble in front of Kai (it is not removed), not one behind him or out of reach', () => {
  const bi = C.enemies.findIndex((e) => e.kind === 'bramble');
  const o = C.enemies[bi];
  const s = standAt(0, o.z - 3.5);
  s.yaw = 0; // facing +Z, toward the bramble
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('wave'));
  assert.ok(s.stunUntil[bi] > s.t, 'the bramble ahead is dazed');
  assert.equal(s.defeated[bi], false, 'and still there');
  const b = standAt(0, o.z + 3.5);
  b.yaw = 0; // the bramble is behind him
  step(b, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.equal(b.stunUntil[bi], 0, 'a bramble behind him is not caught');
  const far = standAt(0, o.z - 4);
  far.z = o.z - 9;
  step(far, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.equal(far.stunUntil[bi], 0, 'out of reach');
});

test('a dazed bramble does not hurt, and it recovers', () => {
  const bi = C.enemies.findIndex((e) => e.kind === 'bramble');
  const o = C.enemies[bi];
  const s = standAt(0, o.z);
  s.stunUntil[bi] = s.t + PARAMS.stunTime;
  for (let i = 0; i < 120; i++) step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.hits, 0, 'standing on a dazed bramble for 2 s costs nothing');
  for (let i = 0; i < 60 * 8 && s.hits === 0; i++) step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(s.hits >= 1, 'once it recovers it hurts again');
});

test('the wave has a cooldown and needs a fresh press', () => {
  const s = standAt(0, 100 - 10);
  let waves = 0;
  for (let i = 0; i < 30; i++) {
    step(s, { fwd: 0, right: 0, jump: false, wave: true }, C); // held down
    if (s.events.includes('wave')) waves++;
  }
  assert.equal(waves, 1, 'holding the key waves once');
  step(s, { fwd: 0, right: 0, jump: false, wave: false }, C);
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(!s.events.includes('wave'), 'a second press inside the cooldown does nothing');
});

test('the guardian only flinches at the wave: it still has to be landed on', () => {
  const gi = C.enemies.findIndex((e) => e.stomp);
  const g = C.enemies[gi];
  const s = standAt(0, g.z - 4);
  s.yaw = 0;
  s.defeated = s.defeated.map((d, i) => i !== gi); // only the guardian is left
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('waveblock'));
  assert.equal(s.defeated[gi], false);
  assert.ok(!s.keysHeld.citadel);
});

test('a fence stops Kai on foot and a jump clears it', () => {
  const w = C.walls[0];
  const z = (w.z0 + w.z1) / 2;
  const s = standAt(w.x - 1.2, z);
  s.defeated = s.defeated.map(() => true);
  for (let i = 0; i < 60; i++) step(s, { fwd: 0, right: -1, jump: false }, C); // right: -1 runs toward +x
  assert.ok(s.x < w.x, `held by the fence (x=${s.x.toFixed(2)})`);
  assert.ok(s.onGround);
  const j = standAt(w.x - 2.4, z);
  j.defeated = j.defeated.map(() => true);
  for (let i = 0; i < 40; i++) step(j, { fwd: 0, right: -1, jump: i > 4 }, C);
  assert.ok(j.x > w.x, 'a jump carries him over');
});

test('streams lie on their islands and fences leave the main line clear', () => {
  for (const st of C.streams) {
    const p = C.platforms.find((q) => q.id === st.plat);
    assert.ok(p && st.z0 >= p.z0 && st.z1 <= p.z1, `stream on ${st.plat}`);
  }
  for (const w of C.walls) assert.ok(Math.abs(w.x) > 3, 'no fence across the middle of the road');
});

// ---- the steward pass (2026-11-12)

test('the vines catch Kai when he walks off an island, and he climbs back to the rim', () => {
  const s = standAt(7.6, 2); // near the east edge of the start island
  s.lastStand = 'A';
  s.lastStandY = 0;
  s.creatures.forEach((c) => (c.x = -8)); // out of the way
  let caught = false;
  for (let i = 0; i < 240 && !caught; i++) {
    step(s, { fwd: 0, right: -1, jump: false }, C); // right: -1 runs toward +x, off the east edge
    caught = s.events.includes('vinecatch');
  }
  assert.ok(caught, 'caught by the vines');
  assert.equal(s.deaths, 0);
  assert.equal(s.slips, 1);
  assert.equal(s.hang && s.hang.plat, 'A', 'hanging from the island he fell from');
  const from = s.hang.plat;
  const y0 = s.y;
  for (let i = 0; i < 60; i++) step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(s.y <= y0, 'with nothing held he does not climb');
  let mounted = false;
  for (let i = 0; i < 300 && !mounted; i++) {
    step(s, { fwd: 1, right: 0, jump: false }, C);
    mounted = s.events.includes('mount');
  }
  assert.ok(mounted && s.onGround && s.standing === from, 'holding a direction climbs him back onto the island');
});

test('a drop onto a lower island is left alone (the vines only catch a fall into nothing)', () => {
  const s = standAt(-11.5, -1); // the west edge of the start island, above the lower island L1
  for (let i = 0; i < 180 && s.standing !== 'L1'; i++) step(s, { fwd: 0, right: 1, jump: false }, C); // right: 1 runs toward -x
  assert.equal(s.standing, 'L1', 'landed on the lower island');
  assert.equal(s.slips, 0);
});

test('jumping onto rising terrain stands Kai on it instead of dropping him through the island', () => {
  const v = C.platforms.find((p) => p.id === 'V2');
  // Find two neighbouring cells where the ground rises by 0.3 to 0.65 m (less than a wall), and jump from the low one to the high one.
  const hm = v.hm;
  let from = null;
  for (let j = 2; j < hm.N - 2 && !from; j++) {
    for (let i = 2; i < hm.N - 3 && !from; i++) {
      const a = hm.h[j * hm.N + i];
      const b = hm.h[j * hm.N + i + 2];
      if (a !== null && b !== null && b - a > 0.3 && b - a < 0.65) from = { i, j, a, b };
    }
  }
  assert.ok(from, 'the arch island has such a slope');
  const cell = (hm.x1 - hm.x0) / hm.N;
  const s = createState(C);
  Object.assign(s, { x: hm.x0 + (from.i + 0.5) * cell, z: hm.z0 + (from.j + 0.5) * (hm.z1 - hm.z0) / hm.N, y: from.a + 0.25, vy: -1, vx: 6, onGround: false, standing: null });
  let minBelow = 0;
  for (let i = 0; i < 40; i++) {
    step(s, { fwd: 0, right: -1, jump: false }, C);
    const h = surfaceY(v, s.x, s.z);
    if (h !== null) minBelow = Math.min(minBelow, s.y - h);
  }
  assert.ok(minBelow > -0.75, `never more than a step inside the ground (was ${minBelow.toFixed(2)} m)`);
  assert.ok(s.onGround, 'he is standing on the island');
});

test('travel: a coin takes Kai to a neighbouring checkpoint he has reached, and only there', () => {
  const s = createState(C);
  const here = 0;
  const [n1] = neighbours(C, here);
  step(s, { fwd: 0, right: 0, jump: false, travelTo: n1 }, C);
  assert.ok(s.events.includes('travel-refused'), 'not to a checkpoint he has not reached');
  s.reached[n1] = true;
  step(s, { fwd: 0, right: 0, jump: false, travelTo: n1 }, C);
  assert.ok(s.events.includes('travel-refused'), 'not without a coin');
  s.coins = 2;
  step(s, { fwd: 0, right: 0, jump: false, travelTo: n1 }, C);
  assert.ok(s.events.includes('travel'));
  assert.equal(s.spent, 1);
  assert.ok(Math.hypot(s.x - C.checkpoints[n1].x, s.z - C.checkpoints[n1].z) < 0.01, 'he is at the neighbour');
  const farIdx = C.checkpoints.length - 2; // the summit: not a neighbour of anything near the start
  s.reached[farIdx] = true;
  step(s, { fwd: 0, right: 0, jump: false, travelTo: farIdx }, C);
  assert.ok(s.events.includes('travel-refused'), 'only to a neighbour');
});

test('a dry spring wakes for a sky gem, and then its stream is water', () => {
  const si = C.streams.findIndex((st) => st.dry);
  const st = C.streams[si];
  const s = standAt(st.spring.x + 1, st.spring.z);
  s.creatures.forEach((c) => (c.x += 30)); // nothing within reach of his hand
  assert.equal(s.springs[si], false);
  assert.equal(habitatOk(s, C, 'dewling', st.plat), false, 'no water there yet');
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('spring-needs-gem'));
  step(s, { fwd: 0, right: 0, jump: false, wave: false }, C);
  s.gems = 1;
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('spring-awake'));
  assert.equal(s.springs[si], true);
  assert.equal(s.gemsSpent, 1);
  assert.equal(habitatOk(s, C, 'dewling', st.plat), true, 'a dewling can live there now');
});

test('waking the spring under a waiting dewling rehomes it, once, without carrying it', () => {
  const si = C.streams.findIndex((st) => st.plat === 'summit');
  const st = C.streams[si];
  const s = standAt(st.spring.x + 1, st.spring.z);
  const dew = s.creatures.find((c) => c.species === 'dewling' && c.plat === 'summit');
  assert.ok(dew && !dew.counted, 'a dewling waits out of place on the summit');
  s.creatures.forEach((c) => {
    if (Math.hypot(c.x - s.x, c.z - s.z) < 4) c.x += 4; // out of reach of his hand, still on the summit
  });
  s.gems = 1;
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('spring-awake'));
  assert.ok(s.events.includes('rehome'));
  assert.equal(s.rehomed, 1);
  assert.equal(dew.counted, true);
  // Carrying it and setting it down there afterwards does not count it again.
  dew.counted = true;
  const before = s.rehomed;
  step(s, { fwd: 0, right: 0, jump: false, wave: false }, C);
  assert.equal(s.rehomed, before);
});

test('X catches a creature, carries it, and setting it down in its habitat rehomes it (once)', () => {
  const s = createState(C);
  const di = s.creatures.findIndex((c) => c.species === 'dewling' && c.plat === 'A');
  assert.ok(di >= 0 && !habitatOk(s, C, 'dewling', 'A'), 'the start lawn has a dewling out of place');
  const total = s.toRehome;
  assert.ok(total >= 6, `several creatures need rehoming (${total})`);
  const d = s.creatures[di];
  Object.assign(s, { x: d.x + 1, z: d.z });
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('catch'));
  assert.equal(s.carry, di);
  step(s, { fwd: 0, right: 0, jump: false, wave: false }, C);
  // Set it down on the same dry lawn: released, not rehomed.
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('release'));
  assert.equal(s.rehomed, 0);
  step(s, { fwd: 0, right: 0, jump: false, wave: false }, C);
  // Catch it again and set it down by the stream on island C.
  Object.assign(s, { x: s.creatures[di].x + 0.5, z: s.creatures[di].z });
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.equal(s.carry, di);
  step(s, { fwd: 0, right: 0, jump: false, wave: false }, C);
  const c = standAt(0, 43);
  Object.assign(s, { x: c.x, y: c.y, z: c.z, standing: 'C', onGround: true });
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('rehome'));
  assert.equal(s.rehomed, 1);
  assert.equal(s.creatures[di].plat, 'C');
});

test('creatures live: over three minutes they eat, play and rest, stay on their islands, and a fed pair has a kit', () => {
  const s = createState(C);
  const seen = new Set();
  let kit = false;
  for (let i = 0; i < 60 * 180; i++) {
    step(s, { fwd: 0, right: 0, jump: false }, C);
    for (const c of s.creatures) seen.add(c.mood);
    if (s.events.includes('kit')) kit = true;
  }
  for (const m of ['wander', 'eat', 'play', 'rest', 'mope']) assert.ok(seen.has(m), `some creature was seen to ${m}`);
  assert.ok(kit, 'a kit was born');
  assert.ok(s.seeds.length > 0, 'seeds were left where creatures ate');
  for (const c of s.creatures) {
    const p = C.platforms.find((q) => q.id === c.plat);
    const b = platformBounds(p, s.t);
    assert.ok(c.x >= b.x0 && c.x <= b.x1 && c.z >= b.z0 && c.z <= b.z1, `${c.species} is still on ${c.plat}`);
  }
  assert.ok(Object.keys(SPECIES).length >= 3);
});

test('the lantern key is well away from its gate', () => {
  const k = keysOf(C).find((q) => q.id === 'lantern');
  const g = gatesOf(C).find((q) => q.key === 'lantern');
  assert.ok(Math.hypot(k.x - 0, k.z - g.z) > 12, 'more than 12 m from the middle of the gate');
});

test('secret: a gust beside the old stone on the far arch island wakes it, once; a gust elsewhere does not', () => {
  const sec = C.secrets.find((q) => q.kind === 'stone');
  const away = standAt(0, 0);
  away.creatures.forEach((c) => (c.x += 40));
  step(away, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(away.events.includes('wave'));
  assert.ok(!away.events.includes('secret'), 'no secret at the start');
  const s = standAt(sec.x, sec.z);
  assert.equal(s.standing, sec.plat, 'the stone stands on ground Kai can stand on');
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(s.events.includes('secret'));
  assert.equal(s.lastSecret, 'stone');
  for (let i = 0; i < 120; i++) step(s, { fwd: 0, right: 0, jump: false, wave: false }, C);
  step(s, { fwd: 0, right: 0, jump: false, wave: true }, C);
  assert.ok(!s.events.includes('secret'), 'only once');
  assert.equal(Object.keys(s.secrets).length, 1);
});

test('secret: the grounds are whole when every out-of-place creature is home and every dry spring runs', () => {
  const s = standAt(0, 0);
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(!s.secrets.whole);
  s.rehomed = s.toRehome;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(!s.secrets.whole, 'creatures alone are not enough');
  s.springs = s.springs.map(() => true);
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(s.events.includes('secret'));
  assert.equal(s.lastSecret, 'whole');
});

