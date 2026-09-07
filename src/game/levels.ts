/** Three hand-built levels.
 *
 *  Everything is placed against the real jump arc from config.ts, which is
 *  worth stating in numbers because every decision below follows from it:
 *    peak height   2.60 cubes      (JUMP_V^2 / 2g)
 *    air time      0.405 s
 *    ground cover  4.21 cubes      (SPEED * air time)
 *    pad peak      4.42 cubes, 5.48 cubes of cover
 *  So: platform tops sit at 2 (reachable from the floor) and 4 (reachable from
 *  a platform at 2); floor gaps stay at or under 3 cubes, and only a pad is
 *  ever asked to clear more. `tests/logic.test.ts` re-checks all of this and
 *  then plays each level with a bot, so a bad number here fails the suite. */
import type { Entity, Level } from './types';

/** A floor run from x to x+w, with 4 cubes of body below so it reads as solid. */
const ground = (x: number, w: number): Entity => ({ kind: 'block', x, y: -4, w, h: 4 });
/** A platform whose TOP is at y. */
const plat = (x: number, w: number, y: number): Entity => ({ kind: 'block', x, y: y - 0.7, w, h: 0.7 });
const spike = (x: number, y = 0): Entity => ({ kind: 'spike', x, y, w: 1, h: 1 });
const spikes = (x: number, n: number, y = 0): Entity[] =>
  Array.from({ length: n }, (_, i) => spike(x + i, y));
const pad = (x: number, y = 0): Entity => ({ kind: 'pad', x, y, w: 1, h: 0.35 });

/** Level 1 - one obstacle at a time, always with a long clear run-up. There is
 *  no place here that needs two jumps back to back. */
const LEVEL_1: Level = {
  id: 1,
  name: 'First Light',
  bpm: 128,
  length: 186,
  checkpoints: [40, 78, 116, 154],
  entities: [
    ground(-10, 82),      // floor to 72
    spike(22),
    spike(36),
    spike(50),
    ...spikes(63, 2),
    ground(74.6, 66),     // 2.6-cube gap, then floor to 140.6
    plat(90, 9, 2),       // first thing you land on that is not the floor
    spike(110),
    ...spikes(124, 2),
    ground(143.2, 55),    // 2.6-cube gap, floor to 198.2
    plat(155, 9, 2),
    spike(172),
    spike(182),
  ],
};

/** Level 2 - gaps and platforms in the same breath, spike pairs, and the first
 *  two-tier climb. Nothing is unfair, but the slack is gone. */
const LEVEL_2: Level = {
  id: 2,
  name: 'Split Signal',
  bpm: 140,
  length: 224,
  checkpoints: [44, 88, 130, 178],
  entities: [
    ground(-10, 56),      // floor to 46
    ...spikes(18, 2),
    spike(30),
    ...spikes(40, 2),
    ground(48.8, 44),     // 2.8 gap, floor to 92.8
    plat(58, 7, 2),
    ...spikes(72, 2),
    plat(82, 7, 2),
    ground(95.6, 46),     // 2.8 gap, floor to 141.6
    ...spikes(104, 3),
    plat(116, 6, 2),
    plat(124, 6, 4),      // two-tier climb
    ground(144.4, 40),    // 2.8 gap, floor to 184.4
    ...spikes(152, 2),
    spike(164),
    ...spikes(174, 2),
    pad(186),             // the pad is the only way across the long gap
    ground(190.4, 44),
    ...spikes(200, 2),
    spike(214),
  ],
};

/** Level 3 - triple spikes, back-to-back climbs, and pads over gaps no plain
 *  jump can reach. Everything is still inside the arc; almost nothing has
 *  slack left over. */
const LEVEL_3: Level = {
  id: 3,
  name: 'Overdrive',
  bpm: 152,
  length: 262,
  checkpoints: [38, 80, 120, 160, 220],
  entities: [
    ground(-10, 52),      // floor to 42
    ...spikes(16, 2),
    ...spikes(27, 3),
    ground(44.8, 40),     // 2.8 gap, floor to 84.8
    ...spikes(52, 3),
    plat(64, 6, 2),
    plat(72, 6, 4),
    ground(87.6, 38),     // floor to 125.6
    ...spikes(94, 3),
    ...spikes(106, 2),
    plat(116, 6, 2),
    ground(128.4, 42),    // floor to 170.4
    ...spikes(136, 3),
    spike(148),
    ...spikes(157, 2),
    pad(166),
    ground(171.5, 40),
    ...spikes(180, 3),
    plat(192, 5, 2),
    ...spikes(198, 2, 2),  // spikes standing ON the platform
    plat(200, 5, 2),
    ground(214.3, 36),
    ...spikes(222, 3),
    ...spikes(234, 2),
    pad(244),
    ground(249.5, 30),
    ...spikes(256, 3),
  ],
};

export const LEVELS: readonly Level[] = [LEVEL_1, LEVEL_2, LEVEL_3];
