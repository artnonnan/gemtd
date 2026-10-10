/**
 * Guards speed-ups that must not change bot behaviour: records every move of a fixed set of bot games,
 * then checks a later build makes exactly the same moves.
 * Run: npm run bot-golden -- --write=path.json   (before the change)
 *      npm run bot-golden -- --check=path.json   (after)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { playBotGame } from '../src/ai/runner';
import { DEFAULT_WEIGHTS, SMART_WEIGHTS } from '../src/ai/weights';
import type { Game } from '../src/game/game';

declare const process: { argv: string[]; exitCode: number };

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const CASES = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({ seed, weights: DEFAULT_WEIGHTS })),
  ...[1, 2, 3].map((seed) => ({ seed, weights: SMART_WEIGHTS })),
];

const summary = (g: Game) =>
  `${g.phase} L${g.level} lives=${g.lives} gold=${g.gold} kills=${g.stats.kills} t=${g.time.toFixed(4)} route=${g.routeLen.toFixed(6)}`;

const t0 = performance.now();
const runs = CASES.map(({ seed, weights }) => {
  const s = performance.now();
  const { game, log } = playBotGame({ seed, difficulty: 'normal', weights });
  const ms = performance.now() - s;
  console.log(`${weights.id} seed ${seed}: ${summary(game)} moves=${log.length} ${(ms / 1000).toFixed(2)}s`);
  return { key: `${weights.id}/${seed}`, summary: summary(game), log: log.map((l) => `${l.step}:${JSON.stringify(l.a)}`) };
});
console.log(`total ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const write = arg('write');
const check = arg('check');
if (write) {
  writeFileSync(write, JSON.stringify(runs));
  console.log(`wrote ${runs.length} games to ${write}`);
} else if (check) {
  const golden: typeof runs = JSON.parse(readFileSync(check, 'utf8'));
  let bad = 0;
  for (const g of golden) {
    const r = runs.find((o) => o.key === g.key);
    if (!r) continue;
    const i = g.log.findIndex((m, k) => m !== r.log[k]);
    if (i >= 0 || g.log.length !== r.log.length || g.summary !== r.summary) {
      bad++;
      const at = i >= 0 ? i : Math.min(g.log.length, r.log.length);
      console.log(`DIFF ${g.key} at move ${at}: golden ${g.log[at]} / now ${r.log[at]}\n   golden ${g.summary}\n   now    ${r.summary}`);
    }
  }
  console.log(bad ? `FAIL: ${bad} of ${golden.length} games differ` : `ok - all ${golden.length} games match move for move`);
  if (bad) process.exitCode = 1;
}
