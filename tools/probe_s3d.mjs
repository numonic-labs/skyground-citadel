// Development probe: what the scripted player does in S3 (events and positions).
import { COURSE_S3 as C } from '../src/course.s3.mjs';
import { createState, step, autopilot } from '../src/logic.mjs';
const s = createState(C);
let last = '';
for (let i = 0; i < 60 * 25 && s.status === 'playing'; i++) {
  step(s, autopilot(s, C, {}), C);
  for (const ev of s.events) if (['grapple', 'release', 'land', 'respawn', 'jump', 'doublejump', 'checkpoint', 'complete'].includes(ev)) console.log(`t=${s.t.toFixed(2)} z=${s.z.toFixed(1)} y=${s.y.toFixed(1)} ${ev} rope=${s.rope ? 'yes' : 'no'}`);
  last = `t=${s.t.toFixed(2)} z=${s.z.toFixed(1)} y=${s.y.toFixed(1)} vz=${s.vz.toFixed(1)} onGround=${s.onGround}`;
}
console.log('final', s.status, last, 'deaths', s.deaths);
