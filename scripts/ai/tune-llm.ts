/**
 * Tune by LLM: the advisor proposes every round, on a few quick seeds, and only a confirmed winner becomes best.
 *
 *   npm run tune-llm -- --run=<name> [--start=<id>] [--seeds=10] [--confirm=40] [--confirm-top=2] [--difficulty=normal] [--threads=N]
 *   npm run tune-llm -- --run=<name> --import=answer.json
 *
 * Each call is one step, then it stops so the advisor (Claude in the chat) can answer:
 *   1. with --import: play every proposal on the quick seeds against best; the top quick winners (better on the quick seeds)
 *      are replayed on the confirm seeds, and the best of them becomes best only if it wins there by 2 standard errors
 *   2. play best on the quick seeds and write the next request: sim-runs/tune-llm-<name>/llm/request-rNNN.md
 * Everything lands in sim-runs/tune-llm-<name>/: state.json, history.jsonl, reports/round-NNN.md, llm/.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Difficulty } from '../../src/game/game';
import { SIGNIFICANT_Z, paired, summarize, type Paired } from '../../src/ai/analyze';
import { buildRequest, parseAdvice, requestPrompt, type HistoryEntry } from '../../src/ai/advisor';
import { roundReport } from '../../src/ai/report';
import { judge, learn, newState, type TuneState } from '../../src/ai/tuner';
import { describeChanges, type Weights } from '../../src/ai/weights';
import { Pool, RUNS, arg, evaluate, loadWeights, readJson, rulesHash, saveWeights, threads, writeJson, writeText } from './lib';

interface LoopState extends TuneState {
  /** seeds a quick winner is replayed on before it may become best */
  confirmSeeds: number;
}

const pad = (n: number) => String(n).padStart(3, '0');
const fmt = (p: Paired) => `${p.diff >= 0 ? '+' : ''}${p.diff.toFixed(2)} ± ${p.se.toFixed(2)} (z ${p.z.toFixed(1)})`;

