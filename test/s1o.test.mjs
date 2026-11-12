// Tests for the open S1: three routes to one goal, region checkpoints and goal. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_S1_OPEN as C } from '../src/course.s1o.mjs';
import { PARAMS, createState, step, navigate, supportBelow, surfaceY } from '../src/logic.mjs';
import { ISLAND_MODELS } from '../src/islands.data.mjs';

function follow(name, seconds = 60, options = {}) {
  const s = createState(C);
  const touched = new Set();
  let springs = 0;
  for (let i = 0; i < Math.round(seconds / PARAMS.dt) && s.status === 'playing'; i++) {
    step(s, navigate(s, C, C.routes[name], options), C);
    if (s.events.includes('spring')) springs++;
    const p = C.platforms.find((q) => s.onGround && s.x >= q.x0 && s.x <= q.x1 && s.z >= q.z0 && s.z <= q.z1 && Math.abs(s.y - (q.hm ? surfaceY(q, s.x, s.z) ?? 1e9 : q.y)) < 0.12);
    if (p) touched.add(p.id);
  }
  s.touched = touched;
  s.springs = springs;
  return s;
}

test('every route is completable with no falls', () => {
  for (const name of Object.keys(C.routes)) {
    const s = follow(name);
    assert.equal(s.status, 'complete', `${name} completes`);
    assert.equal(s.deaths, 0, `${name} has no falls`);
  }
});

test('the routes really are different ways: the centre never touches the high road, the west never touches the fenced path', () => {
  const centre = follow('centre').touched;
  const west = follow('west').touched;
  assert.ok(centre.has('B') && centre.has('C') && centre.has('D') && centre.has('E'));
  assert.ok(!centre.has('H1') && !centre.has('H2') && !centre.has('H3'));
  assert.ok(west.has('H1') && west.has('H2') && west.has('H3') && west.has('I2') && west.has('F'));
  assert.ok(!west.has('B') && !west.has('C') && !west.has('E'));
});

test('the secret islet is a real detour: it holds a cluster of lanterns, and visiting it collects more than the plain centre route', () => {
  const secret = follow('secret');
  const centre = follow('centre');
  assert.ok(secret.touched.has('S'));
  assert.ok(!centre.touched.has('S'));
  assert.ok(secret.coins >= centre.coins + 5, `secret ${secret.coins} vs centre ${centre.coins}`);
});

test('the high road is above a double jump from the start island, but the stairs and the pad both lead up to it', () => {
  const h1 = C.platforms.find((p) => p.id === 'H1');
  const doubleJumpApex = PARAMS.jumpSpeed ** 2 / (2 * PARAMS.gravity) + PARAMS.doubleJumpSpeed ** 2 / (2 * PARAMS.gravity);
  assert.ok(h1.y > doubleJumpApex + 0.5, `H1 at ${h1.y} m vs a double jump's ${doubleJumpApex.toFixed(1)} m`);
});

test('the pad carries Kai onto the high road however he steps on it (from the south, the east, diagonally, slowly, even jumping)', () => {
  const tries = [
    { name: 'straight at it', x: -9.7, z: 6, input: { fwd: 1, right: 0 } },
    { name: 'from the east', x: -6, z: 9.5, input: { fwd: 0, right: 1 } },
    { name: 'diagonally', x: -7.5, z: 7.5, input: { fwd: 0.7, right: 0.7 } },
    { name: 'from the west edge', x: -11.5, z: 9.5, input: { fwd: 0, right: -1 } },
    { name: 'while jumping onto it', x: -9.7, z: 6, input: { fwd: 1, right: 0 }, jump: true },
    { name: 'from the north (coming back)', x: -9.7, z: 11.5, input: { fwd: -1, right: 0 } },
    { name: 'straight at it, holding forward all the way', x: -9.7, z: 6, input: { fwd: 1, right: 0 }, holdForward: true },
  ];
  for (const t of tries) {
    const s = createState(C);
    s.x = t.x; s.z = t.z; s.standing = 'A';
    let fired = false;
    const visited = new Set();
    // walk onto the pad with the given input, let go of the keys once it fires (or keep holding forward in the last case)
    for (let i = 0; i < 40; i++) {
      const input = fired ? (t.holdForward ? { fwd: 1, right: 0 } : { fwd: 0, right: 0 }) : t.input;
      step(s, { ...input, jump: !!t.jump && i === 0 }, C);
      if (s.events.includes('spring')) fired = true;
      if (s.standing) visited.add(s.standing);
    }
    // then fly and land (still holding forward, or with the keys let go) until he is standing on the high road
    for (let i = 0; i < 150 && s.deaths === 0 && !visited.has('H1') && !visited.has('H2'); i++) {
      step(s, t.holdForward ? { fwd: 1, right: 0, jump: false } : { fwd: 0, right: 0, jump: false }, C);
      if (s.standing) visited.add(s.standing);
    }
    assert.ok(fired, `${t.name}: the pad fired`);
    assert.equal(s.deaths, 0, `${t.name}: no fall`);
    assert.ok(visited.has('H1') || visited.has('H2'), `${t.name}: lands on the high road (stood on ${[...visited].join(', ')})`);
  }
});

