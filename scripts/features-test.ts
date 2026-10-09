/**
 * Headless checks for Remove rock, Downgrade (keep lower) and Swap.
 * Run: npm run features-test
 */
import { Game, SWAP_COST } from '../src/game/game';
import { BASE_GEMS, GEM_INFO } from '../src/data/gems';

const assert = (ok: boolean, msg: string) => {
  if (!ok) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

/** Place 5 gems in a row and return the game in the choose phase. */
function chooseRound(game: Game, y: number) {
  for (let x = 10; x < 15; x++) game.placeGem(x, y);
}

// ---------- downgrade ----------
{
  let found = false;
  for (let seed = 1; seed < 500 && !found; seed++) {
    const g = new Game({ seed });
    g.qualityLevel = 8; // no Chipped rolls
    chooseRound(g, 10);
    const t = g.freshTowers.find((o) => g.downgradeOption(o));
    if (!t) continue;
    found = true;
    const info = GEM_INFO[t.id];
    const lower = g.downgradeOption(t)!;
    assert(lower === BASE_GEMS[info.type][info.quality - 1], `downgrade option is one quality lower (${t.id} -> ${lower})`);
    g.keepDowngraded(t);
    assert(t.id === lower && !t.fresh, 'kept gem was downgraded');
    assert(g.stats.downgrades === 1 && g.phase === 'wave', 'downgrade counted and the wave started');
    assert(g.downgradeOption(t) === null, 'no second downgrade once kept');
  }
  assert(found, 'found a round with a downgradable gem');

  const g = new Game({ seed: 3 });
  g.qualityLevel = 0; // everything Chipped
  chooseRound(g, 10);
  assert(g.freshTowers.every((t) => g.downgradeOption(t) === null), 'Chipped gems cannot be downgraded');
}

// ---------- remove rock ----------
{
  const g = new Game({ seed: 7 });
  chooseRound(g, 10);
  const kept = g.freshTowers[0];
  g.keep(kept);
  assert(g.rocks.size === 4, 'four gems turned into rocks');
  const key = [...g.rocks][0];
  const [x, y] = [key % 37, Math.floor(key / 37)];
  g.selectRock(x, y);
  assert(!!g.selectedRock, 'rock can be selected');
  assert(g.removeRock(x, y), 'rock removed during the wave');
  assert(!g.isRock(x, y) && g.rocks.size === 3 && g.selectedRock === null, 'tile is free again and selection cleared');
  assert(!g.removeRock(x, y), 'removing an empty tile fails');
}

// ---------- swap ----------
{
  const g = new Game({ seed: 11 });
  chooseRound(g, 10);
  const a = g.freshTowers[0];
  g.keep(a);
  // finish the wave quickly
  while (g.phase === 'wave') g.update(1 / 10);
  chooseRound(g, 20);
  const b = g.freshTowers[0];
  g.keep(b);

  a.id = 'h015'; // Black Opal has the map's Swap ability
  assert(g.canSwap(a), 'Black Opal can swap');
  assert(!g.canSwap(b), `base gem ${b.id} cannot swap`);
  g.gold = SWAP_COST - 1;
  assert(!g.beginSwap(a), 'swap needs 200 gold');
  g.gold = SWAP_COST + 50;
  assert(g.beginSwap(a), 'swap mode started');
  assert(!g.isSwapTarget(a.x, a.y), 'cannot swap with itself');
  const [ax, ay, bx, by] = [a.x, a.y, b.x, b.y];
  const routeBefore = g.routeLen;
  assert(g.swapWith(bx, by), 'swapped with another kept gem');
  assert(a.x === bx && a.y === by && b.x === ax && b.y === ay, 'positions exchanged');
  assert(g.towerAt(bx, by) === a && g.towerAt(ax, ay) === b, 'grid updated');
  assert(g.gold === 50 && a.swapUsed && !g.canSwap(a), 'paid 200 and swap is used up');
  assert(g.routeLen === routeBefore, 'route unchanged by a tower-tower swap');

  a.swapUsed = false;
  g.gold = SWAP_COST;
  const rockKey = [...g.rocks][0];
  const [rx, ry] = [rockKey % 37, Math.floor(rockKey / 37)];
  const [sx, sy] = [a.x, a.y];
  g.beginSwap(a);
  assert(g.swapWith(rx, ry), 'swapped with a rock');
  assert(g.towerAt(rx, ry) === a && g.isRock(sx, sy) && !g.isRock(rx, ry), 'tower and rock exchanged');

  a.swapUsed = false;
  g.gold = SWAP_COST;
  g.beginSwap(a);
  assert(!g.swapWith(0, 36) && g.swapSource === null && g.gold === SWAP_COST, 'clicking an empty tile cancels without paying');

  a.swapUsed = true;
  g.gold = 1000;
  assert(g.upgradeTower(a, 'h02K') && !a.swapUsed, 'upgrading renews swap');
}
console.log('all feature checks passed');
