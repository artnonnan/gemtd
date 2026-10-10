/**
 * Headless checks that a seed fully decides a game: same seed + same actions = same result.
 * Run: npm run determinism-test
 */
import { Game } from '../src/game/game';
import { GRID, STEP } from '../src/game/config';
import { TOWERS } from '../src/data/gems';
import { findRoute } from '../src/game/path';
import { mulberry32 } from '../src/game/rng';
import { playBotGame, replay } from '../src/ai/runner';
import { DEFAULT_WEIGHTS, SMART_WEIGHTS } from '../src/ai/weights';

const assert = (ok: boolean, msg: string) => {
  if (!ok) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

const MAX_LEVEL = 25;

/** Fixed, rng-free play: gems on the first free tiles beside the route, combine when possible, else keep the hardest hitter. */
function playRound(game: Game) {
  if (game.gold >= 40) game.upgradeQuality();
  while (game.phase === 'build') {
    let placed = false;
    for (const p of game.route) {
      for (let dy = -1; dy <= 1 && !placed; dy++) {
        for (let dx = -1; dx <= 1 && !placed; dx++) {
          const x = p.x + dx, y = p.y + dy;
          if (x >= 0 && y >= 0 && x < GRID && y < GRID && game.canPlace(x, y)) placed = game.placeGem(x, y);
        }
      }
      if (placed) break;
    }
    if (!placed) throw new Error('could not place a gem');
  }
  for (const t of game.freshTowers) {
    const r = game.specialOptions(t)[0];
    if (r) return game.makeSpecial(t, r);
  }
  for (const count of [4, 2] as const) {
    for (const t of game.freshTowers) if (game.combineOptions(t).some((o) => o.count === count)) return game.combine(t, count);
  }
  const best = [...game.freshTowers].sort((a, b) => TOWERS[b.id].dmg - TOWERS[a.id].dmg)[0];
  game.keep(best);
}

/** Plays a whole game and returns one line per finished wave. */
function trace(seed: number): string[] {
  const game = new Game({ seed });
  const lines: string[] = [];
  let level = game.level;
  while (game.phase !== 'gameover' && game.phase !== 'victory' && game.level <= MAX_LEVEL) {
    if (game.phase === 'build') playRound(game);
    game.update(STEP);
    game.events.length = 0;
    if (game.level !== level || game.phase === 'gameover') {
      level = game.level;
      const towers = game.towers.map((t) => `${t.id}@${t.x},${t.y}:${t.kills}`).join(' ');
      lines.push(
        `L${level} ${game.phase} lives=${game.lives} gold=${game.gold} kills=${game.stats.kills} ` +
          `leaked=${game.stats.leaked} t=${game.time.toFixed(4)} ${towers}`,
      );
    }
  }
  return lines;
}

// ---------- combat never touches Math.random ----------
{
  const real = Math.random;
  Math.random = () => {
    throw new Error('Math.random called inside the game');
  };
  try {
    const lines = trace(1);
    assert(lines.length >= 5, `seeded game ran ${lines.length} waves without Math.random`);
  } finally {
    Math.random = real;
  }
}

// ---------- same seed, same game ----------
for (const seed of [1, 42, 9001]) {
  const a = trace(seed);
  const b = trace(seed);
  const diff = a.findIndex((l, i) => l !== b[i]);
  assert(a.length === b.length && diff === -1, `seed ${seed}: two runs match over ${a.length} waves` + (diff >= 0 ? ` (first diff: ${a[diff]} vs ${b[diff]})` : ''));
}

// ---------- different seeds differ ----------
assert(trace(1).join('\n') !== trace(2).join('\n'), 'different seeds give different games');

// ---------- combat does not shift the gem rolls (versus relies on this) ----------
{
  const a = new Game({ seed: 77 });
  const b = new Game({ seed: 77 });
  for (const g of [a, b]) for (let x = 10; x < 15; x++) g.placeGem(x, 10);
  // keep different gems so the two waves fight differently
  a.keep(a.freshTowers[0]);
  b.keep(b.freshTowers[4]);
  for (const g of [a, b]) while (g.phase === 'wave') g.update(STEP);
  for (const g of [a, b]) for (let x = 10; x < 15; x++) g.placeGem(x, 12);
  const ids = (g: Game) => g.freshTowers.map((t) => t.id).join(',');
  assert(ids(a) === ids(b), `round 2 gems match after different fights (${ids(a)})`);
}

// ---------- a bot game replays from seed + move log ----------
{
  const summary = (g: Game) =>
    `${g.phase} L${g.level} lives=${g.lives} gold=${g.gold} kills=${g.stats.kills} t=${g.time.toFixed(4)} ` +
    g.towers.map((t) => `${t.id}@${t.x},${t.y}:${t.kills}`).join(' ');
  for (const weights of [DEFAULT_WEIGHTS, SMART_WEIGHTS]) {
    const { game, log } = playBotGame({ seed: 5, difficulty: 'normal', weights });
    const again = replay(5, 'normal', log);
    assert(summary(game) === summary(again), `${weights.id} bot game (${log.length} moves, level ${game.level}) replays exactly`);
  }
}

// ---------- canPlace's leg-only search agrees with a full route search ----------
{
  // random rock mazes, dense enough that many route tiles would cut the route
  let checked = 0, refused = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Game({ seed });
    const rng = mulberry32(seed);
    const rockBlocked = (x: number, y: number) => g.isRock(x, y);
    for (let n = 0; n < 500; n++) {
      const x = Math.floor(rng() * GRID), y = Math.floor(rng() * GRID);
      if (g.isRock(x, y) || g.isReserved(x, y)) continue;
      g.rocks.add(y * GRID + x);
      if (!findRoute(rockBlocked)) g.rocks.delete(y * GRID + x);
    }
    (g as unknown as { refreshRoute(): void }).refreshRoute();
    g.touch();
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (g.isRock(x, y) || g.isReserved(x, y)) continue;
        const onRoute = g.route.some((p) => p.x === x && p.y === y);
        const full = !onRoute || findRoute((bx, by) => (bx === x && by === y) || g.isRock(bx, by)) !== null;
        if (g.canPlace(x, y) !== full) throw new Error(`FAIL: seed ${seed} canPlace(${x},${y}) = ${!full}, full search says ${full}`);
        checked++;
        if (!full) refused++;
      }
    }
  }
  assert(refused >= 20, `canPlace matches a full route search on ${checked} tiles (${refused} would cut the route)`);
}

console.log('all determinism checks passed');
