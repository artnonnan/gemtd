/**
 * AI command line. The same bundled file also runs as each worker thread.
 *   npm run batch -- [--weights=w0|smart|<id>|file.json] [--seeds=200] [--holdout] [--difficulty=normal] [--threads=N]
 *   npm run tune  -- [options, see tune.ts]
 */
import { join } from 'node:path';
import { isMainThread, parentPort } from 'node:worker_threads';
import type { Difficulty } from '../../src/game/game';
import { recordBotGame } from '../../src/ai/recorder';
import { summarize } from '../../src/ai/analyze';
import { batchReport } from '../../src/ai/report';
import { Pool, RUNS, arg, evaluate, flag, loadWeights, rulesHash, seedsOf, stamp, threads, writeText, type SeedSet, type Task } from './lib';
import { tune } from './tune';

declare const process: { argv: string[]; exitCode: number };

async function batch() {
  const w = loadWeights(arg('weights'));
  const n = +(arg('seeds') ?? 200);
  const set: SeedSet = flag('holdout') ? 'holdout' : 'train';
  const difficulty = (arg('difficulty') ?? 'normal') as Difficulty;
  const rules = rulesHash();
  const pool = new Pool(threads());
  console.log(`batch ${w.id} · ${n} ${set} seeds · ${difficulty} · rules ${rules} · ${pool.size} threads`);
  try {
    const e = await evaluate(pool, w, set, n, difficulty, rules);
    const s = summarize(e.records);
    const seeds = seedsOf(set, n);
    const md = batchReport(s, w, { seeds: `${seeds[0]}–${seeds[n - 1]}`, rulesHash: rules, date: new Date().toLocaleString('th-TH'), seconds: e.seconds });
    const path = join(RUNS, 'batch', `${stamp()}-${w.id}.md`);
    writeText(path, md);
    console.log(`score ${s.score} · avg level ${s.avgLevel} · win ${Math.round(s.winRate * 100)}% · ${e.seconds.toFixed(0)}s`);
    console.log(`report: ${path}`);
  } finally {
    pool.close();
  }
}

if (!isMainThread) {
  parentPort!.on('message', (t: Task) => {
    try {
      parentPort!.postMessage({ i: t.i, rec: recordBotGame({ seed: t.seed, difficulty: t.difficulty, weights: t.weights }) });
    } catch (e) {
      parentPort!.postMessage({ i: t.i, error: `seed ${t.seed}: ${(e as Error).message}` });
    }
  });
} else {
  const cmd = process.argv[2];
  try {
    if (cmd === 'batch') await batch();
    else if (cmd === 'tune') await tune();
    else console.log('usage: npm run batch|tune -- [options]');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
