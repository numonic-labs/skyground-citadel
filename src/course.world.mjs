// Skyground Citadel, Level 1 as ONE continuous journey: from the start meadow to the citadel gate (the default level).
//
// Act 1 is the open S1 archipelago unchanged (course.s1o.mjs: three routes, stairs, lower islands, four visit islands). Its goal
// island G is where the road to the citadel begins. Acts 2 to 6 reuse the tested geometry of the single sections (course.s2 to
// course.s6: the same gaps, heights, raft and rail timings), joined end to end so each section's last platform is the next one's
// first, and trimmed where a section repeated a run-up. World: metres, +Y up, the main line runs along +Z at x = 0.
//
//   Act 1  Meadow Isles        z  -8 ..  98   run, jump, double jump, pads, explore
//   Act 2  Skyriver Boardwalk  z  98 .. 159   pad launch, boardwalk with a flyer, sliding raft   (or the dry "sky road" to the east)
//   Act 3  The Golden Swing    z 159 .. 183   grapple and swing down to the lower bank (y -2)
//   Act 4  Lantern Rail        z 183 .. 253   rope bridge, two orbs, the key and its gate, the grind rail
//   Act 5  Bramble Gauntlet    z 253 .. 338   sliding islands, orbs and sprouts
//   Act 6  The Citadel Stair   z 338 .. 416   rising islands, the guardian, the citadel gate (y 4)
//
// `side: true` marks platforms off the main line (the scripted player ignores them when it looks for the next platform).
// Sky gems are the big optional pickups: one per out-of-the-way place. All distances are PROPOSED level data.

import { COURSE_S1_OPEN } from './course.s1o.mjs';
import { surfaceY } from './logic.mjs';

const LOW = -2; // acts 4 and 5 sit 2 m below the meadow (the swing lands lower than it starts)
const sidePlat = (p) => ({ ...p, side: p.id !== 'G' });

const platforms = [
  ...COURSE_S1_OPEN.platforms.map(sidePlat),
  // Act 2
  { id: 'boardwalk', kind: 'deck', x0: -1.5, x1: 1.5, z0: 107, z1: 131, y: 0, fenced: false },
  { id: 'raft', kind: 'deck', x0: -2, x1: 2, z0: 137.5, z1: 144.5, y: 0, fenced: false, move: { axis: 'z', amp: 3, period: 8, phase: -Math.PI / 2 } },
  { id: 'dock', kind: 'deck', x0: -2.5, x1: 2.5, z0: 151, z1: 159, y: 0, fenced: false },
  // Act 2, the dry sky road: a rising chain of small islands east of the boardwalk that comes down onto the dock.
  { id: 'E1', x0: 11, x1: 16, z0: 100, z1: 106, y: 0.8, fenced: false, side: true },
  { id: 'E2', x0: 12, x1: 17, z0: 110.5, z1: 116.5, y: 1.6, fenced: false, side: true },
  { id: 'E3', x0: 11, x1: 16, z0: 122, z1: 128, y: 2.4, fenced: false, side: true },
  { id: 'E4', x0: 6.5, x1: 11.5, z0: 133.5, z1: 139.5, y: 1.6, fenced: false, side: true },
  { id: 'E5', x0: 4, x1: 8, z0: 144, z1: 149, y: 0.8, fenced: false, side: true },
  // Act 3
  { id: 'bank', x0: -5, x1: 5, z0: 170.5, z1: 183, y: LOW, fenced: false },
  // Act 4
  { id: 'bridge', kind: 'bridge', x0: -1.3, x1: 1.3, z0: 183, z1: 195, y: LOW, fenced: true },
  { id: 'islandA', x0: -5, x1: 5, z0: 195, z1: 217, y: LOW, fenced: false },
  { id: 'W4', x0: -12.5, x1: -7.5, z0: 203, z1: 209, y: LOW, fenced: false, side: true }, // a gem islet west of island A
  { id: 'islandB', x0: -5, x1: 5, z0: 237, z1: 253, y: LOW, fenced: false },
  // Act 5
  { id: 'i2', x0: -5, x1: 5, z0: 257, z1: 271, y: LOW, fenced: false },
  { id: 'm1', x0: -2.5, x1: 2.5, z0: 277.5, z1: 281.5, y: LOW, fenced: false, move: { axis: 'z', amp: 3, period: 7, phase: -Math.PI / 2 } },
  { id: 'i3', x0: -5, x1: 5, z0: 288, z1: 305, y: LOW, fenced: false },
  { id: 'E6', x0: 7.5, x1: 11.5, z0: 294, z1: 299, y: LOW, fenced: false, side: true }, // a gem islet east of island 3
  { id: 'm2', x0: -2.5, x1: 2.5, z0: 311.5, z1: 315.5, y: LOW, fenced: false, move: { axis: 'z', amp: 3, period: 6, phase: -Math.PI / 2 } },
  { id: 'i4', x0: -5, x1: 5, z0: 322, z1: 338, y: LOW, fenced: false },
  // Act 6
  { id: 'step1', x0: -5, x1: 5, z0: 340.5, z1: 348.5, y: LOW + 1.2, fenced: false },
  { id: 'step2', x0: -5, x1: 5, z0: 351, z1: 359, y: LOW + 2.4, fenced: false },
  { id: 'step3', x0: -5, x1: 5, z0: 361.5, z1: 369.5, y: LOW + 3.6, fenced: false },
  { id: 'ledge', x0: 7.5, x1: 11, z0: 362, z1: 368, y: LOW + 5.0, fenced: false, side: true }, // a gem ledge beside step 3 (a double jump up)
  { id: 'step4', x0: -5, x1: 5, z0: 372, z1: 380, y: LOW + 4.8, fenced: false },
  { id: 'summit', x0: -5, x1: 5, z0: 382.5, z1: 416, y: LOW + 6, fenced: false },
];

