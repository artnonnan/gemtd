# Upgrade Art List

Tracks which special towers and Great gems have their own hand-made art.

Towers without their own art still have a look: [src/render/art.ts](src/render/art.ts) draws a pedestal with a floating faceted gem in the tower's colour. Its tier comes from how far up the upgrade line the tower sits.

**Progress: 5 / 63 towers have their own art.**

## How to add art for a tower

1. Prototype it in [demo/example2/index.html](demo/example2/index.html): add an object to `KINDS` (`draw`, `attack`, `range`, colours). Its attack must follow the tower's real ability (see Info → Special recipes in the game, or `SPECIAL_ABILITIES` in [src/data/gems.ts](src/data/gems.ts)).
2. Port it into [src/render/specialArt.ts](src/render/specialArt.ts):
   - Write a `SpecialArt` object with `scale`, `topY`, `fx`, an optional `shot`, and `draw()`.
   - Register it in `SPECIAL_ART` under the tower's rawcode.
3. Run `npm run render-smoke` and `npm run build`.
4. Mark the tower ✅ below and update the progress count.

Legend: ✅ done · ⬜ todo · Tier = step in its upgrade line

## Special towers

### Silver line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h01A` | Silver | 1 | recipe | ✅ done | 3 silver crystal spires + floating crescent moon; crescent shot, frost splash |
| `h02O` | Sterling Silver | 2 | Silver | ⬜ todo | |
| `h033` | Silver Knight | 3 | Sterling Silver | ✅ done | White-silver knight (fixed facing right), sword swing + crescent sword wave, frost splash |
| `h030` | Great Opal | 4 | Silver Knight / Mighty Malachite | ⬜ todo | |
| `h03W` | Great Aquamarine | 4 | Silver Knight / Mighty Malachite | ⬜ todo | |

### Malachite line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h03X` | Malachite | 1 | recipe | ✅ done | Banded malachite boulder with gem eye, 3 orbiting green orbs |
| `h03Y` | Vivid Malachite | 2 | Malachite | ⬜ todo | |
| `h03Z` | Mighty Malachite | 3 | Vivid Malachite | ⬜ todo | |

### Star Ruby line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h016` | Star Ruby | 1 | recipe | ✅ done | Faceted 6-point ruby star with white asterism; fire ring on the ground (burn range), flames on burning creeps |
| `h02M` | Star | 2 | Star Ruby | ⬜ todo | |
| `e006` | Fire Star | 3 | Star | ⬜ todo | |

### Jade line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h018` | Jade | 1 | recipe | ✅ done | Carved jade bi disc, glowing pearl, gold cord + red tassel; jade needle shot |
| `h02L` | China Jade | 2 | Jade | ⬜ todo | |
| `h035` | Lucky China Jade | 3 | China Jade | ⬜ todo | |
| `h04V` | Helltaker | 4 | Lucky China Jade / Great Ruby | ⬜ todo | |
| `h04A` | Stone of Life | 4 | Lucky China Jade | ⬜ todo | |
| `n00H` | Professional King | 5 | Helltaker / Great Pink Diamond / Great Emerald | ⬜ todo | |
| `h04T` | Extreme | 5 | Stone of Life / Great Pink Diamond | ⬜ todo | |
| `h04Y` | GOD Shadow | 6 | Professional King / Bloody Sovereign's Orb | ⬜ todo | |
| `h04W` | Legend | 6 | Extreme | ⬜ todo | |
| `h05C` | Secret gem | 7 | Legend | ⬜ todo | |

### Red Crystal line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h029` | Red Crystal | 1 | recipe | ⬜ todo | |
| `h02J` | Red Facet | 2 | Red Crystal | ⬜ todo | |
| `h02Q` | Rose Quartz Crystal | 3 | Red Facet | ⬜ todo | |
| `h02X` | Great Amethyst | 4 | Rose Quartz Crystal | ⬜ todo | |

### Pink Diamond line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h017` | Pink Diamond | 1 | recipe | ⬜ todo | |
| `h02P` | Great Pink Diamond | 2 | Pink Diamond | ⬜ todo | |

