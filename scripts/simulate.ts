/**
 * Headless smoke test: the heuristic bot (src/ai) plays the game so logic errors and balance problems show up without a browser.
 * Run: npm run simulate -- [runs] [--smart] [--weights=file.json] [--difficulty=hard] [--seed=1]
 * Run r uses seed + r, so the same arguments always give the same results.
 */
import { readFileSync } from 'node:fs';
import type { Difficulty } from '../src/game/game';
import { GEM_INFO, RECIPES, TOWERS } from '../src/data/gems';
import { playBotGame } from '../src/ai/runner';
import { DEFAULT_WEIGHTS, SMART_WEIGHTS, withDefaults } from '../src/ai/weights';

declare const process: { argv: string[] };

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const weightsFile = arg('weights');
const weights = weightsFile
  ? withDefaults(JSON.parse(readFileSync(weightsFile, 'utf8')))
  : process.argv.includes('--smart') ? SMART_WEIGHTS : DEFAULT_WEIGHTS;
const difficulty = (arg('difficulty') ?? 'normal') as Difficulty;
const baseSeed = +(arg('seed') ?? 1);
const runs = +(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 5);

console.log(`weights ${weights.id}, difficulty ${difficulty}, seeds ${baseSeed}..${baseSeed + runs - 1}`);
const results: number[] = [];
for (let r = 0; r < runs; r++) {
  const seed = baseSeed + r;
  const { game, log } = playBotGame({ seed, difficulty, weights });
  const specials = game.towers.filter((t) => !GEM_INFO[t.id]).map((t) => TOWERS[t.id].name);
  console.log(
    `run ${r + 1} (seed ${seed}): ${game.phase} at level ${game.level}, lives ${game.lives}, gold ${game.gold}, kills ${game.stats.kills}, ` +
      `towers ${game.towers.length}, rocks ${game.rocks.size}, route ${game.routeLen.toFixed(0)}, quality ${game.qualityLevel}, moves ${log.length}`,
  );
  console.log(`   specials: ${specials.join(', ') || '-'}`);
  results.push(game.level);
}
console.log(`recipes: ${RECIPES.length}, avg level reached: ${(results.reduce((a, b) => a + b, 0) / runs).toFixed(1)}`);
