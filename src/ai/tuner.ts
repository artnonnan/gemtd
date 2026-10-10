/**
 * Hill-climbing over Weights, kept free of I/O so it can be tested. The command line (scripts/ai/tune.ts)
 * owns files and threads; this owns the decisions: what to try next, what counts as better, what was learned.
 */
import { mulberry32 } from '../game/rng';
import { SIGNIFICANT_Z, checkExpectation, paired, metricLabel, type Paired, type Verdict } from './analyze';
import type { GameRecord } from './recorder';
import { TUNABLE_KEYS, WEIGHT_SPECS, choicesOf, clampWeight, describeChanges, weightsKey, type NumericWeightKey, type Weights } from './weights';

/** chance that a hill-climbing candidate also switches to another blueprint */
const SWITCH_BLUEPRINT = 0.15;

/** wins: significantly better; pos: better but within luck */
export interface DirStats { tries: number; wins: number; pos?: number }
export type KeyStats = Record<string, { up: DirStats; down: DirStats }>;

export interface TuneState {
  version: 1;
  rulesHash: string;
  difficulty: string;
  seeds: number;
  round: number;
  bestId: string;
  /** where this tuning run started: holdout checks measure the total gain against it */
  startId?: string;
  nextId: number;
  /** rounds in a row without an accepted candidate */
  stuck: number;
  /** multiplies hill-climbing step sizes: grows after wins, shrinks while stuck */
  stepScale: number;
  keyStats: KeyStats;
  /** weightsKey of every set already played, so nothing is tried twice */
  tried: string[];
  /** candidates for the next round (planned at the end of the previous one, so its report can name them) */
  pending: Weights[];
  llm: { calls: number; proposals: number; accepted: number; correct: number; wrong: number; noEffect: number; lastRound: number };
  holdout: { round: number; bestId: string; score: number }[];
  /** prefix for new weight ids ("spiral-" for --run=spiral), so separate runs never overwrite each other's sets */
  idPrefix?: string;
  /** options the tuner may switch blueprintId between (default: every registered blueprint and none) */
  blueprints?: string[];
}

export function newState(rulesHash: string, difficulty: string, seeds: number, best: Weights): TuneState {
  return {
    version: 1, rulesHash, difficulty, seeds, round: 0, bestId: best.id, startId: best.id, nextId: 1, stuck: 0, stepScale: 1,
    keyStats: {}, tried: [weightsKey(best)], pending: [],
    llm: { calls: 0, proposals: 0, accepted: 0, correct: 0, wrong: 0, noEffect: 0, lastRound: 0 },
    holdout: [],
  };
}

const stats = (s: TuneState, k: string) => (s.keyStats[k] ??= { up: { tries: 0, wins: 0 }, down: { tries: 0, wins: 0 } });
/** Laplace-smoothed win rate; a positive-but-not-significant result counts a little */
const rate = (d: DirStats) => (d.wins + 0.3 * (d.pos ?? 0) + 1) / (d.tries + 2);

/**
 * Hill-climbing candidates around `best`: 1–3 weights each, nudged in the direction that has worked
 * more often, by a step that scales with the weight's range and with state.stepScale.
 */
export function proposeHill(best: Weights, s: TuneState, k: number): Weights[] {
  const rng = mulberry32(s.round * 7919 + s.nextId);
  const seen = new Set(s.tried);
  const out: Weights[] = [];
  for (let attempt = 0; out.length < k && attempt < k * 40; attempt++) {
    const r = rng();
    const nKeys = r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
    const cand: Weights = { ...best };
    const keys = pickKeys(s, nKeys, rng);
    for (const key of keys) {
      const spec = WEIGHT_SPECS[key];
      const st = stats(s, key);
      let up = rng() < rate(st.up) / (rate(st.up) + rate(st.down));
      if (best[key] >= spec.max) up = false;
      if (best[key] <= spec.min) up = true;
      let step = (spec.max - spec.min) * s.stepScale * (0.03 + 0.12 * rng());
      if (spec.int) step = Math.max(1, Math.round(step));
      cand[key] = clampWeight(key, best[key] + (up ? step : -step));
    }
    const options = (s.blueprints ?? choicesOf('blueprintId')).filter((b) => b !== best.blueprintId);
    if (options.length && rng() < SWITCH_BLUEPRINT) {
      cand.blueprintId = options[Math.floor(rng() * options.length)];
      // a blueprint with no pull does nothing: give a newly chosen one the weight it was compared at
      if (cand.blueprintId !== 'none' && cand.blueprintWeight === 0) cand.blueprintWeight = 5;
    }
    const key = weightsKey(cand);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(withIdentity(cand, best, s, 'hill', `hill: ${describeChanges(best, cand)}`));
  }
  return out;
}

