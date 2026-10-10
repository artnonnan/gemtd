import {
  CHECKPOINTS, CHECKPOINT_CLEARANCE, CREEPS_PER_WAVE, GEMS_PER_ROUND, GRID, LAST_LEVEL, MAX_LIVES,
  MIN_SPEED_FACTOR, SPAWN_INTERVAL, START_GOLD, START_LIVES, toTiles, type Point,
} from './config';
import { blockedGrid, findRoute, findRouteSegments, rerouteAround, routeLength } from './path';
import { combatSeed, mulberry32, randomSeed } from './rng';
import {
  SLATE_RECIPES, SLATE_SPECIALS, SLATE_STACK_RANGE, SLATE_TELEPORT_RANGE, isSlate, slatesConflict, type SlateRecipe,
} from '../data/slates';
import {
  BASE_GEMS, GEM_INFO, GEM_TYPES, GREAT, MAX_QUALITY_LEVEL, PERFECT, QUALITY_CHANCES, RECIPES, TOWERS, WAVES,
  abilityOf, displayName, qualityUpgradeCost, type Ability, type CreepDef, type Recipe, type Targets,
} from '../data/gems';

export type Phase = 'build' | 'choose' | 'waiting' | 'wave' | 'gameover' | 'victory';

/** Armor bonus every creep gets, like the map's difficulty auras (A00S/A00T/A01E). */
export const DIFFICULTIES = { easy: -3, normal: -1, hard: 2 } as const;
export type Difficulty = keyof typeof DIFFICULTIES;

export interface GameOptions {
  difficulty?: Difficulty;
  /** seeds the gem rolls; versus players share it */
  seed?: number;
  /** versus mode: after choosing, wait in 'waiting' until the match calls beginWave() */
  versus?: boolean;
}

/** Compact board state sent to the opponent. */
export interface BoardSnapshot {
  level: number;
  lives: number;
  gold: number;
  phase: Phase;
  kills: number;
  quality: number;
  /** [x, y, hpFraction, air] */
  creeps: [number, number, number, number][];
  /** only sent when the layout changed: towers as [rawcode, x, y], rocks as tile indices */
  layout?: { towers: [string, number, number][]; rocks: number[] };
}

export interface Tower {
  uid: number;
  id: string;
  x: number;
  y: number;
  cooldown: number;
  kills: number;
  /** damage dealt after armor, not counting overkill (for balance stats) */
  damage: number;
  /** placed this round and still waiting for keep/combine */
  fresh: boolean;
  /** last time it fired, for the muzzle flash */
  firedAt: number;
  /** Swap is single-use per tower; upgrading grants it again (new unit in the original map) */
  swapUsed: boolean;
  /** slates may teleport once (A02J) */
  teleportUsed: boolean;
}

export interface Creep {
  uid: number;
  def: CreepDef;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  path: Point[];
  next: number;
  progress: number;
  alive: boolean;
  slow: number;
  slowUntil: number;
  burnSlow: number;
  burnSlowUntil: number;
  poison: { dps: number; slow: number; until: number; src: Tower } | null;
  stunUntil: number;
  shred: number;
  shredUntil: number;
  /** product of permanent slows (Slow Slate), never below MIN_SPEED_FACTOR in effect */
  permSlow: number;
  permSlowBy: Set<number>;
  /** Wraith Slate flames */
  flames: { stacks: number; until: number; src: Tower } | null;
}

export interface Shot {
  x: number;
  y: number;
  target: Creep;
  tower: Tower;
  color: string;
}

export interface Effect {
  kind: 'ring' | 'text';
  x: number;
  y: number;
  r: number;
  color: string;
  text?: string;
  born: number;
  life: number;
}

/** Things that just happened, for the renderer's animations. Gameplay never reads these. */
export type GameEvent =
  | { type: 'fire'; tower: Tower; tx: number; ty: number }
  | { type: 'hit'; x: number; y: number; creep: number; tower: Tower; crit: boolean; splash: number }
  | { type: 'kill'; x: number; y: number; creep: number; air: boolean }
  | { type: 'transform'; tower: Tower; kind: 'keep' | 'combine' | 'special' | 'upgrade' | 'downgrade' | 'slate' | 'teleport' }
  | { type: 'hold'; tower: Tower; creep: number; x: number; y: number }
  | { type: 'blast'; x: number; y: number; r: number };

export interface CombineOption {
  count: 2 | 4;
  result: string;
}

/** kept: an older tower on the board · fresh: placed this round (a rock unless used) · missing: not on the board */
export type IngredientState = 'kept' | 'fresh' | 'missing';

export interface RecipeStatus {
  recipe: Recipe;
  parts: { id: string; tower: Tower | null; state: IngredientState }[];
  /** ingredients on the board */
  owned: number;
  /** can be made right now (Special button on one of this round's gems) */
  ready: boolean;
}

export const SWAP_COST = 200;

const SHOT_SPEED = 16; // tiles per second
const SPLASH_FACTOR = 0.5;

let nextUid = 1;

export class Game {
  phase: Phase = 'build';
  level = 1;
  gold = START_GOLD;
  lives = START_LIVES;
  qualityLevel = 0;
  gemsLeft = GEMS_PER_ROUND;
  time = 0;

  towers: Tower[] = [];
  rocks = new Set<number>();
  creeps: Creep[] = [];
  shots: Shot[] = [];
  effects: Effect[] = [];
  /** drained by the renderer every frame; capped so headless runs don't grow it forever */
  events: GameEvent[] = [];
  route: Point[] = [];
  routeLen = 0;
  selected: Tower | null = null;
  selectedRock: Point | null = null;
  /** tower waiting for a swap target */
  swapSource: Tower | null = null;
  log: string[] = [];
  stats = { kills: 0, leaked: 0, specials: 0, downgrades: 0, rocksRemoved: 0, swaps: 0, slates: 0 };
  /** slate waiting for a teleport destination */
  teleportSource: Tower | null = null;

