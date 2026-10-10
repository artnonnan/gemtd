/**
 * Headless checks for Remove rock, Downgrade (keep lower), Swap and recipe status.
 * Run: npm run features-test
 */
import { Game, SWAP_COST } from '../src/game/game';
import { BASE_GEMS, GEM_INFO, RECIPES } from '../src/data/gems';

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

// ---------- recipe status (kept vs this round) ----------
{
  const silver = RECIPES.find((r) => r.result === 'h01A')!; // h001 + h000 + e000
  const g = new Game({ seed: 5 });
  chooseRound(g, 10);
  const old = g.freshTowers[0];
  g.keep(old);
  old.id = 'h001';
  while (g.phase === 'wave') g.update(1 / 10);
  chooseRound(g, 20);
  const [a, b, ...rest] = g.freshTowers;
  a.id = 'h000';
  b.id = 'e000';
  for (const t of rest) t.id = 'h00Y'; // no Silver ingredient
  const s = g.recipeStatus(silver, a);
  assert(s.parts.map((p) => p.state).join() === 'kept,fresh,fresh' && s.owned === 3 && s.ready, 'Silver: old gem kept, two from this round, ready');
  assert(g.recipeStatus(silver, rest[0]).ready, 'ready does not depend on the selected gem');
  rest[0].id = 'e000';
  g.makeSpecial(a, silver);
  assert(a.id === 'h01A' && g.isRock(old.x, old.y) && g.isRock(b.x, b.y), 'making it uses up the kept gem too');

  const g2 = new Game({ seed: 5 });
  chooseRound(g2, 10);
  const [x, y, z] = g2.freshTowers;
  x.id = 'h001';
  y.id = 'h000';
  z.id = 'e000';
  for (const t of [x, y, z]) t.fresh = false; // all three kept earlier
  g2.towers.filter((t) => t.fresh).forEach((t) => (t.id = 'h00Y'));
  const s2 = g2.recipeStatus(silver);
  assert(s2.owned === 3 && !s2.ready, 'all ingredients kept but none from this round: not ready');
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
// ---------- slates ----------
{
  const g = new Game({ seed: 21 });
  // put the future slate on a tile the creeps currently walk through
  const onRoute = g.route[12];
  assert(g.placeGem(onRoute.x, onRoute.y), 'placed a gem on the route');
  for (let x = 20; x < 24; x++) g.placeGem(x, 30);
  const [core, partner] = g.freshTowers;
  core.id = 'h00H'; // Amethyst
  partner.id = 'h009'; // Flawed Emerald
  const opts = g.slateOptions(core);
  assert(opts.length === 1 && opts[0].result === 'n000', 'Amethyst + Flawed Emerald offers an Air Slate');
  assert(g.slateOptions(partner).length === 0, 'the Flawed partner itself cannot become the slate');
  const routeBlocked = g.route.some((p) => p.x === onRoute.x && p.y === onRoute.y);
  assert(!routeBlocked, 'while it is a gem, the route avoids that tile');
  g.createSlate(core, opts[0]);
  assert(core.id === 'n000' && g.rocks.size === 4 && g.phase === 'wave', 'slate created, other four gems became rocks, wave started');
  assert(g.route.some((p) => p.x === onRoute.x && p.y === onRoute.y), 'creeps walk over the slate again');
  assert(!g.canPlace(onRoute.x, onRoute.y), 'cannot build on a slate');
  assert(!g.isSwapTarget(onRoute.x, onRoute.y), 'slates are not swap targets');

  // the Air Slate fights while creeps walk over it
  let fired = false;
  for (let i = 0; i < 60 * 60 && g.phase === 'wave'; i++) {
    g.update(1 / 60);
    if (g.events.some((e) => e.type === 'fire' && e.tower === core)) fired = true;
    g.events.length = 0;
  }
  assert(fired, 'Air Slate attacked creeps walking over it');
  assert(core.kills > 0 || g.stats.kills > 0, `creeps died (slate kills ${core.kills})`);

  // teleport once
  assert(g.canTeleport(core) && g.beginTeleport(core), 'teleport mode started');
  assert(!g.isTeleportTarget(36, 36), 'cannot teleport out of range');
  const dest = { x: core.x + 2, y: core.y };
  while (!g.isTeleportTarget(dest.x, dest.y)) dest.y++;
  assert(g.teleportTo(dest.x, dest.y) && core.x === dest.x && core.y === dest.y, 'slate teleported');
  assert(!g.canTeleport(core), 'teleport is single-use');

  // second round: a Hold Slate, then combine Air + Hold into Ancient
  while (g.phase === 'wave') g.update(1 / 30);
  const route2 = g.route[20];
  g.placeGem(route2.x, route2.y);
  for (let x = 20; x < 24; x++) g.placeGem(x, 33);
  const [core2, partner2] = g.freshTowers;
  core2.id = 'e002'; // Topaz
  partner2.id = 'h00B'; // Flawed Sapphire
  g.createSlate(core2, g.slateOptions(core2)[0]);
  assert(core2.id === 'n002', 'Hold Slate created');
  let held = false;
  for (let i = 0; i < 60 * 90 && g.phase === 'wave'; i++) {
    g.update(1 / 60);
    if (g.events.some((e) => e.type === 'hold')) held = true;
    g.events.length = 0;
  }
  assert(held, 'Hold Slate grabbed a creep');
  const combos = g.slateSpecialOptions(core);
  assert(combos.length === 1 && combos[0].result === 'n003', 'Air + Hold can become an Ancient Slate');
  const [px, py] = [core2.x, core2.y];
  assert(g.combineSlates(core, 'n003') && core.id === 'n003', 'Ancient Slate created');
  assert(!g.towerAt(px, py) && !g.isRock(px, py), 'the used Hold Slate leaves an empty tile');
}

console.log('all feature checks passed');
