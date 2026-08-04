# Biome Expansion Plan — +5 Biome Types

Implementation plan (DRAFT — open points flagged `[OPEN #n]`, arbitrated in the
redraft) for extending the dungeon crawler at `~/Documents/games-benchmarks/dungeon-crawler-visual`
from its current 5-biome cycle to a 10-biome cycle.

Status: DRAFT — not implementation-ready. Open points listed in §15.

---

## 1. Overview

The game currently cycles 5 biomes (STONE, HAUNTED_CRYPT, FUNGAL_CAVERN,
VOLCANIC_DEPTHS, FROZEN_HALLS), 2 levels each, with a SPECTRAL_COURT boss arena
every 7th level. This plan adds **5 new biome types** to the ladder, taking the
cycle from 5 → 10 biomes (20 levels per full cycle).

Design constraints driving every decision:

1. **Zero new mechanics.** All 7 existing enemy types, the orb/sword economy,
   buffs, timed run, leaderboard, and boss system stay untouched. New biomes are
   *content*: palette, lights, props, room mix, enemy weight columns.
2. **Data-driven first.** A new biome is mostly a new `BIOMES` entry + a
   `ENEMY_SPAWN_WEIGHTS` column + `BIOME_ROOM_MODIFIERS` + eligibility rows +
   prop-set mapping. New code is limited to the genuinely new props/rooms/lights.
3. **No regression.** Levels 1–10 keep their exact current biomes. New biomes
   append after FROZEN_HALLS.

---

## 2. The 5 new biomes (proposed identities)

| # | Biome id | Visual identity | Hue family | Distinct from existing |
|---|---|---|---|---|
| 6 | `CRYSTAL_DEPTHS` | Magenta/violet crystal cavern | purple | existing = blue-gray/green/red/blue |
| 7 | `POISON_SWAMP` | Acid-yellow toxic marsh | yellow-green | FUNGAL is green; swamp is acid-yellow |
| 8 | `GOLDEN_TEMPLE` | Sand/gold shrine halls | warm gold | STONE is cold gray-blue |
| 9 | `FLOODED_RUINS` | Teal waterlogged ruins | teal/aqua | FROZEN is cold blue |
| 10 | `EMBER_FORGE` | Charcoal smithy with ember glow | charcoal/ember-orange | VOLCANIC is red-orange lava |

`[OPEN #1]` — Biome identities: are these 5 the right picks, or should any be
swapped (e.g. ABYSSAL_CAVES, ARCANE_LIBRARY, CATACOMBS, MECHANICAL_DEPTHS)?

---

## 3. Ladder placement

`[OPEN #2]` — Append after FROZEN_HALLS (levels 1–10 unchanged) vs interleave the
new biomes between existing ones.

Proposed (append): `SEQUENCE` becomes
`[STONE, HAUNTED_CRYPT, FUNGAL_CAVERN, VOLCANIC_DEPTHS, FROZEN_HALLS,
CRYSTAL_DEPTHS, POISON_SWAMP, GOLDEN_TEMPLE, FLOODED_RUINS, EMBER_FORGE]`.
`LEVELS_PER_BIOME` stays 2 → cycle = 20 levels. `BOSS.INTERVAL` stays 7
(unchanged) → boss arenas land at levels 7, 14, 21, 28… interleaving the cycle.

| Level | Biome | Level | Biome |
|---|---|---|---|
| 1–2 | STONE | 11–12 | FROZEN_HALLS |
| 3–4 | HAUNTED_CRYPT | 13 | CRYSTAL_DEPTHS |
| 5–6 | FUNGAL_CAVERN | **14** | **SPECTRAL_COURT (boss)** |
| **7** | **SPECTRAL_COURT (boss)** | 15–16 | POISON_SWAMP |
| 8–9 | VOLCANIC_DEPTHS | 17–18 | GOLDEN_TEMPLE |
| 10 | FROZEN_HALLS | 19–20 | FLOODED_RUINS |
| | | 21 | **SPECTRAL_COURT (boss)** |
| | | 22–23 | EMBER_FORGE |
| | | 24–25 | STONE (cycle restarts) |