const coins = [
  ...COURSE_S1_OPEN.coins.map((c) => ({ ...c })),
  // Act 2
  { x: 0, y: 6.9, z: 98.5 }, // three along the pad's arc
  { x: 0, y: 9.4, z: 101.6 },
  { x: 0, y: 7.2, z: 104.7 },
  { x: 0, y: 1.0, z: 110 },
  { x: 0, y: 1.0, z: 113.5 },
  { x: 0, y: 1.0, z: 116 },
  { x: 0, y: 2.5, z: 119 }, // over the flyer
  { x: 0, y: 1.0, z: 123 },
  { x: 0, y: 1.0, z: 126.5 },
  { x: 0, y: 1.0, z: 130 },
  { x: 0, y: 1.0, z: 153 },
  { x: -1.2, y: 1.0, z: 156 },
  { x: 1.2, y: 1.0, z: 156 },
  { x: 13.5, y: 1.8, z: 103 },
  { x: 14.5, y: 2.6, z: 113.5 },
  { x: 9, y: 2.6, z: 136.5 },
  // Act 3: along the swing's arc, then on the bank
  { x: 0, y: 1.1, z: 161.5 },
  { x: 0, y: -0.7, z: 164.4 },
  { x: 0, y: -1.1, z: 167.6 },
  { x: 0, y: 0.4, z: 170.3 },
  { x: 0, y: -1.0, z: 175 },
  { x: -1.4, y: -1.0, z: 178 },
  { x: 1.4, y: -1.0, z: 178 },
  { x: 0, y: -1.0, z: 180 },
  // Act 4
  { x: 0, y: -1.0, z: 187 },
  { x: 0, y: -1.0, z: 191 },
  { x: -2, y: -1.0, z: 199 },
  { x: 2, y: -1.0, z: 211 },
  { x: 0, y: 0.0, z: 221 },
  { x: 0, y: -0.3, z: 229 },
  { x: 0, y: -0.6, z: 234 },
  { x: 0, y: -1.0, z: 243 },
  { x: -2, y: -1.0, z: 247 },
  { x: 2, y: -1.0, z: 250 },
  // Act 5
  { x: 0, y: -1.0, z: 260 },
  { x: -2, y: -1.0, z: 266 },
  { x: 0, y: -1.0, z: 279.5 },
  { x: 0, y: -1.0, z: 291 },
  { x: 2, y: -1.0, z: 297 },
  { x: -2, y: -1.0, z: 301 },
  { x: 0, y: -1.0, z: 313.5 },
  { x: 0, y: -1.0, z: 325 },
  { x: 2, y: -1.0, z: 331 },
  { x: -2, y: -1.0, z: 335 },
  // Act 6
  { x: 0, y: 0.2, z: 345 },
  { x: 2, y: 1.4, z: 355 },
  { x: 0, y: 2.6, z: 366 },
  { x: -2, y: 3.8, z: 376 },
  { x: 0, y: 5.0, z: 386 },
  { x: 2, y: 5.0, z: 391 },
  { x: -2, y: 5.0, z: 395 },
  { x: 0, y: 5.0, z: 409.4 },
];

