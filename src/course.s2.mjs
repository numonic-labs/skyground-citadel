// Skyground Citadel, Level 1, section S2. World: metres, +Y up, the course runs along +Z (same conventions as course.mjs).
//
// WHAT THE SOURCE FOOTAGE SHOWS (checked by contact sheet, 10 to 30 s of the 30 s opening traversal, 2026-11-07):
//   about 10 to 16 s: a wide grass plateau with tall grass, a waterfall on the right and a wooden bridge branching left;
//   about 18 to 24 s: a side-view wooden boardwalk with a blue flying creature, lantern pickups and a river below;
//   about 22 to 24 s: a wooden dock over the river ending at a golden post.
// The footage has NO spring pad and no moving platform. The design bible's beat 2 ("spring and floating platforms, avoid
// enemies") comes from the reference sheet text, so S2 adds the sheet's spring pad (to cross the plateau's edge) and makes
// the dock approach a sliding raft, while keeping the plateau, boardwalk, flyer, river and golden post from the footage.
// The grapple shown at 26 to 30 s belongs to S3. All distances here are PROPOSED level data, not read from the clip.
//
// Difficulty (single-jump reach about 5.2 m, double-jump about 8.6 m):
//   gap 1 (9 m)  : cannot be crossed even with a double jump; the spring pad launches about 11.4 m (apex about 7.9 m)
//   boardwalk    : 3 m wide, no rails; a low blue flyer sweeps across it (contact costs a heart, 3 hearts); jump over it
//   river        : a raft slides along z between two gaps; step on when it is near, ride, jump off when the dock is near

export const COURSE_S2 = {
  id: 's2',
  killY: -8,
  start: { x: 0, z: 2 },
  platforms: [
    { id: 'plateau', x0: -6, x1: 6, z0: -4, z1: 30, y: 0, fenced: false },
    { id: 'boardwalk', x0: -1.5, x1: 1.5, z0: 39, z1: 72, y: 0, fenced: false },
    // The raft slides along z: bounds are base + amp * sin(2 pi t / period + phase). At t=0 it sits at its near end
    // (z0 = 75.5, gap 3.5 m from the boardwalk); at its far end its far edge is 3.5 m from the dock.
    { id: 'raft', x0: -2, x1: 2, z0: 78.5, z1: 85.5, y: 0, fenced: false, move: { axis: 'z', amp: 3, period: 8, phase: -Math.PI / 2 } },
    { id: 'dock', x0: -2.5, x1: 2.5, z0: 92, z1: 100, y: 0, fenced: false },
  ],
  checkpoints: [
    { x: 0, z: 2 },
    { x: 0, z: 40.5 },
    { x: 0, z: 93.5 },
  ],
  // Spring pads: standing on one launches Kai upward.
  // Entering the pad's edge (z 28.0) launches; airtime 1.625 s at run speed is 11.4 m, so a plain straight run lands on the
  // boardwalk (z 39) with 0.4 m to spare, while a jump alone (reach 8.6 m) cannot cross the 9 m gap.
  springs: [{ x: 0, z: 29, r: 1, boost: 19.5, h: 0.62 }], // h: cushion height; Kai steps up onto it
  // Flying enemies patrol a line: position = base + a * sin(2 pi t / period + phase). Low enough to jump over.
  enemies: [{ id: 'flyer1', x: 0, y: 0.8, z: 56, ax: 1.4, az: 0, period: 3.4, phase: 0, r: 0.5 }],
  coins: [
    { x: 0, y: 1.0, z: 6 },
    { x: 2, y: 1.0, z: 10 },
    { x: -2, y: 1.0, z: 14 },
    { x: 0, y: 1.0, z: 18 },
    { x: 0, y: 1.0, z: 22 },
    { x: 0, y: 7.0, z: 34 }, // high arc over the first gap: the spring collects it
    { x: 0, y: 1.0, z: 43 },
    { x: 0, y: 1.0, z: 47 },
    { x: 0, y: 1.0, z: 51 },
    { x: 0, y: 2.5, z: 56 }, // above the flyer's patrol line, collected by jumping over it
    { x: 0, y: 1.0, z: 62 },
    { x: 0, y: 1.0, z: 66 },
    { x: 0, y: 1.0, z: 70 },
    { x: 0, y: 1.0, z: 95 },
    { x: -1.2, y: 1.0, z: 97 },
    { x: 1.2, y: 1.0, z: 97 },
  ],
  goal: { z: 98 },
};
