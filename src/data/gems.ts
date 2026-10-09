import towersJson from './towers.json';
import wavesJson from './waves.json';

/** Tower stats exported from the original map's war3map.w3u (see w3x/export_towers.py). */
export interface TowerDef {
  name: string;
  dmg: number;
  dice: number;
  sides: number;
  /** attack cooldown in seconds */
  cd: number;
  /** range in Warcraft III units */
  range: number;
  /** gold needed to upgrade INTO this tower */
  cost: number;
  upgrades: string[];
  /** has the map's "Swap" ability (A05L) */
  swap: boolean;
  tip: string;
}

export interface CreepDef {
  id: string;
  name: string;
  hp: number;
  /** Warcraft III units per second */
  speed: number;
  armor: number;
  bounty: number;
  /** lives taken when it reaches the mine */
  lives: number;
  air: boolean;
}

export const TOWERS = towersJson as Record<string, TowerDef>;
export const WAVES = (wavesJson as { classic: CreepDef[] }).classic;

// Data quirks of the source map that would wreck early balance.
TOWERS.h005.cd = 0.8; // Chipped Ruby has a 0.1s cooldown in the map data

export const GEM_TYPES = ['diamond', 'sapphire', 'emerald', 'ruby', 'opal', 'amethyst', 'topaz', 'aquamarine'] as const;
export type GemType = (typeof GEM_TYPES)[number];

export const QUALITY_NAMES = ['Chipped', 'Flawed', 'Normal', 'Flawless', 'Perfect', 'Great'] as const;
export const PERFECT = 4;
export const GREAT = 5;

/** Rawcodes per gem type, indexed by quality (Chipped..Perfect, Great). */
export const BASE_GEMS: Record<GemType, string[]> = {
  diamond: ['h000', 'h008', 'h00I', 'h00O', 'h00Y', 'h031'],
  sapphire: ['h001', 'h00B', 'h00L', 'h00Q', 'h00W', 'h02Z'],
  emerald: ['h002', 'h009', 'h00J', 'h00S', 'h00U', 'h032'],
  ruby: ['h005', 'h00C', 'h00M', 'h00R', 'h00T', 'h02Y'],
  opal: ['h003', 'h00A', 'h00K', 'h00P', 'h00X', 'h030'],
  amethyst: ['h004', 'h007', 'h00H', 'h00N', 'h00V', 'h02X'],
  topaz: ['e000', 'e001', 'e002', 'e003', 'e004', 'e005'],
  aquamarine: ['h03T', 'h03S', 'h03R', 'h03U', 'h03V', 'h03W'],
};

export const GEM_COLORS: Record<GemType, string> = {
  diamond: '#e8f1ff',
  sapphire: '#3d7bff',
  emerald: '#2fcf6a',
  ruby: '#ff3b4e',
  opal: '#ffb38a',
  amethyst: '#b05cff',
  topaz: '#ffd23d',
  aquamarine: '#3fe0e6',
};

export interface GemInfo {
  type: GemType;
  quality: number;
}

/** Reverse lookup rawcode -> base gem info. Specials are not in here. */
export const GEM_INFO: Record<string, GemInfo> = {};
for (const type of GEM_TYPES) {
  BASE_GEMS[type].forEach((id, quality) => (GEM_INFO[id] = { type, quality }));
}

/** "Increase Gem Quality" chances (%), from war3map.w3q R000. Columns: Chipped..Perfect. */
export const QUALITY_CHANCES: number[][] = [
  [100, 0, 0, 0, 0],
  [70, 30, 0, 0, 0],
  [60, 30, 10, 0, 0],
  [50, 30, 20, 0, 0],
  [40, 30, 20, 10, 0],
  [30, 30, 30, 10, 0],
  [20, 30, 30, 20, 0],
  [10, 30, 30, 30, 0],
  [0, 30, 30, 30, 10],
];
export const MAX_QUALITY_LEVEL = QUALITY_CHANCES.length - 1;
export const qualityUpgradeCost = (level: number) => 20 + 30 * level;

export interface Recipe {
  result: string;
  ingredients: string[];
}

