/**
 * Headless checks for the AI tooling: recorder, analyzer and (later) tuner logic.
 * Run: npm run ai-test
 */
import { CHECKPOINTS, STEP, START_LIVES, toTiles } from '../src/game/config';
import { GEM_INFO, TOWERS, qualityUpgradeCost } from '../src/data/gems';
import { SLATE_SPECIALS } from '../src/data/slates';
import { AIR_PATH, cover, dpsMaps, exposureOf, hitsAir, hitsGround, towerDps } from '../src/ai/exposure';
import { BLUEPRINTS, BLUEPRINT_IDS } from '../src/ai/blueprint';
import { Game } from '../src/game/game';
import { mulberry32 } from '../src/game/rng';
import { AutoPlay } from '../src/ai/autoplay';
import { Bot, applyAction, towerPower } from '../src/ai/bot';
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

// ---------- blueprints ----------
{
  assert(!!BLUEPRINTS.spiral && BLUEPRINT_IDS.includes('spiral') && BLUEPRINT_IDS[0] === 'none', 'spiral is registered next to none');
  const base = { ...DEFAULT_WEIGHTS, groundExposure: 2, keepExposure: 1, tieNoise: 0, id: 'bp-base' };
  const same = (a: GameRecord, b: GameRecord) => JSON.stringify({ ...a, weightsId: '' }) === JSON.stringify({ ...b, weightsId: '' });
  const ref = recordBotGame({ seed: 6, difficulty: 'normal', weights: base });
  assert(same(ref, recordBotGame({ seed: 6, difficulty: 'normal', weights: { ...base, blueprintId: 'spiral', blueprintWeight: 0, slotKeepBonus: 2 } })), 'a blueprint with weight 0 changes nothing');
  assert(same(ref, recordBotGame({ seed: 6, difficulty: 'normal', weights: { ...base, blueprintId: 'none', blueprintWeight: 5 } })), 'blueprintId none changes nothing');
  const planned = recordBotGame({ seed: 6, difficulty: 'normal', weights: { ...base, blueprintId: 'spiral', blueprintWeight: 5 } });
  const early = planned.blueprintAdherence!.slice(0, 5);
  assert(early.reduce((a, b) => a + b, 0) / early.length >= 0.8, `with weight 5 the first levels follow the plan (${early.join(', ')})`);
  assert(planned.blueprintBuilt!.every((b, i, xs) => i === 0 || b >= xs[i - 1]), `plan cells only accumulate (${planned.blueprintBuilt!.slice(-1)[0]} built by level ${planned.level})`);
  const w = withDefaults({ ...base, blueprintId: 'nope' } as never);
  assert(w.blueprintId === 'none', 'an unknown blueprint id falls back to none');
  const st = newState('test', 'normal', 6, { ...base, blueprintId: 'none' });
  st.blueprints = ['spiral', 'none'];
  const props = proposeHill({ ...base, blueprintId: 'none' }, st, 40);
  assert(props.some((p) => p.blueprintId === 'spiral' && p.blueprintWeight > 0), 'hill-climbing sometimes switches to another blueprint (with some pull)');
  // spiral2: hub cells stay free when asked, reserve cells wait for their level
  const s2 = BLUEPRINTS.spiral2;
  const hubCells = [...s2.at.values()].filter((c) => c.role === 'hub');
  const reserve = s2.sorted.filter((c) => c.role === 'reserve');
  assert(!!s2.hub && hubCells.length > 0 && reserve.every((c) => c.unlockLevel === 25), 'spiral2 has a hub and reserve cells unlocking at level 25');
  const g2 = new Game({ seed: 8 });
  const bot2 = new Bot({ ...base, id: 'h', blueprintId: 'spiral2', blueprintWeight: 5, reserveRespect: 5 }, 8);
  let hubBuilt = 0, reserveEarly = 0;
  while (g2.phase !== 'gameover' && g2.phase !== 'victory') {
    for (let a; (a = bot2.nextAction(g2)); ) {
      if (a.type === 'place') {
        const c = s2.at.get(a.y * 37 + a.x);
        if (c?.role === 'hub') hubBuilt++;
        if (c?.role === 'reserve' && g2.level < 25) reserveEarly++;
      }
      applyAction(g2, a);
    }
    g2.update(STEP);
    g2.events.length = 0;
  }
  assert(hubBuilt === 0 && reserveEarly === 0, `with reserveRespect 5 the bot never builds on the hub or on reserve before level 25 (game reached level ${g2.level})`);
  const passes = recordBotGame({ seed: 8, difficulty: 'normal', weights: { ...base, id: 'h', blueprintId: 'spiral2', blueprintWeight: 5, reserveRespect: 5 } }).hubPasses ?? [];
  assert(passes.length > 0 && Math.min(...passes) >= 2, `records hub passes per wave (${passes.join(",")})`);

  const fromLlm = { ...base, id: 'x', source: 'llm' as const, proposal: { id: 'p', hypothesis: 'h', expect: [] } };
  const pre = newState('t', 'normal', 6, fromLlm);
  pre.idPrefix = 'spiral-';
  const kids = proposeHill(fromLlm, pre, 3);
  assert(kids.every((k) => k.id.startsWith('spiral-w') && !k.proposal), 'run-prefixed ids, and hill candidates do not inherit the parent\'s LLM proposal');
  const adv = parseAdvice({ proposals: [{ changes: { blueprintId: 'spiral', blueprintWeight: 4 }, hypothesis: 'h' }, { changes: { blueprintId: 'maze-x' }, hypothesis: 'bad' }] }, base, st, 'llm-bp');
  assert(adv.proposals.length === 1 && adv.proposals[0].blueprintId === 'spiral' && adv.problems.some((p) => p.includes('maze-x')), 'the advisor may pick a registered blueprint, not an unknown one');

  // rockClear: rocks come off plan slots only before the first gem of a level, and those tiles get this level's first gems
  const v3 = BLUEPRINTS['orbit-s-v3'];
  const g3 = new Game({ seed: 5 });
  const bot3 = new Bot({ ...base, id: 'rc', blueprintId: 'orbit-s-v3', blueprintWeight: 10, rockClear: 2, specialSpot: 1 }, 5);
  let removed = 0, badRemove = 0, badRefill = 0, keptSpecials = 0;
  let pending: string[] = [];
  while (g3.phase !== 'gameover' && g3.phase !== 'victory') {
    for (let a; (a = bot3.nextAction(g3)); ) {
      if (a.type === 'removeRock') {
        removed++;
        const c = v3.at.get(a.y * 37 + a.x);
        if (c?.role !== 'slot' || g3.gemsLeft !== 5 || pending.length >= 2) badRemove++;
        pending.push(`${a.x},${a.y}`);
      } else if (a.type === 'place' && pending.length) {
        if (pending.shift() !== `${a.x},${a.y}`) badRefill++;
      } else if (a.type === 'special' && !g3.towerAt(a.x, a.y)!.fresh) {
        keptSpecials++;
      }
      applyAction(g3, a);
    }
    if (g3.phase === 'wave') pending = [];
    g3.update(STEP);
    g3.events.length = 0;
  }
  assert(removed > 0 && badRemove === 0, `rockClear takes rocks off plan slots only, at most 2 per level, before the first gem (${removed} removed by level ${g3.level})`);
  assert(badRefill === 0, 'the first gems of the level go back on the cleared tiles, in order');
  console.log(`  (specialSpot: ${keptSpecials} specials formed on a kept ingredient)`);
  const late = recordBotGame({ seed: 5, difficulty: 'normal', weights: { ...base, id: 'rc12', blueprintId: 'orbit-s-v3', blueprintWeight: 10, rockClear: 2, rockClearFromLevel: 12 } });
  const lateRef = recordBotGame({ seed: 5, difficulty: 'normal', weights: { ...base, id: 'rc0', blueprintId: 'orbit-s-v3', blueprintWeight: 10 } });
  assert(JSON.stringify(late.picks.filter((p) => +p.split(':')[0] < 12)) === JSON.stringify(lateRef.picks.filter((p) => +p.split(':')[0] < 12)), 'rockClearFromLevel 12: levels before 12 play exactly as without rockClear');

  // planFirst: while a plan cell can be built, every gem goes on the earliest one
  const gp = new Game({ seed: 3 });
  const botP = new Bot({ ...base, id: 'pf', blueprintId: 'orbit-s-v3', blueprintWeight: 10, groundExposure: 5, planFirst: 1 }, 3);
  let offPlan = 0, placed = 0;
  while (gp.phase !== 'gameover' && gp.phase !== 'victory') {
    for (let a; (a = botP.nextAction(gp)); ) {
      if (a.type === 'place') {
        const next = v3.sorted.find((c) => !gp.towerAt(c.x, c.y) && !gp.isRock(c.x, c.y) && gp.canPlace(c.x, c.y));
        if (next) {
          placed++;
          if (next.x !== a.x || next.y !== a.y) offPlan++;
        }
      }
      applyAction(gp, a);
    }
    gp.update(STEP);
    gp.events.length = 0;
  }
  assert(placed > 0 && offPlan === 0, `planFirst follows the plan order even with groundExposure 5 (${placed} gems on plan, level ${gp.level})`);

  // centreFirst: a level's gems go on the slots until one there is good; a removed rock gets a gem on the very next move
  const gc = new Game({ seed: 4 });
  const botC = new Bot({ ...base, id: 'cf', blueprintId: 'orbit-s-v3', blueprintWeight: 10, centreFirst: 1, centreGoodPower: 150, centreRockShare: 0.5 }, 4);
  const isSlot = (x: number, y: number) => v3.at.get(y * 37 + x)?.role === 'slot';
  let removedAt: string | null = null, badSwap = 0, swaps = 0, earlyWall = 0, centreGems = 0;
  while (gc.phase !== 'gameover' && gc.phase !== 'victory') {
    for (let a; (a = botC.nextAction(gc)); ) {
      if (removedAt && !(a.type === 'place' && `${a.x},${a.y}` === removedAt)) badSwap++;
      removedAt = null;
      if (a.type === 'removeRock') {
        swaps++;
        removedAt = `${a.x},${a.y}`;
        if (!isSlot(a.x, a.y)) badSwap++;
      } else if (a.type === 'place') {
        if (isSlot(a.x, a.y)) centreGems++;
        // a gem off the slots while a free slot is left and no good gem stands there yet
        const goodYet = gc.freshTowers.some((t) => isSlot(t.x, t.y) && towerPower(t.id, botC.weights) >= 150);
        const freeSlot = v3.sorted.some((c) => c.role === 'slot' && !gc.towerAt(c.x, c.y) && !gc.isRock(c.x, c.y) && gc.canPlace(c.x, c.y));
        if (!isSlot(a.x, a.y) && !goodYet && freeSlot) earlyWall++;
      }
      applyAction(gc, a);
    }
    gc.update(STEP);
    gc.events.length = 0;
  }
  // keepFuture: orbit-v3-a seed 8 makes Silver at level 6 on the diagonal (busy now); judged by the finished maze it goes to the core
  const silverAt = (keepFuture: number) => {
    // orbit-v3-a's values (sim-runs is not in git)
    const w8 = {
      ...DEFAULT_WEIGHTS, id: 'kf', mazeGain: 0, mazeBonus: 87, routeAdjacency: 2.23, tieNoise: 0, groundExposure: 2,
      blueprintId: 'orbit-s-v3', blueprintWeight: 10, blueprintWindow: 10, keepExposure: 0.86, qualityReserve: 250, upgradeReserve: 0,
      buyLifeBelow: 15, specialBonus: 1727, combine4Bonus: 2000, combine2Bonus: 0, recipeProgress: 0.2, slowValue: 0.54, splashValue: 0.34,
      airValue: 2.14, keepFuture,
    };
    const g8 = new Game({ seed: 8 });
    const b8 = new Bot(w8, 8);
    while (g8.phase !== 'gameover' && g8.phase !== 'victory' && g8.level < 12) {
      for (let a; (a = b8.nextAction(g8)); ) {
        if (a.type === 'special' && a.result === 'h01A') return `${a.x},${a.y}`;
        applyAction(g8, a);
      }
      g8.update(STEP);
      g8.events.length = 0;
    }
    return 'none';
  };
  const nowSpot = silverAt(0), futureSpot = silverAt(0.5);
  const core = (s: string) => v3.at.get(+s.split(',')[1] * 37 + +s.split(',')[0])?.role === 'slot';
  assert(!core(nowSpot) && core(futureSpot), `keepFuture 0.5 moves the first Silver into the core (${nowSpot} → ${futureSpot})`);

  // qualityFirst: a tower upgrade never leaves less gold than the next gem quality upgrade costs
  {
    // capped at quality 4, so tower upgrades do happen once that is reached
    const wq = { ...base, id: 'qf', qualityFirst: 1, qualityReserve: 0, upgradeReserve: 0, qualityMaxLevel: 4 };
    const gq = new Game({ seed: 2 });
    const bq = new Bot(wq, 2);
    let ups = 0, broke = 0;
    while (gq.phase !== 'gameover' && gq.phase !== 'victory') {
      for (let a; (a = bq.nextAction(gq)); ) {
        if (a.type === 'upgrade') {
          const q = gq.qualityLevel;
          applyAction(gq, a);
          ups++;
          if (q < 4 && gq.gold < qualityUpgradeCost(q)) broke++;
          continue;
        }
        applyAction(gq, a);
      }
      gq.update(STEP);
      gq.events.length = 0;
    }
    assert(ups > 0 && broke === 0, `qualityFirst: ${ups} tower upgrades, each left the next quality upgrade affordable (quality ${gq.qualityLevel} by level ${gq.level})`);
  }

  // typeDiversity / auraValue / chippedHold, on orbit-v4c10-a's values
  {
    const v4w = {
      ...DEFAULT_WEIGHTS, id: 'v4', mazeGain: 0, mazeBonus: 87, routeAdjacency: 2.23, tieNoise: 0, groundExposure: 2,
      blueprintId: 'orbit-s-v4-c10', blueprintWeight: 10, blueprintWindow: 10, keepExposure: 0.86, qualityReserve: 250, upgradeReserve: 0,
      buyLifeBelow: 15, specialBonus: 1727, combine4Bonus: 2000, combine2Bonus: 0, recipeProgress: 0.2, slowValue: 0.54, splashValue: 0.34,
      airValue: 2.14, keepFuture: 0.75, specialSpot: 1,
    };
    const seeds = [1, 2, 3, 4];
    const games = (extra: object) => seeds.map((seed) => recordBotGame({ seed, difficulty: 'normal', weights: { ...v4w, ...extra } }));
    const types = (recs: GameRecord[]) => recs.reduce((s, r) => s + new Set(r.final.map((id) => GEM_INFO[id]?.type ?? id)).size, 0) / recs.length;
    const kept = (recs: GameRecord[], name: string) => recs.reduce((s, r) => s + r.picks.filter((p) => (TOWERS[p.split(':')[2]]?.name ?? '').includes(name)).length, 0);
    const plain = games({});
    const diverse = games({ typeDiversity: 3 });
    assert(types(diverse) > types(plain), `typeDiversity 3 keeps more kinds of tower (${types(plain).toFixed(1)} → ${types(diverse).toFixed(1)} per board)`);
    const aura = games({ auraValue: 5 });
    assert(kept(aura, 'Opal') > kept(plain, 'Opal'), `auraValue 5 picks Opal more often (${kept(plain, 'Opal')} → ${kept(aura, 'Opal')} in ${seeds.length} games)`);
    const qAt = (recs: GameRecord[]) => recs.reduce((s, r) => s + r.qualityLevel, 0) / recs.length;
    const held = games({ chippedHold: 20, qualityReserve: 0 });
    const rushed = games({ qualityReserve: 0 });
    // tierValue: a special that grows into a strong late tower outranks an early one; 0 leaves values alone
    const tv = new Bot({ ...v4w, tierValue: 1 }, 1) as unknown as { specialValue(id: string): number };
    const tv0 = new Bot(v4w, 1) as unknown as { specialValue(id: string): number };
    assert(tv0.specialValue('h015') === towerPower('h015', v4w) && tv.specialValue('h015') > tv.specialValue('h01A') && towerPower('h015', v4w) < towerPower('h01A', v4w) * 2,
      `tierValue 1 ranks Black Opal (${tv.specialValue('h015').toFixed(0)}) above Silver (${tv.specialValue('h01A').toFixed(0)}); without it ${towerPower('h015', v4w).toFixed(0)} vs ${towerPower('h01A', v4w).toFixed(0)}`);
    // armorAuraValue: Red Crystal's air armor aura is worth something once towers that hit air stand in its range
    {
      const mk = (id: string, x: number, y: number) => ({ uid: 9000 + x * 37 + y, id, x, y, cooldown: 0, kills: 0, damage: 0, fresh: false, firedAt: -1, swapUsed: false, teleportUsed: false });
      const keptAir = [mk('h01A', 17, 18), mk('h01A', 19, 18), mk('h03X', 18, 17)]; // Silver ×2, Malachite: hit air
      const ba = new Bot({ ...v4w, armorAuraValue: 1 }, 1) as unknown as { armorAuraPower(id: string, kept: unknown[], at?: { x: number; y: number }): number };
      const near = ba.armorAuraPower('h029', keptAir, { x: 18, y: 18 }), far = ba.armorAuraPower('h029', keptAir, { x: 2, y: 34 });
      assert(near > 0 && far === 0 && ba.armorAuraPower('h01A', keptAir, { x: 18, y: 18 }) === 0, `armorAuraValue: Red Crystal next to air towers adds ${near.toFixed(1)} power, far away 0, a tower without the aura 0`);
    }
    // slatePairBonus: only slates that belong to a special slate get made, and pairs get combined
    const pairs = games({ slatePairBonus: 3000, slateCombine: 1 });
    const halves = new Set(SLATE_SPECIALS.flatMap((s) => s.ingredients));
    const made = pairs.flatMap((r) => r.picks.filter((p) => p.split(':')[1] === 'slate').map((p) => p.split(':')[2]));
    const combined = pairs.flatMap((r) => r.picks.filter((p) => p.split(':')[1] === 'slateSpecial'));
    assert(made.length > 0 && made.every((id) => halves.has(id)), `slatePairBonus builds only halves of special slates (${made.length} slates, ${combined.length} special slates in ${seeds.length} games)`);
    // coreRefill: after the plan is built, rocks in the core box are swapped for gems, at most N per level
    {
      const core = BLUEPRINTS['orbit-s-v4-c10-core'];
      const box = core.core!;
      const gr = new Game({ seed: 3 });
      const br = new Bot({ ...v4w, id: 'cr', blueprintId: 'orbit-s-v4-c10-core', planFirst: 1, coreRefill: 3 }, 3);
      let swaps = 0, bad = 0, waiting: string | null = null;
      const perLevel = new Map<number, number>();
      while (gr.phase !== 'gameover' && gr.phase !== 'victory') {
        for (let a; (a = br.nextAction(gr)); ) {
          if (waiting && !(a.type === 'place' && `${a.x},${a.y}` === waiting)) bad++;
          waiting = null;
          if (a.type === 'removeRock') {
            const planLeft = core.sorted.some((c) => !gr.towerAt(c.x, c.y) && !gr.isRock(c.x, c.y) && gr.canPlace(c.x, c.y));
            if (planLeft || a.x < box.x0 || a.x > box.x1 || a.y < box.y0 || a.y > box.y1) bad++;
            perLevel.set(gr.level, (perLevel.get(gr.level) ?? 0) + 1);
            swaps++;
            waiting = `${a.x},${a.y}`;
          }
          applyAction(gr, a);
        }
        gr.update(STEP);
        gr.events.length = 0;
      }
      assert(swaps > 0 && bad === 0 && [...perLevel.values()].every((n) => n <= 3),
        `coreRefill 3: ${swaps} core rocks swapped for gems after the plan was built, each refilled at once, ≤3 per level (level ${gr.level})`);
    }
    // qualityPace: quality keeps up with floor(level / pace) whenever gold allows, despite a big reserve
    {
      const gp2 = new Game({ seed: 8 });
      const bp2 = new Bot({ ...v4w, qualityReserve: 300, chippedHold: 20, qualityPace: 3 }, 8);
      let behindWithGold = 0;
      while (gp2.phase !== 'gameover' && gp2.phase !== 'victory' && gp2.level <= 15) {
        for (let a; (a = bp2.nextAction(gp2)); ) {
          // the bot passed on gold that covered an upgrade it was behind on
          if (gp2.phase === 'build' && a.type === 'place' && gp2.qualityLevel < Math.floor(gp2.level / 3) && gp2.gold >= qualityUpgradeCost(gp2.qualityLevel)) behindWithGold++;
          applyAction(gp2, a);
        }
        gp2.update(STEP);
        gp2.events.length = 0;
      }
      assert(behindWithGold === 0 && gp2.qualityLevel >= 3, `qualityPace 3 keeps quality on pace (quality ${gp2.qualityLevel} at level ${gp2.level}) despite qualityReserve 300 and chippedHold 20`);
    }
    assert(qAt(held) < qAt(rushed), `chippedHold 20 holds gem quality back while Chipped gems are missing (quality at the end ${qAt(rushed).toFixed(1)} → ${qAt(held).toFixed(1)})`);
  }

  assert(badSwap === 0, `centreFirst: every rock it removes (${swaps}) is on a slot and gets a gem on the next move`);
  assert(earlyWall === 0, `centreFirst: no wall while a slot is free and the centre has no good gem yet (${centreGems} centre gems by level ${gc.level})`);
}

// ---------- browser auto-play plays the same game as a headless run ----------
{
  const end = (g: Game) =>
    `${g.phase} L${g.level} lives=${g.lives} gold=${g.gold} kills=${g.stats.kills} t=${g.time.toFixed(4)} ` +
    g.towers.map((t) => `${t.id}@${t.x},${t.y}`).join(' ');
  const spiralW = { ...DEFAULT_WEIGHTS, id: 'spiral5', groundExposure: 2, keepExposure: 1, blueprintId: 'spiral', blueprintWeight: 5, slotKeepBonus: 1 };
  const orbitW = { ...spiralW, id: 'orbit-v3', blueprintId: 'orbit-s-v3', blueprintWeight: 10, rockClear: 2, specialSpot: 1 };
  for (const [w, seed] of [[DEFAULT_WEIGHTS, 1], [DEFAULT_WEIGHTS, 2], [SMART_WEIGHTS, 3], [spiralW, 4], [orbitW, 5]] as const) {
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
