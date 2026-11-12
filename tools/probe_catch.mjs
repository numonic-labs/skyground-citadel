// Walk Kai off an island's edge (no browser) and print what the vines do: which island catches him, how deep he hangs,
// and how long the climb back takes.   node tools/probe_catch.mjs [x] [z] [dirX]
import { COURSE_WORLD as C } from '../src/course.world.mjs';
import { createState, step, surfaceY } from '../src/logic.mjs';

const [x0 = 7.6, z0 = 2, dirX = 1] = process.argv.slice(2).map(Number);
const s = createState(C);
const p = C.platforms.find((q) => x0 >= q.x0 && x0 <= q.x1 && z0 >= q.z0 && z0 <= q.z1);
Object.assign(s, { x: x0, z: z0, y: p.hm ? surfaceY(p, x0, z0) : p.y, standing: p.id });
let caughtAt = null;
for (let i = 0; i < 600; i++) {
  step(s, { fwd: s.hang ? 1 : 0, right: s.hang ? 0 : -dirX, jump: false }, C);
  if (s.events.includes('vinecatch')) {
    caughtAt = s.t;
    console.log(`caught at t=${s.t.toFixed(2)} by ${s.hang.plat}: hanging ${s.hang.depth.toFixed(1)} m below its rim (top ${s.hang.top}), Kai at x${s.x.toFixed(1)} y${s.y.toFixed(1)} z${s.z.toFixed(1)}`);
  }
  if (s.events.includes('mount')) {
    console.log(`back on ${s.standing} at t=${s.t.toFixed(2)} (climb took ${(s.t - caughtAt).toFixed(1)} s)`);
    break;
  }
  if (s.events.includes('respawn')) {
    console.log(`fell out of the world at t=${s.t.toFixed(2)} (no rim in reach)`);
    break;
  }
}
console.log(`slips ${s.slips}, falls ${s.deaths}`);
