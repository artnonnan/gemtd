import './style.css';
import { STEP } from './game/config';
import { Game } from './game/game';
import { Match } from './net/match';
import { Renderer } from './render/renderer';
import { BoardInput } from './ui/input';
import { Panel, type Controls } from './ui/panel';

const MAX_STEPS_PER_FRAME = 240;

let game = new Game();
const getGame = () => game;
const setGame = (g: Game) => {
  game = g;
};

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const renderer = new Renderer(canvas);
const match = new Match(getGame, setGame);
const controls: Controls = {
  speed: 1,
  paused: false,
  restart: (difficulty) => setGame(new Game({ difficulty })),
};
const panel = new Panel(document.querySelector('#topbar')!, document.querySelector('#bottom')!, getGame, controls, match);

// invite links look like ?room=ABCDE
const room = new URLSearchParams(location.search).get('room');
if (room) {
  match.session.join(room);
  history.replaceState(null, '', location.pathname);
}

renderer.resize();
// the board gets whatever space the top and bottom bars leave, which changes as the bottom bar re-renders
new ResizeObserver(() => renderer.resize()).observe(document.querySelector('.board-wrap')!);

const input = new BoardInput(canvas, renderer, getGame);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === ' ') {
    controls.paused = !controls.paused;
    e.preventDefault();
  } else if (e.key === '1' || e.key === '2' || e.key === '4') {
    controls.speed = +e.key;
  } else if (e.key.toLowerCase() === 'i') {
    panel.info.toggle();
  } else if (e.key.toLowerCase() === 's') {
    panel.toggleSettings();
  } else if (e.key.toLowerCase() === 'k' && game.selected) {
    game.keep(game.selected);
  } else if (e.key === 'Escape') {
    if (game.teleportSource) game.cancelTeleport();
    else if (game.swapSource) game.cancelSwap();
    else game.select(null);
  } else if ((e.key === 'Delete' || e.key.toLowerCase() === 'r') && game.selectedRock) {
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
  const speed = versus ? 1 : controls.speed;
  match.update(now);
  if (versus || !controls.paused) {
    acc += elapsed * speed;
    let steps = 0;
    while (acc >= STEP && steps++ < MAX_STEPS_PER_FRAME) {
      game.update(STEP);
      acc -= STEP;
    }
  }
  input.update();
  renderer.draw(game);
  panel.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
