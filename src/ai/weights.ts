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
  /** from this level on, upgrade gem quality as soon as gold covers it (no reserve); 0 = never rush */
  qualityRushLevel: number;
  /** 1 = tower upgrades always leave the next gem quality upgrade's cost untouched */
  qualityFirst: number;
  /** levels per quality step: below quality floor(level / this), upgrade as soon as gold covers it; 0 = off */
  qualityPace: number;
  /** hold quality upgrades up to this many levels while a recipe in progress misses a Chipped gem */
  chippedHold: number;
  /** stop upgrading gem quality at this level */
  qualityMaxLevel: number;
  /** upgrade a tower when gold >= its cost + this */
  upgradeReserve: number;
  /** buy lives (10 gold each) while lives are below this; 0 = never */
  buyLifeBelow: number;
  /** before a boss wave (build phase), buy lives up to this many; 0 = never */
  bossLifeTarget: number;
  /** 0 = upgrade the first affordable tower; > 0 = the upgrade with the most dps gain per gold, × (1 + this × path tiles reached / 10) */
  upgradeFocus: number;

  // ---- keep / combine choice: score = power(result) × (1 + keepExposure × coverage / 10) + bonus ----
  /** how much a gem's position matters when choosing which to keep */
  keepExposure: number;
  /** with a plan: path reached is judged as (1 - this) × the route now + this × the route once the plan is built */
  keepFuture: number;
  /** keep/combine/special: power × (1 + this) for a gem standing on a blueprint slot */
  slotKeepBonus: number;
  /** penalty (10 × this) for building on a blueprint hub cell, or a reserve cell before it unlocks */
  reserveRespect: number;
  specialBonus: number;
  combine4Bonus: number;
  combine2Bonus: number;
  /** keep/combine: + this × (ingredients of an unmade recipe owned after this pick / its size) × power of that special */
  recipeProgress: number;
  /** 1 = also consider keeping a gem one quality lower when that advances a recipe more (scored the same way) */
  downgradeForRecipe: number;
  /** choose and recipe planning: a special is worth power + this × (power two upgrades on, capped at 5000) / 10 */
  tierValue: number;
  /** choose: a slate that is half of a special slate gets this (half when the other half is not standing yet) */
  slatePairBonus: number;
  /** choose and planning: a special is worth × (1 - this × towers of its line already standing) */
  specialDiversity: number;
  /** choose: power × (1 - this × kept towers of the same gem type / 10) */
  typeDiversity: number;
  /** choose: an attack speed aura (Opal) adds this × aura % × power of the kept towers in its range */
  auraValue: number;
  /** choose and planning: an armor aura (Red Crystal on air) adds this × armor × 5% of the power of the towers it helps */
  armorAuraValue: number;
  /** 1 = a special may form on any of its ingredients (kept ones too): the spot reaching the most path, by aura range if it has one */
  specialSpot: number;
  /** at the start of each level, take up to this many rocks off blueprint slots and put the first gems back there */
  rockClear: number;
  /** rockClear starts at this level (0 = from the first) */
  rockClearFromLevel: number;
  /** 1 = place on the next plan cell in build order, ignoring tile scores, until no plan cell can be built */
  planFirst: number;
  /** once the plan is built: each level, up to this many rocks in the plan's core rectangle are swapped for new gems */
  coreRefill: number;
  /** 1 = towers with the Swap ability move into the plan's core box (200 gold), onto a rock or a plain gem */
  swapToCore: number;
  /** from this level on plainOutside and lateRecipeBoost apply; 0 = never */
  lateLevel: number;
  /** late: keeping a plain gem no planned recipe wants inside the core box is worth × (1 - this) */
  plainOutside: number;
  /** late: recipe planning bonus × (1 + this) */
  lateRecipeBoost: number;
  /** 1 = each level, gems go on the plan's slots (the centre) until one is good, then the rest build the plan */
  centreFirst: number;
  /** centreFirst: a gem is good with at least this power, or when it completes a special with the board */
  centreGoodPower: number;
  /** centreFirst: with no free slot left, swap a rock for a gem only when at least this share of the slots are rocks */
  centreRockShare: number;

  // ---- slates ----
  /** choose: create a slate when the round offers one, scored power + this; 0 = never */
  slateBonus: number;
  /** extra for an Air Slate when an air wave comes within the next 4 levels */
  airSlateBonus: number;
  /** 1 = teleport each new slate to the spot within range that covers the most path */
  slateTeleport: number;
  /** 1 = combine two owned slates into a special slate (Ancient, Wraith, Elder, Viper) as soon as possible */
  slateCombine: number;

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
  keepFuture: {
    min: 0, max: 1,
    desc: 'ใช้กับแปลนและ keepExposure: ตอนเลือก keep/combine/special นับจำนวนช่องทางที่ตำแหน่งนั้นยิงถึงเป็น (1 − ค่านี้) × ทางตอนนี้ + ค่านี้ × ทางตอนแปลนสร้างครบ; tower อยู่ทั้งเกม จุดที่ทางจะวนผ่านแน่นภายหลัง (ป้อมกลาง) จึงชนะจุดที่ทางผ่านแค่ตอนนี้ (เช่น Silver ด่าน 6 ที่ทแยงยิงทางตอนนี้ 18 ช่องแต่ตอนแปลนเสร็จแค่ 48 ช่อง ส่วนป้อมกลาง 14 → 210); 0 = ดูแค่ตอนนี้',
  },
  qualityReserve: { min: 0, max: 300, int: true, desc: 'อัป gem quality เมื่อทอง ≥ ค่าอัป (20 + 30 × level) + ค่านี้; ต่ำ = อัปเร็ว ได้เจมดีเร็วแต่ทองเหลือน้อย' },
  qualityMaxLevel: { min: 0, max: 8, int: true, desc: 'gem quality สูงสุดที่จะอัป (0–8)' },
  qualityPace: {
    min: 0, max: 10,
    desc: 'เป้า gem quality ตามด่าน: เป้า = floor(ด่าน / ค่านี้) เช่น 3 → quality 1 ที่ด่าน 3, 2 ที่ด่าน 6, 4 ที่ด่าน 12, 8 ที่ด่าน 24; ถ้า quality ต่ำกว่าเป้า อัปทันทีที่ทองพอ (ไม่กัน qualityReserve และไม่รอ chippedHold) ช่วงต้นที่ค่าอัปถูก (20, 50, 80) จึงได้ rush; ถึงเป้าแล้วใช้ qualityReserve / chippedHold ตามเดิม; ค่าน้อย = เร่งเร็ว; 0 = ไม่ใช้เป้า',
  },
  chippedHold: {
    min: 0, max: 20, int: true,
    desc: 'ยังไม่รีบอัป gem quality ถ้ามีสูตร special ที่กำลังทำ (มีวัตถุดิบบนกระดานแล้ว) แต่ยังขาดเจม Chipped (quality สูงขึ้นจะสุ่มได้ Chipped น้อยลง) รอได้สูงสุดเท่านี้ด่านติดกัน ถ้ายังสุ่มไม่เจอก็ยอมอัปแล้วไปต่อ; 0 = ไม่รอ',
  },
  qualityFirst: {
    min: 0, max: 1, int: true,
    desc: '1 = เงินไปอัป gem quality ก่อน: การอัป tower (ช่วงเวฟ) ต้องเหลือทองพอค่าอัป quality ขั้นถัดไป (20 + 30 × level) เสมอ จนกว่าจะถึง qualityMaxLevel; ใช้คู่กับ qualityReserve ต่ำเพื่อให้อัป quality ทันทีที่ทองพอตอนวางเจม; 0 = อัป tower ได้ทุกเมื่อที่ทองพอ (upgradeReserve)',
  },
  qualityRushLevel: {
    min: 0, max: 50, int: true,
    desc: 'ตั้งแต่ด่านนี้ไป อัป gem quality ทันทีที่ทองพอ (ไม่กันทอง qualityReserve) เพื่อเร่งให้ได้ Flawless/Perfect ไปทำสูตร special ระดับสูง; ก่อนด่านนี้ใช้ qualityReserve ตามปกติ (เก็บทองไว้อัป tower); 0 = ไม่เร่ง',
  },
  upgradeReserve: { min: 0, max: 300, int: true, desc: 'อัป tower (ช่วงเวฟ) เมื่อทอง ≥ ค่าอัป + ค่านี้; แย่งทองกับการอัป quality' },
  buyLifeBelow: { min: 0, max: 50, int: true, desc: 'ซื้อ life (10 ทอง) เมื่อ lives ต่ำกว่าค่านี้; 0 = ไม่ซื้อ' },
  bossLifeTarget: { min: 0, max: 50, int: true, desc: 'ก่อนเวฟบอส (Summon / Summon Air ด่าน 7, 14, 21, 28, ...) ตอนวางเจม ซื้อ life (10 ทอง) จนมี lives เท่าค่านี้ ก่อนอัป quality; 0 = ไม่ซื้อเพิ่มก่อนบอส' },
  upgradeFocus: {
    min: 0, max: 3,
    desc: 'การเลือก tower ที่จะอัป: 0 = อัปตัวแรกที่ทองพอ (ตามลำดับบนกระดาน); > 0 = เลือกการอัปที่ได้ dps เพิ่มต่อทองมากสุด คูณ (1 + ค่านี้ × จำนวนช่องทางที่ tower นั้นยิงถึง / 10) ป้อมกลางที่ทางวนผ่านจึงได้ก่อน',
  },
  specialBonus: { min: 0, max: 5000, desc: 'โบนัสตอนเลือกทำ special tower (คะแนนตัวเลือก = power ของผลลัพธ์ + โบนัส); power ของเจมทั่วไปหลักสิบถึงหลักร้อย' },
  combine4Bonus: { min: 0, max: 5000, desc: 'โบนัสตอนเลือก combine 4 เม็ด (ได้เจมสูงขึ้น 2 ขั้น)' },
  combine2Bonus: { min: 0, max: 5000, desc: 'โบนัสตอนเลือก combine 2 เม็ด (ได้เจมสูงขึ้น 1 ขั้น); โบนัส 0 = เลือกตาม power อย่างเดียว' },
  recipeProgress: {
    min: 0, max: 5,
    desc: 'วางแผนสูตร special: ตอน keep/combine บวก ค่านี้ × (จำนวนวัตถุดิบของสูตรที่ยังไม่ได้ทำ ที่จะมีบนกระดานหลังเลือก / จำนวนวัตถุดิบทั้งหมด) × power ของ special นั้น (เอาสูตรที่ดีสุด) เฉพาะเมื่อเจมนี้เป็นวัตถุดิบที่ยังไม่มี; สูตรระดับสูงได้มากกว่าเพราะ power สูงกว่า; 0 = ไม่วางแผน (ทำ special ได้แค่ตอนวัตถุดิบครบพอดี)',
  },
  downgradeForRecipe: {
    min: 0, max: 1, int: true,
    desc: '1 = ตอนเลือกพิจารณา keep แบบ downgrade (เจม Flawed–Perfect ลดลง 1 ขั้น) ด้วย คิดคะแนนแบบเดียวกับ keep จึงจะชนะก็ต่อเมื่อเจมที่ต่ำลงช่วยให้สูตร special ใกล้ครบมากกว่า (ใช้คู่กับ recipeProgress); 0 = ไม่ downgrade',
  },
  tierValue: {
    min: 0, max: 5,
    desc: 'มองเผื่อ special ขั้นสูง: ตอนเลือกและตอนวางแผนสูตร (recipeProgress) ค่าของ special = power ตอนนี้ + ค่านี้ × (power ของตัวที่อัปต่ออีก 2 ขั้น สูงสุด 5000) / 10; สูตรที่โตไปเป็นของแรงช่วงท้าย (Black Opal → BIG Opal ~3100, Uranium 238 → Atomic ~2850, Paraiba → Dimas Barbosa ~3000, Blood Stone / Yellow Sapphire / Gold / Dark Emerald ชนเพดาน 5000) จึงมีค่ากว่าสายเริ่มต้น (Silver → Silver Knight ~1200, Jade → Lucky China Jade ~940); สูตรขั้นสูงต้องใช้เจม Perfect (quality 8 หรือ combine) ใช้คู่กับ recipeProgress; 0 = ดูแค่ power ตอนนี้',
  },
  slatePairBonus: {
    min: 0, max: 5000,
    desc: 'ตอนเลือก: slate ที่เป็นครึ่งหนึ่งของ slate พิเศษ (Elder = Spell + Poison, Viper = Range + Damage, Wraith = Slow + Opal Vein, Ancient = Air + Hold) ได้โบนัสเท่านี้เมื่ออีกครึ่งมีบนกระดานแล้ว และครึ่งหนึ่งเมื่อยังไม่มี (เริ่มคู่) ใช้คู่กับ slateCombine = 1 เพื่อรวมทันที; ทำงานได้แม้ slateBonus = 0 (สร้างเฉพาะ slate ที่เข้าคู่); 0 = ไม่สนคู่',
  },
  specialDiversity: {
    min: 0, max: 1,
    desc: 'special หลากหลาย: ค่าของการทำ special (รวมโบนัส specialBonus) และโบนัสวางแผนสูตร × (1 − ค่านี้ × จำนวน tower สายเดียวกันที่มีแล้ว) ต่ำสุด 0.1; สายนับรวมตัวที่อัปแล้ว (Jade / China Jade / Lucky China Jade / Helltaker เป็นสายเดียว) เช่น 0.5: Jade ตัวที่ 2 ได้ครึ่งเดียว ตัวที่ 3 ได้ 10% บอทจึงไปเก็บวัตถุดิบสูตรอื่นแทน; 0 = ทำสายเดิมซ้ำได้เต็มที่',
  },
  typeDiversity: {
    min: 0, max: 3,
    desc: 'ตอนเลือก keep/combine/special: power × (1 − ค่านี้ × จำนวน tower ชนิดเดียวกัน (Ruby, Topaz, ... หรือ special ตัวเดียวกัน) ที่มีบนกระดานแล้ว / 10) (ต่ำสุด 0.1) ให้ได้ tower หลากหลาย (slow, poison, splash, ยิงอากาศ) แทนชนิดเดิมซ้ำ; 0 = ไม่สนความหลากหลาย',
  },
  auraValue: {
    min: 0, max: 5,
    desc: 'ตอนเลือก: tower ที่มีออร่าเร่งความเร็วยิง (Opal) ได้ power เพิ่ม ค่านี้ × % ออร่า × power รวมของ tower ที่ keep ไว้ในรัศมีออร่า (ปกติ Opal ถูกคิด power แค่ดาเมจตัวเองจึงไม่เคยถูกเลือก); 0 = ไม่นับออร่า',
  },
  armorAuraValue: {
    min: 0, max: 5,
    desc: 'ค่าของออร่าลดเกราะ (Red Crystal = Flawless Emerald + Ruby + Flawed Amethyst: −4 เกราะศัตรูบินรัศมี 1300 ≈ 10 ช่อง, อัปเป็น Red Facet / Rose Quartz ได้ออร่าเผาด้วย; Paraiba ลดเกราะพื้น): ตอนเลือก power เพิ่ม ค่านี้ × เกราะที่ลด × 5% × power รวมของ tower ที่ยิงเป้านั้นได้ในรัศมี; ตอนวางแผนสูตร (recipeProgress) นับ tower ที่ยิงได้ทั้งหมด; กับ specialSpot = 1 เลือกตำแหน่งที่รัศมีออร่าครอบเส้นทางบินมากสุด (เส้นทางบินผ่านกลางแผนที่ 2 ครั้ง: ช่วง 1→2 ที่ y=18 และ 4→5 ที่ x=18); 0 = ไม่นับออร่าเกราะ',
  },
  specialSpot: {
    min: 0, max: 1, int: true,
    desc: '1 = ทำ special ได้ที่ตำแหน่งของวัตถุดิบตัวไหนก็ได้ (รวมเจมที่ keep ไว้จากด่านก่อน) และเลือกตำแหน่งที่ยิงถึงทางเดินมากสุด นับตามระยะ aura ถ้ามี (Star Ruby เผารอบตัว ~2 ช่อง จึงไปอยู่จุดที่ทางวนผ่านแน่นสุด) ใช้ค่าตำแหน่งอย่างน้อยเท่า keepExposure 1; 0 = ทำ special ที่เจมรอบนี้เท่านั้น',
  },
  rockClear: {
    min: 0, max: 3, int: true,
    desc: 'ใช้กับแปลน: ต้นด่าน (ก่อนวางเจมเม็ดแรก) เอาหินบนช่อง slot ของแปลน (ป้อมกลาง) ออกได้สูงสุดเท่านี้ (ฟรี) แล้ววางเจมเม็ดแรก ๆ ของด่านกลับลงช่องนั้นก่อน เจมที่เหลือสร้างกำแพงตามแปลนต่อ จึงได้สุ่มเจมดีที่ป้อมกลางบ่อยขึ้นแต่กำแพงรอบนอกเสร็จช้าลง; 0 = ไม่เอาหินออก',
  },
  rockClearFromLevel: {
    min: 0, max: 50, int: true,
    desc: 'rockClear เริ่มทำตั้งแต่ด่านนี้ (ก่อนหน้านั้นเจมทุกเม็ดไปสร้างแปลนตามปกติ) เช่นตั้งให้เริ่มหลังกำแพงรอบนอกเสร็จ เพื่อไม่ให้การเติมป้อมกลางทำให้ทางยาวช้าลงช่วงต้น; 0 = เริ่มตั้งแต่ด่านแรก; ไม่มีผลถ้า rockClear = 0',
  },
  planFirst: {
    min: 0, max: 1, int: true,
    desc: 'ใช้กับแปลน: 1 = วางเจมลงช่องแปลนถัดไปตามลำดับสร้างเสมอ ไม่ใช้คะแนนช่อง (routeAdjacency / groundExposure / mazeGain) และไม่ใช้โบนัสแปลน จนกว่าแปลนจะสร้างครบ (หรือช่องที่เหลือวางแล้วปิดทาง) หลังจากนั้นวางตามคะแนนช่องปกติ; 0 = ช่องแปลนแข่งคะแนนกับช่องอื่น (blueprintWeight)',
  },
  coreRefill: {
    min: 0, max: 5, int: true,
    desc: 'ใช้กับแปลนที่มี core (เช่น orbit-s-v4-c10-core: สี่เหลี่ยม 14,16–22,20): เมื่อสร้างแปลนเสร็จแล้ว ทุกด่านถอนหินในสี่เหลี่ยม core ได้สูงสุดเท่านี้ (ก้อนที่ยิงทางได้มากสุดก่อน) แล้ววางเจมใหม่ทับทันที ทางจึงไม่เปลี่ยน ได้สุ่มเจม/ทำ special ที่ป้อมกลางมากขึ้นแทนการไปสร้างรอบนอก; 0 = ไม่ทำ',
  },
  swapToCore: {
    min: 0, max: 1, int: true,
    desc: 'ใช้กับแปลนที่มี core: 1 = tower ที่มีความสามารถ Swap (Black Opal, Gold, Rose Quartz, Enchanted Emerald, Fire Star, Lucky China Jade, Helltaker, Atomic, ... ใช้ได้ 1 ครั้งต่อการอัป ราคา 200 ทอง) ที่อยู่นอกสี่เหลี่ยม core สลับที่กับหินหรือเจมธรรมดาในสี่เหลี่ยม core เมื่อยิงทางได้มากขึ้นอย่างน้อย 3 ช่อง (special ไปอยู่กลาง เจมธรรมดาออกไปข้างนอก); 0 = ไม่ swap',
  },
  lateLevel: {
    min: 0, max: 50, int: true,
    desc: 'ช่วงท้ายเกม: ตั้งแต่ด่านนี้ plainOutside และ lateRecipeBoost ทำงาน; 0 = ไม่ใช้ทั้งสองตัว',
  },
  plainOutside: {
    min: 0, max: 1,
    desc: 'ช่วงท้ายเกม (lateLevel) กับแปลนที่มี core: การ keep / combine เจมธรรมดาที่ไม่มีสูตรไหนต้องการ (โบนัสวางแผนสูตร = 0) ในสี่เหลี่ยม core มีค่า × (1 − ค่านี้) บอทจึงเก็บเม็ดที่อยู่นอกกลางแทน เหลือช่องกลางเป็นหินไว้ให้ coreRefill สุ่มหา special; 0 = ไม่สน',
  },
  lateRecipeBoost: {
    min: 0, max: 5,
    desc: 'ช่วงท้ายเกม (lateLevel): โบนัสวางแผนสูตร (recipeProgress) × (1 + ค่านี้) ให้ keep เจมที่เป็นวัตถุดิบสูตรที่ยังไม่ได้ทำ แทนเจมธรรมดาที่ power สูงแต่ไม่ได้ไปไหนต่อ; 0 = เท่าช่วงต้น',
  },
  centreFirst: {
    min: 0, max: 1, int: true,
    desc: 'ใช้กับแปลน: 1 = ทุกด่านวางเจมลงช่อง slot ของแปลน (ป้อมกลาง) ก่อนทีละเม็ด ถ้าได้เจมดี (ดู centreGoodPower) เจมที่เหลือของด่านไปสร้างกำแพงตามแปลน ถ้ายังไม่ดีวางกลางต่อ ช่องกลางเต็มแล้วถอนหินได้ (ดู centreRockShare); 0 = ไม่ทำ',
  },
  centreGoodPower: {
    min: 0, max: 1000,
    desc: 'centreFirst: เจมกลางนับว่าดีเมื่อ power ≥ ค่านี้ (power เจมทั่วไป 20–565, Chipped ~20–60, Flawless/Perfect หลักร้อย) หรือเมื่อเป็นวัตถุดิบที่ทำ special ได้ครบกับของบนกระดาน; 0 = เจมไหนก็ดี (วางกลางด่านละ 1 เม็ด)',
  },
  centreRockShare: {
    min: 0, max: 1,
    desc: 'centreFirst: เมื่อช่องกลางไม่มีที่ว่าง ถอนหินในช่องกลางทีละก้อนแล้ววางเจมทับทันที (ฟรี ทางไม่เปิดระหว่างเวฟ) เฉพาะเมื่อสัดส่วนหินในช่องกลาง ≥ ค่านี้; 0 = ถอนเสมอเมื่อต้องการ, 1 = ถอนเฉพาะเมื่อช่องกลางเป็นหินทั้งหมด',
  },
  slateBonus: {
    min: 0, max: 5000,
    desc: 'ตอนเลือก: ถ้ารอบนี้สร้าง slate ได้ (เจม Normal + Flawed ที่เป็นคู่ในรอบเดียวกัน) ให้คะแนนตัวเลือก slate = power + ค่านี้ เทียบกับ keep/combine/special; slate วางบนทางเดินได้ ครีปเดินทับได้ ไม่บังทาง และเจมวางทับได้; 0 = ไม่สร้าง slate เลย',
  },
  airSlateBonus: { min: 0, max: 5000, desc: 'โบนัสเพิ่มให้ Air Slate (ยิงอากาศระยะ 850) เมื่อมีเวฟอากาศภายใน 4 ด่านข้างหน้า; ใช้ร่วมกับ slateBonus' },
  slateTeleport: {
    min: 0, max: 1, int: true,
    desc: '1 = teleport slate ใหม่ทันที (ครั้งเดียว ระยะ 2000 ทีละครึ่งช่อง) ไปจุดที่ยิงถึงทางเดินมากสุด (นับทางที่วนผ่านซ้ำ) บวกเส้นทางบินถ้า slate ยิงอากาศได้; 0 = ไม่ย้าย',
  },
  slateCombine: { min: 0, max: 1, int: true, desc: '1 = รวม slate สองตัวที่มีเป็น slate พิเศษ (Ancient = Air+Hold, Wraith = Slow+Opal Vein, Elder = Spell+Poison, Viper = Range+Damage) ทันทีที่ทำได้ (ได้ teleport ใหม่ด้วย); 0 = ไม่รวม' },
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
  qualityRushLevel: 0,
  qualityFirst: 0,
  qualityPace: 0,
  chippedHold: 0,
  qualityMaxLevel: 8,
  upgradeReserve: 20,
  buyLifeBelow: 0,
  bossLifeTarget: 0,
  upgradeFocus: 0,
  keepExposure: 0,
  keepFuture: 0,
  slotKeepBonus: 0,
  reserveRespect: 0,
  specialBonus: 3000,
  combine4Bonus: 2000,
  combine2Bonus: 1000,
  recipeProgress: 0,
  downgradeForRecipe: 0,
  tierValue: 0,
  slatePairBonus: 0,
  specialDiversity: 0,
  typeDiversity: 0,
  auraValue: 0,
  armorAuraValue: 0,
  specialSpot: 0,
  rockClear: 0,
  rockClearFromLevel: 0,
  planFirst: 0,
  coreRefill: 0,
  swapToCore: 0,
  lateLevel: 0,
  plainOutside: 0,
  lateRecipeBoost: 0,
  centreFirst: 0,
  centreGoodPower: 0,
  centreRockShare: 0,
  slateBonus: 0,
  airSlateBonus: 0,
  slateTeleport: 0,
  slateCombine: 0,
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
