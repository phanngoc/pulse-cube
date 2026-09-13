/** The shell: canvas, loop, HUD, overlay, level and mode selection. All rules
 *  live in logic.ts; this file only translates between it and the page. */
import { SPEED } from './config';
import { Sfx } from './audio';
import { InputState } from './input';
import {
  beatAt,
  createState,
  levelAt,
  levelCount,
  pressJump,
  releaseJump,
  respawn,
  startLevel,
  step,
  viewSizeFor,
} from './logic';
import { Renderer } from './render';
import { loadBest, loadMuted, loadReducedMotion, saveBest, saveMuted, saveReducedMotion } from './storage';
import type { GameState, Mode, Phase } from './types';

export interface GameElements {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  overlayTitle: HTMLElement;
  overlayBody: HTMLElement;
  overlayAction: HTMLButtonElement;
  levelButtons: HTMLButtonElement[];
  modeButtons: HTMLButtonElement[];
  progressFill: HTMLElement;
  progressText: HTMLElement;
  best: HTMLElement;
  attempts: HTMLElement;
  levelName: HTMLElement;
  pauseBtn: HTMLButtonElement;
  muteBtn: HTMLButtonElement;
  motionBtn: HTMLButtonElement;
}

const pct = (v: number): string => `${Math.floor(v * 100)}%`;

export class Game {
  readonly state: GameState;
  private renderer: Renderer;
  private sfx = new Sfx();
  private input: InputState;
  private raf = 0;
  private last = 0;
  private best = 0;
  private wasGrounded = true;
  private lastCheckpoint = -1;

