/**
 * Headless checks for the AI tooling: recorder, analyzer and (later) tuner logic.
 * Run: npm run ai-test
 */
import { CHECKPOINTS, STEP, START_LIVES, toTiles } from '../src/game/config';
import { TOWERS } from '../src/data/gems';
import { AIR_PATH, cover, dpsMaps, exposureOf, hitsAir, hitsGround, towerDps } from '../src/ai/exposure';
import { Game } from '../src/game/game';
import { mulberry32 } from '../src/game/rng';
import { AutoPlay } from '../src/ai/autoplay';
import { playBotGame } from '../src/ai/runner';
import { recordBotGame, type GameRecord } from '../src/ai/recorder';
import { checkExpectation, metricOf, paired, summarize, waveKind } from '../src/ai/analyze';
import { DEFAULT_WEIGHTS, SMART_WEIGHTS, TUNABLE_KEYS, WEIGHT_SPECS, clampWeight, weightsKey, withDefaults } from '../src/ai/weights';
import { judge, learn, llmReason, newState, proposeHill } from '../src/ai/tuner';
import { parseAdvice } from '../src/ai/advisor';

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
{
  const made = (id: string) => base.filter((r) => r.picks.some((p) => p.endsWith(`:special:${id}`))).length / base.length;
  assert(Object.entries(s.specialsMade).every(([id, rate]) => Math.abs(rate - made(id)) < 0.01), 'summary: special rates match a direct count');
}
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

// ---------- tuner ----------
{
  const st = newState('test', 'normal', 6, DEFAULT_WEIGHTS);
  const props = proposeHill(DEFAULT_WEIGHTS, st, 8);
  assert(props.length === 8 && new Set(props.map(weightsKey)).size === 8, 'hill-climbing proposes distinct candidates');
  assert(props.every((p) => TUNABLE_KEYS.every((k) => p[k] >= WEIGHT_SPECS[k].min && p[k] <= WEIGHT_SPECS[k].max)), 'every candidate stays within bounds');
  assert(props.every((p) => p.source === 'hill' && p.parent === 'w0' && !st.tried.includes(weightsKey(p))), 'candidates are marked hill, parented, and untried');

  const strong = base.map((r) => ({ ...r, score: r.score + 1 + (r.seed % 3) * 0.1 }));
  const weak = base.map((r) => ({ ...r, score: r.score + (r.seed % 2 ? 0.01 : -0.01) }));
  const results = judge(base, [{ w: props[0], recs: weak }, { w: props[1], recs: strong }]);
  assert(results[1].accepted && !results[0].accepted, 'judge accepts only the significant winner');
  learn(st, DEFAULT_WEIGHTS, results);
  assert(st.stuck === 0 && st.stepScale > 1, 'a win resets stuck and grows the step');
  const none = judge(base, [{ w: props[2], recs: weak }]);
  learn(st, DEFAULT_WEIGHTS, none);
  assert(st.stuck === 1, 'a round without a win counts as stuck');
  assert(llmReason({ ...st, stuck: 12, round: 30, llm: { ...st.llm, lastRound: 0 } }, { stuckAfter: 12, every: 25, rulesChanged: false }) === 'stuck', 'asks the LLM when stuck');
  assert(llmReason({ ...st, round: 25 }, { stuckAfter: 12, every: 25, rulesChanged: false }) === 'periodic', 'asks the LLM every N rounds');
  assert(llmReason(st, { stuckAfter: 12, every: 25, rulesChanged: true }) === 'rules-changed', 'asks the LLM after the game changed');
}

