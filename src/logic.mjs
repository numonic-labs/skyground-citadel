// Pure game logic for Skyground Citadel L1 (S1, S2). No DOM, no three.js: the browser and the Node tests both import this,
// so a playthrough can be simulated and checked without rendering anything.
//
// A course may add three optional features (S2): `springs` (launch pads), `enemies` (patrolling flyers, with hearts)
// and platforms with a `move` (a sliding raft). A course without them behaves exactly as in S1.

export const PARAMS = {
  dt: 1 / 60,
  runSpeed: 7, // m/s
  accel: 40, // m/s^2 on the ground
  airAccel: 18, // m/s^2 in the air
  stepUp: 0.7, // m: the tallest step Kai walks up on terrain (a heightfield platform); anything higher is a wall
  stepDown: 0.7, // m: the longest drop he stays glued to the ground for (a steeper or longer one is a fall)
  airDrag: 1.5, // m/s^2 of braking in the air when no direction is held (momentum is mostly kept)
  gravity: 24, // m/s^2
  jumpSpeed: 9, // m/s; flat airtime 0.75 s, about 5.2 m at run speed
  airJumps: 1, // extra jumps in the air (double jump); reset on landing
  doubleJumpSpeed: 8.2, // m/s; a touch weaker than the ground jump
  shortHopGravityScale: 2, // extra gravity when jump is released while rising (not after a spring launch)
  coyote: 0.14, // s of jump grace after leaving an edge (playtest: 0.1 felt too tight)
  jumpBuffer: 0.15, // s a jump press is remembered before landing
  coinRadius: 0.9, // m, measured from the chest
  chestHeight: 0.9,
  fenceMargin: 0.25, // m kept between Kai and the rails on fenced platforms
  edgeEps: 0.05,
  hearts: 3,
  hurtCooldown: 1.2, // s of invulnerability after a hit
  respawnGrace: 1.5, // s of invulnerability after returning to a checkpoint
  bodyHeight: 1.7, // m, Kai's vertical extent for enemy contact
  bodyRadius: 0.35, // m
  knockbackVz: -5, // m/s, pushed back along -z when hit
  knockbackVy: 5.5,
  // Grapple (S3)
  handHeight: 1.2, // m above the feet where the rope attaches
  ropeMin: 4, // shortest rope
  ropeYank: 5, // m/s upward when the grapple fires from the ground
  pump: 8, // m/s^2 of swing pumping from forward input
  maxSwingSpeed: 16, // m/s horizontal while roped
  releaseBoost: 2, // m/s upward added when releasing the rope with jump
  // Grind rail (S4)
  hangReach: 1.85, // m: his hands are this far above his feet; on a rail he hangs by them
  railSnap: 0.9, // m: how far below the rail line his hands can be and still catch it (jumping up to it)
  railReach: 1.6, // m: sideways reach to the rail line (generous: close is enough)
  railAbove: 0.9, // m: how far above the line his hands can be and still be pulled onto it
  railLead: 1.5, // m: the catch zone starts this far before the rail begins
  railCooldown: 0.25, // s after jumping off before the same rail can catch him again
  railJump: 9, // m/s upward when jumping off a rail
  keyRadius: 1.2, // m from the chest
  gemRadius: 1.3, // m from the chest
  // The wave (Kai's hand power, from the video: a burst from his hand that blows the creatures away)
  waveRange: 5.5, // m in front of him
  waveHalfAngle: 0.95, // rad either side of the way he faces (about 55 degrees)
  waveNear: 1.7, // m: anything this close is caught whichever way he faces
  waveHeight: 3, // m above or below his chest
  waveCooldown: 0.7, // s between waves
  wallHeight: 1.0, // m: a fence stops Kai unless his feet are above this
  stunTime: 6, // s a bramble stays dazed after the gust
  // The vine catch: when Kai falls past an island's rim with nothing under him, the island's vines catch him and he climbs back.
  catchDrop: 2.2, // m below the rim before the vines reach for him (a jump that dips a little is left alone)
  catchRange: 9, // m: how far from an island's edge the vines can reach
  catchUp: 14, // m: the most the rim can be above him
  hangMin: 2.4, // m below the rim he hangs at least
  hangMax: 6.5, // m: the lowest he can hang or slide to
  climbSpeed: 2.6, // m/s while a direction or jump is held
  slideSpeed: 0.5, // m/s he slips back when nothing is held
  // Travel between checkpoints, springs and streams
  travelCost: 1, // coins to travel to a neighbouring checkpoint already reached
  travelNeighbours: 3, // how many of the nearest checkpoints count as neighbours
  springReach: 2.4, // m from a dry spring's stone to wake it with a sky gem
  streamDrift: 0.9, // m/s a flowing stream carries Kai toward its fall
};

/** Height of a rail's line at depth z. */
export function railY(r, z) {
  const k = Math.max(0, Math.min(1, (z - r.z0) / (r.z1 - r.z0)));
  return r.y0 + (r.y1 - r.y0) * k;
}

/** Offset of a moving platform along its axis at time t (0 for a static one). */
export function platformOffset(p, t) {
  if (!p.move) return 0;
  return p.move.amp * Math.sin((2 * Math.PI * t) / p.move.period + p.move.phase);
}

/** Current bounds of a platform: the platform itself when static, a shifted copy when it moves. */
export function platformBounds(p, t) {
  if (!p.move) return p;
  const o = platformOffset(p, t);
  return p.move.axis === 'x'
    ? { ...p, x0: p.x0 + o, x1: p.x1 + o }
    : { ...p, z0: p.z0 + o, z1: p.z1 + o };
}

/** Position of a patrolling enemy at time t. */
export function enemyPos(e, t) {
  const s = Math.sin((2 * Math.PI * t) / e.period + e.phase);
  return { x: e.x + (e.ax || 0) * s, y: e.y, z: e.z + (e.az || 0) * s };
}

/** Height a checkpoint stands at: its own `y`, else the platform under it, else 0. */
function checkpointY(course, cp, t) {
  if (cp.y !== undefined) return cp.y;
  const under = supportAt(course, cp.x, cp.z, 0.15, t);
  return under ? surfaceY(under, cp.x, cp.z) : 0;
}

/** The course's keys as a list: `keys: [{ id, x, y, z }]`, or the single legacy `key` (id 'key'). */
export function keysOf(course) {
  return course.keys || (course.key ? [{ id: 'key', ...course.key }] : []);
}

/**
 * The course's gates as a list: `gates: [{ id, z, key, x0?, x1?, y? }]`, or the single legacy `gate` (opened by the key 'key', and
 * spanning the whole world). A gate with x0/x1 only blocks between them, and one with a `y` only within 5 m of that height.
 */
export function gatesOf(course) {
  return course.gates || (course.gate ? [{ id: 'gate', key: 'key', ...course.gate }] : []);
}

export function createState(course) {
  const cp = course.checkpoints[0];
  const st = {
    t: 0,
    status: 'playing', // 'playing' | 'complete'
    x: cp.x,
    y: checkpointY(course, cp, 0),
    z: cp.z,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    coyote: PARAMS.coyote,
    airJumps: PARAMS.airJumps,
    jumpBuf: 0,
    prevJump: false,
    prevGrapple: false,
    rope: null, // { i: anchor index, L: rope length } while grappled
    rail: null, // { i: rail index } while grinding
    railCd: 0,
    hasKey: false, // true once any key is held (the legacy single-key levels read this)
    keysHeld: {}, // key id -> true
    gems: 0,
    stunUntil: new Array((course.enemies || []).length).fill(0), // brambles dazed by the gust until this time
    hang: null, // { plat, ox, oz, top, depth } while hanging from an island's vines
    lastStand: null, // the platform Kai last stood on (its vines catch him first)
    lastStandY: null, // and its height there
    slips: 0, // times the vines caught him
    reached: course.checkpoints.map((c, i) => i === 0), // checkpoints Kai has stood at (travel is between these)
    spent: 0, // coins spent on travel
    gemsSpent: 0, // sky gems given to springs
    springs: (course.streams || []).map((st) => !st.dry), // which streams are flowing
    waveCd: 0,
    prevWave: false,
    banished: 0, // enemies blown away by the wave
    lastWave: [], // indices of the enemies the latest wave blew away (for the renderer)
    gemsCollected: new Array((course.gems || []).length).fill(false),
    springUp: false, // true while rising from a spring launch (no short-hop gravity)
    standing: null, // id of the platform Kai stands on (a moving one carries him)
    coins: 0,
    collected: new Array(course.coins.length).fill(false),
    defeated: new Array((course.enemies || []).length).fill(false), // enemies stomped (only `stomp` enemies can be)
    deaths: 0,
    hearts: PARAMS.hearts,
    hurtCd: 0,
    hits: 0,
    checkpoint: 0,
    yaw: 0, // 0 faces +Z
    events: [], // cleared each step; strings such as 'coin', 'respawn', 'complete', 'jump', 'land', 'spring', 'hurt'
  };
  createCreatures(st, course);
  return st;
}

