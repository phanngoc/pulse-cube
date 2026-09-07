/** Per-level best progress and the mute flag. Wrapped because localStorage
 *  throws in private browsing and a blocked read must not take the game down. */
const bestKey = (levelId: number): string => `pulse-cube:best:${levelId}`;
const MUTE_KEY = 'pulse-cube:muted';

/** Best progress through a level, 0..1. Only normal-mode runs write here. */
export function loadBest(levelId: number): number {
  try {
    const v = Number(localStorage.getItem(bestKey(levelId)));
    return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0;
  } catch {
    return 0;
  }
}

export function saveBest(levelId: number, progress: number): void {
  try {
    localStorage.setItem(bestKey(levelId), String(Math.min(1, Math.max(0, progress))));
  } catch {
    /* storage unavailable - best is session-only */
  }
}

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(m: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* ignore */
  }
}
