// The harness an AI player uses to play the continuous level (the design bible's section 7 check, as pre-registered in
// the pre-registered criteria, kept in the project archive). Pure game logic in Node, no browser: the same rules the
// game runs. The player gets a text description of what is in sight and answers with one decision at a time.
//
//   node tools/agent_play.mjs start <run>            begin a run; prints the player's brief and the first observation
//   node tools/agent_play.mjs act <run> '<json>'     one decision; prints what happened and the next observation
//   node tools/agent_play.mjs look <run>             the current observation again (costs no decision)
//   node tools/agent_play.mjs report [run ...]       the figures the pass criteria use, from the logs
//
// A decision is JSON: { "move": [mx, mz], "jump": "press" | "hold", "vine": true, "hand": true, "travel": "Name",
//   "frames": 1..180, "stopAtEdge": true | false, "stopWhen": { "z_gte": n, "z_lte": n, "x_gte": n, "x_lte": n, "y_lte": n } }
// Everything is optional. State and log live in out/agent_runs/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COURSE_WORLD as C } from '../src/course.world.mjs';
import { PARAMS, SPECIES, createState, step, platformBounds, enemyPos, surfaceBelow, checkpointAt, neighbours, habitatOk, gatesOf, keysOf } from '../src/logic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'out', 'agent_runs');
const MAX_DECISIONS = 500;
const MAX_GAME_SECONDS = 1200;
const SIGHT = 30; // metres
const r1 = (v) => +v.toFixed(1);

const BRIEF = `SKYGROUND CITADEL: you are playing a 3D platform game as Kai, the steward of the citadel grounds.

GOAL. Reach the citadel gate at x 0, z 413 (far to the north). On the way, a steward looks after the grounds: creatures that are
out of place can be picked up and set down where they belong, and dry springs can be woken with sky gems. That work is optional;
reaching the gate finishes the level.

THE WORLD. Floating islands over a sea of cloud. Coordinates are metres: x is east (+) and west (-), z is north (+), y is up.
The road runs north along x = 0. Falling off an island with nothing below is a fall: usually the island's vines catch you below
the rim ("hanging") and you must climb back by holding any direction; with no island in reach you return to the last way-crystal.

WHAT YOU CAN DO (the same as the keys a human has):
- move: a direction [mx, mz] in world coordinates, e.g. [0, 1] is north, [1, 0] is east. Kai runs at 7 m/s.
- jump: "press" starts a jump (about 5 m long, 1.7 m high at a run); "hold" keeps the jump key held from the previous decision.
  Hold jump while rising for a full jump. A second "press" in the air is a double jump (about 8.5 m in all). Releasing early is a short hop.
- vine: near a vine bloom (listed in what you see, with its reach), its vine takes Kai's hand and he swings; move pumps the swing;
  a jump "press" lets go.
- hand: with a creature within 2.3 m, picks it up; when carrying, sets it down (in its habitat, that rehomes it); at a dry spring's
  stone with a sky gem, wakes the spring; otherwise a gust that dazes a bramble in front of Kai for 6 s.
- travel: standing at a way-crystal, go to a neighbouring crystal you have already reached, for one coin.
- frames: how long the decision lasts (60 frames = 1 second, at most 180). It stops early when something happens (you land, are
  hit, are caught by vines, reach a crystal, pick something up), at an island's edge (unless "stopAtEdge": false, which you need to
  walk or run off an edge on purpose, e.g. a running jump or a drop to a lower island), or when a "stopWhen" position is reached.

HAZARDS. Brambles (dark spiked balls) hurt on touch: 3 hearts, then back to the last way-crystal. They patrol a short line by their
nest. Nothing else hurts. Sliding islands and a raft move back and forth: what you see gives where each is now and in one second.

Each reply is JSON: "happened" (events during your decision), "see" (what is in sight now), "tip" (the hint the game shows on
screen at this spot, if any), and "left" (decisions and seconds remaining). Play to finish; do the steward's work if you see how.
Send one decision per call:  node tools/agent_play.mjs act <run> '{"move":[0,1],"frames":60}'`;

function file(run, ext) {
  return path.join(DIR, `${run}.${ext}`);
}
function load(run) {
  return JSON.parse(fs.readFileSync(file(run, 'json'), 'utf8'));
}
function save(run, data) {
  fs.writeFileSync(file(run, 'json'), JSON.stringify(data));
}
function areaIndex(z) {
  return Math.max(0, C.areas.findIndex((a) => z >= a.z0 && z < a.z1));
}

