/**
 * Maze blueprints: where to put walls (and which spots should hold the kept tower), in build order.
 * Every gem placed becomes a blocker (the kept one a tower, the other four rocks, see Game.toRock),
 * so a blueprint spends 5 cells per level. The bot follows it only as far as its weights say.
 *
 * Files live in src/data/blueprints/<id>.json and are registered in src/data/blueprints/index.ts,
 * so the CLI, worker threads and the browser all load the same set. Never overwrite one: make <id>-v2.
 */
import { GRID, type Point } from '../game/config';
import { BLUEPRINT_FILES } from '../data/blueprints';

/**
 * wall: just a blocker · slot: a spot for the kept tower (covers many path tiles) · final: a slot on the last
 * stretch before the exit · reserve: a final slot left empty until unlockLevel · hub: keep empty, the creeps'
 * path should run through it again and again
 */
export type CellRole = 'wall' | 'slot' | 'final' | 'reserve' | 'hub';

export interface BlueprintCell {
  x: number;
  y: number;
  /** build order, 1 = first (hub cells are never built and have no order) */
  order: number;
  role: CellRole;
  /** reserve: not to be built before this level */
  unlockLevel?: number;
}

export interface Blueprint {
  id: string;
  style: string;
  note: string;
  author: 'llm' | 'human' | 'tool';
  /** blueprint this one was derived from (versions, reorders) */
  parent?: string;
  /** area the path should pass through many times (inclusive tile rectangle) */
  hub?: { x0: number; y0: number; x1: number; y1: number };
  /** build checkpoints: by the end of `level`, the route should pass the hub at least minPasses times */
  phases?: { level: number; minPasses: number; goal: string }[];
  cells: BlueprintCell[];
}

export interface LoadedBlueprint extends Blueprint {
  /** cells to build, sorted by order (everything but hub cells) */
  sorted: BlueprintCell[];
  /** tile index → cell (including hub cells) */
  at: Map<number, BlueprintCell>;
}

export const isBuilt = (c: BlueprintCell) => c.role !== 'hub';
/** roles that want the kept tower */
export const isTowerSpot = (c: BlueprintCell | undefined) => !!c && (c.role === 'slot' || c.role === 'final' || c.role === 'reserve');

export function load(bp: Blueprint): LoadedBlueprint {
  const sorted = bp.cells.filter(isBuilt).sort((a, b) => a.order - b.order);
  return { ...bp, sorted, at: new Map(bp.cells.map((c) => [c.y * GRID + c.x, c])) };
}

export const BLUEPRINTS: Record<string, LoadedBlueprint> = Object.fromEntries(
  BLUEPRINT_FILES.map((b) => [b.id, load(b as Blueprint)]),
);

/** Ids a weight set may name; 'none' means no blueprint. */
export const BLUEPRINT_IDS = ['none', ...Object.keys(BLUEPRINTS)];

export const blueprintOf = (id: string | undefined): LoadedBlueprint | null => (id && id !== 'none' ? BLUEPRINTS[id] ?? null : null);

/** How many times a path enters the hub rectangle (a stretch inside counts once, however long). */
export function hubPasses(route: Point[], hub: NonNullable<Blueprint['hub']>): number {
  let passes = 0, inside = false;
  for (const p of route) {
    const now = p.x >= hub.x0 && p.x <= hub.x1 && p.y >= hub.y0 && p.y <= hub.y1;
    if (now && !inside) passes++;
    inside = now;
  }
  return passes;
}
