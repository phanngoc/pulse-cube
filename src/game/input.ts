/** One button. That is the entire control scheme, which makes the edge cases
 *  the whole job: a key or a finger can go down and never come back up (window
 *  blur, a cancelled touch, a hidden tab), and a runner whose jump is stuck on
 *  is unplayable. Held-ness is therefore a set of active sources, and every
 *  path that can end a press clears it. */
export interface InputHandlers {
  press: () => void;
  release: () => void;
  togglePause: () => void;
  toggleMute: () => void;
}

const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'Enter']);

export class InputState {
  private sources = new Set<string>();
  private detach: Array<() => void> = [];

  get held(): boolean {
    return this.sources.size > 0;
  }

  constructor(target: HTMLElement, private h: InputHandlers) {
    const down = (id: string) => {
      const wasEmpty = this.sources.size === 0;
      this.sources.add(id);
      if (wasEmpty) this.h.press();
    };
    const up = (id: string) => {
      if (!this.sources.delete(id)) return;
      if (this.sources.size === 0) this.h.release();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        this.h.togglePause();
        return;
      }
      if (e.code === 'KeyM') {
        this.h.toggleMute();
        return;
      }
      if (JUMP_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) down(`key:${e.code}`); // auto-repeat is not a new press
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (JUMP_KEYS.has(e.code)) {
        e.preventDefault();
        up(`key:${e.code}`);
      }
    };

    const clearAll = () => {
      if (this.sources.size === 0) return;
      this.sources.clear();
      this.h.release();
    };

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest('button')) return;
      down(`ptr:${e.pointerId}`);
      try {
        target.setPointerCapture?.(e.pointerId);
      } catch {
        /* pointer already gone - the window-level pointerup still fires */
      }
    };
    const onPointerUp = (e: PointerEvent) => up(`ptr:${e.pointerId}`);

    const swallow = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearAll);
    document.addEventListener('visibilitychange', clearAll);
    target.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    target.addEventListener('touchmove', swallow, { passive: false });
    target.addEventListener('contextmenu', swallow);

    this.detach = [
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', clearAll),
      () => document.removeEventListener('visibilitychange', clearAll),
      () => target.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('pointercancel', onPointerUp),
      () => target.removeEventListener('touchmove', swallow),
      () => target.removeEventListener('contextmenu', swallow),
    ];
  }

  reset(): void {
    this.sources.clear();
  }

  dispose(): void {
    for (const d of this.detach) d();
    this.detach = [];
  }
}
