/**
 * Maze blueprints: where to put walls (and which spots should hold the kept tower), in build order.
 * Every gem placed becomes a blocker (the kept one a tower, the other four rocks, see Game.toRock),
 * so a blueprint spends 5 cells per level. The bot follows it only as far as its weights say.
 *
 * Files live in src/data/blueprints/<id>.json and are registered in src/data/blueprints/index.ts,
 * so the CLI, worker threads and the browser all load the same set. Never overwrite one: make <id>-v2.
 */
import { GRID } from '../game/config';
import { BLUEPRINT_FILES } from '../data/blueprints';

export interface BlueprintCell {
  x: number;
  y: number;
  /** build order, 1 = first */
  order: number;
  /** slot = a spot meant for the kept tower (covers many path tiles); wall = just a blocker */
  role: 'wall' | 'slot';
}

export interface Blueprint {
  id: string;
  style: string;
  note: string;
  author: 'llm' | 'human' | 'tool';
  /** blueprint this one was derived from (versions, reorders) */
  parent?: string;
  cells: BlueprintCell[];
}

export interface LoadedBlueprint extends Blueprint {
  /** cells sorted by order */
  sorted: BlueprintCell[];
  /** tile index → cell */
  at: Map<number, BlueprintCell>;
}

export function load(bp: Blueprint): LoadedBlueprint {
  const sorted = [...bp.cells].sort((a, b) => a.order - b.order);
  return { ...bp, sorted, at: new Map(sorted.map((c) => [c.y * GRID + c.x, c])) };
}

export const BLUEPRINTS: Record<string, LoadedBlueprint> = Object.fromEntries(
  BLUEPRINT_FILES.map((b) => [b.id, load(b as Blueprint)]),
);

/** Ids a weight set may name; 'none' means no blueprint. */
export const BLUEPRINT_IDS = ['none', ...Object.keys(BLUEPRINTS)];

export const blueprintOf = (id: string | undefined): LoadedBlueprint | null => (id && id !== 'none' ? BLUEPRINTS[id] ?? null : null);