test('vertical access: the stairs reach the high road on foot with no pad, and the pad is a shortcut to the same ledges', () => {
  const stairs = follow('stairs');
  assert.equal(stairs.status, 'complete');
  assert.equal(stairs.deaths, 0);
  assert.equal(stairs.springs, 0, 'no pad used');
  for (const id of ['T1', 'T2', 'T3', 'H1', 'H2', 'H3']) assert.ok(stairs.touched.has(id), `stood on ${id}`);
  const west = follow('west');
  assert.ok(west.springs >= 1 && west.touched.has('H1') && !west.touched.has('T1'));
  for (const [a, b] of [['A', 'T1'], ['T1', 'T2'], ['T2', 'T3']]) {
    const pa = C.platforms.find((q) => q.id === a);
    const pb = C.platforms.find((q) => q.id === b);
    assert.ok(pb.y - pa.y <= 1.2, `${b} is a single jump up from ${a}`);
  }
});

test('vertical access down and back: the lower islands can be dropped onto and left again on their pads', () => {
  const lower = follow('lower');
  assert.equal(lower.status, 'complete');
  assert.equal(lower.deaths, 0);
  assert.ok(lower.touched.has('L1'), 'stood on the lower island');
  assert.ok(lower.springs >= 1, 'came back up on its pad');
  // from L2 too
  const s = createState(C);
  s.x = 12.5; s.z = -6; s.y = -3.5; s.standing = 'L2';
  let fired = false;
  for (let i = 0; i < 20; i++) { step(s, { fwd: 0, right: 0, jump: false }, C); if (s.events.includes('spring')) fired = true; }
  for (let i = 0; i < 150 && s.deaths === 0 && s.standing !== 'A'; i++) step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.ok(fired && s.deaths === 0 && s.standing === 'A', `L2's pad returns Kai to the start island (on ${s.standing})`);
});

test('stacked platforms: support depends on height, so a platform above never captures Kai walking beneath it', () => {
  // T1 (y 1.1) is directly above part of L1 (y -4)
  assert.equal(supportBelow(C, -15.5, 3, 5).id, 'T1');
  assert.equal(supportBelow(C, -15.5, 3, 0.5).id, 'L1');
  assert.equal(supportBelow(C, -15.5, 3, -3.9).id, 'L1');
  assert.equal(supportBelow(C, -15.5, 3, -4.5), null);
  // standing on L1 under T1 and jumping lands back on L1 (the ceiling is one-way: passes up through, lands from above)
  const s = createState(C);
  s.x = -15.5; s.z = 3; s.y = -4; s.standing = 'L1';
  for (let i = 0; i < 40; i++) step(s, { fwd: 0, right: 0, jump: i === 0 }, C);
  assert.equal(s.standing, 'L1');
  assert.equal(s.deaths, 0);
});

const visits = C.platforms.filter((p) => p.model);
const modelBox = (p) => {
  const m = ISLAND_MODELS[p.model.name].box;
  const k = p.model.s;
  return { x0: p.model.x + m.minX * k, x1: p.model.x + m.maxX * k, z0: p.model.z + m.minZ * k, z1: p.model.z + m.maxZ * k, y0: p.model.y + m.minY * k, y1: p.model.y + m.maxY * k };
};

const landCells = (p) => {
  const { hm } = p;
  const cells = [];
  for (let j = 0; j < hm.N; j++) {
    for (let i = 0; i < hm.N; i++) {
      const h = hm.h[j * hm.N + i];
      if (h !== null) cells.push({ x: hm.x0 + ((i + 0.5) / hm.N) * (hm.x1 - hm.x0), z: hm.z0 + ((j + 0.5) / hm.N) * (hm.z1 - hm.z0), h });
    }
  }
  return cells;
};

