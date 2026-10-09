import './style.css';
import { Game } from './game/game';
import { Match } from './net/match';
import { Renderer } from './render/renderer';
import { Panel, type Controls } from './ui/panel';

const STEP = 1 / 60;
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
const panel = new Panel(document.querySelector('#panel')!, getGame, controls, match);

// invite links look like ?room=ABCDE
const room = new URLSearchParams(location.search).get('room');
if (room) {
  match.session.join(room);
  history.replaceState(null, '', location.pathname);
}

renderer.resize();
window.addEventListener('resize', () => renderer.resize());

canvas.addEventListener('pointermove', (e) => {
  renderer.hover = renderer.tileAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointerleave', () => {
  renderer.hover = null;
});
canvas.addEventListener('pointerdown', (e) => {
  const p = renderer.tileAt(e.clientX, e.clientY);
  renderer.hover = p;
  const tower = game.towerAt(p.x, p.y);
  if (tower) {
    game.selected = tower;
  } else if (!game.placeGem(p.x, p.y)) {
    game.selected = null;
  }
  game.touch();
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === ' ') {
    controls.paused = !controls.paused;
    e.preventDefault();
  } else if (e.key === '1' || e.key === '2' || e.key === '4') {
    controls.speed = +e.key;
  } else if (e.key.toLowerCase() === 'i') {
    panel.info.toggle();
  } else if (e.key.toLowerCase() === 'k' && game.selected) {
    game.keep(game.selected);
  } else if (e.key === 'Escape') {
    game.selected = null;
    game.touch();
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
  renderer.draw(game);
  panel.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
