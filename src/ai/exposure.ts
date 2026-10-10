/**
 * Exposure: how much fire a creep walks through. For every tile a creep passes, add the dps of every
 * tower that reaches it. A long route that bends out of range adds nothing; a route that loops past
 * towers again and again adds a lot. Ground and air are separate: fliers ignore the maze and fly
 * straight from checkpoint to checkpoint, so their path never changes.
 *
 * Geometry matches Game.tickTowers: creeps walk through tile centres, towers shoot from theirs,
 * so a path tile p is in range of a tower at t when hypot(p - t) <= range in tiles.
 */
import { CHECKPOINTS, GRID, toTiles, type Point } from '../game/config';
import type { Game } from '../game/game';
import { BASE_GEMS, GEM_INFO, TOWERS, WAVES, abilityOf } from '../data/gems';

const N = GRID * GRID;

/** Damage per second of one tower, before armour and auras (the bot's own power estimate, unweighted). */
export function towerDps(id: string): number {
  const d = TOWERS[id];
  const a = abilityOf(id);
  if (a.noAttack) return 0;
  return ((d.dmg + (d.dice * (d.sides + 1)) / 2) / d.cd) * (a.multi ?? 1) * (a.crit ? 1 + a.crit.chance * (a.crit.mult - 1) : 1);
}

export const hitsGround = (id: string) => abilityOf(id).targets !== 'air';
export const hitsAir = (id: string) => abilityOf(id).targets !== 'ground';

/** Adds `dps` to every tile within `r` tiles of (cx, cy). */
function stamp(map: Float32Array, cx: number, cy: number, r: number, dps: number) {
  const R = Math.floor(r);
  for (let dy = -R; dy <= R; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= GRID) continue;
    for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= GRID || dx * dx + dy * dy > r * r) continue;
      map[y * GRID + x] += dps;
    }
  }
}

export interface DpsMaps {
  ground: Float32Array;
  air: Float32Array;
  /** mean dps of the towers that attack, to turn exposure into "tiles covered by an average tower" */
  meanDps: number;
}

/** dps reaching each tile, from every kept tower on the board (fresh gems are not shooting yet). */
export function dpsMaps(game: Game): DpsMaps {
  const ground = new Float32Array(N), air = new Float32Array(N);
  let total = 0, count = 0;
  for (const t of game.towers) {
    if (t.fresh) continue;
    const a = abilityOf(t.id);
    const dps = towerDps(t.id);
    const range = toTiles(TOWERS[t.id].range);
    if (dps > 0) {
      if (hitsGround(t.id)) stamp(ground, t.x, t.y, range, dps);
      if (hitsAir(t.id)) stamp(air, t.x, t.y, a.airRange ? toTiles(a.airRange) : range, dps);
      total += dps;
      count++;
    }
    if (a.burn) {
      const r = toTiles(a.burn.range);
      if (hitsGround(t.id)) stamp(ground, t.x, t.y, r, a.burn.dps);
      if (hitsAir(t.id)) stamp(air, t.x, t.y, r, a.burn.dps);
    }
  }
  return { ground, air, meanDps: count ? total / count : 1 };
}

/** The tiles a flier passes, one sample per tile length along each straight checkpoint leg. */
export const AIR_PATH: Point[] = (() => {
  const out: Point[] = [];
  for (let i = 0; i < CHECKPOINTS.length - 1; i++) {
    const a = CHECKPOINTS[i], b = CHECKPOINTS[i + 1];
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      out.push({ x: Math.round(a.x + ((b.x - a.x) * s) / steps), y: Math.round(a.y + ((b.y - a.y) * s) / steps) });
    }
  }
  return out;
})();

/** Total fire along a path: sum of the map over its tiles (a tile passed twice counts twice). */
export function exposureOf(path: Point[], map: Float32Array): number {
  let s = 0;
  for (const p of path) s += map[p.y * GRID + p.x];
  return s;
}

/** How many path tiles a tower at (x, y) with this range would reach. */
export function cover(path: Point[], x: number, y: number, r: number): number {
  let n = 0;
  const r2 = r * r;
  for (const p of path) if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r2) n++;
  return n;
}

/** What a gem placed now is likely to be: its average range, and the odds it can hit ground / air. */
export const GEM_ODDS = (() => {
  const ids = Object.values(BASE_GEMS).flat().filter((id) => GEM_INFO[id] && TOWERS[id]);
  const ranges = ids.map((id) => toTiles(TOWERS[id].range));
  return {
    range: ranges.reduce((a, b) => a + b, 0) / ranges.length,
    ground: ids.filter(hitsGround).length / ids.length,
    air: ids.filter(hitsAir).length / ids.length,
  };
})();

/** Share of the waves that fly, for weighing a kept tower's ground vs air coverage. */
export const AIR_WAVE_SHARE = WAVES.filter((w) => w.air).length / WAVES.length;