/** The hint the game would show on screen here (the same rules as the renderer's tip line). */
function tipFor(s) {
  if (s.hang) return "The island's vines caught you: hold a direction or Space to climb back";
  if (s.carry >= 0) {
    const c = s.creatures[s.carry];
    const words = { meadow: 'a lawn to graze', water: 'a running stream', blossom: 'blossom trees' }[SPECIES[c.species].habitat];
    return habitatOk(s, C, c.species, s.standing) ? `This is a home for the ${c.species}: the hand sets it down` : `The ${c.species} needs ${words} · the hand sets it down`;
  }
  const hit = C.tips.find((q) => s.z >= q.z0 && s.z < q.z1 && Math.abs(s.x - (q.x ?? 0)) < (q.w ?? 7) && (!q.until || !q.until(s)));
  if (hit) return hit.text.replace(/\bX\b/g, 'the hand').replace(/\bE\b/g, 'the vine key').replace(/Space/g, 'jump');
  const here = checkpointAt(s, C);
  if (s.onGround && here >= 0 && neighbours(C, here).some((i) => s.reached[i])) return 'Travel from this way-crystal to another you have reached (1 coin)';
  return '';
}

function near(ax, az, s, d) {
  return Math.hypot(ax - s.x, az - s.z) <= d;
}

