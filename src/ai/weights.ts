/**
 * Every number the bot decides with. Tuning (by hand, by the tuner or by an LLM advisor) only ever changes these,
 * so a weight set + a seed fully describes a bot game.
 */
import { BLUEPRINT_IDS } from './blueprint';

export interface Weights {
  /** short name, e.g. "w12" */
  id: string;
  /** weight set this one was derived from */
  parent?: string;
  /** why it exists / what changed */
  note?: string;
  /** who made it: lets us check later whether LLM advice actually wins */
  source?: WeightSource;
  /** set when an LLM proposed it: what it expected to happen, checked after the run */
  proposal?: Proposal;

  // ---- placement ----
  /** score per tile the route grows when a route tile is blocked; 0 = never maze */
  mazeGain: number;
  /** flat bonus for a mazing tile over a plain one (only when mazeGain > 0) */
  mazeBonus: number;
  /** score per route tile next to a candidate tile */
  routeAdjacency: number;
  /** random tie-break added to every plain tile score */
  tieNoise: number;
  /** score per unit of ground exposure gained (fire creeps walk through), incl. what a block does to the route */
  groundExposure: number;
  /** score per flight-path tile the new gem would cover */
  airExposure: number;
  /** maze plan to follow (src/data/blueprints), or 'none' */
  blueprintId: string;
  /** bonus for the next cells of the plan: 10 × this for the first cell of the window, less for later ones */
  blueprintWeight: number;
  /** how many of the next unbuilt, placeable plan cells get the bonus */
  blueprintWindow: number;

  // ---- economy ----
  /** upgrade gem quality when gold >= its cost + this */
  qualityReserve: number;
  /** stop upgrading gem quality at this level */
  qualityMaxLevel: number;
  /** upgrade a tower when gold >= its cost + this */
  upgradeReserve: number;
  /** buy lives (10 gold each) while lives are below this; 0 = never */
  buyLifeBelow: number;

