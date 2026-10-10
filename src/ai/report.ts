/**
 * Thai markdown reports: a balance report for one batch of games, and (tuner) one report per tuning round.
 * Every sentence is computed from the numbers, so reports stay honest when the data changes.
 */
import { WAVES, displayName } from '../data/gems';
import { waveKind, type EvalSummary, type Paired, type WaveKind } from './analyze';
import { SCORE_FORMULA } from './recorder';
import { deadEnds, promising, type CandidateResult, type LlmReason, type TuneState } from './tuner';
import { describeChanges, type Weights } from './weights';

const KIND_TH: Record<WaveKind, string> = { air: 'อากาศ', ground: 'พื้น', boss: 'บอส' };
const pct = (x: number) => `${Math.round(x * 100)}%`;
export const waveLabel = (level: number) => `ด่าน ${level} ${WAVES[level - 1].name} (${KIND_TH[waveKind(level)]})`;

/** Levels where many games end: the walls the bot cannot get past. */
export function walls(s: EvalSummary, minShare = 0.1): { level: number; share: number }[] {
  return Object.entries(s.deathsByLevel)
    .map(([l, c]) => ({ level: +l, share: c / s.games }))
    .filter((w) => w.share >= minShare)
    .sort((a, b) => b.share - a.share);
}

/** Balance observations, strongest first. */
export function balanceNotes(s: EvalSummary): string[] {
  const notes: string[] = [];
  for (const w of walls(s, 0.15)) notes.push(`**กำแพง:** ${pct(w.share)} ของเกมจบที่${waveLabel(w.level)}`);
  const top = Object.entries(s.deathsByKind).sort((a, b) => b[1] - a[1])[0] as [WaveKind, number];
  if (top && top[1] >= 0.5) notes.push(`**สาเหตุหลักที่แพ้:** ${pct(top[1])} ของเกมที่แพ้จบในเวฟ${KIND_TH[top[0]]}`);
  for (const t of s.towers) {
    if (t.damageShare >= 0.25) notes.push(`**อาจแรงเกิน:** ${t.name} ทำ damage ${pct(t.damageShare)} ของทั้งหมด`);
  }
  const lifted = s.towers
    .map((t) => ({ t, lift: t.levelWith - t.levelWithout }))
    .filter(({ t, lift }) => t.pickRate >= 0.1 && t.pickRate <= 0.9 && lift >= 1.5)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 3);
  if (lifted.length) {
    notes.push(`**สัมพันธ์กับการไปได้ไกล** (ความสัมพันธ์ ไม่ใช่เหตุและผล): ` +
      lifted.map(({ t, lift }) => `${t.name} ${t.levelWith} เทียบ ${t.levelWithout} (+${lift.toFixed(1)})`).join(' · '));
  }
  if (s.unusedRecipes.length) {
    notes.push(`**สูตร special ที่ไม่เคยถูกทำ (${s.unusedRecipes.length}):** ${s.unusedRecipes.map(displayName).join(', ')} (อาจยากเกินไป หรือบอทยังไม่พยายามทำ)`);
  }
  if (s.avgUpgrades < 1) notes.push(`**แทบไม่ได้อัป tower:** เฉลี่ย ${s.avgUpgrades} ครั้งต่อเกม`);
  return notes;
}

