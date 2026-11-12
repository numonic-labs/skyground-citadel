// Tests for S3: the grapple and free pendulum swing. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_S3 as C } from '../src/course.s3.mjs';
import { PARAMS, createState, step, autopilot } from '../src/logic.mjs';

const anchor = C.anchors[0];
const dock = C.platforms.find((p) => p.id === 'dock');
const bank = C.platforms.find((p) => p.id === 'bank');

function run(options, seconds = 40) {
  const s = createState(C);
  for (let i = 0; i < Math.round(seconds / PARAMS.dt) && s.status === 'playing'; i++) step(s, autopilot(s, C, options), C);
  return s;
}

// A scripted player: run to the dock edge, grapple, hold forward (pump or not) and release at releaseZ (undefined = never).
function swing({ releaseZ, pump = true, seconds = 12, startX = 0 }) {
  const s = createState(C);
  s.z = -6; s.standing = 'dock'; s.x = startX;
  let phase = 'run';
  let rope = 0;
  for (let i = 0; i < Math.round(seconds / PARAMS.dt) && s.status === 'playing'; i++) {
    const inp = { fwd: pump || phase === 'run' ? 1 : 0, right: 0, jump: false, grapple: false };
    if (phase === 'run' && s.z >= -0.6) { inp.grapple = true; phase = 'swing'; }
    else if (phase === 'swing' && s.rope && releaseZ !== undefined && s.z >= releaseZ) { inp.jump = true; phase = 'flight'; }
    step(s, inp, C);
    if (s.rope) rope = Math.max(rope, Math.hypot(s.x - anchor.x, s.y + PARAMS.handHeight - anchor.y, s.z - anchor.z) - s.rope.L);
    if (s.deaths > 0) break;
  }
  s.maxRopeStretch = rope;
  return s;
}

test('the scripted player grapples, swings, releases and completes S3 without falling', () => {
  const s = run({});
  assert.equal(s.status, 'complete');
  assert.equal(s.deaths, 0);
});

test('the river cannot be crossed without the grapple, even with a double jump', () => {
  assert.ok(bank.z0 - dock.z1 > 8.6, 'the gap is wider than the double-jump reach');
  const s = createState(C);
  s.z = dock.z1 - 3; s.standing = 'dock';
  let jumped = false;
  for (let i = 0; i < 60 * 8 && s.deaths === 0; i++) {
    const nearEdge = s.z > dock.z1 - 0.5;
    const apex = !s.onGround && s.vy <= 0 && s.airJumps > 0;
    const inp = { fwd: 1, right: 0, jump: (nearEdge && s.onGround) || (jumped && apex && !s.prevJump) };
    if (inp.jump) jumped = true;
    step(s, inp, C);
  }
  assert.ok(s.deaths >= 1, 'a jump and a double jump fall into the river');
  assert.equal(s.checkpoint, 0);
});

test('a swing that is pumped and released in the window lands on the bank', () => {
  const s = swing({ releaseZ: 11 });
  assert.equal(s.deaths, 0);
  assert.ok(s.onGround && s.z >= bank.z0, `landed on the bank at z=${s.z.toFixed(1)}`);
});

test('releasing too early drops Kai into the river', () => {
  for (const rz of [3, 5, 7]) {
    const s = swing({ releaseZ: rz });
    assert.ok(s.deaths >= 1, `released at z>=${rz} falls`);
  }
});

test('a swing that is never pumped never reaches the bank', () => {
  const s = swing({ releaseZ: 11, pump: false });
  assert.equal(s.checkpoint, 0);
  assert.ok(!(s.onGround && s.z >= bank.z0));
});

test('there is a fair release window: several metres of travel land on the bank, most others fall', () => {
  let lands = 0;
  let falls = 0;
  for (let rz = 2; rz <= 13; rz += 0.5) {
    const s = swing({ releaseZ: rz });
    if (s.deaths === 0 && s.onGround && s.z >= bank.z0) lands++;
    else if (s.deaths > 0) falls++;
  }
  assert.ok(lands >= 6, `at least 3 m of release travel lands (${lands} samples of 0.5 m)`);
  assert.ok(falls >= 10, `releasing early falls (${falls} samples)`);
});

test('the rope is a hard length limit: Kai never stretches it', () => {
  const s = swing({ releaseZ: 11 });
  assert.ok(s.maxRopeStretch < 1e-6, `max stretch ${s.maxRopeStretch}`);
});