### Dark Emerald line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h01N` | Dark Emerald | 1 | recipe | ⬜ todo | |
| `h02V` | Enchanted Emerald | 2 | Dark Emerald | ⬜ todo | |
| `h058` | Galaxy | 3 | Enchanted Emerald / Great Topaz / Great Sapphire / Great Diamond | ⬜ todo | |
| `h05B` | Universe | 4 | Galaxy | ⬜ todo | |

### Yellow Sapphire line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h014` | Yellow Sapphire | 1 | recipe | ⬜ todo | |
| `h02R` | Star Yellow Sapphire | 2 | Yellow Sapphire | ⬜ todo | |
| `h052` | Ultimate Sapphire I | 3 | Star Yellow Sapphire | ⬜ todo | |
| `h04X` | Ultimate Sapphire II | 4 | Ultimate Sapphire I | ⬜ todo | |
| `h053` | Ultimate Sapphire III | 5 | Ultimate Sapphire II | ⬜ todo | |
| `h054` | Ultimate Sapphire IV | 6 | Ultimate Sapphire III | ⬜ todo | |
| `h055` | Ultimate Sapphire V | 7 | Ultimate Sapphire IV | ⬜ todo | |
| `h057` | Ultimate MAX | 8 | Ultimate Sapphire V | ⬜ todo | |

### Blood Stone line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h01O` | Blood Stone | 1 | recipe | ⬜ todo | |
| `h02U` | Ancient Blood Stone | 2 | Blood Stone | ⬜ todo | |
| `h05E` | Bloody Sovereign's Orb | 3 | Ancient Blood Stone | ⬜ todo | |

### Uranium 238 line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h019` | Uranium 238 | 1 | recipe | ⬜ todo | |
| `h02N` | Uranium 235 | 2 | Uranium 238 | ⬜ todo | |
| `h04Z` | Atomic | 3 | Uranium 235 | ⬜ todo | |

### Gold line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h01B` | Gold | 1 | recipe | ⬜ todo | |
| `h02W` | Egyptian Gold | 2 | Gold | ⬜ todo | |
| `h05D` | Egyptian Diamond | 3 | Egyptian Gold | ⬜ todo | |
| `h05G` | Serendibite | 4 | Egyptian Diamond | ⬜ todo | |

### Black Opal line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h015` | Black Opal | 1 | recipe | ⬜ todo | |
| `h02K` | Mystic Black Opal | 2 | Black Opal | ⬜ todo | |
| `h059` | BIG Opal | 3 | Mystic Black Opal | ⬜ todo | |
| `h05A` | Master Opal | 4 | BIG Opal | ⬜ todo | |
| `h05F` | Hero Opal | 5 | Master Opal | ⬜ todo | |

### Paraiba Tourmaline line
| ID | Tower | Tier | From | Status | Art notes |
|---|---|---|---|---|---|
| `h040` | Paraiba Tourmaline | 1 | recipe | ⬜ todo | |
| `h041` | Paraiba Tourmaline Facet | 2 | Paraiba Tourmaline | ⬜ todo | |
| `h056` | Dimas Barbosa | 3 | Paraiba Tourmaline Facet | ⬜ todo | |
| `h04S` | Infinity Stone | 4 | Dimas Barbosa | ⬜ todo | |

## Great gems (4× Flawless or 4× Perfect)

Great Opal, Great Aquamarine and Great Amethyst are listed above in the lines that upgrade into them.

| ID | Tower | Upgrades to | Status | Art notes |
|---|---|---|---|---|
| `h031` | Great Diamond | Galaxy | ⬜ todo | |
| `h02Z` | Great Sapphire | Galaxy | ⬜ todo | |
| `h032` | Great Emerald | Professional King | ⬜ todo | |
| `h02Y` | Great Ruby | Helltaker | ⬜ todo | |
| `e005` | Great Topaz | Galaxy | ⬜ todo | |

## Not in the list yet

- **Slates** (12 kinds) share one engraved-slab art (`drawSlateArt` in [art.ts](src/render/art.ts)) with a colour per kind. They could get their own art later.
- **Aura / Aura level 2 / Aura Max** (from Great Amethyst, Great Opal and Great Aquamarine) and **Copy gem** (from Fire Star) are not in the prototype's data yet, so they have no art either.
