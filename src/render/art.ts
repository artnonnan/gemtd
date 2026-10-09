/**
 * Code-drawn gem tower art (ported from demo/example1).
 * Everything is drawn around (0,0) = pedestal centre in "art units" (the demo's pixels);
 * the caller translates/scales so a pedestal (~84 units wide) fits one tile.
 */
import { BASE_GEMS, GEM_INFO, GEM_TYPES, GREAT, RECIPES, TOWERS, towerColor, type GemType } from '../data/gems';

export const ART_PEDESTAL_WIDTH = 84;

export interface Palette {
  base: string;
  light: string;
  dark: string;
  shot: string;
}

export interface TowerAnim {
  recoil: number;
  flash: number;
  aim: number;
  /** per-tower phase so neighbours don't bob in sync */
  seed: number;
}

/** 0 = tiny on screen (cheap), 1 = medium, 2 = close-up (everything). */
export type Lod = 0 | 1 | 2;

/** Visual recipe per quality tier: each step adds detail (see demo/example1). */
export interface Tier {
  size: number; facets: number; rough: number; cracks: number; glow: number; beam: number; runes: number;
  trim: string | null; inlays: number; shards: number; claws: boolean; halo: number; rays: number;
  circle: boolean; motes: number; crown: boolean; pulse: number; sparkles: number; shot: number;
}

export const TIERS: Tier[] = [
  { size: 13, facets: 4,  rough: 0.38, cracks: 3, glow: 0.25, beam: 0,   runes: 0,   trim: null,      inlays: 0, shards: 0, claws: false, halo: 0, rays: 0,  circle: false, motes: 0,   crown: false, pulse: 0,   sparkles: 0,  shot: 7 },
  { size: 15, facets: 5,  rough: 0.18, cracks: 2, glow: 0.4,  beam: 0,   runes: 0.4, trim: null,      inlays: 0, shards: 0, claws: false, halo: 0, rays: 0,  circle: false, motes: 0,   crown: false, pulse: 0,   sparkles: 2,  shot: 8 },
  { size: 17, facets: 6,  rough: 0,    cracks: 0, glow: 0.6,  beam: 0.2, runes: 0.7, trim: null,      inlays: 0, shards: 0, claws: false, halo: 0, rays: 0,  circle: false, motes: 0,   crown: false, pulse: 0,   sparkles: 4,  shot: 9 },
  { size: 19, facets: 8,  rough: 0,    cracks: 0, glow: 0.8,  beam: 0.3, runes: 1,   trim: '#c9d3e6', inlays: 0, shards: 2, claws: false, halo: 0, rays: 0,  circle: false, motes: 0.6, crown: false, pulse: 0,   sparkles: 6,  shot: 10 },
  { size: 21, facets: 10, rough: 0,    cracks: 0, glow: 1.0,  beam: 0.4, runes: 1,   trim: '#ffcf4a', inlays: 4, shards: 3, claws: true,  halo: 1, rays: 6,  circle: false, motes: 1.2, crown: false, pulse: 0,   sparkles: 8,  shot: 12 },
  { size: 26, facets: 12, rough: 0,    cracks: 0, glow: 1.4,  beam: 0.6, runes: 1,   trim: '#ffd84a', inlays: 6, shards: 5, claws: true,  halo: 2, rays: 10, circle: true,  motes: 2.5, crown: true,  pulse: 2.2, sparkles: 12, shot: 15 },
];

const GEM_PALETTES: Record<GemType, Palette> = {
  ruby:       { base: '#ff3b4e', light: '#ffb3bb', dark: '#7a0614', shot: '#ff6a5a' },
  sapphire:   { base: '#3d7bff', light: '#b8d0ff', dark: '#0b2470', shot: '#7fb0ff' },
  emerald:    { base: '#2fcf6a', light: '#b5ffd0', dark: '#06501f', shot: '#6dff9a' },
  amethyst:   { base: '#b05cff', light: '#e6c8ff', dark: '#3d0a73', shot: '#d199ff' },
  topaz:      { base: '#ffd23d', light: '#fff2b5', dark: '#7a5600', shot: '#fff07a' },
  aquamarine: { base: '#3fe0e6', light: '#c4fbff', dark: '#06555a', shot: '#8ff8ff' },
  diamond:    { base: '#dfe9ff', light: '#ffffff', dark: '#6f7f9e', shot: '#ffffff' },
  opal:       { base: '#ffb38a', light: '#fff0e6', dark: '#8a4220', shot: '#ffc7a8' },
};

