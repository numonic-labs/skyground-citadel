// Skyground Citadel, Level 1, section S3: the grapple beat. World: metres, +Y up, the course runs along +Z (the side-view
// camera used from the boardwalk onward is used throughout S3; screen right is world +Z).
//
// WHAT THE SOURCE FOOTAGE SHOWS (24 to 30 s of the 30 s opening traversal, contact sheet checked 2026-11-07): Kai stands at the
// end of the wooden dock beside a golden post, fires a golden grapple, swings on a golden rope over a wide river (a splash of
// water under him in one frame), and lands on a grassy bank on the far side beside a second golden post, with a lantern and
// tall grass. The reference sheet's beat 3 text is "Grapple to anchors, swing over waterfall".
//
// WHAT IS BUILT (PROPOSED level data, not read from the clip): a free pendulum (the playtester's choice, 2026-11-07). Press the grapple
// key near the anchor to attach (a short yank lifts Kai off the dock), swing on the rope under gravity, hold forward to pump
// the swing, and release with jump to fly onto the far bank. Without pumping the swing never reaches the bank; a release too
// early drops into the river; one too late swings back. There is a real chance of falling.
//
// TUNING (measured with tools/probe_s3*.mjs, 2026-11-07): from the dock's edge the pendulum reaches the height of the dock
// only at the top of its arc, so a bank at dock height leaves a release window of about 1.5 m of travel (0.3 s). The far
// bank is therefore 2 m LOWER than the dock (the footage shows both at roughly the same level, so this is a deviation made
// for playability): the swing then passes over the bank edge while still moving forward, giving a window of about 4.5 m of
// travel (0.7 to 0.9 s), release at z >= about 9.5 to 13.5.

export const COURSE_S3 = {
  id: 's3',
  killY: -8,
  start: { x: 0, z: -3 },
  platforms: [
    { id: 'dock', x0: -2.5, x1: 2.5, z0: -8, z1: 0, y: 0, fenced: false },
    { id: 'bank', x0: -5, x1: 5, z0: 11.5, z1: 24, y: -2, fenced: false },
  ],
  checkpoints: [
    { x: 0, z: -3 },
    { x: 0, z: 14 },
  ],
  // Grapple anchors: a golden hook point Kai can attach to within `range` metres.
  anchors: [{ x: 0, y: 7.8, z: 5.75, range: 13 }],
  // Pickups on the swing's arc (chest height) and on the bank.
  coins: [
    { x: 0, y: 1.0, z: -6 },
    { x: 0, y: 1.1, z: 2.5 },
    { x: 0, y: -0.7, z: 5.4 },
    { x: 0, y: -1.1, z: 8.6 },
    { x: 0, y: 0.4, z: 11.3 },
    { x: 0, y: -1.0, z: 16 },
    { x: -1.4, y: -1.0, z: 19 },
    { x: 1.4, y: -1.0, z: 19 },
    { x: 0, y: -1.0, z: 21 },
  ],
  goal: { z: 22 },
};
