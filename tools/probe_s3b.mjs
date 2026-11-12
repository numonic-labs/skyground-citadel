// Development probe: scan anchor and bank geometry for a fair release window (development only).
import { createState, step } from '../src/logic.mjs';

let BANK_Y = 0;
function course(anchorZ, anchorY, bankZ0) {
  return {
    id: 's3p', killY: -8, start: { x: 0, z: -3 },
    platforms: [
      { id: 'dock', x0: -2.5, x1: 2.5, z0: -8, z1: 0, y: 0 },
      { id: 'bank', x0: -5, x1: 5, z0: bankZ0, z1: bankZ0 + 12.5, y: BANK_Y },
    ],
    checkpoints: [{ x: 0, z: -3 }], anchors: [{ x: 0, y: anchorY, z: anchorZ, range: 14 }], coins: [], goal: { z: bankZ0 + 10 },
  };
}
function attempt(C, releaseZ, pump) {
  const s = createState(C);
  s.z = -6; s.standing = 'dock';
  let phase = 'run';
  for (let i = 0; i < 60 * 8; i++) {
    const inp = { fwd: pump ? 1 : 0, right: 0, jump: false, grapple: false };
    if (phase === 'run') { inp.fwd = 1; if (s.z >= -0.6) { inp.grapple = true; phase = 'swing'; } }
    else if (phase === 'swing' && s.rope && s.z >= releaseZ) { inp.jump = true; phase = 'flight'; }
    step(s, inp, C);
    if (s.events.includes('respawn')) return 'F';
    if (phase === 'flight' && s.onGround && s.z > 5) return 'B';
  }
  return 'T';
}
const rows = [];
for (const [az, ay, bz, by] of [[5.5, 7.0, 10.5, -1.0], [5.5, 7.0, 10.5, -1.5], [5.5, 7.0, 10.5, -2.0], [5.5, 7.0, 11.5, -2.0], [5.75, 7.8, 11.5, -2.0], [5.75, 7.8, 13.5, -2.5]]) {
  BANK_Y = by;
  const C = course(az, ay, bz);
  let line = `anchor z${az} y${ay}, bank z0 ${bz} y${by}: `;
  for (const pump of [1, 0]) {
    let out = '';
    for (let rz = 2; rz <= 13; rz += 0.5) out += attempt(C, rz, pump);
    line += `[pump=${pump}] ${out}  `;
  }
  rows.push(line);
}
console.log('release z from 2 to 13 in 0.5 steps; F fell, B landed on the bank, T timeout');
rows.forEach((r) => console.log(r));