// Sky gems (y on a visit island is a height above its terrain, resolved below).
const gems = [
  { x: 16.5, y: 1.3, z: 41.5 }, // the secret islet
  { x: 33.5, y: 4.3, z: 10 }, // the ruin island V3
  { x: -58.5, y: 0.6, z: -1 }, // the arch island V4, on the mound
  { x: 13.5, y: 3.7, z: 125 }, // the top of the sky road
  { x: -9.6, y: -0.7, z: 207.8 }, // the islet west of island A (with the lantern key)
  { x: 9.5, y: -0.7, z: 296.5 }, // the islet east of island 3
  { x: 9.2, y: 4.3, z: 365 }, // the ledge beside step 3
];

export const COURSE_WORLD = {
  id: 'world',
  killY: -12,
  start: COURSE_S1_OPEN.start,
  platforms,
  // Regions: the last one Kai stands in is his respawn point.
  checkpoints: [
    ...COURSE_S1_OPEN.checkpoints,
    { x: 0, z: 109.5, r: 1.6 }, // the boardwalk
    { x: 0, z: 154.5, r: 2.5 }, // the dock
    { x: 0, z: 174, r: 3 }, // the bank
    { x: 0, z: 198.5, r: 3 }, // island A
    { x: 0, z: 241, r: 3 }, // island B
    { x: 0, z: 258.6, r: 1.5 }, // island 2 (short of the orb)
    { x: 0, z: 290, r: 1.8 }, // island 3 (short of the orb's patrol)
    { x: 0, z: 325.5, r: 3 }, // island 4
    { x: 3.6, z: 352.4, r: 1.3 }, // step 2 (the corner the orb does not reach)
    { x: 0, z: 386, r: 3 }, // the summit
    { x: 13.5, z: 125, r: 2.2 }, // the top of the sky road
  ],
  springs: [
    ...COURSE_S1_OPEN.springs,
    { x: 0, z: 97, r: 1, boost: 19.5, h: 0.62 }, // from the goal island of act 1 across the 9 m gap to the boardwalk
  ],
  // The only creatures that hurt are the brambles, each keeping to the nest it guards; the gust (X) dazes one for a few seconds.
  // The shellback asleep before the citadel gate is woken by landing on its shell; it moves off the key it was lying on.
  enemies: [
    { kind: 'bramble', x: 0, y: LOW + 0.6, z: 263, r: 0.5, ax: 2.2, period: 3, phase: 0 },
    { kind: 'bramble', x: 0, y: LOW + 0.6, z: 294, r: 0.5, az: 2.0, period: 3.4, phase: 0 },
    { kind: 'bramble', x: 0, y: LOW + 0.6, z: 329, r: 0.5, ax: 2.2, period: 3, phase: Math.PI },
    { kind: 'bramble', x: 0, y: LOW + 3.0, z: 355, r: 0.5, ax: 2.2, period: 3, phase: 0 },
    { kind: 'bramble', x: 0, y: LOW + 5.4, z: 376, r: 0.5, ax: 2.2, period: 3, phase: Math.PI },
    { kind: 'bramble', x: 0, y: LOW + 6.6, z: 391, r: 0.5, ax: 2.2, period: 3, phase: 0 },
    { kind: 'guardian', x: 0, y: LOW + 7.0, z: 400, r: 1.0, ax: 2.5, period: 4, phase: 0, stomp: true, drops: 'citadel' },
  ],
  // The creatures that live here (logic.mjs, "Living creatures"). The first group is at home; the second is out of place and
  // waits for the steward: each has a home within reach (the nearest is named).
  creatures: [
    { species: 'hopper', x: 3, z: 2, plat: 'A' },
    { species: 'hopper', x: -4, z: 6, plat: 'A' },
    { species: 'hopper', x: 3, z: 90, plat: 'G' },
    { species: 'hopper', x: -2, z: 199, plat: 'islandA' },
    { species: 'hopper', x: 2.5, z: 209, plat: 'islandA' },
    { species: 'sprout', x: 15, z: 37, plat: 'S' },
    { species: 'sprout', x: 17.5, z: 43, plat: 'S' },
    { species: 'sprout', x: 2, z: 60, plat: 'D' },
    { species: 'dewling', x: -2, z: 43.2, plat: 'C' },
    { species: 'dewling', x: 2.5, z: 43.4, plat: 'C' },
    { species: 'dewling', x: 1, z: 178.3, plat: 'bank' },
    { species: 'hopper', x: -33, z: -2, plat: 'V1' }, // the ruin isle is an old den: a pair of hoppers lives in it
    { species: 'hopper', x: -31, z: 0, plat: 'V1' },
    { species: 'sprout', x: 32, z: 10, plat: 'V3' }, // and a sprout under the far ruin's blossom
    // out of place
    { species: 'dewling', x: -6, z: -4, plat: 'A' }, // a dewling on the dry start lawn: the stream on the next big island
    { species: 'sprout', x: -10, z: 18.5, plat: 'H1' }, // a sprout on the bare high road: blossom on the next ledge
    { species: 'hopper', x: 0.8, z: 112, plat: 'boardwalk' }, // a hopper stuck on the planks: any lawn
    { species: 'sprout', x: 1.5, z: 154, plat: 'dock' }, // a sprout on the dock: the blossom isles
    { species: 'dewling', x: 2, z: 200, plat: 'islandA' }, // a dewling by the gate: back to the bank's stream, or wake the next spring
    { species: 'sprout', x: -3, z: 300, plat: 'i3' }, // a sprout among the brambles: the blossom islet beside it
    { species: 'hopper', x: 2, z: 344, plat: 'step1' }, // a hopper on the bare stair: the lawn below
    { species: 'dewling', x: 3, z: 395, plat: 'summit' }, // a dewling at the top: wake the summit spring
  ],
  // What each island offers. Lawns are meadow; islands with blossom trees are blossom; water is wherever a stream flows.
  habitats: {
    A: ['meadow'], C: ['meadow'], D: ['meadow', 'blossom'], G: ['meadow'], F: ['meadow'], I2: ['meadow'], L1: ['meadow'], L2: ['meadow'],
    S: ['meadow', 'blossom'], H2: ['blossom'], E1: ['meadow'], E2: ['meadow'], E3: ['meadow', 'blossom'], E4: ['meadow'], E5: ['meadow'],
    bank: ['meadow'], islandA: ['meadow'], W4: ['meadow', 'blossom'], islandB: ['meadow', 'blossom'], i2: ['meadow'], i3: ['meadow'],
    E6: ['meadow', 'blossom'], i4: ['meadow'], summit: ['meadow'],
    // The visit islands: the ruins are dens with blossom over them, the arch isles are open lawn.
    V1: ['meadow', 'blossom'], V2: ['meadow'], V3: ['meadow', 'blossom'], V4: ['meadow'],
  },
  // Vine blooms. The islands' vines reach for the steward: press E near a bloom and its vine takes Kai's hand; he swings and lets
  // go with Space. The first is the great bloom over the sky river (the way across in act 3; the scripted player lets go at
  // releaseZ). The rest (`bloom`) hang over the wide gaps, so a player who would rather not wait for a raft or a sliding island
  // can swing across instead.
  anchors: [
    { x: 0, y: 7.8, z: 164.75, range: 13, releaseZ: 170 },
    { x: 0, y: 7.6, z: 49.5, range: 10, bloom: true }, // over the 7 m gap in act 1
    { x: 9.7, y: 7.2, z: 40, range: 10, bloom: true }, // toward the hidden islet
    { x: 0, y: 7.6, z: 136.5, range: 10, bloom: true }, // over the raft's water, first half
    { x: 0, y: 7.6, z: 146, range: 10, bloom: true }, // and second half
    { x: 0, y: LOW + 7.6, z: 279.5, range: 11, bloom: true }, // over the first sliding island's gap
    { x: 0, y: LOW + 7.6, z: 313.5, range: 11, bloom: true }, // over the second
  ],
  rails: [{ x: 0, z0: 216.5, z1: 237, y0: LOW + 3.4, y1: LOW + 2.3, speed: 8 }],
  // The lantern key is not beside its gate: it is on the blossom islet west of island A, a jump through the gap in the fence.
  keys: [{ id: 'lantern', x: -10.5, y: LOW + 0.9, z: 204.6 }],
  // What the scripted player must fetch off the main line.
  errands: [
    {
      id: 'lantern-key',
      fromZ: 200,
      toZ: 214,
      done: (s) => !!s.keysHeld.lantern,
      route: [
        { x: -4.2, z: 206, r: 0.8, dj: false },
        { x: -10.3, z: 204.8, r: 0.9, dj: false },
        { x: -8.2, z: 206.2, r: 0.8, dj: false },
        { x: -3.6, z: 206.6, r: 0.9, dj: false },
        { x: 0, z: 209, r: 1.0, dj: false },
      ],
    },
  ],
  // The islands' vines catch a falling Kai (logic.mjs, "The vine catch").
  vineCatch: true,
  gates: [
    { id: 'lantern', key: 'lantern', z: 215.5, x0: -6.5, x1: 6.5, y: LOW },
    { id: 'citadel', key: 'citadel', z: 408, x0: -6.5, x1: 6.5, y: LOW + 6 },
  ],
  coins,
  gems,
  marker: COURSE_S1_OPEN.marker,
  goal: { x: 0, z: 413, r: 3 },
  // Named areas (by depth), shown as the player enters each.
  areas: [
    { name: 'Meadow Isles', z0: -Infinity, z1: 98 },
    { name: 'Skyriver Boardwalk', z0: 98, z1: 150.5 },
    { name: 'The Golden Swing', z0: 150.5, z1: 183 },
    { name: 'Lantern Rail', z0: 183, z1: 253 },
    { name: 'Bramble Gauntlet', z0: 253, z1: 338 },
    { name: 'The Citadel Stair', z0: 338, z1: Infinity },
  ],
  // Streams: shallow water across an island that pours off one side as a waterfall (`side` 1 = the +x edge). Kai runs through them;
  // they change nothing in the rules, only what he sees and hears (splashes), so they are drawn from here by the renderer.
  streams: [
    { plat: 'C', z0: 42, z1: 44.6, side: 1, spring: { x: -4.6, z: 43.3 } },
    { plat: 'bank', z0: 177, z1: 179.6, side: -1, spring: { x: 3.6, z: 178.3 } },
    { plat: 'islandB', z0: 246, z1: 248.6, side: 1, spring: { x: -3.6, z: 247.3 }, dry: true },
    { plat: 'i4', z0: 334.6, z1: 336.8, side: -1, spring: { x: 3.6, z: 335.7 }, dry: true },
    { plat: 'summit', z0: 388.2, z1: 390.8, side: 1, spring: { x: -3.6, z: 389.5 }, dry: true },
  ],
  // Low fences along island edges (solid: 1 m tall, a jump clears them). Gaps are left where a side islet or a waterfall is.
  walls: [
    { x: 4.6, z0: 196, z1: 214, y: LOW },
    { x: -4.6, z0: 196, z1: 202, y: LOW },
    { x: -4.6, z0: 210, z1: 214, y: LOW },
    { x: -4.6, z0: 238, z1: 252, y: LOW },
    { x: 4.6, z0: 238, z1: 245, y: LOW },
    { x: 4.6, z0: 258, z1: 270, y: LOW },
    { x: -4.6, z0: 258, z1: 270, y: LOW },
    { x: -4.6, z0: 289, z1: 304, y: LOW },
    { x: 4.6, z0: 289, z1: 293, y: LOW },
    { x: 4.6, z0: 300, z1: 304, y: LOW },
    { x: 4.6, z0: 323, z1: 337, y: LOW },
    { x: -4.6, z0: 323, z1: 333, y: LOW },
    { x: -4.6, z0: 392, z1: 414, y: LOW + 6 },
    { x: 4.6, z0: 392, z1: 414, y: LOW + 6 },
  ],
  // Tips shown at the bottom of the screen where a move is first needed (x and w bound the strip; `until` retires a tip).
  tips: [
    { z0: -8, z1: 10, w: 9, text: 'Space to jump, and again in the air · X near a creature picks it up, X again sets it down' },
    { z0: 34, z1: 41.5, w: 6, text: 'The dewling from the start lawn belongs in a stream like this one', until: (s) => s.rehomed > 0 },
    { z0: -8, z1: 4, x: -34, w: 7, text: 'The ruin is an old den: hoppers and sprouts are at home here, and a fed pair will raise a kit' },
    { z0: 4, z1: 16, x: 20, w: 5, text: 'The arch isles are open lawn with a way-crystal: a good place to bring a hopper' },
    { z0: 86, z1: 98, text: 'Run onto the red pad to be thrown across the gap' },
    { z0: 126, z1: 131.5, w: 2, text: 'Wait for the raft, or jump and press E: the vine bloom overhead will take your hand' },
    { z0: 151, z1: 159.5, w: 3, text: 'E near the great bloom: its vine takes your hand · hold forward to swing · Space to let go' },
    { z0: 196, z1: 214, text: 'The gate needs the lantern key: it is on the blossom islet to the west, through the gap in the fence', until: (s) => !!s.keysHeld.lantern },
    { z0: 210, z1: 217.5, text: 'Jump up to the glowing rail · Space jumps off it', until: (s) => !s.keysHeld.lantern },
    { z0: 240, z1: 249, text: 'A dry spring: X at its stone with a sky gem in hand wakes the stream', until: (s) => s.springs[2] },
    { z0: 257, z1: 262, w: 4, text: 'Brambles guard their nests: keep clear, or X sends a gust that dazes one' },
    { z0: 384, z1: 402, text: 'The shellback is asleep on the citadel key: land ON its shell to wake it', until: (s) => !!s.keysHeld.citadel },
  ],
  // The sky river: soft-edged water under the boardwalk, raft, dock and swing.
  water: [{ x: 0, z: 150, w: 64, d: 96, y: -4.2 }],
  // Where the scripted player hands over from following an act 1 route to running the main line.
  routes: {
    ...COURSE_S1_OPEN.routes,
    // The dry sky road of act 2 (after the centre route of act 1), down onto the dock.
    skyroad: [
      ...COURSE_S1_OPEN.routes.centre.slice(0, -1),
      { x: 6.5, z: 96, r: 1.2 },
      { x: 13.5, z: 103, r: 1.2 },
      { x: 14.5, z: 113.5, r: 1.2 },
      { x: 13.5, z: 125, r: 1.2 },
      { x: 9, z: 136.5, r: 1.2 },
      { x: 6, z: 146.5, r: 1.0 },
      { x: 0, z: 155, r: 1.2 },
    ],
  },
};

