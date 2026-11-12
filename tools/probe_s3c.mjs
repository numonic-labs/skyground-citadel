// Development probe: trace the swing path (feet position) so pickups can be placed on it.
import { createState, step } from '../src/logic.mjs';
const C = {
  id: 's3p', killY: -8, start: { x: 0, z: -3 },
  platforms: [
    { id: 'dock', x0: -2.5, x1: 2.5, z0: -8, z1: 0, y: 0 },
    { id: 'bank', x0: -5, x1: 5, z0: 11.5, z1: 24, y: -2 },
  ],
  checkpoints: [{ x: 0, z: -3 }], anchors: [{ x: 0, y: 7.8, z: 5.75, range: 13 }], coins: [], goal: { z: 22 },
};
const s = createState(C);
s.z = -6; s.standing = 'dock';
let phase = 'run';
let line = '';
for (let i = 0; i < 60 * 4; i++) {
  const inp = { fwd: 1, right: 0, jump: false, grapple: false };
  if (phase === 'run' && s.z >= -0.6) { inp.grapple = true; phase = 'swing'; }
  else if (phase === 'swing' && s.rope && s.z >= 11) { inp.jump = true; phase = 'flight'; }
  step(s, inp, C);
  if (phase !== 'run' && i % 8 === 0) line += `(${s.z.toFixed(1)},${s.y.toFixed(1)}) `;
  if (phase === 'flight' && s.onGround) { line += ` LAND z${s.z.toFixed(1)} y${s.y.toFixed(1)} t${s.t.toFixed(2)} rope L=${'n/a'}`; break; }
}
console.log(line);
