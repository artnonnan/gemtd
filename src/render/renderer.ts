import { CHECKPOINTS, GRID, toTiles, type Point } from '../game/config';
import type { Creep, Game, GameEvent, Shot, Tower } from '../game/game';
import { GEM_INFO, QUALITY_NAMES, TOWERS, abilityOf, displayName } from '../data/gems';
import {
  ART_PEDESTAL_WIDTH, TIERS, drawTowerArt, ease, gemOffset, hash, hexA, lookOf, motesPerSecond, star,
  type Lod, type TowerAnim,
} from './art';
import { Vfx, drawOrb } from './vfx';

const COLORS = {
  bg: '#14171f',
  tile: '#1b1f2a',
  tileAlt: '#1e2330',
  reserved: '#232a3a',
  route: 'rgba(120,200,255,0.16)',
  checkpoint: '#3d6bff',
  mine: '#ffb020',
  select: '#ffffff',
  ok: 'rgba(80,255,140,0.35)',
  bad: 'rgba(255,70,70,0.35)',
};

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

/** Pedestal art -> tiles. */
const ART_SCALE = 0.95 / ART_PEDESTAL_WIDTH;
/** Pedestal sits a little below the tile centre so the floating gem stays mostly inside its tile. */
const PEDESTAL_DROP = 0.18;

interface CreepFx {
  hit: number;
  shownHp: number;
  lastX: number;
  lastY: number;
  dir: number;
  hue: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  tile = 16;
  hover: Point | null = null;
  /** touch placement target, confirmed with a second tap or the Place button */
  cursor: Point | null = null;
  /** camera: zoom factor and top-left offset in unzoomed board pixels */
  zoom = 1;
  offX = 0;
  offY = 0;

  // animation state (real time, independent of the simulation clock)
  private clock = 0;
  private lastFrame = performance.now();
  private lastGame: Game | null = null;
  private vfx = new Vfx();
  private towerAnims = new Map<number, TowerAnim>();
  private moteAcc = new Map<number, number>();
  private creepFx = new Map<number, CreepFx>();
  private shotFx = new WeakMap<Shot, { age: number; phase: number }>();
  private rockCache = new Map<string, HTMLCanvasElement>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  // ---------- camera ----------

  private get boardPx() {
    return this.tile * GRID;
  }

