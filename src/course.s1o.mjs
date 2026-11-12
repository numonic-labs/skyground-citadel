// Skyground Citadel, Level 1, section S1 in its OPEN form: a small archipelago with three ways to the goal, so the player chooses where to go
// (the playtester, 2026-11-08: "the game is linear railroading but the players should have agency for the directions they travel").
// The classic corridor is still in course.mjs (?level=s1c). World: metres, +Y up; progress is still mostly +Z but nothing forces it.
//
// FROM THE FOOTAGE (0 to 15 s of the cut): a fenced dirt path toward floating islands, a blue marker on the path, a waterfall, a wooden
// bridge branching left, and a blue lattice pad that launches Kai to a higher plateau. The three routes use exactly those: the centre
// route is the fenced path and plank (as the classic S1); the west route is the pad (a spring) up to a high road of ledges; the east
// route is a hidden islet for a double-jump explorer. All distances are PROPOSED level data.
//
// Single-jump reach is about 5.2 m on the flat; a double jump reaches about 8.6 m.
//   centre (safest, the classic): A -> fenced path B -> island C -> (7 m, double jump) -> island D -> plank E -> goal island G
//   west (high road): spring on A -> ledges H1 H2 H3 (4 to 5 m up) -> (7 m drop, single jump) -> island I2 -> island F -> G
//   east (secret): from C jump 7.5 m (double jump) to islet S with a cluster of lanterns, then jump back to C
// Every route ends in G; the routes below are what the tests follow to prove each can be completed.

import { ISLAND_MODELS } from './islands.data.mjs';
import { surfaceY } from './logic.mjs';

/**
 * A visit island: one of the generated island models (ruin, arch, waterfall, trees) as a real place. Its ground is the model's measured
 * terrain (tools/measure_islands.mjs: a heightfield, with trees, walls and arches filled in from the ground around them), scaled by `s`
 * and placed at (X, Z); `y` is the height of the model's median ground. The renderer draws the whole model.
 */
function visit(id, name, X, Z, s, y) {
  const m = ISLAND_MODELS[name];
  const originY = +(y - m.groundY * s).toFixed(2);
  const x0 = +(X + m.box.minX * s).toFixed(2);
  const x1 = +(X + m.box.maxX * s).toFixed(2);
  const z0 = +(Z + m.box.minZ * s).toFixed(2);
  const z1 = +(Z + m.box.maxZ * s).toFixed(2);
  return {
    id,
    x0,
    x1,
    z0,
    z1,
    y,
    fenced: false,
    hm: { x0, x1, z0, z1, N: m.N, h: m.ground.map((g) => (g === null ? null : +(originY + g * s).toFixed(2))) },
    model: { name, x: X, y: originY, z: Z, s },
  };
}

