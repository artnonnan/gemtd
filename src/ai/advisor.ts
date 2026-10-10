/**
 * The LLM advisor's side of tuning. It only ever *proposes* weight sets: every proposal is validated,
 * clamped and then played on the same seeds as any hill-climbing candidate before it can win.
 *
 * Today the request is a file you paste into a chat and the answer is a file you import
 * (`npm run tune -- --import=answer.json`). An automatic API call later can reuse both formats as they are.
 */
import { TOWERS, WAVES, displayName } from '../data/gems';
import { isMetric, waveKind, type EvalSummary } from './analyze';
import { blueprintOf } from './blueprint';
import { SCORE_FORMULA } from './recorder';
import type { LlmReason, TuneState } from './tuner';
import {
  CHOICE_DESCS, CHOICE_KEYS, METRICS, TUNABLE_KEYS, WEIGHT_SPECS, choicesOf, clampWeight, weightsKey,
  type ChoiceKey, type Expectation, type NumericWeightKey, type Weights,
} from './weights';

/** One line of tuning history, as the advisor sees it. */
export interface HistoryEntry {
  round: number;
  id: string;
  source: string;
  change: string;
  /** paired score difference vs the best at the time, ± standard error */
  delta: number;
  se: number;
  z: number;
  accepted: boolean;
  /** LLM proposals: was each prediction right? */
  verdicts?: string[];
  hypothesis?: string;
}

export const MAX_PROPOSALS = 5;

export function buildRequest(o: {
  reason: LlmReason;
  state: TuneState;
  best: Weights;
  summary: EvalSummary;
  history: HistoryEntry[];
  missingWeightsSoFar: string[];
}) {
  const { summary: s } = o;
  return {
    reason: o.reason,
    round: o.state.round,
    roundsWithoutImprovement: o.state.stuck,
    scoreFormula: SCORE_FORMULA,
    acceptRule: 'ชุดใหม่ชนะเมื่อคะแนนเฉลี่ยรายคู่ (seed เดียวกัน) สูงกว่า best เกิน 2 เท่าของ standard error',
    seeds: o.state.seeds,
    best: { id: o.best.id, score: s.score, avgLevel: s.avgLevel, winRate: s.winRate, weights: pickNumbers(o.best) },
    bounds: Object.fromEntries(TUNABLE_KEYS.map((k) => [k, [WEIGHT_SPECS[k].min, WEIGHT_SPECS[k].max, WEIGHT_SPECS[k].int ? 'int' : 'float']])),
    choices: Object.fromEntries(CHOICE_KEYS.map((k) => [k, choicesOf(k)])),
    weightDescriptions: { ...Object.fromEntries(TUNABLE_KEYS.map((k) => [k, WEIGHT_SPECS[k].desc])), ...CHOICE_DESCS },
    botBehaviour: [
      'build: อัป gem quality ถ้าทองพอ (qualityReserve) แล้ววางเจมทีละเม็ดในช่องที่คะแนนสูงสุด (mazeGain/mazeBonus/routeAdjacency)',
      'choose: เลือก special / combine 4 / combine 2 / keep ตามคะแนน = power(ผลลัพธ์) + โบนัส; power = dps ประมาณ ปรับด้วย slowValue/splashValue/airValue',
      'wave: ซื้อ life ถ้า lives < buyLifeBelow, อัป tower ตัวที่ถูกสุดเมื่อทองพอ (upgradeReserve)',
      'ยังไม่ใช้: swap, slate, teleport, remove rock, downgrade',
    ],
    history: o.history.slice(-40),
    llmRecord: o.state.llm,
    deaths: {
      byLevel: Object.fromEntries(Object.entries(s.deathsByLevel).map(([l, c]) => [`${l} ${WAVES[+l - 1].name} (${waveKind(+l)})`, c])),
      byKind: s.deathsByKind,
      livesLostPerGameByKind: s.livesLostByKind,
    },
    livesLostByLevel: Object.fromEntries(s.livesLostByLevel.map((l, i) => [i + 1, l]).filter(([, l]) => l >= 0.3)),
    goldAtWaveStart: Object.fromEntries(s.goldAtWave.map((g, i) => [i + 1, g]).filter(([, g]) => g > 0)),
    exposureNote: 'exposure = ผลรวม dps ของ tower ที่ยิงถึงแต่ละช่องบนทางเดิน (พื้น) หรือเส้นทางบิน (อากาศ) ตอนเริ่มเวฟ ≈ damage ที่ครีปหนึ่งตัวจะโดนตลอดทาง',
    exposureAtWaveStart: Object.fromEntries(s.exposureGround.map((g, i) => [i + 1, { ground: g, air: s.exposureAir[i] }]).filter(([, e]) => (e as { ground: number }).ground > 0)),
    exposureDiedVsPassed: s.exposureDiedVsPassed,
    blueprint: s.blueprint
      ? { id: o.best.blueprintId, cells: blueprintOf(o.best.blueprintId)?.sorted.length, ...s.blueprint }
      : 'ไม่ได้ใช้แปลน (blueprintId none หรือ blueprintWeight 0)',
    avgUpgradesPerGame: s.avgUpgrades,
    avgQualityLevel: s.avgQuality,
    towers: s.towers.slice(0, 15).map((t) => ({ id: t.id, name: t.name, pickRate: t.pickRate, damageShare: t.damageShare, dmgPerWave: t.dmgPerWave, levelWith: t.levelWith, levelWithout: t.levelWithout })),
    specialsMade: Object.fromEntries(Object.entries(s.specialsMade).map(([id, r]) => [displayName(id), r])),
    unusedRecipes: s.unusedRecipes.map(displayName),
    metrics: METRICS,
    missingWeightsSoFar: o.missingWeightsSoFar,
    answerFormat: ANSWER_FORMAT,
  };
}

