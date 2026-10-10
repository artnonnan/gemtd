/**
 * Headless bot games. Every move is logged with the update step it happened before,
 * so replay() can rebuild the exact same game from seed + log.
 */
import { STEP } from '../game/config';
import { Game, type Difficulty } from '../game/game';
import { Bot, applyAction, type Action } from './bot';
import type { Weights } from './weights';

export interface LoggedAction {
  /** number of game.update(STEP) calls made before this move */
  step: number;
  a: Action;
}

export interface BotGameOptions {
  seed: number;
  difficulty: Difficulty;
  weights: Weights;
  /** sees every move before it is made and the game after every update (the recorder uses this) */
  observer?: GameObserver;
}

export interface GameObserver {
  beforeMove(game: Game, a: Action): void;
  afterUpdate(game: Game): void;
}

/** ~3 hours of game time; no real game comes close */
const MAX_STEPS = (3 * 60 * 60) / STEP;
/** moves allowed between two updates before we call the bot stuck */
const MAX_MOVES_PER_STEP = 200;

export function playBotGame(opts: BotGameOptions): { game: Game; log: LoggedAction[] } {
  const game = new Game({ seed: opts.seed, difficulty: opts.difficulty });
  const bot = new Bot(opts.weights, opts.seed);
  const log: LoggedAction[] = [];
  for (let step = 0; !isOver(game); step++) {
    if (step > MAX_STEPS) throw new Error(`bot game stuck (seed ${opts.seed})`);
    for (let n = 0; ; n++) {
      if (n > MAX_MOVES_PER_STEP) throw new Error(`bot keeps moving without progress (seed ${opts.seed})`);
      const a = bot.nextAction(game);
      if (!a) break;
      opts.observer?.beforeMove(game, a);
      if (!applyAction(game, a)) throw new Error(`game refused bot move ${JSON.stringify(a)} (seed ${opts.seed})`);
      log.push({ step, a });
    }
    game.update(STEP);
    // nothing drains render events headless
    game.events.length = 0;
    opts.observer?.afterUpdate(game);
  }
  return { game, log };
}

/** Rebuilds a game from its seed and move log. */
export function replay(seed: number, difficulty: Difficulty, log: LoggedAction[]): Game {
  const game = new Game({ seed, difficulty });
  let i = 0;
  for (let step = 0; !isOver(game); step++) {
    if (step > MAX_STEPS) throw new Error(`replay stuck (seed ${seed})`);
    while (i < log.length && log[i].step === step) {
      if (!applyAction(game, log[i].a)) throw new Error(`replay diverged at move ${i}: ${JSON.stringify(log[i])}`);
      i++;
    }
    game.update(STEP);
    game.events.length = 0;
  }
  return game;
}

export const isOver = (game: Game) => game.phase === 'gameover' || game.phase === 'victory';
