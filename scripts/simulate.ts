/**
 * Headless smoke test: a simple bot plays the game so logic errors and balance problems show up without a browser.
 * Run: npm run simulate [runs] [--smart] [--difficulty=hard] [--seed=1]
 * Run r uses seed + r, so the same arguments always give the same results.
 */
import { Game, type Difficulty } from '../src/game/game';

declare const process: { argv: string[] };
import { GRID, STEP } from '../src/game/config';
import { findRoute, routeLength } from '../src/game/path';
import { mulberry32 } from '../src/game/rng';
import { GEM_INFO, RECIPES, TOWERS, abilityOf } from '../src/data/gems';

const smart = process.argv.includes('--smart');
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const baseSeed = +(arg('seed') ?? 1);
/** the bot's own tie-break randomness, reseeded per run */
let botRng = mulberry32(0);

function tileValue(game: Game, x: number, y: number): number {
  if (smart && game.route.some((p) => p.x === x && p.y === y)) {
    // greedy mazing: how much longer does the route get if we block this tile?
    const r = findRoute((bx, by) => (bx === x && by === y) || !!game.towerAt(bx, by) || game.isRock(bx, by));
    return r ? routeLength(r) - game.routeLen + 100 : -1;
  }
  // prefer tiles next to the route so gems cover it
  let near = 0;
  for (const p of game.route) {
    const d = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    if (d === 1) near++;
  }
  return near + botRng() * 0.5;
}

function power(id: string): number {
  const d = TOWERS[id];
  const a = abilityOf(id);
  return ((d.dmg + d.dice * (d.sides + 1) / 2) / d.cd) * (a.multi ?? 1) * (a.crit ? 1 + a.crit.chance * (a.crit.mult - 1) : 1) + (a.burn?.dps ?? 0);
}

function playRound(game: Game) {
  while (game.phase === 'build') {
    if (game.gold >= 50 && game.qualityLevel < 8) game.upgradeQuality();
    let best: { x: number; y: number; v: number } | null = null;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!game.canPlace(x, y)) continue;
        const v = tileValue(game, x, y);
        if (!best || v > best.v) best = { x, y, v };
      }
    }
    if (!best || !game.placeGem(best.x, best.y)) throw new Error('could not place a gem');
  }
  // choose: special > combine 4 > combine 2 > keep strongest
  for (const t of game.freshTowers) {
    const r = game.specialOptions(t)[0];
    if (r) return game.makeSpecial(t, r);
  }
  for (const count of [4, 2] as const) {
    for (const t of game.freshTowers) if (game.combineOptions(t).some((o) => o.count === count)) return game.combine(t, count);
  }
  const best = [...game.freshTowers].sort((a, b) => power(b.id) - power(a.id))[0];
  game.keep(best);
}

function upgradeTowers(game: Game) {
  for (const t of game.towers) {
    const opt = game.upgradeOptions(t).sort((a, b) => a.cost - b.cost)[0];
    if (opt && game.gold >= opt.cost + 20) game.upgradeTower(t, opt.id);
  }
}

const runs = +(process.argv[2] ?? 5);
const results: number[] = [];
for (let r = 0; r < runs; r++) {
  const difficulty = (arg('difficulty') ?? 'normal') as Difficulty;
  const seed = baseSeed + r;
  const game = new Game({ difficulty, seed });
  botRng = mulberry32(seed);
  let guard = 0;
  while (game.phase !== 'gameover' && game.phase !== 'victory') {
    if (game.phase === 'build') {
      playRound(game);
      upgradeTowers(game);
    }
    game.update(STEP);
    if (++guard > (3 * 60 * 60) / STEP) throw new Error('simulation stuck');
  }
  const specials = game.towers.filter((t) => !GEM_INFO[t.id]).map((t) => TOWERS[t.id].name);
  console.log(
    `run ${r + 1} (seed ${seed}): ${game.phase} at level ${game.level}, lives ${game.lives}, gold ${game.gold}, kills ${game.stats.kills}, ` +
      `towers ${game.towers.length}, rocks ${game.rocks.size}, route ${game.routeLen.toFixed(0)}, quality ${game.qualityLevel}`,
  );
  console.log(`   specials: ${specials.join(', ') || '-'}`);
  results.push(game.level);
}
console.log(`recipes: ${RECIPES.length}, avg level reached: ${(results.reduce((a, b) => a + b, 0) / runs).toFixed(1)}`);
