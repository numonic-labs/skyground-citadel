// Skyground Citadel, Level 1, section S4: the rail beat. World: metres, +Y up, the course runs along +Z (side-view camera, as S3).
//
// WHAT THE SOURCE FOOTAGE SHOWS (30 to 62 s of the 62 s cut, contact sheet checked 2026-11-07): a grass plateau with wooden
// signposts, a wooden rope bridge to a floating island, then a chain of small grass islands with pink trees, fences, glowing
// lanterns and a blue leafy round orb enemy. There is NO grind rail and NO key in the footage; both are the reference sheet's
// beat 4 verbs ("grind rails, dodge enemies, collect a key"), added (2026-11-07).
//
// WHAT IS BUILT (PROPOSED level data): plateau, rope bridge, island A with two orbs patrolling across the path and the key
// behind them, a locked gate at the end of island A, a grind rail over a 20 m gap (too wide to jump) with a third orb hovering
// above it, and island B. Falling onto the rail from above catches it; Space jumps off (jump over the orb and the rail catches
// you again); the rail drops Kai onto island B.

export const COURSE_S4 = {
  id: 's4',
  killY: -8,
  start: { x: 0, z: -3 },
  platforms: [
    { id: 'plateau', x0: -5, x1: 5, z0: -8, z1: 12, y: 0, fenced: false },
    { id: 'bridge', x0: -1.3, x1: 1.3, z0: 12, z1: 24, y: 0, fenced: true },
    { id: 'islandA', x0: -5, x1: 5, z0: 24, z1: 46, y: 0, fenced: false },
    { id: 'islandB', x0: -5, x1: 5, z0: 66, z1: 86, y: 0, fenced: false },
  ],
  checkpoints: [
    { x: 0, z: -3 },
    { x: 0, z: 27 },
    { x: 0, z: 69 },
  ],
  // The rail: a line from the end of island A, sloping gently down to island B. Kai rides it at `speed` m/s.
  rails: [{ x: 0, z0: 45.5, z1: 66, y0: 3.4, y1: 2.3, speed: 8 }],
  // Blue orbs: two patrol across island A's path, one hovers over the rail (all `r` m radius, `y` is the centre).
  enemies: [
    { x: 0, y: 0.6, z: 31, r: 0.5, ax: 2.2, period: 3.2, phase: 0 },
    { x: 0, y: 0.6, z: 36, r: 0.5, ax: 2.2, period: 3.2, phase: Math.PI },
    { x: 0, y: 1.5, z: 55, r: 0.4, az: 0.6, period: 3, phase: 0 },
  ],
  key: { x: 0, y: 0.9, z: 42 },
  gate: { z: 44.5 },
  coins: [
    { x: 0, y: 1.0, z: -4 },
    { x: -1.5, y: 1.0, z: 2 },
    { x: 1.5, y: 1.0, z: 6 },
    { x: 0, y: 1.0, z: 10 },
    { x: 0, y: 1.0, z: 16 },
    { x: 0, y: 1.0, z: 20 },
    { x: -2, y: 1.0, z: 28 },
    { x: 2, y: 1.0, z: 40 },
    { x: 0, y: 2.0, z: 50 },
    { x: 0, y: 1.7, z: 58 },
    { x: 0, y: 1.4, z: 63 },
    { x: 0, y: 1.0, z: 72 },
    { x: -2, y: 1.0, z: 78 },
    { x: 2, y: 1.0, z: 82 },
  ],
  goal: { z: 84 },
};
