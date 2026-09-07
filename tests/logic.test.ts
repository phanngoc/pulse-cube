import { describe, expect, it } from 'vitest';
import {
  beatAt,
  cameraX,
  createState,
  levelAt,
  levelCount,
  pressJump,
  releaseJump,
  respawn,
  startLevel,
  step,
  surfaceAt,
  viewSizeFor,
  viewWidthFor,
} from '../src/game/logic';
import { LEVELS } from '../src/game/levels';
import {
  COYOTE,
  GRAVITY,
  JUMP_V,
  MAX_VIEW_W,
  MIN_VIEW_W,
  PIT_Y,
  SPEED,
  VIEW_H,
} from '../src/game/config';
import type { GameState, Mode } from '../src/game/types';

const FRAME = 1 / 120;
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

function run(levelIndex: number, mode: Mode = 'normal'): GameState {
  const s = createState(levelIndex, mode);
  startLevel(s, levelIndex, mode);
  return s;
}

/** Advance without touching the jump button. */
function idle(s: GameState, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += FRAME) step(s, FRAME);
}

/**
 * A lookahead bot: at every grounded moment, simulate the next `horizon`
 * seconds doing nothing. If that dies and jumping does not, jump. It is not
 * clever - which is the point. If a dumb one-button bot can clear a level,
 * the level is beatable by hand; if it cannot, the geometry is broken.
 */
function botPlay(s: GameState, horizon = 0.75, limitSeconds = 90): { cleared: boolean; jumps: number } {
  let jumps = 0;
  for (let t = 0; t < limitSeconds; t += FRAME) {
    if (s.phase !== 'playing') break;
    if (s.player.grounded) {
      const idleFuture = clone(s);
      idle(idleFuture, horizon);
      if (idleFuture.phase === 'dead') {
        const jumpFuture = clone(s);
        pressJump(jumpFuture);
        idle(jumpFuture, horizon);
        releaseJump(jumpFuture);
        if (jumpFuture.phase !== 'dead') {
          pressJump(s);
          releaseJump(s);
          jumps += 1;
        }
      }
    }
    step(s, FRAME);
  }
  return { cleared: s.phase === 'cleared', jumps };
}

describe('level design', () => {
  it('ships three levels of increasing length and tempo', () => {
    expect(levelCount()).toBe(3);
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].length).toBeGreaterThan(LEVELS[i - 1].length);
      expect(LEVELS[i].bpm).toBeGreaterThan(LEVELS[i - 1].bpm);
    }
  });

  it('starts every level on solid ground with no obstacle in the first run-up', () => {
    for (const level of LEVELS) {
      expect(surfaceAt(level, 0.5)).not.toBeNull();
      const early = level.entities.filter((e) => e.kind !== 'block' && e.x < 12);
      expect(early).toEqual([]);
    }
  });

  it('orders checkpoints and keeps them on reachable ground', () => {
    for (const level of LEVELS) {
      expect(level.checkpoints.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < level.checkpoints.length; i++) {
        expect(level.checkpoints[i]).toBeGreaterThan(level.checkpoints[i - 1]);
      }
      for (const cp of level.checkpoints) {
        expect(cp).toBeGreaterThan(0);
        expect(cp).toBeLessThan(level.length);
        expect(surfaceAt(level, cp + 0.5)).not.toBeNull();
      }
    }
  });

  it.each(LEVELS.map((l, i) => [i, l.name] as const))(
    'level %i (%s) is beatable by a one-button lookahead bot',
    (index) => {
      const s = run(index);
      const { cleared, jumps } = botPlay(s);
      expect({ index, cleared, phase: s.phase, progress: Number(s.progress.toFixed(3)) }).toEqual({
        index,
        cleared: true,
        phase: 'cleared',
        progress: 1,
      });
      // A level nobody has to jump in is not a level.
      expect(jumps).toBeGreaterThan(5);
    },
  );

  it('gets harder: later levels demand more jumps per cube travelled', () => {
    const density = LEVELS.map((l, i) => botPlay(run(i)).jumps / l.length);
    expect(density[1]).toBeGreaterThan(density[0]);
    expect(density[2]).toBeGreaterThan(density[1]);
  });
});

