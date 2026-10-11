/**
 * Weight sets for the browser auto-play: the built-in ones, a set saved by the tuner
 * (the Vite dev server serves the project root, so sim-runs/weights/<id>.json is reachable), or a file.
 */
import { DEFAULT_WEIGHTS, SMART_WEIGHTS, withDefaults, type Weights } from './weights';

export async function fetchWeights(spec: string): Promise<Weights> {
  const id = spec.trim() || 'w0';
  if (id === 'w0') return DEFAULT_WEIGHTS;
  if (id === 'smart') return SMART_WEIGHTS;
  if (!/^[\w.-]+$/.test(id)) throw new Error(`"${id}" is not a weight set id`);
  const res = await fetch(`/sim-runs/weights/${id}.json`);
  // a missing file comes back as index.html (the dev server's SPA fallback), not as a 404
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
    throw new Error(`weights "${id}" not found (sim-runs/weights is only served by npm run dev)`);
  }
  return parseWeights(await res.text(), id);
}

export interface GameSummary {
  seed: number;
  level: number;
  lives: number;
}

/** One weight set's cached evaluation (the one with the most seeds) */
export interface WeightResult {
  id: string;
  seeds: number;
  /** rules hash the games were played under; another than WeightIndex.rules means the bot or game changed since */
  rules: string;
  avgLevel: number;
  avgScore: number;
  wins: number;
  best: GameSummary;
  median: GameSummary;
}

export interface WeightIndex {
  /** saved sets, newest first */
  sets: { id: string; note: string; blueprint: string }[];
  /** the current best of each tuning run, most recently active run first */
  best: { run: string; id: string }[];
  results: WeightResult[];
  /** rules hash of the code running now */
  rules: string;
}

const EMPTY: WeightIndex = { sets: [], best: [], results: [], rules: '' };

/** What the dev server can offer (vite.config.ts /__weights); empty in a production build. */
export async function listWeights(): Promise<WeightIndex> {
  try {
    const res = await fetch('/__weights');
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return EMPTY;
    return { ...EMPTY, ...((await res.json()) as Partial<WeightIndex>) };
  } catch {
    return EMPTY;
  }
}

export function parseWeights(text: string, fallbackId: string): Weights {
  const raw = JSON.parse(text) as Partial<Weights>;
  const w = withDefaults(raw);
  if (!raw.id) w.id = fallbackId;
  return w;
}
