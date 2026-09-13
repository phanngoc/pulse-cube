import './style.css';
import { Game } from './game/game';
import { LEVELS } from './game/levels';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const game = new Game({
  canvas: el<HTMLCanvasElement>('scene'),
  overlay: el('overlay'),
  overlayTitle: el('overlay-title'),
  overlayBody: el('overlay-body'),
  overlayAction: el<HTMLButtonElement>('overlay-action'),
  levelButtons: [...document.querySelectorAll<HTMLButtonElement>('button.level')],
  modeButtons: [...document.querySelectorAll<HTMLButtonElement>('button.mode')],
  progressFill: el('progress-fill'),
  progressText: el('progress-text'),
  best: el('best'),
  attempts: el('attempts'),
  levelName: el('level-name'),
  pauseBtn: el<HTMLButtonElement>('pause-btn'),
  muteBtn: el<HTMLButtonElement>('mute-btn'),
  motionBtn: el<HTMLButtonElement>('motion-btn'),
});

// Exposed so the Playwright smoke test can inspect real simulation state
// instead of guessing from pixels.
declare global {
  interface Window {
    pulseCube: Game;
    /** Level data, so the smoke test can assert against the real geometry
     *  instead of hard-coding coordinates that drift when a level is edited. */
    __levels: typeof LEVELS;
  }
}
window.pulseCube = game;
window.__levels = LEVELS;