/** What the player can see. */
function observe(s) {
  const t = s.t;
  const plats = [];
  for (const p of C.platforms) {
    const b = platformBounds(p, t);
    const dx = Math.max(b.x0 - s.x, 0, s.x - b.x1);
    const dz = Math.max(b.z0 - s.z, 0, s.z - b.z1);
    if (Math.hypot(dx, dz) > SIGHT) continue;
    const o = { id: p.id, x: [r1(b.x0), r1(b.x1)], z: [r1(b.z0), r1(b.z1)], y: p.hm ? 'terrain around ' + r1(p.y) : r1(b.y) };
    if (p.kind) o.kind = p.kind === 'deck' ? 'wooden deck' : 'rope bridge (railed)';
    if (p.fenced && !p.kind) o.kind = 'fenced path';
    if (p.move) {
      const b1 = platformBounds(p, t + 1);
      o.moving = { axis: p.move.axis, in1s: p.move.axis === 'x' ? [r1(b1.x0), r1(b1.x1)] : [r1(b1.z0), r1(b1.z1)] };
    }
    const habs = (C.habitats || {})[p.id] || [];
    if (habs.length) o.offers = habs.map((h) => (h === 'meadow' ? 'lawn' : 'blossom trees'));
    plats.push(o);
  }
  const see = {
    kai: {
      x: r1(s.x),
      y: r1(s.y),
      z: r1(s.z),
      speed: [r1(s.vx), r1(s.vy), r1(s.vz)],
      onGround: s.onGround,
      standingOn: s.standing,
      airJumpLeft: s.airJumps > 0,
      hearts: s.hearts,
      safeFor: s.hurtCd > 0 ? r1(s.hurtCd) : 0,
    },
    area: C.areas[areaIndex(s.z)].name,
    hud: { coins: s.coins - s.spent, skyGems: s.gems - s.gemsSpent, keys: Object.keys(s.keysHeld), rehomed: `${s.rehomed}/${s.toRehome}` },
    islands: plats,
  };
  if (s.hang) see.kai.hanging = { below: r1(s.hang.depth), from: s.hang.plat };
  if (s.rope) see.kai.onVine = { bloomAt: [C.anchors[s.rope.i].x, C.anchors[s.rope.i].y, C.anchors[s.rope.i].z], length: r1(s.rope.L) };
  if (s.rail) see.kai.onRail = true;
  if (s.carry >= 0) see.kai.carrying = s.creatures[s.carry].species;
  const brambles = [];
  (C.enemies || []).forEach((e, i) => {
    if (s.defeated[i]) return;
    const p = enemyPos(e, t);
    if (!near(p.x, p.z, s, 22)) return;
    const p1 = enemyPos(e, t + 0.5);
    const o = { what: e.stomp ? 'shellback asleep on the citadel key (land on its shell)' : 'bramble', at: [r1(p.x), r1(p.y), r1(p.z)], in0_5s: [r1(p1.x), r1(p1.z)], radius: e.r };
    if (s.stunUntil[i] > t) o.dazedFor = r1(s.stunUntil[i] - t);
    brambles.push(o);
  });
  if (brambles.length) see.creaturesThatHurt = brambles;
  const cr = [];
  s.creatures.forEach((c) => {
    if (c.carried || !near(c.x, c.z, s, 20)) return;
    cr.push({ species: c.species + (c.kit ? ' kit' : ''), at: [r1(c.x), r1(c.z)], on: c.plat, doing: c.mood === 'mope' ? 'moping (out of place)' : c.mood, atHome: habitatOk(s, C, c.species, c.plat), needs: { meadow: 'lawn', water: 'running stream', blossom: 'blossom trees' }[SPECIES[c.species].habitat] });
  });
  if (cr.length) see.creatures = cr;
  const coins = C.coins.map((c, i) => ({ c, i })).filter((o) => !s.collected[o.i] && near(o.c.x, o.c.z, s, 14)).sort((a, b) => Math.hypot(a.c.x - s.x, a.c.z - s.z) - Math.hypot(b.c.x - s.x, b.c.z - s.z));
  if (coins.length) see.coinsNear = { count: coins.length, nearest: coins.slice(0, 5).map((o) => [r1(o.c.x), r1(o.c.y), r1(o.c.z)]) };
  const gems = (C.gems || []).filter((g, i) => !s.gemsCollected[i] && near(g.x, g.z, s, SIGHT)).map((g) => [r1(g.x), r1(g.y), r1(g.z)]);
  if (gems.length) see.skyGems = gems;
  const keys = keysOf(C).filter((k) => !s.keysHeld[k.id] && near(k.x, k.z, s, SIGHT)).map((k) => ({ key: k.id, at: [r1(k.x), r1(k.y), r1(k.z)] }));
  if (keys.length) see.keys = keys;
  const gates = gatesOf(C).filter((g) => Math.abs(g.z - s.z) < SIGHT).map((g) => ({ gate: g.id, acrossZ: g.z, locked: !s.keysHeld[g.key], needsKey: g.key }));
  if (gates.length) see.gates = gates;
  const pads = (C.springs || []).filter((p) => near(p.x, p.z, s, 20) && Math.abs((p.y || 0) - s.y) < 6).map((p) => ({ pad: [r1(p.x), r1(p.y || 0), r1(p.z)], throws: p.dir ? [p.dir.x, p.dir.z] : 'straight up (keep running the way you came)' }));
  if (pads.length) see.bouncePads = pads;
  const blooms = (C.anchors || []).filter((a) => near(a.x, a.z, s, 22)).map((a) => ({ bloom: [a.x, r1(a.y), a.z], reach: a.range, inReach: Math.hypot(a.x - s.x, a.y - (s.y + PARAMS.handHeight), a.z - s.z) <= a.range }));
  if (blooms.length) see.vineBlooms = blooms;
  const rails = (C.rails || []).filter((r) => Math.abs(r.z0 - s.z) < 25 || (s.z > r.z0 && s.z < r.z1)).map((r) => ({ rail: { x: r.x, from: [r.z0, r1(r.y0)], to: [r.z1, r1(r.y1)] }, how: 'jump up so Kai\'s hands (1.85 m above his feet) reach it; it carries him along; a jump press leaves it' }));
  if (rails.length) see.rails = rails;
  const streams = (C.streams || []).map((st, i) => ({ st, i })).filter((o) => near(o.st.spring.x, o.st.spring.z, s, SIGHT)).map((o) => ({ island: o.st.plat, acrossZ: [o.st.z0, o.st.z1], springStone: [o.st.spring.x, o.st.spring.z], state: s.springs[o.i] ? 'running' : 'dry (a sky gem given at the stone wakes it)' }));
  if (streams.length) see.streams = streams;
  const cps = C.checkpoints.map((c, i) => ({ c, i })).filter((o) => near(o.c.x, o.c.z, s, 16)).map((o) => ({ crystal: o.c.name, at: [o.c.x, o.c.z], reached: s.reached[o.i] }));
  if (cps.length) see.wayCrystals = cps;
  const here = checkpointAt(s, C);
  if (here >= 0 && s.onGround) see.travelFromHere = neighbours(C, here).filter((i) => s.reached[i]).map((i) => C.checkpoints[i].name);
  see.fences = (C.walls || []).filter((w) => s.z > w.z0 - 12 && s.z < w.z1 + 12).map((w) => ({ x: w.x, z: [w.z0, w.z1], height: 1 }));
  if (!see.fences.length) delete see.fences;
  return see;
}

function newStats() {
  return C.areas.map(() => ({ returns: 0, hits: 0, slips: 0, seconds: 0 }));
}

