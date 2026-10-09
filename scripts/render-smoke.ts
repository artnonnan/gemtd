/**
 * Render smoke test: runs the real Renderer against a fake 2D context so runtime errors in the drawing code
 * (bad calls, NaN geometry) show up without a browser. Covers every LOD and every tower tier.
 * Run: npm run render-smoke
 */
import { Game } from '../src/game/game';
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
game.upgradeTower(game.towers.find((t) => TOWERS[t.id].upgrades.length)!, TOWERS[game.towers.find((t) => TOWERS[t.id].upgrades.length)!.id].upgrades[0]);
renderer.draw(game);
if (nanArgs) throw new Error(`FAIL: ${nanArgs} draw calls received NaN/Infinity`);
console.log('render smoke passed: no exceptions, no NaN geometry');