describe('jumping', () => {
  it('leaves the ground at the configured speed and comes back down', () => {
    const s = run(0);
    pressJump(s);
    step(s, FRAME);
    expect(s.player.grounded).toBe(false);
    expect(s.player.vy).toBeGreaterThan(JUMP_V - GRAVITY * FRAME - 1e-6);
    let peak = s.player.y;
    for (let i = 0; i < 200 && !s.player.grounded; i++) {
      step(s, FRAME);
      peak = Math.max(peak, s.player.y);
    }
    expect(s.player.grounded).toBe(true);
    // The 2.6-cube arc every level is designed against.
    expect(peak).toBeGreaterThan(2.3);
    expect(peak).toBeLessThan(3.0);
  });

  it('cannot double jump in the air', () => {
    const s = run(0);
    pressJump(s);
    step(s, FRAME * 4);
    const vyBefore = s.player.vy;
    pressJump(s);
    step(s, FRAME);
    expect(s.player.vy).toBeLessThan(vyBefore);
    expect(s.player.grounded).toBe(false);
  });

  it('buffers a press made just before landing', () => {
    const s = run(0);
    pressJump(s);
    releaseJump(s);
    // Fly until just about to touch down, then press again mid-air.
    while (!s.player.grounded) step(s, FRAME);
    const landed = clone(s);
    // Reproduce: press one frame before touchdown on a fresh copy.
    const s2 = clone(landed);
    s2.player.grounded = false;
    s2.player.y = 0.05;
    s2.player.vy = -6;
    pressJump(s2);
    step(s2, FRAME);
    step(s2, FRAME);
    expect(s2.player.vy).toBeGreaterThan(0);
  });

  it('allows a jump inside the coyote window after leaving a ledge', () => {
    const s = run(0);
    s.player.grounded = false;
    s.player.vy = -0.2;
    pressJump(s);
    step(s, Math.min(COYOTE / 2, FRAME));
    expect(s.player.vy).toBeGreaterThan(0);
  });

  it('ignores presses that are not in the playing phase', () => {
    const s = run(0);
    s.phase = 'paused';
    pressJump(s);
    expect(s.jumpBuffer).toBe(0);
  });
});

describe('death', () => {
  it('dies on a spike', () => {
    const s = run(0);
    const spikeX = LEVELS[0].entities.find((e) => e.kind === 'spike')!.x;
    idle(s, (spikeX - 2) / SPEED);
    expect(s.phase).toBe('playing');
    idle(s, 4 / SPEED);
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('spike');
  });

  it('dies running into the side of a platform', () => {
    const s = run(0);
    // Platforms are thin ledges: at floor level the cube passes underneath
    // them, which is deliberate. Clouting the SIDE of one mid-jump is fatal.
    const wall = LEVELS[0].entities.find((e) => e.kind === 'block' && e.y > 0)!;
    s.player.x = wall.x - 0.3;
    s.player.y = wall.y + 0.2; // inside the ledge's vertical band
    s.player.vy = 0;
    s.player.grounded = false;
    step(s, FRAME);
    expect(s.deathCause).toBe('wall');
    expect(s.phase).toBe('dead');
  });

  it('lets the cube run underneath a raised ledge instead of hitting it', () => {
    const s = run(0);
    const ledge = LEVELS[0].entities.find((e) => e.kind === 'block' && e.y > 0)!;
    s.player.x = ledge.x - 4;
    s.player.y = 0;
    s.player.vy = 0;
    s.player.grounded = true;
    idle(s, 0.6);
    expect(s.player.x).toBeGreaterThan(ledge.x + 1);
    expect(s.phase).toBe('playing');
  });

  it('dies falling into a pit', () => {
    const s = run(1);
    s.player.x = 5;
    s.player.y = 2;
    s.player.grounded = false;
    s.player.vy = 0;
    // Delete the floor under it so there is nothing to land on.
    s.levelIndex = 1;
    const level = levelAt(1);
    const kept = level.entities.filter((e) => !(e.kind === 'block' && e.x < 20));
    (level as { entities: unknown }).entities = kept;
    idle(s, 2);
    expect(s.deathCause).toBe('pit');
    expect(s.player.y).toBeLessThan(PIT_Y + 1);
    (level as { entities: unknown }).entities = level.entities;
  });

  it('spawns debris and shakes the camera on death', () => {
    const s = run(0);
    // Stop AT the death, not seconds past it - the debris only lives 0.8s.
    for (let i = 0; i < 2000 && s.phase === 'playing'; i++) step(s, FRAME);
    expect(s.phase).toBe('dead');
    expect(s.particles.length).toBeGreaterThan(10);
    expect(s.shake).toBeGreaterThan(0);
  });

  it('freezes forward motion once dead', () => {
    const s = run(0);
    idle(s, 30 / SPEED);
    const x = s.player.x;
    idle(s, 1);
    expect(s.player.x).toBe(x);
  });
});

