// Development probe: for a run-up to the dock edge, a grapple and a release at a chosen z, where does Kai end up?
import { COURSE_S3 as C } from '../src/course.s3.mjs';
import { createState, step } from '../src/logic.mjs';

function attempt({ grappleZ = -0.6, releaseZ, pump = 1, releaseMode = 'z' }) {
  const s = createState(C);
  s.z = -6; s.standing = 'dock';
  let phase = 'run';
  let maxZ = s.z, minY = 0, outcome = 'timeout';
  for (let i = 0; i < 60 * 12; i++) {
    const inp = { fwd: 1, right: Math.max(-1, Math.min(1, s.x * 2)), jump: false, grapple: false };
    if (phase === 'run' && s.z >= grappleZ) { inp.grapple = true; phase = 'swing'; }
    else if (phase === 'swing' && s.rope && releaseZ !== undefined && s.z >= releaseZ && s.vy >= (releaseMode === 'up' ? 0 : -99)) { inp.jump = true; phase = 'flight'; }
    if (phase === 'swing' && !pump) inp.fwd = 0;
    step(s, inp, C);
    maxZ = Math.max(maxZ, s.z); minY = Math.min(minY, s.y);
    if (s.events.includes('respawn')) { outcome = 'fell'; break; }
    if (s.status === 'complete') { outcome = 'complete'; break; }
    if (phase === 'flight' && s.onGround && s.z > 12) { outcome = 'bank'; break; }
  }
  return `${outcome} (max z ${maxZ.toFixed(1)}, min y ${minY.toFixed(1)}, t ${s.t.toFixed(1)})`;
}

console.log('--- with pumping (forward held), run-up speed at the grapple ---');
for (let rz = 3; rz <= 14; rz += 1) console.log(`release at z>=${rz}:`, attempt({ releaseZ: rz }));
console.log('--- without pumping ---');
for (let rz = 3; rz <= 14; rz += 1) console.log(`release at z>=${rz}:`, attempt({ releaseZ: rz, pump: 0 }));
console.log('--- never release ---');
console.log(attempt({}));
