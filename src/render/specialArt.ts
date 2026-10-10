/**
 * Hand-made art for individual special towers (ported from demo/example2).
 * Same coordinate system as art.ts: (0,0) = pedestal centre, art units, the renderer scales a pedestal to one tile.
 * Track which towers have art in UPGRADE_ART_LIST.md.
 */
import { hexA, star, type Lod, type TowerAnim } from './art';

// Per-call drawing state, so the ported demo code can stay close to its original form.
let ctx: CanvasRenderingContext2D;
let time = 0;
let flash = 0;
let swing = -1;
let lod: Lod = 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;

interface SpecialArt {
  /** overall scale so tall art still roughly fits its tile */
  scale: number;
  /** where shots and sparkles come from, in art units (before `scale`) */
  topY: number;
  shot?: 'crescent' | 'needle';
  /** projectile size relative to the default */
  shotScale?: number;
  /** attack animation length; the renderer drives `swing` from 0 up to this */
  swingTime?: number;
  /** where the attack animation starts when the game fires (the shot leaves immediately) */
  swingStart?: number;
  /** colour for the ground glow and motes */
  fx: string;
  draw(): void;
}

export const SWING_TIME = 0.5;

// ---------- shared pieces ----------

function metal(x0: number, y0: number, x1: number, y1: number, dark = false) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  if (dark) {
    g.addColorStop(0, '#c9d2e3'); g.addColorStop(0.45, '#8d97ad'); g.addColorStop(1, '#4b5368');
  } else {
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#e3e9f5'); g.addColorStop(0.6, '#aeb8cc'); g.addColorStop(1, '#6f7a92');
  }
  return g;
}

function glowCircle(x: number, y: number, r: number, color: string, a: number) {
  if (lod === 0 && r > 30) r *= 0.7;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexA(color, Math.min(1, a)));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function oct(cx: number, cy: number, r: number, sy: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy);
  }
  ctx.closePath();
}

