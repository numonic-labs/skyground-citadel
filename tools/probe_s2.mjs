// Prints what the scripted player does in S2 (a development probe; the assertions live in test/s2.test.mjs).
import { COURSE_S2 } from '../src/course.s2.mjs';
import { createState, step, autopilot } from '../src/logic.mjs';

const opts = JSON.parse(process.argv[2] || '{}');
const s = createState(COURSE_S2);
let last = '';
for (let i = 0; i < 60 * 60 && s.status === 'playing'; i++) {
  step(s, autopilot(s, COURSE_S2, opts), COURSE_S2);
  for (const ev of s.events) {
    if (['spring', 'hurt', 'respawn', 'checkpoint', 'complete', 'doublejump', 'jump', 'land'].includes(ev)) {
      console.log(`t=${s.t.toFixed(2)} z=${s.z.toFixed(1)} y=${s.y.toFixed(2)} ${ev} hearts=${s.hearts}`);
    }
  }
  last = `t=${s.t.toFixed(2)} z=${s.z.toFixed(1)} x=${s.x.toFixed(2)} y=${s.y.toFixed(2)}`;
}
console.log('final', s.status, 'deaths', s.deaths, 'hits', s.hits, 'hearts', s.hearts, 'coins', s.coins + '/' + COURSE_S2.coins.length, last);