function act(run, d) {
  const data = load(run);
  const s = data.state;
  if (data.over) return { over: data.over };
  const frames = Math.max(1, Math.min(180, Math.round(d.frames ?? 30)));
  let mx = 0;
  let mz = 0;
  if (Array.isArray(d.move)) {
    const l = Math.hypot(d.move[0], d.move[1]);
    if (l > 0.01) {
      mx = d.move[0] / Math.max(1, l);
      mz = d.move[1] / Math.max(1, l);
    }
  }
  const stopAtEdge = d.stopAtEdge !== false;
  const sw = d.stopWhen || {};
  const happened = [];
  let travelTo = null;
  if (d.travel) {
    travelTo = C.checkpoints.findIndex((c) => c.name && c.name.toLowerCase() === String(d.travel).toLowerCase());
    if (travelTo < 0) happened.push(`no way-crystal is called "${d.travel}"`);
  }
  let stop = '';
  let wasAir = !s.onGround;
  let n = 0;
  for (; n < frames && !stop; n++) {
    // Stop at an island's edge before stepping off it (a human sees the edge).
    if (stopAtEdge && s.onGround && !s.hang && (mx || mz) && !d.jump) {
      const ax = s.x + mx * 0.7;
      const az = s.z + mz * 0.7;
      const g = surfaceBelow(C, ax, az, s.y + 0.5, 0.15, s.t);
      if (!g || g.h < s.y - 0.8) {
        stop = 'at an edge';
        break;
      }
    }
    const first = n === 0;
    const input = {
      fwd: mz,
      right: -mx,
      jump: d.jump === 'press' ? !(first && s.prevJump) : d.jump === 'hold',
      grapple: !!d.vine && first,
      wave: !!d.hand && first,
      travelTo: first && travelTo !== null && travelTo >= 0 ? travelTo : null,
    };
    // A fresh press needs the key up for a frame first.
    if (first && d.jump === 'press' && s.prevJump) step(s, { ...input, jump: false, grapple: false, wave: false, travelTo: null }, C);
    const zBefore = s.z;
    const ai = areaIndex(zBefore);
    step(s, input, C);
    data.stats[ai].seconds += PARAMS.dt;
    for (const e of s.events) {
      if (e === 'climb' || e === 'jump' || e === 'doublejump' || e === 'seed' || e === 'kit') {
        if ((e === 'jump' || e === 'doublejump') && !happened.includes(e)) happened.push(e);
        continue;
      }
      happened.push(e);
      if (e === 'respawn') data.stats[ai].returns += 1;
      if (e === 'hurt') data.stats[ai].hits += 1;
      if (e === 'vinecatch') data.stats[ai].slips += 1;
      if (e === 'grapple') data.blooms += 1;
      if (e === 'travel') data.travels += 1;
      if (['respawn', 'hurt', 'vinecatch', 'mount', 'spring', 'grapple', 'release', 'key', 'gem', 'catch', 'rehome', 'release', 'complete', 'checkpoint', 'stomp', 'spring-awake', 'spring-needs-gem', 'travel', 'travel-refused', 'grind', 'railend', 'waveblock'].includes(e)) stop = e;
    }
    if (!s.onGround) wasAir = true;
    else if (wasAir && !stop) stop = 'landed';
    if (!stop) {
      if (sw.z_gte !== undefined && s.z >= sw.z_gte) stop = 'stopWhen z_gte';
      else if (sw.z_lte !== undefined && s.z <= sw.z_lte) stop = 'stopWhen z_lte';
      else if (sw.x_gte !== undefined && s.x >= sw.x_gte) stop = 'stopWhen x_gte';
      else if (sw.x_lte !== undefined && s.x <= sw.x_lte) stop = 'stopWhen x_lte';
      else if (sw.y_lte !== undefined && s.y <= sw.y_lte) stop = 'stopWhen y_lte';
    }
    // Automatic checks for an invalid state (pre-registered).
    if (![s.x, s.y, s.z].every(Number.isFinite)) data.flags.push({ t: s.t, flag: 'non-finite position' });
    data.airborne = s.onGround || s.hang || s.rope || s.rail ? 0 : data.airborne + PARAMS.dt;
    if (data.airborne > 15 && !data.flags.some((f) => f.flag === 'airborne over 15 s')) data.flags.push({ t: s.t, flag: 'airborne over 15 s' });
    if (s.hang && (mx || mz || input.jump)) {
      data.hangClimb = (data.hangClimb || 0) + PARAMS.dt;
      if (data.hangClimb > 3 && s.hang.depth >= data.hangDepth0 - 0.05) data.flags.push({ t: s.t, flag: 'climbing for 3 s without rising' });
    } else {
      data.hangClimb = 0;
      data.hangDepth0 = s.hang ? s.hang.depth : 0;
    }
  }
  data.decisions += 1;
  data.maxZ = Math.max(data.maxZ, s.z);
  if (s.status === 'complete') data.over = 'reached the citadel gate';
  else if (data.decisions >= MAX_DECISIONS) data.over = 'out of decisions';
  else if (s.t >= MAX_GAME_SECONDS) data.over = 'out of time';
  fs.appendFileSync(file(run, 'jsonl'), JSON.stringify({ n: data.decisions, t: r1(s.t), decision: d, frames: n, stop, happened, pos: [r1(s.x), r1(s.y), r1(s.z)], area: areaIndex(s.z), carry: s.carry, rehomed: s.rehomed }) + '\n');
  save(run, data);
  const out = { happened, stoppedBecause: stop || 'the frames ran out', framesUsed: n };
  if (data.over) out.over = data.over;
  out.tip = tipFor(s);
  out.see = observe(s);
  out.left = { decisions: MAX_DECISIONS - data.decisions, seconds: Math.round(MAX_GAME_SECONDS - s.t) };
  return out;
}