const pickNumbers = (w: Weights) => ({ ...Object.fromEntries(TUNABLE_KEYS.map((k) => [k, w[k]])), ...Object.fromEntries(CHOICE_KEYS.map((k) => [k, w[k]])) });

export const ANSWER_FORMAT = {
  diagnosis: 'string: สาเหตุหลักที่บอทไปไม่ไกลกว่านี้ อิงตัวเลขที่ให้',
  proposals: [
    {
      changes: { '<weightName>': '<number ภายใน bounds>' },
      hypothesis: 'string: ทำไมการเปลี่ยนนี้น่าจะช่วย',
      expect: [{ metric: '<ชื่อจาก metrics>', levels: '[from, to] (ไม่ใส่ก็ได้)', tower: '<tower id> (เฉพาะ damageShare/picked)', direction: 'up | down' }],
      expectText: 'string: ผลที่คาดไว้แบบอ่านง่าย',
    },
  ],
  missingWeights: ['string: ค่าน้ำหนักที่ยังไม่มีแต่ควรมี (คนจะตัดสินใจเพิ่มในโค้ดเอง)'],
};

/** The text to paste into a chat, request JSON included. */
export function requestPrompt(request: ReturnType<typeof buildRequest>): string {
  return [
    'คุณเป็นที่ปรึกษาจูนค่าน้ำหนักของบอทเล่นเกม Gem Tower Defense (tower defense 50 ด่าน)',
    'บอทใช้ค่าน้ำหนักชุดหนึ่งตัดสินใจ ระบบ hill-climbing ปรับค่าทีละนิดอยู่แล้ว สิ่งที่ต้องการจากคุณคือ "ทิศทางใหม่" ที่ hill-climbing หาเองได้ยาก',
    `ข้อมูลด้านล่างคำนวณจาก ${request.seeds} เกม (seed เดียวกันทุกชุด) ของค่าน้ำหนักที่ดีที่สุดตอนนี้`,
    '',
    'กติกา:',
    `- เสนอ 3–${MAX_PROPOSALS} ชุด แต่ละชุดเปลี่ยนเฉพาะค่าที่อยู่ใน bounds (ค่าที่ไม่ระบุจะใช้ของ best)`,
    '- ทุกชุดจะถูกเล่นจริงบน seed เดิมก่อนตัดสิน ไม่ต้องมั่นใจเกินจริง',
    '- ดู history ก่อน อย่าเสนอสิ่งที่ลองแล้วไม่ได้ผล เว้นแต่มีเหตุผลใหม่',
    '- expect ต้องใช้ชื่อ metric จาก "metrics" เท่านั้น ระบบจะตรวจหลังรันว่าทายถูกไหม',
    '- missingWeights: ถ้ามีพฤติกรรมที่ควรปรับได้แต่ยังไม่มีค่าน้ำหนักคุม ให้บอก',
    '- ตอบเป็น JSON ตาม answerFormat เท่านั้น ไม่ต้องมีข้อความอื่น',
    '',
    '```json',
    JSON.stringify(request, null, 1),
    '```',
  ].join('\n');
}

export interface ParsedAdvice {
  diagnosis: string;
  proposals: Weights[];
  missingWeights: string[];
  /** what was fixed or dropped while validating */
  problems: string[];
}

/**
 * Validates an advisor answer: unknown weights and malformed expectations are dropped, numbers are clamped,
 * duplicates of anything already tried are skipped. Never throws on bad content; reports it instead.
 */