// Checkpoints are way-crystals: Kai can travel between neighbouring ones he has reached, for a coin. Their names, in order.
const CHECKPOINT_NAMES = [
  'Start meadow', 'Stream isle', 'Blossom isle', 'High road', 'West isle', 'Launch isle', 'Hidden islet', 'Ruin isle', 'Arch isle',
  'Far ruin', 'Far arch', 'Boardwalk', 'Dock', 'River bank', 'Gate isle', 'Rail end', 'Bramble isle', 'Nest isle', 'Stair foot',
  'Second step', 'Summit', 'Sky road',
];
COURSE_WORLD.checkpoints = COURSE_WORLD.checkpoints.map((c, i) => ({ ...c, name: CHECKPOINT_NAMES[i] || `Crystal ${i + 1}` }));

// Pickups on a visit island hang above its real terrain (as in course.s1o.mjs).
for (const c of COURSE_WORLD.gems) {
  const p = COURSE_WORLD.platforms.find((q) => q.hm && c.x >= q.x0 && c.x <= q.x1 && c.z >= q.z0 && c.z <= q.z1);
  if (!p) continue;
  const h = surfaceY(p, c.x, c.z);
  if (h !== null) c.y = +(h + Math.max(0.9, Math.min(2.2, c.y - p.y))).toFixed(2);
}
