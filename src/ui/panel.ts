import { DIFFICULTIES, type Difficulty, type Game } from '../game/game';
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
  private lastActions = '';
  private lastLog = '';

  constructor(root: HTMLElement, private getGame: () => Game, private controls: Controls) {
    root.innerHTML = `
      <header><h1>Gem TD</h1><span class="sub">browser prototype</span></header>
      <section id="stats" class="stats"></section>
      <section class="row controls">
        <button data-act="pause">Pause</button>
        <button data-act="speed" data-v="1">1x</button>
        <button data-act="speed" data-v="2">2x</button>
        <button data-act="speed" data-v="4">4x</button>
        <button data-act="restart" class="ghost">Restart</button>
      </section>
      <section id="actions"></section>
      <details class="recipes"><summary>Special recipes</summary>${this.recipesHtml()}</details>
      <section id="log" class="log"></section>
      <footer>Fan prototype inspired by <em>[BK's] Gem TD</em> by Bryvx (Warcraft III).</footer>`;
    this.stats = root.querySelector('#stats')!;
    this.actions = root.querySelector('#actions')!;
    this.log = root.querySelector('#log')!;
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
      case 'restart': if (confirm('Restart the game?')) this.controls.restart(game.difficulty); break;
      case 'difficulty': this.controls.restart(v as Difficulty); break;
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

  private actionsHtml(g: Game): string {
    const parts: string[] = [];
    parts.push(`<div class="phase phase-${g.phase}">${this.phaseText(g)}</div>`);

    if (g.canChangeDifficulty) {
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
      case 'wave': return `Wave ${g.level} in progress…`;
      case 'gameover': return `<b>Game over</b> on level ${g.level}. Press Restart.`;
      case 'victory': return '<b>Victory!</b> All 50 levels cleared.';
    }
  }

  private recipesHtml(): string {
    return '<ul>' + RECIPES.map((r) => `<li>${gemLabel(r.result)} = ${r.ingredients.map(gemLabel).join(' + ')}</li>`).join('') + '</ul>';
  }
}
