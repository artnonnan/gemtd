/**
 * Render smoke test: runs the real Renderer against a fake 2D context so runtime errors in the drawing code
 * (bad calls, NaN geometry) show up without a browser. Covers every LOD and every tower tier.
 * Run: npm run render-smoke
 */
import { Game } from '../src/game/game';
import { BLUEPRINTS } from '../src/ai/blueprint';
import { Renderer } from '../src/render/renderer';
import { BASE_GEMS, GEM_TYPES, RECIPES, TOWERS } from '../src/data/gems';

declare const globalThis: Record<string, unknown>;

let calls = 0;
let nanArgs = 0;
const gradient = { addColorStop: () => {} };
function fakeContext(): unknown {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key as string];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (key === 'measureText') return () => ({ width: 10 });
      return (...args: unknown[]) => {
        calls++;
        if (args.some((a) => typeof a === 'number' && !Number.isFinite(a))) nanArgs++;
      };
    },
    set(t, key, value) {
      t[key as string] = value;
      return true;
    },
  });
}
const fakeCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => fakeContext(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }) });
globalThis.document = { createElement: () => fakeCanvas(), querySelector: () => null };
globalThis.window = { devicePixelRatio: 2, matchMedia: () => ({ matches: false }) };

const renderer = new Renderer(fakeCanvas() as unknown as HTMLCanvasElement);
renderer.tile = 18;

const game = new Game({ seed: 5 });
// one tower of every look: all base gems at all qualities, every special
const ids = [...GEM_TYPES.flatMap((t) => BASE_GEMS[t]), ...Object.keys(TOWERS).filter((id) => !GEM_TYPES.some((t) => BASE_GEMS[t].includes(id)))];
let i = 0;
for (const id of ids) {
  const x = 6 + (i % 25), y = 8 + Math.floor(i / 25) * 2;
  i++;
  if (!game.placeGem(x, y)) continue;
  const t = game.towerAt(x, y)!;
  t.id = id;
  t.fresh = false;
  if (game.phase === 'choose') {
    game.phase = 'build';
    game.gemsLeft = 5;
  }
}
console.log('towers on board:', game.towers.length, 'recipes:', RECIPES.length);

game.phase = 'choose';
game.keep(game.towers[0] ?? game.freshTowers[0]);
game.towers.forEach((t) => (t.fresh = false));

for (const zoom of [1, 2, 5]) {
  renderer.zoom = zoom;
  for (let f = 0; f < 120; f++) {
    for (let s = 0; s < 4; s++) game.update(1 / 60);
    renderer.draw(game);
  }
  console.log(`zoom ${zoom}: frames ok, draw calls so far ${calls}`);
}
for (const mode of ['ground', 'air'] as const) {
  renderer.heatmap = mode;
  const before = calls;
  for (let f = 0; f < 10; f++) renderer.draw(game);
  const m = renderer.heatMaps(game)[mode];
  if (!m.some((v) => v > 0)) throw new Error(`FAIL: ${mode} heatmap is empty with ${game.towers.length} towers`);
  console.log(`heatmap ${mode}: frames ok, ${calls - before} draw calls, ${m.filter((v) => v > 0).length} hot tiles`);
}
renderer.heatmap = 'off';
renderer.blueprint = BLUEPRINTS.spiral;
for (const zoom of [1, 5]) {
  renderer.zoom = zoom;
  const before = calls;
  for (let f = 0; f < 5; f++) renderer.draw(game);
  console.log(`blueprint ghost at zoom ${zoom}: frames ok, ${calls - before} draw calls`);
}
renderer.blueprint = null;
renderer.zoom = 1;
game.upgradeTower(game.towers.find((t) => TOWERS[t.id].upgrades.length)!, TOWERS[game.towers.find((t) => TOWERS[t.id].upgrades.length)!.id].upgrades[0]);
renderer.draw(game);

// choose phase: "can make" labels over a special recipe and a combinable pair
{
  const g = new Game({ seed: 9 });
  for (let x = 10; x < 15; x++) g.placeGem(x, 0); // top row: labels hang below
  const [a, b, c, d, e] = g.freshTowers;
  const flawed = BASE_GEMS[GEM_TYPES[0]][1];
  [a.id, b.id, c.id, d.id, e.id] = ['h001', 'h000', 'e000', flawed, flawed]; // Silver + a Flawed pair
  for (const zoom of [1, 3, 5]) {
    renderer.zoom = zoom;
    for (let f = 0; f < 30; f++) renderer.draw(g);
  }
  renderer.zoom = 1;
  renderer.offX = renderer.offY = 0;
  renderer.draw(g);
  const hits = g.freshTowers.filter((t) => [-1, -0.5, 0, 0.5, 1, 1.5, 2].some((dy) => renderer.hintAt((t.x + 0.5) * 18, (t.y + 1.2 + dy) * 18) === t));
  if (hits.length !== 2) throw new Error(`FAIL: expected a Silver and a combine label, found ${hits.length}`);

  // slate: Topaz (Normal) + Flawed Amethyst; the label sits on the Topaz
  const s = new Game({ seed: 9 });
  for (let x = 10; x < 15; x++) s.placeGem(x, 0);
  const [core, partner, ...others] = s.freshTowers;
  core.id = 'e002';
  partner.id = 'h007';
  others.forEach((t, k) => (t.id = BASE_GEMS[GEM_TYPES[k + 1]][0])); // three different Chipped gems
  renderer.draw(s);
  const onCore = [-1, -0.5, 0, 0.5, 1, 1.5, 2].some((dy) => renderer.hintAt((core.x + 0.5) * 18, (core.y + 1.2 + dy) * 18) === core);
  if (!onCore) throw new Error('FAIL: no slate label on the Topaz');

  // panel focus: the recipe's gems lit, lines into the selected one
  renderer.focus = [{ tower: a, state: 'self' }, { tower: b, state: 'fresh' }, { tower: c, state: 'kept' }];
  for (const zoom of [1, 5]) {
    renderer.zoom = zoom;
    for (let f = 0; f < 10; f++) renderer.draw(g);
  }
  renderer.focus = null;
  renderer.zoom = 1;
  console.log('choice hints: frames ok, special/slate/combine labels clickable, focus drawn');
}
if (nanArgs) throw new Error(`FAIL: ${nanArgs} draw calls received NaN/Infinity`);
console.log('render smoke passed: no exceptions, no NaN geometry');