/**
 * The height of platform p's walkable surface at (x, z): its flat `y`, or, for a platform with a heightfield `hm` (a visit island: the
 * generated model's real ground, measured by tools/measure_islands.mjs), the terrain height there (bilinear between cells), or null
 * where the platform has no ground (past the island's edge).
 */
export function surfaceY(p, x, z) {
  const hm = p.hm;
  if (!hm) return p.y;
  const u = ((x - hm.x0) / (hm.x1 - hm.x0)) * hm.N - 0.5;
  const v = ((z - hm.z0) / (hm.z1 - hm.z0)) * hm.N - 0.5;
  const ix = Math.floor(u);
  const iz = Math.floor(v);
  const g = (i, j) => (i < 0 || j < 0 || i >= hm.N || j >= hm.N ? null : hm.h[j * hm.N + i]);
  const a = g(ix, iz);
  const b = g(ix + 1, iz);
  const c = g(ix, iz + 1);
  const d = g(ix + 1, iz + 1);
  if (a !== null && b !== null && c !== null && d !== null) {
    const fx = u - ix;
    const fz = v - iz;
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }
  return g(Math.round(u), Math.round(v)); // at an edge: the nearest cell (null when it is void)
}

/** The highest surface under (x, z) at or below `y` (plus the landing tolerance): { p, h } or null. */
export function surfaceBelow(course, x, z, y, tol = 0.15, t = 0) {
  let best = null;
  for (const p of course.platforms) {
    const b = platformBounds(p, t);
    if (!(x >= b.x0 - tol && x <= b.x1 + tol && z >= b.z0 && z <= b.z1)) continue;
    const h = p.hm ? surfaceY(p, x, z) : b.y;
    if (h === null || h > y + PARAMS.edgeEps) continue;
    if (!best || h > best.h) best = { p, h };
  }
  return best;
}

export function supportAt(course, x, z, tol = 0.15, t = 0) {
  for (const p of course.platforms) {
    const b = platformBounds(p, t);
    if (x >= b.x0 - tol && x <= b.x1 + tol && z >= b.z0 && z <= b.z1 && (!p.hm || surfaceY(p, x, z) !== null)) return p;
  }
  return null;
}

/**
 * The highest platform under (x, z) whose top is at or below `y` (plus the landing tolerance): what Kai can land on when he is at
 * height y. supportAt ignores height and returns the first platform in the list, which is wrong where platforms are stacked.
 */
export function supportBelow(course, x, z, y, tol = 0.15, t = 0) {
  const hit = surfaceBelow(course, x, z, y, tol, t);
  return hit ? hit.p : null;
}

/** The checkpoint region Kai stands in (its index), or -1. */
export function checkpointAt(state, course) {
  for (let i = 0; i < course.checkpoints.length; i++) {
    const cp = course.checkpoints[i];
    if (cp.r !== undefined && Math.hypot(state.x - cp.x, state.z - cp.z) <= cp.r) return i;
  }
  return -1;
}

/** The checkpoints that count as neighbours of checkpoint i: the nearest few, nearest first. */
export function neighbours(course, i) {
  const a = course.checkpoints[i];
  return course.checkpoints
    .map((c, k) => ({ k, d: Math.hypot(c.x - a.x, c.z - a.z) }))
    .filter((o) => o.k !== i)
    .sort((u, v) => u.d - v.d)
    .slice(0, PARAMS.travelNeighbours)
    .map((o) => o.k);
}

/**
 * The nearest island rim the vines can reach from where Kai is falling: { plat, ox, oz (the spot on top he will climb to,
 * relative to the platform's corner so a sliding island carries it), nx, nz (outward), top, depth } or null.
 */
function findRim(state, course) {
  let best = null;
  for (const p of course.platforms) {
    const b = platformBounds(p, state.t);
    const cx = Math.max(b.x0, Math.min(b.x1, state.x));
    const cz = Math.max(b.z0, Math.min(b.z1, state.z));
    const d = Math.hypot(cx - state.x, cz - state.z);
    if (d > PARAMS.catchRange) continue;
    // The spot on top: half a metre in from the edge; on terrain, march toward the middle until there is ground.
    const mx0 = (b.x0 + b.x1) / 2;
    const mz0 = (b.z0 + b.z1) / 2;
    let tx = cx;
    let tz = cz;
    let top = null;
    for (let k = 0; k < 14; k++) {
      const len = Math.hypot(mx0 - tx, mz0 - tz) || 1;
      tx += ((mx0 - tx) / len) * 0.5;
      tz += ((mz0 - tz) / len) * 0.5;
      top = p.hm ? surfaceY(p, tx, tz) : b.y;
      if (top !== null) break;
    }
    if (top === null || top < state.y + PARAMS.catchDrop || top - state.y > PARAMS.catchUp) continue;
    if (state.lastStandY !== null && top > state.lastStandY + 0.6) continue; // the vines pull him back, never up to somewhere higher
    // The island he last stood on has first claim (its vines know him); otherwise the nearest.
    const own = p.id === state.lastStand;
    if (best && !own && (best.own || d >= best.d)) continue;
    let nx = state.x - tx;
    let nz = state.z - tz;
    const nl = Math.hypot(nx, nz);
    if (nl < 0.3) {
      nx = tx - mx0;
      nz = tz - mz0;
    }
    const n2 = Math.hypot(nx, nz) || 1;
    best = {
      d,
      own,
      plat: p.id,
      ox: tx - b.x0,
      oz: tz - b.z0,
      nx: nx / n2,
      nz: nz / n2,
      top,
      depth: Math.max(PARAMS.hangMin, Math.min(PARAMS.hangMax, top - state.y)),
    };
  }
  return best;
}

/** Will Kai, carried by the speed he has, come down on something? (A jump down to a lower island is not a fall.) */
function willLand(state, course) {
  let x = state.x;
  let y = state.y;
  let z = state.z;
  let vy = state.vy;
  const h = 0.05;
  for (let k = 0; k < 50 && y > course.killY; k++) {
    const py = y;
    vy -= PARAMS.gravity * h;
    x += state.vx * h;
    z += state.vz * h;
    y += vy * h;
    const hit = surfaceBelow(course, x, z, py, 0.15, state.t + k * h);
    if (hit && y <= hit.h) return true;
  }
  return false;
}

