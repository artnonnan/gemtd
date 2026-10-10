/**
 * Heuristic bot. nextAction() only looks at the game and returns one move; applyAction() makes it.
 * Keeping the two apart lets headless runs, the browser auto-play and replays share every decision.
 */
import { GRID, toTiles, type Point } from '../game/config';
import type { Game } from '../game/game';
import { blockedGrid, findRouteSegments, pathCost, rerouteAround } from '../game/path';
import { mulberry32 } from '../game/rng';
import { TOWERS, abilityOf, qualityUpgradeCost, MAX_QUALITY_LEVEL } from '../data/gems';
import type { Weights } from './weights';

export type Action =
  | { type: 'quality' }
  | { type: 'place'; x: number; y: number }
  | { type: 'special'; x: number; y: number; result: string }
  | { type: 'combine'; x: number; y: number; count: 2 | 4 }
  | { type: 'keep'; x: number; y: number }
  | { type: 'upgrade'; x: number; y: number; target: string }
  | { type: 'buyLife' };

const LIFE_COST = 10;

/** Route legs of the current board, shared by every mazing candidate in one placement. */
interface Maze {
  grid: Uint8Array;
  segs: Point[][];
  cost: number;
}

/** Rough damage per second, adjusted by the weights' taste for slow, splash and anti-air. */
export function towerPower(id: string, w: Weights): number {
  const d = TOWERS[id];
  const a = abilityOf(id);
  let p = ((d.dmg + (d.dice * (d.sides + 1)) / 2) / d.cd) * (a.multi ?? 1) * (a.crit ? 1 + a.crit.chance * (a.crit.mult - 1) : 1);
  p += a.burn?.dps ?? 0;
  const slow = Math.max(a.slow?.pct ?? 0, a.poison?.slow ?? 0, a.burn?.slow ?? 0);
  p *= 1 + w.slowValue * slow;
  if (a.splash) p *= 1 + w.splashValue * toTiles(a.splash);
  if (a.targets !== 'ground') p *= w.airValue;
  return p;
}

export class Bot {
  /** tie-break randomness, seeded so a bot game replays exactly */
  private rng: () => number;

  constructor(readonly weights: Weights, seed: number) {
    this.rng = mulberry32(seed);
  }

  /** The next move for the current phase, or null when the bot has nothing to do right now. */
  nextAction(game: Game): Action | null {
    switch (game.phase) {
      case 'build':
        return this.qualityAction(game) ?? this.placeAction(game);
      case 'choose':
        return this.chooseAction(game);
      case 'wave':
        return this.lifeAction(game) ?? this.upgradeAction(game);
      default:
        return null;
    }
  }

  private qualityAction(game: Game): Action | null {
    const w = this.weights;
    if (game.qualityLevel >= Math.min(w.qualityMaxLevel, MAX_QUALITY_LEVEL)) return null;
    return game.gold >= qualityUpgradeCost(game.qualityLevel) + w.qualityReserve ? { type: 'quality' } : null;
  }

  /**
   * Scores every free tile with cheap checks first, then asks game.canPlace (a pathfind for route tiles)
   * only for the best ones until one fits. Calling canPlace on every tile cost ~95% of a bot game.
   */
  private placeAction(game: Game): Action | null {
    const onRoute = new Set(game.route.map((p) => p.y * GRID + p.x));
    let maze: Maze | null = null;
    if (this.weights.mazeGain > 0) {
      const grid = blockedGrid((bx, by) => !!game.towerAt(bx, by) || game.isRock(bx, by));
      const segs = findRouteSegments(grid);
      if (segs) maze = { grid, segs, cost: pathCost(segs) };
    }
    const cands: { x: number; y: number; v: number }[] = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (game.towerAt(x, y) || game.isRock(x, y) || game.isReserved(x, y)) continue;
        const v = this.tileValue(x, y, onRoute, maze);
        if (v !== null) cands.push({ x, y, v });
      }
    }
    cands.sort((a, b) => b.v - a.v);
    const best = cands.find((c) => game.canPlace(c.x, c.y));
    return best ? { type: 'place', x: best.x, y: best.y } : null;
  }

  /** null = the tile would cut the route */
  private tileValue(x: number, y: number, onRoute: Set<number>, maze: Maze | null): number | null {
    const w = this.weights;
    if (maze && onRoute.has(y * GRID + x)) {
      // how much longer does the route get if this tile is blocked? (one search answers "can I" and "how much")
      const segs = rerouteAround(maze.grid, maze.segs, x, y);
      return segs ? w.mazeGain * (pathCost(segs) - maze.cost) + w.mazeBonus : null;
    }
    // prefer tiles next to the route so gems cover it
    let near = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && nx < GRID && ny >= 0 && ny < GRID && onRoute.has(ny * GRID + nx)) near++;
      }
    }
    return w.routeAdjacency * near + this.rng() * w.tieNoise;
  }

  private chooseAction(game: Game): Action | null {
    const w = this.weights;
    let best: { a: Action; v: number } | null = null;
    const consider = (a: Action, result: string, bonus: number) => {
      const v = towerPower(result, w) + bonus;
      if (!best || v > best.v) best = { a, v };
    };
    for (const t of game.freshTowers) {
      for (const r of game.specialOptions(t)) consider({ type: 'special', x: t.x, y: t.y, result: r.result }, r.result, w.specialBonus);
      for (const o of game.combineOptions(t)) {
        consider({ type: 'combine', x: t.x, y: t.y, count: o.count }, o.result, o.count === 4 ? w.combine4Bonus : w.combine2Bonus);
      }
      consider({ type: 'keep', x: t.x, y: t.y }, t.id, 0);
    }
    return best ? (best as { a: Action }).a : null;
  }

  private lifeAction(game: Game): Action | null {
    return game.lives < this.weights.buyLifeBelow && game.gold >= LIFE_COST ? { type: 'buyLife' } : null;
  }

  private upgradeAction(game: Game): Action | null {
    for (const t of game.towers) {
      const opt = game.upgradeOptions(t).sort((a, b) => a.cost - b.cost)[0];
      if (opt && game.gold >= opt.cost + this.weights.upgradeReserve) return { type: 'upgrade', x: t.x, y: t.y, target: opt.id };
    }
    return null;
  }
}

/**
 * Makes a move. Towers are named by tile, not uid: uids keep counting across games in one process,
 * so only positions stay valid when a recorded game is replayed.
 * Returns false if the game refused it (it should not, for a move from nextAction).
 */
export function applyAction(game: Game, a: Action): boolean {
  if (a.type === 'quality') return game.upgradeQuality();
  if (a.type === 'place') return game.placeGem(a.x, a.y);
  if (a.type === 'buyLife') return game.buyLife();
  const t = game.towerAt(a.x, a.y);
  if (!t) return false;
  switch (a.type) {
    case 'special': {
      const r = game.specialOptions(t).find((o) => o.result === a.result);
      return !!r && game.makeSpecial(t, r);
    }
    case 'combine':
      return game.combine(t, a.count);
    case 'keep':
      return game.keep(t);
    case 'upgrade':
      return game.upgradeTower(t, a.target);
  }
}