  constructor(private el: GameElements) {
    this.state = createState(0, 'normal');
    this.renderer = new Renderer(el.canvas);
    this.sfx.setMuted(loadMuted());
    this.el.muteBtn.textContent = this.sfx.muted ? 'Sound off' : 'Sound on';
    this.renderer.reducedMotion = loadReducedMotion();
    this.applyMotionLabel();

    this.input = new InputState(el.canvas, {
      press: () => this.onPress(),
      release: () => releaseJump(this.state),
      togglePause: () => this.togglePause(),
      toggleMute: () => this.toggleMute(),
    });

    el.overlayAction.addEventListener('click', () => this.confirm());
    el.pauseBtn.addEventListener('click', () => this.togglePause());
    el.muteBtn.addEventListener('click', () => this.toggleMute());
    el.motionBtn.addEventListener('click', () => this.toggleMotion());
    for (const b of el.levelButtons) {
      b.addEventListener('click', () => this.selectLevel(Number(b.dataset.level)));
    }
    for (const b of el.modeButtons) {
      b.addEventListener('click', () => this.selectMode(b.dataset.mode as Mode));
    }

    window.addEventListener('resize', () => this.layout());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state.phase === 'playing') this.togglePause();
    });

    this.layout();
    this.selectLevel(0);
    this.selectMode('normal');
    this.showMenu();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private layout(): void {
    const { cssW, cssH } = this.renderer.resize();
    const { viewW, viewH } = viewSizeFor(cssW, cssH);
    this.state.viewW = viewW;
    this.state.viewH = viewH;
  }

  /** Widening read - see the call site in `frame`. */
  private phase(): Phase {
    return this.state.phase;
  }

  private onPress(): void {
    if (this.state.phase === 'playing') {
      pressJump(this.state);
      if (this.state.player.grounded) this.sfx.jump();
      return;
    }
    // Anywhere else the button is "continue", so one finger drives everything.
    this.confirm();
  }

  private selectLevel(index: number): void {
    if (this.state.phase === 'playing') return;
    this.state.levelIndex = Math.max(0, Math.min(levelCount() - 1, index));
    const level = levelAt(this.state.levelIndex);
    this.best = loadBest(level.id);
    for (const b of this.el.levelButtons) {
      const on = Number(b.dataset.level) === this.state.levelIndex;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.el.levelName.textContent = `${level.id}. ${level.name}`;
    if (this.state.phase === 'menu') this.showMenu();
    this.syncHud();
  }

  private selectMode(mode: Mode): void {
    if (this.state.phase === 'playing') return;
    this.state.mode = mode;
    for (const b of this.el.modeButtons) {
      const on = b.dataset.mode === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    if (this.state.phase === 'menu') this.showMenu();
    this.syncHud();
  }

  private showMenu(): void {
    const level = levelAt(this.state.levelIndex);
    const practice = this.state.mode === 'practice';
    this.el.overlayTitle.textContent = 'Pulse Cube';
    this.el.overlayBody.innerHTML = `
      <p>The cube runs on its own. You have <strong>one button</strong>: jump.
      Click, tap, or press <strong>Space</strong>. Hold it to jump again the
      instant you land.</p>
      <p>Spikes and the sides of ledges are fatal. Yellow pads fling you higher
      than any jump can reach. The bar at the top is how far through
      <strong>${level.name}</strong> you are.</p>
      <p>${
        practice
          ? '<strong>Practice:</strong> dying puts you back at the last checkpoint flag. Nothing is saved to your best.'
          : '<strong>Normal:</strong> one life. Dying restarts the level, and your furthest run is saved.'
      }</p>
      <p class="keys">P / Esc pause · M mute</p>`;
    this.el.overlayAction.textContent = practice ? `Practise ${level.name}` : `Run ${level.name}`;
    this.el.overlay.classList.remove('hidden', 'no-picker');
  }

  private confirm(): void {
    const phase = this.phase();
    if (phase === 'playing') return;
    if (phase === 'paused') {
      this.resume();
      return;
    }
    if (phase === 'dead' && this.state.mode === 'practice') {
      // Practice deaths continue the same attempt chain from the checkpoint.
      respawn(this.state);
      this.afterStart();
      return;
    }
    startLevel(this.state, this.state.levelIndex, this.state.mode);
    this.afterStart();
  }

  private afterStart(): void {
    const level = levelAt(this.state.levelIndex);
    this.input.reset();
    this.wasGrounded = this.state.player.grounded;
    this.lastCheckpoint = this.state.checkpoint;
    this.el.overlay.classList.add('hidden');
    this.el.pauseBtn.textContent = 'Pause';
    this.sfx.startMusic(level.bpm, beatAt(level, this.state.time));
    this.last = performance.now();
    this.syncHud();
  }

  private togglePause(): void {
    if (this.state.phase === 'playing') {
      this.state.phase = 'paused';
      this.input.reset();
      releaseJump(this.state);
      this.sfx.stopMusic();
      this.el.pauseBtn.textContent = 'Resume';
      this.el.overlayTitle.textContent = 'Paused';
      this.el.overlayBody.innerHTML = `<p>${pct(this.state.progress)} through ${
        levelAt(this.state.levelIndex).name
      }.</p>`;
      this.el.overlayAction.textContent = 'Resume';
      // Changing level mid-run would throw the run away, so the picker goes.
      this.el.overlay.classList.remove('hidden');
      this.el.overlay.classList.add('no-picker');
    } else if (this.state.phase === 'paused') {
      this.resume();
    }
  }

  private resume(): void {
    const level = levelAt(this.state.levelIndex);
    this.state.phase = 'playing';
    this.el.pauseBtn.textContent = 'Pause';
    this.el.overlay.classList.add('hidden');
    this.sfx.startMusic(level.bpm, beatAt(level, this.state.time));
    this.last = performance.now();
  }

  /** Cosmetic switch only - it changes what is drawn, never what is
   *  simulated, so a best set with effects off is the same run either way. */
  private toggleMotion(): void {
    const next = !this.renderer.reducedMotion;
    this.renderer.reducedMotion = next;
    saveReducedMotion(next);
    this.applyMotionLabel();
  }

  private applyMotionLabel(): void {
    const on = this.renderer.reducedMotion;
    this.el.motionBtn.textContent = on ? 'Effects low' : 'Effects on';
    this.el.motionBtn.setAttribute('aria-pressed', String(on));
  }

  private toggleMute(): void {
    const next = !this.sfx.muted;
    this.sfx.setMuted(next);
    saveMuted(next);
    this.el.muteBtn.textContent = next ? 'Sound off' : 'Sound on';
    this.el.muteBtn.setAttribute('aria-pressed', String(next));
    if (!next && this.state.phase === 'playing') {
      const level = levelAt(this.state.levelIndex);
      this.sfx.startMusic(level.bpm, beatAt(level, this.state.time));
    }
  }

  private onDeath(): void {
    const level = levelAt(this.state.levelIndex);
    this.input.reset();
    this.sfx.die();
    // Only a normal-mode run earns a best: practice starts from a checkpoint,
    // so its progress is not comparable.
    if (this.state.mode === 'normal' && this.state.progress > this.best) {
      this.best = this.state.progress;
      saveBest(level.id, this.best);
    }
    const why =
      this.state.deathCause === 'spike'
        ? 'A spike got you.'
        : this.state.deathCause === 'pit'
          ? 'Into the gap.'
          : 'Straight into a wall.';
    const practice = this.state.mode === 'practice';
    this.el.overlayTitle.textContent = `${pct(this.state.progress)}`;
    this.el.overlayBody.innerHTML = `
      <p>${why}</p>
      <p>Attempt <strong>${this.state.attempts}</strong> · Best run this session
      <strong>${pct(this.state.runBest)}</strong>${
        practice ? '' : ` · All-time <strong>${pct(this.best)}</strong>`
      }</p>
      <p class="keys">${
        practice
          ? this.state.checkpoint >= 0
            ? 'Restarting from your last checkpoint flag.'
            : 'No checkpoint reached yet - restarting from the beginning.'
          : 'Normal mode: back to the start.'
      }</p>`;
    this.el.overlayAction.textContent = practice ? 'Continue' : 'Try again';
    this.el.overlay.classList.remove('hidden', 'no-picker');
    this.el.pauseBtn.textContent = 'Pause';
    this.syncHud();
  }

  private onCleared(): void {
    const level = levelAt(this.state.levelIndex);
    this.input.reset();
    this.sfx.clear();
    if (this.state.mode === 'normal') {
      this.best = 1;
      saveBest(level.id, 1);
    }
    const next = this.state.levelIndex + 1;
    this.el.overlayTitle.textContent = `${level.name} complete`;
    this.el.overlayBody.innerHTML = `
      <p class="big">100%<span>${this.state.mode === 'practice' ? 'practice run' : 'clean run'}</span></p>
      <p>${this.state.attempts} attempt${this.state.attempts === 1 ? '' : 's'}.${
        next < levelCount() ? ` Next up: ${levelAt(next).name}.` : ' That was the last level.'
      }</p>`;
    this.el.overlayAction.textContent = 'Play again';
    this.el.overlay.classList.remove('hidden', 'no-picker');
    if (next < levelCount()) this.selectLevel(next);
    this.syncHud();
  }

  private syncHud(): void {
    const p = this.state.progress;
    this.el.progressFill.style.width = pct(p);
    this.el.progressText.textContent = pct(p);
    this.el.best.textContent = pct(this.best);
    this.el.attempts.textContent = String(this.state.attempts);
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;

    if (this.state.phase === 'playing') {
      step(this.state, dt);
      const p = this.state.player;
      if (p.grounded && !this.wasGrounded) this.sfx.land();
      this.wasGrounded = p.grounded;
      if (this.state.checkpoint > this.lastCheckpoint) {
        this.lastCheckpoint = this.state.checkpoint;
        if (this.state.mode === 'practice') this.sfx.checkpoint();
      }
      // Read through a call so TypeScript drops the pre-step narrowing.
      const after = this.phase();
      if (after === 'dead') this.onDeath();
      else if (after === 'cleared') this.onCleared();
      this.syncHud();
    } else {
      step(this.state, dt); // keeps the death debris moving under the overlay
    }

    this.renderer.draw(this.state);
  };

  /** Test hook: jump straight to a position in the current level. */
  seekTo(x: number): void {
    const level = levelAt(this.state.levelIndex);
    this.state.player.x = x;
    this.state.time = x / SPEED;
    this.state.progress = Math.min(1, x / level.length);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.sfx.stopMusic();
  }
}