export function batchReport(s: EvalSummary, w: Weights, meta: { seeds: string; rulesHash: string; date: string; seconds: number }): string {
  const lines: string[] = [];
  lines.push(`# รายงาน balance: ${w.id}`, '');
  lines.push(`- ${meta.date} · ${s.games} เกม · seed ${meta.seeds} · rules \`${meta.rulesHash}\` · ใช้เวลา ${meta.seconds.toFixed(0)} วินาที`);
  lines.push(`- คะแนน (${SCORE_FORMULA}): **${s.score}** (SD ${s.scoreSd}) · ด่านเฉลี่ย **${s.avgLevel}** · ชนะ ${pct(s.winRate)} · lives เหลือเฉลี่ย ${s.avgLives}`);
  lines.push(`- gem quality เฉลี่ยตอนจบ ${s.avgQuality} · อัป tower เฉลี่ย ${s.avgUpgrades} ครั้งต่อเกม`, '');

  lines.push('## ข้อสังเกต', '');
  const notes = balanceNotes(s);
  lines.push(...(notes.length ? notes.map((n) => `- ${n}`) : ['- ไม่มีอะไรผิดปกติเด่นชัด']), '');

  lines.push('## ตายที่ด่านไหน', '');
  lines.push('| ด่าน | เวฟ | ชนิด | จำนวนเกม | |', '|---|---|---|---|---|');
  const maxD = Math.max(1, ...Object.values(s.deathsByLevel));
  for (const [l, c] of Object.entries(s.deathsByLevel).sort((a, b) => +a[0] - +b[0])) {
    lines.push(`| ${l} | ${WAVES[+l - 1].name} | ${KIND_TH[waveKind(+l)]} | ${c} | ${'█'.repeat(Math.ceil((c / maxD) * 20))} |`);
  }
  lines.push('', `แพ้ในเวฟ: อากาศ ${pct(s.deathsByKind.air)} · พื้น ${pct(s.deathsByKind.ground)} · บอส ${pct(s.deathsByKind.boss)}`);
  lines.push(`lives ที่เสียเฉลี่ยต่อเกม: อากาศ ${s.livesLostByKind.air} · พื้น ${s.livesLostByKind.ground} · บอส ${s.livesLostByKind.boss}`, '');

  lines.push('## Lives ที่เสียรายด่าน (เฉลี่ยต่อเกม, เฉพาะด่านที่เสีย ≥ 0.5)', '');
  lines.push('| ด่าน | เวฟ | lives ที่เสีย | ทองตอนเริ่มเวฟ |', '|---|---|---|---|');
  s.livesLostByLevel.forEach((l, i) => {
    if (l >= 0.5) lines.push(`| ${i + 1} | ${WAVES[i].name} (${KIND_TH[waveKind(i + 1)]}) | ${l} | ${s.goldAtWave[i]} |`);
  });
  lines.push('');

  lines.push('## Tower (เรียงตามสัดส่วน damage, 20 อันดับแรก)', '');
  lines.push('| tower | damage share | มีตอนจบ | damage/เวฟ | ด่านเฉลี่ย มี / ไม่มี |', '|---|---|---|---|---|');
  for (const t of s.towers.slice(0, 20)) {
    lines.push(`| ${t.name} \`${t.id}\` | ${pct(t.damageShare)} | ${pct(t.pickRate)} | ${t.dmgPerWave} | ${t.levelWith} / ${t.levelWithout} |`);
  }
  lines.push('');

  lines.push('## Special ที่ทำได้', '');
  const sp = Object.entries(s.specialsMade).sort((a, b) => b[1] - a[1]);
  lines.push(...(sp.length ? sp.map(([id, r]) => `- ${displayName(id)}: ${pct(r)} ของเกม`) : ['- ไม่มี']), '');
  return lines.join('\n');
}

const SOURCE_TH: Record<string, string> = { baseline: 'baseline', hill: 'hill-climbing', llm: 'LLM', manual: 'คุณตั้งเอง' };
const fmt = (p: Paired) => `${p.diff >= 0 ? '+' : ''}${p.diff.toFixed(2)} ± ${p.se.toFixed(2)} (z ${p.z.toFixed(1)})`;
const VERDICT_TH = { correct: '✅ ทายถูก', wrong: '❌ ทายผิด', 'no-effect': '➖ ไม่มีผลชัดเจน' };
const REASON_TH: Record<LlmReason, string> = {
  stuck: 'ตัน: ไม่ดีขึ้นติดกันหลายรอบ',
  periodic: 'ตรวจทิศทางตามรอบ',
  'rules-changed': 'โค้ดเกมหรือบอทเปลี่ยน',
  manual: 'สั่งเอง',
};

