/**
 * Turns many GameRecords into numbers: summaries for reports and the LLM advisor, and paired
 * comparisons (same seeds, two weight sets) that say whether a difference is real or luck.
 */
import { RECIPES, TOWERS, WAVES, displayName } from '../data/gems';
import type { GameRecord } from './recorder';
import { METRICS, type Expectation, type MetricName } from './weights';

export type WaveKind = 'air' | 'ground' | 'boss';

/** The "Summon" waves carry many times the HP of their neighbours: those are the bosses. ("Summon Egg" on level 1 is not.) */
export function waveKind(level: number): WaveKind {
  const w = WAVES[level - 1];
  if (/^Summon( Air)?$/.test(w.name)) return 'boss';
  return w.air ? 'air' : 'ground';
}

export interface TowerStat {
  id: string;
  name: string;
  /** share of games that had it on the board at the end */
  pickRate: number;
  /** share of all damage dealt */
  damageShare: number;
  /** damage per tower per wave on the board */
  dmgPerWave: number;
  /** avg level reached in games that ended with it vs without (correlation, not cause) */
  levelWith: number;
  levelWithout: number;
}

export interface EvalSummary {
  games: number;
  score: number;
  scoreSd: number;
  avgLevel: number;
  winRate: number;
  avgLives: number;
  /** games that ended on each level (losses only) */
  deathsByLevel: Record<number, number>;
  /** what killed them: kind of the wave each lost game ended on, as shares */
  deathsByKind: Record<WaveKind, number>;
  /** avg lives lost per game, by wave kind */
  livesLostByKind: Record<WaveKind, number>;
  /** avg lives lost per game on each level; index = level - 1 */
  livesLostByLevel: number[];
  /** avg gold when the wave started; index = level - 1 (only games that got there) */
  goldAtWave: number[];
  /** avg ground / air exposure when the wave started; index = level - 1 (only games that got there) */
  exposureGround: number[];
  exposureAir: number[];
  /** on levels where games ended: avg exposure (of that wave kind) in games that died there vs games that got through */
  exposureDiedVsPassed: Record<number, { died: number; passed: number }>;
  towers: TowerStat[];
  /** special towers made, as share of games that made it at least once */
  specialsMade: Record<string, number>;
  /** recipe results never made in any game */
  unusedRecipes: string[];
  avgUpgrades: number;
  avgQuality: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function summarize(recs: GameRecord[]): EvalSummary {
  const n = recs.length;
  const lost = recs.filter((r) => r.result === 'gameover');
  const deathsByLevel: Record<number, number> = {};
  const deathsByKind: Record<WaveKind, number> = { air: 0, ground: 0, boss: 0 };
  for (const r of lost) {
    deathsByLevel[r.level] = (deathsByLevel[r.level] ?? 0) + 1;
    deathsByKind[waveKind(r.level)] += 1 / lost.length;
  }
  const livesLostByKind: Record<WaveKind, number> = { air: 0, ground: 0, boss: 0 };
  const livesLostByLevel: number[] = new Array(WAVES.length).fill(0);
  const goldSum: number[] = new Array(WAVES.length).fill(0);
  const goldCnt: number[] = new Array(WAVES.length).fill(0);
  for (const r of recs) {
    r.livesLost.forEach((l, i) => {
      livesLostByLevel[i] += l / n;
      livesLostByKind[waveKind(i + 1)] += l / n;
    });
    r.goldAtWave.forEach((g, i) => {
      goldSum[i] += g;
      goldCnt[i]++;
    });
  }

  let totalDmg = 0;
  const byTower = new Map<string, { dmg: number; waves: number }>();
  for (const r of recs) {
    for (const [id, s] of Object.entries(r.towers)) {
      const t = byTower.get(id) ?? { dmg: 0, waves: 0 };
      t.dmg += s.dmg;
      t.waves += s.waves;
      byTower.set(id, t);
      totalDmg += s.dmg;
    }
  }
  const avgLevel = mean(recs.map((r) => r.level));
  const towers: TowerStat[] = [...byTower.entries()]
    .map(([id, s]) => {
      const withIt = recs.filter((r) => r.final.includes(id));
      const without = recs.filter((r) => !r.final.includes(id));
      return {
        id,
        name: displayName(id),
        pickRate: r2(withIt.length / n),
        damageShare: r2(totalDmg ? s.dmg / totalDmg : 0),
        dmgPerWave: Math.round(s.waves ? s.dmg / s.waves : 0),
        levelWith: r2(withIt.length ? mean(withIt.map((r) => r.level)) : 0),
        levelWithout: r2(without.length ? mean(without.map((r) => r.level)) : avgLevel),
      };
    })
    .sort((a, b) => b.damageShare - a.damageShare);

  const madeIn: Record<string, number> = {};
  for (const r of recs) {
    const made = new Set(r.picks.filter((p) => p.split(':')[1] === 'special').map((p) => p.split(':')[2]));
    for (const id of made) madeIn[id] = (madeIn[id] ?? 0) + 1;
  }
  const specialsMade = Object.fromEntries(Object.entries(madeIn).map(([id, c]) => [id, r2(c / n)]));

  const scores = recs.map((r) => r.score);
  const avgAt = (pick: (r: GameRecord) => number[]) => {
    const sum: number[] = new Array(WAVES.length).fill(0), cnt: number[] = new Array(WAVES.length).fill(0);
    for (const r of recs) (pick(r) ?? []).forEach((v, i) => { sum[i] += v; cnt[i]++; });
    return sum.map((v, i) => (cnt[i] ? Math.round(v / cnt[i]) : 0));
  };
  const exposureDiedVsPassed: EvalSummary['exposureDiedVsPassed'] = {};
  for (const l of Object.keys(deathsByLevel).map(Number)) {
    const pick = (r: GameRecord) => ((waveKind(l) === 'air' ? r.exposureAir : r.exposureGround) ?? [])[l - 1] ?? 0;
    const died = recs.filter((r) => r.result === 'gameover' && r.level === l);
    const passed = recs.filter((r) => r.level > l || r.result === 'victory');
    if (died.length && passed.length) exposureDiedVsPassed[l] = { died: Math.round(mean(died.map(pick))), passed: Math.round(mean(passed.map(pick))) };
  }

  return {
    games: n,
    score: r2(mean(scores)),
    scoreSd: r2(sd(scores)),
    avgLevel: r2(avgLevel),
    winRate: r2(recs.filter((r) => r.result === 'victory').length / n),
    avgLives: r2(mean(recs.map((r) => r.lives))),
    deathsByLevel,
    deathsByKind: { air: r2(deathsByKind.air), ground: r2(deathsByKind.ground), boss: r2(deathsByKind.boss) },
    livesLostByKind: { air: r2(livesLostByKind.air), ground: r2(livesLostByKind.ground), boss: r2(livesLostByKind.boss) },
    livesLostByLevel: livesLostByLevel.map(r2),
    goldAtWave: goldSum.map((g, i) => (goldCnt[i] ? Math.round(g / goldCnt[i]) : 0)),
    exposureGround: avgAt((r) => r.exposureGround),
    exposureAir: avgAt((r) => r.exposureAir),
    exposureDiedVsPassed,
    towers,
    specialsMade,
    unusedRecipes: RECIPES.map((r) => r.result).filter((id) => !(id in specialsMade)),
    avgUpgrades: r2(mean(recs.map((r) => r.upgrades.length))),
    avgQuality: r2(mean(recs.map((r) => r.qualityLevel))),
  };
}

/** One number per game for a metric (so two runs can be compared seed by seed). */
export function metricOf(r: GameRecord, e: Pick<Expectation, 'metric' | 'levels' | 'tower'>): number {
  const inRange = (i: number) => !e.levels || (i + 1 >= e.levels[0] && i + 1 <= e.levels[1]);
  const lostWhere = (kind?: WaveKind) =>
    r.livesLost.reduce((a, l, i) => a + (inRange(i) && (!kind || waveKind(i + 1) === kind) ? l : 0), 0);
  switch (e.metric) {
    case 'score': return r.score;
    case 'level': return r.level;
    case 'lives': return r.lives;
    case 'win': return r.result === 'victory' ? 1 : 0;
    case 'livesLost': return lostWhere();
    case 'livesLost.air': return lostWhere('air');
    case 'livesLost.ground': return lostWhere('ground');
    case 'livesLost.boss': return lostWhere('boss');
    case 'damageShare': {
      const total = Object.values(r.towers).reduce((a, s) => a + s.dmg, 0);
      return total && e.tower ? (r.towers[e.tower]?.dmg ?? 0) / total : 0;
    }
    case 'picked': return e.tower && r.final.includes(e.tower) ? 1 : 0;
  }
}

export interface Paired {
  /** mean of (candidate - base) over shared seeds */
  diff: number;
  /** standard error of that mean */
  se: number;
  /** diff / se; |z| >= 2 is treated as real */
  z: number;
  n: number;
}

/** Same seeds, two weight sets: per-seed differences remove most of the luck from the comparison. */
export function paired(base: GameRecord[], cand: GameRecord[], e: Pick<Expectation, 'metric' | 'levels' | 'tower'> = { metric: 'score' }): Paired {
  const bySeed = new Map(base.map((r) => [r.seed, r]));
  const d: number[] = [];
  for (const c of cand) {
    const b = bySeed.get(c.seed);
    if (b) d.push(metricOf(c, e) - metricOf(b, e));
  }
  const m = mean(d);
  const se = d.length > 1 ? sd(d) / Math.sqrt(d.length) : 0;
  return { diff: r4(m), se: r4(se), z: se ? r2(m / se) : m ? Math.sign(m) * 99 : 0, n: d.length };
}

export const SIGNIFICANT_Z = 2;

export type Verdict = 'correct' | 'wrong' | 'no-effect';

/** Did the predicted change happen (significantly, in that direction)? */
export function checkExpectation(base: GameRecord[], cand: GameRecord[], e: Expectation): { verdict: Verdict; result: Paired } {
  const result = paired(base, cand, e);
  if (Math.abs(result.z) < SIGNIFICANT_Z) return { verdict: 'no-effect', result };
  const up = result.diff > 0;
  return { verdict: up === (e.direction === 'up') ? 'correct' : 'wrong', result };
}

export function metricLabel(e: Pick<Expectation, 'metric' | 'levels' | 'tower'>): string {
  let s: string = e.metric;
  if (e.tower) s += ` ${displayName(e.tower)}`;
  if (e.levels) s += e.levels[0] === e.levels[1] ? ` ด่าน ${e.levels[0]}` : ` ด่าน ${e.levels[0]}–${e.levels[1]}`;
  return s;
}

export const isMetric = (m: string): m is MetricName => m in METRICS;

export const towerExists = (id: string) => !!TOWERS[id];