  // ---- keep / combine choice: score = power(result) × (1 + keepExposure × coverage / 10) + bonus ----
  /** how much a gem's position matters when choosing which to keep */
  keepExposure: number;
  /** keep/combine/special: power × (1 + this) for a gem standing on a blueprint slot */
  slotKeepBonus: number;
  /** penalty (10 × this) for building on a blueprint hub cell, or a reserve cell before it unlocks */
  reserveRespect: number;
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

export type WeightSource = 'baseline' | 'hill' | 'llm' | 'manual';

/** A metric the analyzer can measure per game, so a prediction can be checked automatically. */
export interface Expectation {
  metric: MetricName;
  /** only count these levels (inclusive), for the per-level metrics */
  levels?: [number, number];
  /** tower id, for the per-tower metrics */
  tower?: string;
  direction: 'up' | 'down';
}

export const METRICS = {
  score: 'คะแนนรวมต่อเกม (สูตรใน scoreFormula)',
  level: 'ด่านที่ไปถึง',
  lives: 'lives ที่เหลือตอนจบ',
  win: 'ชนะ (1) / แพ้ (0)',
  livesLost: 'lives ที่เสียทั้งหมด (ใส่ levels เพื่อดูเฉพาะช่วงด่าน)',
  'livesLost.air': 'lives ที่เสียในเวฟอากาศ (ไม่นับบอส)',
  'livesLost.ground': 'lives ที่เสียในเวฟพื้น (ไม่นับบอส)',
  'livesLost.boss': 'lives ที่เสียในเวฟบอส (Summon / Summon Air)',
  damageShare: 'สัดส่วน damage ของ tower ที่ระบุ (ใส่ tower)',
  picked: 'มี tower ที่ระบุอยู่บนกระดานตอนจบ (ใส่ tower)',
} as const;
export type MetricName = keyof typeof METRICS;

export interface Proposal {
  /** e.g. "llm-r25-2": advisor call + index, to group results by call */
  id: string;
  hypothesis: string;
  expect: Expectation[];
  expectText?: string;
}

export type NumericWeightKey = { [K in keyof Weights]-?: Weights[K] extends number ? K : never }[keyof Weights];

/** Weights that pick one of a few named options instead of a number. */
export const CHOICE_KEYS = ['blueprintId'] as const;
export type ChoiceKey = (typeof CHOICE_KEYS)[number];
export const choicesOf = (_k: ChoiceKey): string[] => BLUEPRINT_IDS;
export const CHOICE_DESCS: Record<ChoiceKey, string> = {
  blueprintId: 'แปลนเขาวงกตที่บอทพยายามสร้างตามลำดับ (none = ไม่ใช้แปลน); ดู blueprintWeight / blueprintWindow / slotKeepBonus',
};

export interface WeightSpec {
  min: number;
  max: number;
  /** whole numbers only */
  int?: boolean;
  /** what it does in the game, in words an advisor can reason about */
  desc: string;
}

/** Bounds and meaning of every tunable weight. Hill-climbing, clamping and the LLM summary all read this. */
export const WEIGHT_SPECS: Record<NumericWeightKey, WeightSpec> = {
  mazeGain: { min: 0, max: 5, desc: 'ให้ค่ากับการวางเจมบนทางเดินเพื่อให้ทางยาวขึ้น (คะแนนต่อความยาวที่เพิ่ม); 0 = ไม่ทำ maze เลย' },
  mazeBonus: { min: 0, max: 200, desc: 'โบนัสของช่องที่ทำ maze ได้ เทียบกับช่องข้างทาง (ใช้เมื่อ mazeGain > 0); ช่องข้างทางได้คะแนนราว routeAdjacency × จำนวนช่องทางเดินที่ติดกัน (0–8)' },
  routeAdjacency: { min: 0, max: 5, desc: 'คะแนนต่อช่องทางเดินที่อยู่ติดกับช่องที่จะวาง (วางชิดทางเพื่อให้ยิงถึง)' },
  tieNoise: { min: 0, max: 2, desc: 'ค่าสุ่มที่บวกให้ช่องธรรมดา เพื่อตัดสินช่องที่คะแนนใกล้กัน' },
  groundExposure: {
    min: 0, max: 5,
    desc: 'คะแนนต่อ exposure ภาคพื้นที่เพิ่มขึ้น (ไฟที่ครีปเดินผ่านทั้งทาง หน่วยเป็น "ช่องที่ tower เฉลี่ยหนึ่งตัวยิงถึง"): รวมทั้งช่องทางเดินที่เจมใหม่จะยิงถึง และผลของการบังทาง ถ้าบังแล้วครีปอ้อมพ้นระยะยิงของ tower เดิม ค่าจะติดลบ; 0 = ไม่ใช้',
  },
  blueprintWeight: { min: 0, max: 20, desc: 'ให้คะแนนช่องในแปลน: ช่องแรกของ window ได้ 10 × ค่านี้ ช่องถัดไปลดลงเป็นขั้น (ค่า 1 ≈ 10 คะแนน; ช่องดีสุดปกติได้ราว 40–50 คะแนน); ยังเลือกช่องนอกแปลนได้ถ้าคะแนนสูงกว่า; 0 = ไม่ใช้แปลน' },
  blueprintWindow: { min: 1, max: 40, int: true, desc: 'จำนวนช่องแปลนถัดไป (ที่ยังไม่สร้างและวางได้ตอนนี้) ที่ได้โบนัส; น้อย = ทำตามลำดับเคร่ง, มาก = ยืดหยุ่น' },
  airExposure: { min: 0, max: 5, desc: 'คะแนนต่อจำนวนช่องบนเส้นทางบิน (บินตรงระหว่าง checkpoint) ที่เจมใหม่จะยิงถึง; ช่วยวางเจมไว้รับเวฟอากาศ; 0 = ไม่ใช้' },
  reserveRespect: { min: 0, max: 20, desc: 'หักคะแนน 10 × ค่านี้ เมื่อจะวางเจมลงช่อง hub ของแปลน (ที่ต้องเว้นว่างให้ทางผ่านหลายรอบ) หรือช่อง reserve ก่อนด่านที่ปลดล็อก; 0 = ไม่สนใจ' },
  slotKeepBonus: { min: 0, max: 3, desc: 'ตอนเลือก keep/combine/special: power × (1 + ค่านี้) ถ้าเจมอยู่บนช่อง slot / final / reserve ของแปลน (จุดที่ยิงถึงทางเดินมาก)' },
  keepExposure: {
    min: 0, max: 3,
    desc: 'ตอนเลือก keep/combine/special คูณ power ด้วย (1 + ค่านี้ × จำนวนช่องทางที่ตำแหน่งนั้นยิงถึง / 10) โดยนับทางพื้นถ้ายิงพื้นได้ และทางบิน × สัดส่วนเวฟบินถ้ายิงอากาศได้; เจมแรงที่อยู่มุมที่ทางไม่ผ่านจะได้ค่าน้อย; 0 = ไม่ใช้',
  },
  qualityReserve: { min: 0, max: 300, int: true, desc: 'อัป gem quality เมื่อทอง ≥ ค่าอัป (20 + 30 × level) + ค่านี้; ต่ำ = อัปเร็ว ได้เจมดีเร็วแต่ทองเหลือน้อย' },
  qualityMaxLevel: { min: 0, max: 8, int: true, desc: 'gem quality สูงสุดที่จะอัป (0–8)' },
  upgradeReserve: { min: 0, max: 300, int: true, desc: 'อัป tower (ช่วงเวฟ) เมื่อทอง ≥ ค่าอัป + ค่านี้; แย่งทองกับการอัป quality' },
  buyLifeBelow: { min: 0, max: 50, int: true, desc: 'ซื้อ life (10 ทอง) เมื่อ lives ต่ำกว่าค่านี้; 0 = ไม่ซื้อ' },
  specialBonus: { min: 0, max: 5000, desc: 'โบนัสตอนเลือกทำ special tower (คะแนนตัวเลือก = power ของผลลัพธ์ + โบนัส); power ของเจมทั่วไปหลักสิบถึงหลักร้อย' },
  combine4Bonus: { min: 0, max: 5000, desc: 'โบนัสตอนเลือก combine 4 เม็ด (ได้เจมสูงขึ้น 2 ขั้น)' },
  combine2Bonus: { min: 0, max: 5000, desc: 'โบนัสตอนเลือก combine 2 เม็ด (ได้เจมสูงขึ้น 1 ขั้น); โบนัส 0 = เลือกตาม power อย่างเดียว' },
  slowValue: { min: 0, max: 5, desc: 'คูณ power ของ tower ด้วย (1 + ค่านี้ × สัดส่วน slow) ตอนเลือก keep/combine' },
  splashValue: { min: 0, max: 5, desc: 'คูณ power ด้วย (1 + ค่านี้ × รัศมี splash เป็นช่อง)' },
  airValue: { min: 0.2, max: 5, desc: 'คูณ power ของ tower ที่ยิงอากาศได้; >1 = ชอบ tower ยิงอากาศ' },
};

export const TUNABLE_KEYS = Object.keys(WEIGHT_SPECS) as NumericWeightKey[];

/** Same behaviour as the original simulate.ts bot (without --smart). */
export const DEFAULT_WEIGHTS: Weights = {
  id: 'w0',
  note: 'baseline: the original simulate.ts bot',
  source: 'baseline',
  mazeGain: 0,
  mazeBonus: 100,
  routeAdjacency: 1,
  tieNoise: 0.5,
  groundExposure: 0,
  airExposure: 0,
  blueprintId: 'none',
  blueprintWeight: 0,
  blueprintWindow: 10,
  qualityReserve: 30,
  qualityMaxLevel: 8,
  upgradeReserve: 20,
  buyLifeBelow: 0,
  keepExposure: 0,
  slotKeepBonus: 0,
  reserveRespect: 0,
  specialBonus: 3000,
  combine4Bonus: 2000,
  combine2Bonus: 1000,
  slowValue: 0,
  splashValue: 0,
  airValue: 1,
};

/** The original --smart bot: greedy mazing. */
export const SMART_WEIGHTS: Weights = { ...DEFAULT_WEIGHTS, id: 'smart', note: 'baseline + greedy mazing', mazeGain: 1 };

/** Keeps a value inside its spec (and whole when it must be). */
export function clampWeight(key: NumericWeightKey, v: number): number {
  const s = WEIGHT_SPECS[key];
  const c = Math.min(s.max, Math.max(s.min, Number.isFinite(v) ? v : s.min));
  // precision follows the range: bonuses in the thousands don't need decimals, multipliers get two
  return s.int || s.max - s.min >= 100 ? Math.round(c) : Math.round(c * 100) / 100;
}

/** Fills in any keys missing from an older or hand-written weight file, and clamps every value. */
export function withDefaults(w: Partial<Weights>): Weights {
  const out: Weights = { ...DEFAULT_WEIGHTS, ...w, id: w.id ?? 'custom' };
  if (!w.source) out.source = 'manual';
  for (const k of TUNABLE_KEYS) out[k] = clampWeight(k, out[k]);
  if (!BLUEPRINT_IDS.includes(out.blueprintId)) out.blueprintId = 'none';
  return out;
}

/** Identity of the numbers only, to skip candidates that were already tried. */
export function weightsKey(w: Weights): string {
  return [...TUNABLE_KEYS.map((k) => w[k]), ...CHOICE_KEYS.map((k) => w[k])].join(',');
}

/** "mazeGain 0→0.5, qualityReserve 30→10" */
export function describeChanges(from: Weights, to: Weights): string {
  const parts = [...TUNABLE_KEYS, ...CHOICE_KEYS].filter((k) => from[k] !== to[k]).map((k) => `${k} ${from[k]}→${to[k]}`);
  return parts.join(', ') || '(ไม่เปลี่ยน)';
}
