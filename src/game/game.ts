import {
  CHECKPOINTS, CHECKPOINT_CLEARANCE, CREEPS_PER_WAVE, GEMS_PER_ROUND, GRID, LAST_LEVEL, MAX_LIVES,
  MIN_SPEED_FACTOR, SPAWN_INTERVAL, START_GOLD, START_LIVES, toTiles, type Point,
} from './config';
import { findRoute, routeLength } from './path';
import {
  BASE_GEMS, GEM_INFO, GEM_TYPES, GREAT, MAX_QUALITY_LEVEL, PERFECT, QUALITY_CHANCES, RECIPES, TOWERS, WAVES,
  abilityOf, displayName, qualityUpgradeCost, type Ability, type CreepDef, type Recipe, type Targets,
} from '../data/gems';

export type Phase = 'build' | 'choose' | 'wave' | 'gameover' | 'victory';

/** Armor bonus every creep gets, like the map's difficulty auras (A00S/A00T/A01E). */
export const DIFFICULTIES = { easy: -3, normal: -1, hard: 2 } as const;
export type Difficulty = keyof typeof DIFFICULTIES;

export interface Tower {
  uid: number;
  id: string;
  x: number;
  y: number;
  cooldown: number;
  kills: number;
  /** placed this round and still waiting for keep/combine */
  fresh: boolean;
  /** last time it fired, for the muzzle flash */
  firedAt: number;
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

export interface CombineOption {
  count: 2 | 4;
  result: string;
}

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
  route: Point[] = [];
  routeLen = 0;
  selected: Tower | null = null;
  log: string[] = [];
  stats = { kills: 0, leaked: 0, specials: 0 };

  /** bumped on every structural change; UI and caches key off it */
  version = 0;

  private grid: (Tower | null)[] = new Array(GRID * GRID).fill(null);
  private spawnLeft = 0;
  private spawnTimer = 0;
  private placeCache = new Map<number, boolean>();
  private placeCacheVersion = -1;
  private auraCacheVersion = -1;
  private speedBonus = new Map<Tower, number>();
  private damageBonus = new Map<Tower, number>();