function approach(v, target, maxDelta) {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

// The rope is a hard length limit while airborne: past it, Kai is put back on the circle and loses the outward speed.
function ropeConstrain(state, course, newY) {
  const a = course.anchors[state.rope.i];
  const hy = PARAMS.handHeight;
  let rx = state.x - a.x;
  let ry = newY + hy - a.y;
  let rz = state.z - a.z;
  const d = Math.hypot(rx, ry, rz);
  const L = state.rope.L;
  if (d <= L) return newY;
  const k = L / d;
  rx *= k; ry *= k; rz *= k;
  state.x = a.x + rx;
  state.z = a.z + rz;
  const nx = rx / L, ny = ry / L, nz = rz / L;
  const vr = state.vx * nx + state.vy * ny + state.vz * nz;
  if (vr > 0) {
    state.vx -= vr * nx;
    state.vy -= vr * ny;
    state.vz -= vr * nz;
  }
  return a.y + ry - hy;
}

function respawn(state, course) {
  const cp = course.checkpoints[state.checkpoint];
  state.deaths += 1;
  state.x = cp.x;
  state.z = cp.z;
  state.y = checkpointY(course, cp, state.t); // the platform under the checkpoint (S6's checkpoints are on raised steps)
  state.vx = state.vy = state.vz = 0;
  state.onGround = true;
  state.coyote = PARAMS.coyote;
  state.springUp = false;
  state.rope = null;
  state.rail = null;
  state.railCd = 0;
  state.standing = null;
  state.hearts = PARAMS.hearts;
  state.hurtCd = PARAMS.respawnGrace; // a patrol crossing the checkpoint cannot hit him the moment he returns
  state.events.push('respawn');
}

/**
 * Advance one fixed step. `input` is { fwd: -1..1, right: -1..1, jump: boolean }.
 * The camera is behind Kai looking along +Z, so screen-right is world -X.
 */
export function step(state, input, course, dt = PARAMS.dt) {
  state.events.length = 0;
  if (state.status !== 'playing') return state;
  const tPrev = state.t;
  state.t += dt;
  state.hurtCd = Math.max(0, state.hurtCd - dt);
  state.railCd = Math.max(0, state.railCd - dt);

  // A moving platform carries Kai while he stands on it.
  if (state.onGround && state.standing) {
    const mp = course.platforms.find((q) => q.id === state.standing);
    if (mp && mp.move) {
      const d = platformOffset(mp, state.t) - platformOffset(mp, tPrev);
      if (mp.move.axis === 'x') state.x += d;
      else state.z += d;
    }
  }

  // Hanging from an island's vines: hold a direction or jump to climb, let go and he slips back down; at the rim he is home.
  if (state.hang) {
    const h = state.hang;
    const hp = course.platforms.find((q) => q.id === h.plat);
    const hb = platformBounds(hp, state.t);
    const mx = hb.x0 + h.ox;
    const mz = hb.z0 + h.oz;
    const climbing = Math.hypot(input.fwd || 0, input.right || 0) > 0.3 || !!input.jump;
    h.depth = Math.min(PARAMS.hangMax, h.depth + (climbing ? -PARAMS.climbSpeed : PARAMS.slideSpeed) * dt);
    state.vx = state.vy = state.vz = 0;
    state.prevJump = !!input.jump;
    state.prevWave = !!input.wave;
    state.prevGrapple = !!input.grapple;
    if (h.depth <= 0.05) {
      state.x = mx;
      state.z = mz;
      state.y = h.top;
      state.onGround = true;
      state.standing = h.plat;
      state.coyote = PARAMS.coyote;
      state.airJumps = PARAMS.airJumps;
      state.hurtCd = Math.max(state.hurtCd, 0.6);
      state.hang = null;
      state.events.push('mount');
    } else {
      state.x = mx + h.nx * 0.85;
      state.z = mz + h.nz * 0.85;
      state.y = h.top - h.depth;
      state.yaw = Math.atan2(-h.nx, -h.nz); // facing the island
      if (climbing) state.events.push('climb');
    }
    return state;
  }

  // Grapple: press near an anchor to attach (a short yank lifts Kai off the ground); press again to let go.
  const gPressed = !!input.grapple && !state.prevGrapple;
  state.prevGrapple = !!input.grapple;
  if (gPressed) {
    if (state.rope) {
      state.rope = null;
      state.events.push('release');
    } else if (course.anchors) {
      let best = -1;
      let bestD = Infinity;
      course.anchors.forEach((a, i) => {
        const d = Math.hypot(a.x - state.x, a.y - (state.y + PARAMS.handHeight), a.z - state.z);
        // A vine bloom (`bloom`) reaches for Kai from any side; the older fixed anchors only from behind them.
        if (d <= a.range && (a.bloom || a.z > state.z - 3) && d < bestD) { best = i; bestD = d; }
      });
      if (best >= 0) {
        state.rope = { i: best, L: Math.max(PARAMS.ropeMin, bestD) };
        state.events.push('grapple');
        if (state.onGround) {
          state.vy = Math.max(state.vy, PARAMS.ropeYank);
          state.onGround = false;
          state.standing = null;
          state.coyote = 0;
        }
      }
    }
  }

  // Kai's hand (X). In order: at a dry spring with a sky gem in hand, the gem wakes the spring; otherwise a gust the way he
  // faces, which dazes any bramble in its reach for a few seconds (it does not remove it) and makes a `stomp` creature flinch.
  // Catching and releasing creatures is handled by lifeStep (below), which runs first and consumes the press when it acts.
  state.waveCd = Math.max(0, state.waveCd - dt);
  const wPressed = !!input.wave && !state.prevWave;
  state.prevWave = !!input.wave;
  let handUsed = course.creatures ? lifeStep(state, course, wPressed, dt) : false;
  if (wPressed && !handUsed && state.onGround && course.streams) {
    const si = course.streams.findIndex((st, i) => !state.springs[i] && st.spring && Math.hypot(st.spring.x - state.x, st.spring.z - state.z) <= PARAMS.springReach);
    if (si >= 0) {
      handUsed = true;
      if (state.gems - state.gemsSpent >= 1) {
        state.gemsSpent += 1;
        state.springs[si] = true;
        state.lastSpring = si;
        state.events.push('spring-awake');
        // A creature already waiting here whose habitat the water restores is home now: waking its stream rehomes it.
        // (AI playtest 2026-11-12: three of five players could not tell whether such a dewling still had to be carried.)
        let home = 0;
        for (const c of state.creatures || []) {
          if (c.counted || c.carried || !habitatOk(state, course, c.species, c.plat)) continue;
          c.counted = true;
          c.mood = 'wander';
          home += 1;
        }
        if (home) {
          state.rehomed += home;
          state.events.push('rehome');
        }
      } else state.events.push('spring-needs-gem');
    }
  }
  if (wPressed && !handUsed && state.waveCd <= 0 && !state.rope && !state.rail) {
    state.waveCd = PARAMS.waveCooldown;
    state.lastWave = [];
    state.events.push('wave');
    (course.enemies || []).forEach((e, i) => {
      if (state.defeated[i]) return;
      const p = enemyPos(e, state.t);
      const dx = p.x - state.x;
      const dz = p.z - state.z;
      const d = Math.hypot(dx, dz);
      if (Math.abs(p.y - (state.y + PARAMS.chestHeight)) > PARAMS.waveHeight || d > PARAMS.waveRange + e.r) return;
      const off = Math.atan2(Math.sin(Math.atan2(dx, dz) - state.yaw), Math.cos(Math.atan2(dx, dz) - state.yaw));
      if (d > PARAMS.waveNear && Math.abs(off) > PARAMS.waveHalfAngle) return;
      if (e.stomp) {
        state.events.push('waveblock');
        return;
      }
      state.stunUntil[i] = state.t + PARAMS.stunTime;
      state.banished += 1;
      state.lastWave.push(i);
      state.events.push('banish');
    });
  }

  // Travel: standing at a checkpoint, go to a neighbouring one already reached, for a coin.
  if (input.travelTo !== undefined && input.travelTo !== null && state.onGround) {
    const here = checkpointAt(state, course);
    const to = input.travelTo;
    if (here >= 0 && to !== here && state.reached[to] && neighbours(course, here).includes(to) && state.coins - state.spent >= PARAMS.travelCost) {
      const cp = course.checkpoints[to];
      state.spent += PARAMS.travelCost;
      state.x = cp.x;
      state.z = cp.z;
      state.y = checkpointY(course, cp, state.t);
      state.vx = state.vy = state.vz = 0;
      state.checkpoint = to;
      state.standing = null;
      state.events.push('travel');
    } else state.events.push('travel-refused');
  }

  // Horizontal control.
  const tx = -(input.right || 0) * PARAMS.runSpeed;
  const tz = (input.fwd || 0) * PARAMS.runSpeed;
  if (state.rail) {
    // Grinding: the rail carries Kai along it at a steady speed; forward and back nudge it a little.
    const r = course.rails[state.rail.i];
    state.vx = 0;
    state.vz = r.speed + (input.fwd || 0) * 1.5;
  } else if (state.rope && !state.onGround) {
    // Swinging: forward input pumps the swing; depth is held on the centre line by the caller's steering.
    if (course.anchors[state.rope.i].bloom) {
      // On a vine bloom the swing is pumped whichever way the player pushes.
      state.vz += (input.fwd || 0) * PARAMS.pump * dt;
      state.vx += -(input.right || 0) * PARAMS.pump * dt;
      const sp = Math.hypot(state.vx, state.vz);
      if (sp > PARAMS.maxSwingSpeed) {
        state.vx *= PARAMS.maxSwingSpeed / sp;
        state.vz *= PARAMS.maxSwingSpeed / sp;
      }
    } else {
      state.vz = Math.max(-PARAMS.maxSwingSpeed, Math.min(PARAMS.maxSwingSpeed, state.vz + (input.fwd || 0) * PARAMS.pump * dt));
      state.vx = approach(state.vx, tx, PARAMS.airAccel * dt);
    }
  } else {
    // In the air a held direction steers at airAccel, but with no direction held Kai keeps most of his momentum (airDrag), so
    // letting go of the keys mid-jump, or after a pad, does not stop him dead.
    const rate = axis => (state.onGround ? PARAMS.accel : axis === 0 ? PARAMS.airDrag : PARAMS.airAccel) * dt;
    state.vx = approach(state.vx, tx, rate(tx));
    state.vz = approach(state.vz, tz, rate(tz));
  }

  // Jump buffering and coyote time.
  const pressed = !!input.jump && !state.prevJump;
  state.prevJump = !!input.jump;
  let ropeRelease = false;
  if (pressed && state.rope) {
    if (!state.onGround) {
      // In the air a jump press lets go of the rope with a small upward boost (and restores the air jump).
      state.rope = null;
      state.vy += PARAMS.releaseBoost;
      state.airJumps = PARAMS.airJumps;
      state.events.push('release');
      ropeRelease = true;
    } else state.rope = null; // on the ground: drop the rope and jump normally
  }
  if (pressed && state.rail) {
    // Jumping off a rail: a full jump that keeps the rail's speed, and the air jump is restored.
    state.rail = null;
    state.railCd = PARAMS.railCooldown;
    state.vy = PARAMS.railJump;
    state.airJumps = PARAMS.airJumps;
    state.springUp = false;
    state.events.push('jump');
    ropeRelease = true;
  }
  if (pressed && !ropeRelease) state.jumpBuf = PARAMS.jumpBuffer;
  else state.jumpBuf = Math.max(0, state.jumpBuf - dt);
  if (ropeRelease) state.jumpBuf = 0;
  if (state.jumpBuf > 0) {
    if (state.onGround || state.coyote > 0) {
      state.vy = PARAMS.jumpSpeed;
      state.onGround = false;
      state.coyote = 0;
      state.jumpBuf = 0;
      state.springUp = false;
      state.events.push('jump');
    } else if (state.airJumps > 0) {
      // A double jump never lowers upward speed, so it cannot cut a spring launch short; the launch keeps its
      // no-short-hop flag so letting go of jump afterwards does not either.
      const keepSpring = state.springUp && state.vy > PARAMS.doubleJumpSpeed;
      state.vy = Math.max(state.vy, PARAMS.doubleJumpSpeed);
      state.airJumps -= 1;
      state.jumpBuf = 0;
      state.springUp = keepSpring;
      state.events.push('doublejump');
    }
  }

  // Gravity, with a shorter hop when jump is released early (but never cutting a spring launch short).
  const g = PARAMS.gravity * (state.vy > 0 && !input.jump && !state.springUp && !state.rope ? PARAMS.shortHopGravityScale : 1);
  if (!state.rail) state.vy -= g * dt;
  if (state.vy <= 0) state.springUp = false;

  // Horizontal move, then keep Kai inside the rails on fenced platforms.
  const ox = state.x;
  const oz = state.z;
  state.x += state.vx * dt;
  state.z += state.vz * dt;
  // A flowing stream carries Kai gently toward its fall while he stands in it.
  if (course.streams && state.onGround) {
    course.streams.forEach((st, i) => {
      if (!state.springs[i]) return;
      const sp = course.platforms.find((q) => q.id === st.plat);
      if (state.z >= st.z0 && state.z <= st.z1 && state.x >= sp.x0 && state.x <= sp.x1 && Math.abs(state.y - sp.y) < 0.4) state.x += st.side * PARAMS.streamDrift * dt;
    });
  }
  // A locked gate stops Kai until he holds its key (crossing it from the near side, inside its span).
  for (const g of gatesOf(course)) {
    if (state.keysHeld[g.key]) continue;
    if (!(state.z > g.z - 0.4 && oz <= g.z - 0.4 + 1e-6)) continue;
    if (g.x0 !== undefined && (state.x < g.x0 || state.x > g.x1)) continue;
    if (g.y !== undefined && Math.abs(state.y - g.y) > 5) continue;
    state.z = g.z - 0.4;
    state.vz = Math.min(state.vz, 0);
  }
  const under = supportAt(course, state.x, state.z, 0.15, state.t);
  if (under && under.fenced && state.y <= under.y + 0.6) {
    const lo = under.x0 + PARAMS.fenceMargin;
    const hi = under.x1 - PARAMS.fenceMargin;
    if (state.x < lo) { state.x = lo; state.vx = Math.max(0, state.vx); }
    if (state.x > hi) { state.x = hi; state.vx = Math.min(0, state.vx); }
  }

  // Low fences (`walls`: a line along z at a fixed x, 1 m tall) stop Kai on foot or in a low hop; a real jump clears them.
  if (course.walls) {
    for (const w of course.walls) {
      if (state.z < w.z0 || state.z > w.z1) continue;
      if (state.y < w.y - 1.5 || state.y > w.y + PARAMS.wallHeight) continue;
      if ((ox - w.x) * (state.x - w.x) > 0) continue; // still on the same side
      state.x = w.x + (ox >= w.x ? PARAMS.bodyRadius : -PARAMS.bodyRadius) * 0.6;
      state.vx = 0;
    }
  }

  // Terrain (a platform with a heightfield) is solid from the side: ground more than stepUp higher than Kai's feet is a wall, on foot or in the
  // air (so a jump at an island's cliff stops at it, and he drops down it, instead of passing through). He is not stopped if he is already
  // inside such ground (under an overhang, or just landed), so he can never be trapped.
  if (course.platforms.some((q) => q.hm) && !state.rail) {
    const wall = (x, z) => {
      let best = -Infinity;
      for (const q of course.platforms) {
        if (!q.hm) continue;
        const h = surfaceY(q, x, z);
        if (h !== null && h > best) best = h;
      }
      return best;
    };
    if (wall(state.x, state.z) - state.y > PARAMS.stepUp && wall(ox, oz) - state.y <= PARAMS.stepUp) {
      state.x = ox;
      state.z = oz;
      state.vx = 0;
      state.vz = 0;
    }
  }
  // While walking Kai follows the ground up and down small steps; walking past the island's edge or down a drop longer than stepDown lets him fall.
  if (state.onGround && state.standing && !state.rail && !state.rope) {
    const sp = course.platforms.find((q) => q.id === state.standing);
    if (sp && sp.hm) {
      const h = surfaceY(sp, state.x, state.z);
      if (h !== null && state.y - h <= PARAMS.stepDown && h - state.y <= PARAMS.stepUp) state.y = h;
    }
  }

  // Vertical move and landing.
  const prevY = state.y;
  let newY = prevY + state.vy * dt;
  if (state.rope && !state.onGround) newY = ropeConstrain(state, course, newY);
  if (state.rail) {
    const r = course.rails[state.rail.i];
    state.x = r.x;
    newY = railY(r, state.z) - PARAMS.hangReach;
    state.vy = 0;
  }
  let landed = null;
  let landedY = 0;
  if (state.vy <= 0 && !state.rail) {
    const hit = surfaceBelow(course, state.x, state.z, prevY, 0.15, state.t);
    if (hit && prevY >= hit.h - PARAMS.edgeEps && newY <= hit.h) {
      landed = hit.p;
      landedY = hit.h;
    }
  }
  // Terrain he has sunk into: a jump onto a slope that rises less than a wall's height leaves his feet inside the ground, and the
  // landing test above only sees ground at or below his feet, so he fell through the island. Stand him on it instead.
  if (!landed && !state.rail && !state.rope && state.vy <= 3) {
    let top = -Infinity;
    let tp = null;
    for (const q of course.platforms) {
      if (!q.hm) continue;
      const h = surfaceY(q, state.x, state.z);
      if (h !== null && h > top) {
        top = h;
        tp = q;
      }
    }
    if (tp && newY < top && newY > top - 1.6) {
      landed = tp;
      landedY = top;
    }
  }
  if (landed) {
    if (!state.onGround) state.events.push('land');
    state.y = landedY;
    state.vy = 0;
    state.onGround = true;
    state.airJumps = PARAMS.airJumps;
    state.standing = landed.id;
    state.lastStand = landed.id;
    state.lastStandY = landedY;
    state.rope = null; // landing drops the rope
  } else {
    state.y = newY;
    state.onGround = false;
    state.standing = null;
  }
  state.coyote = state.onGround ? PARAMS.coyote : Math.max(0, state.coyote - dt);

  // Grind rails: falling onto one from above catches it; it carries Kai to its end, where he drops off.
  if (course.rails && !state.rail && !state.onGround && state.railCd <= 0) {
    for (let i = 0; i < course.rails.length; i++) {
      const r = course.rails[i];
      if (state.z < r.z0 - PARAMS.railLead || state.z > r.z1 || Math.abs(state.x - r.x) > PARAMS.railReach) continue;
      const ry = railY(r, state.z);
      const handY = state.y + PARAMS.hangReach;
      if (handY <= ry + PARAMS.railAbove && handY >= ry - PARAMS.railSnap) {
        state.rail = { i };
        state.x = r.x;
        state.y = ry - PARAMS.hangReach;
        state.vx = 0;
        state.vy = 0;
        state.vz = r.speed;
        state.airJumps = PARAMS.airJumps;
        state.springUp = false;
        state.coyote = 0;
        state.events.push('grind');
        break;
      }
    }
  }
  if (state.rail && state.z >= course.rails[state.rail.i].z1) {
    state.rail = null;
    state.railCd = PARAMS.railCooldown;
    state.events.push('railend');
  }

  // Spring pads: reaching one on foot steps Kai up onto the cushion (height `h`), and landing on it from above counts
  // too; either launches him from the top (and restores the air jump). Passing over it higher than the cushion does not.
  if (course.springs) {
    for (const s of course.springs) {
      if (Math.hypot(state.x - s.x, state.z - s.z) > s.r) continue;
      if (state.onGround && Math.abs(state.y - (s.y || 0)) > 0.8) continue; // standing on another level over this pad (terrain may differ a little)
      const top = (s.y || 0) + (s.h || 0);
      const landing = !state.onGround && state.vy <= 0 && state.y <= top + 0.1 && state.y >= (s.y || 0) - 0.8; // onto it, not past it from far below
      if (state.onGround || landing) {
        state.y = Math.max(state.y, top);
        state.vy = s.boost;
        // A pad with a `dir` and a `carry` also throws Kai along that direction, so where he lands does not depend on how he stepped on.
        if (s.carry && s.dir) {
          state.vx = s.dir.x * s.carry;
          state.vz = s.dir.z * s.carry;
        }
        state.onGround = false;
        state.standing = null;
        state.coyote = 0;
        state.springUp = true;
        state.airJumps = PARAMS.airJumps;
        state.events.push('spring');
        break;
      }
    }
  }

  // Facing follows the horizontal velocity when moving.
  if (Math.hypot(state.vx, state.vz) > 0.5) state.yaw = Math.atan2(state.vx, state.vz);

  // Stomping (S6): landing on a `stomp` enemy from above defeats it and bounces Kai; one with `drops: 'key'` opens the gate.
  if (course.enemies) {
    course.enemies.forEach((e, i) => {
      if (!e.stomp || state.defeated[i]) return;
      const p = enemyPos(e, state.t);
      const dh = Math.hypot(p.x - state.x, p.z - state.z);
      if (dh < e.r + PARAMS.bodyRadius + 0.2 && state.y >= p.y && state.y <= p.y + e.r + 0.6 && state.vy <= 1) {
        state.defeated[i] = true;
        state.vy = PARAMS.jumpSpeed;
        state.onGround = false;
        state.standing = null;
        state.airJumps = PARAMS.airJumps;
        state.springUp = false;
        if (e.drops) {
          state.keysHeld[e.drops] = true;
          state.hasKey = true;
        }
        state.events.push('stomp');
      }
    });
  }

  // Enemies: contact costs a heart, knocks Kai back and grants a short grace period; no hearts left is a respawn.
  if (course.enemies && state.hurtCd <= 0) {
    for (let ei = 0; ei < course.enemies.length; ei++) {
      const e = course.enemies[ei];
      if (state.defeated[ei] || state.stunUntil[ei] > state.t) continue;
      const p = enemyPos(e, state.t);
      const dh = Math.hypot(p.x - state.x, p.z - state.z);
      const overlapY = state.y < p.y + e.r && state.y + PARAMS.bodyHeight > p.y - e.r;
      if (dh < e.r + PARAMS.bodyRadius && overlapY) {
        state.hearts -= 1;
        state.hits += 1;
        state.hurtCd = PARAMS.hurtCooldown;
        state.vz = PARAMS.knockbackVz;
        state.vy = PARAMS.knockbackVy;
        state.onGround = false;
        state.standing = null;
        state.springUp = false;
        state.rail = null;
        state.railCd = 0.4;
        state.events.push('hurt');
        if (state.hearts <= 0) respawn(state, course);
        break;
      }
    }
  }

  // Coins.
  for (let i = 0; i < course.coins.length; i++) {
    if (state.collected[i]) continue;
    const c = course.coins[i];
    const d = Math.hypot(c.x - state.x, c.y - (state.y + PARAMS.chestHeight), c.z - state.z);
    if (d <= PARAMS.coinRadius) {
      state.collected[i] = true;
      state.coins += 1;
      state.events.push('coin');
    }
  }

  // Keys.
  for (const k of keysOf(course)) {
    if (state.keysHeld[k.id]) continue;
    if (Math.hypot(k.x - state.x, k.y - (state.y + PARAMS.chestHeight), k.z - state.z) <= PARAMS.keyRadius) {
      state.keysHeld[k.id] = true;
      state.hasKey = true;
      state.events.push('key');
    }
  }

  // Sky gems: a few big pickups in out-of-the-way places.
  if (course.gems) {
    for (let i = 0; i < course.gems.length; i++) {
      if (state.gemsCollected[i]) continue;
      const c = course.gems[i];
      if (Math.hypot(c.x - state.x, c.y - (state.y + PARAMS.chestHeight), c.z - state.z) <= PARAMS.gemRadius) {
        state.gemsCollected[i] = true;
        state.gems += 1;
        state.events.push('gem');
      }
    }
  }

  // Checkpoints (only while standing, so a jump over one does not claim it).
  // A checkpoint with a radius `r` is a region (any direction, claimed whenever Kai stands in it, so the last one reached is the
  // respawn point on a branching level); one without is claimed by progress along +Z, in order, as in the corridor levels.
  if (state.onGround) {
    for (let i = 0; i < course.checkpoints.length; i++) {
      const cp = course.checkpoints[i];
      if (cp.r !== undefined) {
        if (i !== state.checkpoint && Math.hypot(state.x - cp.x, state.z - cp.z) <= cp.r) {
          state.reached[i] = true;
          state.checkpoint = i;
          state.events.push('checkpoint');
        }
      } else if (i > state.checkpoint && state.z >= cp.z - 1.5) {
        state.checkpoint = i;
        state.events.push('checkpoint');
      }
    }
  }

  // The vine catch: falling past a rim with nothing below, within the vines' reach.
  if (course.vineCatch && !state.onGround && !state.rope && !state.rail && state.vy < -2 && !willLand(state, course)) {
    const grab = findRim(state, course);
    // While he still has his air jump he may yet save himself, so the vines wait until he is well below the rim.
    if (grab && (state.airJumps === 0 || grab.top - state.y > 5)) {
      state.hang = grab;
      state.slips += 1;
      state.vx = state.vy = state.vz = 0;
      state.springUp = false;
      state.events.push('vinecatch');
      return state;
    }
  }

  // Falling off the world returns Kai to the last checkpoint.
  if (state.y < course.killY) respawn(state, course);

  // Goal.
  const atGoal =
    course.goal.r !== undefined
      ? Math.hypot(state.x - course.goal.x, state.z - course.goal.z) <= course.goal.r
      : state.z >= course.goal.z;
  if (state.onGround && atGoal) {
    state.status = 'complete';
    state.events.push('complete');
  }
  return state;
}

/**
 * A simple scripted player, used by the tests and by the headless playtest. It runs forward along x=0, jumps when the
 * platform it stands on is about to end and another one follows, waits at an edge when the next platform is out of
 * reach (a raft that has not arrived yet), and jumps over low enemies. Springs need no action: running over one launches.
 */
export function autopilot(state, course, options = {}) {
  const useDouble = options.doubleJump !== false;
  const useDodge = options.dodge !== false;
  const aimX = options.aimX || 0; // lets a test run along a line that misses the spring pad
  const t = state.t;
  const input = { fwd: 1, right: 0, jump: false, grapple: false };
  input.right = Math.max(-1, Math.min(1, (state.x - aimX) * 2)); // +x is screen-left, so steer right to come back
  const line = course.platforms.filter((q) => !q.side); // `side` platforms are off the main line: the scripted player ignores them
  const p = line.find((q) => {
    const b = platformBounds(q, t);
    return state.x >= b.x0 && state.x <= b.x1 && state.z >= b.z0 && state.z <= b.z1;
  });
  if (p && state.onGround) {
    const pb = platformBounds(p, t);
    const next = line
      .map((q) => ({ q, b: platformBounds(q, t) }))
      .filter((o) => o.q !== p && o.b.z0 > pb.z1 - 0.01)
      .sort((u, v) => u.b.z0 - v.b.z0)[0];
    const distToEdge = pb.z1 - state.z;
    const nearAnchor = course.anchors && course.anchors.some((a) => !a.bloom && a.z > state.z && a.z - state.z < 12);
    if (nearAnchor && !state.rope && next && distToEdge < 0.6) {
      input.grapple = true; // a gap crossed by swinging: fire the grapple at the edge instead of jumping
    }
    const air = (2 * PARAMS.jumpSpeed) / PARAMS.gravity; // flat airtime of a held jump, 0.75 s
    if (next && (next.q.move || p.move)) {
      // A raft is involved. A jump needs a full-speed run-up, so stand back and start running only when, by the time
      // Kai reaches the edge and has flown the single-jump reach (5.25 m), the landing platform will be under him.
      const tJump = t + Math.max(0, distToEdge - 0.4) / PARAMS.runSpeed;
      const land = platformBounds(p, tJump).z1 - 0.4 + PARAMS.runSpeed * air;
      const nb = platformBounds(next.q, tJump + air);
      const ok = nb.z0 <= land - 0.3 && nb.z1 >= land + 0.3;
      if (distToEdge > 0.45) input.fwd = ok || distToEdge > 6 ? 1 : 0;
      else {
        input.jump = true; // committed: at the edge at full speed
        input.landOn = next.q.id; // (checked by a look-ahead below: wait at the edge if this jump would miss)
      }
    } else if (next && next.b.z0 - pb.z1 > 0.2 && distToEdge < 0.45 && !nearAnchor) {
      input.jump = true; // a fixed platform ahead (a gap beyond reach simply falls, as intended without a spring)
    }
  }
  // Swinging: keep pumping (forward is already held) and let go at releaseZ, the top of the arc's useful window.
  if (state.rope) {
    const releaseZ = options.releaseZ ?? course.anchors[state.rope.i].releaseZ ?? 11;
    if (state.z >= releaseZ) input.jump = true;
  }
  // Grinding: jump off to clear an orb that is close ahead on the rail.
  if (state.rail && course.enemies) {
    course.enemies.forEach((e, i) => {
      if (state.defeated[i]) return;
      const ahead = enemyPos(e, t).z - state.z;
      if (ahead > 0.4 && ahead < (options.railJumpAhead ?? 3.2) && Math.abs(enemyPos(e, t).x - state.x) < 1.0) input.jump = true;
    });
  }
  // Jump over a low enemy that is close ahead on the same line.
  if (useDodge && course.enemies && state.onGround) {
    course.enemies.forEach((e, i) => {
      if (state.defeated[i]) return;
      const ep = enemyPos(e, t);
      const ahead = ep.z - state.z;
      if (ahead > 0.4 && ahead < 2.6 && Math.abs(ep.x - state.x) < 1.4) input.jump = true;
    });
  }
  // A stompable enemy (S6's guardian) must be landed on: line up with it, stand back about 2 m and jump when it is under the path.
  if (useDodge && course.enemies && state.onGround) {
    const gi = course.enemies.findIndex((e, i) => e.stomp && !state.defeated[i]);
    if (gi >= 0) {
      const ep = enemyPos(course.enemies[gi], t);
      const ahead = ep.z - state.z;
      if (ahead > -3 && ahead < 8) {
        input.right = Math.max(-1, Math.min(1, (state.x - ep.x) * 2));
        input.fwd = ahead > 2.3 ? 1 : ahead < 1.3 ? -1 : 0;
      }
      if (ahead <= -3 && ahead > -12) input.fwd = -1; // it is behind him (he was knocked past it): go back for it, the gate needs its key
    }
  }
  // Hold jump while rising: releasing early cuts the hop short (see shortHopGravityScale).
  // (not while roped: a jump press in the air lets go of the rope)
  if (!state.onGround && state.vy > 0 && !state.springUp && !state.rope && !state.rail) input.jump = true;
  // At the apex, if the next platform is still far ahead, double jump: release for one frame, then press.
  // Never while already over a platform (it is about to land): that would sail past the coins on it.
  const overRail = !!course.rails && course.rails.some((r) => state.z >= r.z0 - 1 && state.z <= r.z1);
  if (useDouble && !overRail && !state.rope && !state.onGround && state.vy <= 0 && state.airJumps > 0 && !supportAt(course, state.x, state.z, 0.15, t)) {
    const ahead = line.find((q) => platformBounds(q, t).z0 > state.z);
    // (a moving target was timed for a single jump, so a double jump would overshoot it)
    if (ahead && !ahead.move && platformBounds(ahead, t).z0 - state.z > 4.0) input.jump = !state.prevJump;
  }
  // In the air over a stompable enemy: steer onto it.
  if (useDodge && course.enemies && !state.onGround) {
    const gi = course.enemies.findIndex((e, i) => e.stomp && !state.defeated[i]);
    if (gi >= 0) {
      const ep = enemyPos(course.enemies[gi], t);
      const ahead = ep.z - state.z;
      if (Math.abs(ahead) < 4) {
        input.right = Math.max(-1, Math.min(1, (state.x - ep.x) * 2));
        input.fwd = Math.max(-1, Math.min(1, ahead * 1.5));
      }
    }
  }
  return options.noSim ? input : lookAhead(state, course, input, options);
}

function cloneState(s) {
  return {
    ...s,
    collected: [...s.collected],
    defeated: [...s.defeated],
    gemsCollected: [...s.gemsCollected],
    keysHeld: { ...s.keysHeld },
    rope: s.rope && { ...s.rope },
    rail: s.rail && { ...s.rail },
    nav: s.nav && { ...s.nav },
    hang: s.hang && { ...s.hang },
    stunUntil: [...s.stunUntil],
    reached: [...s.reached],
    springs: [...s.springs],
    creatures: s.creatures && s.creatures.map((c) => ({ ...c })),
    events: [],
  };
}

/**
 * The scripted player's look-ahead: it tries its intended input on a copy of the state (then its plain policy) for a short while. A
 * jump toward a moving platform is only made if it lands there (otherwise wait at the edge), and near an enemy an input that ends in a
 * hit is swapped for the first of stop, jump or step back that does not. This is what lets one policy survive any timing of rafts and
 * patrols, instead of being tuned to each section's start time.
 */
function lookAhead(state, course, input, options) {
  const run = (first, n, until) => {
    const c = cloneState(state);
    let inp = first;
    let hurt = false;
    let left = false;
    for (let i = 0; i < n; i++) {
      step(c, inp, course);
      if (c.events.includes('hurt') || c.events.includes('respawn')) { hurt = true; break; }
      if (c.hang || (!c.rail && !c.rope && c.y < state.y - 2.5)) { hurt = true; break; } // dropped off the island: as bad as a hit
      if (!c.onGround) left = true;
      if (until && until(c, left)) break;
      inp = autopilot(c, course, { ...options, noSim: true });
    }
    return { c, hurt };
  };
  const plain = { fwd: input.fwd, right: input.right, jump: input.jump, grapple: input.grapple };
  if (input.landOn) {
    const r = run(plain, 90, (c, left) => left && c.onGround);
    if (r.hurt || r.c.standing !== input.landOn) return { fwd: 0, right: input.right, jump: false, grapple: false };
    return plain;
  }
  const near =
    course.enemies &&
    course.enemies.some((e, i) => {
      if (state.defeated[i]) return false;
      const p = enemyPos(e, state.t);
      return Math.abs(p.z - state.z) < 6 && Math.abs(p.x - state.x) < 6 && Math.abs(p.y - state.y) < 4;
    });
  if (!near || state.rail || state.rope || options.dodge === false || options.railJumpAhead !== undefined) return plain;
  if (!run(plain, 100).hurt) return plain;
  const options2 = state.onGround
    ? [{ ...plain, fwd: 0, jump: false }, { ...plain, jump: true }, { ...plain, fwd: -1, jump: false }]
    : [{ ...plain, fwd: 0 }, { ...plain, fwd: -1 }, { ...plain, jump: !state.prevJump }];
  for (const alt of options2) if (!run(alt, 100).hurt) return alt;
  return plain;
}

/**
 * A scripted player for branching levels: it follows a route (a list of { x, z, r? } waypoints) over the ground, jumping at an edge
 * when the way ahead is a gap, holding the jump while rising and double-jumping at the apex when the target is still far. The route
 * index lives on the state (state.nav) so the same function can be called every step. Used by the tests to prove that each
 * branch of a level can be completed.
 */
export function navigate(state, course, route, options = {}) {
  const input = { fwd: 0, right: 0, jump: false, grapple: false };
  if (!state.nav) state.nav = { idx: 0 };
  const nav = state.nav;
  while (nav.idx < route.length && Math.hypot(route[nav.idx].x - state.x, route[nav.idx].z - state.z) < (route[nav.idx].r ?? 1.0)) nav.idx++;
  if (nav.idx >= route.length) return input;
  const wp = route[nav.idx];
  const dx = wp.x - state.x;
  const dz = wp.z - state.z;
  const d = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / d;
  const uz = dz / d;
  input.fwd = uz;
  input.right = -ux; // the logic maps right to world -X
  const t = state.t;
  if (state.onGround) {
    // Platforms count only at Kai's own height (within a step), so a platform far below is a drop, not ground to walk onto.
    const level = (x, z) =>
      course.platforms.find((q) => {
        const b = platformBounds(q, t);
        if (!(x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1)) return false;
        const h = q.hm ? surfaceY(q, x, z) : b.y;
        return h !== null && Math.abs(h - state.y) < 0.6;
      });
    const here = level(state.x, state.z);
    const ahead = level(state.x + ux * 0.5, state.z + uz * 0.5);
    if (here && !ahead && d > 1.5) input.jump = true; // at an edge, heading across a gap
  }
  if (!state.onGround && state.vy > 0 && !state.springUp) input.jump = true; // hold while rising (a release cuts the hop short)
  if (options.doubleJump !== false && wp.dj !== false && !state.onGround && state.vy <= 0 && state.airJumps > 0 && !supportAt(course, state.x, state.z, 0.15, t) && d > 3.6) {
    input.jump = !state.prevJump;
  }
  return input;
}

/** Run `seconds` of simulated time with an input function; returns the final state. */
export function simulate(course, inputFn, seconds, dt = PARAMS.dt) {
  const s = createState(course);
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n && s.status === 'playing'; i++) step(s, inputFn(s, course, i), course, dt);
  return s;
}

