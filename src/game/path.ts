import { CHECKPOINTS, GRID, type Point } from './config';

export type BlockedFn = (x: number, y: number) => boolean;

const N = GRID * GRID;
// neighbour order matters: it decides which of several equally short paths wins
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// Scratch space reused by every search (pathfinding runs thousands of times per bot game).
// A stamp per search marks which entries are live, so nothing needs clearing between searches.
const g = new Float64Array(N);
const parent = new Int32Array(N);
const seen = new Uint32Array(N);
const closed = new Uint32Array(N);
let stamp = 0;

/** Snapshot of a BlockedFn as one byte per tile, so a search never calls back into game code. */
export function blockedGrid(blocked: BlockedFn): Uint8Array {
  const grid = new Uint8Array(N);
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (blocked(x, y)) grid[y * GRID + x] = 1;
  return grid;
}

/** A* on the tile grid, 8 directions, no cutting corners past blocked tiles. Returns tile coords. */
export function findPath(blocked: BlockedFn, from: Point, to: Point): Point[] | null {
  return findPathOnGrid(blockedGrid(blocked), from, to);
}

export function findPathOnGrid(grid: Uint8Array, from: Point, to: Point): Point[] | null {
  if (++stamp === 0xffffffff) {
    seen.fill(0);
    closed.fill(0);
    stamp = 1;
  }
  const s = stamp;
  const tx = to.x, ty = to.y;
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  heap.clear();
  const start = from.y * GRID + from.x;
  g[start] = 0;
  parent[start] = -1;
  seen[start] = s;
  heap.push(start, h(from.x, from.y));

  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur] === s) continue;
    closed[cur] = s;
    const cx = cur % GRID, cy = (cur / GRID) | 0;
    if (cx === tx && cy === ty) {
      const out: Point[] = [];
      for (let c = cur; c !== -1; c = parent[c]) out.push({ x: c % GRID, y: (c / GRID) | 0 });
      return out.reverse();
    }
    for (let d = 0; d < 8; d++) {
      const dx = DX[d], dy = DY[d];
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const ni = ny * GRID + nx;
      if (grid[ni]) continue;
      if (dx && dy && (grid[cy * GRID + nx] || grid[ny * GRID + cx])) continue;
      const ng = g[cur] + COST[d];
      if (seen[ni] !== s || ng < g[ni]) {
        seen[ni] = s;
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
  const segs = findRouteSegments(blockedGrid(blocked));
  return segs && joinSegments(segs);
}

/** The route as one path per checkpoint leg (each includes both ends), or null if any leg is blocked. */
export function findRouteSegments(grid: Uint8Array): Point[][] | null {
  const segs: Point[][] = [];
  for (let i = 0; i < CHECKPOINTS.length - 1; i++) {
    const seg = findPathOnGrid(grid, CHECKPOINTS[i], CHECKPOINTS[i + 1]);
    if (!seg) return null;
    segs.push(seg);
  }
  return segs;
}

/** Does this path step onto (x, y), or cut diagonally past it? Only then can blocking (x, y) break it. */
export function pathTouches(seg: Point[], x: number, y: number): boolean {
  for (let i = 0; i < seg.length; i++) {
    const p = seg[i];
    if (p.x === x && p.y === y) return true;
    if (i > 0) {
      const q = seg[i - 1];
      // a diagonal step from q to p needs both corner tiles (p.x, q.y) and (q.x, p.y) open
      if (p.x !== q.x && p.y !== q.y && ((p.x === x && q.y === y) || (q.x === x && p.y === y))) return true;
    }
  }
  return false;
}

/**
 * New legs for the route if (x, y) were blocked: legs that never touch the tile are kept as they are
 * (still valid, still shortest), the rest are searched again. null = blocking it cuts the route.
 */
export function rerouteAround(grid: Uint8Array, segs: Point[][], x: number, y: number): Point[][] | null {
  const i = y * GRID + x;
  const prev = grid[i];
  grid[i] = 1;
  try {
    const out: Point[][] = [];
    for (let k = 0; k < segs.length; k++) {
      if (!pathTouches(segs[k], x, y)) {
        out.push(segs[k]);
        continue;
      }
      const seg = findPathOnGrid(grid, CHECKPOINTS[k], CHECKPOINTS[k + 1]);
      if (!seg) return null;
      out.push(seg);
    }
    return out;
  } finally {
    grid[i] = prev;
  }
}

export function joinSegments(segs: Point[][]): Point[] {
  const route: Point[] = [];
  segs.forEach((seg, i) => route.push(...(i === 0 ? seg : seg.slice(1))));
  return route;
}

/**
 * Length as (straight steps) + (diagonal steps) * sqrt2. Unlike routeLength it does not depend on the
 * order steps are summed in, so two equally long routes always compare exactly equal.
 */
export function pathCost(segs: Point[][]): number {
  let straight = 0, diag = 0;
  for (const seg of segs) {
    for (let i = 1; i < seg.length; i++) {
      if (seg[i].x !== seg[i - 1].x && seg[i].y !== seg[i - 1].y) diag++;
      else straight++;
    }
  }
  return straight + diag * Math.SQRT2;
}

export function routeLength(route: Point[]): number {
  let len = 0;
  for (let i = 1; i < route.length; i++) len += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
  return len;
}

/** Binary min-heap on preallocated typed arrays; same sift order as before so ties break the same way. */
class MinHeap {
  private items = new Int32Array(1 << 14);
  private prios = new Float64Array(1 << 14);
  size = 0;
  clear() {
    this.size = 0;
  }
  push(item: number, prio: number) {
    if (this.size === this.items.length) this.grow();
    const { items, prios } = this;
    let i = this.size++;
    items[i] = item;
    prios[i] = prio;
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
    const last = --this.size;
    if (last > 0) {
      items[0] = items[last];
      prios[0] = prios[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < last && prios[l] < prios[m]) m = l;
        if (r < last && prios[r] < prios[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    const { items, prios } = this;
    const ti = items[a], tp = prios[a];
    items[a] = items[b];
    prios[a] = prios[b];
    items[b] = ti;
    prios[b] = tp;
  }
  private grow() {
    const items = new Int32Array(this.items.length * 2);
    const prios = new Float64Array(this.prios.length * 2);
    items.set(this.items);
    prios.set(this.prios);
    this.items = items;
    this.prios = prios;
  }
}

const heap = new MinHeap();
