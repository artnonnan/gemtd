/**
 * Blueprint tools. Pathfinding and the no-build rule are the game's own (findRoute, Game.isReserved).
 *   npm run blueprint -- board                       empty board with the ground route and the flight path
 *   npm run blueprint -- render <id> [--level=N | --pct=50]   board after the first cells in build order
 *   npm run blueprint -- validate <id>              in bounds, buildable, no duplicates, every build prefix keeps a route
 *   npm run blueprint -- stats <id>                 route length as it is built, what each slot covers
 *   npm run blueprint -- reorder <id>               greedy build order (longest route first), saved as a new id
 * Legend: S spawn, 1–5 checkpoints, E mine (exit), # wall, O slot, F final slot, R reserve (built late),
 *         H hub (kept empty), * ground route, ~ flight path, + both routes, , no-build tile, . empty
 * Built cells show their role letter; hub cells show H unless the route runs through them (then *).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CHECKPOINTS, GEMS_PER_ROUND, GRID, type Point } from '../src/game/config';
import { Game } from '../src/game/game';
import { findRoute, routeLength } from '../src/game/path';
import { AIR_PATH, GEM_ODDS, cover } from '../src/ai/exposure';
import { hubPasses, load, type Blueprint, type BlueprintCell } from '../src/ai/blueprint';
import { BLUEPRINT_FILES } from '../src/data/blueprints';

declare const process: { argv: string[]; exitCode: number };

const DIR = 'src/data/blueprints';
const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const reserved = (() => {
  const g = new Game({ seed: 1 });
  return (x: number, y: number) => g.isReserved(x, y);
})();
const key = (x: number, y: number) => y * GRID + x;

function read(id: string): Blueprint {
  const path = `${DIR}/${id}.json`;
  if (!existsSync(path)) throw new Error(`no blueprint ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

const routeWith = (walls: Set<number>) => findRoute((x, y) => walls.has(key(x, y)));

/** cells in build order, up to a level (5 per level) or a percentage */
function prefix(bp: Blueprint): BlueprintCell[] {
  const sorted = load(bp).sorted;
  const level = opt('level'), pct = opt('pct');
  if (level) return sorted.slice(0, +level * GEMS_PER_ROUND);
  if (pct) return sorted.slice(0, Math.round((sorted.length * +pct) / 100));
  return sorted;
}

const LETTER: Record<string, string> = { wall: '#', slot: 'O', final: 'F', reserve: 'R' };

function draw(cells: BlueprintCell[], title: string, bp?: Blueprint) {
  const walls = new Set(cells.map((c) => key(c.x, c.y)));
  const roleAt = new Map(cells.map((c) => [key(c.x, c.y), LETTER[c.role]]));
  const hub = new Set((bp?.cells ?? []).filter((c) => c.role === 'hub').map((c) => key(c.x, c.y)));
  const route = routeWith(walls);
  const ground = new Set((route ?? []).map((p) => key(p.x, p.y)));
  const air = new Set(AIR_PATH.map((p) => key(p.x, p.y)));
  const cp = new Map(CHECKPOINTS.map((p, i) => [key(p.x, p.y), i === 0 ? 'S' : i === CHECKPOINTS.length - 1 ? 'E' : String(i)]));
  console.log(title);
  console.log('    ' + Array.from({ length: GRID }, (_, x) => (x % 10 === 0 ? String(x / 10) : ' ')).join(''));
  console.log('    ' + Array.from({ length: GRID }, (_, x) => String(x % 10)).join(''));
  for (let y = 0; y < GRID; y++) {
    let row = '';
    for (let x = 0; x < GRID; x++) {
      const k = key(x, y);
      row += cp.get(k) ?? roleAt.get(k) ?? (ground.has(k) && air.has(k) ? '+' : ground.has(k) ? '*' : hub.has(k) ? 'H' : air.has(k) ? '~' : reserved(x, y) ? ',' : '.');
    }
    console.log(String(y).padStart(3) + ' ' + row);
  }
  console.log(route ? `ground route ${routeLength(route).toFixed(1)} tiles (${route.length} steps)` + (bp?.hub ? `, passes the hub ${hubPasses(route, bp.hub)} times` : '') : 'ROUTE BLOCKED');
}