describe('checkpoints and modes', () => {
  it('records checkpoints in order as they are passed', () => {
    const s = run(0, 'practice');
    expect(s.checkpoint).toBe(-1);
    botPlay(s);
    expect(s.checkpoint).toBe(LEVELS[0].checkpoints.length - 1);
  });

  it('respawns at the last checkpoint in practice mode', () => {
    const s = run(0, 'practice');
    s.player.x = 85;
    s.checkpoint = 1; // checkpoint at x=80
    s.phase = 'dead';
    respawn(s);
    expect(s.player.x).toBe(LEVELS[0].checkpoints[1]);
    expect(s.phase).toBe('playing');
    expect(s.player.grounded).toBe(true);
    expect(s.attempts).toBe(2);
  });

  it('respawns at the start in normal mode even after passing checkpoints', () => {
    const s = run(0, 'normal');
    s.player.x = 85;
    s.checkpoint = 1;
    s.phase = 'dead';
    respawn(s);
    expect(s.player.x).toBe(0);
    expect(s.checkpoint).toBe(-1);
  });

  it('keeps the beat locked to position when respawning', () => {
    const s = run(0, 'practice');
    s.checkpoint = 2;
    s.phase = 'dead';
    respawn(s);
    expect(s.time).toBeCloseTo(LEVELS[0].checkpoints[2] / SPEED, 6);
  });

  it('counts attempts across a chain of deaths', () => {
    const s = run(0, 'practice');
    expect(s.attempts).toBe(1);
    for (let i = 0; i < 3; i++) {
      s.phase = 'dead';
      respawn(s);
    }
    expect(s.attempts).toBe(4);
  });

  it('restarting the level resets everything but keeps the mode', () => {
    const s = run(0, 'practice');
    idle(s, 2);
    s.checkpoint = 2;
    s.attempts = 9;
    startLevel(s, 0, 'practice');
    expect(s.attempts).toBe(1);
    expect(s.checkpoint).toBe(-1);
    expect(s.progress).toBe(0);
    expect(s.time).toBe(0);
    expect(s.particles).toEqual([]);
    expect(s.player.x).toBe(0);
    expect(s.mode).toBe('practice');
    expect(s.phase).toBe('playing');
  });
});

describe('progress and clearing', () => {
  it('reports progress as a fraction of the level and never goes backwards', () => {
    const s = run(0);
    idle(s, 1);
    const a = s.progress;
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(a).toBeCloseTo(s.player.x / LEVELS[0].length, 5);
    s.phase = 'dead';
    respawn(s);
    expect(s.progress).toBeLessThanOrEqual(a); // fresh life restarts the bar
    expect(s.runBest).toBeGreaterThanOrEqual(a); // session best is kept
  });

  it('clears the level at the finish line', () => {
    const s = run(0);
    const { cleared } = botPlay(s);
    expect(cleared).toBe(true);
    expect(s.progress).toBe(1);
    expect(s.player.x).toBeGreaterThanOrEqual(LEVELS[0].length);
  });
});

describe('view and beat', () => {
  it('keeps the camera width inside the playable clamp on any aspect', () => {
    expect(viewWidthFor(1920, 1080)).toBeCloseTo(VIEW_H * (1920 / 1080));
    expect(viewWidthFor(390, 844)).toBe(MIN_VIEW_W);
    expect(viewWidthFor(5120, 1080)).toBe(MAX_VIEW_W);
    expect(viewWidthFor(100, 0)).toBe(MIN_VIEW_W);
  });

  it('derives the camera height so the scale stays uniform - a cube stays square', () => {
    for (const [w, h] of [[1920, 1080], [390, 844], [5120, 1080], [800, 800]]) {
      const { viewW, viewH } = viewSizeFor(w, h);
      // Pixels-per-unit must match on both axes, or the cube is a rectangle.
      expect(w / viewW).toBeCloseTo(h / viewH, 6);
    }
    // A landscape desktop still gets the height the levels were designed for.
    expect(viewSizeFor(1920, 1080).viewH).toBeCloseTo(VIEW_H, 6);
    // A tall phone trades extra sky for a square cube, never a stretched one.
    expect(viewSizeFor(390, 844).viewH).toBeGreaterThan(VIEW_H);
  });

  it('anchors the camera so most of the screen is the road ahead', () => {
    const s = run(0);
    s.viewW = 24;
    s.player.x = 100;
    const left = cameraX(s);
    expect(s.player.x - left).toBeCloseTo(24 * 0.3, 6);
    expect(left + s.viewW - s.player.x).toBeGreaterThan(s.player.x - left);
  });

  it('derives the beat from level time and tempo', () => {
    expect(beatAt(LEVELS[0], 0)).toBe(0);
    expect(beatAt(LEVELS[0], 60)).toBeCloseTo(LEVELS[0].bpm, 6);
  });

  it('clamps a huge frame delta so a backgrounded tab cannot teleport the cube', () => {
    const s = run(0);
    const x = s.player.x;
    step(s, 10);
    expect(s.player.x - x).toBeCloseTo(SPEED / 20, 4);
  });
});
