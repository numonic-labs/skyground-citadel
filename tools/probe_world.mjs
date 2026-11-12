// Simulate the scripted player through the continuous level (no browser) and report how it went.
//   node tools/probe_world.mjs [route] [--log] [--missed]
// --log prints the notable events with positions; --missed lists main-line coins it did not collect.
import { COURSE_WORLD as C } from '../src/course.world.mjs';
import { createState, step, pilot } from '../src/logic.mjs';

const args = process.argv.slice(2);
const route = args.find((a) => !a.startsWith('--')) || 'centre';
const s = createState(C);
const log = [];
const NOTABLE = ['respawn', 'hurt', 'grapple', 'release', 'grind', 'railend', 'key', 'stomp', 'gem', 'spring', 'checkpoint'];
for (let i = 0; i < 60 * 400 && s.status === 'playing' && s.deaths <= 8; i++) {
  const b = { x: s.x, y: s.y, z: s.z };
  step(s, pilot(s, C, { route }), C);
  for (const e of s.events) {
    if (NOTABLE.includes(e)) log.push(`${s.t.toFixed(1)}s ${e} at x${b.x.toFixed(1)} y${b.y.toFixed(1)} z${b.z.toFixed(1)}`);
  }
}
if (args.includes('--log')) console.log(log.join('\n'));
if (args.includes('--missed')) {
  const missed = C.coins.filter((c, i) => !s.collected[i] && Math.abs(c.x) < 2.5 && c.z > 98).map((c) => `(${c.x},${c.y},${c.z})`);
  console.log('main-line coins missed after act 1:', missed.join(' ') || 'none');
}
console.log(
  `${route}: ${s.status} in ${s.t.toFixed(1)} s at z ${s.z.toFixed(1)}; falls ${s.deaths}, hits ${s.hits}, coins ${s.coins}/${C.coins.length}, gems ${s.gems}/${C.gems.length}`
);
