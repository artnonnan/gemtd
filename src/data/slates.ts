/**
 * Slates (Circle-of-Power units "n0xx" in the map): flat stones creeps can walk over.
 * Recipes and numbers come from the map's "z <Slate>" / "x <Slate> Abilities" tooltips (war3map.w3a).
 */
import { SPECIAL_ABILITIES, SPECIAL_COLORS, TOWERS, type Ability } from './gems';

export interface SlateRecipe {
  result: string;
  /** the selected Normal gem that turns into the slate */
  core: string;
  /** at least one of these must be among the same round's five gems */
  partners: string[];
}

export const SLATE_RECIPES: SlateRecipe[] = [
  { result: 'n000', core: 'h00H', partners: ['h009', 'h00A', 'h00C'] }, // Air: Amethyst + Flawed Emerald/Opal/Ruby
  { result: 'n001', core: 'h00L', partners: ['h008', 'h009', 'h03S'] }, // Slow: Sapphire + Flawed Diamond/Emerald/Aquamarine
  { result: 'n002', core: 'e002', partners: ['h007', 'h00B'] }, // Hold: Topaz + Flawed Amethyst/Sapphire
  { result: 'n004', core: 'h00K', partners: ['e001', 'h00C'] }, // Opal Vein: Opal + Flawed Topaz/Ruby
  { result: 'n008', core: 'h00J', partners: ['e001', 'h00A', 'h03S'] }, // Poison: Emerald + Flawed Topaz/Opal/Aquamarine
  { result: 'n009', core: 'h03R', partners: ['h008', 'h007'] }, // Spell: Aquamarine + Flawed Diamond/Amethyst
  { result: 'n00E', core: 'h00M', partners: ['e001', 'h007', 'h00C'] }, // Range: Ruby + Flawed Topaz/Amethyst/Ruby
  { result: 'n00C', core: 'h00I', partners: ['h00B', 'h00A'] }, // Damage: Diamond + Flawed Sapphire/Opal
];

/** Special slates: combine two slates you own (Combine Special in the map). */
export const SLATE_SPECIALS: { result: string; ingredients: [string, string] }[] = [
  { result: 'n003', ingredients: ['n000', 'n002'] }, // Ancient = Air + Hold
  { result: 'n005', ingredients: ['n001', 'n004'] }, // Wraith = Slow + Opal Vein
  { result: 'n00A', ingredients: ['n009', 'n008'] }, // Elder = Spell + Poison
  { result: 'n00F', ingredients: ['n00E', 'n00C'] }, // Viper = Range + Damage
];

export const SLATE_IDS = new Set([...SLATE_RECIPES.map((r) => r.result), ...SLATE_SPECIALS.map((s) => s.result)]);
export const isSlate = (id: string) => SLATE_IDS.has(id);

/** Teleport (A02J): once per slate, within 2000 range. */
export const SLATE_TELEPORT_RANGE = 2000;

// Hold and Damage slates have no base damage in the map data (it is computed from kills), so the exporter skipped them.
TOWERS.n002 ??= { name: 'Hold Slate', dmg: 0, dice: 0, sides: 1, cd: 2, range: 115, cost: 0, upgrades: [], swap: false, tip: '' };
TOWERS.n00C ??= { name: 'Damage Slate', dmg: 0, dice: 0, sides: 1, cd: 1, range: 600, cost: 0, upgrades: [], swap: false, tip: '' };
// Numbers from the slate tooltips where they differ from the raw unit fields.
Object.assign(TOWERS.n008, { dmg: 49, dice: 1, sides: 1, cd: 0.3 }); // Poison Slate: 50 damage
Object.assign(TOWERS.n00A, { cd: 0.33 }); // Elder Slate
Object.assign(TOWERS.n00F, { dmg: 159, dice: 1, sides: 1 }); // Viper Slate: 160 damage

export const SLATE_ABILITIES: Record<string, Ability> = {
  // Air: 40 damage to anything stepping near it, plus an 850-range attack against air units
  n000: { targets: 'both', airRange: 850 },
  // Slow: permanently slows every unit it hits by 15%
  n001: { targets: 'ground', permSlow: 0.15 },
  // Hold: grabs a walker for 1.5s, 160 + kills x20 damage, 2s rest after each hold
  n002: { targets: 'ground', hold: { dur: 1.5, rest: 2, base: 160, perKill: 20, perLevel: 0, armor: 0 } },
  // Opal Vein: +10% attack speed aura (700)
  n004: { targets: 'both', auraSpeed: { pct: 0.1, range: 700 } },
  // Poison: 50 every 2s for 20s (25 dps), slows 25%
  n008: { targets: 'both', poison: { dps: 25, slow: 0.25, dur: 20 } },
  // Spell: 30% chance per attack to cast a random spell
  n009: { targets: 'both', spells: { chance: 0.3, dmg: 95, radius: 200, armor: 5, armorDur: 15, gold: 3 } },
  // Range: hits every target within 600
  n00E: { targets: 'both', multi: 99 },
  // Damage: (kills x10 + level x20) to a ground unit every second, +10% damage aura (250)
  n00C: { targets: 'ground', killDamage: { perKill: 10, perLevel: 20 }, auraDamage: { pct: 0.1, range: 250 } },
  // Ancient: holds ground or air 2.5s, -12 armor while held, kills x5 + level x50 damage, 2.5s rest
  n003: { targets: 'both', hold: { dur: 2.5, rest: 2.5, base: 0, perKill: 5, perLevel: 50, armor: 12 } },
  // Wraith: clinging flames stack on the same target, burning units explode on death; +20% attack speed aura
  n005: { targets: 'both', stackBurn: { perHit: 35, window: 5, blast: 500, blastRadius: 750 }, auraSpeed: { pct: 0.2, range: 1000 } },
  // Elder: 45% chance to cast stronger spells
  n00A: { targets: 'both', spells: { chance: 0.45, dmg: 250, radius: 250, armor: 7, armorDur: 25, gold: 5 } },
  // Viper: hits everything within 800, 50 dps immolation and +10% damage aura (400)
  n00F: { targets: 'both', multi: 99, burn: { dps: 50, range: 400 }, auraDamage: { pct: 0.1, range: 400 } },
};

/** Two slates conflict when they are the same kind or one is made from the other (the map's anti-stacking rule). */
export function slatesConflict(a: string, b: string): boolean {
  if (a === b) return true;
  return SLATE_SPECIALS.some((s) => (s.result === a && s.ingredients.includes(b)) || (s.result === b && s.ingredients.includes(a)));
}

export const SLATE_COLORS: Record<string, string> = {
  n000: '#b48cff', n001: '#5f9bff', n002: '#ffd23d', n004: '#ffb38a',
  n008: '#3fdc6a', n009: '#3fe0e6', n00E: '#ff5a5a', n00C: '#e8f1ff',
  n003: '#d9a8ff', n005: '#ff8a2a', n00A: '#5ff5d0', n00F: '#9cff3d',
};

Object.assign(SPECIAL_ABILITIES, SLATE_ABILITIES);
Object.assign(SPECIAL_COLORS, SLATE_COLORS);
