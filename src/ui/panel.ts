import { DIFFICULTIES, SWAP_COST, type Difficulty, type Game, type RecipeStatus, type Tower } from '../game/game';
import { describeAction, type AutoPlay } from '../ai/autoplay';
import { parseWeights } from '../ai/loadWeights';
import type { Weights } from '../ai/weights';
import type { Match } from '../net/match';
import { MiniRenderer } from '../render/mini';
import type { FocusTile } from '../render/renderer';
import { InfoModal } from './info';
import { SLATE_RECIPES, SLATE_TELEPORT_RANGE, isSlate } from '../data/slates';
import {
  GEM_INFO, MAX_QUALITY_LEVEL, QUALITY_CHANCES, QUALITY_NAMES, RECIPES, TOWERS, abilityOf, describeAbility, displayName,
  qualityUpgradeCost, towerColor,
} from '../data/gems';

export interface Controls {
  speed: number;
  paused: boolean;
  restart: (difficulty?: Difficulty) => void;
  /** fire overlay on the board; exposure() is the current ground / air total for the stats bar */
  heatmap: 'off' | 'ground' | 'air';
  /** draw the AI's maze plan as a ghost on the board */
  showBlueprint: boolean;
  exposure: () => { ground: number; air: number };
  ai: {
    /** the bot playing the current game, or null */
    active: () => AutoPlay | null;
    /** new game with this seed (random when omitted) played by the bot */
    start: (w: Weights, seed?: number, difficulty?: Difficulty) => void;
    stop: () => void;
    load: (spec: string) => Promise<Weights>;
  };
}

/** Panel actions that change the game: refused while the AI plays it. */
const GAME_ACTIONS = new Set([
  'quality', 'life', 'keep', 'combine', 'special', 'upgrade', 'downgrade', 'slate', 'slate-special',
  'teleport', 'cancel-teleport', 'swap', 'cancel-swap', 'remove-rock',
]);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const swatch = (id: string) => `<span class="sw" style="background:${towerColor(id)}"></span>`;
const gemLabel = (id: string) => `${swatch(id)}${esc(displayName(id))}`;

/** Re-render an element only when its markup changed (keeps buttons alive between frames). */
function setHtml(el: HTMLElement, html: string, cache: Map<HTMLElement, string>) {
  if (cache.get(el) === html) return;
  el.innerHTML = html;
  cache.set(el, html);
}

/**
 * HUD: top bar (stats, Info, Settings), bottom bar (gem choice, selected tower, mine, log)
 * and a Settings window (speed, restart, difficulty, versus).
 */
export class Panel {
  readonly info: InfoModal;
  private stats: HTMLElement;
  private bottom: HTMLElement;
  private settings: HTMLElement;
  private gameSettings: HTMLElement;
  private versusIdle: HTMLElement;
  private versusInfo: HTMLElement;
  private codeInput: HTMLInputElement;
  private mini: MiniRenderer;
  private miniWrap: HTMLElement;
  private settingsBtn: HTMLElement;
  private aiWeights: HTMLInputElement;
  private aiSeed: HTMLInputElement;
  private aiFile: HTMLInputElement;
  private aiStatus: HTMLElement;
  private aiMessage = '';
  private html = new Map<HTMLElement, string>();
  /** recipe or choice under the pointer ("special:3", "slate:1", "combine:2") and the gem it was shown for */
  private focus: { key: string; uid: number } | null = null;