// ---------- advisor answers ----------
{
  const st = newState('test', 'normal', 6, DEFAULT_WEIGHTS);
  const answer = {
    diagnosis: 'd',
    proposals: [
      { changes: { mazeGain: 1, airValue: '2' }, hypothesis: 'h1', expect: [{ metric: 'livesLost.air', levels: [16, 24], direction: 'down' }] },
      { changes: { nope: 1, qualityMaxLevel: -3 }, hypothesis: 'h2', expect: [{ metric: 'fun', direction: 'up' }] },
      { changes: { mazeBonus: 100 }, hypothesis: 'no change' },
      { changes: { combine2Bonus: 0 }, hypothesis: 'h4', expect: [{ metric: 'damageShare', direction: 'up' }, { metric: 'picked', tower: 'h02O', direction: 'up' }] },
      { changes: { mazeGain: 1, airValue: 2 }, hypothesis: 'duplicate of 1' },
      { changes: { tieNoise: 1 } },
    ],
    missingWeights: ['x'],
  };
  const a = parseAdvice(answer, DEFAULT_WEIGHTS, st, 'llm-t');
  const ids = a.proposals.map((p) => p.proposal!.hypothesis);
  assert(ids.join('|') === 'h1|h2|h4', `keeps valid proposals only, first ${5} considered (${ids.join(', ')})`);
  assert(a.proposals[0].airValue === 2 && a.proposals[0].source === 'llm' && a.proposals[0].proposal!.expect[0].levels![1] === 24, 'numbers parsed, source llm, expectations kept');
  assert(a.proposals[1].qualityMaxLevel === 0 && a.proposals[1].proposal!.expect.length === 0, 'out-of-range clamped, unknown metric dropped');
  assert(a.proposals[2].proposal!.expect.length === 1 && a.proposals[2].proposal!.expect[0].tower === 'h02O', 'tower metrics need a real tower id');
  assert(a.problems.length >= 5 && a.missingWeights[0] === 'x', `problems reported (${a.problems.length})`);
  assert(parseAdvice('garbage', DEFAULT_WEIGHTS, st, 'llm-x').proposals.length === 0, 'garbage answers give no proposals, no crash');
}

// ---------- exposure ----------
{
  const air = AIR_PATH;
  assert(air[0].x === CHECKPOINTS[0].x && air[0].y === CHECKPOINTS[0].y && air[air.length - 1].x === CHECKPOINTS[CHECKPOINTS.length - 1].x, 'flight path runs from spawn to mine');
  const g = new Game({ seed: 9 });
  for (let x = 10; x < 15; x++) g.placeGem(x, 17);
  const kept = g.freshTowers[0];
  g.keep(kept);
  const m = dpsMaps(g);
  const r = toTiles(TOWERS[kept.id].range);
  const hot = Array.from(m.ground).filter((v) => v > 0).length + Array.from(m.air).filter((v) => v > 0).length;
  const expect = (hitsGround(kept.id) ? 1 : 0) + (hitsAir(kept.id) ? 1 : 0);
  assert(Math.abs(hot / expect - Math.PI * r * r) < 4 * r + 4, `one tower lights about a disc of radius ${r.toFixed(1)} (${hot / expect} tiles)`);
  assert(m.ground[17 * 37 + 10] === (hitsGround(kept.id) ? towerDps(kept.id) : 0) || kept.x !== 10, 'its own tile gets its dps');
  const e = exposureOf(g.route, m.ground);
  assert(Math.abs(e - towerDps(kept.id) * cover(g.route, kept.x, kept.y, r)) < 1e-3 || !hitsGround(kept.id), 'ground exposure = dps × route tiles in range for a single tower');
  const rec = recordBotGame({ seed: 4, difficulty: 'normal', weights: { ...DEFAULT_WEIGHTS, groundExposure: 1, keepExposure: 1, id: 'exp' } });
  assert(rec.exposureGround.length === rec.level && rec.exposureAir.length === rec.level && rec.exposureGround.slice(1).every((v) => v > 0), 'records ground/air exposure for every wave');
}

// ---------- browser auto-play plays the same game as a headless run ----------
{
  const end = (g: Game) =>
    `${g.phase} L${g.level} lives=${g.lives} gold=${g.gold} kills=${g.stats.kills} t=${g.time.toFixed(4)} ` +
    g.towers.map((t) => `${t.id}@${t.x},${t.y}`).join(' ');
  for (const [w, seed] of [[DEFAULT_WEIGHTS, 1], [DEFAULT_WEIGHTS, 2], [SMART_WEIGHTS, 3]] as const) {
    const headless = playBotGame({ seed, difficulty: 'normal', weights: w }).game;
    // uneven frames and changing speed, like a real browser tab
    const g = new Game({ seed, difficulty: 'normal' });
    const ap = new AutoPlay(w, seed);
    const frameRng = mulberry32(seed * 31);
    let acc = 0;
    for (let f = 0; g.phase !== 'gameover' && g.phase !== 'victory'; f++) {
      if (f > 5_000_000) throw new Error('FAIL: auto-play never finished');
      const dt = 0.004 + frameRng() * 0.05;
      const speed = [1, 4, 16][Math.floor(frameRng() * 3)];
      ap.frame(g, dt, speed);
      acc += dt * speed;
      for (let steps = 0; acc >= STEP && steps < 240; steps++) {
        ap.beforeUpdate(g);
        g.update(STEP);
        g.events.length = 0;
        acc -= STEP;
      }
    }
    assert(end(g) === end(headless), `${w.id} seed ${seed}: browser-paced auto-play ends exactly like the headless game (level ${g.level})`);
  }
}

console.log('all ai checks passed');
