import { CHECKPOINTS, GRID, type Point } from './config';

export type BlockedFn = (x: number, y: number) => boolean;

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** A* on the tile grid, 8 directions, no cutting corners past blocked tiles. Returns tile coords. */
export function findPath(blocked: BlockedFn, from: Point, to: Point): Point[] | null {
  const n = GRID * GRID;
  const idx = (x: number, y: number) => y * GRID + x;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - to.x), dy = Math.abs(y - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new MinHeap();
  const start = idx(from.x, from.y);
  g[start] = 0;
  heap.push(start, h(from.x, from.y));

  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % GRID, cy = (cur / GRID) | 0;
    if (cx === to.x && cy === to.y) {
      const out: Point[] = [];
      for (let c = cur; c !== -1; c = parent[c]) out.push({ x: c % GRID, y: (c / GRID) | 0 });
      return out.reverse();
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || blocked(nx, ny)) continue;
      if (dx && dy && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) continue;
      const ni = idx(nx, ny);
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        parent[ni] = cur;
        heap.push(ni, ng + h(nx, ny));
      }
    }
  }
  return null;
}

/** Full ground route through every checkpoint, or null if the maze is blocked. */
export function findRoute(blocked: BlockedFn): Point[] | null {
  const route: Point[] = [];
  for (let i = 0; i < CHECKPOINTS.length - 1; i++) {
    const seg = findPath(blocked, CHECKPOINTS[i], CHECKPOINTS[i + 1]);
    if (!seg) return null;
    route.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return route;
}

export function routeLength(route: Point[]): number {
  let len = 0;
  for (let i = 1; i < route.length; i++) len += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
  return len;
}

class MinHeap {
  private items: number[] = [];
  private prios: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, prio: number) {
    const { items, prios } = this;
    let i = items.length;
    items.push(item);
    prios.push(prio);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prios[p] <= prios[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const { items, prios } = this;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastPrio = prios.pop()!;
    if (items.length) {
      items[0] = lastItem;
      prios[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < items.length && prios[l] < prios[m]) m = l;
        if (r < items.length && prios[r] < prios[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prios[a], this.prios[b]] = [this.prios[b], this.prios[a]];
  }
}
