/**
 * Every number the bot decides with. Tuning (by hand or by the tuner) only ever changes these,
 * so a weight set + a seed fully describes a bot game.
 */
export interface Weights {
  /** short name, e.g. "w12" */
  id: string;
  /** weight set this one was derived from */
  parent?: string;
  /** why it exists / what changed */
  note?: string;

  // ---- placement ----
  /** score per tile the route grows when a route tile is blocked; 0 = never maze */
  mazeGain: number;
  /** flat bonus for a mazing tile over a plain one (only when mazeGain > 0) */
  mazeBonus: number;
  /** score per route tile next to a candidate tile */
  routeAdjacency: number;
  /** random tie-break added to every plain tile score */
  tieNoise: number;

  // ---- economy ----
  /** upgrade gem quality when gold >= its cost + this */
  qualityReserve: number;
  /** stop upgrading gem quality at this level */
  qualityMaxLevel: number;
  /** upgrade a tower when gold >= its cost + this */
  upgradeReserve: number;
  /** buy lives (10 gold each) while lives are below this; 0 = never */
  buyLifeBelow: number;

  // ---- keep / combine choice: score = power(result) + bonus ----
  specialBonus: number;
  combine4Bonus: number;
  combine2Bonus: number;

  // ---- tower power (dps-based) ----
  /** extra power per point of slow (0..1) */
  slowValue: number;
  /** extra power per tile of splash radius, scaled by dps */
  splashValue: number;
  /** multiplier for towers that can hit air (1 = no preference) */
  airValue: number;
}

/** Same behaviour as the original simulate.ts bot (without --smart). */
export const DEFAULT_WEIGHTS: Weights = {
  id: 'w0',
  note: 'baseline: the original simulate.ts bot',
  mazeGain: 0,
  mazeBonus: 100,
  routeAdjacency: 1,
  tieNoise: 0.5,
  qualityReserve: 30,
  qualityMaxLevel: 8,
  upgradeReserve: 20,
  buyLifeBelow: 0,
  specialBonus: 3000,
  combine4Bonus: 2000,
  combine2Bonus: 1000,
  slowValue: 0,
  splashValue: 0,
  airValue: 1,
};

/** The original --smart bot: greedy mazing. */
export const SMART_WEIGHTS: Weights = { ...DEFAULT_WEIGHTS, id: 'smart', note: 'baseline + greedy mazing', mazeGain: 1 };

/** Numeric keys a tuner may change. */
export const TUNABLE_KEYS = (Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]).filter(
  (k) => typeof DEFAULT_WEIGHTS[k] === 'number',
) as NumericWeightKey[];

export type NumericWeightKey = { [K in keyof Weights]: Weights[K] extends number ? K : never }[keyof Weights];

/** Fills in any keys missing from an older or hand-written weight file. */
export function withDefaults(w: Partial<Weights>): Weights {
  return { ...DEFAULT_WEIGHTS, ...w, id: w.id ?? 'custom' };
}