export function parseAdvice(raw: unknown, best: Weights, s: TuneState, callId: string): ParsedAdvice {
  const problems: string[] = [];
  const o = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(o.proposals) ? o.proposals : [];
  if (!Array.isArray(o.proposals)) problems.push('ไม่มี proposals (array)');
  if (list.length > MAX_PROPOSALS) problems.push(`เสนอมา ${list.length} ชุด ใช้แค่ ${MAX_PROPOSALS} ชุดแรก`);
  const seen = new Set(s.tried);
  const proposals: Weights[] = [];
  list.slice(0, MAX_PROPOSALS).forEach((p: unknown, i: number) => {
    const tag = `ข้อเสนอ ${i + 1}`;
    const q = (typeof p === 'object' && p ? p : {}) as Record<string, unknown>;
    const changes = (typeof q.changes === 'object' && q.changes ? q.changes : {}) as Record<string, unknown>;
    const cand: Weights = { ...best };
    let changed = 0;
    for (const [k, v] of Object.entries(changes)) {
      if ((CHOICE_KEYS as readonly string[]).includes(k)) {
        const opts = choicesOf(k as ChoiceKey);
        if (!opts.includes(String(v))) problems.push(`${tag}: ${k} = ${String(v)} ไม่มีในตัวเลือก ${opts.join(', ')} (ข้าม)`);
        else if (String(v) !== best[k as ChoiceKey]) {
          cand[k as ChoiceKey] = String(v);
          changed++;
        }
        continue;
      }
      if (!(TUNABLE_KEYS as string[]).includes(k)) {
        problems.push(`${tag}: ไม่มีค่าน้ำหนักชื่อ ${k} (ข้าม)`);
        continue;
      }
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) {
        problems.push(`${tag}: ${k} = ${String(v)} ไม่ใช่ตัวเลข (ข้าม)`);
        continue;
      }
      const c = clampWeight(k as NumericWeightKey, n);
      if (c !== n) problems.push(`${tag}: ${k} ${n} ถูกปรับเป็น ${c} ให้อยู่ในขอบเขต`);
      cand[k as NumericWeightKey] = c;
      if (c !== best[k as NumericWeightKey]) changed++;
    }
    if (!changed) return problems.push(`${tag}: ไม่ได้เปลี่ยนอะไรจาก best (ข้าม)`);
    const key = weightsKey(cand);
    if (seen.has(key)) return problems.push(`${tag}: เคยลองชุดนี้แล้ว (ข้าม)`);
    seen.add(key);
    const expect = (Array.isArray(q.expect) ? q.expect : []).flatMap((e: unknown) => {
      const x = parseExpectation(e);
      if (typeof x === 'string') {
        problems.push(`${tag}: expect ${x} (ข้าม)`);
        return [];
      }
      return [x];
    });
    const id = `w${s.nextId++}`;
    proposals.push({
      ...cand,
      id,
      parent: best.id,
      source: 'llm',
      note: `llm ${callId}: ${String(q.hypothesis ?? '').slice(0, 200)}`,
      proposal: { id: `${callId}-${i + 1}`, hypothesis: String(q.hypothesis ?? ''), expect, expectText: q.expectText ? String(q.expectText) : undefined },
    });
  });
  return {
    diagnosis: String(o.diagnosis ?? ''),
    proposals,
    missingWeights: Array.isArray(o.missingWeights) ? o.missingWeights.map(String) : [],
    problems,
  };
}

function parseExpectation(e: unknown): Expectation | string {
  const o = (typeof e === 'object' && e ? e : {}) as Record<string, unknown>;
  const metric = String(o.metric ?? '');
  if (!isMetric(metric)) return `metric "${metric}" ไม่มีในรายการ`;
  if (o.direction !== 'up' && o.direction !== 'down') return `direction ต้องเป็น up หรือ down`;
  const out: Expectation = { metric, direction: o.direction };
  if (o.levels !== undefined) {
    const l = o.levels;
    if (!Array.isArray(l) || l.length !== 2 || !l.every((x) => Number.isInteger(x) && x >= 1 && x <= WAVES.length) || l[0] > l[1]) {
      return `levels ต้องเป็น [from, to] ภายใน 1–${WAVES.length}`;
    }
    out.levels = [l[0], l[1]];
  }
  if (metric === 'damageShare' || metric === 'picked') {
    if (typeof o.tower !== 'string' || !TOWERS[o.tower]) return `${metric} ต้องระบุ tower id ที่มีอยู่จริง`;
    out.tower = o.tower;
  }
  return out;
}