function pickKeys(s: TuneState, n: number, rng: () => number): NumericWeightKey[] {
  const pool = [...TUNABLE_KEYS];
  const out: NumericWeightKey[] = [];
  while (out.length < n && pool.length) {
    // keys that have paid off get picked more, but every key keeps a fair chance
    const w = pool.map((k) => {
      const st = stats(s, k);
      return 0.3 + Math.max(rate(st.up), rate(st.down));
    });
    let x = rng() * w.reduce((a, b) => a + b, 0);
    let i = 0;
    while ((x -= w[i]) > 0 && i < pool.length - 1) i++;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/** A fresh id for a new weight set in this run. */
export const newId = (s: TuneState) => `${s.idPrefix ?? ''}w${s.nextId++}`;

/** A candidate derived from parent: new id, and none of the parent's LLM proposal (that belonged to the parent). */
export function withIdentity(cand: Weights, parent: Weights, s: TuneState, source: Weights['source'], note: string): Weights {
  const { proposal: _drop, ...rest } = cand;
  return { ...rest, id: newId(s), parent: parent.id, source, note };
}

export interface CandidateResult {
  w: Weights;
  score: Paired;
  /** other metrics that moved significantly */
  moves: { label: string; p: Paired }[];
  verdicts: { label: string; direction: 'up' | 'down'; verdict: Verdict; p: Paired }[];
  accepted: boolean;
}

/** Metrics worth mentioning in a report when they move beyond luck. */
const WATCH = [
  { metric: 'level' as const },
  { metric: 'win' as const },
  { metric: 'livesLost.air' as const },
  { metric: 'livesLost.ground' as const },
  { metric: 'livesLost.boss' as const },
];

/** Compares candidates with the best on the same seeds and picks at most one winner. */
export function judge(bestRecs: GameRecord[], cands: { w: Weights; recs: GameRecord[] }[]): CandidateResult[] {
  const results: CandidateResult[] = cands.map(({ w, recs }) => ({
    w,
    score: paired(bestRecs, recs),
    moves: WATCH.map((e) => ({ label: metricLabel(e), p: paired(bestRecs, recs, e) })).filter((m) => Math.abs(m.p.z) >= SIGNIFICANT_Z),
    verdicts: (w.proposal?.expect ?? []).map((e) => {
      const { verdict, result } = checkExpectation(bestRecs, recs, e);
      return { label: metricLabel(e), direction: e.direction, verdict, p: result };
    }),
    accepted: false,
  }));
  const winner = results.filter((r) => r.score.diff > 0 && r.score.z >= SIGNIFICANT_Z).sort((a, b) => b.score.diff - a.score.diff)[0];
  if (winner) winner.accepted = true;
  return results;
}

/** Folds a round's results into the state: key statistics, stuck counter, step size, LLM record. */
export function learn(s: TuneState, best: Weights, results: CandidateResult[]) {
  for (const r of results) {
    s.tried.push(weightsKey(r.w));
    const win = r.score.diff > 0 && r.score.z >= SIGNIFICANT_Z;
    const pos = !win && r.score.diff > 0;
    for (const k of TUNABLE_KEYS) {
      if (r.w[k] === best[k]) continue;
      const d = stats(s, k)[r.w[k] > best[k] ? 'up' : 'down'];
      d.tries++;
      if (win) d.wins++;
      if (pos) d.pos = (d.pos ?? 0) + 1;
    }
    if (r.w.source === 'llm') {
      s.llm.proposals++;
      if (r.accepted) s.llm.accepted++;
      for (const v of r.verdicts) {
        if (v.verdict === 'correct') s.llm.correct++;
        else if (v.verdict === 'wrong') s.llm.wrong++;
        else s.llm.noEffect++;
      }
    }
  }
  if (results.some((r) => r.accepted)) {
    s.stuck = 0;
    s.stepScale = Math.min(3, s.stepScale * 1.25);
  } else {
    s.stuck++;
    // creeping smaller while stuck; one big jump at 8 to shake out of a local optimum
    s.stepScale = s.stuck === 8 ? 2 : Math.max(0.3, s.stepScale * 0.85);
  }
}

/**
 * Other significant winners of the round, re-applied on top of the new best: two changes that each helped
 * alone often help together, and hill-climbing would otherwise only find that by chance.
 */
export function mergeWinners(prevBest: Weights, best: Weights, results: CandidateResult[], s: TuneState): Weights[] {
  const seen = new Set(s.tried);
  const out: Weights[] = [];
  for (const r of results) {
    if (r.accepted || r.w.id === best.id || !(r.score.diff > 0 && r.score.z >= SIGNIFICANT_Z)) continue;
    const cand: Weights = { ...best };
    for (const k of TUNABLE_KEYS) if (r.w[k] !== prevBest[k]) cand[k] = r.w[k];
    const key = weightsKey(cand);
    if (seen.has(key) || key === weightsKey(best)) continue;
    seen.add(key);
    out.push(withIdentity(cand, best, s, 'hill', `merge: ${best.id} + การเปลี่ยนของ ${r.w.id} (${describeChanges(prevBest, r.w)})`));
  }
  return out;
}

/** Directions that keep failing: worth saying out loud, and the reason the tuner tries them less. */
export function deadEnds(s: TuneState, minTries = 3): string[] {
  const out: string[] = [];
  for (const [k, st] of Object.entries(s.keyStats)) {
    for (const dir of ['up', 'down'] as const) {
      const d = st[dir];
      // dead only when it never won and mostly did not even lean the right way
      if (d.tries >= minTries && d.wins === 0 && (d.pos ?? 0) * 2 < d.tries) out.push(`${dir === 'up' ? 'เพิ่ม' : 'ลด'} ${k} ไม่เคยช่วย (${d.tries} ครั้ง)`);
    }
  }
  return out;
}

export function promising(s: TuneState): string[] {
  const out: string[] = [];
  for (const [k, st] of Object.entries(s.keyStats)) {
    for (const dir of ['up', 'down'] as const) {
      const d = st[dir];
      const pos = d.pos ?? 0;
      if (d.wins > 0) out.push(`${dir === 'up' ? 'เพิ่ม' : 'ลด'} ${k} ได้ผล ${d.wins}/${d.tries} ครั้ง`);
      else if (pos * 2 >= d.tries && d.tries >= 2) out.push(`${dir === 'up' ? 'เพิ่ม' : 'ลด'} ${k} เกือบได้ผล (ดีขึ้นแต่ยังไม่ผ่านเกณฑ์ ${pos}/${d.tries} ครั้ง)`);
    }
  }
  return out;
}

export type LlmReason = 'stuck' | 'periodic' | 'rules-changed' | 'manual';

/** When to ask the advisor: stuck, every N rounds, or right after the game/bot changed. */
export function llmReason(s: TuneState, opts: { stuckAfter: number; every: number; rulesChanged: boolean }): LlmReason | null {
  if (opts.rulesChanged) return 'rules-changed';
  if (s.stuck >= opts.stuckAfter && s.round - s.llm.lastRound >= opts.stuckAfter) return 'stuck';
  if (opts.every > 0 && s.round > 0 && s.round % opts.every === 0 && s.round !== s.llm.lastRound) return 'periodic';
  return null;
}
