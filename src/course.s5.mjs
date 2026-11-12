// Skyground Citadel, Level 1, section S5: the enemy gauntlet. World: metres, +Y up, the course runs along +Z (side-view camera).
//
// WHAT THE SOURCE FOOTAGE SHOWS (40 to 62 s of the 62 s cut, contact sheet checked 2026-11-08): Kai hops a chain of floating grass
// islands separated by gaps, each with lanterns, fences and pink trees; a big blue leafy orb (the same enemy as S4) patrols the
// islands, and small green sprout creatures with leaf antennae sit on rocks. There are NO moving platforms in the footage; they come
// from the reference sheet's beat 5 text ("navigate moving platforms with multiple enemy types") and are added as the raft was in S2.
// The spring (S2) and rail (S4) are not repeated here, so S5 combines run, jump, double jump, moving platforms and dodging two
// enemy types. All distances are PROPOSED level data, not read from the clip.
//
// Difficulty (single-jump reach about 5.2 m): gaps 1 and 2 are single jumps; the two wide gaps are crossed on sliding platforms
// that you step onto when they are near (the second is faster); every island has an enemy on the path, and the last two have two.

export const COURSE_S5 = {
  id: 's5',
  killY: -8,
  start: { x: 0, z: -3 },
  platforms: [
    { id: 'i1', x0: -5, x1: 5, z0: -6, z1: 12, y: 0, fenced: false },
    { id: 'i2', x0: -5, x1: 5, z0: 16, z1: 30, y: 0, fenced: false },
    // Sliding slab 1: bounds are base + amp * sin(2 pi t / period + phase). At t=0 it sits at its near end, 3.5 m from island 2.
    { id: 'm1', x0: -2.5, x1: 2.5, z0: 36.5, z1: 40.5, y: 0, fenced: false, move: { axis: 'z', amp: 3, period: 7, phase: -Math.PI / 2 } },
    { id: 'i3', x0: -5, x1: 5, z0: 47, z1: 64, y: 0, fenced: false },
    // Sliding slab 2 (faster): near end 3.5 m from island 3, far end 3.5 m from island 4.
    { id: 'm2', x0: -2.5, x1: 2.5, z0: 70.5, z1: 74.5, y: 0, fenced: false, move: { axis: 'z', amp: 3, period: 6, phase: -Math.PI / 2 } },
    { id: 'i4', x0: -5, x1: 5, z0: 81, z1: 100, y: 0, fenced: false },
  ],
  checkpoints: [
    { x: 0, z: -3 },
    { x: 0, z: 18 },
    { x: 0, z: 49 },
    { x: 0, z: 83 },
  ],
  // Two enemy types. `kind: 'orb'` is big (r 0.5) and patrols slowly; `kind: 'sprout'` is small (r 0.3), low and quick.
  enemies: [
    { kind: 'orb', x: 0, y: 0.6, z: 22, r: 0.5, ax: 2.2, period: 3, phase: 0 },
    { kind: 'sprout', x: 0, y: 0.3, z: 27, r: 0.3, ax: 2.0, period: 1.8, phase: 0 },
    { kind: 'orb', x: 0, y: 0.6, z: 53, r: 0.5, az: 2.0, period: 3.4, phase: 0 },
    { kind: 'sprout', x: 0, y: 0.3, z: 58, r: 0.3, ax: 2.0, period: 1.8, phase: Math.PI },
    { kind: 'sprout', x: 0, y: 0.3, z: 61.5, r: 0.3, ax: 2.0, period: 1.8, phase: 0 },
    { kind: 'orb', x: 0, y: 0.6, z: 88, r: 0.5, ax: 2.2, period: 3, phase: Math.PI },
    { kind: 'sprout', x: 0, y: 0.3, z: 92, r: 0.3, ax: 2.0, period: 1.8, phase: 0 },
    { kind: 'sprout', x: 0, y: 0.3, z: 95.5, r: 0.3, ax: 2.0, period: 1.8, phase: Math.PI },
  ],
  coins: [
    { x: 0, y: 1.0, z: -2 },
    { x: -1.5, y: 1.0, z: 4 },
    { x: 1.5, y: 1.0, z: 9 },
    { x: 0, y: 1.0, z: 19 },
    { x: -2, y: 1.0, z: 25 },
    { x: 0, y: 1.0, z: 38 },
    { x: 0, y: 1.0, z: 50 },
    { x: 2, y: 1.0, z: 56 },
    { x: -2, y: 1.0, z: 60 },
    { x: 0, y: 1.0, z: 72.5 },
    { x: 0, y: 1.0, z: 84 },
    { x: 2, y: 1.0, z: 90 },
    { x: -2, y: 1.0, z: 94 },
    { x: 0, y: 1.0, z: 97 },
  ],
  goal: { z: 98 },
};
