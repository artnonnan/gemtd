import { CHECKPOINTS, GRID, toTiles, type Point } from '../game/config';
import type { Game, Tower } from '../game/game';
import { GEM_INFO, GREAT, TOWERS, abilityOf, isSpecial, towerColor } from '../data/gems';

const COLORS = {
  bg: '#14171f',
  tile: '#1b1f2a',
  tileAlt: '#1e2330',
  reserved: '#232a3a',
  rock: '#4a4f5c',
  rockEdge: '#2e323c',
  route: 'rgba(120,200,255,0.18)',
  routeDot: 'rgba(120,200,255,0.35)',
  checkpoint: '#3d6bff',
  mine: '#ffb020',
  hpBack: '#3a0f14',
  hp: '#4dff88',
  hpLow: '#ff5050',
  select: '#ffffff',
  ok: 'rgba(80,255,140,0.35)',
  bad: 'rgba(255,70,70,0.35)',
};

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

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

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

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

  draw(game: Game) {
    const { ctx, tile, dpr, zoom } = this;
    const px = tile * GRID;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, px, px);
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -this.offX * dpr * zoom, -this.offY * dpr * zoom);

    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        ctx.fillStyle = game.isReserved(x, y) ? COLORS.reserved : (x + y) % 2 ? COLORS.tile : COLORS.tileAlt;
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }

    this.drawRoute(game);
    this.drawCheckpoints();

    for (const key of game.rocks) this.drawRock(key % GRID, Math.floor(key / GRID));
    for (const t of game.towers) this.drawTower(game, t);

    this.drawRanges(game);
    this.drawHover(game);
    this.drawCursor(game);
    this.drawRockAndSwap(game);

    for (const c of game.creeps) {
      const cx = c.x * tile, cy = c.y * tile;
      const r = tile * (c.def.air ? 0.32 : 0.36);
      ctx.save();
      if (c.def.air) {
        ctx.fillStyle = '#c7b6ff';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r * 0.8);
        ctx.lineTo(cx - r, cy + r * 0.8);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = c.stunUntil > game.time ? '#ffffff' : c.poison && c.poison.until > game.time ? '#8dff9a' : '#e86a4a';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (c.slowUntil > game.time) {
        ctx.strokeStyle = '#7fb0ff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
      const w = tile * 0.9, frac = Math.max(0, c.hp / c.maxHp);
      ctx.fillStyle = COLORS.hpBack;
      ctx.fillRect(cx - w / 2, cy - r - 6, w, 3);
      ctx.fillStyle = frac > 0.35 ? COLORS.hp : COLORS.hpLow;
      ctx.fillRect(cx - w / 2, cy - r - 6, w * frac, 3);
    }

    for (const s of game.shots) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x * tile, s.y * tile, Math.max(2, tile * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }

    for (const e of game.effects) {
      const k = (game.time - e.born) / e.life;
      ctx.globalAlpha = Math.max(0, 1 - k);
      if (e.kind === 'ring') {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x * tile, e.y * tile, e.r * tile * (0.6 + 0.4 * k), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = e.color;
        ctx.font = `bold ${Math.max(10, tile * 0.6)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(e.text ?? '', e.x * tile, (e.y - k * 0.8) * tile);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawRoute(game: Game) {
    if (game.route.length < 2) return;
    const { ctx, tile } = this;
    ctx.strokeStyle = COLORS.route;
    ctx.lineWidth = Math.max(2, tile * 0.35);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    game.route.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (p.x + 0.5) * tile, (p.y + 0.5) * tile));
    ctx.stroke();
  }

  private drawCheckpoints() {
    const { ctx, tile } = this;
    CHECKPOINTS.forEach((p, i) => {
      const last = i === CHECKPOINTS.length - 1;
      ctx.fillStyle = last ? COLORS.mine : i === 0 ? '#ff4d6d' : COLORS.checkpoint;
      ctx.beginPath();
      ctx.arc((p.x + 0.5) * tile, (p.y + 0.5) * tile, tile * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0d12';
      ctx.font = `bold ${Math.max(9, tile * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(last ? 'M' : i === 0 ? 'S' : String(i), (p.x + 0.5) * tile, (p.y + 0.55) * tile);
      ctx.textBaseline = 'alphabetic';
    });
  }

  private drawRock(x: number, y: number) {
    const { ctx, tile } = this;
    const pad = tile * 0.08;
    ctx.fillStyle = COLORS.rockEdge;
    ctx.fillRect(x * tile + pad, y * tile + pad, tile - 2 * pad, tile - 2 * pad);
    ctx.fillStyle = COLORS.rock;
    ctx.fillRect(x * tile + pad * 2, y * tile + pad * 2, tile - 4 * pad, tile - 4 * pad);
  }

  private drawTower(game: Game, t: Tower) {
    const { ctx, tile } = this;
    const cx = (t.x + 0.5) * tile, cy = (t.y + 0.5) * tile;
    const color = towerColor(t.id);
    const info = GEM_INFO[t.id];
    const special = isSpecial(t.id);
    const r = tile * (special ? 0.46 : 0.28 + 0.035 * (info?.quality ?? 0));

    ctx.save();
    if (special) {
      // star for specials and Great gems
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const rr = i % 2 ? r * 0.5 : r;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = special ? '#ffd84a' : 'rgba(0,0,0,0.6)';
    ctx.stroke();

    if (info && info.quality < GREAT) {
      // quality pips under the gem
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i <= info.quality; i++) {
        ctx.fillRect(t.x * tile + 2 + i * (tile / 6), (t.y + 1) * tile - 3, Math.max(1, tile / 9), 2);
      }
    }
    if (t.fresh) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(t.x * tile + 1, t.y * tile + 1, tile - 2, tile - 2);
      ctx.setLineDash([]);
    }
    if (game.time - t.firedAt < 0.08) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (game.selected === t) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2;
      ctx.strokeRect(t.x * tile, t.y * tile, tile, tile);
    }
    ctx.restore();
  }

  private drawRanges(game: Game) {
    const t = game.selected ?? (this.hover ? game.towerAt(this.hover.x, this.hover.y) : null);
    if (!t) return;
    const { ctx, tile } = this;
    const a = abilityOf(t.id);
    const cx = (t.x + 0.5) * tile, cy = (t.y + 0.5) * tile;
    const circle = (units: number, stroke: string, fill: string) => {
      ctx.beginPath();
      ctx.arc(cx, cy, toTiles(units) * tile, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    if (!a.noAttack) circle(TOWERS[t.id].range, 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.05)');
    const aura = a.auraSpeed ?? a.auraDamage ?? a.armorAura;
    if (aura) circle(aura.range, 'rgba(120,255,160,0.5)', 'rgba(120,255,160,0.04)');
    if (a.burn) circle(a.burn.range, 'rgba(255,140,60,0.6)', 'rgba(255,140,60,0.06)');
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
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
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
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 180);
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