  constructor(public difficulty: Difficulty = 'normal') {
    this.refreshRoute();
    this.say(`Level 1 (${difficulty}): place ${GEMS_PER_ROUND} gems, then keep or combine one.`);
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

  private blocked = (x: number, y: number) => !!this.grid[y * GRID + x] || this.rocks.has(y * GRID + x);

  /** Empty, not reserved, and does not cut the route. */
  canPlace(x: number, y: number): boolean {
    if (!this.inBounds(x, y) || this.blocked(x, y) || this.isReserved(x, y)) return false;
    if (this.placeCacheVersion !== this.version) {
      this.placeCache.clear();
      this.placeCacheVersion = this.version;
    }
    const key = y * GRID + x;
    let ok = this.placeCache.get(key);
    if (ok === undefined) {
      // only tiles on the current route can break it
      const onRoute = this.route.some((p) => p.x === x && p.y === y);
      ok = !onRoute || findRoute((bx, by) => (bx === x && by === y) || this.blocked(bx, by)) !== null;
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
    const tower: Tower = { uid: nextUid++, id: this.rollGem(), x, y, cooldown: 0, kills: 0, fresh: true, firedAt: -1 };
    this.towers.push(tower);
    this.grid[y * GRID + x] = tower;
    this.gemsLeft--;
    this.selected = tower;
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
    const type = GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)];
    const chances = QUALITY_CHANCES[this.qualityLevel];
    let roll = Math.random() * 100;
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

  keep(t: Tower): boolean {
    if (this.phase !== 'choose' || !t.fresh) return false;
    this.say(`Kept ${displayName(t.id)}.`);
    this.finishRound(t);
    return true;
  }

  combine(t: Tower, count: 2 | 4): boolean {
    const opt = this.combineOptions(t).find((o) => o.count === count);
    if (!opt) return false;
    const others = this.freshTowers.filter((o) => o !== t && o.id === t.id).slice(0, count - 1);
    for (const o of others) {
      t.kills += o.kills;
      this.toRock(o);
    }
    this.say(`Combined ${count}x ${displayName(t.id)} into ${displayName(opt.result)}.`);
    t.id = opt.result;
    this.finishRound(t);
    return true;
  }

  makeSpecial(t: Tower, recipe: Recipe): boolean {
    const parts = this.specialOptions(t).includes(recipe) ? this.recipeParts(t, recipe) : null;
    if (!parts) return false;
    for (const p of parts) {
      if (p === t) continue;
      t.kills += p.kills;
      this.toRock(p);
    }
    t.id = recipe.result;
    this.stats.specials++;
    this.say(`Created special: ${displayName(recipe.result)}!`);
    this.finishRound(t);
    return true;
  }

  private finishRound(kept: Tower) {
    for (const o of this.freshTowers) if (o !== kept) this.toRock(o);
    kept.fresh = false;
    kept.cooldown = 0;
    this.selected = kept;
    this.refreshRoute();
    this.startWave();
  }

  private toRock(t: Tower) {
    this.towers = this.towers.filter((o) => o !== t);
    this.grid[t.y * GRID + t.x] = null;
    this.rocks.add(t.y * GRID + t.x);
    if (this.selected === t) this.selected = null;
  }

  private hintSpecials() {
    const names = new Set<string>();
    for (const t of this.freshTowers) for (const r of this.specialOptions(t)) names.add(displayName(r.result));
    if (names.size) this.say(`Special available: ${[...names].join(', ')}`);
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
      let step = toTiles(c.def.speed) * Math.max(MIN_SPEED_FACTOR, 1 - slow) * dt;
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

      const targets = this.creeps
        .filter((c) => c.alive && this.canHit(a.targets, c) && Math.hypot(c.x - t.x - 0.5, c.y - t.y - 0.5) <= range)
        .sort((p, q) => q.progress - p.progress)
        .slice(0, a.multi ?? 1);
      if (!targets.length) {
        t.cooldown = 0;
        continue;
      }
      t.cooldown += def.cd;
      t.firedAt = this.time;
      for (const c of targets) this.shots.push({ x: t.x + 0.5, y: t.y + 0.5, target: c, tower: t, color: shotColor(t.id) });
    }
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
    for (let i = 0; i < def.dice; i++) dmg += 1 + Math.floor(Math.random() * def.sides);
    dmg *= this.damageMult(t);
    if (a.crit && Math.random() < a.crit.chance) {
      dmg *= a.crit.mult;
      this.effects.push({ kind: 'text', x: c.x, y: c.y - 0.4, r: 0, color: '#ffe066', text: `${Math.round(dmg)}!`, born: this.time, life: 0.7 });
    }
    this.damage(c, dmg, t);
    this.applyOnHit(a, c, t);

    if (a.splash) {
      const r = toTiles(a.splash);
      this.effects.push({ kind: 'ring', x: c.x, y: c.y, r, color: shotColor(t.id), born: this.time, life: 0.25 });
      for (const o of this.creeps) {
        if (o === c || !o.alive || !this.canHit(a.targets, o) || Math.hypot(o.x - c.x, o.y - c.y) > r) continue;
        this.damage(o, dmg * SPLASH_FACTOR, t);
        this.applyOnHit(a, o, t);
      }
    }
    if (a.nova && Math.random() < a.nova.chance) {
      const r = toTiles(a.nova.radius);
      this.effects.push({ kind: 'ring', x: c.x, y: c.y, r, color: '#9fe8ff', born: this.time, life: 0.4 });
      for (const o of this.creeps) {
        if (!o.alive || Math.hypot(o.x - c.x, o.y - c.y) > r) continue;
        this.damage(o, a.nova.dmg * this.damageMult(t), t);
        o.slow = Math.max(o.slow, 0.3);
        o.slowUntil = this.time + 2;
      }
    }
    if (a.luckyGold && Math.random() < a.luckyGold) {
      const g = Math.max(1, Math.floor(this.level / 2));
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
    if (a.stun && c.stunUntil <= this.time && Math.random() < a.stun.chance) c.stunUntil = this.time + a.stun.dur;
    if (a.shred) {
      c.shred = Math.max(c.shredUntil > this.time ? c.shred : 0, a.shred);
      c.shredUntil = this.time + 5;
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
    c.hp -= raw * mult;
    if (c.hp <= 0) {
      c.alive = false;
      this.gold += c.def.bounty;
      src.kills++;
      this.stats.kills++;
      this.effects.push({ kind: 'text', x: c.x, y: c.y, r: 0, color: '#ffd84a', text: `+${c.def.bounty}`, born: this.time, life: 0.8 });
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
