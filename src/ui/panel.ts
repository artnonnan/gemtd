import { DIFFICULTIES, type Difficulty, type Game } from '../game/game';
import type { Match } from '../net/match';
import { MiniRenderer } from '../render/mini';
import { InfoModal } from './info';
import {
  GEM_INFO, MAX_QUALITY_LEVEL, QUALITY_CHANCES, QUALITY_NAMES, RECIPES, TOWERS, abilityOf, describeAbility, displayName,
  qualityUpgradeCost, towerColor,
} from '../data/gems';

export interface Controls {
  speed: number;
  paused: boolean;
  restart: (difficulty?: Difficulty) => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const swatch = (id: string) => `<span class="sw" style="background:${towerColor(id)}"></span>`;
const gemLabel = (id: string) => `${swatch(id)}${esc(displayName(id))}`;

export class Panel {
  private stats: HTMLElement;
  private actions: HTMLElement;
  private log: HTMLElement;
  private versusIdle: HTMLElement;
  private versusInfo: HTMLElement;
  private speedControls: HTMLElement;
  private restartBtn: HTMLButtonElement;
  private codeInput: HTMLInputElement;
  private mini: MiniRenderer;
  private miniWrap: HTMLElement;
  private lastActions = '';
  private lastLog = '';
  private lastVersus = '';
  readonly info: InfoModal;

