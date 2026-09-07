/** The whole simulation. No DOM, no canvas, no timers, no audio - every rule
 *  below is a pure function of state and a delta, which is what lets the unit
 *  tests play entire levels headless. */
import {
  CAMERA_ANCHOR,
  COYOTE,
  CUBE,
  GRAVITY,
  JUMP_BUFFER,
  JUMP_V,
  MAX_VIEW_W,
  MIN_VIEW_W,
  PAD_V,
  PIT_Y,
  SPEED,
  VIEW_H,
} from './config';
import { LEVELS } from './levels';
import type { Entity, GameState, Level, Mode, Player } from './types';

/** Collision runs on fixed slices. At 10.4 cubes/second a 50ms frame moves the
 *  cube half its own width, which is enough to clip the corner of a spike or
 *  skip a landing entirely; slicing to ~4ms makes every contact a real overlap
 *  rather than a lucky sample. */
const FIXED_DT = 1 / 240;

/** Spikes are drawn as full triangles but tested as a narrower box. A pixel
 *  perfect triangle is unfair at this speed - the player reads the tip, not
 *  the base - so the hitbox is inset to match what the eye expects. */
const SPIKE_INSET_X = 0.28;
const SPIKE_TOP_TRIM = 0.2;
/** The cube is forgiving by the same argument. */
const CUBE_INSET = 0.08;

export const levelCount = (): number => LEVELS.length;
export const levelAt = (index: number): Level => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))];

export function viewWidthFor(canvasW: number, canvasH: number): number {
  if (canvasH <= 0) return MIN_VIEW_W;
  const w = VIEW_H * (canvasW / canvasH);
  return Math.max(MIN_VIEW_W, Math.min(MAX_VIEW_W, w));
}

/**
 * Camera size in world units. The width is clamped so the road ahead is
 * neither a keyhole nor a distant strip; the height is then DERIVED from the
 * real aspect ratio rather than fixed, because fixing both axes independently
 * stretches the pixels and a stretched cube is a rectangle.
 */
export function viewSizeFor(canvasW: number, canvasH: number): { viewW: number; viewH: number } {
  const viewW = viewWidthFor(canvasW, canvasH);
  const aspect = canvasH > 0 ? canvasW / canvasH : 1;
  return { viewW, viewH: aspect > 0 ? viewW / aspect : VIEW_H };
}

const top = (e: Entity): number => e.y + e.h;
const right = (e: Entity): number => e.x + e.w;

/** Highest solid surface at this x, or null over a pit. */
export function surfaceAt(level: Level, x: number): number | null {
  let best: number | null = null;
  for (const e of level.entities) {
    if (e.kind !== 'block') continue;
    if (x < e.x || x > right(e)) continue;
    const t = top(e);
    if (best === null || t > best) best = t;
  }
  return best;
}

function makePlayer(level: Level, x: number): Player {
  const surface = surfaceAt(level, x + CUBE / 2);
  return { x, y: surface ?? 0, vy: 0, grounded: surface !== null, angle: 0 };
}

export function createState(levelIndex = 0, mode: Mode = 'normal'): GameState {
  const level = levelAt(levelIndex);
  return {
    phase: 'menu',
    mode,
    levelIndex,
    player: makePlayer(level, 0),
    particles: [],
    time: 0,
    attempts: 0,
    progress: 0,
    runBest: 0,
    checkpoint: -1,
    deathCause: null,
    jumpHeld: false,
    jumpBuffer: 0,
    shake: 0,
    viewW: 24,
    viewH: VIEW_H,
  };
}

/** Start a level from the beginning. Attempt count and session best survive. */
export function startLevel(state: GameState, levelIndex: number, mode: Mode): void {
  state.levelIndex = levelIndex;
  state.mode = mode;
  state.phase = 'playing';
  state.player = makePlayer(levelAt(levelIndex), 0);
  state.particles = [];
  state.time = 0;
  state.attempts = 1;
  state.progress = 0;
  state.runBest = 0;
  state.checkpoint = -1;
  state.deathCause = null;
  state.jumpBuffer = 0;
  state.jumpHeld = false;
  state.shake = 0;
}

/**
 * Put the player back after a death. In practice mode that is the last
 * checkpoint passed; in normal mode it is always the start of the level.
 * Checkpoints are deliberately not carried into normal mode - that is the
 * whole difference between the two.
 */
export function respawn(state: GameState): void {
  const level = levelAt(state.levelIndex);
  const useCheckpoint = state.mode === 'practice' && state.checkpoint >= 0;
  const x = useCheckpoint ? level.checkpoints[state.checkpoint] : 0;
  if (!useCheckpoint) state.checkpoint = -1;
  state.player = makePlayer(level, x);
  state.particles = [];
  state.phase = 'playing';
  state.deathCause = null;
  state.jumpBuffer = 0;
  state.attempts += 1;
  state.progress = x / level.length;
  state.shake = 0;
  // Level time follows the player so the beat stays locked to the geometry.
  state.time = x / SPEED;
}

export function pressJump(state: GameState): void {
  state.jumpHeld = true;
  if (state.phase === 'playing') state.jumpBuffer = JUMP_BUFFER;
}