export interface RoundReportInput {
  state: TuneState;
  prevBest: Weights;
  best: Weights;
  bestSummary: EvalSummary;
  results: CandidateResult[];
  /** set on rounds that also played the holdout seeds; vsPrev/trainVsPrev compare with the run's start */
  holdout?: { score: number; vsPrev?: Paired; prevId?: string; trainVsPrev?: Paired };
  rulesChanged?: { from: string; to: string };
  llm?: { reason: LlmReason; file: string };
  advice?: { diagnosis: string; missingWeights: string[]; problems: string[] };
  next: Weights[];
  seconds: number;
}

export function roundReport(o: RoundReportInput): string {
  const s = o.state;
  const L: string[] = [];
  const winner = o.results.find((r) => r.accepted);
  L.push(`# รอบการจูนที่ ${s.round}`, '');
  L.push(`- best ก่อนรอบ: \`${o.prevBest.id}\` → หลังรอบ: \`${o.best.id}\`${winner ? ' (เปลี่ยน)' : ' (เท่าเดิม)'}`);
  L.push(`- ${s.seeds} seed · ${o.results.length} ชุดที่ลอง · ใช้เวลา ${o.seconds.toFixed(0)} วินาที · ไม่ดีขึ้นติดกัน ${s.stuck} รอบ · step ×${s.stepScale.toFixed(2)}`);
  L.push(`- คะแนน best: **${o.bestSummary.score}** · ด่านเฉลี่ย ${o.bestSummary.avgLevel} · ชนะ ${pct(o.bestSummary.winRate)}`, '');

  if (o.rulesChanged) {
    L.push(`> **โค้ดเกมหรือบอทเปลี่ยน** (rules \`${o.rulesChanged.from}\` → \`${o.rulesChanged.to}\`): เล่น best ใหม่ทั้งหมดแล้ว ผลก่อนหน้านี้เทียบตรงๆ ไม่ได้`, '');
  }

  L.push('## จูนอะไรไปบ้าง', '');
  L.push('| ชุด | ที่มา | เปลี่ยน | คะแนนเทียบ best | ผล |', '|---|---|---|---|---|');
  for (const r of o.results) {
    L.push(`| \`${r.w.id}\` | ${SOURCE_TH[r.w.source ?? 'manual']} | ${describeChanges(o.prevBest, r.w)} | ${fmt(r.score)} | ${r.accepted ? '**รับ**' : 'ไม่รับ'} |`);
  }
  L.push('');

  L.push('## ได้เรียนรู้อะไร', '');
  const learned: string[] = [];
  for (const r of o.results) {
    const what = describeChanges(o.prevBest, r.w);
    if (Math.abs(r.score.z) >= 2) learned.push(`${what}: คะแนน${r.score.diff > 0 ? 'ดีขึ้น' : 'แย่ลง'}จริง ${fmt(r.score)}`);
    for (const m of r.moves) learned.push(`${what}: ${m.label} ${m.p.diff > 0 ? 'เพิ่ม' : 'ลด'} ${fmt(m.p)}`);
    if (r.w.source === 'llm' && r.w.proposal) {
      learned.push(`LLM \`${r.w.proposal.id}\` สมมติฐาน: "${r.w.proposal.hypothesis}"`);
      for (const v of r.verdicts) learned.push(`  - คาดว่า ${v.label} จะ${v.direction === 'up' ? 'เพิ่ม' : 'ลด'}: ${VERDICT_TH[v.verdict]} ${fmt(v.p)}`);
    }
  }
  if (!learned.length) learned.push('ไม่มีชุดไหนต่างจาก best เกินระดับโชค (|z| < 2) ทุกการเปลี่ยนในรอบนี้ถือว่าไม่มีผลชัดเจน');
  L.push(...learned.map((x) => (x.startsWith('  ') ? x : `- ${x}`)));
  const good = promising(s), bad = deadEnds(s);
  if (good.length) L.push(`- ทิศทางที่เคยได้ผล: ${good.join('; ')}`);
  if (bad.length) L.push(`- ทางตัน (จะลองน้อยลง): ${bad.join('; ')}`);
  if (o.holdout) {
    L.push(`- **holdout** (seed ชุดที่สอง ไม่ได้ใช้จูน): คะแนน ${o.holdout.score}` +
      (o.holdout.vsPrev && o.holdout.trainVsPrev
        ? ` · ดีขึ้นจากจุดเริ่ม \`${o.holdout.prevId}\`: บน seed หลัก ${fmt(o.holdout.trainVsPrev)} / บน holdout ${fmt(o.holdout.vsPrev)}`
        : ''));
    if (o.holdout.vsPrev && o.holdout.trainVsPrev && o.holdout.trainVsPrev.z >= 2 && o.holdout.vsPrev.z < 1) {
      L.push('  - ⚠️ ดีขึ้นบน seed หลัก แต่ไม่ดีขึ้นบน holdout: อาจ overfit กับ seed หลัก');
    }
  }
  L.push('');

  L.push('## สภาพของ best ตอนนี้', '');
  const notes = balanceNotes(o.bestSummary).slice(0, 5);
  L.push(...(notes.length ? notes.map((n) => `- ${n}`) : ['- ไม่มีอะไรผิดปกติเด่นชัด']), '');

  L.push('## รอบหน้าจะพยายามทำอะไร', '');
  for (const w of o.next) {
    const why = w.source === 'llm' ? `ข้อเสนอ LLM: ${w.proposal?.hypothesis ?? ''}`
      : w.source === 'manual' ? 'ชุดที่คุณใส่มา'
      : w.note?.startsWith('merge:') ? `รวมผู้ชนะ: ${w.note.slice(7)}`
      : explainHill(s, o.best, w);
    L.push(`- \`${w.id}\` ${describeChanges(o.best, w)} — ${why}`);
  }
  if (s.stuck >= 8) L.push(`- ไม่ดีขึ้นมา ${s.stuck} รอบ: hill-climbing ${s.stuck === 8 ? 'จะลองก้าวใหญ่ขึ้น (step ×2)' : 'น่าจะติด local optimum'}`);
  L.push('');

  if (o.llm || o.advice) {
    L.push('## LLM ที่ปรึกษา', '');
    if (o.advice) {
      if (o.advice.diagnosis) L.push(`- การวิเคราะห์ของ LLM: ${o.advice.diagnosis}`);
      if (o.advice.missingWeights.length) L.push(`- **ค่าน้ำหนักที่ LLM บอกว่ายังขาด** (ต้องให้คนตัดสินใจเพิ่มในโค้ด): ${o.advice.missingWeights.join('; ')}`);
      if (o.advice.problems.length) L.push(`- ปัญหาตอนตรวจคำตอบ: ${o.advice.problems.join('; ')}`);
    }
    if (o.llm) {
      L.push(`- **ควรขอคำแนะนำจาก LLM** (${REASON_TH[o.llm.reason]}): เปิด \`${o.llm.file}\` วางในแชทกับ Claude แล้วบันทึกคำตอบ JSON เป็นไฟล์ จากนั้นรัน \`npm run tune -- --import=<ไฟล์คำตอบ>\``);
    }
    const r = s.llm;
    if (r.proposals) L.push(`- สถิติ LLM: เรียก ${r.calls} ครั้ง · เสนอ ${r.proposals} ชุด · ชนะ ${r.accepted} · ทายถูก ${r.correct} / ผิด ${r.wrong} / ไม่มีผล ${r.noEffect}`);
    L.push('');
  }
  return L.join('\n');
}

function explainHill(s: TuneState, best: Weights, w: Weights): string {
  const parts: string[] = [];
  for (const [k, st] of Object.entries(s.keyStats)) {
    const v = (w as unknown as Record<string, number>)[k], b = (best as unknown as Record<string, number>)[k];
    if (v === b) continue;
    const d = st[v > b ? 'up' : 'down'];
    if (d.wins) parts.push(`ต่อยอดทิศทางที่เคยได้ผล (${v > b ? 'เพิ่ม' : 'ลด'} ${k})`);
  }
  return parts.length ? parts.join(', ') : 'สำรวจทิศทางที่ยังลองน้อย';
}
