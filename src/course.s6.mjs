// Skyground Citadel, Level 1, section S6: the final ascent. World: metres, +Y up, the course runs along +Z (side-view camera).
//
// WHAT THE SOURCE FOOTAGE SHOWS (52 to 62 s of the 62 s cut, contact sheet checked 2026-11-08): more of the island chain from S5 (grass
// islands, fences, pink trees, lanterns, a blue orb), with the citadel and its waterfall always in the distance. The footage ENDS
// without a climb, a final obstacle or a goal. All of S6 comes from the reference sheet's beat 6 text ("climb to the citadel, defeat
// final obstacle, reach goal"): a staircase of rising islands, a guardian that you defeat by landing on it (a new verb, stomping,
// used only here), and a gate to the goal that the guardian's defeat opens. These are PROPOSED.
//
// Difficulty (single jump: reach 5.2 m, apex 1.7 m, but only about 1.5 m high after crossing 3 m; double jump: apex about 3.1 m):
// each step is 1.2 m up across a 2.5 m gap, so a single jump climbs it. The guardian's top is 2 m above the summit: a single jump
// only reaches 1.7 m, so it cannot be jumped over; you land on it.

export const COURSE_S6 = {
  id: 's6',
  killY: -8,
  start: { x: 0, z: -3 },
  platforms: [
    { id: 'base', x0: -5, x1: 5, z0: -6, z1: 12, y: 0, fenced: false },
    { id: 'step1', x0: -5, x1: 5, z0: 14.5, z1: 22.5, y: 1.2, fenced: false },
    { id: 'step2', x0: -5, x1: 5, z0: 25, z1: 33, y: 2.4, fenced: false },
    { id: 'step3', x0: -5, x1: 5, z0: 35.5, z1: 43.5, y: 3.6, fenced: false },
    { id: 'step4', x0: -5, x1: 5, z0: 46, z1: 54, y: 4.8, fenced: false },
    { id: 'summit', x0: -5, x1: 5, z0: 56.5, z1: 90, y: 6.0, fenced: false },
  ],
  checkpoints: [
    { x: 0, z: -3 },
    { x: 0, z: 27 },
    { x: 0, z: 58.5 },
  ],
  // `stomp` enemies are defeated by landing on them; `drops: 'key'` opens the gate when defeated.
  enemies: [
    { kind: 'sprout', x: 0, y: 1.5, z: 19, r: 0.3, ax: 2.0, period: 1.8, phase: 0 },
    { kind: 'orb', x: 0, y: 3.0, z: 29, r: 0.5, ax: 2.2, period: 3, phase: 0 },
    { kind: 'sprout', x: 0, y: 3.9, z: 38.5, r: 0.3, ax: 2.0, period: 1.8, phase: Math.PI },
    { kind: 'orb', x: 0, y: 5.4, z: 50, r: 0.5, ax: 2.2, period: 3, phase: Math.PI },
    { kind: 'orb', x: 0, y: 6.6, z: 65, r: 0.5, ax: 2.2, period: 3, phase: 0 },
    { kind: 'guardian', x: 0, y: 7.0, z: 74, r: 1.0, ax: 2.5, period: 4, phase: 0, stomp: true, drops: 'key' },
  ],
  gate: { z: 82 },
  coins: [
    { x: 0, y: 1.0, z: -2 },
    { x: -2, y: 1.0, z: 6 },
    { x: 0, y: 2.2, z: 19 },
    { x: 2, y: 3.4, z: 29 },
    { x: 0, y: 4.6, z: 40 },
    { x: -2, y: 5.8, z: 50 },
    { x: 0, y: 7.0, z: 60 },
    { x: 2, y: 7.0, z: 65 },
    { x: -2, y: 7.0, z: 69 },
    { x: 0, y: 7.0, z: 86 },
  ],
  goal: { z: 88 },
};
