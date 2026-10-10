/**
 * Heuristic bot. nextAction() only looks at the game and returns one move; applyAction() makes it.
 * Keeping the two apart lets headless runs, the browser auto-play and replays share every decision.
 */
import { GRID, toTiles, type Point } from '../game/config';
import type { Game } from '../game/game';
import { blockedGrid, findRouteSegments, joinSegments, pathCost, rerouteAround } from '../game/path';
import { mulberry32 } from '../game/rng';
import { TOWERS, abilityOf, qualityUpgradeCost, MAX_QUALITY_LEVEL } from '../data/gems';
import { AIR_PATH, AIR_WAVE_SHARE, GEM_ODDS, cover, dpsMaps, exposureOf, hitsAir, hitsGround, type DpsMaps } from './exposure';
import type { Weights } from './weights';
import { blueprintOf, isTowerSpot, type BlueprintCell, type LoadedBlueprint } from './blueprint';

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

/** Fire reaching each tile and the current ground exposure, shared by every candidate in one placement. */
interface Exposure {
  maps: DpsMaps;
  route: Point[];
  base: number;
}

/** Every route leg searched again with (x, y) blocked, exactly as the game will after the gem goes down. */
function fullReroute(grid: Uint8Array, x: number, y: number): Point[][] | null {
  const i = y * GRID + x;
  const prev = grid[i];
  grid[i] = 1;
  try {
    return findRouteSegments(grid);
  } finally {
    grid[i] = prev;
  }
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
  /** the maze plan this bot follows, if any */
  readonly blueprint: LoadedBlueprint | null;

  constructor(readonly weights: Weights, seed: number) {
    this.rng = mulberry32(seed);
    this.blueprint = weights.blueprintWeight > 0 ? blueprintOf(weights.blueprintId) : null;
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
    const w = this.weights;
    const onRoute = new Set(game.route.map((p) => p.y * GRID + p.x));
    let maze: Maze | null = null;
    if (w.mazeGain > 0 || w.groundExposure > 0) {
      const grid = blockedGrid((bx, by) => !!game.towerAt(bx, by) || game.isRock(bx, by));
      const segs = findRouteSegments(grid);
      if (segs) maze = { grid, segs, cost: pathCost(segs) };
    }
    let exp: Exposure | null = null;
    if (w.groundExposure > 0 || w.airExposure > 0) {
      const maps = dpsMaps(game);
      exp = { maps, route: game.route, base: exposureOf(game.route, maps.ground) };
    }
    const plan = this.planBonus(game);
    const cands: { x: number; y: number; v: number }[] = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (game.towerAt(x, y) || game.isRock(x, y) || game.isReserved(x, y)) continue;
        const v = this.tileValue(x, y, onRoute, maze, exp);
        if (v !== null) cands.push({ x, y, v: v + (plan?.get(y * GRID + x) ?? 0) });
      }
    }
    cands.sort((a, b) => b.v - a.v);
    const best = cands.find((c) => game.canPlace(c.x, c.y));
    return best ? { type: 'place', x: best.x, y: best.y } : null;
  }

  /**
   * Bonus for the next plan cells: the first blueprintWindow cells (in build order) that are still empty and
   * can be built right now. The first gets 10 × blueprintWeight, later ones step down. A plan cell that is taken
   * or would cut the route (other gems and rocks can make that happen) is skipped, so the window moves on.
   * Reserve cells join only from their unlock level. Hub cells, and reserve cells still locked, cost
   * 10 × reserveRespect instead, so the bot keeps them free.
   */
  private planBonus(game: Game): Map<number, number> | null {
    const bp = this.blueprint;
    if (!bp) return null;
    const w = this.weights;
    const out = new Map<number, number>();
    const locked = (c: BlueprintCell) => c.role === 'reserve' && game.level < (c.unlockLevel ?? 0);
    let rank = 0;
    for (const c of bp.sorted) {
      if (rank >= w.blueprintWindow) break;
      if (locked(c) || game.towerAt(c.x, c.y) || game.isRock(c.x, c.y) || !game.canPlace(c.x, c.y)) continue;
      out.set(c.y * GRID + c.x, 10 * w.blueprintWeight * (1 - rank / w.blueprintWindow));
      rank++;
    }
    if (w.reserveRespect > 0) {
      for (const c of bp.at.values()) if (c.role === 'hub' || locked(c)) out.set(c.y * GRID + c.x, -10 * w.reserveRespect);
    }
    return out;
  }

  /** null = the tile would cut the route */
  private tileValue(x: number, y: number, onRoute: Set<number>, maze: Maze | null, exp: Exposure | null): number | null {
    const w = this.weights;
    const blocksRoute = onRoute.has(y * GRID + x);
    // the route legs if this tile is blocked (one search answers "can I" and "what does it do to the route")
    let segs: Point[][] | null | undefined;
    if (maze && blocksRoute && (w.mazeGain > 0 || exp)) {
      // exposure needs the exact tiles creeps will walk: the game re-searches every leg after a placement, and
      // equal-length legs can tie-break differently (~15% of tiles), so search them all the same way.
      // Mazing alone only needs the length, which re-searching the touched legs gives exactly and faster.
      segs = exp ? fullReroute(maze.grid, x, y) : rerouteAround(maze.grid, maze.segs, x, y);
      if (!segs) return null;
    }
    let v: number;
    if (w.mazeGain > 0 && segs) {
      // how much longer does the route get?
      v = w.mazeGain * (pathCost(segs) - maze!.cost) + w.mazeBonus;
    } else {
      // prefer tiles next to the route so gems cover it
      let near = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((dx || dy) && nx >= 0 && nx < GRID && ny >= 0 && ny < GRID && onRoute.has(ny * GRID + nx)) near++;
        }
      }
      v = w.routeAdjacency * near + this.rng() * w.tieNoise;
    }
    if (exp) v += this.exposureGain(x, y, segs ?? null, exp);
    return v;
  }

  /**
   * Fire gained along the creeps' paths by putting a gem here, in "tiles covered by an average tower".
   * Ground: the new gem's coverage of the (possibly rerouted) path, plus how the reroute changes the fire
   * from towers already standing; a block that sends creeps around them comes out negative.
   * Air: the flight path never changes, so only the new gem's coverage counts.
   * The gem is rolled on placement, so its range and targets are the odds over all base gems.
   */
  private exposureGain(x: number, y: number, segs: Point[][] | null, exp: Exposure): number {
    const w = this.weights;
    let gain = 0;
    if (w.groundExposure > 0) {
      const path = segs ? joinSegments(segs) : exp.route;
      const rerouted = segs ? (exposureOf(path, exp.maps.ground) - exp.base) / exp.maps.meanDps : 0;
      gain += w.groundExposure * (rerouted + GEM_ODDS.ground * cover(path, x, y, GEM_ODDS.range));
    }
    if (w.airExposure > 0) gain += w.airExposure * GEM_ODDS.air * cover(AIR_PATH, x, y, GEM_ODDS.range);
    return gain;
  }

  /** Path tiles a tower of this kind would reach from (x, y): ground path, plus the flight path weighted by how often waves fly. */
  private keepCoverage(game: Game, id: string, x: number, y: number): number {
    const a = abilityOf(id);
    const range = toTiles(TOWERS[id].range);
    let c = 0;
    if (hitsGround(id)) c += (1 - AIR_WAVE_SHARE) * cover(game.route, x, y, range);
    if (hitsAir(id)) c += AIR_WAVE_SHARE * cover(AIR_PATH, x, y, a.airRange ? toTiles(a.airRange) : range);
    return c;
  }

  private chooseAction(game: Game): Action | null {
    const w = this.weights;
    let best: { a: Action; v: number } | null = null;
    const consider = (a: Action, result: string, bonus: number) => {
      let p = towerPower(result, w);
      if (this.blueprint && w.slotKeepBonus > 0 && isTowerSpot(this.blueprint.at.get((a as { y: number }).y * GRID + (a as { x: number }).x))) {
        p *= 1 + w.slotKeepBonus;
      }
      if (w.keepExposure > 0 && a.type !== 'quality' && a.type !== 'buyLife') {
        p *= 1 + (w.keepExposure * this.keepCoverage(game, result, (a as { x: number }).x, (a as { y: number }).y)) / 10;
      }
      const v = p + bonus;
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
