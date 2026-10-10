/**
 * What one bot game leaves behind for analysis. Kept compact (no move log): a game is fully defined by
 * seed + weights, so anything else can be replayed on demand instead of stored.
 */
import type { Game } from '../game/game';
import { TOWERS } from '../data/gems';
import type { Action } from './bot';
import { AIR_PATH, dpsMaps, exposureOf } from './exposure';
import { blueprintOf, hubPasses, isTowerSpot, type LoadedBlueprint } from './blueprint';
import { GRID } from '../game/config';
import { playBotGame, type BotGameOptions, type GameObserver } from './runner';

export interface GameRecord {
  seed: number;
  weightsId: string;
  result: 'gameover' | 'victory';
  /** level reached (the one it died on, or 50 on victory) */
  level: number;
  lives: number;
  gold: number;
  kills: number;
  qualityLevel: number;
  routeLen: number;
  moves: number;
  score: number;
  /** lives lost in each wave played; index = level - 1 */
  livesLost: number[];
  /** gold when each wave started; index = level - 1 */
  goldAtWave: number[];
  /** fire along the ground route / the flight path when each wave started (sum of dps over path tiles); index = level - 1 */
  exposureGround: number[];
  exposureAir: number[];
  /** with a blueprint: share of the gems placed on each level that went on plan cells; index = level - 1 */
  blueprintAdherence?: number[];
  /** with a blueprint: highest plan order built when each wave started (and how many plan cells stand) */
  blueprintProgress?: number[];
  blueprintBuilt?: number[];
  /** with a blueprint that has a hub: how many times the ground route passed through it when each wave started */
  hubPasses?: number[];
  /** with a blueprint: orders of the slots that got the kept tower */
  blueprintSlotsKept?: number[];
  /** per tower id (as it was at the end of each wave): damage dealt and number of tower-waves on the board */
  towers: Record<string, { dmg: number; waves: number }>;
  /** keep/combine/special decisions, "level:kind:resultId" */
  picks: string[];
  /** tower upgrades, "level:fromId>toId" */
  upgrades: string[];
  /** tower ids on the board at the end */
  final: string[];
}

export const SCORE_FORMULA = 'level + lives × 0.1 + (victory ? 10 : 0)';
export const scoreOf = (r: Pick<GameRecord, 'level' | 'lives' | 'result'>) => r.level + r.lives * 0.1 + (r.result === 'victory' ? 10 : 0);

class Recorder implements GameObserver {
  livesLost: number[] = [];
  goldAtWave: number[] = [];
  exposureGround: number[] = [];
  exposureAir: number[] = [];
  bpPlaced: number[] = [];
  bpOnPlan: number[] = [];
  bpProgress: number[] = [];
  bpBuilt: number[] = [];
  bpSlotsKept: number[] = [];
  hubPasses: number[] = [];
  constructor(private bp: LoadedBlueprint | null) {}
  towers: GameRecord['towers'] = {};
  picks: string[] = [];
  upgrades: string[] = [];
  private pending: { lives: number; gold: number } | null = null;
  private wave: { level: number; lives: number; dmg: Map<number, number> } | null = null;

  beforeMove(game: Game, a: Action) {
    if (a.type === 'keep' || a.type === 'combine' || a.type === 'special') {
      // the choice starts the wave, so this is the last look at the board before it
      this.pending = { lives: game.lives, gold: game.gold };
      const t = game.towerAt(a.x, a.y)!;
      const cell = this.bp?.at.get(a.y * GRID + a.x);
      if (isTowerSpot(cell)) this.bpSlotsKept.push(cell!.order);
      const result = a.type === 'keep' ? t.id : a.type === 'special' ? a.result : game.combineOptions(t).find((o) => o.count === a.count)!.result;
      this.picks.push(`${game.level}:${a.type === 'combine' ? `combine${a.count}` : a.type}:${result}`);
    } else if (a.type === 'place' && this.bp) {
      const i = game.level - 1;
      this.bpPlaced[i] = (this.bpPlaced[i] ?? 0) + 1;
      this.bpOnPlan[i] = (this.bpOnPlan[i] ?? 0) + (this.bp.at.has(a.y * GRID + a.x) ? 1 : 0);
    } else if (a.type === 'upgrade') {
      this.upgrades.push(`${game.level}:${game.towerAt(a.x, a.y)!.id}>${a.target}`);
    }
  }

  afterUpdate(game: Game) {
    if (!this.wave && game.phase === 'wave') {
      const start = this.pending ?? { lives: game.lives, gold: game.gold };
      this.wave = { level: game.level, lives: start.lives, dmg: new Map(game.towers.map((t) => [t.uid, t.damage])) };
      this.goldAtWave[game.level - 1] = start.gold;
      const maps = dpsMaps(game);
      this.exposureGround[game.level - 1] = Math.round(exposureOf(game.route, maps.ground));
      this.exposureAir[game.level - 1] = Math.round(exposureOf(AIR_PATH, maps.air));
      if (this.bp) {
        let top = 0, built = 0;
        for (const c of this.bp.sorted) {
          if (game.towerAt(c.x, c.y) || game.isRock(c.x, c.y)) {
            top = c.order;
            built++;
          }
        }
        this.bpProgress[game.level - 1] = top;
        this.bpBuilt[game.level - 1] = built;
        if (this.bp.hub) this.hubPasses[game.level - 1] = hubPasses(game.route, this.bp.hub);
      }
      this.pending = null;
    } else if (this.wave && game.phase !== 'wave') {
      const w = this.wave;
      this.livesLost[w.level - 1] = w.lives - Math.max(0, game.lives);
      for (const t of game.towers) {
        const s = (this.towers[t.id] ??= { dmg: 0, waves: 0 });
        s.dmg += t.damage - (w.dmg.get(t.uid) ?? 0);
        s.waves++;
      }
      this.wave = null;
    }
  }
}

export function recordBotGame(opts: Omit<BotGameOptions, 'observer'>): GameRecord {
  const rec = new Recorder(opts.weights.blueprintWeight > 0 ? blueprintOf(opts.weights.blueprintId) : null);
  const { game, log } = playBotGame({ ...opts, observer: rec });
  for (const s of Object.values(rec.towers)) s.dmg = Math.round(s.dmg);
  const r = {
    seed: opts.seed,
    weightsId: opts.weights.id,
    result: game.phase as 'gameover' | 'victory',
    level: game.level,
    lives: game.lives,
    gold: game.gold,
    kills: game.stats.kills,
    qualityLevel: game.qualityLevel,
    routeLen: Math.round(game.routeLen * 100) / 100,
    moves: log.length,
    livesLost: rec.livesLost,
    goldAtWave: rec.goldAtWave,
    exposureGround: rec.exposureGround,
    exposureAir: rec.exposureAir,
    ...(rec.bpProgress.length
      ? {
          blueprintAdherence: rec.bpPlaced.map((p, i) => (p ? Math.round((rec.bpOnPlan[i] / p) * 100) / 100 : 0)),
          blueprintProgress: rec.bpProgress,
          blueprintBuilt: rec.bpBuilt,
          blueprintSlotsKept: rec.bpSlotsKept,
          ...(rec.hubPasses.length ? { hubPasses: rec.hubPasses } : {}),
        }
      : {}),
    towers: rec.towers,
    picks: rec.picks,
    upgrades: rec.upgrades,
    final: game.towers.map((t) => t.id).filter((id) => TOWERS[id]),
  };
  return { ...r, score: scoreOf(r) };
}
