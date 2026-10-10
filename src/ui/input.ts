import { GRID, type Point } from '../game/config';
import type { Game } from '../game/game';
import type { Renderer } from '../render/renderer';

const TAP_SLOP = 10; // px a finger may move and still count as a tap
const TAP_ZOOM = 2.5; // zoom used when a tap needs a closer look

interface Touch {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

/**
 * Board input.
 * Mouse: click places/selects, wheel zooms, right/middle-drag pans.
 * Touch: tap aims a cursor (zooming in first if the board is small), tap the cursor again or press
 * Place to build; one-finger drag pans, two-finger pinch zooms. The toolbar adds zoom and a d-pad.
 */
export class BoardInput {
  private touches = new Map<number, Touch>();
  private pinchDist = 0;
  private moved = false;
  private mousePan: { x: number; y: number } | null = null;
  private bar: HTMLElement;
  private placeBtn: HTMLButtonElement;
  private hint: HTMLElement;

  /** locked() is true while the AI plays: clicks may still select things to look at, but never change the game */
  constructor(private canvas: HTMLCanvasElement, private renderer: Renderer, private getGame: () => Game, private locked: () => boolean = () => false) {
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.cancel(e));
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') renderer.hover = null;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      renderer.zoomAt(renderer.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });

    this.bar = document.querySelector('#touchbar')!;
    this.placeBtn = this.bar.querySelector('[data-t="place"]')!;
    this.hint = this.bar.querySelector('.hint')!;
    this.bar.addEventListener('pointerdown', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-t]');
      if (!t || t.disabled) return;
      e.preventDefault();
      this.toolbar(t.dataset.t!);
    });
    if (window.matchMedia('(pointer: coarse)').matches) this.showBar();
  }

  private showBar() {
    if (!this.bar.hidden) return;
    this.bar.hidden = false;
    this.renderer.resize(); // the toolbar takes height from the board
  }

  /** Called every frame to keep the toolbar in sync with the game. */
  update() {
    const game = this.getGame();
    const c = this.renderer.cursor;
    const building = game.phase === 'build' && !this.locked();
    this.placeBtn.disabled = !building || !c || !game.canPlace(c.x, c.y);
    this.hint.textContent = !building ? '' : c ? (game.canPlace(c.x, c.y) ? 'Tap again or press Place' : 'Blocked — move the cursor') : 'Tap a tile to aim';
    if (!building && c) this.renderer.cursor = null;
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouseClick(e);
      else this.mousePan = { x: e.clientX, y: e.clientY };
      return;
    }
    this.showBar();
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    if (this.touches.size === 1) this.moved = false;
    if (this.touches.size === 2) {
      this.moved = true; // a pinch is never a tap
      this.pinchDist = this.distance();
    }
  }

  private move(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.renderer.hover = this.renderer.tileAt(e.clientX, e.clientY);
      if (this.mousePan) {
        this.renderer.panBy(e.clientX - this.mousePan.x, e.clientY - this.mousePan.y);
        this.mousePan = { x: e.clientX, y: e.clientY };
      }
      return;
    }
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (this.touches.size === 1) {
      if (Math.hypot(e.clientX - t.startX, e.clientY - t.startY) > TAP_SLOP) this.moved = true;
      if (this.moved) this.renderer.panBy(dx, dy);
    }
    t.x = e.clientX;
    t.y = e.clientY;
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const dist = this.distance();
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (this.pinchDist > 0) this.renderer.zoomAt(this.renderer.zoom * (dist / this.pinchDist), mx, my);
      this.renderer.panBy(dx / 2, dy / 2);
      this.pinchDist = dist;
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.mousePan = null;
      return;
    }
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinchDist = 0;
    if (t && this.touches.size === 0 && !this.moved) this.tap(e.clientX, e.clientY);
  }

  private cancel(e: PointerEvent) {
    this.touches.delete(e.pointerId);
    this.mousePan = null;
    this.pinchDist = 0;
  }

  private distance() {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** A click on a "can make" label over a gem selects that gem. */
  private pickHint(clientX: number, clientY: number): boolean {
    const game = this.getGame();
    if (game.teleportSource || game.swapSource) return false;
    const t = this.renderer.hintAt(clientX, clientY);
    if (!t) return false;
    game.select(t);
    this.renderer.cursor = null;
    return true;
  }

  /** Swap targeting, tower and rock selection. Returns true when the tap/click was consumed. */
  private pick(p: Point): boolean {
    const game = this.getGame();
    if (this.locked()) {
      const t = game.towerAt(p.x, p.y);
      if (t) game.select(t);
      else if (game.isRock(p.x, p.y)) game.selectRock(p.x, p.y);
      else game.select(null);
      this.renderer.cursor = null;
      return true;
    }
    if (game.teleportSource) {
      game.teleportTo(p.x, p.y); // anything but a valid tile cancels
      return true;
    }
    if (game.swapSource) {
      game.swapWith(p.x, p.y); // a non-target cancels
      return true;
    }
    const tower = game.towerAt(p.x, p.y);
    if (tower) {
      game.select(tower);
      this.renderer.cursor = null;
      return true;
    }
    if (game.isRock(p.x, p.y)) {
      game.selectRock(p.x, p.y);
      this.renderer.cursor = null;
      return true;
    }
    return false;
  }

  private mouseClick(e: PointerEvent) {
    const game = this.getGame();
    const p = this.renderer.tileAt(e.clientX, e.clientY);
    this.renderer.hover = p;
    if (this.pickHint(e.clientX, e.clientY) || this.pick(p)) return;
    if (!game.placeGem(p.x, p.y)) game.select(null);
  }

  private tap(clientX: number, clientY: number) {
    const game = this.getGame();
    const r = this.renderer;
    const p = r.tileAt(clientX, clientY);
    if (!game.inBounds(p.x, p.y)) return;
    if (this.pickHint(clientX, clientY) || this.pick(p)) return;
    if (game.phase !== 'build') {
      game.select(null);
      return;
    }
    // tiles are too small to hit reliably when zoomed out: first zoom in around the tap
    if (r.zoom < TAP_ZOOM - 0.01) {
      r.zoomAt(TAP_ZOOM, clientX, clientY);
      r.cursor = r.tileAt(clientX, clientY);
      return;
    }
    if (r.cursor && r.cursor.x === p.x && r.cursor.y === p.y) this.place();
    else r.cursor = p;
  }

  private place() {
    if (this.locked()) return;
    const game = this.getGame();
    const c = this.renderer.cursor;
    if (c && game.placeGem(c.x, c.y)) {
      // keep the cursor nearby so the next gem is one nudge away
      this.renderer.cursor = game.phase === 'build' ? this.nextFree(c) : null;
    }
  }

  private nextFree(from: Point): Point | null {
    const game = this.getGame();
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const p = { x: from.x + dx, y: from.y + dy };
      if (game.canPlace(p.x, p.y)) return p;
    }
    return from;
  }

  private toolbar(action: string) {
    const r = this.renderer;
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const nudge = (dx: number, dy: number) => {
      const c = r.cursor ?? { x: Math.floor(GRID / 2), y: Math.floor(GRID / 2) };
      r.cursor = { x: Math.min(GRID - 1, Math.max(0, c.x + dx)), y: Math.min(GRID - 1, Math.max(0, c.y + dy)) };
      r.ensureVisible(r.cursor);
    };
    switch (action) {
      case 'zoom-in': r.zoomAt(r.zoom * 1.5, cx, cy); break;
      case 'zoom-out': r.zoomAt(r.zoom / 1.5, cx, cy); break;
      case 'fit': r.centerOn({ x: GRID / 2, y: GRID / 2 }, 1); break;
      case 'left': nudge(-1, 0); break;
      case 'right': nudge(1, 0); break;
      case 'up': nudge(0, -1); break;
      case 'down': nudge(0, 1); break;
      case 'place': this.place(); break;
    }
  }
}