  constructor(top: HTMLElement, bottom: HTMLElement, private getGame: () => Game, private controls: Controls, private match: Match) {
    top.innerHTML = `
      <h1>Gem TD</h1>
      <div id="stats" class="stats"></div>
      <div class="top-actions">
        <button data-act="info" title="Gem combining tables (I)">ⓘ <span class="lbl">Info</span></button>
        <button data-act="settings" id="settings-btn" title="Settings (S)">⚙ <span class="lbl">Settings</span></button>
      </div>`;
    this.stats = top.querySelector('#stats')!;
    this.settingsBtn = top.querySelector('#settings-btn')!;
    this.bottom = bottom;

    this.settings = document.createElement('div');
    this.settings.className = 'modal';
    this.settings.hidden = true;
    this.settings.innerHTML = `
      <div class="modal-box settings-box" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="modal-head">
          <h2>Settings</h2>
          <button class="ghost close" data-act="close-settings" aria-label="Close">✕</button>
        </div>
        <div class="modal-body settings-body">
          <section id="game-settings"></section>
          <section class="ai">
            <h3>AI auto-play</h3>
            <p class="muted">Watch the bot play. The same weights and seed replay exactly the game from <code>npm run batch</code>.</p>
            <div class="btns">
              <input id="ai-weights" value="w0" placeholder="w0 / smart / w12" autocomplete="off" spellcheck="false" title="Weight set: w0, smart, or an id from sim-runs/weights (npm run dev only)" />
              <input id="ai-seed" placeholder="seed: random" inputmode="numeric" autocomplete="off" title="Seed (empty = random)" />
              <button data-act="ai-start" class="primary">▶ AI play</button>
              <button data-act="ai-file" title="Load a weight set from a JSON file">JSON file…</button>
              <input id="ai-file" type="file" accept=".json,application/json" hidden />
            </div>
            <div id="ai-status"></div>
          </section>
          <section class="versus">
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
          <p class="muted credit">Fan prototype inspired by <em>[BK's] Gem TD</em> by Bryvx (Warcraft III).</p>
        </div>
      </div>`;
    document.body.appendChild(this.settings);
    this.gameSettings = this.settings.querySelector('#game-settings')!;
    this.versusIdle = this.settings.querySelector('#vs-idle')!;
    this.versusInfo = this.settings.querySelector('#vs-info')!;
    this.codeInput = this.settings.querySelector('#vs-code')!;
    this.miniWrap = this.settings.querySelector('#vs-mini')!;
    this.mini = new MiniRenderer(this.miniWrap.querySelector('canvas')!);
    this.info = new InfoModal(getGame);
    this.aiWeights = this.settings.querySelector('#ai-weights')!;
    this.aiSeed = this.settings.querySelector('#ai-seed')!;
    this.aiFile = this.settings.querySelector('#ai-file')!;
    this.aiStatus = this.settings.querySelector('#ai-status')!;
    this.aiFile.addEventListener('change', () => {
      const f = this.aiFile.files?.[0];
      if (!f) return;
      void f.text().then((text) => {
        try {
          this.startAi(parseWeights(text, f.name.replace(/\.json$/i, '')));
        } catch (e) {
          this.aiError(`${f.name}: ${(e as Error).message}`);
        }
        this.aiFile.value = '';
      });
    });
    for (const el of [this.aiWeights, this.aiSeed]) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void this.loadAndStartAi();
      });
    }

    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.codeInput.value.trim()) this.match.session.join(this.codeInput.value);
    });
    this.settings.addEventListener('pointerdown', (e) => {
      if (e.target === this.settings) this.toggleSettings(false);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.settings.hidden && e.key === 'Escape') {
        this.toggleSettings(false);
        e.stopImmediatePropagation();
      }
    }, true);
    // pointerdown instead of click: the bottom bar can re-render mid-click while a wave runs
    for (const root of [top, bottom, this.settings]) root.addEventListener('pointerdown', (e) => this.onAction(e));
    // pointing at a recipe or a choice highlights its gems on the board (on touch, a tap keeps it lit)
    bottom.addEventListener('pointerover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-focus]');
      const t = this.getGame().selected;
      this.focus = el && t ? { key: el.dataset.focus!, uid: t.uid } : null;
    });
    bottom.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.focus = null;
    });
  }

  /** Gems the pointed-at recipe or choice would use, for the board highlight. */
  focusTiles(): FocusTile[] | null {
    const g = this.getGame();
    const t = g.selected;
    if (!this.focus || !t || t.uid !== this.focus.uid || !g.towers.includes(t)) return null;
    const [kind, v] = this.focus.key.split(':');
    const self: FocusTile = { tower: t, state: 'self' };
    switch (kind) {
      case 'special': {
        const parts = g.recipeStatus(RECIPES[+v], t).parts.filter((p) => p.tower && p.tower !== t);
        return [self, ...parts.map((p) => ({ tower: p.tower!, state: p.state }))];
      }
      case 'slate': {
        const partner = g.slatePartner(t, SLATE_RECIPES[+v]);
        return partner ? [self, { tower: partner, state: 'fresh' }] : [self];
      }
      case 'combine':
        return [self, ...g.combineParts(t, +v as 2 | 4).map((o): FocusTile => ({ tower: o, state: 'fresh' }))];
    }
    return null;
  }

  toggleSettings(open = this.settings.hidden) {
    this.settings.hidden = !open;
  }

  /** Shown in the AI section (and opens Settings so it is seen). */
  aiError(msg: string) {
    this.aiMessage = msg;
    this.toggleSettings(true);
  }

  private async loadAndStartAi() {
    try {
      this.startAi(await this.controls.ai.load(this.aiWeights.value));
    } catch (e) {
      this.aiError((e as Error).message);
    }
  }

  private startAi(w: Weights, seed?: number) {
    const typed = this.aiSeed.value.trim();
    if (seed === undefined && typed && !/^\d+$/.test(typed)) return this.aiError('seed must be a whole number');
    this.aiMessage = '';
    this.controls.ai.start(w, seed ?? (typed ? +typed : undefined));
    this.toggleSettings(false);
  }

  private replayLink(ai: AutoPlay): string {
    const g = this.getGame();
    return `${location.origin}${location.pathname}?ai=${encodeURIComponent(ai.weights.id)}&seed=${ai.seed}${g.difficulty !== 'normal' ? `&difficulty=${g.difficulty}` : ''}`;
  }

  private aiStatusHtml(): string {
    const ai = this.controls.ai.active();
    const msg = this.aiMessage ? `<p class="warn">${esc(this.aiMessage)}</p>` : '';
    if (this.match.active) return '<p class="muted">Not available during a versus match.</p>';
    if (!ai) return msg;
    const speedBtn = (n: number) => `<button data-act="speed" data-v="${n}" class="${!this.controls.paused && this.controls.speed === n ? 'primary' : ''}">${n}x</button>`;
    const plan = ai.bot.blueprint;
    return `${msg}<p>🤖 Playing <b>${esc(ai.weights.id)}</b>${ai.weights.source ? ` <span class="muted">(${esc(ai.weights.source)})</span>` : ''} · seed <b>${ai.seed}</b> · ${ai.moves} moves</p>
      ${plan ? `<p>Maze plan <b>${esc(plan.id)}</b> <span class="muted">${esc(plan.style)}</span> <button data-act="blueprint" class="${this.controls.showBlueprint ? 'primary' : ''}">${this.controls.showBlueprint ? 'Hide plan (B)' : 'Show plan (B)'}</button></p>` : ''}
      <div class="btns">
        <button data-act="ai-stop">■ Stop AI</button>
        <button data-act="ai-replay" title="Same weights, same seed: the same game again">↺ Replay</button>
        <button data-act="ai-seed" title="Copy a link that replays this game">🔗 Copy link</button>
        ${[1, 4, 8, 16].map(speedBtn).join('')}
      </div>`;
  }

  private onAction(e: PointerEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const game = this.getGame();
    const t = game.selected;
    const v = el.dataset.v ?? '';
    const ai = this.controls.ai.active();
    if (ai && GAME_ACTIONS.has(el.dataset.act!)) {
      e.preventDefault();
      return;
    }
    switch (el.dataset.act) {
      case 'heatmap': this.controls.heatmap = v as Controls['heatmap']; break;
      case 'blueprint': this.controls.showBlueprint = !this.controls.showBlueprint; break;
      case 'ai-start': void this.loadAndStartAi(); break;
      case 'ai-file': this.aiFile.click(); break;
      case 'ai-stop': this.controls.ai.stop(); break;
      case 'ai-replay': if (ai) this.startAi(ai.weights, ai.seed); break;
      case 'ai-seed':
        if (ai) void navigator.clipboard?.writeText(this.replayLink(ai));
        break;
      case 'info': this.info.toggle(); break;
      case 'settings': this.toggleSettings(); break;
      case 'close-settings': this.toggleSettings(false); break;
      case 'pause': this.controls.paused = !this.controls.paused; break;
      case 'speed': this.controls.speed = +v; this.controls.paused = false; break;
      case 'restart':
        if (!confirm(this.match.active ? 'Restart the match for both players?' : 'Restart the game?')) break;
        if (this.match.active) this.match.start(game.difficulty);
        else this.controls.restart(game.difficulty);
        this.toggleSettings(false);
        break;
      case 'difficulty':
        if (this.match.active) this.match.start(v as Difficulty);
        else this.controls.restart(v as Difficulty);
        break;
      case 'host': this.match.session.host(); break;
      case 'join': if (this.codeInput.value.trim()) this.match.session.join(this.codeInput.value); break;
      case 'copy': void navigator.clipboard?.writeText(this.inviteLink()); break;
      case 'leave': this.match.leave(); break;
      case 'quality': game.upgradeQuality(); break;
      case 'life': game.buyLife(); break;
      case 'keep': if (t) game.keep(t); break;
      case 'combine': if (t) game.combine(t, +v as 2 | 4); break;
      case 'special': if (t) game.makeSpecial(t, RECIPES[+v]); break;
      case 'upgrade': if (t) game.upgradeTower(t, v); break;
      case 'downgrade': if (t) game.keepDowngraded(t); break;
      case 'slate': if (t) game.createSlate(t, SLATE_RECIPES[+v]); break;
      case 'slate-special': if (t) game.combineSlates(t, v); break;
      case 'teleport': if (t) game.beginTeleport(t); break;
      case 'cancel-teleport': game.cancelTeleport(); break;
      case 'swap': if (t) game.beginSwap(t); break;
      case 'cancel-swap': game.cancelSwap(); break;
      case 'remove-rock': if (game.selectedRock) game.removeRock(game.selectedRock.x, game.selectedRock.y); break;
      case 'select': {
        const uid = +v;
        game.select(game.towers.find((o) => o.uid === uid) ?? null);
        break;
      }
      default: return;
    }
    e.preventDefault();
  }

  update() {
    const g = this.getGame();
    setHtml(this.stats, this.statsHtml(g), this.html);
    setHtml(this.bottom, this.bottomHtml(g), this.html);
    // game buttons look disabled while the AI plays (onAction refuses them anyway)
    this.bottom.classList.toggle('ai-lock', !!this.controls.ai.active());
    const s = this.match.session.status;
    this.settingsBtn.classList.toggle('badge', this.match.active || s === 'hosting' || s === 'connecting');
    if (!this.settings.hidden) {
      setHtml(this.gameSettings, this.gameSettingsHtml(g), this.html);
      setHtml(this.aiStatus, this.aiStatusHtml(), this.html);
      this.updateVersus();
    }
  }

  // ---------- top bar ----------

  private statsHtml(g: Game): string {
    const w = g.nextWave;
    const op = this.match.active ? this.match.remote?.snap : undefined;
    const paused = !this.match.active && this.controls.paused;
    const ai = this.controls.ai.active();
    return `
      <div class="stat"><b>Level</b><span>${g.level}</span></div>
      <div class="stat"><b>Lives</b><span class="${g.lives <= 10 ? 'warn' : ''}">${g.lives}</span></div>
      <div class="stat"><b>Gold</b><span class="gold">${g.gold}</span></div>
      <div class="stat"><b>Kills</b><span>${g.stats.kills}</span></div>
      <div class="stat next"><b>${g.phase === 'wave' ? 'Now' : 'Next'}</b><span>${w ? `${esc(w.name)}${w.air ? ' ✈' : ''} <small>${w.hp.toLocaleString()} HP · armor ${w.armor}</small>` : '—'}</span></div>
      ${op ? `<div class="stat vs"><b>Opponent</b><span>Lv ${op.level} · <span class="${op.lives <= 10 ? 'warn' : ''}">♥ ${op.lives}</span></span></div>` : ''}
      ${paused ? '<div class="stat paused"><span>⏸ Paused</span></div>' : !this.match.active && this.controls.speed !== 1 ? `<div class="stat"><span>${this.controls.speed}x</span></div>` : ''}
      ${ai ? `<div class="stat ai"><b>AI</b><span>🤖 ${esc(ai.weights.id)} · #${ai.seed}</span></div>` : ''}
      ${this.controls.heatmap !== 'off' ? this.exposureStat() : ''}`;
  }

  private exposureStat(): string {
    const e = this.controls.exposure();
    const on = this.controls.heatmap;
    return `<div class="stat ai" title="Sum of tower dps over every path tile: roughly the damage one creep takes on the way"><b>Exposure</b><span>` +
      `<span class="${on === 'ground' ? 'gold' : 'muted'}">ground ${Math.round(e.ground).toLocaleString()}</span> · ` +
      `<span class="${on === 'air' ? 'gold' : 'muted'}">air ${Math.round(e.air).toLocaleString()}</span></span></div>`;
  }

  // ---------- bottom bar ----------

  private bottomHtml(g: Game): string {
    const choose: string[] = [`<div class="phase phase-${g.phase}">${this.phaseText(g)}</div>`];
    if (g.phase === 'gameover' || g.phase === 'victory') {
      choose.push(`<div class="btns"><button data-act="restart" class="primary">Restart</button></div>`);
    }
    const result = this.match.result;
    if (result) choose.push(`<p class="result">${esc(result)}</p>`);
    if (g.phase === 'choose') {
      choose.push('<div class="chips">' + g.freshTowers
        .map((t) => `<button class="chip ${g.selected === t ? 'on' : ''}" data-act="select" data-v="${t.uid}">${gemLabel(t.id)}</button>`)
        .join('') + '</div>');
    }

    if (g.teleportSource) {
      choose.push(`<div class="phase phase-choose">✦ Teleport ${gemLabel(g.teleportSource.id)}: click an empty tile inside the circle. Esc to cancel.</div>`);
    }
    if (g.swapSource) {
      choose.push(`<div class="phase phase-choose">⇄ Swap ${gemLabel(g.swapSource.id)}: click another kept gem or a rock. Esc to cancel.</div>`);
    }
    const rock = g.selectedRock;
    if (rock && g.isRock(rock.x, rock.y)) {
      choose.push(`<div class="selected">
        <div class="sel-head"><h3>Rock</h3><span class="muted">tile ${rock.x}, ${rock.y}</span></div>
        <p class="muted">Mazing rock. Removing it is free and opens the tile for building.</p>
        <div class="btns"><button data-act="remove-rock">Remove rock</button></div>
      </div>`);
    }

    const t = g.selected && g.towers.includes(g.selected) ? g.selected : null;
    if (t) {
      const def = TOWERS[t.id];
      const a = abilityOf(t.id);
      const info = GEM_INFO[t.id];
      const btns: string[] = [];
      if (g.phase === 'choose' && t.fresh) {
        btns.push(`<button data-act="keep" class="primary">Keep</button>`);
        const lower = g.downgradeOption(t);
        if (lower) btns.push(`<button data-act="downgrade" title="Keep this gem one quality lower (Downgrade)">Keep ↓ ${gemLabel(lower)}</button>`);
        for (const o of g.combineOptions(t)) {
          btns.push(`<button data-act="combine" data-v="${o.count}" data-focus="combine:${o.count}" class="primary">Combine ${o.count} → ${gemLabel(o.result)}</button>`);
        }
        for (const r of g.specialOptions(t)) {
          const i = RECIPES.indexOf(r);
          btns.push(`<button data-act="special" data-v="${i}" data-focus="special:${i}" class="special">Special → ${gemLabel(r.result)}</button>`);
        }
        for (const r of g.slateOptions(t)) {
          const i = SLATE_RECIPES.indexOf(r);
          btns.push(`<button data-act="slate" data-v="${i}" data-focus="slate:${i}" class="slate" title="Turn this gem into a slate creeps can walk over">Create slate → ${gemLabel(r.result)}</button>`);
        }
      }
      for (const o of g.slateSpecialOptions(t)) {
        btns.push(`<button data-act="slate-special" data-v="${o.result}" class="special" title="Uses your ${esc(displayName(o.partner.id))}">Combine → ${gemLabel(o.result)}</button>`);
      }
      if (g.teleportSource === t) {
        btns.push(`<button data-act="cancel-teleport" class="slate">Cancel teleport</button>`);
      } else if (g.canTeleport(t)) {
        btns.push(`<button data-act="teleport" class="slate" title="Move this slate once, within ${SLATE_TELEPORT_RANGE} range">✦ Teleport</button>`);
      }
      for (const u of g.upgradeOptions(t)) {
        btns.push(`<button data-act="upgrade" data-v="${u.id}" ${g.gold < u.cost ? 'disabled' : ''}>Upgrade → ${gemLabel(u.id)} <span class="cost">${u.cost}g</span></button>`);
      }
      if (g.swapSource === t) {
        btns.push(`<button data-act="cancel-swap" class="special">Cancel swap</button>`);
      } else if (g.canSwap(t)) {
        btns.push(`<button data-act="swap" ${g.gold < SWAP_COST ? 'disabled' : ''} title="Swap position with another gem or a rock (once per tower)">⇄ Swap <span class="cost">${SWAP_COST}g</span></button>`);
      }
      choose.push(`<div class="selected">
        <div class="sel-head"><h3>${gemLabel(t.id)}</h3><span class="muted">${info ? `${QUALITY_NAMES[info.quality]} gem` : isSlate(t.id) ? 'Slate · creeps walk over it · click it again to build a gem on top' : 'Special tower'} · ${t.kills} kills</span></div>
        <p class="muted">${a.noAttack ? '' : `Damage ${def.dmg + def.dice}–${def.dmg + def.dice * def.sides} · Cooldown ${def.cd}s · `}Range ${def.range}${describeAbility(a).length ? ' · ' + esc(describeAbility(a).join(' · ')) : ''}</p>
        ${btns.length ? `<div class="btns">${btns.join('')}</div>` : ''}
        ${this.usesHtml(g, t)}
      </div>`);
    }

    const ql = g.qualityLevel;
    const chances = QUALITY_CHANCES[ql].map((c, i) => (c ? `${QUALITY_NAMES[i][0]}${c}` : '')).filter(Boolean).join(' ');
    const mine = `<div class="card mine">
      <h3>Mine</h3>
      <p class="muted">Quality Lv ${ql}: ${chances}</p>
      <div class="btns">
        ${ql < MAX_QUALITY_LEVEL
          ? `<button data-act="quality" ${g.gold < qualityUpgradeCost(ql) ? 'disabled' : ''}>Gem quality + <span class="cost">${qualityUpgradeCost(ql)}g</span></button>`
          : '<button disabled>Quality maxed</button>'}
        <button data-act="life" ${g.gold < 10 || g.lives >= 50 ? 'disabled' : ''}>Buy life <span class="cost">10g</span></button>
      </div>
    </div>`;
    const log = `<div class="card log">${g.log.slice(0, 4).map((m) => `<p>${esc(m)}</p>`).join('')}</div>`;
    return `<div class="card choose">${choose.join('')}</div>${mine}${log}`;
  }

  /** Special recipes this gem goes into: which ingredients are kept, placed this round, or still missing. */
  private usesHtml(g: Game, t: Tower): string {
    const rows = RECIPES.filter((r) => r.ingredients.includes(t.id))
      .map((r) => g.recipeStatus(r, t))
      .sort((a, b) => +b.ready - +a.ready || b.owned / b.parts.length - a.owned / a.parts.length);
    if (!rows.length) return '';
    const row = (s: RecipeStatus) => `<div class="use ${s.ready ? 'ready' : ''}" data-focus="special:${RECIPES.indexOf(s.recipe)}">
        <span class="res">${s.ready ? '★ ' : ''}${gemLabel(s.recipe.result)}</span>
        <span class="parts">${s.parts.map((p) => `<span class="ing ${p.state}">${gemLabel(p.id)}</span>`).join('<span class="plus">+</span>')}</span>
        <span class="count">${s.owned}/${s.parts.length}</span>
      </div>`;
    return `<div class="uses">
        <div class="uses-head">Specials with this gem <span class="ing kept">kept</span><span class="ing fresh">this round</span><span class="ing missing">missing</span></div>
        ${rows.map(row).join('')}
      </div>`;
  }

  private phaseText(g: Game): string {
    const ai = this.controls.ai.active();
    if (ai && g.phase !== 'gameover' && g.phase !== 'victory') {
      const last = describeAction(ai.lastAction);
      return `🤖 AI <b>${esc(ai.weights.id)}</b> is playing${last ? ` — ${esc(last)}` : ''}. Click towers to inspect them; Settings to stop.`;
    }
    switch (g.phase) {
      case 'build': return `Place gems: <b>${g.gemsLeft}</b> left — tap an empty tile, don't block the path.`;
      case 'choose': return 'Pick one gem to <b>Keep</b>, <b>Combine</b> or turn into a <b>Special</b>. The rest become rocks.';
      case 'waiting': return `Level ${g.level} ready — waiting for your opponent to finish choosing.`;
      case 'wave': return `Wave ${g.level} in progress… Select a tower to see or upgrade it.`;
      case 'gameover': return `<b>Game over</b> on level ${g.level}.`;
      case 'victory': return '<b>Victory!</b> All 50 levels cleared.';
    }
  }

  // ---------- settings ----------

  private gameSettingsHtml(g: Game): string {
    const versus = this.match.active;
    const parts: string[] = ['<h3>Game</h3>'];
    if (versus) {
      parts.push('<p class="muted">Speed and pause are locked during a versus match.</p>');
    } else {
      const speedBtn = (n: number) => `<button data-act="speed" data-v="${n}" class="${!this.controls.paused && this.controls.speed === n ? 'primary' : ''}">${n}x</button>`;
      parts.push(`<div class="btns">
        <button data-act="pause" class="${this.controls.paused ? 'primary' : ''}">${this.controls.paused ? '▶ Resume' : '⏸ Pause'}</button>
        ${[1, 2, 4].map(speedBtn).join('')}
      </div>`);
    }
    parts.push(`<div class="btns"><button data-act="restart" ${versus && !this.match.isHost ? 'disabled' : ''}>Restart</button></div>`);

    const canChange = g.canChangeDifficulty && (!versus || this.match.isHost);
    const opts = (Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => {
      const armor = DIFFICULTIES[d];
      return `<button data-act="difficulty" data-v="${d}" class="${g.difficulty === d ? 'primary' : ''}" ${canChange ? '' : 'disabled'}>${d} <span class="muted">${armor > 0 ? '+' : ''}${armor} armor</span></button>`;
    });
    parts.push(`<h3>Difficulty</h3><div class="btns">${opts.join('')}</div>`);
    if (!canChange) parts.push('<p class="muted">Difficulty can only change before the first gem is placed (host only in versus).</p>');
    const heat = (v: Controls['heatmap'], label: string) => `<button data-act="heatmap" data-v="${v}" class="${this.controls.heatmap === v ? 'primary' : ''}">${label}</button>`;
    parts.push(`<h3>Fire heatmap</h3><div class="btns">${heat('off', 'Off')}${heat('ground', '🔥 Ground')}${heat('air', '✈ Air')}</div>`);
    parts.push('<p class="muted">Shows the dps reaching each tile: does the creep path run through the hot zones or around them?</p>');
    parts.push('<p class="muted">Keys: Space pause · 1/2/4/8 speed · K keep · R/Del remove selected rock · H heatmap · B AI maze plan · Esc cancel · I info · S settings</p>');
    return parts.join('');
  }

  private inviteLink(): string {
    return `${location.origin}${location.pathname}?room=${this.match.session.code}`;
  }

  private updateVersus() {
    const { match } = this;
    const s = match.session;
    const versus = match.active;
    this.versusIdle.hidden = s.status !== 'idle' && s.status !== 'error';
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
      lines.push(`<p class="muted">${s.connected ? `Connected · room ${s.code} · you are ${match.isHost ? 'host' : 'guest'}` : 'Disconnected'}</p>`);
      if (op) {
        lines.push(`<div class="vs-row"><span>Opponent</span><span>Lv ${op.level}</span><span class="${op.lives <= 10 ? 'warn' : ''}">♥ ${op.lives}</span><span>${op.kills} kills</span><span class="muted">${op.phase === 'waiting' ? 'ready' : op.phase}</span></div>`);
      }
      const result = match.result;
      if (result) lines.push(`<p class="result">${esc(result)}</p>`);
      if (match.notice) lines.push(`<p class="warn">${esc(match.notice)}</p>`);
      lines.push(`<div class="btns"><button data-act="leave" class="ghost">Leave match</button></div>`);
    }
    setHtml(this.versusInfo, lines.join(''), this.html);
  }
}