// ---------- colour helpers ----------
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => 1 - Math.pow(1 - t, 3);
export const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const k = Math.min(1, Math.max(0, t));
  const ch = (s: number) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, k)).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

// ---------- tower id -> look ----------

/** Specials get a tier from how deep they sit in the upgrade chains: first special = Flawless look, then Perfect, then Great. */
const specialTier = new Map<string, number>();
{
  const queue: [string, number][] = RECIPES.map((r) => [r.result, 3]);
  for (const t of GEM_TYPES) queue.push([BASE_GEMS[t][GREAT], 5]);
  while (queue.length) {
    const [id, tier] = queue.shift()!;
    if (specialTier.has(id) && specialTier.get(id)! >= tier) continue;
    specialTier.set(id, tier);
    for (const up of TOWERS[id]?.upgrades ?? []) if (TOWERS[up]) queue.push([up, Math.min(5, tier + 1)]);
  }
}

const lookCache = new Map<string, { palette: Palette; tier: number }>();
export function lookOf(id: string): { palette: Palette; tier: number } {
  let look = lookCache.get(id);
  if (!look) {
    const info = GEM_INFO[id];
    if (info) {
      look = { palette: GEM_PALETTES[info.type], tier: info.quality };
    } else {
      const base = towerColor(id);
      look = {
        palette: { base, light: mix(base, '#ffffff', 0.6), dark: mix(base, '#000000', 0.65), shot: mix(base, '#ffffff', 0.3) },
        tier: specialTier.get(id) ?? 4,
      };
    }
    lookCache.set(id, look);
  }
  return look;
}

// ---------- drawing ----------

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  if (r <= 0.3) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 2);
  ctx.quadraticCurveTo(x, y, x + r * 2, y);
  ctx.quadraticCurveTo(x, y, x, y + r * 2);
  ctx.quadraticCurveTo(x, y, x - r * 2, y);
  ctx.quadraticCurveTo(x, y, x, y - r * 2);
  ctx.fill();
}

/** Where the floating gem sits, relative to the pedestal centre. */
export function gemOffset(tierIdx: number, time: number, anim: TowerAnim, lod: Lod) {
  const t = TIERS[tierIdx];
  const float = lod === 0 ? 2 : 4;
  return { x: 0, y: (lod === 0 ? -36 : -50) - t.size * 0.4 + Math.sin(time * 2.2 + anim.seed) * float };
}

/** Bigger gem when the tower is small on screen, so its colour still reads. */
const gemBoost = (lod: Lod) => (lod === 0 ? 1.7 : lod === 1 ? 1.3 : 1);

function oct(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, sy: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy);
  }
  ctx.closePath();
}

function drawMagicCircle(ctx: CanvasRenderingContext2D, pal: Palette, time: number) {
  ctx.save();
  ctx.translate(0, 14);
  ctx.scale(1, 0.38);
  ctx.globalCompositeOperation = 'lighter';
  ctx.rotate(time * 0.35);
  const R = 92;
  ctx.strokeStyle = hexA('#ffd84a', 0.5);
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = hexA(pal.base, 0.55);
  ctx.beginPath(); ctx.arc(0, 0, R - 12, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = hexA(pal.light, 0.55);
  ctx.lineWidth = 2;
  for (const off of [0, Math.PI / 3]) {
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = off + (i * Math.PI * 2) / 3;
      ctx.lineTo(Math.cos(a) * (R - 12), Math.sin(a) * (R - 12));
    }
    ctx.stroke();
  }
  ctx.rotate(-time * 0.8);
  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI * 2) / 24;
    ctx.fillStyle = hexA(i % 2 ? '#ffd84a' : pal.light, 0.7);
    ctx.fillRect(Math.cos(a) * (R + 8) - 2, Math.sin(a) * (R + 8) - 2, 4, 4);
  }
  ctx.restore();
}

