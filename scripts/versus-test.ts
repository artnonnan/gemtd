/**
 * Headless versus test: two Match instances wired through an in-memory channel instead of PeerJS.
 * Checks shared gem rolls, the ready/wave barrier, snapshots and the final result.
 * Run: npm run versus-test
 */
import { Game } from '../src/game/game';
import { Match } from '../src/net/match';
import type { Msg } from '../src/net/session';

function makeSide(role: 'host' | 'guest') {
  let game = new Game();
  const match = new Match(() => game, (g) => (game = g));
  match.session.role = role;
  match.session.status = 'connected';
  match.session.code = 'TEST1';
  return { match, game: () => game };
}

const a = makeSide('host');
const b = makeSide('guest');
const queue: [typeof a, Msg][] = [];
a.match.session.send = (m) => queue.push([b, structuredClone(m)]);
b.match.session.send = (m) => queue.push([a, structuredClone(m)]);
const flush = () => {
  while (queue.length) {
    const [to, m] = queue.shift()!;
    // reach the private handler the same way PeerJS data events do
    (to.match.session as unknown as { onMessage: (m: Msg) => void }).onMessage(m);
  }
};

const assert = (ok: boolean, msg: string) => {
  if (!ok) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

a.match.session.onConnected();
flush();
assert(a.match.active && b.match.active, 'both sides started a versus game');
assert(a.game().versus && b.game().versus, 'games are in versus mode');

// place 5 gems on the same tiles; same seed must give the same gems
const tiles = [[10, 10], [11, 10], [12, 10], [13, 10], [14, 10]];
for (const [x, y] of tiles) {
  a.game().placeGem(x, y);
  b.game().placeGem(x, y);
}
const ids = (s: typeof a) => s.game().towers.map((t) => t.id).join(',');
assert(ids(a) === ids(b), `same gem sequence (${ids(a)})`);

let now = 0;
const tick = (ms: number) => {
  for (let t = 0; t < ms; t += 16) {
    now += 16;
    a.match.update(now);
    b.match.update(now);
    flush();
    a.game().update(1 / 60);
    b.game().update(1 / 60);
  }
};

a.game().keep(a.game().freshTowers[0]);
tick(500);
assert(a.game().phase === 'waiting', 'host waits while guest is still choosing');
assert(b.match.remote?.snap.phase === 'waiting', 'guest sees host as ready via snapshot');
assert(!!b.match.remote?.layout.towers.length, 'guest received host board layout');

b.game().keep(b.game().freshTowers[1]);
tick(200);
assert(a.game().phase === 'wave' && b.game().phase === 'wave', 'wave starts for both once both chose');

// play on: both keep the first gem each round until someone dies
let guard = 0;
while (!a.match.result && guard++ < 200000) {
  for (const s of [a, b]) {
    const g = s.game();
    if (g.phase === 'build') {
      for (let y = 0; y < 37 && g.phase === 'build'; y++) for (let x = 0; x < 37 && g.phase === 'build'; x++) g.placeGem(x, y);
    }
    if (g.phase === 'choose') g.keep(g.freshTowers[s === a ? 0 : 4]);
  }
  tick(100);
}
console.log('host result :', a.match.result);
console.log('guest result:', b.match.result);
assert(!!a.match.result && !!b.match.result, 'match produced a result on both sides');
console.log(`levels: host ${a.game().level} (${a.game().phase}), guest ${b.game().level} (${b.game().phase})`);