/** Level-1 special towers (from the "z <Special>" ability tooltips in war3map.w3a). */
export const RECIPES: Recipe[] = [
  { result: 'h01A', ingredients: ['h001', 'h000', 'e000'] }, // Silver
  { result: 'h03X', ingredients: ['h003', 'h002', 'h03T'] }, // Malachite
  { result: 'h016', ingredients: ['h004', 'h005', 'h00C'] }, // Star Ruby
  { result: 'h018', ingredients: ['h00J', 'h00K', 'h00B'] }, // Jade
  { result: 'h029', ingredients: ['h00S', 'h00M', 'h007'] }, // Red Crystal
  { result: 'h017', ingredients: ['h00Y', 'e002', 'h00I'] }, // Pink Diamond
  { result: 'h01N', ingredients: ['h00U', 'h00Q', 'e001'] }, // Dark Emerald
  { result: 'h014', ingredients: ['h00W', 'e003', 'h00R'] }, // Yellow Sapphire
  { result: 'h01O', ingredients: ['h00T', 'h03U', 'h00H'] }, // Blood Stone
  { result: 'h019', ingredients: ['e004', 'h00A', 'h00L'] }, // Uranium 238
  { result: 'h01B', ingredients: ['h00V', 'h00N', 'h008'] }, // Gold
  { result: 'h015', ingredients: ['h00X', 'h00O', 'h03R'] }, // Black Opal
  { result: 'h040', ingredients: ['h03V', 'h00P', 'h009', 'h03S'] }, // Paraiba Tourmaline
];

export type Targets = 'ground' | 'air' | 'both';

export interface Ability {
  targets: Targets;
  /** chance (0..1) to deal mult x damage */
  crit?: { chance: number; mult: number };
  /** splash radius (wc3 units); secondary targets take 50% */
  splash?: number;
  /** number of targets per attack */
  multi?: number;
  slow?: { pct: number; dur: number };
  poison?: { dps: number; slow: number; dur: number };
  stun?: { chance: number; dur: number };
  /** immolation-style damage to every valid enemy in range, optionally slowing */
  burn?: { dps: number; range: number; slow?: number };
  auraSpeed?: { pct: number; range: number };
  auraDamage?: { pct: number; range: number };
  armorAura?: { amount: number; range: number; targets: Targets };
  /** armor removed from the victim on hit (5s) */
  shred?: number;
  nova?: { chance: number; dmg: number; radius: number };
  /** chance per attack to earn floor(level/2) gold */
  luckyGold?: number;
  noAttack?: boolean;

  // ---- slate abilities ----
  /** separate (longer) attack range against air units */
  airRange?: number;
  /** permanent speed reduction, applied once per creep per slate */
  permSlow?: number;
  /** grab one enemy: stun `dur`, deal base + kills*perKill + level*perLevel, reduce armor while held, then rest */
  hold?: { dur: number; rest: number; base: number; perKill: number; perLevel: number; armor: number };
  /** chance per attack to cast one random spell: area damage, armor reduction, or gold */
  spells?: { chance: number; dmg: number; radius: number; armor: number; armorDur: number; gold: number };
  /** attack damage = kills*perKill + level*perLevel */
  killDamage?: { perKill: number; perLevel: number };
  /** extra damage stacking per consecutive hit on the same unit; burning units explode on death */
  stackBurn?: { perHit: number; window: number; blast: number; blastRadius: number };
}

const q = <T>(arr: T[], quality: number) => arr[Math.min(quality, arr.length - 1)];

function baseGemAbility({ type, quality }: GemInfo): Ability {
  switch (type) {
    case 'diamond':
      return { targets: 'ground', crit: { chance: 0.25, mult: quality === GREAT ? 5 : 2 } };
    case 'sapphire':
      return { targets: 'both', slow: { pct: q([0.1, 0.15, 0.2, 0.25, 0.3, 0.4], quality), dur: 2 } };
    case 'emerald':
      return {
        targets: 'both',
        poison: {
          dps: q([2, 3, 5, 8, 16, 50], quality),
          slow: q([0.15, 0.2, 0.25, 0.3, 0.5, 0.5], quality),
          dur: q([3, 4, 5, 6, 8, 10], quality),
        },
      };
    case 'ruby':
      return quality === GREAT ? { targets: 'both', multi: 3 } : { targets: 'both', splash: q([100, 120, 140, 160, 200], quality) };
    case 'opal':
      return {
        targets: 'both',
        auraSpeed: { pct: q([0.1, 0.15, 0.2, 0.25, 0.3, 0.5], quality), range: q([600, 700, 800, 900, 1000, 1500], quality) },
      };
    case 'amethyst':
      return quality === GREAT
        ? { targets: 'air', armorAura: { amount: 6, range: 1000, targets: 'both' } }
        : { targets: 'air' };
    case 'topaz':
      return { targets: 'both', multi: q([2, 2, 3, 3, 4, 6], quality) };
    case 'aquamarine':
      return quality === GREAT ? { targets: 'both', auraSpeed: { pct: 0.1, range: 600 } } : { targets: 'both' };
  }
}