test('there are four visit islands (the generated lawn, ruin and arch islands), each a real place with room to wander and lanterns on its ground', () => {
  assert.equal(visits.length, 4);
  assert.deepEqual([...new Set(visits.map((p) => p.model.name))].sort(), ['island_a', 'island_b', 'island_c']);
  for (const p of visits) {
    const cells = landCells(p);
    const cell = ((p.x1 - p.x0) / p.hm.N) * ((p.z1 - p.z0) / p.hm.N);
    assert.ok(cells.length * cell >= 40, `${p.id} has ${(cells.length * cell).toFixed(0)} m2 of ground`);
    const coins = C.coins.filter((c) => c.x >= p.x0 && c.x <= p.x1 && c.z >= p.z0 && c.z <= p.z1);
    assert.ok(coins.length >= 3, `${p.id} has lanterns to find`);
    for (const c of coins) {
      const h = surfaceY(p, c.x, c.z);
      assert.ok(h !== null, `a lantern on ${p.id} at (${c.x}, ${c.z}) is over ground`);
      assert.ok(c.y - h <= 2.25 && c.y - h >= 0.2, `a lantern on ${p.id} floats ${(c.y - h).toFixed(1)} m above the terrain`);
    }
  }
});

test('no part of a visible island is a jump-through: dropping Kai onto any ground point of any visit island lands him on it (the terrain, edges, hills and filled-in tree and ruin spots included)', () => {
  for (const p of visits) {
    const cells = landCells(p);
    let checked = 0;
    for (let k = 0; k < cells.length; k += 7) {
      const c = cells[k];
      if (C.springs.some((sp) => Math.hypot(sp.x - c.x, sp.z - c.z) < sp.r + 0.6)) continue; // a pad is meant to fire there
      const h = surfaceY(p, c.x, c.z);
      const s = createState(C);
      s.x = c.x; s.z = c.z; s.y = h + 1.5; s.vy = 0; s.onGround = false; s.standing = null;
      for (let i = 0; i < 90 && !s.onGround && s.deaths === 0; i++) step(s, { fwd: 0, right: 0, jump: false }, C);
      assert.equal(s.deaths, 0, `${p.id} (${c.x.toFixed(1)}, ${c.z.toFixed(1)}): fell through`);
      assert.ok(s.onGround && Math.abs(s.y - h) < 0.5, `${p.id} (${c.x.toFixed(1)}, ${c.z.toFixed(1)}): landed at ${s.y.toFixed(2)}, ground is ${h.toFixed(2)}`);
      checked++;
    }
    assert.ok(checked >= 20, `${p.id}: ${checked} points checked`);
  }
});

test('walking on terrain: Kai follows the ground over the lawn, is stopped by a cliff, and walks off the edge into a fall', () => {
  const v = visits.find((q) => q.id === 'V1');
  const cells = landCells(v);
  // follow: walk a line across the lawn island's middle and stay on it
  const s = createState(C);
  const mid = cells.filter((c) => Math.abs(c.z - (v.z0 + v.z1) / 2) < 0.6).sort((a, b) => a.x - b.x);
  s.x = mid[Math.floor(mid.length * 0.25)].x; s.z = mid[0].z; s.y = mid[Math.floor(mid.length * 0.25)].h; s.onGround = true; s.standing = 'V1';
  for (let i = 0; i < 60; i++) step(s, { fwd: 0, right: -1, jump: false }, C); // right = -1 walks toward +X
  assert.equal(s.deaths, 0);
  assert.ok(s.onGround && s.standing === 'V1', 'still on the island after walking across it');
  const h = surfaceY(v, s.x, s.z);
  assert.ok(Math.abs(s.y - h) < 0.1, 'standing on the terrain at its height');
  // keep walking east to the edge: he leaves the island and falls
  for (let i = 0; i < 200 && s.deaths === 0 && s.onGround; i++) step(s, { fwd: 0, right: -1, jump: false }, C);
  assert.ok(!s.onGround || s.deaths > 0, 'walked off the edge');
});

test('every visit island can be reached and left again (the routes stand on all four and come back)', () => {
  const stood = new Set();
  for (const name of ['ruin', 'arch', 'ruinisle', 'archisle']) {
    const r = follow(name);
    assert.equal(r.status, 'complete', `${name} completes`);
    assert.equal(r.deaths, 0, `${name} has no falls`);
    r.touched.forEach((id) => stood.add(id));
  }
  for (const id of ['V1', 'V2', 'V3', 'V4']) assert.ok(stood.has(id), `stood on ${id}`);
});

test('the far visit islands are separated by empty air from their neighbours: more than a step, less than a double jump', () => {
  const p = (id) => C.platforms.find((q) => q.id === id);
  const gap = (a, b) => {
    let best = Infinity;
    const ca = landCells(p(a));
    const cb = landCells(p(b));
    for (let i = 0; i < ca.length; i += 3) for (let j = 0; j < cb.length; j += 3) best = Math.min(best, Math.hypot(ca[i].x - cb[j].x, ca[i].z - cb[j].z));
    return best;
  };
  const single = (2 * PARAMS.jumpSpeed * PARAMS.runSpeed) / PARAMS.gravity;
  for (const [a, b] of [['V2', 'V3'], ['V1', 'V4']]) {
    const g = gap(a, b);
    assert.ok(g > 2 && g < 8.6, `${a} to ${b}: ${g.toFixed(1)} m of air (a single jump covers ${single.toFixed(1)} m)`);
  }
});