function drawPedestal(trim: string, rune: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 18, 50, 15, 0, 0, Math.PI * 2); ctx.fill();
  const side = ctx.createLinearGradient(-42, 0, 42, 0);
  side.addColorStop(0, '#353b4b'); side.addColorStop(0.5, '#5a6278'); side.addColorStop(1, '#2f3442');
  ctx.fillStyle = side;
  ctx.fillRect(-42, -4, 84, 18);
  oct(0, 14, 44, 0.38); ctx.fill();
  const top = ctx.createLinearGradient(0, -20, 0, 10);
  top.addColorStop(0, '#727c96'); top.addColorStop(1, '#3a4152');
  ctx.fillStyle = top;
  oct(0, -4, 44, 0.38); ctx.fill();
  ctx.strokeStyle = trim;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-42, 13); ctx.lineTo(42, 13); ctx.stroke();
  if (lod === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hexA(rune, 0.35 + 0.2 * Math.sin(time * 3));
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -4, 30, 10, 0, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 10; i++) {
    const a = time * 0.8 + (i * Math.PI * 2) / 10;
    ctx.fillStyle = hexA(rune, 0.7);
    ctx.beginPath(); ctx.arc(Math.cos(a) * 30, -4 + Math.sin(a) * 10, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ---------- Silver Knight ----------

const SHOULDER = { x: 13, y: -78 };
const ARM_LEN = 22, BLADE = 62;

function knightArm() {
  const rest = 0.55 + Math.sin(time * 1.6) * 0.05;
  if (swing < 0) return rest;
  const t = swing / SWING_TIME;
  if (t < 0.32) return lerp(rest, -1.15, ease(t / 0.32));
  if (t < 0.55) return lerp(-1.15, 1.75, easeIn((t - 0.32) / 0.23));
  return lerp(1.75, rest, ease((t - 0.55) / 0.45));
}

function knightCape(breath: number) {
  const w1 = Math.sin(time * 2.2) * 5, w2 = Math.sin(time * 2.2 + 1.2) * 7;
  ctx.beginPath();
  ctx.moveTo(-14, -82 + breath);
  ctx.quadraticCurveTo(-30 + w1, -50, -34 + w2, -12);
  ctx.quadraticCurveTo(-18, -6 + w1 * 0.4, -4 + w2 * 0.4, -14);
  ctx.quadraticCurveTo(4, -40, 10, -80 + breath);
  ctx.closePath();
  const g = ctx.createLinearGradient(-30, -80, -10, -10);
  g.addColorStop(0, '#2a46a8'); g.addColorStop(1, '#162457');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#ffd84a';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function knightShield(breath: number) {
  ctx.save();
  ctx.translate(-16, -54 + breath);
  ctx.rotate(-0.08 + Math.sin(time * 1.6) * 0.03);
  const kite = (s: number) => {
    ctx.beginPath();
    ctx.moveTo(0, -20 * s);
    ctx.quadraticCurveTo(14 * s, -19 * s, 14 * s, -6 * s);
    ctx.quadraticCurveTo(12 * s, 14 * s, 0, 26 * s);
    ctx.quadraticCurveTo(-12 * s, 14 * s, -14 * s, -6 * s);
    ctx.quadraticCurveTo(-14 * s, -19 * s, 0, -20 * s);
    ctx.closePath();
  };
  kite(1);
  ctx.fillStyle = metal(-14, -20, 14, 26);
  ctx.fill();
  ctx.strokeStyle = '#7d879d';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  kite(0.75);
  ctx.fillStyle = '#2a46a8';
  ctx.fill();
  ctx.fillStyle = '#e8eef8';
  ctx.fillRect(-1.8, -12, 3.6, 28);
  ctx.fillRect(-8, -4, 16, 3.6);
  ctx.restore();
}

function knightLegs(breath: number) {
  for (const [x, lean] of [[-7, -0.06], [7, 0.08]]) {
    ctx.save();
    ctx.translate(x, -30);
    ctx.rotate(lean);
    ctx.fillStyle = metal(-5, 0, 5, 26, true);
    ctx.beginPath(); ctx.roundRect(-5, 0, 10, 26, 3); ctx.fill();
    ctx.fillStyle = metal(-6, 8, 6, 16);
    ctx.beginPath(); ctx.ellipse(0, 12, 6, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = metal(-6, 24, 9, 30, true);
    ctx.beginPath(); ctx.roundRect(-6, 23, 14, 6, 3); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = metal(-16, -40 + breath, 16, -26 + breath);
  ctx.beginPath();
  ctx.moveTo(-15, -40 + breath); ctx.lineTo(15, -40 + breath); ctx.lineTo(18, -26); ctx.lineTo(-18, -26);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#7d879d'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -40 + breath); ctx.lineTo(0, -26); ctx.stroke();
}

function knightTorso(breath: number) {
  const y = breath;
  ctx.beginPath();
  ctx.moveTo(-15, -84 + y);
  ctx.quadraticCurveTo(0, -90 + y, 15, -84 + y);
  ctx.lineTo(13, -56 + y);
  ctx.quadraticCurveTo(0, -36 + y, -13, -56 + y);
  ctx.closePath();
  ctx.fillStyle = metal(-15, -90 + y, 15, -40 + y);
  ctx.fill();
  ctx.strokeStyle = '#7d879d';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath(); ctx.moveTo(0, -86 + y); ctx.lineTo(0, -46 + y); ctx.stroke();
  ctx.fillStyle = '#c9a23a';
  ctx.fillRect(-14, -44 + y, 28, 4);
  glowCircle(0, -68 + y, 16, '#bee1ff', 0.7 * (0.6 + 0.4 * Math.sin(time * 3) + flash));
  ctx.fillStyle = '#a9c8f0';
  ctx.beginPath(); ctx.moveTo(0, -75 + y); ctx.lineTo(6, -68 + y); ctx.lineTo(0, -61 + y); ctx.lineTo(-6, -68 + y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(0, -75 + y); ctx.lineTo(6, -68 + y); ctx.lineTo(0, -68 + y); ctx.lineTo(-6, -68 + y); ctx.closePath(); ctx.fill();
}

function knightPauldron(x: number, y: number, flip: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip, 1);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = metal(-10, -8 + i * 5, 10, 6 + i * 5);
    ctx.beginPath();
    ctx.ellipse(2, -2 + i * 5, 11 - i * 1.5, 7 - i, 0.25, Math.PI, Math.PI * 2.05);
    ctx.lineTo(-8, 4 + i * 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7d879d';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = '#ffd84a';
  ctx.beginPath(); ctx.arc(2, -6, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function knightHelmet(breath: number) {
  const y = breath - 4;
  const sway = Math.sin(time * 2.4) * 4;
  ctx.beginPath();
  ctx.moveTo(0, -112 + y);
  ctx.bezierCurveTo(-8, -126 + y, -26 + sway, -122 + y, -32 + sway, -100 + y);
  ctx.bezierCurveTo(-22 + sway * 0.5, -108 + y, -10, -106 + y, -2, -104 + y);
  ctx.closePath();
  const pg = ctx.createLinearGradient(0, -124 + y, -30, -100 + y);
  pg.addColorStop(0, '#ffffff'); pg.addColorStop(1, '#b9c6dd');
  ctx.fillStyle = pg;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-11, -88 + y);
  ctx.lineTo(-12, -104 + y);
  ctx.quadraticCurveTo(0, -118 + y, 12, -104 + y);
  ctx.lineTo(13, -88 + y);
  ctx.quadraticCurveTo(0, -84 + y, -11, -88 + y);
  ctx.closePath();
  ctx.fillStyle = metal(-12, -116 + y, 13, -86 + y);
  ctx.fill();
  ctx.strokeStyle = '#7d879d';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const glow = Math.min(1, 0.6 + 0.4 * Math.sin(time * 4) + flash);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(150,215,255,${glow})`;
  ctx.fillRect(-1, -104 + y, 12, 2.6);
  ctx.fillRect(4, -104 + y, 2.6, 10);
  ctx.restore();
  glowCircle(6, -102 + y, 12, '#96d7ff', 0.5 * glow);
  ctx.strokeStyle = '#ffd84a';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, -116 + y); ctx.lineTo(0, -106 + y); ctx.stroke();
}

function knightSwordArm(breath: number) {
  const a = knightArm();
  ctx.save();
  ctx.translate(SHOULDER.x, SHOULDER.y + breath);
  ctx.rotate(a);
  ctx.fillStyle = metal(0, -5, ARM_LEN, 5, true);
  ctx.beginPath(); ctx.roundRect(-2, -5, ARM_LEN, 10, 4); ctx.fill();
  ctx.fillStyle = metal(8, -6, 14, 6);
  ctx.beginPath(); ctx.ellipse(10, 0, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(ARM_LEN, 0);
  ctx.fillStyle = '#ffd84a';
  ctx.beginPath(); ctx.arc(0, 9, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3b2a1a';
  ctx.fillRect(-2, -4, 4, 12);
  ctx.fillStyle = metal(-5, -4, 5, 5);
  ctx.beginPath(); ctx.roundRect(-5, -3, 10, 8, 3); ctx.fill();
  ctx.fillStyle = '#ffd84a';
  ctx.beginPath(); ctx.roundRect(-10, -7, 20, 4, 2); ctx.fill();
  const bg = ctx.createLinearGradient(-4, 0, 4, 0);
  bg.addColorStop(0, '#9aa6bd'); bg.addColorStop(0.5, '#ffffff'); bg.addColorStop(1, '#8b96ad');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(-3.6, -7); ctx.lineTo(-3.2, -BLADE + 8); ctx.lineTo(0, -BLADE); ctx.lineTo(3.2, -BLADE + 8); ctx.lineTo(3.6, -7);
  ctx.closePath();
  ctx.fill();
  if (lod > 0) {
    ctx.strokeStyle = 'rgba(120,130,150,0.8)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, -BLADE + 6); ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const run = ((time * 0.8) % 1.4) * BLADE;
    const lg = ctx.createLinearGradient(0, -run + 10, 0, -run - 10);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(220,240,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(-4, -BLADE, 8, BLADE - 7);
    if (flash > 0) { ctx.globalAlpha = flash; star(ctx, 0, -BLADE + 4, 6 * flash, '#ffffff'); }
    ctx.restore();
  }
  ctx.restore();
}

function knightSlash() {
  if (swing < 0) return;
  const t = swing / SWING_TIME;
  if (t < 0.3 || t > 0.8) return;
  const a1 = knightArm(), a0 = Math.max(-1.15, a1 - 1.2);
  const fade = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.25;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(SHOULDER.x, SHOULDER.y);
  const off = Math.atan2(-BLADE, ARM_LEN), R = Math.hypot(ARM_LEN, BLADE);
  const g = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, R + 6);
  g.addColorStop(0, 'rgba(160,215,255,0)');
  g.addColorStop(0.8, `rgba(200,235,255,${0.55 * fade})`);
  g.addColorStop(1, `rgba(255,255,255,${0.9 * fade})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R + 6, a0 + off, a1 + off);
  ctx.arc(0, 0, R * 0.55, a1 + off, a0 + off, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const silverKnight: SpecialArt = {
  scale: 0.72, topY: -100, shot: 'crescent', shotScale: 1, swingTime: SWING_TIME, swingStart: SWING_TIME * 0.3, fx: '#9fd8ff',
  draw() {
    const breath = Math.sin(time * 1.6) * 1.2;
    drawPedestal('#dfe7f5', '#c8e6ff');
    glowCircle(0, -70, 70 + flash * 30, '#d2e6ff', 0.22 + flash * 0.25);
    knightCape(breath);
    knightShield(breath);
    knightPauldron(-14, -82 + breath, -1);
    knightLegs(breath);
    knightTorso(breath);
    knightHelmet(breath);
    knightSlash();
    knightSwordArm(breath);
    knightPauldron(14, -82 + breath, 1);
  },
};

// ---------- Silver ----------

function prism(x: number, h: number, w: number, lean: number, light: string, dark: string, edge: string) {
  ctx.save();
  ctx.translate(x, -6);
  ctx.rotate(lean);
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, -4); ctx.lineTo(w, -h + 6); ctx.lineTo(0, -h - 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-w, -4); ctx.lineTo(-w, -h + 6); ctx.lineTo(0, -h - 8); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h - 8); ctx.stroke();
  ctx.restore();
}

const silver: SpecialArt = {
  scale: 0.85, topY: -92, shot: 'crescent', shotScale: 0.65, fx: '#dfe7f5',
  draw() {
    drawPedestal('#c9d3e6', '#dfe7f5');
    glowCircle(0, -50, 60, '#dfe7f5', 0.18 + flash * 0.25);
    prism(-14, 34, 7, -0.35, '#e9eef8', '#9aa6bd', 'rgba(255,255,255,0.9)');
    prism(15, 30, 7, 0.32, '#dfe6f3', '#8d98af', 'rgba(255,255,255,0.9)');
    prism(0, 56, 10, 0, '#ffffff', '#a7b2c7', 'rgba(255,255,255,1)');
    if (lod > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const sweep = ((time * 0.7) % 1.6) * 70;
      const sg = ctx.createLinearGradient(0, -6 - sweep + 8, 0, -6 - sweep - 8);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.7)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(-10, -70, 20, 64);
      ctx.restore();
    }
    const bob = Math.sin(time * 2) * 4;
    ctx.save();
    ctx.translate(0, -92 + bob);
    ctx.rotate(-0.4 + Math.sin(time * 0.9) * 0.15);
    glowCircle(0, 0, 26, '#e6eeff', 0.45 + flash * 0.4);
    ctx.fillStyle = '#f4f7ff';
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.arc(5, -3, 10, 0, Math.PI * 2, true); ctx.fill('evenodd');
    ctx.restore();
    if (lod > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 2; i++) {
        const a = time * 2 + i * Math.PI;
        star(ctx, Math.cos(a) * 24, -92 + bob + Math.sin(a) * 7, 1.8, '#ffffff');
      }
      ctx.restore();
    }
  },
};

// ---------- Sterling Silver ----------

const SPIN = 0.55;

/** Sword spin over an attack: rise, one full turn, settle. */
function sterlingPose() {
  const hover = Math.sin(time * 1.7) * 3;
  if (swing < 0) return { angle: Math.sin(time * 1.1) * 0.06, lift: hover };
  const t = swing / SPIN;
  const turn = t < 0.15 ? 0 : t < 0.75 ? ease((t - 0.15) / 0.6) : 1;
  const lift = t < 0.15 ? -14 * ease(t / 0.15) : t < 0.75 ? -14 : -14 * (1 - ease((t - 0.75) / 0.25));
  return { angle: turn * Math.PI * 2, lift: lift + hover };
}

/** Ceremonial sterling sword, hilt up, tip down; origin at its balance point. */
function sterlingSword() {
  glowCircle(0, -40, 9, '#9fd8ff', 0.6 + 0.4 * Math.sin(time * 3) + flash * 0.5);
  ctx.fillStyle = metal(-5, -45, 5, -35);
  ctx.beginPath(); ctx.arc(0, -40, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#a9d6ff';
  ctx.beginPath(); ctx.arc(0, -40, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5b6478';
  ctx.fillRect(-2.6, -35, 5.2, 14);
  if (lod > 0) {
    ctx.strokeStyle = '#e3e9f5';
    ctx.lineWidth = 0.9;
    for (let y = -34; y < -21; y += 2.6) { ctx.beginPath(); ctx.moveTo(-2.6, y); ctx.lineTo(2.6, y + 1.6); ctx.stroke(); }
  }
  // crescent-moon crossguard with curled tips
  ctx.fillStyle = metal(-18, -26, 18, -14);
  ctx.beginPath();
  ctx.arc(0, -30, 17, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.arc(0, -34, 15, 0.78 * Math.PI, 0.22 * Math.PI, true);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#7d879d';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  if (lod > 0) {
    ctx.strokeStyle = '#e8eef8';
    ctx.lineWidth = 1.4;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(s * 13, -18, 3, s > 0 ? Math.PI : 0, s > 0 ? Math.PI * 2.6 : -Math.PI * 1.6, s < 0); ctx.stroke();
    }
  }
  const bg = ctx.createLinearGradient(-5, 0, 5, 0);
  bg.addColorStop(0, '#9aa6bd'); bg.addColorStop(0.5, '#ffffff'); bg.addColorStop(1, '#8b96ad');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(-4.4, -17); ctx.lineTo(-3.8, 34); ctx.lineTo(0, 46); ctx.lineTo(3.8, 34); ctx.lineTo(4.4, -17);
  ctx.closePath();
  ctx.fill();
  if (lod === 0) return;
  ctx.strokeStyle = 'rgba(120,130,150,0.8)';
  ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, 36); ctx.stroke();
  ctx.fillStyle = 'rgba(140,200,255,0.75)';
  for (let i = 0; i < 4; i++) ctx.fillRect(-1.2, -8 + i * 10, 2.4, 4);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const run = -17 + ((time * 0.9) % 1.5) * 64;
  const lg = ctx.createLinearGradient(0, run - 10, 0, run + 10);
  lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(225,240,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(-5, -17, 10, 63);
  if (flash > 0) { ctx.globalAlpha = flash; star(ctx, 0, 44, 6 * flash, '#ffffff'); }
  ctx.restore();
}

const sterlingSilver: SpecialArt = {
  scale: 0.85, topY: -84, shot: 'crescent', shotScale: 0.82, swingTime: SPIN, swingStart: SPIN * 0.15, fx: '#cfe0f5',
  draw() {
    drawPedestal('#dfe7f5', '#e6eeff');
    if (lod === 2) {
      // "925" sterling hallmark stamped on the pedestal
      ctx.fillStyle = 'rgba(230,238,255,0.75)';
      ctx.font = '700 8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('925', 0, 11);
      ctx.strokeStyle = 'rgba(230,238,255,0.6)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-9, 3, 18, 10);
    }
    const pose = sterlingPose();
    glowCircle(0, -70 + pose.lift, 64 + flash * 24, '#dfe9ff', 0.2 + flash * 0.3);
    prism(-20, 22, 6, -0.45, '#e3e9f5', '#8f9ab1', 'rgba(255,255,255,0.85)');
    prism(19, 26, 6, 0.4, '#e9eef8', '#97a2b8', 'rgba(255,255,255,0.85)');
    ctx.save();
    ctx.translate(0, -66 + pose.lift);
    ctx.rotate(pose.angle);
    sterlingSword();
    ctx.restore();
    prism(-8, 16, 6, -0.15, '#f4f7ff', '#a3aec4', 'rgba(255,255,255,0.95)');
    prism(9, 13, 5, 0.2, '#f4f7ff', '#a3aec4', 'rgba(255,255,255,0.95)');
    if (lod === 0) return;
    for (let i = 0; i < 2; i++) {
      const a = time * 1.4 + i * Math.PI;
      ctx.save();
      if (Math.sin(a) < 0) ctx.globalAlpha = 0.7; // the moon passing behind the sword is dimmer
      ctx.translate(Math.cos(a) * 30, -78 + pose.lift + Math.sin(a) * 9);
      ctx.rotate(a);
      glowCircle(0, 0, 10, '#e6eeff', 0.5);
      ctx.fillStyle = '#f4f7ff';
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.arc(2.2, -1.2, 4.2, 0, Math.PI * 2, true); ctx.fill('evenodd');
      ctx.restore();
    }
  },
};

// ---------- Malachite ----------

function malOrbPos(i: number) {
  const a = time * 1.3 + (i * Math.PI * 2) / 3;
  return { i, x: Math.cos(a) * 34, y: -62 + Math.sin(a) * 10, depth: Math.sin(a) };
}

function malOrb(o: { x: number; y: number; depth: number }) {
  const r = 6 + o.depth * 1.5;
  glowCircle(o.x, o.y, r * 3 + flash * 10, '#5fffaa', 0.35 + flash * 0.5);
  const g = ctx.createRadialGradient(o.x - 2, o.y - 2, 1, o.x, o.y, r);
  g.addColorStop(0, '#e8fff2'); g.addColorStop(0.5, '#3fdc80'); g.addColorStop(1, '#0d6b3a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2); ctx.fill();
}

const malachite: SpecialArt = {
  scale: 0.9, topY: -62, fx: '#5fffaa',
  draw() {
    drawPedestal('#3fbf7f', '#5fffaa');
    const orbs = [0, 1, 2].map(malOrbPos);
    for (const o of orbs) if (o.depth < 0) malOrb(o);
    ctx.save();
    ctx.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 28 + Math.sin(a * 3 + 1) * 3 + Math.cos(a * 2) * 2;
      ctx.lineTo(Math.cos(a) * r, -38 + Math.sin(a) * r * 1.05);
    }
    ctx.closePath();
    ctx.fillStyle = '#0f5a35';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,30,15,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.clip();
    // concentric malachite banding
    const bands = lod === 0 ? 5 : 9;
    for (let k = bands; k >= 1; k--) {
      ctx.fillStyle = k % 2 ? '#1f9a5a' : '#0d4a2c';
      ctx.beginPath();
      ctx.ellipse(-6 + Math.sin(k) * 2, -30, k * (37 / bands), k * (30 / bands), 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let k = 4; k >= 1; k--) {
      ctx.fillStyle = k % 2 ? '#2fcf6a' : '#0f5a35';
      ctx.beginPath(); ctx.ellipse(12, -52, k * 3.2, k * 2.6, -0.4, 0, Math.PI * 2); ctx.fill();
    }
    const hl = ctx.createLinearGradient(-30, -70, 10, -20);
    hl.addColorStop(0, 'rgba(255,255,255,0.28)'); hl.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(-40, -80, 80, 80);
    ctx.restore();
    glowCircle(-4, -40, 16, '#5fffaa', 0.5 + flash * 0.5);
    ctx.fillStyle = '#c8ffe0';
    ctx.beginPath(); ctx.ellipse(-4, -40, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0d4a2c';
    ctx.beginPath(); ctx.ellipse(-4, -40, 2, 3.6, 0, 0, Math.PI * 2); ctx.fill();
    for (const o of orbs) if (o.depth >= 0) malOrb(o);
  },
};

// ---------- Star Ruby ----------

const starRuby: SpecialArt = {
  scale: 0.9, topY: -64, fx: '#ff6a3d',
  draw() {
    drawPedestal('#ff6a3d', '#ff8a5a');
    const cy = -64 + Math.sin(time * 2.2) * 4;
    glowCircle(0, cy, 60 + flash * 20, '#ff4a2a', 0.45);
    ctx.save();
    ctx.translate(0, cy);
    ctx.rotate(time * 0.5);
    const R1 = 26, R2 = 12;
    for (let i = 0; i < 12; i++) {
      const a0 = (i * Math.PI) / 6, a1 = ((i + 1) * Math.PI) / 6;
      const r0 = i % 2 ? R2 : R1, r1 = i % 2 ? R1 : R2;
      ctx.fillStyle = i % 2 ? '#c2112c' : '#ff3b4e';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a0) * r0, Math.sin(a0) * r0); ctx.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,190,190,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = (i * Math.PI) / 6, r = i % 2 ? R2 : R1;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.restore();
    // asterism: the six-ray star real star rubies show
    ctx.save();
    ctx.translate(0, cy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.rotate(-time * 0.2);
    for (let i = 0; i < 3; i++) {
      ctx.rotate(Math.PI / 3);
      const lg = ctx.createLinearGradient(-30, 0, 30, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, `rgba(255,240,240,${0.8 + flash * 0.2})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(-32, -1, 64, 2);
    }
    star(ctx, 0, 0, 3 + Math.sin(time * 4), '#ffffff');
    ctx.restore();
  },
};

// ---------- Jade ----------

const jade: SpecialArt = {
  scale: 0.85, topY: -66, shot: 'needle', fx: '#6fdc8c',
  draw() {
    drawPedestal('#4fc97a', '#9cffc0');
    const cy = -66 + Math.sin(time * 1.8) * 3;
    const sway = Math.sin(time * 1.8 - 0.6) * 0.12;
    ctx.save();
    ctx.translate(0, cy + 24);
    ctx.rotate(sway);
    ctx.strokeStyle = '#d9b44a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 16); ctx.stroke();
    ctx.fillStyle = '#d9b44a';
    ctx.beginPath(); ctx.arc(0, 17, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c4162a';
    ctx.beginPath(); ctx.moveTo(-4, 19); ctx.lineTo(4, 19); ctx.lineTo(6 + sway * 20, 38); ctx.lineTo(-6 + sway * 20, 38); ctx.closePath(); ctx.fill();
    ctx.restore();
    glowCircle(0, cy, 46, '#4fdc8a', 0.25 + flash * 0.3);
    ctx.save();
    ctx.translate(0, cy);
    ctx.rotate(Math.sin(time * 0.8) * 0.08);
    const g = ctx.createRadialGradient(-8, -8, 4, 0, 0, 26);
    g.addColorStop(0, '#c8f5d6'); g.addColorStop(0.5, '#4fbf7a'); g.addColorStop(1, '#1d6b40');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.arc(0, 0, 9, 0, Math.PI * 2, true); ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(220,255,230,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
    if (lod > 0) {
      ctx.fillStyle = 'rgba(20,80,45,0.55)';
      for (let ring = 0; ring < 2; ring++) {
        const r = 15.5 + ring * 3.5, n = 14 + ring * 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ring * 0.2;
          ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1.1, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();
    const p = 0.6 + 0.4 * Math.sin(time * 3) + flash;
    glowCircle(0, cy, 14, '#b5ffd0', 0.6 * p);
    const pg = ctx.createRadialGradient(-2, cy - 2, 1, 0, cy, 6);
    pg.addColorStop(0, '#ffffff'); pg.addColorStop(1, '#6fdc8c');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(0, cy, 5.5, 0, Math.PI * 2); ctx.fill();
  },
};

/** Tower rawcode -> hand-made art. Keep UPGRADE_ART_LIST.md in sync. */
const SPECIAL_ART: Record<string, SpecialArt> = {
  h033: silverKnight,
  h02O: sterlingSilver,
  h01A: silver,
  h03X: malachite,
  h016: starRuby,
  h018: jade,
};

export const hasSpecialArt = (id: string) => id in SPECIAL_ART;
export const specialShot = (id: string) => SPECIAL_ART[id]?.shot;
/** Gem/weapon height in tiles-art units after scaling, for muzzle sparks and celebrations. */
export const specialTopY = (id: string) => SPECIAL_ART[id].topY * SPECIAL_ART[id].scale;
export const specialShotScale = (id: string) => SPECIAL_ART[id]?.shotScale ?? 1;
/** Where the attack animation starts when the tower fires (-1 = no animation), e.g. Silver Knight jumps to the cut. */
export const specialSwingStart = (id: string) => SPECIAL_ART[id]?.swingStart ?? -1;
export const specialSwingTime = (id: string) => SPECIAL_ART[id]?.swingTime ?? SWING_TIME;

export function drawSpecialArt(c: CanvasRenderingContext2D, id: string, t: number, anim: TowerAnim, level: Lod) {
  const art = SPECIAL_ART[id];
  ctx = c;
  time = t + anim.seed;
  flash = anim.flash;
  swing = anim.swing;
  lod = level;
  c.save();
  c.scale(art.scale, art.scale);
  art.draw();
  c.restore();
}

/** Crescent sword-wave and jade-needle projectiles, drawn in screen pixels. */
export function drawSpecialShot(c: CanvasRenderingContext2D, kind: 'crescent' | 'needle', x: number, y: number, angle: number, size: number) {
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.globalCompositeOperation = 'lighter';
  if (kind === 'needle') {
    const g = c.createLinearGradient(-26 * size, 0, 6 * size, 0);
    g.addColorStop(0, 'rgba(110,230,140,0)');
    g.addColorStop(1, 'rgba(200,255,220,1)');
    c.strokeStyle = g;
    c.lineWidth = Math.max(1.5, 3 * size);
    c.beginPath(); c.moveTo(-26 * size, 0); c.lineTo(6 * size, 0); c.stroke();
    star(c, 6 * size, 0, 2.2 * size, '#ffffff');
  } else {
    c.scale(size, size);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 22);
    g.addColorStop(0, 'rgba(220,240,255,0.6)');
    g.addColorStop(1, 'rgba(220,240,255,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, 22, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(-4, 0, 14, -1.2, 1.2); c.arc(-12, 0, 14, 1.0, -1.0, true); c.closePath(); c.fill();
    c.fillStyle = 'rgba(160,215,255,0.9)';
    c.beginPath(); c.arc(-6, 0, 11, -1.1, 1.1); c.arc(-12, 0, 11, 0.95, -0.95, true); c.closePath(); c.fill();
  }
  c.restore();
}