  /** bumped on every structural change; UI and caches key off it */
  version = 0;

  private grid: (Tower | null)[] = new Array(GRID * GRID).fill(null);
  private spawnLeft = 0;
  private spawnTimer = 0;
  private placeCache = new Map<number, boolean>();
  private placeCacheVersion = -1;
  /** route legs of the board as it is now (rebuilt per version), so canPlace re-searches only legs a tile touches */
  private legs: { version: number; grid: Uint8Array; segs: Point[][] | null } | null = null;
  private auraCacheVersion = -1;
  private speedBonus = new Map<Tower, number>();
  private damageBonus = new Map<Tower, number>();

  readonly difficulty: Difficulty;
  readonly versus: boolean;
  /** same seed + same actions + fixed STEP updates = same game */
  readonly seed: number;
  /** gem rolls only, so both versus players' gem sequences line up however their fights go */
  private rng: () => number;
  /** dice, crits, procs: a separate stream so combat never shifts the gem rolls */
  private combatRng: () => number;

  constructor(opts: GameOptions = {}) {
    this.difficulty = opts.difficulty ?? 'normal';
    this.versus = opts.versus ?? false;
    this.seed = opts.seed ?? randomSeed();
    this.rng = mulberry32(this.seed);
    this.combatRng = mulberry32(combatSeed(this.seed));
    this.refreshRoute();
    this.say(`Level 1 (${this.difficulty}): place ${GEMS_PER_ROUND} gems, then keep or combine one.`);
  }

  // ---------- board queries ----------

  towerAt(x: number, y: number): Tower | null {
    return this.inBounds(x, y) ? this.grid[y * GRID + x] : null;
  }

  isRock(x: number, y: number): boolean {
    return this.rocks.has(y * GRID + x);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < GRID && y < GRID;
  }

