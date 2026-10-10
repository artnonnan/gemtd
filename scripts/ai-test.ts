/**
 * Headless checks for the AI tooling: recorder, analyzer and (later) tuner logic.
 * Run: npm run ai-test
 */
import { START_LIVES } from '../src/game/config';
import { recordBotGame, type GameRecord } from '../src/ai/recorder';
import { checkExpectation, metricOf, paired, summarize, waveKind } from '../src/ai/analyze';
import { DEFAULT_WEIGHTS, SMART_WEIGHTS, clampWeight, withDefaults } from '../src/ai/weights';

const assert = (ok: boolean, msg: string) => {
  if (!ok) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

// ---------- wave kinds ----------
assert(waveKind(1) === 'ground' && waveKind(4) === 'air', 'level 1 is ground, level 4 (Bat) is air');
assert([7, 14, 21, 28, 35, 42, 49].every((l) => waveKind(l) === 'boss'), 'Summon / Summon Air waves are bosses');

// ---------- recorder ----------
const base: GameRecord[] = [1, 2, 3, 4, 5, 6].map((seed) => recordBotGame({ seed, difficulty: 'normal', weights: DEFAULT_WEIGHTS }));
for (const r of base) {
  const lost = r.livesLost.reduce((a, b) => a + b, 0);
  if (lost !== START_LIVES - r.lives) throw new Error(`FAIL: seed ${r.seed} lost ${lost} but ended with ${r.lives}`);
  if (r.livesLost.length !== r.level) throw new Error(`FAIL: seed ${r.seed} has ${r.livesLost.length} waves for level ${r.level}`);
}
assert(true, 'lives lost per wave add up to the lives gone, one entry per level played');
assert(base.every((r) => r.picks.length === r.level), 'one keep/combine/special pick per level');
assert(base.every((r) => Object.values(r.towers).some((s) => s.dmg > 0)), 'towers record damage');
const again = recordBotGame({ seed: 3, difficulty: 'normal', weights: DEFAULT_WEIGHTS });
assert(JSON.stringify(again) === JSON.stringify(base[2]), 'recording the same seed twice gives the same record');

// ---------- analyzer ----------
const s = summarize(base);
assert(s.games === 6 && Math.abs(s.livesLostByLevel.reduce((a, b) => a + b, 0) - 50) < 0.1, 'summary: avg lives lost adds up to 50 per lost game');
assert(Math.abs(s.towers.reduce((a, t) => a + t.damageShare, 0) - 1) < 0.05, 'summary: damage shares add up to ~1');
const self = paired(base, base);
assert(self.diff === 0 && self.z === 0 && self.n === 6, 'paired comparison of a run with itself is exactly 0');
const smart = [1, 2, 3, 4, 5, 6].map((seed) => recordBotGame({ seed, difficulty: 'normal', weights: SMART_WEIGHTS }));
const p = paired(base, smart);
assert(p.n === 6 && Number.isFinite(p.z), `paired smart vs w0: diff ${p.diff} ± ${p.se} (z ${p.z})`);
const lifeDiff = paired(base, smart, { metric: 'livesLost', levels: [1, 50] });
assert(Math.abs(lifeDiff.diff + (smart.reduce((a, r) => a + r.lives, 0) - base.reduce((a, r) => a + r.lives, 0)) / 6) < 1e-3, 'livesLost metric mirrors lives');
assert(metricOf(base[0], { metric: 'level' }) === base[0].level, 'metricOf level');

// synthetic: every game loses 2 fewer lives on level 10 → expectation "down" is correct
const fake = (r: GameRecord, delta: number): GameRecord => ({ ...r, livesLost: r.livesLost.map((l, i) => (i === 9 ? l + delta : l)) });
const a = base.map((r, i) => fake(r, 5 + (i % 2)));
const b = base.map((r, i) => fake(r, 3 + (i % 2) * 1.1));
assert(checkExpectation(a, b, { metric: 'livesLost', levels: [10, 10], direction: 'down' }).verdict === 'correct', 'expectation checker: predicted drop happened');
assert(checkExpectation(a, b, { metric: 'livesLost', levels: [10, 10], direction: 'up' }).verdict === 'wrong', 'expectation checker: predicted rise did not');
assert(checkExpectation(a, a, { metric: 'livesLost', direction: 'up' }).verdict === 'no-effect', 'expectation checker: no change is no-effect');

// ---------- weights ----------
assert(clampWeight('qualityMaxLevel', 9.7) === 8 && clampWeight('mazeGain', -1) === 0, 'clamp keeps values in bounds and whole where needed');
const w = withDefaults({ id: 'x', mazeGain: 99 } as never);
assert(w.mazeGain === 5 && w.source === 'manual' && w.qualityReserve === DEFAULT_WEIGHTS.qualityReserve, 'withDefaults fills, clamps and marks hand-made sets manual');

console.log('all ai checks passed');
