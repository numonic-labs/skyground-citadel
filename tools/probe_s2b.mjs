// Debug probe: per-step trace of the scripted player on the raft (development only).
import { COURSE_S2 } from '../src/course.s2.mjs';
import { createState, step, autopilot, platformBounds } from '../src/logic.mjs';

const from = Number(process.argv[2] || 15.5);
const to = Number(process.argv[3] || 17.6);
const s = createState(COURSE_S2);
const raft = COURSE_S2.platforms.find((p) => p.id === 'raft');
for (let i = 0; i < 60 * 40 && s.status === 'playing'; i++) {
  const inp = autopilot(s, COURSE_S2, {});
  step(s, inp, COURSE_S2);
  if (s.t >= from && s.t <= to && i % 6 === 0) {
    const b = platformBounds(raft, s.t);
    console.log(`t=${s.t.toFixed(2)} z=${s.z.toFixed(2)} y=${s.y.toFixed(2)} vz=${s.vz.toFixed(1)} on=${s.standing} fwd=${inp.fwd} jump=${inp.jump} raft=${b.z0.toFixed(1)}..${b.z1.toFixed(1)}`);
  }
}
