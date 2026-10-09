import { Game, type BoardSnapshot, type Difficulty } from '../game/game';
import { randomSeed } from '../game/rng';
import { PROTOCOL_VERSION, Session, type Msg } from './session';

const SNAP_INTERVAL = 100; // ms
const LAYOUT_RESYNC = 3000; // ms, resend layout even if unchanged

/** Opponent board as last reported, plus layout kept from earlier snapshots. */
export interface RemoteBoard {
  snap: BoardSnapshot;
  layout: NonNullable<BoardSnapshot['layout']>;
  /** bumped when layout changes so the mini view can recompute its route */
  layoutVersion: number;
}

/**
 * Versus match over a Session: both players run their own Game with the same seed.
 * A wave starts once both have chosen their gem for that level (or the opponent is gone).
 */
export class Match {
  readonly session = new Session();
  /** a versus game is running (stays true after a disconnect so the result remains visible) */
  active = false;
  remote: RemoteBoard | null = null;
  notice = '';

  private remoteReadyLevel = 0;
  private sentReadyLevel = 0;
  private lastSnap = 0;
  private lastLayout = 0;
  private sentVersion = -1;

  constructor(private getGame: () => Game, private setGame: (g: Game) => void) {
    this.session.onMessage = (m) => this.onMessage(m);
    this.session.onConnected = () => {
      this.notice = '';
      if (this.session.role === 'host') this.start(this.getGame().difficulty);
    };
    this.session.onClosed = () => {
      if (this.active) {
        this.notice = 'Opponent disconnected — you can keep playing solo.';
        this.getGame().say(this.notice);
      }
    };
  }

  get isHost() {
    return this.session.role === 'host';
  }

  /** Host only: (re)start both games with a fresh shared seed. */
  start(difficulty: Difficulty) {
    if (!this.isHost || !this.session.connected) return;
    const seed = randomSeed();
    this.session.send({ t: 'start', seed, difficulty });
    this.begin(seed, difficulty);
  }

  leave() {
    this.active = false;
    this.session.leave();
    this.remote = null;
    this.notice = '';
    this.setGame(new Game({ difficulty: this.getGame().difficulty }));
  }

  /** Called every frame before the simulation step. */
  update(now: number) {
    if (!this.active) return;
    const game = this.getGame();
    const online = this.session.connected;

    if (game.phase === 'waiting') {
      if (online && this.sentReadyLevel < game.level) {
        this.session.send({ t: 'ready', level: game.level });
        this.sentReadyLevel = game.level;
      }
      const remoteDone = !!this.remote && ['gameover', 'victory'].includes(this.remote.snap.phase);
      if (!online || remoteDone || this.remoteReadyLevel >= game.level) game.beginWave();
    }

    if (online && now - this.lastSnap >= SNAP_INTERVAL) {
      this.lastSnap = now;
      const withLayout = game.version !== this.sentVersion || now - this.lastLayout >= LAYOUT_RESYNC;
      if (withLayout) {
        this.sentVersion = game.version;
        this.lastLayout = now;
      }
      this.session.send({ t: 'snap', s: game.snapshot(withLayout) });
    }
  }

  /** Who is ahead / who won, or null while both are still playing. */
  get result(): string | null {
    if (!this.active || !this.remote) return null;
    const me = this.getGame();
    const op = this.remote.snap;
    const done = (p: string) => p === 'gameover' || p === 'victory';
    if (!done(me.phase) && !done(op.phase)) return null;
    if (me.phase === 'gameover' && !done(op.phase)) return `You lost — fell on level ${me.level}.`;
    if (op.phase === 'gameover' && !done(me.phase)) return `You win! Opponent fell on level ${op.level}. Keep going for score.`;
    if (!done(op.phase)) return 'You cleared all 50 levels! Waiting for opponent…';
    if (!done(me.phase)) return 'Opponent cleared all 50 levels — survive!';
    const score = (level: number, lives: number, kills: number) => level * 1e6 + lives * 1e3 + kills;
    const mine = score(me.level, me.lives, me.stats.kills);
    const theirs = score(op.level, op.lives, op.kills);
    return mine === theirs ? 'Draw!' : mine > theirs ? 'You win!' : 'You lose.';
  }

  private begin(seed: number, difficulty: Difficulty) {
    this.active = true;
    this.remote = null;
    this.remoteReadyLevel = 0;
    this.sentReadyLevel = 0;
    this.sentVersion = -1;
    this.notice = '';
    const game = new Game({ seed, difficulty, versus: true });
    game.say('Versus match started — same gems for both players. Last one standing wins!');
    this.setGame(game);
  }

  private onMessage(m: Msg) {
    switch (m.t) {
      case 'hello':
        if (m.v !== PROTOCOL_VERSION) this.notice = 'Opponent runs a different game version — reload both pages.';
        break;
      case 'start':
        if (!this.isHost) this.begin(m.seed, m.difficulty);
        break;
      case 'ready':
        this.remoteReadyLevel = Math.max(this.remoteReadyLevel, m.level);
        break;
      case 'snap': {
        const prev = this.remote;
        const layout = m.s.layout ?? prev?.layout ?? { towers: [], rocks: [] };
        const changed = !!m.s.layout && JSON.stringify(m.s.layout) !== JSON.stringify(prev?.layout);
        this.remote = { snap: m.s, layout, layoutVersion: (prev?.layoutVersion ?? 0) + (changed ? 1 : 0) };
        break;
      }
    }
  }
}
