import { SWAP_COST, type Game } from '../game/game';
import { SLATE_RECIPES, SLATE_SPECIALS, SLATE_STACK_RANGE, SLATE_TELEPORT_RANGE } from '../data/slates';
import {
  BASE_GEMS, GEM_TYPES, GREAT, PERFECT, QUALITY_NAMES, RECIPES, TOWERS, abilityOf, describeAbility, displayName, towerColor,
} from '../data/gems';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const swatch = (id: string) => `<span class="sw" style="background:${towerColor(id)}"></span>`;
const label = (id: string) => `${swatch(id)}${esc(displayName(id))}`;
const dmgText = (id: string) => {
  const d = TOWERS[id];
  return d.dmg + d.dice === 0 ? '—' : `${d.dmg + d.dice}–${d.dmg + d.dice * d.sides}`;
};

type Tab = 'combine' | 'specials' | 'slates' | 'upgrades';

/** Full-screen reference overlay: combine rules, special recipes and upgrade trees. */
export class InfoModal {
  private root: HTMLElement;
  private body: HTMLElement;
  private tab: Tab = 'specials';

  constructor(private getGame: () => Game) {
    this.root = document.createElement('div');
    this.root.className = 'modal';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true" aria-label="Gem info">
        <div class="modal-head">
          <h2>Gem info</h2>
          <div class="tabs">
            <button data-tab="combine">Combine</button>
            <button data-tab="specials">Special recipes</button>
            <button data-tab="slates">Slates</button>
            <button data-tab="upgrades">Upgrade paths</button>
          </div>
          <button class="ghost close" data-close aria-label="Close">✕</button>
        </div>
        <div class="modal-body"></div>
      </div>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector('.modal-body')!;
    this.root.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const tab = el.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (tab) this.show(tab);
      else if (el === this.root || el.closest('[data-close]')) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.root.hidden && e.key === 'Escape') {
        this.close();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.show(this.tab);
  }

  show(tab: Tab) {
    this.tab = tab;
    this.root.hidden = false;
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    this.body.innerHTML =
      tab === 'combine' ? this.combineHtml() : tab === 'specials' ? this.specialsHtml() : tab === 'slates' ? this.slatesHtml() : this.upgradesHtml();
    this.body.scrollTop = 0;
  }

  close() {
    this.root.hidden = true;
  }

  private combineHtml(): string {
    const head = QUALITY_NAMES.map((q) => `<th>${q}</th>`).join('');
    const rows = GEM_TYPES.map((type) => {
      const cells = BASE_GEMS[type].map((id) => `<td title="${esc(describeAbility(abilityOf(id)).join(' · '))}">${dmgText(id)}<small>${TOWERS[id].range}</small></td>`).join('');
      const ability = describeAbility(abilityOf(BASE_GEMS[type][0])).join(', ') || 'Fast attack';
      return `<tr><th class="gem">${swatch(BASE_GEMS[type][0])}${type[0].toUpperCase() + type.slice(1)}</th>${cells}<td class="note">${esc(ability)}</td></tr>`;
    }).join('');
    return `
      <ul class="rules">
        <li><b>2 identical gems</b> (same type and quality) → combine into the next quality, e.g. 2× Chipped Ruby → Flawed Ruby.</li>
        <li><b>4 identical gems</b> → jump two qualities, e.g. 4× Flawed Ruby → Flawless Ruby.</li>
        <li><b>${QUALITY_NAMES[GREAT]}</b> gems come from 4× ${QUALITY_NAMES[PERFECT - 1]} or 4× ${QUALITY_NAMES[PERFECT]} (2× ${QUALITY_NAMES[PERFECT]} cannot combine).</li>
        <li>Only gems placed <b>this round</b> combine. The others turn into rocks.</li>
        <li><b>Keep ↓</b> (Downgrade): keep a Flawed–Perfect gem one quality lower. Handy when a recipe needs the lower one.</li>
        <li><b>Rocks</b> can be removed for free at any time. Select one and press Remove (or R).</li>
        <li><b>Swap</b> (${SWAP_COST}g, once per tower, renewed on upgrade): Black Opal, Gold, Fire Star, Lucky China Jade and other advanced towers can trade places with another kept gem or a rock.</li>
      </ul>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th></th>${head}<th>Ability</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="muted">Cells show damage, with range underneath. Hover a cell for that gem's exact ability.</p>`;
  }