/** Hand-written abilities; data/slates.ts adds the slates here (kept one-way to avoid an import cycle). */
export const SPECIAL_ABILITIES: Record<string, Ability> = {
  h01A: { targets: 'both', splash: 250, slow: { pct: 0.2, dur: 2 } }, // Silver
  h02O: { targets: 'both', splash: 300, slow: { pct: 0.25, dur: 2 } }, // Sterling Silver
  h033: { targets: 'both', splash: 350, slow: { pct: 0.3, dur: 2 } }, // Silver Knight
  h03X: { targets: 'both', multi: 3 }, // Malachite
  h03Y: { targets: 'both', multi: 4 }, // Vivid Malachite
  h03Z: { targets: 'both', multi: 99 }, // Mighty Malachite
  h016: { targets: 'both', burn: { dps: 40, range: 265 } }, // Star Ruby
  h02M: { targets: 'both', burn: { dps: 60, range: 350 } }, // Star
  e006: { targets: 'both', burn: { dps: 130, range: 600 } }, // Fire Star
  h018: { targets: 'both', poison: { dps: 5, slow: 0.5, dur: 2 } }, // Jade
  h02L: { targets: 'both', poison: { dps: 10, slow: 0.5, dur: 3 } }, // China Jade
  h035: {
    targets: 'both',
    poison: { dps: 10, slow: 0.5, dur: 4 },
    crit: { chance: 0.05, mult: 8 },
    stun: { chance: 0.01, dur: 2 },
    luckyGold: 0.01,
  }, // Lucky China Jade
  h029: { targets: 'air', armorAura: { amount: 4, range: 1300, targets: 'air' } }, // Red Crystal
  h02J: { targets: 'air', armorAura: { amount: 5, range: 1400, targets: 'air' } }, // Red Facet
  h02Q: { targets: 'air', armorAura: { amount: 6, range: 1500, targets: 'air' }, burn: { dps: 50, range: 1500 } }, // Rose Quartz
  h017: { targets: 'ground', crit: { chance: 0.1, mult: 5 } }, // Pink Diamond
  h02P: { targets: 'ground', crit: { chance: 0.2, mult: 20 } }, // Great Pink Diamond
  h01N: { targets: 'both', stun: { chance: 0.125, dur: 1.5 } }, // Dark Emerald
  h02V: { targets: 'both', stun: { chance: 0.125, dur: 1.5 }, crit: { chance: 0.25, mult: 8 } }, // Enchanted Emerald
  h014: { targets: 'both', splash: 400, slow: { pct: 0.3, dur: 2 } }, // Yellow Sapphire
  h02R: { targets: 'both', splash: 400, slow: { pct: 0.3, dur: 2 }, auraDamage: { pct: 0.2, range: 1200 } }, // Star Yellow Sapphire
  h01O: { targets: 'both', splash: 400, burn: { dps: 60, range: 500 } }, // Blood Stone
  h02U: { targets: 'both', splash: 400, burn: { dps: 60, range: 500 }, crit: { chance: 0.1, mult: 10 } }, // Ancient Blood Stone
  h019: { targets: 'both', noAttack: true, burn: { dps: 200, range: 500, slow: 0.5 } }, // Uranium 238
  h02N: { targets: 'both', burn: { dps: 70, range: 900 } }, // Uranium 235
  h01B: { targets: 'both', crit: { chance: 0.25, mult: 2 }, shred: 5 }, // Gold
  h02W: { targets: 'both', crit: { chance: 0.3, mult: 2 }, shred: 8 }, // Egyptian Gold
  h015: { targets: 'both', auraDamage: { pct: 0.3, range: 1000 } }, // Black Opal
  h02K: { targets: 'both', auraDamage: { pct: 0.4, range: 1200 } }, // Mystic Black Opal
  h040: { targets: 'both', armorAura: { amount: 4, range: 600, targets: 'ground' }, nova: { chance: 0.2, dmg: 250, radius: 250 } }, // Paraiba
  h041: { targets: 'both', armorAura: { amount: 5, range: 700, targets: 'ground' }, nova: { chance: 0.2, dmg: 350, radius: 250 } }, // Paraiba Facet
};

/** Fallback for mod-tier towers: read the effect out of the tooltip text. */
function abilityFromTooltip(tip: string): Ability {
  const a: Ability = { targets: 'both' };
  const crit = /(\d+)% Chance to do (\d+)x/i.exec(tip);
  if (crit) a.crit = { chance: +crit[1] / 100, mult: +crit[2] };
  const dmgAura = /(\d+)% (?:more )?damage (?:aura|to all)|increases? (\d+)% damage/i.exec(tip);
  if (dmgAura) a.auraDamage = { pct: +(dmgAura[1] ?? dmgAura[2]) / 100, range: 1200 };
  const spd = /(\d+)% attack speed/i.exec(tip);
  if (spd) a.auraSpeed = { pct: +spd[1] / 100, range: 1200 };
  const armor = /-(\d+) armor aura/i.exec(tip);
  if (armor) a.armorAura = { amount: +armor[1], range: 1000, targets: 'both' };
  return a;
}