export function releaseJump(state: GameState): void {
  state.jumpHeld = false;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Solid geometry is tested against the exact cube. Insetting here would leave
 *  a sliver of air under the cube that it can never close at the speed gravity
 *  builds in one slice, so it would fall through its own floor. */
function cubeBox(p: Player): Box {
  return { x0: p.x, y0: p.y, x1: p.x + CUBE, y1: p.y + CUBE };
}

/** Hazards are tested against a slightly smaller cube - see SPIKE_INSET_X. */
function hazardBox(p: Player): Box {
  return {
    x0: p.x + CUBE_INSET,
    y0: p.y + CUBE_INSET,
    x1: p.x + CUBE - CUBE_INSET,
    y1: p.y + CUBE - CUBE_INSET,
  };
}

function overlaps(
  b: Box,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  return b.x0 < x1 && b.x1 > x0 && b.y0 < y1 && b.y1 > y0;
}

function die(state: GameState, cause: NonNullable<GameState['deathCause']>): void {
  state.phase = 'dead';
  state.deathCause = cause;
  state.shake = 1;
  const p = state.player;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const sp = 4 + (i % 5) * 2.4;
    state.particles.push({
      x: p.x + CUBE / 2,
      y: p.y + CUBE / 2,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + 4,
      life: 0.8,
      maxLife: 0.8,
      size: 0.1 + (i % 4) * 0.06,
      color: i % 3 === 0 ? '#ffe066' : '#67e8f9',
    });
  }
}

/** One fixed slice. Split out so `step` can run as many as the frame needs. */
function tick(state: GameState, dt: number, coyote: { t: number }): void {
  const level = levelAt(state.levelIndex);
  const p = state.player;

  if (state.jumpBuffer > 0) state.jumpBuffer -= dt;

  // Input first, using last slice's grounded flag - a press is allowed to land
  // slightly early (buffer) or slightly late off a ledge (coyote).
  if (state.jumpBuffer > 0 && (p.grounded || coyote.t < COYOTE)) {
    p.vy = JUMP_V;
    p.grounded = false;
    state.jumpBuffer = 0;
    coyote.t = COYOTE;
  }

  p.x += SPEED * dt;
  p.vy -= GRAVITY * dt;
  const prevY = p.y;
  p.y += p.vy * dt;

  const wasGrounded = p.grounded;
  p.grounded = false;
  const box = cubeBox(p);
  const hurt = hazardBox(p);

  for (const e of level.entities) {
    // Cheap reject: nothing far ahead or behind can matter this slice.
    if (right(e) < box.x0 || e.x > box.x1) continue;

    if (e.kind === 'block') {
      if (!overlaps(box, e.x, e.y, right(e), top(e))) continue;
      // Landing is "was above the surface and moving down". Anything else is
      // running into a wall or clouting the underside, which is fatal.
      if (p.vy <= 0 && prevY >= top(e) - 0.06) {
        p.y = top(e);
        p.vy = 0;
        p.grounded = true;
        continue;
      }
      die(state, 'wall');
      return;
    }

    if (e.kind === 'spike') {
      const sx0 = e.x + SPIKE_INSET_X;
      const sx1 = right(e) - SPIKE_INSET_X;
      if (overlaps(hurt, sx0, e.y, sx1, top(e) - SPIKE_TOP_TRIM)) {
        die(state, 'spike');
        return;
      }
      continue;
    }

    if (e.kind === 'pad') {
      if (overlaps(box, e.x, e.y, right(e), top(e) + 0.3)) {
        p.vy = PAD_V;
        p.grounded = false;
      }
    }
  }

  coyote.t = p.grounded ? 0 : coyote.t + dt;
  if (p.grounded) {
    // Snap the spin to a right angle so the cube always lands square.
    p.angle = Math.round(p.angle / (Math.PI / 2)) * (Math.PI / 2);
  } else {
    p.angle += (SPEED / 2.6) * dt;
  }
  void wasGrounded;

  if (p.y < PIT_Y) {
    die(state, 'pit');
    return;
  }

  state.time += dt;
  state.progress = Math.max(state.progress, Math.min(1, p.x / level.length));
  state.runBest = Math.max(state.runBest, state.progress);

  // Checkpoints are ordered, so only the next one can be reached.
  const next = state.checkpoint + 1;
  if (next < level.checkpoints.length && p.x >= level.checkpoints[next]) {
    state.checkpoint = next;
  }

  if (p.x >= level.length) {
    state.phase = 'cleared';
    state.progress = 1;
    state.runBest = 1;
  }
}

export function step(state: GameState, dt: number): void {
  if (state.phase !== 'playing') {
    // Death particles keep moving so the explosion plays out under the overlay.
    stepParticles(state, Math.min(dt, 1 / 20));
    state.shake = Math.max(0, state.shake - dt * 3);
    return;
  }
  const clamped = Math.min(dt, 1 / 20); // never integrate a whole tab-switch
  const coyote = { t: state.player.grounded ? 0 : COYOTE };
  let remaining = clamped;
  while (remaining > 1e-9 && state.phase === 'playing') {
    const slice = Math.min(FIXED_DT, remaining);
    tick(state, slice, coyote);
    remaining -= slice;
  }
  stepParticles(state, clamped);
  state.shake = Math.max(0, state.shake - clamped * 3);
}

function stepParticles(state: GameState, dt: number): void {
  for (const q of state.particles) {
    q.vy -= GRAVITY * 0.25 * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.life -= dt;
  }
  state.particles = state.particles.filter((q) => q.life > 0);
}

/** Left edge of the camera in world units. */
export function cameraX(state: GameState): number {
  return state.player.x - state.viewW * CAMERA_ANCHOR;
}

/** Beat index at the current level time - the renderer pulses on this and the
 *  audio schedules against it, so picture and sound cannot drift apart. */
export function beatAt(level: Level, time: number): number {
  return time * (level.bpm / 60);
}