  private clampCamera() {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom));
    const max = this.boardPx - this.boardPx / this.zoom;
    this.offX = Math.min(max, Math.max(0, this.offX));
    this.offY = Math.min(max, Math.max(0, this.offY));
  }

  /** Zoom keeping the board point under (clientX, clientY) fixed. */
  zoomAt(zoom: number, clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    const bx = sx / this.zoom + this.offX, by = sy / this.zoom + this.offY;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.offX = bx - sx / this.zoom;
    this.offY = by - sy / this.zoom;
    this.clampCamera();
  }

  /** Pan by a screen-space drag delta. */
  panBy(dx: number, dy: number) {
    this.offX -= dx / this.zoom;
    this.offY -= dy / this.zoom;
    this.clampCamera();
  }

  /** Center the view on a tile, optionally changing zoom. */
  centerOn(p: Point, zoom = this.zoom) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const view = this.boardPx / this.zoom;
    this.offX = (p.x + 0.5) * this.tile - view / 2;
    this.offY = (p.y + 0.5) * this.tile - view / 2;
    this.clampCamera();
  }

  /** Keep a tile on screen (used when nudging the cursor). */
  ensureVisible(p: Point) {
    const view = this.boardPx / this.zoom, t = this.tile;
    if (p.x * t < this.offX || (p.x + 1) * t > this.offX + view || p.y * t < this.offY || (p.y + 1) * t > this.offY + view) {
      this.centerOn(p);
    }
  }

  resize() {
    const wrap = this.canvas.closest<HTMLElement>('.board-wrap') ?? this.canvas.parentElement!;
    const bar = document.querySelector<HTMLElement>('#touchbar');
    const barHeight = bar && !bar.hidden ? bar.offsetHeight + 8 : 0;
    // stacked (mobile) layout: the wrapper's height follows the canvas, so size from width only
    const stacked = window.matchMedia('(max-width: 860px)').matches;
    const size = Math.max(200, stacked ? wrap.clientWidth : Math.min(wrap.clientWidth, wrap.clientHeight - barHeight));
    const oldPx = this.boardPx;
    this.tile = Math.floor(size / GRID);
    const px = this.tile * GRID;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${px}px`;
    this.canvas.style.height = `${px}px`;
    this.canvas.width = Math.round(px * this.dpr);
    this.canvas.height = Math.round(px * this.dpr);
    this.offX *= px / oldPx;
    this.offY *= px / oldPx;
    this.clampCamera();
  }

  /** Screen point -> tile coordinate, through the camera. */
  tileAt(clientX: number, clientY: number): Point {
    const r = this.canvas.getBoundingClientRect();
    const bx = (clientX - r.left) / this.zoom + this.offX;
    const by = (clientY - r.top) / this.zoom + this.offY;
    return { x: Math.floor(bx / this.tile), y: Math.floor(by / this.tile) };
  }

  // ---------- frame ----------

  draw(game: Game) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.clock += dt;
    if (game !== this.lastGame) {
      this.lastGame = game;
      this.vfx.clear();
      this.towerAnims.clear();
      this.creepFx.clear();
    }
    const lod = this.lod();
    this.consumeEvents(game, lod);
    this.animate(game, dt, lod);

    const { ctx, tile, dpr, zoom } = this;
    const px = tile * GRID;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, px, px);
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -this.offX * dpr * zoom, -this.offY * dpr * zoom);

    ctx.drawImage(this.background(game), 0, 0, px, px);
    this.drawRoute(game);
    this.drawCheckpoints();
    for (const key of game.rocks) this.drawRock(key % GRID, Math.floor(key / GRID));
    this.drawHover(game);
    this.drawCursor(game);

    // towers and creeps sorted by depth so lower things overlap higher ones
    const view = this.viewRect();
    const items: { y: number; draw: () => void }[] = [];
    for (const t of game.towers) {
      if (t.x < view.x0 - 2 || t.x > view.x1 + 2 || t.y < view.y0 - 2 || t.y > view.y1 + 3) continue;
      items.push({ y: t.y + 0.5 + PEDESTAL_DROP, draw: () => this.drawTower(game, t, lod) });
    }
    for (const c of game.creeps) items.push({ y: c.y, draw: () => this.drawCreep(game, c, lod) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    this.drawShots(game);
    this.drawGameEffects(game);
    this.vfx.draw(ctx, tile);
    this.drawRanges(game);
    this.drawRockAndSwap(game);
  }

  /** Checkerboard is static: render it once per tile size (sharp up to 2x zoom). */
  private bg: { key: string; canvas: HTMLCanvasElement } | null = null;
  private background(game: Game): HTMLCanvasElement {
    const scale = Math.min(2, this.zoom) * this.dpr;
    const key = `${this.tile}:${scale}`;
    if (this.bg?.key === key) return this.bg.canvas;
    const t = Math.max(1, Math.round(this.tile * scale));
    const c = document.createElement('canvas');
    c.width = c.height = t * GRID;
    const g = c.getContext('2d')!;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        g.fillStyle = game.isReserved(x, y) ? COLORS.reserved : (x + y) % 2 ? COLORS.tile : COLORS.tileAlt;
        g.fillRect(x * t, y * t, t, t);
      }
    }
    this.bg = { key, canvas: c };
    return c;
  }

  private lod(): Lod {
    const screenTile = this.tile * this.zoom;
    return screenTile < 26 ? 0 : screenTile < 48 ? 1 : 2;
  }

  private viewRect() {
    const t = this.tile, view = this.boardPx / this.zoom;
    return { x0: this.offX / t, y0: this.offY / t, x1: (this.offX + view) / t, y1: (this.offY + view) / t };
  }

  private anim(t: Tower): TowerAnim {
    let a = this.towerAnims.get(t.uid);
    if (!a) {
      a = { recoil: 0, flash: 0, aim: -Math.PI / 2, seed: hash(t.uid) * 10 };
      this.towerAnims.set(t.uid, a);
    }
    return a;
  }

  private creep(uid: number, c?: Creep): CreepFx {
    let f = this.creepFx.get(uid);
    if (!f) {
      f = { hit: 0, shownHp: c?.hp ?? 0, lastX: c?.x ?? 0, lastY: c?.y ?? 0, dir: 0, hue: c ? hash(c.def.id.charCodeAt(3) * 7 + c.def.hp) * 360 : 0 };
      this.creepFx.set(uid, f);
    }
    return f;
  }

  /** Gem position in tiles for a tower (for muzzle sparks and celebrations). */
  private gemTop(t: Tower, lod: Lod): Point {
    const { tier } = lookOf(t.id);
    const off = gemOffset(tier, this.clock, this.anim(t), lod);
    return { x: t.x + 0.5, y: t.y + 0.5 + PEDESTAL_DROP + off.y * ART_SCALE };
  }

  private consumeEvents(game: Game, lod: Lod) {
    const events: GameEvent[] = game.events.splice(0);
    for (const e of events) {
      switch (e.type) {
        case 'fire': {
          const a = this.anim(e.tower);
          const { palette, tier } = lookOf(e.tower.id);
          a.recoil = 1;
          a.flash = 0.8;
          const top = this.gemTop(e.tower, lod);
          a.aim = Math.atan2(e.ty - top.y, e.tx - top.x);
          for (let i = 0; i < 3 + tier * 2; i++) {
            const ang = a.aim + (Math.random() - 0.5) * 1.4, v = 1 + Math.random() * 2;
            this.vfx.spark(top.x, top.y, Math.cos(ang) * v, Math.sin(ang) * v, 0.3, 0.05, palette.light);
          }
          break;
        }
        case 'hit': {
          const f = this.creepFx.get(e.creep);
          if (f) f.hit = 1;
          const { palette, tier } = lookOf(e.tower.id);
          const big = 1 + tier * 0.15;
          this.vfx.burst(e.x, e.y - 0.2, 4 + tier * 2, (e.splash ? 4 : 2.5) * big, [palette.shot, palette.shot, '#ffffff']);
          if (!e.splash) this.vfx.ring(e.x, e.y - 0.2, 0.35 * big, palette.shot, 0.3, 1 + tier * 0.4);
          break;
        }
        case 'kill': {
          const f = this.creepFx.get(e.creep);
          const color = `hsl(${f?.hue ?? 20},80%,60%)`;
          for (let i = 0; i < 18; i++) {
            const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 3;
            this.vfx.spark(e.x, e.y - 0.2, Math.cos(a) * v, Math.sin(a) * v - 1.5, 0.4 + Math.random() * 0.4, 0.07 + Math.random() * 0.05, color, { glow: false, gravity: 7 });
          }
          this.vfx.ring(e.x, e.y, 0.9, '#ffffff', 0.4, 2);
          this.creepFx.delete(e.creep);
          break;
        }
        case 'transform': {
          const { palette, tier } = lookOf(e.tower.id);
          const top = this.gemTop(e.tower, lod);
          const info = GEM_INFO[e.tower.id];
          this.vfx.burst(top.x, top.y, 20 + tier * 10, 3 + tier, [palette.light, palette.light, palette.light, '#ffd84a']);
          this.vfx.ring(top.x, top.y, 1.2 + tier * 0.35, palette.light, 0.6, 3);
          if (tier >= 3) this.vfx.ring(e.tower.x + 0.5, e.tower.y + 0.5 + PEDESTAL_DROP, 2 + tier * 0.4, '#ffd84a', 0.8, 3, true);
          this.anim(e.tower).flash = 1;
          const name = e.kind === 'keep' && info ? QUALITY_NAMES[info.quality] : displayName(e.tower.id);
          const text = e.kind === 'downgrade' ? `${name} ↓` : `${name}${tier >= 5 ? '!!' : e.kind === 'keep' ? '' : '!'}`;
          this.vfx.label(top.x, top.y - 0.8, text.toUpperCase(), TIERS[tier].trim ?? palette.light, tier >= 4 ? 0.95 : 0.75);
          break;
        }
      }
    }
  }

  private animate(game: Game, dt: number, lod: Lod) {
    for (const t of game.towers) {
      const a = this.anim(t);
      a.recoil = Math.max(0, a.recoil - dt * 4);
      a.flash = Math.max(0, a.flash - dt * 5);
      // rising motes from Flawless+ pedestals (only when they are big enough to see)
      const { palette, tier } = lookOf(t.id);
      const rate = motesPerSecond(tier);
      if (rate && lod > 0 && !t.fresh) {
        let acc = (this.moteAcc.get(t.uid) ?? Math.random()) + rate * dt * (lod === 1 ? 0.4 : 1);
        while (acc >= 1) {
          acc -= 1;
          const ang = Math.random() * Math.PI * 2, r = (10 + Math.random() * 28) * ART_SCALE;
          this.vfx.spark(t.x + 0.5 + Math.cos(ang) * r, t.y + 0.5 + PEDESTAL_DROP - 0.05 + Math.sin(ang) * r * 0.38,
            (Math.random() - 0.5) * 0.1, -0.3 - Math.random() * 0.35, 0.8 + Math.random() * 0.8, 0.03,
            Math.random() < 0.25 ? '#ffd84a' : palette.light, { drag: false });
        }
        this.moteAcc.set(t.uid, acc);
      }
    }
    for (const c of game.creeps) {
      const f = this.creep(c.uid, c);
      f.hit = Math.max(0, f.hit - dt * 5);
      f.shownHp += (c.hp - f.shownHp) * (1 - Math.exp(-dt * 10));
      const dx = c.x - f.lastX, dy = c.y - f.lastY;
      if (dx * dx + dy * dy > 1e-6) f.dir = Math.atan2(dy, dx);
      f.lastX = c.x;
      f.lastY = c.y;
    }
    if (this.creepFx.size > game.creeps.length + 50) {
      const alive = new Set(game.creeps.map((c) => c.uid));
      for (const uid of this.creepFx.keys()) if (!alive.has(uid)) this.creepFx.delete(uid);
    }
    // projectile trails
    for (const s of game.shots) {
      let fx = this.shotFx.get(s);
      if (!fx) {
        fx = { age: 0, phase: Math.random() * 6 };
        this.shotFx.set(s, fx);
      }
      fx.age += dt;
      const { tier } = lookOf(s.tower.id);
      this.vfx.spark(s.x, s.y, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0.3, 0.06 + tier * 0.012, s.color);
      if (tier >= 4) {
        const dx = s.target.x - s.x, dy = s.target.y - s.y, d = Math.hypot(dx, dy) || 1;
        for (const side of [-1, 1]) {
          const off = Math.sin(fx.age * 30 + fx.phase) * 0.18 * side;
          this.vfx.spark(s.x + (-dy / d) * off, s.y + (dx / d) * off, 0, 0, 0.25, 0.035, side > 0 ? '#ffffff' : '#ffd84a');
        }
      }
    }
    this.vfx.update(dt);
  }

  // ---------- board ----------

  private drawRoute(game: Game) {
    if (game.route.length < 2) return;
    const { ctx, tile } = this;
    ctx.strokeStyle = COLORS.route;
    ctx.lineWidth = Math.max(2, tile * 0.45);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    game.route.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (p.x + 0.5) * tile, (p.y + 0.5) * tile));
    ctx.stroke();
    // flowing dashes show the direction creeps walk
    ctx.save();
    ctx.strokeStyle = 'rgba(160,220,255,0.22)';
    ctx.lineWidth = Math.max(1, tile * 0.08);
    ctx.setLineDash([tile * 0.25, tile * 0.75]);
    ctx.lineDashOffset = -this.clock * tile * 1.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawCheckpoints() {
    const { ctx, tile } = this;
    CHECKPOINTS.forEach((p, i) => {
      const last = i === CHECKPOINTS.length - 1;
      const color = last ? COLORS.mine : i === 0 ? '#ff4d6d' : COLORS.checkpoint;
      const cx = (p.x + 0.5) * tile, cy = (p.y + 0.5) * tile;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glowR = tile * (1.1 + 0.15 * Math.sin(this.clock * 2 + i));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      g.addColorStop(0, hexA(color, 0.45));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, tile * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(1, tile * 0.06);
      ctx.stroke();
      ctx.fillStyle = '#0b0d12';
      ctx.font = `bold ${Math.max(9, tile * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(last ? 'M' : i === 0 ? 'S' : String(i), cx, cy + tile * 0.04);
      ctx.textBaseline = 'alphabetic';
    });
  }

  /** Rocks are pre-rendered per variant and on-screen size, then stamped. */
  private drawRock(x: number, y: number) {
    const { tile } = this;
    const variant = Math.floor(hash(x * 37 + y) * 4);
    const px = Math.max(8, Math.round((tile * this.zoom * this.dpr) / 8) * 8);
    const key = `${variant}:${px}`;
    let img = this.rockCache.get(key);
    if (!img) {
      if (this.rockCache.size > 48) this.rockCache.clear();
      img = renderRock(variant, px);
      this.rockCache.set(key, img);
    }
    this.ctx.drawImage(img, x * tile, y * tile, tile, tile);
  }

  // ---------- towers ----------

  private drawTower(game: Game, t: Tower, lod: Lod) {
    const { ctx, tile } = this;
    const { palette, tier } = lookOf(t.id);
    const anim = this.anim(t);
    const s = tile * ART_SCALE;
    ctx.save();
    ctx.translate((t.x + 0.5) * tile, (t.y + 0.5 + PEDESTAL_DROP) * tile);
    ctx.scale(s, s);
    if (t.fresh) ctx.globalAlpha = 0.92;
    drawTowerArt(ctx, palette, tier, this.clock, anim, lod);
    ctx.restore();

    if (t.fresh) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = Math.max(1, tile * 0.06);
      ctx.setLineDash([tile * 0.18, tile * 0.14]);
      ctx.lineDashOffset = -this.clock * tile * 0.6;
      ctx.strokeRect(t.x * tile + 1, t.y * tile + 1, tile - 2, tile - 2);
      ctx.restore();
    }
    if (game.selected === t) {
      ctx.save();
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = Math.max(1.5, tile * 0.08);
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.clock * 6);
      ctx.beginPath();
      ctx.ellipse((t.x + 0.5) * tile, (t.y + 0.5 + PEDESTAL_DROP + 0.2) * tile, tile * 0.6, tile * 0.24, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- creeps ----------

  private drawCreep(game: Game, c: Creep, lod: Lod) {
    const { ctx, tile } = this;
    const f = this.creep(c.uid, c);
    const boss = c.def.name.startsWith('Summon') || c.def.hp >= 100000;
    const k = (tile * (boss ? 0.46 : 0.34)) / 12; // art units: body radius 12
    const air = c.def.air;
    const stunned = c.stunUntil > game.time;
    const t = this.clock * (stunned ? 0 : 1);
    const bob = Math.abs(Math.sin(t * 9 + c.uid)) * (air ? 3 : 5);
    const lift = air ? 18 : 8;

    ctx.save();
    ctx.translate(c.x * tile, c.y * tile);
    ctx.scale(k, k);
    // shadow (further below for flyers)
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath(); ctx.ellipse(0, air ? 8 : 4, 12 - bob * 0.4, 4, 0, 0, Math.PI * 2); ctx.fill();

    ctx.translate(0, -lift - bob);
    const sq = air ? 1 : 1 + (bob / 5) * 0.12;
    if (air) {
      // flapping wings
      const flap = Math.sin(t * 18 + c.uid) * 0.7;
      ctx.fillStyle = `hsla(${f.hue},60%,75%,0.85)`;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.scale(side, 1);
        ctx.rotate(-0.3 + flap * 0.6);
        ctx.beginPath();
        ctx.moveTo(6, -2);
        ctx.quadraticCurveTo(20, -16, 26, -2);
        ctx.quadraticCurveTo(18, 0, 6, 4);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.save();
    ctx.scale(1 / sq, sq);
    const poisoned = !!c.poison && c.poison.until > game.time;
    if (lod > 0) {
      const body = ctx.createRadialGradient(-4, -5, 2, 0, 0, 14);
      body.addColorStop(0, `hsl(${f.hue},80%,70%)`);
      body.addColorStop(1, `hsl(${f.hue},70%,38%)`);
      ctx.fillStyle = body;
    } else {
      ctx.fillStyle = `hsl(${f.hue},75%,55%)`;
    }
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
    if (poisoned) {
      ctx.fillStyle = 'rgba(80,255,120,0.35)';
      ctx.fill();
    }
    if (c.slowUntil > game.time) {
      ctx.strokeStyle = 'rgba(140,190,255,0.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    // eyes look where it walks
    const dir = f.dir;
    for (const s of [-1, 1]) {
      const ex = Math.cos(dir) * 4 + Math.cos(dir + Math.PI / 2) * 4 * s, ey = -3 + Math.sin(dir) * 3;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(ex + Math.cos(dir) * 1.2, ey + Math.sin(dir) * 1.2, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    if (f.hit > 0) {
      ctx.globalAlpha = f.hit * 0.8;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 12.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (boss && lod > 0) {
      // little horns so bosses read as bosses
      ctx.fillStyle = '#ffe9a8';
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(s * 5, -10); ctx.lineTo(s * 9, -19); ctx.lineTo(s * 10, -8); ctx.fill();
      }
    }
    if (stunned) {
      for (let i = 0; i < 3; i++) {
        const a = this.clock * 5 + (i * Math.PI * 2) / 3;
        star(ctx, Math.cos(a) * 10, -16 + Math.sin(a) * 3, 2, '#ffe066');
      }
    }
    ctx.restore();

    // hp bar with a trailing damage segment
    const w = tile * 0.8, h = Math.max(2, tile * 0.1);
    const bx = c.x * tile - w / 2, by = c.y * tile - (lift + 18) * k - h;
    const frac = Math.max(0, c.hp / c.maxHp), shown = Math.max(0, f.shownHp / c.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
    ctx.fillStyle = '#ffd0a0';
    ctx.fillRect(bx, by, w * Math.min(1, shown), h);
    ctx.fillStyle = frac > 0.35 ? '#4dff88' : '#ff5050';
    ctx.fillRect(bx, by, w * frac, h);
  }

  // ---------- projectiles & effects ----------

  private drawShots(game: Game) {
    const { ctx, tile } = this;
    for (const s of game.shots) {
      const { tier } = lookOf(s.tower.id);
      const r = Math.max(2.5, TIERS[tier].shot * tile * ART_SCALE * 1.6);
      drawOrb(ctx, s.x * tile, s.y * tile, r, s.color, tier >= 5, this.clock);
    }
  }

  private drawGameEffects(game: Game) {
    const { ctx, tile } = this;
    for (const e of game.effects) {
      const k = Math.min(1, (game.time - e.born) / e.life);
      if (e.kind === 'ring') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = Math.max(1, tile * 0.15 * (1 - k)) + 1;
        ctx.beginPath();
        ctx.arc(e.x * tile, e.y * tile, e.r * tile * ease(k), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = (1 - k) * 0.15;
        ctx.fillStyle = e.color;
        ctx.fill();
        ctx.restore();
      } else {
        const crit = e.text?.endsWith('!');
        const pop = crit ? 1 + Math.max(0, 0.6 - k * 3) : 1;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - k) * 2);
        ctx.font = `800 ${Math.max(10, tile * (crit ? 0.75 : 0.55) * pop)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.max(2, tile * 0.12);
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        const ty = (e.y - 0.3 - k * 0.8) * tile;
        ctx.strokeText(e.text ?? '', e.x * tile, ty);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text ?? '', e.x * tile, ty);
        ctx.restore();
      }
    }
  }

  // ---------- overlays ----------

  private drawRanges(game: Game) {
    const t = game.selected ?? (this.hover ? game.towerAt(this.hover.x, this.hover.y) : null);
    if (!t) return;
    const { ctx, tile } = this;
    const a = abilityOf(t.id);
    const { palette } = lookOf(t.id);
    const cx = (t.x + 0.5) * tile, cy = (t.y + 0.5) * tile;
    const circle = (units: number, stroke: string, fill: string, dash: boolean) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, toTiles(units) * tile, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, tile * 0.06);
      if (dash) {
        ctx.setLineDash([tile * 0.3, tile * 0.4]);
        ctx.lineDashOffset = -this.clock * tile;
      }
      ctx.stroke();
      ctx.restore();
    };
    if (!a.noAttack) circle(TOWERS[t.id].range, hexA(palette.base, 0.55), hexA(palette.base, 0.05), true);
    const aura = a.auraSpeed ?? a.auraDamage ?? a.armorAura;
    if (aura) circle(aura.range, 'rgba(120,255,160,0.5)', 'rgba(120,255,160,0.04)', false);
    if (a.burn) circle(a.burn.range, 'rgba(255,140,60,0.6)', 'rgba(255,140,60,0.06)', false);
  }

  private drawRockAndSwap(game: Game) {
    const { ctx, tile } = this;
    const rock = game.selectedRock;
    if (rock) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2;
      ctx.strokeRect(rock.x * tile, rock.y * tile, tile, tile);
    }
    const src = game.swapSource;
    if (!src) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 6);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255,216,74,${0.5 + 0.5 * pulse})`;
    ctx.strokeRect(src.x * tile - 1, src.y * tile - 1, tile + 2, tile + 2);
    ctx.restore();
    const h = this.hover ?? this.cursor;
    if (h && game.isSwapTarget(h.x, h.y)) {
      ctx.fillStyle = 'rgba(80,220,255,0.3)';
      ctx.fillRect(h.x * tile, h.y * tile, tile, tile);
      ctx.strokeStyle = 'rgba(80,220,255,0.8)';
      ctx.beginPath();
      ctx.moveTo((src.x + 0.5) * tile, (src.y + 0.5) * tile);
      ctx.lineTo((h.x + 0.5) * tile, (h.y + 0.5) * tile);
      ctx.stroke();
    }
  }

  private drawCursor(game: Game) {
    const c = this.cursor;
    if (!c || game.phase !== 'build' || !game.inBounds(c.x, c.y)) return;
    const { ctx, tile } = this;
    const ok = game.canPlace(c.x, c.y);
    const pulse = 0.55 + 0.45 * Math.sin(this.clock * 5.5);
    ctx.fillStyle = ok ? COLORS.ok : COLORS.bad;
    ctx.fillRect(c.x * tile, c.y * tile, tile, tile);
    ctx.strokeStyle = ok ? `rgba(120,255,170,${pulse})` : `rgba(255,90,90,${pulse})`;
    ctx.lineWidth = Math.max(1.5, tile * 0.12);
    ctx.strokeRect(c.x * tile + 0.5, c.y * tile + 0.5, tile - 1, tile - 1);
    // crosshair lines help aim on a small screen
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo((c.x + 0.5) * tile, 0);
    ctx.lineTo((c.x + 0.5) * tile, GRID * tile);
    ctx.moveTo(0, (c.y + 0.5) * tile);
    ctx.lineTo(GRID * tile, (c.y + 0.5) * tile);
    ctx.stroke();
  }

  private drawHover(game: Game) {
    const h = this.hover;
    if (!h || game.phase !== 'build' || !game.inBounds(h.x, h.y) || game.towerAt(h.x, h.y) || game.isRock(h.x, h.y)) return;
    const { ctx, tile } = this;
    ctx.fillStyle = game.canPlace(h.x, h.y) ? COLORS.ok : COLORS.bad;
    ctx.fillRect(h.x * tile, h.y * tile, tile, tile);
  }
}

/** A lumpy shaded boulder on a transparent square canvas of `px` pixels. */
function renderRock(variant: number, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const cx = px * 0.5, cy = px * 0.56, R = px * 0.4;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx, px * 0.82, R * 0.95, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  const pts: Point[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + variant;
    const r = R * (0.78 + 0.22 * hash(variant * 13 + i));
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.82 });
  }
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  g.addColorStop(0, '#7a8194');
  g.addColorStop(0.55, '#535a6b');
  g.addColorStop(1, '#2e333e');
  ctx.fillStyle = g;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, px * 0.03);
  ctx.stroke();
  // top-left highlight facet
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(pts[4].x, pts[4].y);
  ctx.lineTo(pts[5].x, pts[5].y);
  ctx.lineTo(pts[6].x, pts[6].y);
  ctx.lineTo(cx, cy - R * 0.1);
  ctx.closePath();
  ctx.fill();
  // a crack
  ctx.strokeStyle = 'rgba(20,22,28,0.6)';
  ctx.lineWidth = Math.max(1, px * 0.025);
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.2 + variant, cy - R * 0.3);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + R * 0.15, cy + R * 0.35);
  ctx.stroke();
  return c;
}