const abilityCache: Record<string, Ability> = {};
export function abilityOf(id: string): Ability {
  if (!abilityCache[id]) {
    abilityCache[id] =
      SPECIAL_ABILITIES[id] ?? (GEM_INFO[id] ? baseGemAbility(GEM_INFO[id]) : abilityFromTooltip(TOWERS[id]?.tip ?? ''));
  }
  return abilityCache[id];
}

export function describeAbility(a: Ability): string[] {
  const out: string[] = [];
  if (a.noAttack) out.push('No direct attack');
  if (a.targets !== 'both') out.push(`Attacks ${a.targets} only`);
  if (a.crit) out.push(`${Math.round(a.crit.chance * 100)}% chance for ${a.crit.mult}x damage`);
  if (a.splash) out.push(`Splash ${a.splash}`);
  if (a.multi) out.push(a.multi >= 99 ? 'Hits all targets in range' : `Hits ${a.multi} targets`);
  if (a.slow) out.push(`Slows ${Math.round(a.slow.pct * 100)}% for ${a.slow.dur}s`);
  if (a.poison) out.push(`Poison ${a.poison.dps} dps, slow ${Math.round(a.poison.slow * 100)}% (${a.poison.dur}s)`);
  if (a.stun) out.push(`${a.stun.chance * 100}% chance to stun ${a.stun.dur}s`);
  if (a.burn) out.push(`Burns ${a.burn.dps} dps within ${a.burn.range}${a.burn.slow ? `, slows ${a.burn.slow * 100}%` : ''}`);
  if (a.auraSpeed) out.push(`+${Math.round(a.auraSpeed.pct * 100)}% attack speed aura (${a.auraSpeed.range})`);
  if (a.auraDamage) out.push(`+${Math.round(a.auraDamage.pct * 100)}% damage aura (${a.auraDamage.range})`);
  if (a.armorAura) out.push(`-${a.armorAura.amount} armor to ${a.armorAura.targets} enemies (${a.armorAura.range})`);
  if (a.shred) out.push(`-${a.shred} armor on hit`);
  if (a.nova) out.push(`${a.nova.chance * 100}% chance: frost nova ${a.nova.dmg} dmg`);
  if (a.luckyGold) out.push(`${a.luckyGold * 100}% chance to earn gold`);
  if (a.airRange) out.push(`Hits air units up to ${a.airRange} away`);
  if (a.permSlow) out.push(`Permanently slows each unit it hits by ${Math.round(a.permSlow * 100)}%`);
  if (a.hold) {
    const dmg = [a.hold.base ? `${a.hold.base}` : '', a.hold.perKill ? `kills×${a.hold.perKill}` : '', a.hold.perLevel ? `level×${a.hold.perLevel}` : ''].filter(Boolean).join(' + ');
    out.push(`Holds a unit ${a.hold.dur}s for ${dmg} damage${a.hold.armor ? `, -${a.hold.armor} armor` : ''}; rests ${a.hold.rest}s`);
  }
  if (a.spells) out.push(`${Math.round(a.spells.chance * 100)}% chance to cast: ${a.spells.dmg} area damage, -${a.spells.armor} armor or +${a.spells.gold} gold`);
  if (a.killDamage) out.push(`Damage = kills×${a.killDamage.perKill} + level×${a.killDamage.perLevel}`);
  if (a.stackBurn) out.push(`Flames add +${a.stackBurn.perHit} per repeated hit; burning units explode for ${a.stackBurn.blast}`);
  return out;
}

export function displayName(id: string): string {
  return TOWERS[id]?.name ?? id;
}

export function towerColor(id: string): string {
  const info = GEM_INFO[id];
  if (info) return GEM_COLORS[info.type];
  return SPECIAL_COLORS[id] ?? '#ffcf4a';
}

export const SPECIAL_COLORS: Record<string, string> = {
  h01A: '#cfd8e3', h02O: '#dfe7f0', h033: '#f3f7ff',
  h03X: '#3fbf7f', h03Y: '#2fe08f', h03Z: '#1fff9f',
  h016: '#ff6a3d', h02M: '#ff8a3d', e006: '#ff5a1f',
  h018: '#6fdc8c', h02L: '#4fc97a', h035: '#9cff6a',
  h029: '#ff4f6d', h02J: '#ff6f8d', h02Q: '#ff9fb8',
  h017: '#ff8fd0', h02P: '#ff5fc0',
  h01N: '#127a3a', h02V: '#0fa84a',
  h014: '#ffe86a', h02R: '#fff08a',
  h01O: '#a0101e', h02U: '#d01030',
  h019: '#9cff3d', h02N: '#c8ff3d',
  h01B: '#ffc21a', h02W: '#ffd84a',
  h015: '#3a3046', h02K: '#5a3a7a',
  h040: '#00d6c8', h041: '#00f0e0',
};

export const isSpecial = (id: string) => !GEM_INFO[id] || GEM_INFO[id].quality === GREAT;