  constructor(root: HTMLElement, private getGame: () => Game, private controls: Controls, private match: Match) {
    root.innerHTML = `
      <header><h1>Gem TD</h1><span class="sub">browser prototype</span><button data-act="info" class="info-btn" title="Gem combining tables (I)">ⓘ Info</button></header>
      <section id="stats" class="stats"></section>
      <section class="row controls">
        <span id="speed-controls" class="row">
          <button data-act="pause">Pause</button>
          <button data-act="speed" data-v="1">1x</button>
          <button data-act="speed" data-v="2">2x</button>
          <button data-act="speed" data-v="4">4x</button>
        </span>
        <button data-act="restart" id="restart" class="ghost">Restart</button>
      </section>
      <section class="card versus">
        <h3>Versus online</h3>
        <div id="vs-idle">
          <p class="muted">Play against a friend: same gems, separate boards, last one standing wins.</p>
          <div class="btns">
            <button data-act="host" class="primary">Host game</button>
            <input id="vs-code" placeholder="CODE" maxlength="5" autocomplete="off" spellcheck="false" />
            <button data-act="join">Join</button>
          </div>
        </div>
        <div id="vs-info"></div>
        <div id="vs-mini" class="mini"><canvas></canvas></div>
      </section>
      <section id="actions"></section>
      <section id="log" class="log"></section>
      <footer>Fan prototype inspired by <em>[BK's] Gem TD</em> by Bryvx (Warcraft III).</footer>`;
    this.stats = root.querySelector('#stats')!;
    this.actions = root.querySelector('#actions')!;
    this.log = root.querySelector('#log')!;
    this.versusIdle = root.querySelector('#vs-idle')!;
    this.versusInfo = root.querySelector('#vs-info')!;
    this.speedControls = root.querySelector('#speed-controls')!;
    this.restartBtn = root.querySelector('#restart')!;
    this.codeInput = root.querySelector('#vs-code')!;
    this.miniWrap = root.querySelector('#vs-mini')!;
    this.mini = new MiniRenderer(this.miniWrap.querySelector('canvas')!);
    this.info = new InfoModal(getGame);
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.codeInput.value.trim()) this.match.session.join(this.codeInput.value);
    });
    // pointerdown instead of click: the action list can re-render mid-click while a wave runs
    root.addEventListener('pointerdown', (e) => this.onAction(e));
  }

  private onAction(e: PointerEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const game = this.getGame();
    const t = game.selected;
    const v = el.dataset.v ?? '';
    switch (el.dataset.act) {
      case 'pause': this.controls.paused = !this.controls.paused; break;
      case 'speed': this.controls.speed = +v; break;
      case 'restart':
        if (!confirm(this.match.active ? 'Restart the match for both players?' : 'Restart the game?')) break;
        if (this.match.active) this.match.start(game.difficulty);
        else this.controls.restart(game.difficulty);
        break;
      case 'difficulty':
        if (this.match.active) this.match.start(v as Difficulty);
        else this.controls.restart(v as Difficulty);
        break;
      case 'host': this.match.session.host(); break;
      case 'join': if (this.codeInput.value.trim()) this.match.session.join(this.codeInput.value); break;
      case 'copy': void navigator.clipboard?.writeText(this.inviteLink()); break;
      case 'leave': this.match.leave(); break;
      case 'info': this.info.toggle(); break;
      case 'quality': game.upgradeQuality(); break;
      case 'life': game.buyLife(); break;
      case 'keep': if (t) game.keep(t); break;
      case 'combine': if (t) game.combine(t, +v as 2 | 4); break;
      case 'special': if (t) game.makeSpecial(t, RECIPES[+v]); break;
      case 'upgrade': if (t) game.upgradeTower(t, v); break;
      case 'select': {
        const uid = +v;
        game.selected = game.towers.find((o) => o.uid === uid) ?? null;
        game.touch();
        break;
      }
    }
    e.preventDefault();
  }

  update() {
    const g = this.getGame();
    const w = g.nextWave;
    this.stats.innerHTML = `
      <div><b>Level</b><span>${g.level}</span></div>
      <div><b>Lives</b><span class="${g.lives <= 10 ? 'warn' : ''}">${g.lives}</span></div>
      <div><b>Gold</b><span class="gold">${g.gold}</span></div>
      <div><b>Kills</b><span>${g.stats.kills}</span></div>
      <div class="wide"><b>${g.phase === 'wave' ? 'Now' : 'Next'}</b><span>${w ? `${esc(w.name)}${w.air ? ' ✈' : ''} · ${w.hp.toLocaleString()} HP · armor ${w.armor}` : '—'}</span></div>
      <div class="wide"><b>Speed</b><span>${this.controls.paused ? 'paused' : `${this.controls.speed}x`} · route ${g.routeLen.toFixed(0)} tiles</span></div>`;

    this.updateVersus();

    const html = this.actionsHtml(g);
    if (html !== this.lastActions) {
      this.actions.innerHTML = html;
      this.lastActions = html;
    }
    const log = g.log.map((m) => `<p>${esc(m)}</p>`).join('');
    if (log !== this.lastLog) {
      this.log.innerHTML = log;
      this.lastLog = log;
    }
  }

  private inviteLink(): string {
    return `${location.origin}${location.pathname}?room=${this.match.session.code}`;
  }

  private updateVersus() {
    const { match } = this;
    const s = match.session;
    const versus = match.active;
    this.versusIdle.hidden = s.status !== 'idle' && s.status !== 'error';
    this.speedControls.hidden = versus;
    this.restartBtn.disabled = versus && !match.isHost;
    this.miniWrap.hidden = !versus;
    if (versus) this.mini.draw(match.remote);

    const lines: string[] = [];
    if (s.status === 'error') lines.push(`<p class="warn">${esc(s.error)}</p>`);
    if (s.status === 'hosting') {
      lines.push(`<p>Room code <b class="code">${s.code}</b></p>
        <p class="muted">Send the code or link to your friend. Waiting for them to join…</p>
        <div class="btns"><button data-act="copy">Copy invite link</button><button data-act="leave" class="ghost">Cancel</button></div>`);
    } else if (s.status === 'connecting') {
      lines.push(`<p>Joining room <b class="code">${esc(s.code)}</b>…</p><div class="btns"><button data-act="leave" class="ghost">Cancel</button></div>`);
    } else if (versus) {
      const op = match.remote?.snap;
      const g = this.getGame();
      lines.push(`<p class="muted">${s.connected ? `Connected · room ${s.code} · you are ${match.isHost ? 'host' : 'guest'}` : 'Disconnected'}</p>`);
      if (op) {
        lines.push(`<div class="vs-row"><span>Opponent</span><span>Lv ${op.level}</span><span class="${op.lives <= 10 ? 'warn' : ''}">♥ ${op.lives}</span><span>${op.kills} kills</span><span class="muted">${op.phase === 'waiting' ? 'ready' : op.phase}</span></div>`);
      }
      if (g.phase === 'waiting') lines.push('<p class="muted">Waiting for opponent to choose…</p>');
      const result = match.result;
      if (result) lines.push(`<p class="result">${esc(result)}</p>`);
      if (match.notice) lines.push(`<p class="warn">${esc(match.notice)}</p>`);
      lines.push(`<div class="btns"><button data-act="leave" class="ghost">Leave match</button></div>`);
    }
    const html = lines.join('');
    if (html !== this.lastVersus) {
      this.versusInfo.innerHTML = html;
      this.lastVersus = html;
    }
  }

  private actionsHtml(g: Game): string {
    const parts: string[] = [];
    parts.push(`<div class="phase phase-${g.phase}">${this.phaseText(g)}</div>`);

    if (g.canChangeDifficulty && (!this.match.active || this.match.isHost)) {
      const opts = (Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => {
        const armor = DIFFICULTIES[d];
        return `<button data-act="difficulty" data-v="${d}" class="${g.difficulty === d ? 'primary' : ''}">${d} <span class="muted">${armor > 0 ? '+' : ''}${armor} armor</span></button>`;
      });
      parts.push(`<div class="card"><h3>Difficulty</h3><div class="btns">${opts.join('')}</div></div>`);
    }

    if (g.phase === 'choose') {
      parts.push('<div class="chips">' + g.freshTowers
        .map((t) => `<button class="chip ${g.selected === t ? 'on' : ''}" data-act="select" data-v="${t.uid}">${gemLabel(t.id)}</button>`)
        .join('') + '</div>');
    }

    const t = g.selected && g.towers.includes(g.selected) ? g.selected : null;
    if (t) {
      const def = TOWERS[t.id];
      const a = abilityOf(t.id);
      const info = GEM_INFO[t.id];
      parts.push(`<div class="card">
        <h3>${gemLabel(t.id)}</h3>
        <p class="muted">${info ? `${QUALITY_NAMES[info.quality]} gem` : 'Special tower'} · kills ${t.kills}</p>
        <p>${a.noAttack ? '' : `Damage ${def.dmg + def.dice}–${def.dmg + def.dice * def.sides} · Cooldown ${def.cd}s · `}Range ${def.range}</p>
        <ul>${describeAbility(a).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>`);

      const btns: string[] = [];
      if (g.phase === 'choose' && t.fresh) {
        btns.push(`<button data-act="keep" class="primary">Keep</button>`);
        for (const o of g.combineOptions(t)) {
          btns.push(`<button data-act="combine" data-v="${o.count}" class="primary">Combine ${o.count} → ${gemLabel(o.result)}</button>`);
        }
        for (const r of g.specialOptions(t)) {
          btns.push(`<button data-act="special" data-v="${RECIPES.indexOf(r)}" class="special">Special → ${gemLabel(r.result)}</button>`);
        }
      }
      for (const u of g.upgradeOptions(t)) {
        btns.push(`<button data-act="upgrade" data-v="${u.id}" ${g.gold < u.cost ? 'disabled' : ''}>Upgrade → ${gemLabel(u.id)} <span class="cost">${u.cost}g</span></button>`);
      }
      if (btns.length) parts.push(`<div class="btns">${btns.join('')}</div>`);
    }

    const ql = g.qualityLevel;
    const chances = QUALITY_CHANCES[ql].map((c, i) => (c ? `${QUALITY_NAMES[i][0]}${c}` : '')).filter(Boolean).join(' ');
    parts.push(`<div class="card mine">
      <h3>Mine</h3>
      <p class="muted">Gem quality Lv ${ql}: ${chances}</p>
      <div class="btns">
        ${ql < MAX_QUALITY_LEVEL
          ? `<button data-act="quality" ${g.gold < qualityUpgradeCost(ql) ? 'disabled' : ''}>Increase gem quality <span class="cost">${qualityUpgradeCost(ql)}g</span></button>`
          : '<button disabled>Gem quality maxed</button>'}
        <button data-act="life" ${g.gold < 10 || g.lives >= 50 ? 'disabled' : ''}>Buy life <span class="cost">10g</span></button>
      </div>
    </div>`);
    return parts.join('');
  }

  private phaseText(g: Game): string {
    switch (g.phase) {
      case 'build': return `Place gems: <b>${g.gemsLeft}</b> left. Click an empty tile — don't block the path.`;
      case 'choose': return 'Pick one gem to <b>Keep</b>, <b>Combine</b> or turn into a <b>Special</b>. The rest become rocks.';
      case 'waiting': return `Level ${g.level} ready — waiting for your opponent to finish choosing.`;
      case 'wave': return `Wave ${g.level} in progress…`;
      case 'gameover': return `<b>Game over</b> on level ${g.level}. Press Restart.`;
      case 'victory': return '<b>Victory!</b> All 50 levels cleared.';
    }
  }

}