`[OPEN #3]` — 2 levels per biome stays? (Alternative: LEVELS_PER_BIOME = 3 → 30-level
cycle, boss every 7 no longer lands mid-rung as often.)

---

## 4. Palette & atmosphere (new `BIOMES` entries)

Each new biome follows the exact schema of the existing 5:
`{ wall, floor, ceiling, fog, fogDensity, ambient, ambientIntensity, torchColor, label }`.

| Biome | Wall | Floor | Ceiling | Fog | FogDensity | Ambient @ Int | TorchColor | Label |
|---|---|---|---|---|---|---|---|---|
| CRYSTAL_DEPTHS | 0x3a2a4a | 0x2a1e35 | 0x1a1425 | 0x120a20 | 0.011 | 0x1c1030 @ 0.34 | 0xcc66ff | CRYSTAL DEPTHS |
| POISON_SWAMP | 0x3a3a20 | 0x2a2a14 | 0x1e1e0e | 0x121a06 | 0.012 | 0x16220a @ 0.32 | 0xccff44 | POISON SWAMP |
| GOLDEN_TEMPLE | 0x4a4230 | 0x3a3220 | 0x2a2416 | 0x241c0e | 0.01 | 0x2a2412 @ 0.36 | 0xffcc66 | GOLDEN TEMPLE |
| FLOODED_RUINS | 0x2a3a3e | 0x1e2a2e | 0x141e20 | 0x0a1a1e | 0.012 | 0x0e1e24 @ 0.33 | 0x55ddcc | FLOODED RUINS |
| EMBER_FORGE | 0x3a3230 | 0x2a2420 | 0x1e1a18 | 0x1a0e0a | 0.013 | 0x22120a @ 0.35 | 0xff7733 | EMBER FORGE |

All values keep fogDensity in the existing 0.01–0.013 range (visibility parity).

`[OPEN #4]` — Exact palette hexes/ambient intensities (tune pass needed?).

---

## 5. Room types

### 5.1 New room types (2)

| Room | Weight | Size | Features | Lighting | Decoration density | Enemy rules | Eligibility |
|---|---|---|---|---|---|---|---|
| CRYSTAL_CHAMBER | 8 | 2–3 × 2–3 | Crystal clusters (3), stalactites | 3 crystal lights | high (10) | none | CRYSTAL_DEPTHS |
| TEMPLE | 8 | 3 × 3 | Altar (1), braziers (2), banners (2), pillars (2) | 2 braziers + 1 gold chandelier | high (10) | ARMORED +20% | GOLDEN_TEMPLE |

### 5.2 Eligibility extensions (existing rooms reused by new biomes)

| Room | Eligibility change |
|---|---|
| ARMORY | + EMBER_FORGE (weapon racks fit a forge) |
| MUSHROOM_GROVE | + POISON_SWAMP (props tinted toxic) |
| LIBRARY / CRYPT | unchanged (STONE+HAUNTED_CRYPT / HAUNTED_CRYPT) |

`[OPEN #5]` — New-room count: 2 new room types vs adding one per new biome (5)
vs reusing everything (0). 2 was chosen for identity; confirm.

### 5.3 Room weight modifiers (new `BIOME_ROOM_MODIFIERS` rows)

| Biome | Modifiers |
|---|---|
| CRYSTAL_DEPTHS | CRYSTAL_CHAMBER ×3, VAULT ×1.2, MUSHROOM_GROVE ×0 |
| POISON_SWAMP | MUSHROOM_GROVE ×2.5, VAULT ×0.5, ARMORY ×0.5 |
| GOLDEN_TEMPLE | TEMPLE ×3, VAULT ×2, ARMORY ×1.5, CRYPT ×0 |
| FLOODED_RUINS | VAULT ×1.5, CHAMBER ×1.2 |
| EMBER_FORGE | ARMORY ×2.5, VAULT ×0.7, LIBRARY ×0 |