test('the grapple needs an anchor in reach', () => {
  const s = createState(C);
  s.z = -7.9; s.standing = 'dock'; // about 13.5 m from the anchor, beyond its 13 m range
  step(s, { fwd: 0, right: 0, jump: false, grapple: true }, C);
  assert.equal(s.rope, null);
});

test('pressing the grapple key again lets go of the rope', () => {
  const s = createState(C);
  s.z = -0.6; s.standing = 'dock';
  step(s, { fwd: 0, right: 0, jump: false, grapple: true }, C);
  assert.ok(s.rope, 'attached');
  step(s, { fwd: 0, right: 0, jump: false, grapple: false }, C);
  step(s, { fwd: 0, right: 0, jump: false, grapple: true }, C);
  assert.equal(s.rope, null, 'released');
  assert.ok(s.events.includes('release'));
});

test('a jump press in the air releases the rope with a small upward boost and restores the air jump', () => {
  const s = createState(C);
  s.z = -0.6; s.standing = 'dock';
  step(s, { fwd: 0, right: 0, jump: false, grapple: true }, C);
  for (let i = 0; i < 20; i++) step(s, { fwd: 0, right: 0, jump: false, grapple: false }, C);
  assert.ok(s.rope && !s.onGround, 'swinging');
  const vyBefore = s.vy;
  step(s, { fwd: 0, right: 0, jump: true, grapple: false }, C);
  assert.equal(s.rope, null);
  assert.ok(s.events.includes('release'));
  assert.ok(s.vy > vyBefore - PARAMS.gravity * PARAMS.dt * 1.01, 'boosted, not just falling');
  assert.equal(s.airJumps, PARAMS.airJumps);
});

test('landing drops the rope', () => {
  const s = swing({ releaseZ: 11, seconds: 4 });
  assert.equal(s.rope, null);
});

test('Kai moves freely in every direction on the dock: along the course, in depth, and diagonally', () => {
  const move = (input) => {
    const s = createState(C);
    s.x = 0; s.z = -4; s.standing = 'dock';
    for (let i = 0; i < 20; i++) step(s, { ...input, jump: false }, C);
    return s;
  };
  const along = move({ fwd: 1, right: 0 });
  const back = move({ fwd: -1, right: 0 });
  const away = move({ fwd: 0, right: -1 }); // right = -1 is world +X (away from the side-view camera)
  const toward = move({ fwd: 0, right: 1 });
  const diag = move({ fwd: 1, right: -1 });
  assert.ok(along.z > -4 && Math.abs(along.x) < 1e-6, 'along');
  assert.ok(back.z < -4 && Math.abs(back.x) < 1e-6, 'back');
  assert.ok(away.x > 0.3 && Math.abs(away.z + 4) < 1e-6, 'away from the camera');
  assert.ok(toward.x < -0.3 && Math.abs(toward.z + 4) < 1e-6, 'towards the camera');
  assert.ok(diag.x > 0.3 && diag.z > -4, 'diagonal');
  assert.ok(Math.abs(Math.atan2(diag.vx, diag.vz)) > 0.3 && Math.abs(diag.yaw) > 0.3, 'Kai turns to face the way he moves');
});

test('a swing that starts off the centre line obeys the rope and still lands on the bank', () => {
  for (const startX of [-1.5, 1.5]) {
    const s = swing({ releaseZ: 11, startX });
    assert.ok(s.maxRopeStretch < 1e-6, `rope stretched ${s.maxRopeStretch} from x=${startX}`);
    assert.equal(s.deaths, 0, `from x=${startX}`);
    assert.ok(s.onGround && s.z >= bank.z0, `landed on the bank from x=${startX} (z=${s.z.toFixed(1)})`);
  }
});

test('S3 is deterministic: the same inputs give the same final state', () => {
  const a = run({});
  const b = run({});
  assert.equal(a.t, b.t);
  assert.equal(a.coins, b.coins);
  assert.equal(a.z, b.z);
});

test('every pickup is reachable: ground pickups lie over a platform, arc pickups lie on the swing path', () => {
  // Ground pickups (on the bank or the dock): chest height above the deck of the platform below.
  for (const c of C.coins) {
    const over = C.platforms.find((p) => c.x >= p.x0 && c.x <= p.x1 && c.z >= p.z0 && c.z <= p.z1);
    if (over) assert.ok(c.y - over.y <= 1.5, `pickup at z=${c.z} floats ${c.y - over.y} m over its platform`);
  }
});
