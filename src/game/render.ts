/** Reads state, writes nothing back. World units are turned into device pixels
 *  in exactly one place, so what you collide with is what you see. */
import { CUBE, FLOOR_MARGIN } from './config';
import { beatAt, cameraX, levelAt } from './logic';
import type { Entity, GameState } from './types';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    this.ctx = ctx;
  }

  resize(): { cssW: number; cssH: number } {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    return { cssW, cssH };
  }

  draw(state: GameState): void {
    const { ctx, canvas } = this;
    const level = levelAt(state.levelIndex);
    const beat = beatAt(level, state.time);
    // 0 on the beat, 1 just after - the whole scene breathes on this.
    const pulse = Math.max(0, 1 - (beat % 1) * 2.6);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.background(state, pulse);

    const sx = canvas.width / state.viewW;
    const sy = canvas.height / state.viewH;
    const camX = cameraX(state);
    // The floor line sits a constant number of cubes above the bottom edge so
    // it lands in the same place whatever shape the screen is - but on a very
    // tall (portrait) screen it is lifted proportionally, otherwise the action
    // is glued to the bottom edge with a wall of empty sky above it.
    const camY = -Math.max(FLOOR_MARGIN, state.viewH * 0.18);

    ctx.save();
    if (state.shake > 0) {
      const k = state.shake * 7 * this.dpr;
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    // y is up in world space and down in canvas space - flip once, here.
    ctx.transform(sx, 0, 0, -sy, -camX * sx, canvas.height + camY * sy);

    for (const e of level.entities) {
      if (e.x + e.w < camX - 2 || e.x > camX + state.viewW + 2) continue;
      this.entity(e, pulse);
    }
    for (const cp of level.checkpoints) {
      if (cp < camX - 2 || cp > camX + state.viewW + 2) continue;
      this.checkpointFlag(cp, state);
    }
    if (level.length >= camX - 2 && level.length <= camX + state.viewW + 2) this.goal(level.length, state);

    for (const q of state.particles) {
      ctx.globalAlpha = Math.max(0, q.life / q.maxLife);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;

    if (state.phase !== 'dead') this.cube(state, pulse);
    ctx.restore();
  }

  private background(state: GameState, pulse: number): void {
    const { ctx, canvas } = this;
    const level = levelAt(state.levelIndex);
    const hue = [196, 268, 338][level.id - 1] ?? 196;
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, `hsl(${hue} 46% ${9 + pulse * 4}%)`);
    g.addColorStop(0.62, `hsl(${hue + 16} 40% ${14 + pulse * 5}%)`);
    g.addColorStop(1, `hsl(${hue} 34% 7%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Parallax bars that slide with the camera and flash on the beat.
    const camX = cameraX(state);
    ctx.save();
    ctx.globalAlpha = 0.1 + pulse * 0.12;
    ctx.fillStyle = `hsl(${hue + 30} 80% 60%)`;
    const spacing = canvas.width / 7;
    const shift = ((-camX * 0.28 * (canvas.width / state.viewW)) % spacing + spacing) % spacing;
    for (let i = -1; i < 8; i++) {
      const x = i * spacing + shift;
      ctx.fillRect(x, 0, Math.max(2, canvas.width * 0.012), canvas.height);
    }
    ctx.restore();
  }

  private entity(e: Entity, pulse: number): void {
    const { ctx } = this;
    if (e.kind === 'block') {
      ctx.fillStyle = '#182742';
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = `hsl(190 90% ${58 + pulse * 16}%)`;
      ctx.fillRect(e.x, e.y + e.h - 0.14, e.w, 0.14); // lit top edge
      return;
    }
    if (e.kind === 'spike') {
      ctx.fillStyle = `hsl(348 88% ${58 + pulse * 12}%)`;
      ctx.beginPath();
      ctx.moveTo(e.x + 0.08, e.y);
      ctx.lineTo(e.x + e.w / 2, e.y + e.h);
      ctx.lineTo(e.x + e.w - 0.08, e.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(e.x + e.w / 2, e.y + e.h);
      ctx.lineTo(e.x + e.w / 2 - 0.16, e.y + 0.1);
      ctx.lineTo(e.x + e.w / 2, e.y + 0.1);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (e.kind === 'pad') {
      ctx.fillStyle = `hsl(48 100% ${56 + pulse * 20}%)`;
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(e.x + 0.15, e.y + e.h, e.w - 0.3, 0.1);
    }
  }

  private checkpointFlag(x: number, state: GameState): void {
    const { ctx } = this;
    const reached = state.mode === 'practice' && levelAt(state.levelIndex).checkpoints.indexOf(x) <= state.checkpoint;
    ctx.globalAlpha = state.mode === 'practice' ? 1 : 0.28;
    ctx.fillStyle = reached ? '#7ef7a5' : '#8fa6c8';
    ctx.fillRect(x, 0, 0.1, 2.4);
    ctx.beginPath();
    ctx.moveTo(x + 0.1, 2.4);
    ctx.lineTo(x + 1.1, 2.05);
    ctx.lineTo(x + 0.1, 1.7);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private goal(x: number, state: GameState): void {
    const { ctx } = this;
    ctx.fillStyle = '#ffe066';
    for (let i = 0; i < 14; i++) {
      if ((i + Math.floor(state.time * 6)) % 2 === 0) continue;
      ctx.fillRect(x, i * 0.6 - 1, 0.6, 0.6);
    }
  }

  private cube(state: GameState, pulse: number): void {
    const { ctx } = this;
    const p = state.player;
    ctx.save();
    ctx.translate(p.x + CUBE / 2, p.y + CUBE / 2);
    ctx.rotate(p.angle);
    ctx.fillStyle = `hsl(48 100% ${62 + pulse * 14}%)`;
    ctx.fillRect(-CUBE / 2, -CUBE / 2, CUBE, CUBE);
    ctx.fillStyle = '#101c2c';
    ctx.fillRect(-0.22, -0.22, 0.44, 0.44);
    ctx.fillStyle = `hsl(190 90% ${60 + pulse * 20}%)`;
    ctx.fillRect(-0.12, -0.12, 0.24, 0.24);
    ctx.restore();
  }
}