Per-biome total weight (sum of eligible base weights × modifiers, base pool:
CHAMBER 40 + HALL 35 + VAULT 25 + ARMORY 10 + LIBRARY 10 + CRYPT 10 +
MUSHROOM_GROVE 8 + ARENA 6 + CRYSTAL_CHAMBER 8 + TEMPLE 8 = 160):

| Biome | Eligible rooms sum |
|---|---|
| CRYSTAL_DEPTHS | 40 + 35 + 30 + 6 + 24 = **135** |
| POISON_SWAMP | 40 + 35 + 12.5 + 20 + 6 + 5 = **118.5** |
| GOLDEN_TEMPLE | 40 + 35 + 50 + 15 + 6 + 24 = **170** |
| FLOODED_RUINS | 48 + 35 + 37.5 + 6 = **126.5** |
| EMBER_FORGE | 40 + 35 + 17.5 + 25 + 6 = **123.5** |

All ≥ 100 (same rule as the existing spec).

---

## 6. Props & decorations

### 6.1 New props (3) + recolored variants (2)

| # | Prop | Type | Collision | Light | Rooms | Biomes | Density | Spec |
|---|---|---|---|---|---|---|---|---|
| 18 | Crystal cluster (recolor of ice crystal) | Light prop | none | PointLight (§7) | CRYSTAL_CHAMBER, any crystal room | CRYSTAL_DEPTHS | 2 clusters/room, 3–5 crystals | Cones 0.1–0.2 × 0.5–1.2, 0xcc88ff translucent (opacity 0.8), emissive 0xcc66ff 1.4. Light 0xcc66ff, 3.0, dist 11, decay 1.2, no shadow. |
| 19 | Acid pool (recolor of lava pool) | **Hazard + light** | none | PointLight (§7) | any swamp room | POISON_SWAMP | 1–2/room, never on exit | Emissive plane 1.5–2.5, 0x88ff22, top y=0.02, glow sprite. Hazard: 1 dmg / 0.8 s tick within 1.2 u (i-frames respected). Light 0x88ff22, 4.5, dist 16, decay 1.2, flicker ±10%. |
| 20 | Water pool | Decorative (floor decal) | none | none | CHAMBER, VAULT, HALL | FLOODED_RUINS | 1–2/room | Semi-transparent plane 1.5–3.0, 0x1a5a5a opacity 0.45, y=0.02, gentle opacity pulse. **No hazard, no collision.** |
| 21 | Altar | Decorative + light | none | PointLight (§7) | TEMPLE | GOLDEN_TEMPLE | 1/TEMPLE, centered back wall | Box 0.8×0.5×1.2 stone 0x8a7a4a + gold trim 0xd8b44a + candle flames (2). Light 0xffcc66, 2.0, dist 8, decay 1.5, no shadow. |
| 22 | Anvil | Decorative | none | none | ARMORY (forge), CHAMBER | EMBER_FORGE | 1–2/room | Box 0.5×0.3×0.35 0x4a4a52 metalness 0.8 + horn (cone 0.15) + base cylinder. Static. |

`[OPEN #6]` — Prop catalog: is 3 new + 2 recolors the right scope, or should
FLOODED_RUINS water be a hazard, or GOLDEN_TEMPLE get more signature props?

### 6.2 Per-biome prop sets (PropSystem mapping)

New entries required in the biome→prop-set mapping (all existing props reused
where listed; recolors keyed by biome):

| Biome | Props |
|---|---|
| CRYSTAL_DEPTHS | crystal clusters, stalactites (magenta tint), rubble |
| POISON_SWAMP | acid pools, toxic mushrooms (recolor of glowing mushroom 0xccff44), roots/vines, stalactites |
| GOLDEN_TEMPLE | altars, pillars (gold tint), banners (gold), chandeliers, rubble |
| FLOODED_RUINS | water pools, pillars, rubble, chains, wisps |
| EMBER_FORGE | anvils, chains, barrels, crates, lava pools (unchanged color), rubble |

Shared rules (unchanged): props only inside rooms, ≥ 1 cell from corridor
openings, never on exit cell (2 u radius), breakables ≤ 3/room, decorative
repeats instanced (1 draw call per prop type per level).