function validate(bp: Blueprint): string[] {
  const problems: string[] = [];
  const seen = new Set<number>(), orders = new Set<number>();
  for (const c of bp.cells) {
    if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || c.x < 0 || c.y < 0 || c.x >= GRID || c.y >= GRID) problems.push(`(${c.x},${c.y}) is off the board`);
    else if (reserved(c.x, c.y)) problems.push(`(${c.x},${c.y}) is next to a checkpoint: no building there`);
    if (seen.has(key(c.x, c.y))) problems.push(`(${c.x},${c.y}) appears twice`);
    if (c.role !== 'hub' && orders.has(c.order)) problems.push(`order ${c.order} is used twice`);
    if (!['wall', 'slot', 'final', 'reserve', 'hub'].includes(c.role)) problems.push(`(${c.x},${c.y}) has role "${c.role}"`);
    if (c.role === 'reserve' && !c.unlockLevel) problems.push(`reserve (${c.x},${c.y}) has no unlockLevel`);
    if (bp.hub && c.role !== 'hub' && c.x >= bp.hub.x0 && c.x <= bp.hub.x1 && c.y >= bp.hub.y0 && c.y <= bp.hub.y1 && c.role !== 'wall' && c.role !== 'slot') problems.push(`(${c.x},${c.y}) is a ${c.role} inside the hub`);
    seen.add(key(c.x, c.y));
    orders.add(c.order);
  }
  // place in build order, one cell at a time, like the game would: the route must survive every step
  const walls = new Set<number>();
  for (const c of load(bp).sorted) {
    walls.add(key(c.x, c.y));
    if (!routeWith(walls)) {
      problems.push(`placing order ${c.order} (${c.x},${c.y}) cuts the route`);
      break;
    }
  }
  // each phase: building up to its level must make the route pass the hub often enough
  if (bp.hub) {
    for (const ph of bp.phases ?? []) {
      const w = new Set(load(bp).sorted.slice(0, ph.level * GEMS_PER_ROUND).map((c) => key(c.x, c.y)));
      const r = routeWith(w);
      const got = r ? hubPasses(r, bp.hub) : 0;
      if (got < ph.minPasses) problems.push(`phase to level ${ph.level} (${ph.goal}): hub passed ${got} times, wants ${ph.minPasses}`);
      else console.log(`phase to level ${ph.level}: hub passed ${got} times (wants ${ph.minPasses}) - ${ph.goal}`);
    }
  }
  return problems;
}

function budget(n: number): string {
  const levels = Math.ceil(n / GEMS_PER_ROUND);
  return `${n} cells = ${levels} levels of gems (${GEMS_PER_ROUND} per level; budget to level 20: ${20 * GEMS_PER_ROUND}, to level 30: ${30 * GEMS_PER_ROUND})`;
}