  private specialsHtml(): string {
    const game = this.getGame();
    const rows = RECIPES.map((r) => {
      const s = game.recipeStatus(r, game.selected);
      const parts = s.parts.map((p) => `<span class="ing ${p.state}">${label(p.id)}</span>`);
      return `<tr class="${s.ready ? 'ready' : ''}">
        <td class="res">${s.ready ? '★ ' : ''}${label(r.result)}</td>
        <td>${parts.join('<span class="plus">+</span>')}</td>
        <td class="count">${s.owned}/${r.ingredients.length}</td>
        <td class="note">${esc(describeAbility(abilityOf(r.result)).join(', '))}</td>
      </tr>`;
    }).join('');
    return `
      <ul class="rules">
        <li>Have every ingredient on the board, with at least one placed <b>this round</b>, then select one and press <b>Special</b>.</li>
        <li>The other ingredients turn into rocks, and their kills carry over to the new tower.</li>
        <li><span class="ing kept">green</span> = kept on the board · <span class="ing fresh">gold</span> = placed this round (a rock unless you use it) · ★ = can be made now.</li>
      </ul>
      <div class="table-wrap"><table class="recipes-table">
        <thead><tr><th>Special</th><th>Ingredients</th><th>Have</th><th>Ability</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  private slatesHtml(): string {
    const have = new Set(this.getGame().towers.map((t) => t.id));
    const ing = (id: string) => `<span class="ing ${have.has(id) ? 'have' : ''}">${label(id)}</span>`;
    const basic = SLATE_RECIPES.map((r) => `<tr>
        <td class="res">${label(r.result)}</td>
        <td>${ing(r.core)}<span class="plus">+</span>${r.partners.map(ing).join('<span class="plus">or</span>')}</td>
        <td class="note">${esc(describeAbility(abilityOf(r.result)).join(', ') || `${TOWERS[r.result].dmg + TOWERS[r.result].dice} damage`)}</td>
      </tr>`).join('');
    const special = SLATE_SPECIALS.map((s) => `<tr>
        <td class="res">${label(s.result)}</td>
        <td>${s.ingredients.map(ing).join('<span class="plus">+</span>')}</td>
        <td class="note">${esc(describeAbility(abilityOf(s.result)).join(', '))}</td>
      </tr>`).join('');
    return `
      <ul class="rules">
        <li>Slates lie flat on the ground: <b>creeps walk over them</b>, so put them right on the path. They do not block the maze, and a gem can be built on top of one (select the slate, then click it again); the slate keeps working underneath.</li>
        <li>To create one: among this round's 5 gems, select the <b>Normal</b> gem and have one of its <b>Flawed</b> partners placed too, then press <b>Create slate</b>. The other gems become rocks.</li>
        <li>Two slates combine into a <b>special slate</b> at any time (the partner slate is used up).</li>
        <li><b>Teleport</b>: each slate can move once, within ${SLATE_TELEPORT_RANGE} range, to any spot in half-tile steps (between tiles, under gems or rocks). Slates of the same kind (or their combination) cannot sit within ${SLATE_STACK_RANGE} of each other.</li>
      </ul>
      <h3>Basic slates</h3>
      <div class="table-wrap"><table class="recipes-table">
        <thead><tr><th>Slate</th><th>Normal gem + Flawed partner</th><th>Ability</th></tr></thead>
        <tbody>${basic}</tbody>
      </table></div>
      <h3 style="margin-top:14px">Special slates</h3>
      <div class="table-wrap"><table class="recipes-table">
        <thead><tr><th>Slate</th><th>Slates</th><th>Ability</th></tr></thead>
        <tbody>${special}</tbody>
      </table></div>`;
  }

  private upgradesHtml(): string {
    const roots = [...RECIPES.map((r) => r.result), ...GEM_TYPES.map((t) => BASE_GEMS[t][GREAT])];
    const tree = (id: string, seen: Set<string>): string => {
      const next = TOWERS[id].upgrades.filter((u) => TOWERS[u] && !seen.has(u));
      if (!next.length) return '';
      const s = new Set(seen).add(id);
      return `<ul>${next.map((u) => `<li>${label(u)} <span class="cost">${TOWERS[u].cost}g</span> <span class="dmg">dmg ${dmgText(u)}</span>${tree(u, s)}</li>`).join('')}</ul>`;
    };
    const blocks = roots.map((id) => `<div class="tree"><div class="tree-root">${label(id)} <span class="dmg">dmg ${dmgText(id)}</span></div>${tree(id, new Set([id])) || '<p class="muted">no upgrades</p>'}</div>`).join('');
    return `
      <ul class="rules">
        <li>Select a kept special or Great gem and press <b>Upgrade</b>. The gold cost is shown next to each step.</li>
        <li>Fire Star's "Copy gem" step is not in the prototype yet.</li>
      </ul>
      <div class="trees">${blocks}</div>`;
  }
}