test('no visit island sits on top of another platform: its model clears every other platform (rims of two visit islands may touch)', () => {
  for (const v of visits) {
    const b = modelBox(v);
    for (const q of C.platforms) {
      if (q === v) continue;
      const xz = q.x0 < b.x1 && q.x1 > b.x0 && q.z0 < b.z1 && q.z1 > b.z0;
      const yy = q.y > b.y0 && q.y < b.y1;
      if (q.model) {
        const o = modelBox(q);
        const ox = Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0);
        const oz = Math.min(b.z1, o.z1) - Math.max(b.z0, o.z0);
        if (ox > 0 && oz > 0) assert.ok(Math.min(ox, oz) <= 3.5, `${v.id} and ${q.id} models overlap by ${Math.min(ox, oz).toFixed(1)} m`);
      } else assert.ok(!(xz && yy), `${v.id}'s model overlaps platform ${q.id}`);
    }
  }
});

test('the gap to the secret islet needs a double jump, and so does the gap from C to D', () => {
  const p = (id) => C.platforms.find((q) => q.id === id);
  const single = (2 * PARAMS.jumpSpeed * PARAMS.runSpeed) / PARAMS.gravity;
  assert.ok(p('S').x0 - p('C').x1 > single + 0.5);
  assert.ok(p('D').z0 - p('C').z1 > single + 0.5);
  assert.ok(p('S').x0 - p('C').x1 < 8.6 && p('D').z0 - p('C').z1 < 8.6, 'but a double jump reaches');
});

test('without the double jump the centre route falls at the 7 m gap', () => {
  const s = follow('centre', 60, { doubleJump: false });
  assert.ok(s.deaths >= 1);
});

test('checkpoints are regions: the last one stood in is the respawn point, on any route', () => {
  const s = createState(C);
  // stand on the high road's second ledge
  s.x = -9.7; s.z = 28.5; s.y = 4.5; s.standing = 'H2';
  step(s, { fwd: 0, right: 0, jump: false }, C);
  const west = C.checkpoints.findIndex((c) => Math.hypot(c.x + 9.7, c.z - 28.5) < 0.1);
  assert.equal(s.checkpoint, west);
  // fall: respawn standing on that ledge at its height
  s.y = C.killY - 1; s.onGround = false;
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.deaths, 1);
  assert.equal(s.y, 4.5);
  for (let i = 0; i < 90; i++) step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.deaths, 1, 'stays up');
});

test('standing in an earlier checkpoint region later makes it the respawn point again (last reached, not furthest)', () => {
  const s = createState(C);
  const cpC = C.checkpoints.findIndex((c) => c.z === 38 && c.x === 0);
  s.x = 0; s.z = 38; s.standing = 'C';
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.checkpoint, cpC);
  s.x = 0; s.z = 2; s.standing = 'A';
  step(s, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(s.checkpoint, 0);
});

test('the goal is a region: standing in it completes, being beside it does not', () => {
  const near = createState(C);
  near.x = 6; near.z = 92; near.y = 0; near.standing = 'G';
  step(near, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(near.status, 'playing');
  const on = createState(C);
  on.x = 1; on.z = 92; on.y = 0; on.standing = 'G';
  step(on, { fwd: 0, right: 0, jump: false }, C);
  assert.equal(on.status, 'complete');
});

test('all routes start from the same island and end on the same goal island', () => {
  for (const name of Object.keys(C.routes)) {
    const last = C.routes[name][C.routes[name].length - 1];
    assert.ok(Math.hypot(last.x - C.goal.x, last.z - C.goal.z) <= C.goal.r, `${name} ends in the goal region`);
  }
});

test('the open S1 is deterministic', () => {
  const a = follow('west');
  const b = follow('west');
  assert.equal(a.t, b.t);
  assert.equal(a.coins, b.coins);
});

test('every pickup is over a platform or on a jump arc over a gap', () => {
  for (const c of C.coins) {
    const over = C.platforms.find((p) => c.x >= p.x0 && c.x <= p.x1 && c.z >= p.z0 && c.z <= p.z1 && (!p.hm || surfaceY(p, c.x, c.z) !== null));
    if (over) {
      const h = over.hm ? surfaceY(over, c.x, c.z) : over.y;
      assert.ok(c.y - h <= 2.6, `pickup at (${c.x}, ${c.z}) floats ${(c.y - h).toFixed(1)} m over ${over.id}`);
    } else assert.ok(c.y >= 3.4, `pickup at (${c.x}, ${c.z}) is over nothing and low`);
  }
});