function stats(bp: Blueprint) {
  const sorted = load(bp).sorted;
  const empty = routeLength(routeWith(new Set())!);
  console.log(`${bp.id}: ${budget(sorted.length)}`);
  console.log(`empty board route ${empty.toFixed(1)}`);
  const at = (n: number) => {
    const r = routeWith(new Set(sorted.slice(0, n).map((c) => key(c.x, c.y))));
    return r ? routeLength(r) : NaN;
  };
  console.log('route length while building:');
  const passesAt = (n: number) => {
    const r = bp.hub ? routeWith(new Set(sorted.slice(0, n).map((c) => key(c.x, c.y)))) : null;
    return r && bp.hub ? `, hub passes ${hubPasses(r, bp.hub)}` : '';
  };
  for (const lv of [2, 5, 10, 13, 15, 20, 25, 30, 35]) {
    const n = Math.min(sorted.length, lv * GEMS_PER_ROUND);
    console.log(`  level ${String(lv).padStart(2)} (${String(n).padStart(3)} cells): ${at(n).toFixed(1)} (+${(at(n) - empty).toFixed(1)})${passesAt(n)}`);
    if (n === sorted.length) break;
  }
  for (const p of [25, 50, 75, 100]) console.log(`  ${String(p).padStart(3)}%: ${at(Math.round((sorted.length * p) / 100)).toFixed(1)}`);
  const full = routeWith(new Set(sorted.map((c) => key(c.x, c.y))))!;
  const slots = sorted.filter((c) => c.role === 'slot' || c.role === 'final' || c.role === 'reserve');
  const r = GEM_ODDS.range;
  console.log(`slots (${slots.length}), route tiles in reach at average gem range ${r.toFixed(1)} on the finished maze:`);
  let airSlots = 0;
  for (const s of slots) {
    const g = cover(full, s.x, s.y, r), a = cover(AIR_PATH, s.x, s.y, r);
    if (a) airSlots++;
    console.log(`  ${s.role.padEnd(7)} order ${String(s.order).padStart(3)} (level ${Math.ceil(s.order / GEMS_PER_ROUND)}${s.unlockLevel ? `, unlocks ${s.unlockLevel}` : ''}) at (${s.x},${s.y}): ground ${g}, flight path ${a}`);
  }
  console.log(`slots reaching the flight path: ${airSlots}/${slots.length} (${Math.round((airSlots / Math.max(1, slots.length)) * 100)}%)`);
}

function reorder(bp: Blueprint) {
  const left = [...load(bp).sorted];
  const walls = new Set<number>();
  const out: BlueprintCell[] = [];
  while (left.length) {
    let best = -1, bestLen = -Infinity;
    left.forEach((c, i) => {
      walls.add(key(c.x, c.y));
      const r = routeWith(walls);
      walls.delete(key(c.x, c.y));
      // ties keep the designed order
      if (r && routeLength(r) > bestLen + 1e-9) {
        best = i;
        bestLen = routeLength(r);
      }
    });
    if (best < 0) {
      console.log(`stopped: the remaining ${left.length} cells would each cut the route`);
      break;
    }
    const [c] = left.splice(best, 1);
    walls.add(key(c.x, c.y));
    out.push({ ...c, order: out.length + 1 });
  }
  let id = `${bp.id}-reordered`;
  for (let n = 2; existsSync(`${DIR}/${id}.json`); n++) id = `${bp.id}-reordered${n}`;
  const nb: Blueprint = { ...bp, id, parent: bp.id, author: 'tool', note: `greedy reorder of ${bp.id}: each step adds the cell that lengthens the route most. ${bp.note}`, cells: out };
  writeFileSync(`${DIR}/${id}.json`, JSON.stringify(nb, null, 1));
  console.log(`saved ${DIR}/${id}.json (${out.length} cells); add it to ${DIR}/index.ts to let the bot use it`);
}

const [cmd, id] = args;
try {
  if (cmd === 'board') draw([], 'empty board');
  else if (cmd === 'render') {
    const bp = read(id);
    const cells = prefix(bp);
    draw(cells, `${bp.id}: ${bp.style} — first ${cells.length}/${load(bp).sorted.length} cells`, bp);
  } else if (cmd === 'validate') {
    const bp = read(id);
    const p = validate(bp);
    console.log(`${bp.id}: ${budget(load(bp).sorted.length)}`);
    if (!BLUEPRINT_FILES.some((b) => b.id === bp.id)) console.log(`note: not registered in ${DIR}/index.ts yet`);
    console.log(p.length ? p.map((x) => `FAIL: ${x}`).join('\n') : 'ok - valid: every build prefix keeps a route');
    if (p.length) process.exitCode = 1;
  } else if (cmd === 'stats') stats(read(id));
  else if (cmd === 'reorder') reorder(read(id));
  else console.log('usage: npm run blueprint -- board | render <id> [--level=N|--pct=P] | validate <id> | stats <id> | reorder <id>');
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