`[OPEN #7]` — Should lava pools also appear in EMBER_FORGE, or a distinct
ember/forge pool (recolor 0xff5522 → 0xff7733)? Recolor would be a 3rd hazard
variant config.

---

## 7. Lighting

### 7.1 New light sources (2)

| # | Light | Color | Intensity | Distance | Decay | Shadow | Biomes |
|---|---|---|---|---|---|---|---|
| 8 | CRYSTAL | 0xcc66ff | 3.0 | 11 | 1.2 | no | CRYSTAL_DEPTHS |
| 9 | ACID | 0x88ff22 | 4.5 | 16 | 1.2 | no | POISON_SWAMP |

Both are parameterized entries in `LIGHT_SOURCES` (mirroring ICE/LAVA). Torches
remain in all new biomes with `torchColor` palette tint (no LightingSystem
hardcode changes). The shadow budget (nearest-8 torches) is untouched.

`[OPEN #8]` — Keep the standard torch layout in all new biomes (incl. CRYSTAL
and POISON which are thematically "no torch" biomes)? Note: LightingSystem has a
hardcoded fungal special-case via `torchColor === 0x44ff88` equality — decide
whether to generalize it or avoid touching it.

### 7.2 Hazard generalization

Lava pools (existing, VOLCANIC only) and acid pools (new, POISON_SWAMP only)
share the same tick logic. `[OPEN #9]` — Parameterize the pool hazard (config
keyed by pool type: color / damage / interval / radius) vs duplicate the lava
code path for acid. (Parameterizing keeps PROPS.ACID = same numbers, different
color — zero behavior change for lava.)

---

## 8. Enemy spawn weights (5 new columns, sum = 100 each)

Order: Skeleton, Magician, Armored, Archer, Rat, Brute, Wraith.

| Enemy | STONE | HAUNTED_CRYPT | FUNGAL_CAVERN | VOLCANIC_DEPTHS | FROZEN_HALLS | CRYSTAL_DEPTHS | POISON_SWAMP | GOLDEN_TEMPLE | FLOODED_RUINS | EMBER_FORGE |
|---|---|---|---|---|---|---|---|---|---|---|
| Skeleton | 45 | 25 | 30 | 20 | 25 | 30 | 15 | 20 | 20 | 10 |
| Magician | 10 | 10 | 10 | 10 | 10 | 15 | 10 | 10 | 15 | 10 |
| Armored | 15 | 10 | 10 | 25 | 20 | 15 | 10 | 25 | 10 | 25 |
| Archer | 15 | 15 | 5 | 15 | 25 | 20 | 10 | 20 | 15 | 15 |
| Rat | 10 | 5 | 40 | 10 | 10 | 10 | 45 | 10 | 25 | 5 |
| Brute | 5 | 5 | 5 | 20 | 10 | 10 | 10 | 15 | 15 | 35 |
| Wraith | 0 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Column checks: CRYSTAL 30+15+15+20+10+10+0 = 100 ✓ · POISON 15+10+10+10+45+10+0 = 100 ✓ ·
GOLDEN 20+10+25+20+10+15+0 = 100 ✓ · FLOODED 20+15+10+15+25+15+0 = 100 ✓ ·
EMBER 10+10+25+15+5+35+0 = 100 ✓.

`[OPEN #10]` — Wraith stays crypt-exclusive (weight 0 everywhere else, as
documented in the existing spec)? Or should 1–2 new biomes (FLOODED_RUINS
drowned spirits) get wraith weight? Also: EMBER_FORGE Brute 35 — is a brute-heavy
forge too punishing at its ladder position (levels 22–23, scaling +5%/3 levels)?

---

## 9. Integration surface (files touched)