function drawPedestal(ctx: CanvasRenderingContext2D, pal: Palette, tierIdx: number, time: number, lod: Lod) {
  const t = TIERS[tierIdx];
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 18, 46, 14, 0, 0, Math.PI * 2); ctx.fill();
  const stone = tierIdx >= 3 ? ['#353b4b', '#5a6278', '#2f3442'] : ['#2b303d', '#454c5e', '#262a35'];
  const side = ctx.createLinearGradient(-40, 0, 40, 0);
  side.addColorStop(0, stone[0]); side.addColorStop(0.5, stone[1]); side.addColorStop(1, stone[2]);
  ctx.fillStyle = side;
  ctx.fillRect(-38, -4, 76, 18);
  oct(ctx, 0, 14, 40, 0.38); ctx.fill();
  const top = ctx.createLinearGradient(0, -18, 0, 10);
  top.addColorStop(0, tierIdx >= 3 ? '#6c7590' : '#5b6378'); top.addColorStop(1, '#3a4152');
  ctx.fillStyle = top;
  oct(ctx, 0, -4, 40, 0.38); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (tierIdx <= 1 && lod > 0) {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-30, -6); ctx.lineTo(-18, -2); ctx.lineTo(-22, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24, -8); ctx.lineTo(14, 0); ctx.stroke();
  }
  if (t.trim) {
    ctx.strokeStyle = t.trim;
    ctx.lineWidth = tierIdx >= 4 ? 2.5 : 1.8;
    oct(ctx, 0, -4, 40, 0.38); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-38, 13); ctx.lineTo(38, 13); ctx.stroke();
    if (tierIdx >= 5) { oct(ctx, 0, -4, 32, 0.38); ctx.stroke(); }
  }
  if (lod > 0) {
    for (let i = 0; i < t.inlays; i++) {
      const ix = -30 + (60 / Math.max(1, t.inlays - 1)) * i;
      const glow = 0.5 + 0.5 * Math.sin(time * 4 + i);
      ctx.fillStyle = mix(pal.base, pal.light, glow * 0.6);
      ctx.beginPath(); ctx.moveTo(ix, 1); ctx.lineTo(ix + 3, 5); ctx.lineTo(ix, 9); ctx.lineTo(ix - 3, 5); ctx.closePath(); ctx.fill();
    }
  }
  if (t.runes && lod > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexA(pal.base, t.runes * (0.35 + 0.25 * Math.sin(time * 3)));
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, -4, 26, 9, 0, 0, Math.PI * 2); ctx.stroke();
    const dots = 4 + tierIdx * 2;
    for (let i = 0; i < dots; i++) {
      const a = time * 0.8 + (i * Math.PI * 2) / dots;
      ctx.fillStyle = hexA(pal.light, 0.6 * t.runes);
      ctx.beginPath(); ctx.arc(Math.cos(a) * 26, -4 + Math.sin(a) * 9, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function drawRays(ctx: CanvasRenderingContext2D, pal: Palette, tierIdx: number, time: number, top: { x: number; y: number }) {
  const t = TIERS[tierIdx];
  ctx.save();
  ctx.translate(top.x, top.y);
  ctx.globalCompositeOperation = 'lighter';
  const len = 70 + tierIdx * 20;
  for (let i = 0; i < t.rays; i++) {
    const a = time * 0.3 + (i * Math.PI * 2) / t.rays;
    const flick = 0.6 + 0.4 * Math.sin(time * 2 + i * 1.7);
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    g.addColorStop(0, hexA(i % 2 && tierIdx === 5 ? '#ffd84a' : pal.light, 0.35 * flick));
    g.addColorStop(1, hexA(pal.base, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a - 0.09) * len, Math.sin(a - 0.09) * len);
    ctx.lineTo(Math.cos(a + 0.09) * len, Math.sin(a + 0.09) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawHalo(ctx: CanvasRenderingContext2D, pal: Palette, tierIdx: number, time: number, top: { x: number; y: number }, front: boolean, boost: number) {
  const t = TIERS[tierIdx];
  for (let k = 0; k < t.halo; k++) {
    const R = t.size * boost * (1.9 + k * 0.45);
    ctx.save();
    ctx.translate(top.x, top.y);
    ctx.rotate(k ? -0.35 : 0.3);
    ctx.scale(1, 0.3);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexA(k ? '#ffd84a' : pal.light, 0.7);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, R, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    ctx.stroke();
    const spin = time * (k ? -1.4 : 1);
    for (let i = 0; i < 8; i++) {
      const a = spin + (i * Math.PI * 2) / 8;
      if (Math.sin(a) > 0 !== front) continue;
      ctx.fillStyle = hexA(k ? '#fff2b5' : pal.light, 0.9);
      ctx.beginPath(); ctx.arc(Math.cos(a) * R, Math.sin(a) * R, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function drawShards(ctx: CanvasRenderingContext2D, pal: Palette, tierIdx: number, time: number, top: { x: number; y: number }, front: boolean) {
  const t = TIERS[tierIdx];
  for (let i = 0; i < t.shards; i++) {
    const a = time * 1.6 + (i * Math.PI * 2) / t.shards;
    const depth = Math.sin(a);
    if (depth > 0 !== front) continue;
    const R = t.size * 2.1;
    const sx = top.x + Math.cos(a) * R, sy = top.y + depth * R * 0.35 + Math.sin(time * 3 + i) * 4;
    const s = 4 + tierIdx * 0.6 + depth * 1.5;
    if (tierIdx >= 5) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 1; k <= 5; k++) {
        const b = a - k * 0.12;
        ctx.fillStyle = hexA(pal.light, 0.18 * (1 - k / 6));
        ctx.beginPath(); ctx.arc(top.x + Math.cos(b) * R, top.y + Math.sin(b) * R * 0.35, s * (1 - k / 7), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(time * 3 + i);
    ctx.fillStyle = mix(pal.base, pal.light, 0.4 + depth * 0.3);
    ctx.globalAlpha = 0.65 + depth * 0.35;
    ctx.beginPath(); ctx.moveTo(0, -s * 1.4); ctx.lineTo(s * 0.7, 0); ctx.lineTo(0, s * 1.4); ctx.lineTo(-s * 0.7, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
}

function drawGemBody(ctx: CanvasRenderingContext2D, pal: Palette, tierIdx: number, time: number, anim: TowerAnim, top: { x: number; y: number }, lod: Lod) {
  const t = TIERS[tierIdx];
  const size = t.size * gemBoost(lod);
  ctx.save();
  ctx.translate(top.x, top.y);
  ctx.scale(1 + anim.recoil * 0.08, 1 - anim.recoil * 0.12);
  const turn = time * (tierIdx <= 1 ? 0.4 : 0.9) + anim.seed;
  const n = t.facets;
  const crownY = -size * 0.55, culetY = size * 1.05, tableR = size * (tierIdx <= 1 ? 0.35 : 0.55);
  const r = (i: number) => size * (1 - t.rough * hash(i + n * 7));
  const facets: { a0: number; a1: number; r0: number; r1: number; depth: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = turn + (i * Math.PI * 2) / n, a1 = turn + ((i + 1) * Math.PI * 2) / n;
    facets.push({ a0, a1, r0: r(i), r1: r((i + 1) % n), depth: Math.sin((a0 + a1) / 2) });
  }
  facets.sort((p, q) => p.depth - q.depth);
  const dull = tierIdx <= 1 ? 0.45 : 1;
  for (const f of facets) {
    if (f.depth < -0.2) continue;
    const x0 = Math.cos(f.a0) * f.r0, x1 = Math.cos(f.a1) * f.r1;
    const t0 = Math.cos(f.a0) * tableR, t1 = Math.cos(f.a1) * tableR;
    const shade = (0.35 + 0.65 * Math.max(0, Math.cos(f.a0 + Math.PI / n - Math.PI / 2 - 0.6))) * dull;
    ctx.fillStyle = mix(pal.dark, pal.base, shade);
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); ctx.lineTo(0, culetY * (tierIdx <= 1 ? 0.75 : 1)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = mix(pal.base, pal.light, shade * 0.8);
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); ctx.lineTo(t1, crownY); ctx.lineTo(t0, crownY); ctx.closePath(); ctx.fill();
    if (lod > 0) {
      ctx.strokeStyle = hexA(pal.light, tierIdx <= 1 ? 0.15 : 0.35);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  ctx.fillStyle = hexA(pal.light, tierIdx <= 1 ? 0.35 : 0.85);
  ctx.beginPath(); ctx.ellipse(0, crownY, tableR, tableR * 0.22, 0, 0, Math.PI * 2); ctx.fill();

  if (lod > 0) {
    ctx.strokeStyle = 'rgba(10,10,15,0.6)';
    ctx.lineWidth = 1.1;
    for (let k = 0; k < t.cracks; k++) {
      ctx.beginPath();
      let cx = (hash(k * 3 + 1) - 0.5) * size, cy = crownY + hash(k * 3 + 2) * size * 0.4;
      ctx.moveTo(cx, cy);
      for (let s = 0; s < 3; s++) {
        cx += (hash(k * 9 + s) - 0.5) * size * 0.6;
        cy += size * 0.3;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
  }

  if (tierIdx >= 2 && lod > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const sweep = ((time * 0.6 + anim.seed) % 1.6) - 0.3;
    const sg = ctx.createLinearGradient(-size + sweep * size * 2, -size, -size * 0.4 + sweep * size * 2, size);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, `rgba(255,255,255,${0.2 + tierIdx * 0.05})`);
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.moveTo(-size, 0); ctx.lineTo(size, 0); ctx.lineTo(0, culetY); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-size, 0); ctx.lineTo(size, 0); ctx.lineTo(tableR, crownY); ctx.lineTo(-tableR, crownY); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  if (t.claws) {
    const claws = tierIdx >= 5 ? 6 : 4;
    for (let i = 0; i < claws; i++) {
      const a = turn * 0.5 + (i * Math.PI * 2) / claws;
      if (Math.sin(a) < -0.1) continue;
      const cx = Math.cos(a) * size;
      const g = ctx.createLinearGradient(cx - 3, 0, cx + 3, 0);
      g.addColorStop(0, '#8a6410'); g.addColorStop(0.5, '#fff0a8'); g.addColorStop(1, '#a87a12');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx * 0.55 - 2, culetY * 0.55);
      ctx.lineTo(cx * 1.04 - 2.5, -1);
      ctx.lineTo(cx * 0.98, crownY * 0.45);
      ctx.lineTo(cx * 1.04 + 2.5, -1);
      ctx.lineTo(cx * 0.55 + 2, culetY * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (t.crown) {
    const cy = crownY - 4, cw = tableR * 1.25;
    const g = ctx.createLinearGradient(0, cy - 16, 0, cy + 2);
    g.addColorStop(0, '#fff6c2'); g.addColorStop(0.5, '#ffd84a'); g.addColorStop(1, '#9a6c0c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-cw, cy);
    const spikes = 5;
    for (let i = 0; i <= spikes * 2; i++) {
      const px = -cw + (i * cw * 2) / (spikes * 2);
      ctx.lineTo(px, i % 2 ? cy - 16 - (i === spikes ? 5 : 0) : cy - 6);
    }
    ctx.lineTo(cw, cy);
    ctx.closePath();
    ctx.fill();
    if (lod > 0) {
      for (let i = 1; i <= spikes * 2; i += 2) {
        const px = -cw + (i * cw * 2) / (spikes * 2);
        ctx.fillStyle = i === spikes ? pal.light : pal.base;
        ctx.beginPath(); ctx.arc(px, cy - 16 - (i === spikes ? 5 : 0), i === spikes ? 3 : 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** The whole tower at (0,0). `ground` draws the parts that lie on the floor (shadows, magic circle). */
export function drawTowerArt(ctx: CanvasRenderingContext2D, pal: Palette, tierIdx: number, time: number, anim: TowerAnim, lod: Lod) {
  const t = TIERS[tierIdx];
  const top = gemOffset(tierIdx, time, anim, lod);
  const boost = gemBoost(lod);

  if (t.circle && lod === 2) drawMagicCircle(ctx, pal, time + anim.seed);
  if (t.pulse && lod === 2) {
    const k = ((time + anim.seed) % t.pulse) / 0.9;
    if (k < 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hexA(pal.base, 1 - k);
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.ellipse(0, 14, 150 * ease(k), 150 * ease(k) * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  drawPedestal(ctx, pal, tierIdx, time, lod);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (t.beam && lod > 0) {
    const sky = tierIdx >= 5 ? 120 : 0;
    const beam = ctx.createLinearGradient(0, -6, 0, top.y - sky);
    beam.addColorStop(0, hexA(pal.base, t.beam));
    beam.addColorStop(1, hexA(pal.base, 0));
    ctx.fillStyle = beam;
    const w = 10 + tierIdx * 2;
    ctx.beginPath();
    ctx.moveTo(-w, -6); ctx.lineTo(w, -6);
    ctx.lineTo(top.x + w * 0.4, top.y - sky); ctx.lineTo(top.x - w * 0.4, top.y - sky);
    ctx.fill();
  }
  const glowR = t.size * boost * (1.6 + t.glow * 1.4 + 0.3 * Math.sin(time * 3 + anim.seed) + anim.flash * 1.2);
  const g = ctx.createRadialGradient(top.x, top.y, 0, top.x, top.y, glowR);
  g.addColorStop(0, hexA(pal.base, 0.25 + t.glow * 0.3 + anim.flash * 0.3));
  g.addColorStop(1, hexA(pal.base, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(top.x, top.y, glowR, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  if (lod === 2 && t.rays) drawRays(ctx, pal, tierIdx, time + anim.seed, top);
  if (lod > 0) drawHalo(ctx, pal, tierIdx, time + anim.seed, top, false, boost);
  if (lod === 2) drawShards(ctx, pal, tierIdx, time + anim.seed, top, false);
  drawGemBody(ctx, pal, tierIdx, time, anim, top, lod);
  if (lod === 2) drawShards(ctx, pal, tierIdx, time + anim.seed, top, true);
  if (lod > 0) drawHalo(ctx, pal, tierIdx, time + anim.seed, top, true, boost);

  if (lod > 0 && t.sparkles) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tt = time + anim.seed;
    for (let i = 0; i < t.sparkles; i++) {
      const phase = (tt * 0.7 + i * 0.37) % 1;
      const a = i * 2.4 + Math.floor(tt * 0.7 + i * 0.37) * 1.7;
      const r = t.size * boost * (0.6 + ((i * 53) % 10) / 8);
      star(ctx, top.x + Math.cos(a) * r, top.y + Math.sin(a) * r * 0.9, Math.sin(phase * Math.PI) * (2.5 + tierIdx * 0.7), i % 3 || tierIdx < 4 ? pal.light : '#ffd84a');
    }
    ctx.restore();
  }

  if (anim.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = anim.flash;
    const d = t.size * boost + 4;
    star(ctx, top.x + Math.cos(anim.aim) * d, top.y + Math.sin(anim.aim) * d, (4 + tierIdx) * anim.flash, '#ffffff');
    ctx.restore();
  }

  // quality pips
  const pips = tierIdx + 1;
  for (let i = 0; i < pips; i++) {
    const px = -((pips - 1) * 9) / 2 + i * 9;
    if (tierIdx === 5) star(ctx, px, 30, 2.2, '#ffd84a');
    else {
      ctx.fillStyle = pal.light;
      ctx.beginPath(); ctx.arc(px, 30, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** Tiers with rising motes, for the renderer's particle system. */
export const motesPerSecond = (tierIdx: number) => TIERS[tierIdx].motes * 10;