export async function tuneLlm() {
  const run = arg('run');
  if (!run) throw new Error('--run=<name> is required (results go to sim-runs/tune-llm-<name>/)');
  const DIR = join(RUNS, `tune-llm-${run}`);
  const STATE = join(DIR, 'state.json');
  const HISTORY = join(DIR, 'history.jsonl');
  const MISSING = join(DIR, 'missing-weights.md');
  const readHistory = (): HistoryEntry[] =>
    existsSync(HISTORY) ? readFileSync(HISTORY, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const readMissing = (): string[] =>
    existsSync(MISSING) ? readFileSync(MISSING, 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.replace(/^- (\[[^\]]*\] )?/, '')) : [];

  mkdirSync(DIR, { recursive: true });
  const rules = rulesHash();
  let state: LoopState;
  if (existsSync(STATE)) {
    state = readJson<LoopState>(STATE);
    for (const [name, v] of [['seeds', state.seeds], ['confirm', state.confirmSeeds], ['difficulty', state.difficulty]] as const) {
      const given = arg(name);
      if (given !== undefined && String(given) !== String(v)) throw new Error(`this run uses --${name}=${v}; start a new --run to change it`);
    }
  } else {
    const start = loadWeights(arg('start'));
    saveWeights(start);
    state = { ...newState(rules, arg('difficulty') ?? 'normal', +(arg('seeds') ?? 10), start), confirmSeeds: +(arg('confirm') ?? 40), idPrefix: `llm-${run}-` };
    console.log(`new tune-llm run from ${start.id}`);
  }
  if (state.rulesHash !== rules) {
    console.log(`rules changed (${state.rulesHash} → ${rules}): every evaluation is replayed`);
    state.rulesHash = rules;
  }
  const difficulty = state.difficulty as Difficulty;
  const quick = state.seeds, confirm = state.confirmSeeds;
  const topN = +(arg('confirm-top') ?? 2);
  let best = loadWeights(state.bestId);
  const pool = new Pool(threads());
  const play = (w: Weights, n: number) => evaluate(pool, w, 'train', n, difficulty, rules);
  const command = `npm run tune-llm -- --run=${run} --import=<ไฟล์คำตอบ>`;
  console.log(`tune-llm ${run} · ${quick} quick seeds, confirm on ${confirm} · ${difficulty} · rules ${rules} · best ${best.id}`);

  try {
    const importFile = arg('import');
    if (importFile) {
      const t0 = Date.now();
      state.round++;
      const callId = `llm-r${state.round}`;
      const raw = readJson(importFile);
      writeJson(join(DIR, 'llm', `answer-r${pad(state.round)}.json`), raw);
      const advice = parseAdvice(raw, best, state, callId);
      state.llm.calls++;
      state.llm.lastRound = state.round;
      for (const p of advice.problems) console.log(`  ! ${p}`);
      if (advice.missingWeights.length) appendFileSync(MISSING, advice.missingWeights.map((m) => `- [${callId}] ${m}`).join('\n') + '\n');
      if (!advice.proposals.length) throw new Error('no usable proposals in the answer (see the problems above)');

      // 1. quick seeds: everyone against best
      const bestQuick = await play(best, quick);
      const played = [];
      for (const w of advice.proposals) {
        saveWeights(w);
        played.push({ w, recs: (await play(w, quick)).records });
      }
      const results = judge(bestQuick.records, played);
      for (const r of results) r.accepted = false;

      // 2. confirm the top quick winners on more seeds; only a significant win there counts
      const confirmed = new Map<string, Paired>();
      const contenders = results.filter((r) => r.score.diff > 0).sort((a, b) => b.score.diff - a.score.diff).slice(0, topN);
      if (contenders.length) {
        const bestFull = await play(best, confirm);
        for (const r of contenders) confirmed.set(r.w.id, paired(bestFull.records, (await play(r.w, confirm)).records));
        const winner = contenders
          .filter((r) => confirmed.get(r.w.id)!.diff > 0 && confirmed.get(r.w.id)!.z >= SIGNIFICANT_Z)
          .sort((a, b) => confirmed.get(b.w.id)!.diff - confirmed.get(a.w.id)!.diff)[0];
        if (winner) winner.accepted = true;
      }
      const prevBest = best;
      learn(state, best, results);
      const winner = results.find((r) => r.accepted);
      if (winner) {
        best = winner.w;
        state.bestId = best.id;
      }
      for (const r of results) {
        const c = confirmed.get(r.w.id);
        const h: HistoryEntry = {
          round: state.round, id: r.w.id, source: r.w.source ?? 'llm', change: describeChanges(prevBest, r.w),
          delta: r.score.diff, se: r.score.se, z: r.score.z, accepted: r.accepted,
          hypothesis: r.w.proposal?.hypothesis,
          verdicts: r.verdicts.map((v) => `${v.label} ${v.direction}: ${v.verdict}`),
        };
        if (c) h.confirm = { seeds: confirm, delta: c.diff, se: c.se, z: c.z };
        appendFileSync(HISTORY, JSON.stringify(h) + '\n');
      }

      const report = roundReport({
        state, prevBest, best, bestSummary: summarize((await play(best, quick)).records), results, next: [],
        advice: { diagnosis: advice.diagnosis, missingWeights: advice.missingWeights, problems: advice.problems },
        seconds: (Date.now() - t0) / 1000,
      });
      const lines = [`## ยืนยันบน ${confirm} seed`, ''];
      if (!contenders.length) lines.push(`ไม่มีข้อเสนอไหนดีกว่า best บน ${quick} seed ชุดเร็ว จึงไม่ได้ยืนยัน`);
      for (const r of contenders) {
        const c = confirmed.get(r.w.id)!;
        lines.push(`- \`${r.w.id}\` ${describeChanges(prevBest, r.w)}: ${quick} seed ${fmt(r.score)} → ${confirm} seed ${fmt(c)} · ${r.accepted ? '**รับเป็น best**' : 'ไม่รับ'}`);
      }
      writeText(join(DIR, 'reports', `round-${pad(state.round)}.md`), `${report}\n${lines.join('\n')}\n`);
      console.log(
        `round ${state.round}: ` +
          results.map((r) => `${r.w.id} ${fmt(r.score)}${confirmed.has(r.w.id) ? ` → ${confirm} seed ${fmt(confirmed.get(r.w.id)!)}` : ''}`).join(' · '),
      );
      console.log(winner ? `accepted ${winner.w.id}: new best` : `no confirmed win, best stays ${best.id}`);
    }

    // next request: best on the quick seeds
    const bestQuick = await play(best, quick);
    const request = buildRequest({
      reason: 'loop', state, best, summary: summarize(bestQuick.records), history: readHistory(), missingWeightsSoFar: readMissing(),
      acceptRule: `ข้อเสนอทุกชุดเล่นบน ${quick} seed ก่อน; ชุดที่ดีกว่า best (สูงสุด ${topN} ชุด) จะถูกเล่นซ้ำบน ${confirm} seed และรับเป็น best เมื่อคะแนนเฉลี่ยรายคู่สูงกว่าเกิน 2 เท่าของ standard error`,
    });
    const base = join(DIR, 'llm', `request-r${pad(state.round)}`);
    writeJson(`${base}.json`, request);
    writeText(`${base}.md`, requestPrompt(request));
    writeJson(STATE, state);
    console.log(`best ${best.id}: score ${summarize(bestQuick.records).score} on ${quick} seeds`);
    console.log(`advisor request: ${base}.md`);
    console.log(`answer it, then: ${command}`);
  } finally {
    writeJson(STATE, state);
    pool.close();
  }
}