| File | Change |
|---|---|
| `src/core/Constants.js` | +5 `BIOMES` entries; `SEQUENCE` → 10; +2 room types in `DUNGEON.ROOM_TYPES` + `ROOM_BIOME_ELIGIBILITY` rows; +5 `BIOME_ROOM_MODIFIERS` rows; +5 `ENEMY_SPAWN_WEIGHTS` columns; +2 `LIGHT_SOURCES` entries; `PROPS` + (PROPS_PER_ROOM for new rooms, ACID block); new prop constants |
| `src/world/BiomeSystem.js` | No code change (data-driven: `biomeForLevel` + `SEQUENCE` + palette + texture tinting all derive from `BIOMES`). Texture cache grows 5 → 10 sets (+ boss) automatically. |
| `src/world/DungeonGenerator.js` | No code change (room picking already reads `ROOM_BIOME_ELIGIBILITY` + `BIOME_ROOM_MODIFIERS`). |
| `src/entities/SkeletonSystem.js` | No code change (weights keyed by `state.biome`; new columns picked up automatically). Fallback `|| ENEMY_SPAWN_WEIGHTS.STONE` protects missing columns — dev-time check added instead (§12). |
| `src/world/PropSystem.js` | +per-biome prop-set mapping entries (§6.2); +placement logic for crystal clusters, acid pools, water pools, altars, anvils; pool-hazard keyed by type (§7.2). |
| `src/systems/LightingSystem.js` | Only if hazard/pool parametrization lives here (`[OPEN #9]`); torch color already palette-driven. |
| `src/core/Game.js` | No code change (biome label/loading/HUD read `BIOMES[id].label`). |
| `index.html` | No code change (labels are data). |
| `scripts/biome-check.mjs` | NEW — dev-time validation (see §12). |
| `docs/SPEC.md` | Out of scope — plan lives in `docs/BIOME_EXPANSION_PLAN.md`; a future redraft may merge into SPEC. `[OPEN #11]` |

---

## 10. Performance & memory budgets

| Budget | Current | After | OK? |
|---|---|---|---|
| Shadow-casting lights | 8 max | 8 max | ✓ (new lights shadow-free) |
| Total point lights | ≤ 140 (~90 base + ≤20 new + 1 headlight) | ~90 + ≤20 (existing) + ≤14 new (crystal/acid/altar) + 1 | ~125 < 140 ✓ |
| Prop instances / level | ≤ 400 | ≤ 400 (new props share instancing) | ✓ |
| Texture memory | ≤ 16 MB (5 biome sets × 3 × 256 px) | 11 sets × 3 × 256 px ≈ 8.6 MB + others | < 16 MB ✓ |
| Draw calls | ≤ 120 | +3 new instanced prop types/level | ✓ |
| Enemies alive / rat cap | 16 / 12 | unchanged | ✓ |

`[OPEN #12]` — Confirm no light-count or draw-call budget revision is needed
(the 140-light cap was already rebalanced for the extended spec).

---

## 11. Edge cases

| # | Case | Resolution |
|---|---|---|
| 1 | New biome missing from `ENEMY_SPAWN_WEIGHTS` | `biome-check.mjs` fails; runtime falls back to STONE (existing) |
| 2 | New biome missing from `BIOME_ROOM_MODIFIERS` | `biome-check.mjs` fails; runtime applies no modifiers (existing) |
| 3 | Boss level in new ladder (14, 21, 28…) | SPECTRAL_COURT unchanged; `biomeForLevel` boss branch fires first |
| 4 | Acid pool overlaps exit | Excluded (≥ 3 u, mirror lava rule) |
| 5 | Water pool overlaps exit | Allowed (visual only), but kept off exit cell (2 u) for cleanliness |
| 6 | New room types in boss biome | Not eligible — never generated in SPECTRAL_COURT |
| 7 | Texture cache growth on regen | 11 sets cached at run start; `dispose()` unchanged (biomeCached flag) |
| 8 | HUD/loading label width | 'CRYSTAL DEPTHS' / 'GOLDEN TEMPLE' fit existing label styling (check at ≥ 1280 px) |
| 9 | dungeon-check.mjs | Unaffected — no world-geometry changes; must still report broken=0/40 |
| 10 | Elite rolls in new biomes | Unchanged: 1-in-10, elite-eligible types only (Armored/Archer/Brute/Wraith); Wraith never spawns in new biomes → no new elite exposure |
| 11 | BRIGHT buff in dark biomes (CRYSTAL 0x120a20 fog) | Buff multiplies ambient/fog — biome-agnostic, no change |
| 12 | `biomeIndex` for SPECTRAL_COURT | `SEQUENCE.indexOf` = −1 (existing behavior, unchanged) |

