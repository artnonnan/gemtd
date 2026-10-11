/**
 * Heuristic bot. nextAction() only looks at the game and returns one move; applyAction() makes it.
 * Keeping the two apart lets headless runs, the browser auto-play and replays share every decision.
 */
import { GEMS_PER_ROUND, GRID, toTiles, type Point } from '../game/config';
import type { Game, Tower } from '../game/game';
import { blockedGrid, findRouteSegments, joinSegments, pathCost, rerouteAround } from '../game/path';
import { mulberry32 } from '../game/rng';
import { GEM_INFO, QUALITY_CHANCES, RECIPES, TOWERS, WAVES, abilityOf, qualityUpgradeCost, MAX_QUALITY_LEVEL } from '../data/gems';
import { SLATE_TELEPORT_RANGE, isSlate } from '../data/slates';
import { AIR_PATH, AIR_WAVE_SHARE, GEM_ODDS, cover, dpsMaps, exposureOf, hitsAir, hitsGround, type DpsMaps } from './exposure';
import type { Weights } from './weights';
import { blueprintOf, isTowerSpot, type BlueprintCell, type LoadedBlueprint } from './blueprint';

export type Action =
  | { type: 'quality' }
  | { type: 'place'; x: number; y: number }
  | { type: 'special'; x: number; y: number; result: string }
  | { type: 'combine'; x: number; y: number; count: 2 | 4 }
  | { type: 'keep'; x: number; y: number }
  /** keep the gem one quality lower (Downgrade) */
  | { type: 'downgrade'; x: number; y: number }
  | { type: 'upgrade'; x: number; y: number; target: string }
  | { type: 'buyLife' }
  | { type: 'slate'; x: number; y: number; result: string }
  /** slates are off the tile grid: (x, y) is the slate's current spot, (tx, ty) where it goes (half tiles) */
  | { type: 'teleport'; x: number; y: number; tx: number; ty: number }
  | { type: 'slateSpecial'; x: number; y: number; result: string }
  | { type: 'removeRock'; x: number; y: number };

