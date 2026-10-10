/**
 * Shared pieces of the AI command line: worker pool, seed sets, cached evaluations, weight loading.
 * Results live in sim-runs/ (not in git). Evaluations are cached per "rules hash": a hash of every source
 * file that can change how a bot game plays out, so editing the game or the bot never mixes old and new numbers.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Difficulty } from '../../src/game/game';
import type { GameRecord } from '../../src/ai/recorder';
import { DEFAULT_WEIGHTS, SMART_WEIGHTS, weightsKey, withDefaults, type Weights } from '../../src/ai/weights';

declare const process: { argv: string[]; exitCode: number; cwd(): string; stdout: { write(s: string): void } };

export interface Task {
  i: number;
  seed: number;
  difficulty: Difficulty;
  weights: Weights;
}

export const ROOT = process.cwd();
export const RUNS = join(ROOT, 'sim-runs');
export const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
export const flag = (name: string) => process.argv.includes(`--${name}`);
export const threads = () => +(arg('threads') ?? Math.max(1, cpus().length - 1));
export const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

/** Train seeds are 1..n; holdout seeds sit far away so the two sets never overlap. */
export type SeedSet = 'train' | 'holdout';
export const seedsOf = (set: SeedSet, n: number) => Array.from({ length: n }, (_, i) => (set === 'train' ? 1 : 1_000_001) + i);

/** Everything that decides how a bot game plays out. Reports and analysis are left out on purpose. */
export function rulesHash(): string {
  const h = createHash('sha1');
  const files = ['src/ai/bot.ts', 'src/ai/runner.ts', 'src/ai/recorder.ts', 'src/ai/weights.ts'];
  for (const d of ['src/game', 'src/data']) for (const f of readdirSync(join(ROOT, d))) files.push(`${d}/${f}`);
  // line endings differ between checkouts; they must not change the hash
  for (const f of files.sort()) h.update(f).update(readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 10);
}

export function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 1));
}
export function writeText(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));

export class Pool {
  private workers: Worker[];
  constructor(readonly size: number) {
    // the bundled entry file doubles as the worker script (it checks isMainThread)
    const file = fileURLToPath(import.meta.url);
    this.workers = Array.from({ length: size }, () => new Worker(file));
  }

  /** Plays every task, one per worker at a time; results come back in task order. */
  run(tasks: Omit<Task, 'i'>[], onProgress?: (done: number) => void): Promise<GameRecord[]> {
    const out: GameRecord[] = new Array(tasks.length);
    let next = 0, done = 0;
    return new Promise((resolve, reject) => {
      if (!tasks.length) return resolve(out);
      const feed = (w: Worker) => {
        if (next < tasks.length) w.postMessage({ ...tasks[next], i: next++ });
      };
      for (const w of this.workers) {
        w.removeAllListeners('message');
        w.removeAllListeners('error');
        w.on('error', reject);
        w.on('message', (m: { i: number; rec?: GameRecord; error?: string }) => {
          if (m.error) return reject(new Error(m.error));
          out[m.i] = m.rec!;
          onProgress?.(++done);
          if (done === tasks.length) resolve(out);
          else feed(w);
        });
        feed(w);
      }
    });
  }

  close() {
    for (const w of this.workers) void w.terminate();
  }
}

export interface Evaluation {
  weightsId: string;
  weightsKey: string;
  seedSet: SeedSet;
  difficulty: Difficulty;
  rulesHash: string;
  seconds: number;
  records: GameRecord[];
}

/** Plays (or loads from cache) one weight set on one seed set. */
export async function evaluate(pool: Pool, w: Weights, set: SeedSet, n: number, difficulty: Difficulty, rules: string): Promise<Evaluation> {
  const path = join(RUNS, 'evals', rules, `${w.id}.${set}${n}.${difficulty}.json`);
  if (existsSync(path)) {
    const e = readJson<Evaluation>(path);
    if (e.weightsKey === weightsKey(w)) return e;
  }
  const t0 = Date.now();
  const records = await pool.run(
    seedsOf(set, n).map((seed) => ({ seed, difficulty, weights: w })),
    (done) => {
      if (done % 10 === 0 || done === n) process.stdout.write(`\r  ${w.id} ${set}: ${done}/${n}   `);
    },
  );
  process.stdout.write('\n');
  const e: Evaluation = { weightsId: w.id, weightsKey: weightsKey(w), seedSet: set, difficulty, rulesHash: rules, seconds: (Date.now() - t0) / 1000, records };
  writeJson(path, e);
  return e;
}

/** w0, smart, an id saved in sim-runs/weights, or a path to a JSON file. */
export function loadWeights(spec: string | undefined): Weights {
  if (!spec || spec === 'w0') return DEFAULT_WEIGHTS;
  if (spec === 'smart') return SMART_WEIGHTS;
  const saved = join(RUNS, 'weights', `${spec}.json`);
  const path = existsSync(saved) ? saved : spec;
  const w = withDefaults(readJson<Partial<Weights>>(path));
  if (w.id === 'custom') w.id = spec.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
  return w;
}

export function saveWeights(w: Weights) {
  writeJson(join(RUNS, 'weights', `${w.id}.json`), w);
}
