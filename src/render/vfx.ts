import { ease, hexA, star } from './art';

/** Positions and velocities are in tiles (tiles/s); drawing multiplies by the tile size. */
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string;
  glow: boolean; gravity: number; drag: boolean;
}
interface Ring { x: number; y: number; r: number; life: number; max: number; color: string; width: number; flat: boolean }
interface Label { x: number; y: number; text: string; color: string; life: number; max: number; size: number; pop: boolean }

const MAX_PARTICLES = 2500;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Renderer-side particles, shockwave rings and big floating labels, all in real time. */
export class Vfx {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private labels: Label[] = [];

  spark(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, opts: Partial<Particle> = {}) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ x, y, vx, vy, life, max: life, size, color, glow: true, gravity: 0, drag: true, ...opts });
  }

  burst(x: number, y: number, count: number, speed: number, colors: string[], opts: Partial<Particle> = {}) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), v = rand(speed * 0.25, speed);
      this.spark(x, y, Math.cos(a) * v, Math.sin(a) * v, rand(0.25, 0.55), rand(0.05, 0.11), colors[i % colors.length], opts);
    }
  }

  ring(x: number, y: number, r: number, color: string, life = 0.35, width = 2, flat = false) {
    this.rings.push({ x, y, r, life, max: life, color, width, flat });
  }

  label(x: number, y: number, text: string, color: string, size = 0.7, life = 1.3, pop = true) {
    this.labels.push({ x, y, text, color, life, max: life, size, pop });
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.drag) {
        p.vx *= 1 - dt * 3;
        p.vy *= 1 - dt * 3;
      }
      p.vy += p.gravity * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const l of this.labels) {
      l.life -= dt;
      l.y -= 0.5 * dt;
    }
    this.labels = this.labels.filter((l) => l.life > 0);
  }

  clear() {
    this.particles = [];
    this.rings = [];
    this.labels = [];
  }

  draw(ctx: CanvasRenderingContext2D, tile: number) {
    ctx.save();
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalCompositeOperation = p.glow ? 'lighter' : 'source-over';
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * tile, p.y * tile, Math.max(0.6, p.size * tile * (0.5 + a * 0.5)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - k) + 1;
      ctx.beginPath();
      if (r.flat) ctx.ellipse(r.x * tile, r.y * tile, r.r * tile * ease(k), r.r * tile * ease(k) * 0.38, 0, 0, Math.PI * 2);
      else ctx.arc(r.x * tile, r.y * tile, r.r * tile * ease(k), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    for (const l of this.labels) {
      const k = 1 - l.life / l.max;
      const scale = l.pop ? (k < 0.15 ? ease(k / 0.15) * 1.25 : 1.25 - Math.min(0.25, (k - 0.15) * 1.5)) : 1;
      ctx.save();
      ctx.globalAlpha = Math.min(1, l.life * 2);
      ctx.translate(l.x * tile, l.y * tile);
      ctx.scale(scale, scale);
      ctx.font = `900 ${Math.max(11, l.size * tile)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = Math.max(3, tile * 0.15);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(l.text, 0, 0);
      const g = ctx.createLinearGradient(0, -l.size * tile, 0, 0);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, l.color);
      ctx.fillStyle = g;
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
  }
}

/** Glowing projectile orb (shared by the renderer). */
export function drawOrb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, sparkle: boolean, time: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, color);
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (sparkle) star(ctx, x, y, r * 0.25 + Math.sin(time * 40) * r * 0.06, '#ffffff');
  ctx.restore();
}