/**
 * The scripted player for the continuous level: it follows one of the course's routes (an act 1 route, or a side road) with
 * `navigate`, and when that route is finished it runs the main line with `autopilot`.
 */
export function pilot(state, course, options = {}) {
  if (state.hang) return { fwd: 1, right: 0, jump: true, grapple: false }; // caught by the vines: climb
  const route = course.routes && course.routes[options.route || 'centre'];
  if (route) {
    const input = navigate(state, course, route, options);
    if (state.nav.idx < route.length) return input;
  }
  // Errands off the main line (fetching a key that is not on the road): a short route followed once, when Kai reaches it.
  for (const er of course.errands || []) {
    if (er.done(state) || state.z < er.fromZ || state.z > er.toZ) continue;
    const keep = state.nav;
    state.nav = (state.errands ||= {})[er.id] || { idx: 0 };
    const input = navigate(state, course, er.route, options);
    state.errands[er.id] = state.nav;
    const unfinished = state.nav.idx < er.route.length;
    state.nav = keep;
    if (unfinished) return input;
  }
  return autopilot(state, course, options);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Living creatures (the steward pass, 2026-11-12). The playtester: "the creatures are not living, they are all just mindlessly guarding.
// They should be doing what creatures do: look for food, have fun, find friends and mates, avoid dangers, have offspring, make
// and guard shelters and young, eliminate waste." And: "On X on a creature, Kai should try to catch it and then he should rehome
// it if it is not in the right habitat."
//
// A course lists `creatures: [{ species, x, z, plat }]` and `habitats: { platformId: ['meadow', 'blossom', ...] }`. Each species
// has one habitat it thrives in. A creature in its habitat lives: it wanders, gets hungry and goes to eat, plays with a friend of
// its kind, rests when tired, shies from a running Kai, leaves a seed behind after a meal (a flower grows there), and a fed pair
// has a kit that follows its parent. A creature in the wrong place mopes. Kai catches one with his hand (X), carries it, and
// sets it down (X again); set down in its habitat, it is rehomed. All of this is deterministic (each creature has its own seed).

export const SPECIES = {
  hopper: { habitat: 'meadow', speed: 3.0, r: 0.35 }, // the orange fox-rabbit: grazes the lawns
  dewling: { habitat: 'water', speed: 1.5, r: 0.4 }, // the blue leafy orb: lives where a stream is flowing
  sprout: { habitat: 'blossom', speed: 2.1, r: 0.28 }, // the small green one: lives under the blossom trees
};
const LIFE = {
  catchReach: 2.3, // m: how close Kai's hand must be
  shyRange: 2.6, // m: a running Kai this close makes a creature skip away
  shySpeed: 4, // m/s: "running"
  hungerRate: 0.035, // per s
  energyRate: 0.012, // per s
  kitAfterMeals: 2, // meals each of a pair needs before a kit
  maxKits: 6,
  maxSeeds: 40,
};

/** Is platform `platId` a home for `species` right now? Water counts only where a stream is flowing. */
export function habitatOk(state, course, species, platId) {
  if (!platId) return false;
  const need = SPECIES[species].habitat;
  if (need === 'water') return (course.streams || []).some((st, i) => st.plat === platId && state.springs[i]);
  return ((course.habitats || {})[platId] || []).includes(need);
}

/** Creature state for a course (called by createState). */
export function createCreatures(state, course) {
  state.creatures = (course.creatures || []).map((c, i) => ({
    species: c.species,
    x: c.x,
    z: c.z,
    plat: c.plat,
    seed: (i + 1) * 2654435761 >>> 0,
    hunger: ((i * 37) % 100) / 100,
    energy: 0.5 + ((i * 53) % 50) / 100,
    mood: 'wander', // wander | eat | play | rest | flee | mope
    tx: c.x,
    tz: c.z,
    timer: (i % 5) * 0.7,
    meals: 0,
    kits: 0,
    kit: false,
    parent: -1,
    carried: false,
    counted: false, // already counted as rehomed
    ph: i, // hop phase, for the renderer
  }));
  state.carry = -1;
  state.rehomed = 0;
  state.seeds = []; // { x, z, plat, t } where a creature left a seed: a flower grows there
  state.toRehome = state.creatures.filter((c) => !habitatOk(state, course, c.species, c.plat)).length;
  for (const c of state.creatures) c.counted = habitatOk(state, course, c.species, c.plat); // residents are not "rehomed" later
}

function rnd(c) {
  c.seed = (Math.imul(c.seed, 1664525) + 1013904223) >>> 0;
  return c.seed / 4294967296;
}

/** A point on the creature's platform it may walk to (dewlings keep to their stream). */
function roam(state, course, c) {
  const p = course.platforms.find((q) => q.id === c.plat);
  if (!p) return { x: c.x, z: c.z };
  const b = platformBounds(p, state.t);
  let x0 = b.x0 + 0.8;
  let x1 = b.x1 - 0.8;
  let z0 = b.z0 + 0.8;
  let z1 = b.z1 - 0.8;
  if (c.species === 'dewling') {
    const st = (course.streams || []).find((q, i) => q.plat === c.plat && state.springs[i]);
    if (st) {
      z0 = st.z0 + 0.3;
      z1 = st.z1 - 0.3;
    }
  }
  // On terrain (a visit island) only ground counts: try a few spots, else stay put.
  for (let k = 0; k < 6; k++) {
    const x = x0 + rnd(c) * Math.max(0.1, x1 - x0);
    const z = z0 + rnd(c) * Math.max(0.1, z1 - z0);
    if (!p.hm || surfaceY(p, x, z) !== null) return { x, z };
  }
  return { x: c.x, z: c.z };
}

/** Height a creature stands at (its platform's surface under it). */
export function creatureY(course, c, t = 0) {
  const p = course.platforms.find((q) => q.id === c.plat);
  if (!p) return 0;
  if (p.hm) return surfaceY(p, c.x, c.z) ?? p.y;
  return platformBounds(p, t).y;
}

/**
 * One step of the creatures' lives and of Kai's hand on them. `pressed` is a fresh press of X. Returns true when the hand was
 * used here (caught or set down a creature), so the caller does not also throw a gust.
 */
function lifeStep(state, course, pressed, dt) {
  const cs = state.creatures;
  let used = false;
  if (pressed && !state.rope && !state.rail) {
    if (state.carry >= 0) {
      // Set it down where Kai stands.
      used = true;
      if (state.onGround && state.standing) {
        const c = cs[state.carry];
        const p = course.platforms.find((q) => q.id === state.standing);
        const b = platformBounds(p, state.t);
        c.carried = false;
        c.plat = state.standing;
        c.x = Math.max(b.x0 + 0.6, Math.min(b.x1 - 0.6, state.x + Math.sin(state.yaw) * 0.9));
        c.z = Math.max(b.z0 + 0.6, Math.min(b.z1 - 0.6, state.z + Math.cos(state.yaw) * 0.9));
        c.tx = c.x;
        c.tz = c.z;
        c.timer = 1.5;
        c.mood = 'wander';
        state.carry = -1;
        if (habitatOk(state, course, c.species, c.plat)) {
          if (!c.counted) {
            c.counted = true;
            state.rehomed += 1;
          }
          state.events.push('rehome');
        } else state.events.push('release');
      }
    } else {
      // Catch the nearest creature within reach.
      let best = -1;
      let bestD = LIFE.catchReach;
      const ky = state.y;
      cs.forEach((c, i) => {
        if (c.carried) return;
        const d = Math.hypot(c.x - state.x, c.z - state.z);
        if (d < bestD && Math.abs(creatureY(course, c, state.t) - ky) < 2) {
          best = i;
          bestD = d;
        }
      });
      if (best >= 0) {
        used = true;
        cs[best].carried = true;
        state.carry = best;
        state.lastCaught = best;
        state.events.push('catch');
      }
    }
  }
  const kaiSpeed = Math.hypot(state.vx, state.vz);
  let kits = 0;
  for (const c of cs) if (c.kit) kits++;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.carried) {
      c.x = state.x;
      c.z = state.z;
      c.ph += dt * 6;
      continue;
    }
    const sp = SPECIES[c.species];
    const home = habitatOk(state, course, c.species, c.plat);
    let speed = sp.speed;
    c.timer -= dt;
    if (!home) {
      // Out of place: it mopes, shuffling a little.
      c.mood = 'mope';
      speed *= 0.3;
      if (c.timer <= 0) {
        const r = roam(state, course, c);
        c.tx = c.x + (r.x - c.x) * 0.25;
        c.tz = c.z + (r.z - c.z) * 0.25;
        c.timer = 3 + rnd(c) * 3;
      }
    } else {
      c.hunger = Math.min(1, c.hunger + dt * LIFE.hungerRate);
      c.energy = Math.max(0, c.energy - dt * LIFE.energyRate);
      const dk = Math.hypot(state.x - c.x, state.z - c.z);
      if (c.kit && c.parent >= 0 && !cs[c.parent].carried && cs[c.parent].plat === c.plat) {
        // A kit keeps close to its parent.
        const par = cs[c.parent];
        c.mood = par.mood === 'rest' ? 'rest' : 'play';
        c.tx = par.x - 0.7;
        c.tz = par.z - 0.5;
        speed *= 1.15;
      } else if (dk < LIFE.shyRange && kaiSpeed > LIFE.shySpeed && c.mood !== 'flee') {
        // A running Kai: skip away from him, then settle.
        c.mood = 'flee';
        c.timer = 1.1;
        const r = roam(state, course, c);
        const ax = (c.x - state.x) / (dk || 1);
        const az = (c.z - state.z) / (dk || 1);
        c.tx = c.x + ax * 3 + (r.x - c.x) * 0.2;
        c.tz = c.z + az * 3 + (r.z - c.z) * 0.2;
        speed *= 1.5;
      } else if (c.mood === 'flee') {
        speed *= 1.5;
        if (c.timer <= 0) c.mood = 'wander';
      } else if (c.timer <= 0) {
        if (c.mood === 'eat') {
          // The meal is over: sometimes a seed is left behind, and a well-fed pair may have a kit.
          c.hunger = 0;
          c.meals += 1;
          if (rnd(c) < 0.5 && state.seeds.length < LIFE.maxSeeds) {
            state.seeds.push({ x: c.x, z: c.z, plat: c.plat, t: state.t });
            state.events.push('seed');
          }
          const mate = cs.findIndex((o, k) => k !== i && o.species === c.species && !o.kit && !o.carried && o.plat === c.plat && o.meals >= LIFE.kitAfterMeals);
          if (!c.kit && c.meals >= LIFE.kitAfterMeals && mate >= 0 && c.kits === 0 && cs[mate].kits === 0 && kits < LIFE.maxKits) {
            c.kits = 1;
            cs[mate].kits = 1;
            cs.push({ ...c, seed: (c.seed ^ 0x9e3779b9) >>> 0, kit: true, parent: i, meals: 0, kits: 0, hunger: 0.2, energy: 1, mood: 'play', counted: true, ph: 0, x: c.x + 0.4, z: c.z + 0.4 });
            kits += 1;
            state.events.push('kit');
          }
        }
        if (c.mood === 'rest') c.energy = 1;
        const friend = cs.find((o, k) => k !== i && o.species === c.species && !o.carried && o.plat === c.plat && Math.hypot(o.x - c.x, o.z - c.z) < 9);
        const roll = rnd(c);
        if (c.energy < 0.2) {
          c.mood = 'rest';
          c.timer = 5 + roll * 3;
          c.tx = c.x;
          c.tz = c.z;
        } else if (c.hunger > 0.6) {
          // Go and eat: walk to a feeding spot, then the meal itself is the next "timer".
          const r = roam(state, course, c);
          c.mood = 'forage';
          c.tx = r.x;
          c.tz = r.z;
          c.timer = 6;
        } else if (friend && roll < 0.45) {
          c.mood = 'play';
          c.tx = friend.x + (roll - 0.2) * 3;
          c.tz = friend.z + (0.5 - roll) * 3;
          c.timer = 2.5 + roll * 2;
        } else {
          const r = roam(state, course, c);
          c.mood = 'wander';
          c.tx = r.x;
          c.tz = r.z;
          c.timer = 2 + roll * 3;
        }
      }
      if (c.mood === 'forage' && Math.hypot(c.tx - c.x, c.tz - c.z) < 0.3) {
        c.mood = 'eat';
        c.timer = 2.5;
      }
      if (c.mood === 'play') speed *= 1.25;
      if (c.mood === 'rest' || c.mood === 'eat') speed = 0;
    }
    const dx = c.tx - c.x;
    const dz = c.tz - c.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05 && speed > 0) {
      const stepLen = Math.min(d, speed * dt);
      c.x += (dx / d) * stepLen;
      c.z += (dz / d) * stepLen;
      c.ph += stepLen * 2.2;
      c.yaw = Math.atan2(dx, dz);
    }
    // Never off its island.
    const p = course.platforms.find((q) => q.id === c.plat);
    if (p) {
      const b = platformBounds(p, state.t);
      c.x = Math.max(b.x0 + 0.5, Math.min(b.x1 - 0.5, c.x));
      c.z = Math.max(b.z0 + 0.5, Math.min(b.z1 - 0.5, c.z));
    }
  }
  return used;
}