const LIFE_COST = 10;
/** Summon / Summon Air: the boss waves (same rule as the analyzer's waveKind) */
const isBossWave = (level: number) => /^Summon( Air)?$/.test(WAVES[level - 1]?.name ?? '');
const AIR_SLATE = 'n000';
/** a teleport must gain at least this many covered path tiles */
const TELEPORT_MIN_GAIN = 1;

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

  /** the ground route once every plan cell is built (keepFuture), searched on first use */
  private planRoute: Point[] | null | undefined;

  private finishedRoute(): Point[] | null {
    if (this.planRoute === undefined) {
      const bp = this.blueprint;
      const walls = new Set(bp ? bp.sorted.map((c) => c.y * GRID + c.x) : []);
      const segs = bp ? findRouteSegments(blockedGrid((x, y) => walls.has(y * GRID + x))) : null;
      this.planRoute = segs ? joinSegments(segs) : null;
    }
    return this.planRoute;
  }

  /**
   * Path a kept tower at (x, y) reaches: now, or with keepFuture a blend of now and the finished plan's route.
   * A tower stays all game, so a spot the route will loop around later can beat one that is busy only now.
   */
  private chooseCoverage(game: Game, id: string, x: number, y: number, aura: boolean): number {
    const now = aura ? this.spotCoverage(game, id, x, y) : this.keepCoverage(game, id, x, y);
    const f = this.weights.keepFuture;
    const route = f > 0 ? this.finishedRoute() : null;
    if (!route) return now;
    const later = aura ? this.spotCoverage(game, id, x, y, route) : this.keepCoverage(game, id, x, y, route);
    return (1 - f) * now + f * later;
  }

  /** The next move for the current phase, or null when the bot has nothing to do right now. */
  nextAction(game: Game): Action | null {
    switch (game.phase) {
      case 'build':
        return this.slateMoveAction(game) ?? this.bossLifeAction(game) ?? this.qualityAction(game) ?? this.rockAction(game) ?? this.placeAction(game);
      case 'choose':
        return this.chooseAction(game);
      case 'wave':
        return this.slateMoveAction(game) ?? this.lifeAction(game) ?? this.upgradeAction(game);
      default:
        return null;
    }
  }

  // ---------- slates ----------

  /** board version at which each slate (uid) was last found with no better spot, so the search runs once per change */
  private teleportChecked = new Map<number, number>();

  /** Combine two slates into a special one, else teleport a slate that has not moved yet. */
  private slateMoveAction(game: Game): Action | null {
    const w = this.weights;
    if (w.slateCombine) {
      for (const t of game.towers) {
        const o = game.slateSpecialOptions(t)[0];
        if (o) return { type: 'slateSpecial', x: t.x, y: t.y, result: o.result };
      }
    }
    if (w.slateTeleport) {
      for (const t of game.towers) {
        if (!game.canTeleport(t) || this.teleportChecked.get(t.uid) === game.version) continue;
        const spot = this.bestSlateSpot(game, t);
        if (spot) return { type: 'teleport', x: t.x, y: t.y, tx: spot.x, ty: spot.y };
        this.teleportChecked.set(t.uid, game.version);
      }
    }
    return null;
  }

  /** Path tiles a slate standing at (x, y) reaches: the ground route (loops count again), plus the flight path if it hits air. */
  private slateCoverage(game: Game, id: string, x: number, y: number): number {
    const a = abilityOf(id);
    const range = toTiles(TOWERS[id].range);
    let c = 0;
    if (hitsGround(id)) c += (1 - AIR_WAVE_SHARE) * cover(game.route, x, y, range);
    if (hitsAir(id)) c += AIR_WAVE_SHARE * cover(AIR_PATH, x, y, a.airRange ? toTiles(a.airRange) : range);
    return c;
  }

  /** The teleport spot (half tiles) that reaches the most path, if it beats staying put. */
  private bestSlateSpot(game: Game, t: Tower): Point | null {
    const reach = toTiles(SLATE_TELEPORT_RANGE);
    let best: Point | null = null;
    let bestV = this.slateCoverage(game, t.id, t.x, t.y) + TELEPORT_MIN_GAIN;
    for (let y = Math.ceil((t.y - reach) * 2) / 2; y <= t.y + reach; y += 0.5) {
      for (let x = Math.ceil((t.x - reach) * 2) / 2; x <= t.x + reach; x += 0.5) {
        if (!game.teleportSpotOk(t, x, y)) continue;
        const v = this.slateCoverage(game, t.id, x, y);
        if (v > bestV) {
          best = { x, y };
          bestV = v;
        }
      }
    }
    return best;
  }

  /** An air wave within the next 4 levels (the one about to start included). */
  private airSoon(game: Game): boolean {
    for (let l = game.level; l < game.level + 4; l++) if (WAVES[l - 1]?.air) return true;
    return false;
  }

  // ---------- rocks on the plan's slots ----------

  /** level whose rocks were already cleared, and the slots cleared then that still wait for a gem */
  private clearedLevel = 0;
  private refill: Point[] = [];

  /**
   * Before the first gem of a level: take rocks off blueprint slots (earliest in build order first), at most
   * rockClear of them. placeAction puts this level's first gems back on those tiles, so the board around them
   * is the same as when the rocks stood there and the route is never cut.
   */
  private rockAction(game: Game): Action | null {
    const bp = this.blueprint;
    if (!this.weights.rockClear || !bp || game.level < this.weights.rockClearFromLevel) return null;
    if (game.gemsLeft < GEMS_PER_ROUND || this.clearedLevel === game.level) return null;
    if (this.refill.length < Math.min(this.weights.rockClear, GEMS_PER_ROUND)) {
      const c = bp.sorted.find((c) => isTowerSpot(c) && game.isRock(c.x, c.y));
      if (c) {
        this.refill.push({ x: c.x, y: c.y });
        return { type: 'removeRock', x: c.x, y: c.y };
      }
    }
    this.clearedLevel = game.level;
    return null;
  }

  // ---------- centre first ----------

  /** level whose centre gem was found good (or the centre ran out), so the rest of its gems build the plan */
  private centreDoneLevel = 0;

  /**
   * centreFirst: gems go on the plan's slots, in build order, until one of this level's gems there is good.
   * With no free slot, a rock on a slot is removed and the very next move puts a gem on it, so the blocked
   * tiles at the wave are the same as without the swap.
   */
  private centreAction(game: Game): Action | null {
    const bp = this.blueprint!, w = this.weights;
    if (this.centreDoneLevel === game.level) return null;
    const slots = bp.sorted.filter(isTowerSpot);
    const onSlot = (t: Tower) => slots.some((c) => c.x === t.x && c.y === t.y);
    if (game.freshTowers.some((t) => onSlot(t) && this.isGoodGem(game, t))) {
      this.centreDoneLevel = game.level;
      return null;
    }
    const free = slots.find((c) => !game.towerAt(c.x, c.y) && !game.isRock(c.x, c.y) && game.canPlace(c.x, c.y));
    if (free) return { type: 'place', x: free.x, y: free.y };
    const rocks = slots.filter((c) => game.isRock(c.x, c.y));
    if (rocks.length && rocks.length / slots.length >= w.centreRockShare) return { type: 'removeRock', x: rocks[0].x, y: rocks[0].y };
    this.centreDoneLevel = game.level;
    return null;
  }

  /** Strong enough on its own, or the last missing ingredient of a special with what stands on the board. */
  private isGoodGem(game: Game, t: Tower): boolean {
    if (towerPower(t.id, this.weights) >= this.weights.centreGoodPower) return true;
    const ids = game.towers.filter((o) => !isSlate(o.id)).map((o) => o.id);
    return RECIPES.some((r) => {
      if (!r.ingredients.includes(t.id)) return false;
      const left = [...ids];
      return r.ingredients.every((ing) => {
        const i = left.indexOf(ing);
        if (i < 0) return false;
        left.splice(i, 1);
        return true;
      });
    });
  }

  private qualityAction(game: Game): Action | null {
    const w = this.weights;
    if (game.qualityLevel >= Math.min(w.qualityMaxLevel, MAX_QUALITY_LEVEL)) return null;
    const reserve = w.qualityRushLevel && game.level >= w.qualityRushLevel ? 0 : w.qualityReserve;
    if (game.gold < qualityUpgradeCost(game.qualityLevel) + reserve) return null;
    if (w.chippedHold && this.holdForChipped(game)) return null;
    this.heldLevels = 0;
    return { type: 'quality' };
  }

  // ---------- chipped hold ----------

  /** levels in a row a quality upgrade was put off for a missing Chipped gem, and the last level counted */
  private heldLevels = 0;
  private heldAt = 0;

  /**
   * chippedHold: a special recipe in progress (an ingredient kept) still misses a Chipped gem, and Chipped gems still roll.
   * Quality is held back (higher quality rolls fewer Chipped) for up to chippedHold levels; after that it goes ahead anyway.
   */
  private holdForChipped(game: Game): boolean {
    if (!(QUALITY_CHANCES[game.qualityLevel]?.[0] > 0) || !this.missingChipped(game)) {
      this.heldLevels = 0;
      return false;
    }
    if (this.heldAt !== game.level) {
      this.heldAt = game.level;
      this.heldLevels++;
    }
    return this.heldLevels <= this.weights.chippedHold;
  }

  private missingChipped(game: Game): boolean {
    const kept = game.towers.filter((t) => !t.fresh).map((t) => t.id);
    return RECIPES.some((r) => {
      if (kept.includes(r.result)) return false;
      const left = [...kept];
      const missing = r.ingredients.filter((ing) => {
        const i = left.indexOf(ing);
        if (i < 0) return true;
        left.splice(i, 1);
        return false;
      });
      return missing.length > 0 && missing.length < r.ingredients.length && missing.some((id) => GEM_INFO[id]?.quality === 0);
    });
  }

  /**
   * Scores every free tile with cheap checks first, then asks game.canPlace (a pathfind for route tiles)
   * only for the best ones until one fits. Calling canPlace on every tile cost ~95% of a bot game.
   */
  private placeAction(game: Game): Action | null {
    const w = this.weights;
    while (this.refill.length) {
      const p = this.refill.shift()!;
      if (game.canPlace(p.x, p.y)) return { type: 'place', x: p.x, y: p.y };
    }
    const centre = w.centreFirst && this.blueprint ? this.centreAction(game) : null;
    if (centre) return centre;
    // planFirst: the next plan cell in build order, scores ignored, until no plan cell can be built
    if (w.planFirst && this.blueprint) {
      const c = this.blueprint.sorted.find(
        (c) => !(c.role === 'reserve' && game.level < (c.unlockLevel ?? 0)) && !game.towerAt(c.x, c.y) && !game.isRock(c.x, c.y) && game.canPlace(c.x, c.y),
      );
      if (c) return { type: 'place', x: c.x, y: c.y };
    }
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
  private keepCoverage(game: Game, id: string, x: number, y: number, route: Point[] = game.route): number {
    const a = abilityOf(id);
    const range = toTiles(TOWERS[id].range);
    let c = 0;
    if (hitsGround(id)) c += (1 - AIR_WAVE_SHARE) * cover(route, x, y, range);
    if (hitsAir(id)) c += AIR_WAVE_SHARE * cover(AIR_PATH, x, y, a.airRange ? toTiles(a.airRange) : range);
    return c;
  }

  /** Opal's attack speed aura, worth its share of the power of the kept towers it reaches. */
  private auraPower(id: string, x: number, y: number, kept: Tower[]): number {
    const aura = abilityOf(id).auraSpeed;
    if (!aura) return 0;
    const r = toTiles(aura.range);
    let sum = 0;
    for (const t of kept) if ((t.x - x) ** 2 + (t.y - y) ** 2 <= r * r && !(t.x === x && t.y === y)) sum += towerPower(t.id, this.weights);
    return aura.pct * sum;
  }

  /** keepCoverage, but a tower with an aura (Star Ruby's burn) is judged by the path inside the aura. */
  private spotCoverage(game: Game, id: string, x: number, y: number, route: Point[] = game.route): number {
    const burn = abilityOf(id).burn;
    if (!burn) return this.keepCoverage(game, id, x, y, route);
    const r = toTiles(burn.range);
    return (1 - AIR_WAVE_SHARE) * cover(route, x, y, r) + AIR_WAVE_SHARE * cover(AIR_PATH, x, y, r);
  }

  private chooseAction(game: Game): Action | null {
    const w = this.weights;
    let best: { a: Action; v: number } | null = null;
    const kept = w.typeDiversity > 0 || w.auraValue > 0 ? game.towers.filter((t) => !t.fresh && !isSlate(t.id)) : [];
    const kindOf = (id: string) => GEM_INFO[id]?.type ?? id;
    const consider = (a: Action, result: string, bonus: number) => {
      let p = towerPower(result, w);
      const at = a as { x: number; y: number };
      if (w.auraValue > 0) p += w.auraValue * this.auraPower(result, at.x, at.y, kept);
      if (w.typeDiversity > 0) {
        // the same gem type (or the same special) already standing makes another one worth less
        const same = kept.filter((t) => kindOf(t.id) === kindOf(result) && !(t.x === at.x && t.y === at.y)).length;
        p *= Math.max(0.1, 1 - (w.typeDiversity * same) / 10);
      }
      if (this.blueprint && w.slotKeepBonus > 0 && isTowerSpot(this.blueprint.at.get((a as { y: number }).y * GRID + (a as { x: number }).x))) {
        p *= 1 + w.slotKeepBonus;
      }
      if (a.type === 'special' && w.specialSpot) {
        p *= 1 + (Math.max(1, w.keepExposure) * this.chooseCoverage(game, result, a.x, a.y, true)) / 10;
      } else if (w.keepExposure > 0 && a.type !== 'quality' && a.type !== 'buyLife') {
        p *= 1 + (w.keepExposure * this.chooseCoverage(game, result, (a as { x: number }).x, (a as { y: number }).y, false)) / 10;
      }
      const v = p + bonus;
      if (!best || v > best.v) best = { a, v };
    };
    const recipe = w.recipeProgress > 0 ? this.recipeState(game) : null;
    const plan = (id: string) => (recipe ? this.recipeBonus(recipe, id) : 0);
    // with specialSpot, a special may also form on a kept ingredient (the round's gems then all turn to rock)
    if (w.specialSpot) {
      for (const t of game.towers) {
        if (t.fresh || isSlate(t.id)) continue;
        for (const r of game.specialOptions(t)) consider({ type: 'special', x: t.x, y: t.y, result: r.result }, r.result, w.specialBonus);
      }
    }
    for (const t of game.freshTowers) {
      for (const r of game.specialOptions(t)) consider({ type: 'special', x: t.x, y: t.y, result: r.result }, r.result, w.specialBonus);
      for (const o of game.combineOptions(t)) {
        consider({ type: 'combine', x: t.x, y: t.y, count: o.count }, o.result, (o.count === 4 ? w.combine4Bonus : w.combine2Bonus) + plan(o.result));
      }
      consider({ type: 'keep', x: t.x, y: t.y }, t.id, plan(t.id));
      const lower = w.downgradeForRecipe ? game.downgradeOption(t) : null;
      if (lower) consider({ type: 'downgrade', x: t.x, y: t.y }, lower, plan(lower));
      if (w.slateBonus > 0) {
        for (const r of game.slateOptions(t)) {
          const bonus = w.slateBonus + (r.result === AIR_SLATE && this.airSoon(game) ? w.airSlateBonus : 0);
          consider({ type: 'slate', x: t.x, y: t.y, result: r.result }, r.result, bonus);
        }
      }
    }
    return best ? (best as { a: Action }).a : null;
  }

  private lifeAction(game: Game): Action | null {
    return game.lives < this.weights.buyLifeBelow && game.gold >= LIFE_COST ? { type: 'buyLife' } : null;
  }

  // ---------- recipe planning ----------

  /** Gems already kept on the board, and the specials already standing (their recipes are done). */
  private recipeState(game: Game): { owned: Set<string>; made: Set<string> } {
    const owned = new Set<string>(), made = new Set<string>();
    for (const t of game.towers) {
      if (t.fresh) continue;
      owned.add(t.id);
      made.add(t.id);
    }
    return { owned, made };
  }

  /**
   * How much keeping `id` advances the best unmade recipe: recipeProgress × (ingredients owned after / size) × power of
   * that special. Only for an ingredient not already on the board, so a strong special far away still beats a cheap one.
   */
  private recipeBonus(s: { owned: Set<string>; made: Set<string> }, id: string): number {
    if (s.owned.has(id)) return 0;
    let best = 0;
    for (const r of RECIPES) {
      if (!r.ingredients.includes(id) || s.made.has(r.result)) continue;
      const have = r.ingredients.filter((i) => s.owned.has(i)).length;
      best = Math.max(best, ((have + 1) / r.ingredients.length) * towerPower(r.result, this.weights));
    }
    return this.weights.recipeProgress * best;
  }

  /** Before a boss wave: top lives up to bossLifeTarget while the gem placement is still going on. */
  private bossLifeAction(game: Game): Action | null {
    const target = this.weights.bossLifeTarget;
    if (!target || !isBossWave(game.level) || game.lives >= target || game.gold < LIFE_COST) return null;
    return { type: 'buyLife' };
  }

  private upgradeAction(game: Game): Action | null {
    const w = this.weights;
    // qualityFirst: the next gem quality upgrade is paid for before any tower upgrade
    const qualityLeft = game.qualityLevel < Math.min(w.qualityMaxLevel, MAX_QUALITY_LEVEL);
    const reserve = w.upgradeReserve + (w.qualityFirst && qualityLeft ? qualityUpgradeCost(game.qualityLevel) : 0);
    if (!w.upgradeFocus) {
      for (const t of game.towers) {
        const opt = game.upgradeOptions(t).sort((a, b) => a.cost - b.cost)[0];
        if (opt && game.gold >= opt.cost + reserve) return { type: 'upgrade', x: t.x, y: t.y, target: opt.id };
      }
      return null;
    }
    // the affordable upgrade with the most power gained per gold, weighted by how much path the tower reaches
    let best: { a: Action; v: number } | null = null;
    for (const t of game.towers) {
      if (isSlate(t.id)) continue;
      for (const opt of game.upgradeOptions(t)) {
        if (game.gold < opt.cost + reserve) continue;
        const gain = Math.max(0, towerPower(opt.id, w) - towerPower(t.id, w)) / Math.max(1, opt.cost);
        const v = gain * (1 + (w.upgradeFocus * this.keepCoverage(game, opt.id, t.x, t.y)) / 10);
        if (!best || v > best.v) best = { a: { type: 'upgrade', x: t.x, y: t.y, target: opt.id }, v };
      }
    }
    return best?.a ?? null;
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
  if (a.type === 'removeRock') return game.removeRock(a.x, a.y);
  if (a.type === 'teleport' || a.type === 'slateSpecial') {
    // slates are off the tile grid: find this one by its spot
    const s = game.towers.find((o) => isSlate(o.id) && o.x === a.x && o.y === a.y);
    if (!s) return false;
    if (a.type === 'slateSpecial') return game.combineSlates(s, a.result);
    return game.beginTeleport(s) && game.teleportTo(a.tx, a.ty);
  }
  const t = game.towerAt(a.x, a.y);
  if (!t) return false;
  switch (a.type) {
    case 'slate': {
      const r = game.slateOptions(t).find((o) => o.result === a.result);
      return !!r && game.createSlate(t, r);
    }
    case 'special': {
      const r = game.specialOptions(t).find((o) => o.result === a.result);
      return !!r && game.makeSpecial(t, r);
    }
    case 'combine':
      return game.combine(t, a.count);
    case 'keep':
      return game.keep(t);
    case 'downgrade':
      return game.keepDowngraded(t);
    case 'upgrade':
      return game.upgradeTower(t, a.target);
  }
}