function report(runs) {
  const rows = [];
  for (const run of runs) {
    const data = load(run);
    const s = data.state;
    rows.push({
      run,
      result: data.over || 'unfinished',
      complete: s.status === 'complete',
      gameSeconds: r1(s.t),
      decisions: data.decisions,
      maxZ: r1(data.maxZ),
      attemptsPerAct: data.stats.map((a) => a.returns + 1),
      hitsPerAct: data.stats.map((a) => a.hits),
      slipsPerAct: data.stats.map((a) => a.slips),
      secondsPerAct: data.stats.map((a) => Math.round(a.seconds)),
      rehomed: `${s.rehomed}/${s.toRehome}`,
      springsWoken: s.gemsSpent,
      gems: s.gems,
      coins: s.coins,
      travels: data.travels,
      vinesTaken: data.blooms,
      flags: data.flags,
    });
  }
  const done = rows.filter((r) => r.complete);
  const verdict = {
    '1 completion (at least 4 of 5)': `${done.length} of ${rows.length}: ${done.length >= 4 && rows.length >= 5 ? 'PASS' : rows.length < 5 ? 'INCOMPLETE (fewer than 5 runs)' : 'FAIL'}`,
    '2 attempts (acts 1-4 and 6 at most 3, act 5 at most 5, in completed runs)': done.every((r) => r.attemptsPerAct.every((a, i) => a <= (i === 4 ? 5 : 3))) ? 'PASS' : 'FAIL',
    '3 challenge floor (a hit, slip or failed attempt in act 5 across the runs)': rows.some((r) => r.hitsPerAct[4] + r.slipsPerAct[4] + (r.attemptsPerAct[4] - 1) > 0) ? 'PASS' : 'FAIL',
    '4 automatic invalid-state flags (each needs review)': rows.reduce((k, r) => k + r.flags.length, 0),
  };
  return { acts: C.areas.map((a) => a.name), runs: rows, verdict };
}

const [cmd, ...rest] = process.argv.slice(2);
fs.mkdirSync(DIR, { recursive: true });
if (cmd === 'start') {
  const run = rest[0];
  if (!run) throw new Error('usage: start <run>');
  if (fs.existsSync(file(run, 'json'))) {
    console.log(JSON.stringify({ error: `run ${run} already exists; use "look" to see where it stands` }));
  } else {
    const s = createState(C);
    save(run, { state: s, decisions: 0, maxZ: s.z, stats: newStats(), flags: [], airborne: 0, blooms: 0, travels: 0, over: '' });
    console.log(BRIEF.replaceAll('<run>', run));
    console.log(JSON.stringify({ tip: tipFor(s), see: observe(s), left: { decisions: MAX_DECISIONS, seconds: MAX_GAME_SECONDS } }));
  }
} else if (cmd === 'act') {
  const [run, json] = rest;
  let d;
  try {
    d = JSON.parse(json);
  } catch (err) {
    console.log(JSON.stringify({ error: 'the decision is not valid JSON: ' + err.message }));
    process.exit(0);
  }
  console.log(JSON.stringify(act(run, d)));
} else if (cmd === 'look') {
  const data = load(rest[0]);
  console.log(JSON.stringify({ over: data.over || undefined, tip: tipFor(data.state), see: observe(data.state), left: { decisions: MAX_DECISIONS - data.decisions, seconds: Math.round(MAX_GAME_SECONDS - data.state.t) } }));
} else if (cmd === 'report') {
  const runs = rest.length ? rest : fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  console.log(JSON.stringify(report(runs), null, 1));
} else {
  console.log('usage: agent_play.mjs start <run> | act <run> <json> | look <run> | report [run ...]');
}
