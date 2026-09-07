export type Phase = 'menu' | 'playing' | 'paused' | 'dead' | 'cleared';

/** `normal` restarts the level from the start on death and is the only mode
 *  that writes a best score. `practice` respawns at the last checkpoint. */
export type Mode = 'normal' | 'practice';

/** Every piece of level geometry. Solid `block`s can be landed on; everything
 *  else is either lethal or a trigger. */
export type EntityKind = 'block' | 'spike' | 'pad' | 'orb';

export interface Entity {
  kind: EntityKind;
  /** Left edge / bottom edge in world units. One unit is one cube. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Level {
  readonly id: number;
  readonly name: string;
  /** Beats per minute of the generated backing track. The level's spacing is
   *  laid out against this, which is what makes the run feel on-beat. */
  readonly bpm: number;
  readonly length: number;
  readonly entities: readonly Entity[];
  /** World x positions where practice mode can respawn you. */
  readonly checkpoints: readonly number[];
}

export interface Player {
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  /** Visual only - the cube spins in the air and snaps square on landing. */
  angle: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface GameState {
  phase: Phase;
  mode: Mode;
  levelIndex: number;
  player: Player;
  particles: Particle[];

  /** Seconds of level time elapsed - drives the beat and the visuals. */
  time: number;
  attempts: number;
  /** 0..1 of the level completed on this life. */
  progress: number;
  /** 0..1 best reached this session on this attempt chain. */
  runBest: number;
  /** Index into the level's checkpoints, -1 before the first one. */
  checkpoint: number;
  /** Set when the player dies so the overlay can say what hit them. */
  deathCause: 'spike' | 'wall' | 'pit' | null;

  jumpHeld: boolean;
  /** Grace window so a press slightly before landing still jumps. */
  jumpBuffer: number;
  shake: number;
  viewW: number;
  viewH: number;
}
