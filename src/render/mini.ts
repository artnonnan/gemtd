import { CHECKPOINTS, GRID, type Point } from '../game/config';
import { findRoute } from '../game/path';
import { GEM_INFO, isSpecial, towerColor } from '../data/gems';
import type { RemoteBoard } from '../net/match';

/** Small read-only view of the opponent's board, drawn from network snapshots. */
export class MiniRenderer {
  private ctx: CanvasRenderingContext2D;
  private route: Point[] = [];
  private routeVersion = -1;
  private tile = 8;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(board: RemoteBoard | null) {
    const width = this.canvas.parentElement?.clientWidth ?? 300;
    const tile = Math.max(4, Math.floor(width / GRID));
    const px = tile * GRID;
    const dpr = window.devicePixelRatio || 1;
    if (this.tile !== tile || this.canvas.width !== Math.round(px * dpr)) {
      this.tile = tile;
      this.canvas.width = Math.round(px * dpr);
      this.canvas.height = Math.round(px * dpr);
      this.canvas.style.width = `${px}px`;
      this.canvas.style.height = `${px}px`;
    }
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#14171f';
    ctx.fillRect(0, 0, px, px);
    if (!board) {
      ctx.fillStyle = '#8b93a7';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('waiting for opponent…', px / 2, px / 2);
      return;
    }

    const { layout } = board;
    if (this.routeVersion !== board.layoutVersion) {
      this.routeVersion = board.layoutVersion;
      const blocked = new Set<number>(layout.rocks);
      for (const [, x, y] of layout.towers) blocked.add(y * GRID + x);
      this.route = findRoute((x, y) => blocked.has(y * GRID + x)) ?? [];
    }

    ctx.strokeStyle = 'rgba(120,200,255,0.25)';
    ctx.lineWidth = Math.max(1, tile * 0.4);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.route.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (p.x + 0.5) * tile, (p.y + 0.5) * tile));
    ctx.stroke();

    CHECKPOINTS.forEach((p, i) => {
      ctx.fillStyle = i === CHECKPOINTS.length - 1 ? '#ffb020' : i === 0 ? '#ff4d6d' : '#3d6bff';
      ctx.fillRect(p.x * tile, p.y * tile, tile, tile);
    });

    ctx.fillStyle = '#4a4f5c';
    for (const k of layout.rocks) ctx.fillRect((k % GRID) * tile + 1, Math.floor(k / GRID) * tile + 1, tile - 2, tile - 2);

    for (const [id, x, y] of layout.towers) {
      const cx = (x + 0.5) * tile, cy = (y + 0.5) * tile;
      const r = tile * (isSpecial(id) ? 0.55 : 0.3 + 0.04 * (GEM_INFO[id]?.quality ?? 0));
      ctx.fillStyle = towerColor(id);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.fill();
    }

    for (const [x, y, hp, air] of board.snap.creeps) {
      ctx.fillStyle = air ? '#c7b6ff' : hp > 0.35 ? '#e86a4a' : '#ff3030';
      ctx.beginPath();
      ctx.arc(x * tile, y * tile, Math.max(2, tile * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
