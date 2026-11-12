// Skyground Citadel, Level 1, section S1 ("Explore and first jumps", design bible beats 1 and the start of 2).
// World: metres, +Y up, the course runs along +Z. Kai starts near z=2 facing +Z.
// Camera sits behind Kai, so screen-right is world -X (see logic.mjs input mapping).
//
// Everything here is PROPOSED level data, not read from the source clip: the clip shows a fenced path
// toward floating islands, a coin and a blue pylon, but not exact distances. See the design bible
// (the design bible, kept in the project archive) sections 5, 6 and 10.
//
// Difficulty ramp (after the first human playtest, 2026-11-03, where the playtester asked to keep a real chance of falling):
//   gap 1 (4 m)   : one jump, forgiving, behind a long fenced run-up
//   gap 2 (4.5 m) : one jump
//   gap 3 (7 m)   : needs a DOUBLE jump (single-jump reach is about 5.2 m, double-jump reach about 8.6 m)
//   plank (2.2 m wide, no rails): drifting sideways falls

export const COURSE = {
  id: 's1',
  killY: -8,
  start: { x: 0, z: 2 },
  // Walkable top surfaces (axis-aligned boxes). `fenced` platforms keep Kai inside the rails.
  platforms: [
    { id: 'P0', x0: -2.2, x1: 2.2, z0: -4, z1: 22, y: 0, fenced: true },
    { id: 'P1', x0: -2.2, x1: 2.2, z0: 26, z1: 42, y: 0, fenced: true },
    { id: 'P2', x0: -3.5, x1: 3.5, z0: 46.5, z1: 58, y: 0, fenced: false },
    { id: 'P3', x0: -1.1, x1: 1.1, z0: 65, z1: 80, y: 0, fenced: false }, // the plank
  ],
  // Respawn points (a fall returns Kai to the last one reached).
  checkpoints: [
    { x: 0, z: 2 },
    { x: 0, z: 27.5 },
    { x: 0, z: 48 },
    { x: 0, z: 66.5 },
  ],
  coins: [
    { x: 0, y: 1.0, z: 6 },
    { x: 0, y: 1.0, z: 10 },
    { x: 0, y: 1.0, z: 14 },
    { x: 0, y: 1.0, z: 18 },
    { x: 0, y: 2.4, z: 24 },
    { x: 0, y: 1.0, z: 30 },
    { x: 0, y: 1.0, z: 34 },
    { x: 0, y: 1.0, z: 38 },
    { x: 0, y: 2.4, z: 44.2 },
    { x: -1.5, y: 1.0, z: 51 },
    { x: 1.5, y: 1.0, z: 54 },
    { x: -1.5, y: 1.0, z: 57 },
    { x: 0, y: 3.6, z: 61.5 }, // high arc over gap 3: a double jump collects it
    { x: 0, y: 1.0, z: 68 },
    { x: 0, y: 1.0, z: 71 },
    { x: 0, y: 1.0, z: 74 },
    { x: 0, y: 1.0, z: 77 },
  ],
  goal: { z: 78 },
};