  isReserved(x: number, y: number): boolean {
    return CHECKPOINTS.some((c) => Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) <= CHECKPOINT_CLEARANCE);
  }

  /**
   * Gems and rocks block creeps. Slates are not on the grid: they lie flat (no pathing in the map), so creeps
   * walk over them and gems can be built on top, the slate still working underneath.
   */
  private blocked = (x: number, y: number) => !!this.grid[y * GRID + x] || this.rocks.has(y * GRID + x);

  /** Tile has a gem or a rock on it: nothing else can be built there. */
  private occupied = this.blocked;

  /** Topmost slate whose 1x1 footprint covers a board point (in tiles); slates may sit between tiles. */
  slateAt(bx: number, by: number): Tower | null {
    for (let i = this.towers.length - 1; i >= 0; i--) {
      const t = this.towers[i];
      if (isSlate(t.id) && bx >= t.x && bx < t.x + 1 && by >= t.y && by < t.y + 1) return t;
    }
    return null;
  }

  /** Empty, not reserved, and does not cut the route. */
  canPlace(x: number, y: number): boolean {
    if (!this.inBounds(x, y) || this.occupied(x, y) || this.isReserved(x, y)) return false;
    if (this.placeCacheVersion !== this.version) {
      this.placeCache.clear();
      this.placeCacheVersion = this.version;
    }
    const key = y * GRID + x;
    let ok = this.placeCache.get(key);
    if (ok === undefined) {
      // only tiles on the current route can break it
      const onRoute = this.route.some((p) => p.x === x && p.y === y);
      if (onRoute) {
        if (this.legs?.version !== this.version) {
          const grid = blockedGrid(this.blocked);
          this.legs = { version: this.version, grid, segs: findRouteSegments(grid) };
        }
        ok = !!this.legs.segs && rerouteAround(this.legs.grid, this.legs.segs, x, y) !== null;
      } else {
        ok = true;
      }
      this.placeCache.set(key, ok);
    }
    return ok;
  }

  get nextWave(): CreepDef | undefined {
    return WAVES[this.level - 1];
  }

  /** Difficulty can only change before the first gem goes down. */
  get canChangeDifficulty(): boolean {
    return this.level === 1 && this.phase === 'build' && this.towers.length === 0;
  }

  get freshTowers(): Tower[] {
    return this.towers.filter((t) => t.fresh);
  }

  // ---------- build phase ----------

  placeGem(x: number, y: number): boolean {
    if (this.phase !== 'build' || this.gemsLeft <= 0 || !this.canPlace(x, y)) return false;
    const tower: Tower = { uid: nextUid++, id: this.rollGem(), x, y, cooldown: 0, kills: 0, damage: 0, fresh: true, firedAt: -1, swapUsed: false, teleportUsed: false };
    this.towers.push(tower);
    this.grid[y * GRID + x] = tower;
    this.gemsLeft--;
    this.select(tower);
    this.refreshRoute();
    if (this.gemsLeft === 0) {
      this.phase = 'choose';
      this.say('Choose a gem: Keep it, Combine duplicates, or make a Special.');
      this.hintSpecials();
    }
    this.touch();
    return true;
  }

  private rollGem(): string {
    const type = GEM_TYPES[Math.floor(this.rng() * GEM_TYPES.length)];
    const chances = QUALITY_CHANCES[this.qualityLevel];
    let roll = this.rng() * 100;
    let quality = 0;
    for (; quality < chances.length - 1; quality++) {
      roll -= chances[quality];
      if (roll < 0) break;
    }
    return BASE_GEMS[type][quality];
  }

  upgradeQuality(): boolean {
    if (this.qualityLevel >= MAX_QUALITY_LEVEL) return false;
    const cost = qualityUpgradeCost(this.qualityLevel);
    if (this.gold < cost) return false;
    this.gold -= cost;
    this.qualityLevel++;
    this.say(`Gem quality upgraded to level ${this.qualityLevel}.`);
    this.touch();
    return true;
  }

  // ---------- choose phase ----------

  combineOptions(t: Tower): CombineOption[] {
    if (this.phase !== 'choose' || !t.fresh) return [];
    const info = GEM_INFO[t.id];
    if (!info || info.quality >= GREAT) return [];
    const same = this.freshTowers.filter((o) => o.id === t.id).length;
    const out: CombineOption[] = [];
    if (same >= 2 && info.quality + 1 <= PERFECT) out.push({ count: 2, result: BASE_GEMS[info.type][info.quality + 1] });
    if (same >= 4) out.push({ count: 4, result: BASE_GEMS[info.type][Math.min(info.quality + 2, GREAT)] });
    return out;
  }

  /** Recipes this tower can complete with towers on the board (at least one ingredient placed this round). */
  specialOptions(t: Tower): Recipe[] {
    if (this.phase !== 'choose') return [];
    return RECIPES.filter((r) => {
      const parts = this.recipeParts(t, r);
      return parts !== null && parts.some((p) => p.fresh);
    });
  }

  private recipeParts(t: Tower, r: Recipe): Tower[] | null {
    if (!r.ingredients.includes(t.id)) return null;
    const used = new Set<Tower>([t]);
    let skippedSelf = false;
    for (const ing of r.ingredients) {
      if (ing === t.id && !skippedSelf) {
        skippedSelf = true;
        continue;
      }
      // prefer this round's gems so older towers stay on the board
      const pick =
        this.towers.find((o) => o.fresh && o.id === ing && !used.has(o)) ??
        this.towers.find((o) => o.id === ing && !used.has(o));
      if (!pick) return null;
      used.add(pick);
    }
    return [...used];
  }

  /**
   * Which ingredients of a recipe are on the board, for display. `focus` (the selected tower) fills its own slot.
   * When the focus can make the recipe now, the parts are exactly the towers Special would use up;
   * otherwise they prefer kept towers, which stay put, over this round's gems.
   */
  recipeStatus(r: Recipe, focus?: Tower | null): RecipeStatus {
    const actual = focus?.fresh && this.specialOptions(focus).includes(r) ? this.recipeParts(focus, r) : null;
    const used = new Set<Tower>();
    const slots: (Tower | null)[] = r.ingredients.map(() => null);
    const take = (i: number, t: Tower) => {
      slots[i] = t;
      used.add(t);
    };
    const self = focus ? r.ingredients.indexOf(focus.id) : -1;
    if (focus && self >= 0) take(self, focus);
    r.ingredients.forEach((ing, i) => {
      if (slots[i]) return;
      const free = (o: Tower) => o.id === ing && !used.has(o);
      const pick = actual
        ? actual.find(free)
        : this.towers.find((o) => !o.fresh && free(o)) ?? this.towers.find((o) => o.fresh && free(o));
      if (pick) take(i, pick);
    });
    const parts = r.ingredients.map((id, i) => {
      const tower = slots[i];
      return { id, tower, state: (tower ? (tower.fresh ? 'fresh' : 'kept') : 'missing') as IngredientState };
    });
    return {
      recipe: r,
      parts,
      owned: parts.filter((p) => p.state !== 'missing').length,
      ready: this.freshTowers.some((t) => this.specialOptions(t).includes(r)),
    };
  }

  private emit(e: GameEvent) {
    this.events.push(e);
    if (this.events.length > 600) this.events.splice(0, 300);
  }

  keep(t: Tower): boolean {
    if (this.phase !== 'choose' || !t.fresh) return false;
    this.say(`Kept ${displayName(t.id)}.`);
    this.emit({ type: 'transform', tower: t, kind: 'keep' });
    this.finishRound(t);
    return true;
  }

  /**
   * Downgrade (A02G in the map): a kept Flawed..Perfect base gem may drop one quality, once.
   * The original allows it between Keep and the wave timer; here waves start on Keep, so it is offered as "keep lower".
   */
  downgradeOption(t: Tower): string | null {
    if (this.phase !== 'choose' || !t.fresh) return null;
    const info = GEM_INFO[t.id];
    if (!info || info.quality < 1 || info.quality > PERFECT) return null;
    return BASE_GEMS[info.type][info.quality - 1];
  }

  keepDowngraded(t: Tower): boolean {
    const lower = this.downgradeOption(t);
    if (!lower) return false;
    this.say(`Kept ${displayName(t.id)} downgraded to ${displayName(lower)}.`);
    t.id = lower;
    this.stats.downgrades++;
    this.emit({ type: 'transform', tower: t, kind: 'downgrade' });
    this.finishRound(t);
    return true;
  }

  /** The other gems a combine of `count` uses up. */
  combineParts(t: Tower, count: 2 | 4): Tower[] {
    return this.freshTowers.filter((o) => o !== t && o.id === t.id).slice(0, count - 1);
  }

  combine(t: Tower, count: 2 | 4): boolean {
    const opt = this.combineOptions(t).find((o) => o.count === count);
    if (!opt) return false;
    for (const o of this.combineParts(t, count)) {
      t.kills += o.kills;
      t.damage += o.damage;
      this.toRock(o);
    }
    this.say(`Combined ${count}x ${displayName(t.id)} into ${displayName(opt.result)}.`);
    t.id = opt.result;
    this.emit({ type: 'transform', tower: t, kind: 'combine' });
    this.finishRound(t);
    return true;
  }

  makeSpecial(t: Tower, recipe: Recipe): boolean {
    const parts = this.specialOptions(t).includes(recipe) ? this.recipeParts(t, recipe) : null;
    if (!parts) return false;
    for (const p of parts) {
      if (p === t) continue;
      t.kills += p.kills;
      t.damage += p.damage;
      this.toRock(p);
    }
    t.id = recipe.result;
    this.stats.specials++;
    this.emit({ type: 'transform', tower: t, kind: 'special' });
    this.say(`Created special: ${displayName(recipe.result)}!`);
    this.finishRound(t);
    return true;
  }

  // ---------- slates ----------

  /** Create Slate: the selected Normal gem becomes a slate if a matching Flawed gem was placed this round. */
  slateOptions(t: Tower): SlateRecipe[] {
    if (this.phase !== 'choose' || !t.fresh) return [];
    return SLATE_RECIPES.filter((r) => r.core === t.id && this.slatePartner(t, r));
  }

  /** The Flawed gem of this round that lets `t` become this slate. */
  slatePartner(t: Tower, r: SlateRecipe): Tower | undefined {
    return this.freshTowers.find((o) => o !== t && r.partners.includes(o.id));
  }

  createSlate(t: Tower, recipe: SlateRecipe): boolean {
    if (!this.slateOptions(t).includes(recipe)) return false;
    t.id = recipe.result;
    this.grid[t.y * GRID + t.x] = null; // slates live off the grid
    this.stats.slates++;
    this.say(`Slate created: ${displayName(recipe.result)}. Creeps can walk over it.`);
    this.emit({ type: 'transform', tower: t, kind: 'slate' });
    this.finishRound(t); // the other four become rocks, the slate frees its tile for walking
    return true;
  }

  /** Combine two owned slates into a special slate (Ancient, Wraith, Elder, Viper). */
  slateSpecialOptions(t: Tower): { result: string; partner: Tower }[] {
    if (!isSlate(t.id) || t.fresh || this.phase === 'gameover' || this.phase === 'victory') return [];
    const out: { result: string; partner: Tower }[] = [];
    for (const s of SLATE_SPECIALS) {
      if (!s.ingredients.includes(t.id)) continue;
      const otherId = s.ingredients[0] === t.id ? s.ingredients[1] : s.ingredients[0];
      const partner = this.towers.find((o) => o !== t && o.id === otherId && !o.fresh);
      if (partner) out.push({ result: s.result, partner });
    }
    return out;
  }

  combineSlates(t: Tower, result: string): boolean {
    const opt = this.slateSpecialOptions(t).find((o) => o.result === result);
    if (!opt) return false;
    const p = opt.partner;
    t.kills += p.kills;
    t.damage += p.damage;
    this.towers = this.towers.filter((o) => o !== p);
    if (this.selected === p) this.selected = null;
    t.id = result;
    t.teleportUsed = false;
    this.stats.specials++;
    this.say(`Created special slate: ${displayName(result)}!`);
    this.emit({ type: 'transform', tower: t, kind: 'special' });
    this.refreshRoute();
    this.touch();
    return true;
  }

  canTeleport(t: Tower): boolean {
    return isSlate(t.id) && !t.fresh && !t.teleportUsed && this.phase !== 'gameover' && this.phase !== 'victory';
  }

  beginTeleport(t: Tower): boolean {
    if (!this.canTeleport(t)) return false;
    this.swapSource = null;
    this.teleportSource = t;
    this.say('Teleport: pick a spot in range (half-tile steps, gems and rocks are fine).');
    this.touch();
    return true;
  }

  cancelTeleport() {
    if (!this.teleportSource) return;
    this.teleportSource = null;
    this.touch();
  }

  /**
   * A spot (top-left of the slate, in half-tile steps) within range, on the board, clear of checkpoints,
   * and not within stacking range of a slate of the same kind (the map forbids stacking them).
   * Gems, rocks and other slates may be there: slates have no pathing.
   */
  isTeleportTarget(x: number, y: number): boolean {
    const src = this.teleportSource;
    if (!src || x * 2 !== Math.round(x * 2) || y * 2 !== Math.round(y * 2)) return false;
    if (x < 0 || y < 0 || x > GRID - 1 || y > GRID - 1) return false;
    for (const ty of new Set([Math.floor(y), Math.ceil(y)])) {
      for (const tx of new Set([Math.floor(x), Math.ceil(x)])) if (this.isReserved(tx, ty)) return false;
    }
    if (Math.hypot(x - src.x, y - src.y) > toTiles(SLATE_TELEPORT_RANGE)) return false;
    return !this.towers.some((o) => o !== src && isSlate(o.id) && slatesConflict(o.id, src.id) && Math.hypot(o.x - x, o.y - y) <= toTiles(SLATE_STACK_RANGE));
  }

  teleportTo(x: number, y: number): boolean {
    const src = this.teleportSource;
    if (!src || !this.isTeleportTarget(x, y)) {
      this.cancelTeleport();
      return false;
    }
    src.x = x;
    src.y = y;
    src.teleportUsed = true;
    this.teleportSource = null;
    this.say(`${displayName(src.id)} teleported.`);
    this.emit({ type: 'transform', tower: src, kind: 'teleport' });
    this.touch();
    return true;
  }

  private finishRound(kept: Tower) {
    for (const o of this.freshTowers) if (o !== kept) this.toRock(o);
    kept.fresh = false;
    kept.cooldown = 0;
    this.select(kept);
    this.refreshRoute();
    if (this.versus) {
      this.phase = 'waiting';
      this.touch();
    } else {
      this.startWave();
    }
  }

  /** Versus: the match starts the wave once both players have chosen. */
  beginWave() {
    if (this.phase === 'waiting') this.startWave();
  }

  private toRock(t: Tower) {
    this.towers = this.towers.filter((o) => o !== t);
    this.grid[t.y * GRID + t.x] = null;
    this.rocks.add(t.y * GRID + t.x);
    if (this.selected === t) this.selected = null;
    if (this.swapSource === t) this.swapSource = null;
    if (this.teleportSource === t) this.teleportSource = null;
  }

  // ---------- selection, rocks, swap ----------

  select(t: Tower | null) {
    this.selected = t;
    this.selectedRock = null;
    this.swapSource = null;
    this.teleportSource = null;
    this.touch();
  }

  selectRock(x: number, y: number) {
    if (!this.isRock(x, y)) return;
    this.selected = null;
    this.swapSource = null;
    this.teleportSource = null;
    this.selectedRock = { x, y };
    this.touch();
  }

  /** Remove (A008 on Rock): free and allowed at any time, as in the original. */
  removeRock(x: number, y: number): boolean {
    if (!this.isRock(x, y) || this.phase === 'gameover' || this.phase === 'victory') return false;
    this.rocks.delete(y * GRID + x);
    if (this.selectedRock?.x === x && this.selectedRock.y === y) this.selectedRock = null;
    this.stats.rocksRemoved++;
    // creeps already walking keep their path: it only got more open
    this.refreshRoute();
    this.touch();
    return true;
  }

  /** Towers with the map's Swap ability, not yet used since the last upgrade. */
  canSwap(t: Tower): boolean {
    return !t.fresh && TOWERS[t.id].swap && !t.swapUsed && this.phase !== 'gameover' && this.phase !== 'victory';
  }

  beginSwap(t: Tower): boolean {
    if (!this.canSwap(t) || this.gold < SWAP_COST) return false;
    this.swapSource = t;
    this.say('Swap: pick another gem or a rock.');
    this.touch();
    return true;
  }

  cancelSwap() {
    if (!this.swapSource) return;
    this.swapSource = null;
    this.touch();
  }

  isSwapTarget(x: number, y: number): boolean {
    const src = this.swapSource;
    if (!src) return false;
    const other = this.towerAt(x, y);
    // slates cannot be swapped (the map excludes them as targets)
    return this.isRock(x, y) || (!!other && other !== src && !other.fresh && !isSlate(other.id));
  }

  /** Swap positions with a kept tower or a rock. The set of blocked tiles is unchanged, so the route is too. */
  swapWith(x: number, y: number): boolean {
    const src = this.swapSource;
    if (!src || !this.isSwapTarget(x, y) || this.gold < SWAP_COST) {
      this.cancelSwap();
      return false;
    }
    const other = this.towerAt(x, y);
    const [sx, sy] = [src.x, src.y];
    if (other) {
      [other.x, other.y] = [sx, sy];
      this.grid[sy * GRID + sx] = other;
    } else {
      this.rocks.delete(y * GRID + x);
      this.rocks.add(sy * GRID + sx);
      this.grid[sy * GRID + sx] = null;
    }
    [src.x, src.y] = [x, y];
    this.grid[y * GRID + x] = src;
    this.gold -= SWAP_COST;
    src.swapUsed = true;
    this.swapSource = null;
    this.stats.swaps++;
    this.say(`Swapped ${displayName(src.id)} with ${other ? displayName(other.id) : 'a rock'}.`);
    this.touch();
    return true;
  }

  private hintSpecials() {
    const names = new Set<string>();
    for (const t of this.freshTowers) for (const r of this.specialOptions(t)) names.add(displayName(r.result));
    if (names.size) this.say(`Special available: ${[...names].join(', ')}`);
    const slates = new Set<string>();
    for (const t of this.freshTowers) for (const r of this.slateOptions(t)) slates.add(displayName(r.result));
    if (slates.size) this.say(`Slate available: ${[...slates].join(', ')}`);
  }

  // ---------- upgrades ----------

  upgradeOptions(t: Tower): { id: string; cost: number }[] {
    if (t.fresh) return [];
    return TOWERS[t.id].upgrades.filter((id) => TOWERS[id]).map((id) => ({ id, cost: TOWERS[id].cost }));
  }

  upgradeTower(t: Tower, target: string): boolean {
    const opt = this.upgradeOptions(t).find((o) => o.id === target);
    if (!opt || this.gold < opt.cost) return false;
    this.gold -= opt.cost;
    this.say(`${displayName(t.id)} upgraded to ${displayName(target)}.`);
    t.id = target;
    t.swapUsed = false;
    this.emit({ type: 'transform', tower: t, kind: 'upgrade' });
    this.touch();
    return true;
  }

  // ---------- waves ----------

  private startWave() {
    const def = this.nextWave;
    if (!def) return;
    this.phase = 'wave';
    this.spawnLeft = CREEPS_PER_WAVE;
    this.spawnTimer = 0;
    this.say(`Wave ${this.level}: ${def.name}${def.air ? ' (air)' : ''} — ${def.hp.toLocaleString()} HP`);
    this.touch();
  }

  private spawnCreep(def: CreepDef) {
    const path = def.air ? CHECKPOINTS : this.route;
    const start = path[0];
    this.creeps.push({
      uid: nextUid++, def, hp: def.hp, maxHp: def.hp, x: start.x + 0.5, y: start.y + 0.5, path, next: 1, progress: 0,
      alive: true, slow: 0, slowUntil: 0, burnSlow: 0, burnSlowUntil: 0, poison: null, stunUntil: 0, shred: 0, shredUntil: 0,
      permSlow: 1, permSlowBy: new Set(), flames: null,
    });
  }

  private endWave() {
    this.creeps = [];
    this.shots = [];
    this.effects = [];
    if (this.level >= LAST_LEVEL) {
      this.phase = 'victory';
      this.say('You survived all 50 levels. Victory!');
    } else {
      this.level++;
      this.phase = 'build';
      this.gemsLeft = GEMS_PER_ROUND;
      const w = this.nextWave!;
      this.say(`Level ${this.level}: next is ${w.name}${w.air ? ' (AIR)' : ''}. Place ${GEMS_PER_ROUND} gems.`);
    }
    this.touch();
  }

  // ---------- simulation ----------

  update(dt: number) {
    if (this.phase !== 'wave') return;
    this.time += dt;
    const def = this.nextWave!;

    if (this.spawnLeft > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnCreep(def);
        this.spawnLeft--;
        this.spawnTimer += SPAWN_INTERVAL;
      }
    }

    this.refreshAuras();
    this.moveCreeps(dt);
    this.tickTowers(dt);
    this.tickShots(dt);
    this.tickDots(dt);

    this.creeps = this.creeps.filter((c) => c.alive);
    this.effects = this.effects.filter((e) => this.time - e.born < e.life);

    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = 'gameover';
      this.say(`Game over on level ${this.level}.`);
      this.touch();
    } else if (this.spawnLeft === 0 && this.creeps.length === 0) {
      this.endWave();
    }
  }

  private moveCreeps(dt: number) {
    for (const c of this.creeps) {
      if (!c.alive || c.stunUntil > this.time) continue;
      const slow = Math.max(
        c.slowUntil > this.time ? c.slow : 0,
        c.poison && c.poison.until > this.time ? c.poison.slow : 0,
        c.burnSlowUntil > this.time ? c.burnSlow : 0,
      );
      let step = toTiles(c.def.speed) * Math.max(MIN_SPEED_FACTOR, (1 - slow) * c.permSlow) * dt;
      while (step > 0 && c.alive) {
        const target = c.path[c.next];
        const tx = target.x + 0.5, ty = target.y + 0.5;
        const d = Math.hypot(tx - c.x, ty - c.y);
        if (d <= step) {
          c.x = tx;
          c.y = ty;
          c.progress += d;
          step -= d;
          c.next++;
          if (c.next >= c.path.length) this.leak(c);
        } else {
          c.x += ((tx - c.x) / d) * step;
          c.y += ((ty - c.y) / d) * step;
          c.progress += step;
          step = 0;
        }
      }
    }
  }

  private leak(c: Creep) {
    c.alive = false;
    this.lives -= c.def.lives;
    this.stats.leaked++;
    this.effects.push({ kind: 'text', x: c.x, y: c.y, r: 0, color: '#ff4d4d', text: `-${c.def.lives}`, born: this.time, life: 1 });
  }

  private refreshAuras() {
    if (this.auraCacheVersion === this.version) return;
    this.auraCacheVersion = this.version;
    this.speedBonus.clear();
    this.damageBonus.clear();
    // same-type auras do not stack in Warcraft III: keep the strongest one
    for (const t of this.towers) {
      let spd = 0, dmg = 0;
      for (const src of this.towers) {
        const a = abilityOf(src.id);
        const d = Math.hypot(src.x - t.x, src.y - t.y);
        if (a.auraSpeed && d <= toTiles(a.auraSpeed.range)) spd = Math.max(spd, a.auraSpeed.pct);
        if (a.auraDamage && d <= toTiles(a.auraDamage.range) && src !== t) dmg = Math.max(dmg, a.auraDamage.pct);
      }
      this.speedBonus.set(t, spd);
      this.damageBonus.set(t, dmg);
    }
  }

  private canHit(targets: Targets, c: Creep) {
    return targets === 'both' || (targets === 'air') === c.def.air;
  }

  private tickTowers(dt: number) {
    for (const t of this.towers) {
      if (t.fresh) continue;
      const def = TOWERS[t.id];
      const a = abilityOf(t.id);
      const range = toTiles(def.range);

      if (a.burn) {
        const r = toTiles(a.burn.range);
        for (const c of this.creeps) {
          if (!c.alive || !this.canHit(a.targets, c) || Math.hypot(c.x - t.x - 0.5, c.y - t.y - 0.5) > r) continue;
          this.damage(c, a.burn.dps * dt * this.damageMult(t), t);
          if (a.burn.slow) {
            c.burnSlow = Math.max(c.burnSlowUntil > this.time ? c.burnSlow : 0, a.burn.slow);
            c.burnSlowUntil = this.time + 0.25;
          }
        }
      }

      if (a.noAttack) continue;
      t.cooldown -= dt * (1 + (this.speedBonus.get(t) ?? 0));
      if (t.cooldown > 0) continue;

      if (a.hold) {
        this.tryHold(t, a, range);
        continue;
      }

      const airRange = a.airRange ? toTiles(a.airRange) : range;
      const targets = this.creeps
        .filter((c) => c.alive && this.canHit(a.targets, c) && Math.hypot(c.x - t.x - 0.5, c.y - t.y - 0.5) <= (c.def.air ? airRange : range))
        .sort((p, q) => q.progress - p.progress)
        .slice(0, a.multi ?? 1);
      if (!targets.length) {
        t.cooldown = 0;
        continue;
      }
      t.cooldown += def.cd;
      t.firedAt = this.time;
      for (const c of targets) this.shots.push({ x: t.x + 0.5, y: t.y + 0.5, target: c, tower: t, color: shotColor(t.id) });
      this.emit({ type: 'fire', tower: t, tx: targets[0].x, ty: targets[0].y });
    }
  }

  /** Hold / Ancient Slate: grab the nearest free enemy, stun it and hit it once, then rest. */
  private tryHold(t: Tower, a: Ability, range: number) {
    const h = a.hold!;
    let best: Creep | null = null, bestD = Infinity;
    for (const c of this.creeps) {
      if (!c.alive || !this.canHit(a.targets, c) || c.stunUntil > this.time) continue;
      const d = Math.hypot(c.x - t.x - 0.5, c.y - t.y - 0.5);
      if (d <= Math.max(range, 0.75) && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (!best) {
      t.cooldown = 0;
      return;
    }
    best.stunUntil = this.time + h.dur;
    if (h.armor) {
      best.shred = Math.max(best.shredUntil > this.time ? best.shred : 0, h.armor);
      best.shredUntil = this.time + h.dur;
    }
    t.cooldown = h.dur + h.rest;
    t.firedAt = this.time;
    this.emit({ type: 'hold', tower: t, creep: best.uid, x: best.x, y: best.y });
    const dmg = (h.base + t.kills * h.perKill + this.level * h.perLevel) * this.damageMult(t);
    this.damage(best, dmg, t);
    this.emit({ type: 'hit', x: best.x, y: best.y, creep: best.uid, tower: t, crit: false, splash: 0 });
  }

  private tickShots(dt: number) {
    const step = SHOT_SPEED * dt;
    this.shots = this.shots.filter((s) => {
      if (!s.target.alive) return false;
      const d = Math.hypot(s.target.x - s.x, s.target.y - s.y);
      if (d <= step) {
        this.hit(s.tower, s.target);
        return false;
      }
      s.x += ((s.target.x - s.x) / d) * step;
      s.y += ((s.target.y - s.y) / d) * step;
      return true;
    });
  }

  private tickDots(dt: number) {
    for (const c of this.creeps) {
      if (c.alive && c.poison && c.poison.until > this.time) this.damage(c, c.poison.dps * dt, c.poison.src);
    }
  }

  private damageMult(t: Tower) {
    const killBonus = Math.min(12, Math.floor(t.kills / 10)) * 0.1;
    return (1 + (this.damageBonus.get(t) ?? 0)) * (1 + killBonus);
  }

  private hit(t: Tower, c: Creep) {
    const def = TOWERS[t.id];
    const a = abilityOf(t.id);
    let dmg = def.dmg;
    for (let i = 0; i < def.dice; i++) dmg += 1 + Math.floor(this.combatRng() * def.sides);
    if (a.killDamage) dmg += t.kills * a.killDamage.perKill + this.level * a.killDamage.perLevel;
    if (a.stackBurn) {
      // Wraith flames: each repeated hit on the same burning unit adds another layer
      const f = c.flames && c.flames.until > this.time ? c.flames : null;
      const stacks = f ? f.stacks + 1 : 1;
      c.flames = { stacks, until: this.time + a.stackBurn.window, src: t };
      dmg += a.stackBurn.perHit * (stacks - 1);
    }
    dmg *= this.damageMult(t);
    const crit = !!a.crit && this.combatRng() < a.crit.chance;
    if (crit) {
      dmg *= a.crit!.mult;
      this.effects.push({ kind: 'text', x: c.x, y: c.y - 0.4, r: 0, color: '#ffe066', text: `${Math.round(dmg)}!`, born: this.time, life: 0.7 });
    }
    this.damage(c, dmg, t);
    this.applyOnHit(a, c, t);
    this.emit({ type: 'hit', x: c.x, y: c.y, creep: c.uid, tower: t, crit, splash: a.splash ? toTiles(a.splash) : 0 });

    if (a.splash) {
      const r = toTiles(a.splash);
      this.effects.push({ kind: 'ring', x: c.x, y: c.y, r, color: shotColor(t.id), born: this.time, life: 0.25 });
      for (const o of this.creeps) {
        if (o === c || !o.alive || !this.canHit(a.targets, o) || Math.hypot(o.x - c.x, o.y - c.y) > r) continue;
        this.damage(o, dmg * SPLASH_FACTOR, t);
        this.applyOnHit(a, o, t);
      }
    }
    if (a.nova && this.combatRng() < a.nova.chance) {
      const r = toTiles(a.nova.radius);
      this.effects.push({ kind: 'ring', x: c.x, y: c.y, r, color: '#9fe8ff', born: this.time, life: 0.4 });
      for (const o of this.creeps) {
        if (!o.alive || Math.hypot(o.x - c.x, o.y - c.y) > r) continue;
        this.damage(o, a.nova.dmg * this.damageMult(t), t);
        o.slow = Math.max(o.slow, 0.3);
        o.slowUntil = this.time + 2;
      }
    }
    if (a.luckyGold && this.combatRng() < a.luckyGold) {
      const g = Math.max(1, Math.floor(this.level / 2));
      this.gold += g;
      this.effects.push({ kind: 'text', x: t.x + 0.5, y: t.y, r: 0, color: '#ffd84a', text: `+${g}g`, born: this.time, life: 1 });
    }
    if (a.spells && this.combatRng() < a.spells.chance) this.castSpell(t, a.spells, c);
  }

  /** Spell / Elder Slate: one random spell — area damage (most likely), armor reduction, or gold. */
  private castSpell(t: Tower, s: NonNullable<Ability['spells']>, c: Creep) {
    const roll = this.combatRng();
    if (roll < 0.66) {
      const r = toTiles(s.radius);
      this.effects.push({ kind: 'ring', x: c.x, y: c.y, r, color: '#9fe8ff', born: this.time, life: 0.4 });
      for (const o of this.creeps) {
        if (o.alive && Math.hypot(o.x - c.x, o.y - c.y) <= r) this.damage(o, s.dmg * this.damageMult(t), t);
      }
    } else if (roll < 0.83) {
      if (!c.alive) return;
      c.shred = Math.max(c.shredUntil > this.time ? c.shred : 0, s.armor);
      c.shredUntil = this.time + s.armorDur;
      this.effects.push({ kind: 'text', x: c.x, y: c.y - 0.4, r: 0, color: '#c9a0ff', text: `-${s.armor} armor`, born: this.time, life: 0.8 });
    } else {
      const g = s.gold + Math.floor(t.kills / 10);
      this.gold += g;
      this.effects.push({ kind: 'text', x: t.x + 0.5, y: t.y, r: 0, color: '#ffd84a', text: `+${g}g`, born: this.time, life: 1 });
    }
  }

  private applyOnHit(a: Ability, c: Creep, t: Tower) {
    if (!c.alive) return;
    if (a.slow) {
      c.slow = c.slowUntil > this.time ? Math.max(c.slow, a.slow.pct) : a.slow.pct;
      c.slowUntil = this.time + a.slow.dur;
    }
    if (a.poison && (!c.poison || c.poison.until <= this.time || c.poison.dps <= a.poison.dps)) {
      c.poison = { dps: a.poison.dps, slow: a.poison.slow, until: this.time + a.poison.dur, src: t };
    }
    if (a.stun && c.stunUntil <= this.time && this.combatRng() < a.stun.chance) c.stunUntil = this.time + a.stun.dur;
    if (a.shred) {
      c.shred = Math.max(c.shredUntil > this.time ? c.shred : 0, a.shred);
      c.shredUntil = this.time + 5;
    }
    if (a.permSlow && !c.permSlowBy.has(t.uid)) {
      c.permSlowBy.add(t.uid);
      c.permSlow *= 1 - a.permSlow;
    }
  }

  private armorOf(c: Creep): number {
    let aura = 0;
    for (const t of this.towers) {
      const a = abilityOf(t.id).armorAura;
      if (!a || !this.canHit(a.targets, c) || Math.hypot(c.x - t.x - 0.5, c.y - t.y - 0.5) > toTiles(a.range)) continue;
      aura = Math.max(aura, a.amount);
    }
    return c.def.armor + DIFFICULTIES[this.difficulty] - aura - (c.shredUntil > this.time ? c.shred : 0);
  }

  private damage(c: Creep, raw: number, src: Tower) {
    if (!c.alive) return;
    const armor = this.armorOf(c);
    // Warcraft III armor formula
    const mult = armor >= 0 ? 1 - (0.06 * armor) / (1 + 0.06 * armor) : 2 - Math.pow(0.94, -armor);
    const dealt = raw * mult;
    src.damage += Math.max(0, Math.min(dealt, c.hp));
    c.hp -= dealt;
    if (c.hp <= 0) {
      c.alive = false;
      this.gold += c.def.bounty;
      src.kills++;
      this.stats.kills++;
      this.effects.push({ kind: 'text', x: c.x, y: c.y, r: 0, color: '#ffd84a', text: `+${c.def.bounty}`, born: this.time, life: 0.8 });
      this.emit({ type: 'kill', x: c.x, y: c.y, creep: c.uid, air: c.def.air });
      // Wraith flames: a unit that dies burning is incinerated and damages everything around it
      const f = c.flames;
      c.flames = null;
      const sb = f && f.until > this.time ? abilityOf(f.src.id).stackBurn : undefined;
      if (f && sb) {
        const r = toTiles(sb.blastRadius);
        this.emit({ type: 'blast', x: c.x, y: c.y, r });
        for (const o of this.creeps) {
          if (o.alive && Math.hypot(o.x - c.x, o.y - c.y) <= r) this.damage(o, sb.blast * this.damageMult(f.src), f.src);
        }
      }
    }
  }

  // ---------- misc ----------

  buyLife(): boolean {
    const cost = 10;
    if (this.gold < cost || this.lives >= MAX_LIVES || this.phase === 'gameover') return false;
    this.gold -= cost;
    this.lives++;
    this.touch();
    return true;
  }

  snapshot(withLayout: boolean): BoardSnapshot {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      level: this.level,
      lives: this.lives,
      gold: this.gold,
      phase: this.phase,
      kills: this.stats.kills,
      quality: this.qualityLevel,
      creeps: this.creeps.map((c) => [r2(c.x), r2(c.y), r2(Math.max(0, c.hp / c.maxHp)), c.def.air ? 1 : 0]),
      layout: withLayout ? { towers: this.towers.map((t) => [t.id, t.x, t.y]), rocks: [...this.rocks] } : undefined,
    };
  }

  private refreshRoute() {
    this.route = findRoute(this.blocked) ?? this.route;
    this.routeLen = routeLength(this.route);
  }

  say(msg: string) {
    this.log.unshift(msg);
    this.log.length = Math.min(this.log.length, 8);
  }

  touch() {
    this.version++;
  }
}

function shotColor(id: string): string {
  const info = GEM_INFO[id];
  return info ? { diamond: '#ffffff', sapphire: '#6fa0ff', emerald: '#5dff8f', ruby: '#ff5d6d', opal: '#ffc7a8', amethyst: '#d199ff', topaz: '#fff07a', aquamarine: '#8ff8ff' }[info.type] : '#ffe28a';
}
