/**
 * Weight tuning: hill-climbing on a fixed train seed set, a holdout set now and then, and an LLM advisor
 * you consult by hand (export a request, paste it into a chat, import the JSON answer).
 *
 *   npm run tune -- [--rounds=10] [--candidates=4] [--seeds=200] [--difficulty=normal] [--threads=N]
 *                   [--start=w0|smart|<id>|file.json]   first run (or with --reset) only
 *                   [--reset]                           archive sim-runs/tune and start over
 *                   [--import=answer.json]             next round plays the LLM's proposals
 *                   [--try=weights.json]               next round plays your own weight set(s)
 *                   [--export-llm]                     write an advisor request now, then stop
 *                   [--holdout-every=10] [--llm-stuck=12] [--llm-every=25]
 *
 * Everything lands in sim-runs/tune/: state.json, history.jsonl, reports/round-NNN.md, llm/.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Difficulty } from '../../src/game/game';
import { paired, summarize } from '../../src/ai/analyze';
import { buildRequest, parseAdvice, requestPrompt, type HistoryEntry, type ParsedAdvice } from '../../src/ai/advisor';
import { roundReport } from '../../src/ai/report';
import { judge, learn, llmReason, mergeWinners, newState, proposeHill, type LlmReason, type TuneState } from '../../src/ai/tuner';
import { describeChanges, weightsKey, withDefaults, type Weights } from '../../src/ai/weights';
import { Pool, RUNS, arg, evaluate, flag, loadWeights, readJson, rulesHash, saveWeights, stamp, threads, writeJson, writeText, type Evaluation } from './lib';

const TUNE = join(RUNS, 'tune');
const STATE = join(TUNE, 'state.json');
const HISTORY = join(TUNE, 'history.jsonl');
const MISSING = join(TUNE, 'missing-weights.md');
const pad = (n: number) => String(n).padStart(3, '0');

function readHistory(): HistoryEntry[] {
  if (!existsSync(HISTORY)) return [];
  return readFileSync(HISTORY, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function readMissing(): string[] {
  if (!existsSync(MISSING)) return [];
  return readFileSync(MISSING, 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.replace(/^- (\[[^\]]*\] )?/, ''));
}

export async function tune() {
  const rounds = +(arg('rounds') ?? 10);
  const k = +(arg('candidates') ?? 4);
  const n = +(arg('seeds') ?? 200);
  const difficulty = (arg('difficulty') ?? 'normal') as Difficulty;
  const holdEvery = +(arg('holdout-every') ?? 10);
  const stuckAfter = +(arg('llm-stuck') ?? 12);
  const every = +(arg('llm-every') ?? 25);

  if (flag('reset') && existsSync(TUNE)) {
    renameSync(TUNE, join(RUNS, `tune-${stamp()}`));
    console.log('archived the previous tuning run');
  }
  mkdirSync(TUNE, { recursive: true });
  const rules = rulesHash();
  let state: TuneState;
  if (existsSync(STATE)) {
    state = readJson<TuneState>(STATE);
    if (state.seeds !== n || state.difficulty !== difficulty) {
      throw new Error(`this tuning run uses ${state.seeds} ${state.difficulty} seeds; pass the same --seeds/--difficulty or --reset`);
    }
  } else {
    const start = loadWeights(arg('start'));
    saveWeights(start);
    state = newState(rules, difficulty, n, start);
    console.log(`new tuning run from ${start.id}`);
  }
  let best = loadWeights(state.bestId);

  let rulesChanged: { from: string; to: string } | undefined;
  if (state.rulesHash !== rules) {
    rulesChanged = { from: state.rulesHash, to: rules };
    state.rulesHash = rules;
    // old results no longer describe this game: allow retrying anything, but keep the direction statistics
    state.tried = [weightsKey(best)];
    state.stuck = 0;
    console.log(`rules changed (${rulesChanged.from} → ${rules}): best will be replayed`);
  }

  const pool = new Pool(threads());
  const save = () => writeJson(STATE, state);
  const train = (w: Weights) => evaluate(pool, w, 'train', n, difficulty, rules);
  console.log(`tuning · ${n} seeds · ${difficulty} · rules ${rules} · ${pool.size} threads · best ${best.id}`);

  try {
    let advice: ParsedAdvice | undefined;
    const importFile = arg('import');
    if (importFile) {
      const callId = `llm-r${state.round}`;
      advice = parseAdvice(readJson(importFile), best, state, callId);
      state.llm.calls++;
      state.llm.lastRound = state.round;
      writeJson(join(TUNE, 'llm', `answer-r${pad(state.round)}.json`), readJson(importFile));
      for (const p of advice.problems) console.log(`  ! ${p}`);
      if (advice.missingWeights.length) {
        appendFileSync(MISSING, advice.missingWeights.map((m) => `- [${callId}] ${m}`).join('\n') + '\n');
      }
      if (!advice.proposals.length) throw new Error('no usable proposals in the answer (see the problems above)');
      state.pending = advice.proposals;
      console.log(`imported ${advice.proposals.length} LLM proposals: ${advice.proposals.map((p) => p.id).join(', ')}`);
    }
    const tryFile = arg('try');
    if (tryFile) {
      const raw = readJson<Partial<Weights> | Partial<Weights>[]>(tryFile);
      state.pending = (Array.isArray(raw) ? raw : [raw]).map((r) => {
        const w = withDefaults(r);
        return { ...w, id: `w${state.nextId++}`, parent: best.id, source: 'manual' as const, note: r.note ?? `manual: ${describeChanges(best, w)}` };
      });
      console.log(`next round plays your ${state.pending.length} weight set(s)`);
    }

    if (flag('export-llm')) {
      const e = await train(best);
      const file = exportRequest('manual', state, best, e);
      save();
      console.log(`advisor request: ${file}`);
      return;
    }

    for (let r = 0; r < rounds; r++) {
      const t0 = Date.now();
      state.round++;
      const bestEval = await train(best);
      const cands = state.pending.length ? state.pending : proposeHill(best, state, k);
      state.pending = [];
      const played: { w: Weights; recs: Evaluation['records'] }[] = [];
      for (const w of cands) {
        saveWeights(w);
        played.push({ w, recs: (await train(w)).records });
      }
      const results = judge(bestEval.records, played);
      const prevBest = best;
      learn(state, best, results);
      const winner = results.find((x) => x.accepted);
      if (winner) {
        best = winner.w;
        state.bestId = best.id;
      }
      for (const x of results) {
        const h: HistoryEntry = {
          round: state.round, id: x.w.id, source: x.w.source ?? 'manual', change: describeChanges(prevBest, x.w),
          delta: x.score.diff, se: x.score.se, z: x.score.z, accepted: x.accepted,
        };
        if (x.w.proposal) {
          h.hypothesis = x.w.proposal.hypothesis;
          h.verdicts = x.verdicts.map((v) => `${v.label} ${v.direction}: ${v.verdict}`);
        }
        appendFileSync(HISTORY, JSON.stringify(h) + '\n');
      }

      const bestTrain = await train(best);
      const bestSummary = summarize(bestTrain.records);

      let holdout: Parameters<typeof roundReport>[0]['holdout'];
      if (holdEvery > 0 && state.round % holdEvery === 0) {
        const hEval = await evaluate(pool, best, 'holdout', n, difficulty, rules);
        holdout = { score: summarize(hEval.records).score };
        // total gain since the run started, on seeds the tuner never saw: the overfitting check
        const startId = state.startId ?? 'w0';
        if (startId !== best.id) {
          const startW = loadWeights(startId);
          holdout.vsPrev = paired((await evaluate(pool, startW, 'holdout', n, difficulty, rules)).records, hEval.records);
          holdout.prevId = startId;
          holdout.trainVsPrev = paired((await train(startW)).records, bestTrain.records);
        }
        state.holdout.push({ round: state.round, bestId: best.id, score: holdout.score });
      }

      const reason: LlmReason | null = llmReason(state, { stuckAfter, every, rulesChanged: !!rulesChanged && r === 0 });
      const llm = reason ? { reason, file: exportRequest(reason, state, best, bestTrain) } : undefined;
      if (llm) state.llm.lastRound = state.round;

      const merged = mergeWinners(prevBest, best, results, state);
      const next = [...merged, ...proposeHill(best, state, Math.max(1, k - merged.length))];
      state.pending = next;
      const report = roundReport({
        state, prevBest, best, bestSummary, results, holdout, llm, next,
        rulesChanged: r === 0 ? rulesChanged : undefined,
        advice: r === 0 && advice ? { diagnosis: advice.diagnosis, missingWeights: advice.missingWeights, problems: advice.problems } : undefined,
        seconds: (Date.now() - t0) / 1000,
      });
      const reportFile = join(TUNE, 'reports', `round-${pad(state.round)}.md`);
      writeText(reportFile, report);
      save();

      const top = [...results].sort((a, b) => b.score.diff - a.score.diff)[0];
      console.log(
        `round ${state.round}: best ${best.id} score ${bestSummary.score} (level ${bestSummary.avgLevel})` +
          (winner ? ` ← accepted ${winner.w.id} +${winner.score.diff.toFixed(2)}` : ` · no win (top ${top?.w.id} ${top?.score.diff.toFixed(2)} z ${top?.score.z})`) +
          ` · stuck ${state.stuck}${llm ? ` · ask the LLM: ${llm.file}` : ''}`,
      );
    }
    console.log(`reports: ${join(TUNE, 'reports')}`);
  } finally {
    save();
    pool.close();
  }
}

function exportRequest(reason: LlmReason, state: TuneState, best: Weights, e: Evaluation): string {
  const request = buildRequest({ reason, state, best, summary: summarize(e.records), history: readHistory(), missingWeightsSoFar: readMissing() });
  const base = join(TUNE, 'llm', `request-r${pad(state.round)}`);
  writeJson(`${base}.json`, request);
  writeText(`${base}.md`, requestPrompt(request));
  return `${base}.md`;
}