---

## 12. Verification

New `scripts/biome-check.mjs` (mirrors the existing scripts/ pattern):

1. `BIOMES.SEQUENCE.length === 10`; every id exists in `BIOMES`.
2. Every SEQUENCE biome has a palette with all 8 keys (wall/floor/ceiling/fog/
   fogDensity/ambient/ambientIntensity/torchColor/label).
3. Every SEQUENCE biome has a `ENEMY_SPAWN_WEIGHTS` column summing to exactly 100.
4. Every SEQUENCE biome has a `BIOME_ROOM_MODIFIERS` entry (may be `{}`).
5. Every `ROOM_BIOME_ELIGIBILITY` value resolves to real biome ids / 'all';
   every new biome appears in ≥ 1 eligibility list (else it generates
   CHAMBER/HALL/VAULT/ARENA only — legal but verify intent).
6. Per-biome eligible-room weight sum ≥ 100 (recompute §5.3 table).
7. `LIGHT_SOURCES` entries referenced by PropSystem exist.
8. Existing gate: `node scripts/dungeon-check.mjs` → broken=0/40.

---

## 13. Implementation phases (commit per phase)

| Phase | Scope | Files | Gate |
|---|---|---|---|
| 0 | Constants scaffolding: 5 BIOMES entries, SEQUENCE 10, room types, modifiers, eligibility, weights, lights, props | Constants.js, biome-check.mjs | biome-check passes; dungeon-check 0/40 |
| 1 | Palette/texture verification: level 11+ reaches each new biome with correct tint/fog/ambient | (constants only) | visual + console check via headless level probe; biome-check |
| 2 | Rooms + props: CRYSTAL_CHAMBER, TEMPLE, 5 prop additions, PropSystem mapping | PropSystem.js, DungeonGenerator (if needed) | biome-check; prop counts via renderer.info |
| 3 | Lighting: CRYSTAL/ACID sources, pool-hazard parametrization | LightingSystem.js, PropSystem.js | light count ≤ 140; shadow-casters = 8 |
| 4 | Spawn verification: enemy mix per new biome matches §8 columns | (constants only) | headless spawn probe; biome-check |
| 5 | Final gates: full descend 1 → 25, memory stable over 3 descends, no console errors, dungeon-check 0/40, biome-check clean | — | all gates |

---

## 14. Out of scope

- New enemy types, elites, or boss variants.
- New player mechanics (buffs, weapons, movement).
- Water/swamp status effects beyond the acid pool tick.
- Audio, save/continue, new frameworks.
- Changes to levels 1–10 behavior (STONE…FROZEN_HALLS stay byte-identical in
  content distribution where the RNG allows).
- Changes to BOSS.INTERVAL / boss arena content.

---

## 15. OPEN POINTS (to arbitrate in redraft)

| # | Question | Options |
|---|---|---|
| 1 | Biome identities | keep 5 proposed / swap any |
| 2 | Ladder placement | append / interleave |
| 3 | LEVELS_PER_BIOME | 2 / 3 |
| 4 | Palette exact values | tune in phase 1 |
| 5 | New room count | 2 / 5 / 0 |
| 6 | Prop catalog scope | as proposed / more / water hazard |
| 7 | Lava pools in EMBER_FORGE | reuse / recolor variant |
| 8 | Torch layout in new biomes | standard / torchless + generalization of the fungal hardcode |
| 9 | Hazard implementation | parametrize pool config / duplicate lava path |
| 10 | Wraith eligibility + Brute 35 in EMBER | crypt-exclusive / extend; tune brute weight |
| 11 | SPEC.md merge | keep plan separate / fold into SPEC later |
| 12 | Budget revision | confirm as computed / adjust |
