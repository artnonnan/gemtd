/**
 * Dev server only: /__weights feeds the AI auto-play panel with
 * - every weight set in sim-runs/weights (newest first) and the best set of each tuning run
 * - a leaderboard from the cached evaluations in sim-runs/evals: average level per set, its best and median seed
 * A production build has no such endpoint and offers only w0 / smart.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { rulesHash } from './scripts/ai/rules-hash';

const RUNS = 'sim-runs';

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

interface Rec { seed: number; level: number; lives: number; score: number; result: string }
interface Result {
  id: string;
  seeds: number;
  rules: string;
  avgLevel: number;
  avgScore: number;
  wins: number;
  best: { seed: number; level: number; lives: number };
  median: { seed: number; level: number; lives: number };
  mtime: number;
}

/** summaries of eval files, re-read only when a file changes */
const evalCache = new Map<string, { mtime: number; result: Result | null }>();

function summarizeEval(path: string, id: string, rules: string, mtime: number): Result | null {
  const j = readJson(path) as { records?: Rec[] } | Rec[] | null;
  const recs = (Array.isArray(j) ? j : j?.records) ?? [];
  if (!recs.length) return null;
  const byScore = [...recs].sort((a, b) => b.score - a.score || a.seed - b.seed);
  const pick = (r: Rec) => ({ seed: r.seed, level: r.level, lives: r.lives });
  const avg = (f: (r: Rec) => number) => Math.round((recs.reduce((s, r) => s + f(r), 0) / recs.length) * 100) / 100;
  return {
    id, seeds: recs.length, rules, mtime,
    avgLevel: avg((r) => r.level),
    avgScore: avg((r) => r.score),
    wins: recs.filter((r) => r.result === 'victory').length,
    best: pick(byScore[0]),
    median: pick(byScore[Math.floor(byScore.length / 2)]),
  };
}

/** per weight set: the evaluation with the most seeds (then the newest), on normal difficulty train seeds */
function leaderboard(): Result[] {
  const dir = join(RUNS, 'evals');
  if (!existsSync(dir)) return [];
  const best = new Map<string, Result>();
  for (const rules of readdirSync(dir)) {
    const sub = join(dir, rules);
    if (!statSync(sub).isDirectory()) continue;
    for (const f of readdirSync(sub)) {
      const m = /^(.+)\.train(\d+)\.normal\.json$/.exec(f);
      if (!m) continue;
      const path = join(sub, f);
      const mtime = statSync(path).mtimeMs;
      let c = evalCache.get(path);
      if (!c || c.mtime !== mtime) evalCache.set(path, (c = { mtime, result: summarizeEval(path, m[1], rules, mtime) }));
      const r = c.result;
      if (!r) continue;
      const old = best.get(r.id);
      if (!old || r.seeds > old.seeds || (r.seeds === old.seeds && r.mtime > old.mtime)) best.set(r.id, r);
    }
  }
  return [...best.values()];
}

function weightList() {
  const dir = join(RUNS, 'weights');
  const sets = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const w = readJson(join(dir, f));
          return { id: f.slice(0, -5), note: typeof w?.note === 'string' ? w.note : '', blueprint: typeof w?.blueprintId === 'string' ? w.blueprintId : '', mtime: statSync(join(dir, f)).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime)
    : [];
  // every tuning run keeps its current best in state.json
  const best = existsSync(RUNS)
    ? readdirSync(RUNS)
        .filter((d) => d.startsWith('tune') && existsSync(join(RUNS, d, 'state.json')))
        .map((d) => ({ run: d, id: String(readJson(join(RUNS, d, 'state.json'))?.bestId ?? ''), mtime: statSync(join(RUNS, d, 'state.json')).mtimeMs }))
        .filter((b) => b.id)
        .sort((a, b) => b.mtime - a.mtime)
    : [];
  // only sets the browser can load (a saved file, or a built-in)
  const known = new Set(['w0', 'smart', ...sets.map((s) => s.id)]);
  const results = leaderboard().filter((r) => known.has(r.id));
  return { sets, best, results, rules: rulesHash(process.cwd()) };
}

const weightsIndex = (): Plugin => ({
  name: 'weights-index',
  configureServer(server) {
    server.middlewares.use('/__weights', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(weightList()));
    });
  },
});

export default defineConfig({ plugins: [weightsIndex()] });
