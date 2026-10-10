import './style.css';
import { STEP } from './game/config';
import { Game, type Difficulty } from './game/game';
import { randomSeed } from './game/rng';
import { AutoPlay } from './ai/autoplay';
import { fetchWeights } from './ai/loadWeights';
import { AIR_PATH, exposureOf } from './ai/exposure';
import type { Weights } from './ai/weights';
import { Match } from './net/match';
import { Renderer } from './render/renderer';
import { BoardInput } from './ui/input';
import { Panel, type Controls } from './ui/panel';

const MAX_STEPS_PER_FRAME = 240;
const params0 = () => new URLSearchParams(location.search);
const HEAT_ORDER: Controls['heatmap'][] = ['off', 'ground', 'air'];

let game = new Game();
/** the bot playing the current game, if any; tied to that game instance */
let auto: { game: Game; play: AutoPlay } | null = null;
const getGame = () => game;
const setGame = (g: Game) => {
  game = g;
};
const aiActive = () => (auto && auto.game === game ? auto.play : null);

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const renderer = new Renderer(canvas);
const match = new Match(getGame, setGame);
const controls: Controls = {
  speed: 1,
  paused: false,
  restart: (difficulty) => {
    auto = null;
    setGame(new Game({ difficulty }));
  },
  heatmap: (params0().get('heat') as Controls['heatmap'] | null) ?? 'off',
  showBlueprint: true,
  exposure: () => {
    const m = renderer.heatMaps(game);
    return { ground: exposureOf(game.route, m.ground), air: exposureOf(AIR_PATH, m.air) };
  },
  ai: {
    active: aiActive,
    start: (w: Weights, seed?: number, difficulty?: Difficulty) => {
      const s = seed ?? randomSeed();
      const g = new Game({ seed: s, difficulty: difficulty ?? game.difficulty });
      setGame(g);
      auto = { game: g, play: new AutoPlay(w, s) };
      controls.paused = false;
    },
    stop: () => {
      auto = null;
    },
    load: fetchWeights,
  },
};
const panel = new Panel(document.querySelector('#topbar')!, document.querySelector('#bottom')!, getGame, controls, match);

const params = new URLSearchParams(location.search);
// invite links look like ?room=ABCDE
const room = params.get('room');
if (room) {
  match.session.join(room);
  history.replaceState(null, '', location.pathname);
}
// replay links from batch reports look like ?ai=w3&seed=37 (&difficulty=hard)
const aiSpec = params.get('ai');
if (aiSpec && !room) {
  const seed = params.has('seed') ? +params.get('seed')! : undefined;
  const difficulty = (params.get('difficulty') ?? undefined) as Difficulty | undefined;
  fetchWeights(aiSpec)
    .then((w) => controls.ai.start(w, seed, difficulty))
    .catch((e: Error) => panel.aiError(e.message));
}

renderer.resize();
// the board gets whatever space the top and bottom bars leave, which changes as the bottom bar re-renders
new ResizeObserver(() => renderer.resize()).observe(document.querySelector('.board-wrap')!);

const input = new BoardInput(canvas, renderer, getGame, () => !!aiActive());

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const ai = !!aiActive();
  if (e.key === ' ') {
    controls.paused = !controls.paused;
    e.preventDefault();
  } else if (e.key === '1' || e.key === '2' || e.key === '4' || e.key === '8') {
    controls.speed = +e.key;
  } else if (e.key.toLowerCase() === 'i') {
    panel.info.toggle();
  } else if (e.key.toLowerCase() === 'b') {
    controls.showBlueprint = !controls.showBlueprint;
  } else if (e.key.toLowerCase() === 'h') {
    controls.heatmap = HEAT_ORDER[(HEAT_ORDER.indexOf(controls.heatmap) + 1) % HEAT_ORDER.length];
  } else if (e.key.toLowerCase() === 's') {
    panel.toggleSettings();
  } else if (e.key.toLowerCase() === 'k' && game.selected && !ai) {
    game.keep(game.selected);
  } else if (e.key === 'Escape') {
    if (ai) game.select(null);
    else if (game.teleportSource) game.cancelTeleport();
    else if (game.swapSource) game.cancelSwap();
    else game.select(null);
  } else if ((e.key === 'Delete' || e.key.toLowerCase() === 'r') && game.selectedRock && !ai) {
    game.removeRock(game.selectedRock.x, game.selectedRock.y);
  }
});

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  // versus runs in real time for both players: no pause, no fast-forward
  const versus = match.active;
  if (versus) auto = null;
  const speed = versus ? 1 : controls.speed;
  const ai = aiActive();
  match.update(now);
  if (versus || !controls.paused) {
    try {
      ai?.frame(game, elapsed, speed);
      acc += elapsed * speed;
      let steps = 0;
      while (acc >= STEP && steps++ < MAX_STEPS_PER_FRAME) {
        ai?.beforeUpdate(game);
        game.update(STEP);
        acc -= STEP;
      }
    } catch (e) {
      auto = null;
      panel.aiError((e as Error).message);
    }
  }
  input.update();
  renderer.heatmap = controls.heatmap;
  renderer.blueprint = controls.showBlueprint ? (aiActive()?.bot.blueprint ?? null) : null;
  renderer.draw(game);
  panel.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
