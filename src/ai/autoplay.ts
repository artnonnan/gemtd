/**
 * The bot playing in the browser, at a pace people can follow, yet move for move the same game
 * as a headless run with the same seed and weights:
 * - build / choose moves are spaced out in real time. The game clock does not run in those phases
 *   (Game.update only advances during a wave), so waiting between them changes nothing.
 * - wave moves (upgrades, lives) happen right before each fixed update step, exactly like runner.ts.
 */
import type { Game } from '../game/game';
import { Bot, applyAction, type Action } from './bot';
import type { Weights } from './weights';

/** real seconds between two build/choose moves at 1x speed */
const MOVE_DELAY = 0.35;

export class AutoPlay {
  readonly bot: Bot;
  moves = 0;
  lastAction: Action | null = null;
  private wait = 0;

  constructor(readonly weights: Weights, readonly seed: number) {
    this.bot = new Bot(weights, seed);
  }

  /** Call once per frame (not while paused). Makes at most one build/choose move. */
  frame(game: Game, dt: number, speed: number) {
    if (game.phase !== 'build' && game.phase !== 'choose') return;
    this.wait -= dt * speed;
    if (this.wait > 0) return;
    this.wait = MOVE_DELAY;
    this.move(game);
  }

  /** Call right before every game.update(STEP): plays every move the bot wants mid-wave. */
  beforeUpdate(game: Game) {
    if (game.phase !== 'wave') return;
    for (let n = 0; n < 200 && this.move(game); n++);
  }

  private move(game: Game): boolean {
    const a = this.bot.nextAction(game);
    if (!a) return false;
    if (!applyAction(game, a)) throw new Error(`game refused AI move ${JSON.stringify(a)}`);
    this.moves++;
    this.lastAction = a;
    return true;
  }
}

export function describeAction(a: Action | null): string {
  if (!a) return '';
  switch (a.type) {
    case 'quality': return 'upgrade gem quality';
    case 'place': return `place a gem at ${a.x},${a.y}`;
    case 'keep': return `keep the gem at ${a.x},${a.y}`;
    case 'combine': return `combine ${a.count} at ${a.x},${a.y}`;
    case 'special': return `make a special at ${a.x},${a.y}`;
    case 'upgrade': return `upgrade the tower at ${a.x},${a.y}`;
    case 'buyLife': return 'buy a life';
  }
}