export const COURSE_S1_OPEN = {
  id: 's1o',
  killY: -8,
  start: { x: 0, z: -3 },
  platforms: [
    { id: 'A', x0: -12, x1: 8, z0: -8, z1: 12, y: 0, fenced: false }, // start island (it reaches west to hold the pad)
    { id: 'B', x0: -1.4, x1: 1.4, z0: 14.5, z1: 30, y: 0, fenced: true }, // fenced path
    { id: 'C', x0: -6, x1: 6, z0: 33, z1: 46, y: 0, fenced: false },
    { id: 'D', x0: -2, x1: 4, z0: 53, z1: 64, y: 0, fenced: false },
    { id: 'E', x0: -1.1, x1: 1.1, z0: 67, z1: 80, y: 0, fenced: false }, // the plank
    { id: 'G', x0: -8, x1: 8, z0: 82.5, z1: 98, y: 0, fenced: false }, // goal island
    { id: 'H1', x0: -13, x1: -6.5, z0: 15, z1: 22, y: 4, fenced: false }, // west high road
    { id: 'H2', x0: -13, x1: -6.5, z0: 25, z1: 32, y: 4.5, fenced: false },
    { id: 'H3', x0: -13, x1: -6.5, z0: 35, z1: 43, y: 5, fenced: false },
    { id: 'I2', x0: -8, x1: -2, z0: 50, z1: 58, y: 0, fenced: false },
    { id: 'F', x0: -8, x1: -2, z0: 62.5, z1: 78, y: 0, fenced: false },
    { id: 'S', x0: 13.5, x1: 19.5, z0: 35, z1: 45, y: 0, fenced: false }, // the secret islet
    // Stairs: three small islands rising 1.1 m each lead from the start island's west side up to the high road, so the pad is a
    // shortcut, not the only way up (every area must be reachable on foot).
    { id: 'T1', x0: -17, x1: -13.5, z0: 1, z1: 5, y: 1.1, fenced: false },
    { id: 'T2', x0: -17, x1: -13.5, z0: 7.5, z1: 11.5, y: 2.2, fenced: false },
    { id: 'T3', x0: -17, x1: -13.5, z0: 14, z1: 18, y: 3.3, fenced: false },
    // Lower islands (4 m down): drop onto them from the start island, collect what is there, and come back up on the pads.
    { id: 'L1', x0: -24.8, x1: -14, z0: -6, z1: 4, y: -4, fenced: false },
    { id: 'L2', x0: 10, x1: 20, z0: -14, z1: -4, y: -3.5, fenced: false },
    // Visit islands: the generated ruin and arch islands as places to go. V1 (the ruin) is a long pad flight west of the lower island
    // L1; V2 (the arch) is a long pad flight east of the start island. Each has lanterns and a pad back.
    visit('V1', 'island_a', -34, -3, 2.2, -2),
    visit('V2', 'island_a', 19, 10, 1.6, 3),
    // Two more, one jump further out: the ruin island (V3, east of V2) and the arch island (V4, west of V1), each a double jump from its neighbour.
    visit('V3', 'island_b', 35.3, 4, 2.8, 3),
    visit('V4', 'island_c', -57, -2, 2.6, -1),
  ],
  // Regions (radius `r`): the last one Kai stands in is his respawn point, whichever route he is on.
  checkpoints: [
    { x: 0, z: -3, r: 6 },
    { x: 0, z: 38, r: 5 }, // C
    { x: 0, z: 58, r: 3.5 }, // D
    { x: -9.7, z: 28.5, r: 3 }, // H2
    { x: -5, z: 54, r: 3 }, // I2
    { x: 0, z: 88, r: 4 }, // G
    { x: 16.5, z: 40, r: 3 }, // the secret islet
    { x: -32, z: -3, r: 4 }, // V1
    { x: 20, z: 10, r: 3.5 }, // V2
    { x: 32, z: 10, r: 2.5 }, // V3
    { x: -49, z: -2, r: 3 }, // V4 (the low plateau facing V1)
  ],
  // The pad (a spring) at the west of the start island launches Kai up and carries him forward (+Z) onto the high road, however he stepped on.
  springs: [
    { x: -9.7, z: 9.5, r: 1.3, boost: 18, h: 0.62, dir: { x: 0, z: 1 }, carry: 7 }, // up to the high road
    { x: -17.5, z: -1, y: -4, r: 1.3, boost: 16, h: 0.62, dir: { x: 1, z: 0 }, carry: 7 }, // L1 back up to the start island
    { x: 11.5, z: -6, y: -3.5, r: 1.3, boost: 15.5, h: 0.62, dir: { x: -1, z: 0 }, carry: 7 }, // L2 back up to the start island
    { x: -23.8, z: -4, y: -4, r: 1.3, boost: 21, h: 0.62, dir: { x: -1, z: 0 }, carry: 7 }, // L1 across to the ruin island V1 (a high arc: airtime sets the distance, since a held direction caps the speed at 7 m/s)
    { x: -28, z: -0.5, y: -2, r: 1.1, boost: 13, h: 0.62, dir: { x: 1, z: 0 }, carry: 7 }, // V1 back to the lower island L1 (on the east side, away from where the flight in lands)
    { x: 7.2, z: 10, r: 1.3, boost: 18, h: 0.62, dir: { x: 1, z: 0 }, carry: 10 }, // the start island across to the arch island V2
    { x: 17.5, z: 10, y: 3, r: 1.3, boost: 16, h: 0.62, dir: { x: -1, z: 0 }, carry: 7 }, // V2 back to the start island
  ],
  coins: [
    // start island
    { x: 0, y: 1.0, z: 2 },
    { x: 3, y: 1.0, z: 5 },
    { x: -3, y: 1.0, z: 5 },
    { x: -9.7, y: 7.0, z: 13.2 }, // over the pad's arc: the launch collects it
    // centre route
    { x: 0, y: 1.0, z: 18 },
    { x: 0, y: 1.0, z: 22 },
    { x: 0, y: 1.0, z: 26 },
    { x: -2, y: 1.0, z: 36 },
    { x: 2, y: 1.0, z: 40 },
    { x: 0, y: 3.6, z: 49.5 }, // high arc over the 7 m gap: a double jump collects it
    { x: -1.5, y: 1.0, z: 56 },
    { x: 1.5, y: 1.0, z: 60 },
    { x: 0, y: 1.0, z: 70 },
    { x: 0, y: 1.0, z: 74 },
    { x: 0, y: 1.0, z: 77 },
    // west high road
    { x: -9.7, y: 5.0, z: 18.5 },
    { x: -9.7, y: 5.5, z: 28.5 },
    { x: -9.7, y: 6.0, z: 40 },
    { x: -5, y: 1.0, z: 54 },
    { x: -5, y: 1.0, z: 68 },
    { x: -5, y: 1.0, z: 74 },
    // the secret islet
    { x: 15, y: 1.0, z: 37 },
    { x: 17, y: 1.0, z: 37 },
    { x: 16, y: 1.0, z: 40 },
    { x: 15, y: 1.0, z: 43 },
    { x: 17.5, y: 1.0, z: 43 },
    { x: 16, y: 2.4, z: 40 },
    // the lower islands
    { x: -21, y: -3.0, z: -2 },
    { x: -19, y: -3.0, z: 2 },
    { x: 14, y: -2.5, z: -10 },
    { x: 17, y: -2.5, z: -7 },
    // the visit islands: a cluster of lanterns on each
    { x: -35, y: -1.0, z: -4 },
    { x: -33, y: -1.0, z: -2 },
    { x: -31, y: -1.0, z: 0 },
    { x: -35, y: -1.0, z: 0 },
    { x: -30, y: -1.0, z: -4.5 },
    { x: -32, y: 0.4, z: -2 },
    { x: 18, y: 4.0, z: 9 },
    { x: 20, y: 4.0, z: 12 },
    { x: 22, y: 4.0, z: 9 },
    { x: 22.5, y: 4.0, z: 10 },
    { x: 21, y: 5.2, z: 10 },
    // the ruin island V3 and the arch island V4
    { x: 30, y: 4.0, z: 8.7 },
    { x: 32, y: 4.0, z: 10 },
    { x: 34, y: 4.0, z: 8.7 },
    { x: 33, y: 4.0, z: 11.5 },
    { x: 31, y: 4.0, z: 11.3 },
    { x: -49.5, y: 0.0, z: 0.5 },
    { x: -48.5, y: 0.0, z: -2 },
    { x: -49.5, y: 0.0, z: -4.5 },
    { x: -50.5, y: 0.0, z: -1 },
    { x: -57, y: 0.0, z: -2.5 }, // the summit: climb the mound for it
    // the stairs
    { x: -15.2, y: 2.1, z: 3 },
    { x: -15.2, y: 3.2, z: 9.5 },
    { x: -15.2, y: 4.3, z: 16 },
    // goal island
    { x: -3, y: 1.0, z: 86 },
    { x: 3, y: 1.0, z: 90 },
    { x: 0, y: 1.0, z: 94 },
  ],
  marker: { x: -9.7, y: 9.0, z: 9.5 }, // the blue marker hangs over the pad, as it does over the launch pad in the footage
  goal: { x: 0, z: 92, r: 3 },
  // Routes the scripted player follows in the tests (`dj: false` = no double jump here: it would overshoot).
  routes: {
    centre: [
      { x: 0, z: 12 },
      { x: 0, z: 31 },
      { x: 0, z: 40 },
      { x: 0, z: 58 },
      { x: 0, z: 72 },
      { x: 0, z: 92, r: 2 },
    ],
    west: [
      { x: -9.7, z: 8, dj: false },
      { x: -9.7, z: 18.5, dj: false },
      { x: -9.7, z: 28.5, dj: false },
      { x: -9.7, z: 40, dj: false },
      { x: -5, z: 54, dj: false },
      { x: -5, z: 70, dj: false },
      { x: 0, z: 92, r: 2 },
    ],
    // Up the stairs to the high road on foot (no pad), then along the high road as the west route does.
    stairs: [
      { x: -15.2, z: 3, dj: false },
      { x: -15.2, z: 9.5, dj: false },
      { x: -15.2, z: 16, dj: false },
      { x: -9.7, z: 18.5, dj: false },
      { x: -9.7, z: 28.5, dj: false },
      { x: -9.7, z: 40, dj: false },
      { x: -5, z: 54, dj: false },
      { x: -5, z: 70, dj: false },
      { x: 0, z: 92, r: 2 },
    ],
    // Down to the west lower island, back up on its pad, then the centre route.
    lower: [
      { x: -20, z: -2, dj: false },
      { x: -17.5, z: -1, r: 1.3, dj: false },
      { x: -6, z: 3, dj: false },
      { x: 0, z: 12 },
      { x: 0, z: 31 },
      { x: 0, z: 40 },
      { x: 0, z: 58 },
      { x: 0, z: 72 },
      { x: 0, z: 92, r: 2 },
    ],
    // Down to the lower island, across to the ruin island V1, round its lanterns and back, then the centre route.
    ruin: [
      { x: -20, z: -2, dj: false },
      { x: -23.8, z: -4, r: 1.3, dj: false },
      { x: -35, z: -3, r: 1.5, dj: false },
      { x: -33, z: 1, r: 1.2, dj: false },
      { x: -28, z: -0.5, r: 1.3, dj: false },
      { x: -17.5, z: -1, r: 1.3, dj: false },
      { x: -6, z: 3, dj: false },
      { x: 0, z: 12 },
      { x: 0, z: 31 },
      { x: 0, z: 40 },
      { x: 0, z: 58 },
      { x: 0, z: 72 },
      { x: 0, z: 92, r: 2 },
    ],
    // Across to the arch island V2 on the pad, a walk round it and back, then the centre route.
    arch: [
      { x: 7.2, z: 10, r: 1.3, dj: false },
      { x: 20, z: 10, r: 1.5, dj: false },
      { x: 17.5, z: 10, r: 1.3, dj: false },
      { x: 0, z: 12 },
      { x: 0, z: 31 },
      { x: 0, z: 40 },
      { x: 0, z: 58 },
      { x: 0, z: 72 },
      { x: 0, z: 92, r: 2 },
    ],
    // Out to the arch island V2, on to the ruin island V3 by a double jump, round it and back, then the centre route.
    ruinisle: [
      { x: 7.2, z: 10, r: 1.3, dj: false },
      { x: 20, z: 10, r: 1.5, dj: false },
      { x: 31, z: 10, r: 1.2 },
      { x: 33.5, z: 8.7, r: 1.0, dj: false },
      { x: 22, z: 10, r: 1.5 },
      { x: 17.5, z: 10, r: 1.3, dj: false },
      { x: 0, z: 12 },
      { x: 0, z: 31 },
      { x: 0, z: 40 },
      { x: 0, z: 58 },
      { x: 0, z: 72 },
      { x: 0, z: 92, r: 2 },
    ],
    // Down to the lower island, across to V1, on to the arch island V4 by a double jump and back, then the centre route.
    archisle: [
      { x: -20, z: -2, dj: false },
      { x: -23.8, z: -4, r: 1.3, dj: false },
      { x: -35, z: -3, r: 1.5, dj: false },
      { x: -50.5, z: 0.3, r: 1.8 },
      { x: -49, z: -3.5, r: 1.0, dj: false },
      { x: -35, z: -3, r: 1.5 },
      { x: -28, z: -0.5, r: 1.3, dj: false },
      { x: -17.5, z: -1, r: 1.3, dj: false },
      { x: -6, z: 3, dj: false },
      { x: 0, z: 12 },
      { x: 0, z: 31 },
      { x: 0, z: 40 },
      { x: 0, z: 58 },
      { x: 0, z: 72 },
      { x: 0, z: 92, r: 2 },
    ],
    secret: [
      { x: 0, z: 12 },
      { x: 0, z: 31 },
      { x: 0, z: 40 },
      { x: 5, z: 40 },
      { x: 15, z: 37, r: 1.0 },
      { x: 17, z: 37, r: 1.0, dj: false },
      { x: 17.5, z: 43, r: 1.0, dj: false },
      { x: 15, z: 43, r: 1.0, dj: false },
      { x: 16, z: 40, r: 1.0, dj: false },
      { x: 5, z: 40 },
      { x: 0, z: 58 },
      { x: 0, z: 72 },
      { x: 0, z: 92, r: 2 },
    ],
  },
};

// Lanterns on a visit island hang above the island's real terrain, not at a flat height: keep each one's height above the ground it was given
// (at least 0.9 m, at most 2.2 m) and move it to the terrain there.
for (const c of COURSE_S1_OPEN.coins) {
  const p = COURSE_S1_OPEN.platforms.find((q) => q.hm && c.x >= q.x0 && c.x <= q.x1 && c.z >= q.z0 && c.z <= q.z1);
  if (!p) continue;
  const h = surfaceY(p, c.x, c.z);
  if (h !== null) c.y = +(h + Math.max(0.9, Math.min(2.2, c.y - p.y))).toFixed(2);
}
