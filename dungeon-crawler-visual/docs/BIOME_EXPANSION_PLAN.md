# Biome Expansion Plan — +5 Biome Types

Implementation plan for extending the dungeon crawler at
`~/Documents/games-benchmarks/dungeon-crawler-visual` from its current 5-biome
cycle to a **10-biome cycle** (20 levels per full cycle).

Status: **CLOSED** — every open point from the draft arbitrated and embedded
inline. Resolution priority: ease of development, maintainability, internal
consistency, fun. Gap-closure log in §16.

---

## 1. Overview

The game currently cycles 5 biomes (STONE, HAUNTED_CRYPT, FUNGAL_CAVERN,
VOLCANIC_DEPTHS, FROZEN_HALLS), 2 levels each, with a SPECTRAL_COURT boss arena
every 7th level. This plan adds **5 new biome types**:

| # | Biome id | Visual identity | Hue family |
|---|---|---|---|
| 6 | `CRYSTAL_DEPTHS` | Magenta/violet crystal cavern | purple |
| 7 | `POISON_SWAMP` | Acid-yellow toxic marsh | yellow-green |
| 8 | `GOLDEN_TEMPLE` | Sand/gold shrine halls | warm gold |
| 9 | `FLOODED_RUINS` | Teal waterlogged ruins | teal/aqua |
| 10 | `EMBER_FORGE` | Charcoal smithy, ember glow | charcoal/ember-orange |

Design constraints (final, non-negotiable):

1. **Zero new mechanics.** All 7 existing enemy types, the orb/sword economy,
   buffs, timed run, leaderboard, and boss system stay untouched. New biomes are
   content only: palette, lights, props, room mix, enemy weight columns.
2. **Data-driven first.** A new biome is: a `BIOMES` entry + a
   `ENEMY_SPAWN_WEIGHTS` column + a `BIOME_ROOM_MODIFIERS` row + eligibility
   rows + a PropSystem prop-set entry. New code is limited to the genuinely new
   props/rooms/lights (§9).
3. **No regression.** Levels 1–10 keep their exact current biomes. New biomes
   append after FROZEN_HALLS. `dungeon-check.mjs` must still report broken=0/40.

Rationale for the 5 identities (arbitrated): each new biome maps 1:1 onto an
existing light/prop system — crystal → ICE, swamp → LAVA + MUSHROOM, temple →
CHANDELIER + VAULT, ruins → WISP, forge → ARMORY + BRAZIER — so no new
mechanics, no new pools, and each hue family is distinct from the existing five
(stone gray-blue, crypt dark blue, fungal green, volcanic red, frozen blue).

---

## 2. Progression — the 10-biome ladder

`BIOMES.SEQUENCE` becomes (append, FINAL):

```
[STONE, HAUNTED_CRYPT, FUNGAL_CAVERN, VOLCANIC_DEPTHS, FROZEN_HALLS,
 CRYSTAL_DEPTHS, POISON_SWAMP, GOLDEN_TEMPLE, FLOODED_RUINS, EMBER_FORGE]
```

`LEVELS_PER_BIOME` stays **2** → cycle = 20 levels. `BOSS.INTERVAL` stays **7**
(unchanged) → boss arenas at levels 7, 14, 21, 28… interleave the cycle exactly
as they do today. `biomeForLevel` formula is unchanged:
`BOSS branch first, else SEQUENCE[floor((level−1)/2) % 10]`.

| Level | Biome | Level | Biome |
|---|---|---|---|
| 1–2 | STONE | 12–13 | CRYSTAL_DEPTHS |
| 3–4 | HAUNTED_CRYPT | **14** | **SPECTRAL_COURT (boss)** |
| 5–6 | FUNGAL_CAVERN | 15–16 | POISON_SWAMP |
| **7** | **SPECTRAL_COURT (boss)** | 17–18 | GOLDEN_TEMPLE |
| 8–9 | VOLCANIC_DEPTHS | 19–20 | FLOODED_RUINS |
| 10–11 | FROZEN_HALLS | **21** | **SPECTRAL_COURT (boss)** |
| | | 22–23 | EMBER_FORGE |
| | | 24–25 | STONE (cycle restarts) |

(Verified by re-deriving from `floor((level−1)/2) % 10`: L10 → 4 = FROZEN,
L11 → 4 = FROZEN, L12 → 5 = CRYSTAL, L13 → 5 = CRYSTAL, L15 → 6 = POISON,
L17 → 7 = GOLDEN, L19 → 8 = FLOODED, L22 → 9 = EMBER, L24 → 0 = STONE.)

Difficulty does NOT reset: enemy level scaling (+5% speed/attack per 3 levels),
spawn slots (2 + level−1, cap 10), `LEVEL_TIME_LIMIT` 180 s, NG+ HP multiplier,
and buff rules are all unchanged. At level 24+ the cycle restarts with STONE
and full 7-type roster per the STONE weight column.

---

## 3. Palette & atmosphere (new `BIOMES` entries)

Each new biome uses the exact existing schema — **9 keys**:
`{ wall, floor, ceiling, fog, fogDensity, ambient, ambientIntensity, torchColor, label }`.

| Biome | Wall | Floor | Ceiling | Fog | FogDensity | Ambient @ Int | TorchColor | Label |
|---|---|---|---|---|---|---|---|---|
| CRYSTAL_DEPTHS | 0x3a2a4a | 0x2a1e35 | 0x1a1425 | 0x120a20 | 0.011 | 0x1c1030 @ 0.34 | 0xcc66ff | CRYSTAL DEPTHS |
| POISON_SWAMP | 0x3a3a20 | 0x2a2a14 | 0x1e1e0e | 0x121a06 | 0.012 | 0x16220a @ 0.32 | 0xccff44 | POISON SWAMP |
| GOLDEN_TEMPLE | 0x4a4230 | 0x3a3220 | 0x2a2416 | 0x241c0e | 0.010 | 0x2a2412 @ 0.36 | 0xffcc66 | GOLDEN TEMPLE |
| FLOODED_RUINS | 0x2a3a3e | 0x1e2a2e | 0x141e20 | 0x0a1a1e | 0.012 | 0x0e1e24 @ 0.33 | 0x55ddcc | FLOODED RUINS |
| EMBER_FORGE | 0x3a3230 | 0x2a2420 | 0x1e1a18 | 0x1a0e0a | 0.013 | 0x22120a @ 0.35 | 0xff7733 | EMBER FORGE |

All fogDensity values sit in the existing 0.010–0.013 band (visibility parity);
all torchColors are unique (guarantees the LightingSystem fungal special-case
`torchColor === 0x44ff88` can never false-positive on a new biome). These values
are FINAL — no tune pass. BiomeSystem texture tinting (`texturesFor`) picks them
up with zero code change; the texture cache grows 5 → 11 sets (10 + SPECTRAL_COURT).

---

## 4. Room types

### 4.1 New room types (2 — arbitrated: identity where needed, reuse elsewhere)

| Room | Weight | Size | Features | Lighting | Decoration density | Enemy rules | Eligibility |
|---|---|---|---|---|---|---|---|
| CRYSTAL_CHAMBER | 8 | 2–3 × 2–3 | Crystal clusters (3), stalactites (magenta) | 3 crystal lights | high (10) | none | `CRYSTAL_DEPTHS` |
| TEMPLE | 8 | 3 × 3 | Altar (1), braziers (2), banners (2), pillars (2) | 2 braziers + 1 chandelier (gold tint) | high (10) | ARMORED ×1.2 | `GOLDEN_TEMPLE` |

`ROOM_ENEMY_MODIFIERS.TEMPLE = { ARMORED: 1.2 }` (new entry — the TEMPLE
"armored guard" rule).

### 4.2 Eligibility extensions (existing rooms reused by new biomes)

| Room | Eligibility (final) |
|---|---|
| ARMORY | `[STONE, VOLCANIC_DEPTHS, GOLDEN_TEMPLE, EMBER_FORGE]` |
| MUSHROOM_GROVE | `[FUNGAL_CAVERN, POISON_SWAMP]` (props tinted toxic) |
| LIBRARY | `[STONE, HAUNTED_CRYPT]` (unchanged) |
| CRYPT | `[HAUNTED_CRYPT]` (unchanged) |
| CRYSTAL_CHAMBER | `[CRYSTAL_DEPTHS]` |
| TEMPLE | `[GOLDEN_TEMPLE]` |
| CHAMBER / HALL / VAULT / ARENA | `all` (unchanged) |

### 4.3 Room weight modifiers (new `BIOME_ROOM_MODIFIERS` rows — only eligible rooms)

| Biome | Modifiers |
|---|---|
| CRYSTAL_DEPTHS | CRYSTAL_CHAMBER ×3, VAULT ×1.2 |
| POISON_SWAMP | MUSHROOM_GROVE ×2.5, VAULT ×0.5 |
| GOLDEN_TEMPLE | TEMPLE ×3, VAULT ×2, ARMORY ×1.5 |
| FLOODED_RUINS | VAULT ×1.5, CHAMBER ×1.2 |
| EMBER_FORGE | ARMORY ×2.5, VAULT ×0.7 |

Dead modifier entries (rooms not eligible in that biome) are excluded — the
eligibility filter already handles exclusion; no `×0` rows are needed.

Per-biome eligible-room weight sum (base weights: CHAMBER 40, HALL 35, VAULT 25,
ARMORY 10, LIBRARY 10, CRYPT 10, MUSHROOM_GROVE 8, ARENA 6, CRYSTAL_CHAMBER 8,
TEMPLE 8; `weight × modifier`, filtered by eligibility — recomputed, FINAL):

| Biome | Eligible rooms sum |
|---|---|
| CRYSTAL_DEPTHS | 40 + 35 + 25×1.2 + 6 + 8×3 = **135** |
| POISON_SWAMP | 40 + 35 + 25×0.5 + 8×2.5 + 6 = **113.5** |
| GOLDEN_TEMPLE | 40 + 35 + 25×2 + 10×1.5 + 6 + 8×3 = **170** |
| FLOODED_RUINS | 40×1.2 + 35 + 25×1.5 + 6 = **126.5** |
| EMBER_FORGE | 40 + 35 + 25×0.7 + 10×2.5 + 6 = **123.5** |

All ≥ 100 (same rule as the existing spec: no degenerate room pools).

---

## 5. Props & decorations

### 5.1 Prop catalog additions (3 new + 2 recolored variants)

Shared rules (unchanged): props only inside rooms, ≥ 1 cell from any corridor
opening, never on the exit cell (2 u radius), breakables ≤ 3/room, decorative
repeats instanced (1 draw call per prop type per level).

| # | Prop | Type | Collision | Light | Rooms | Biomes | Density | Spec |
|---|---|---|---|---|---|---|---|---|
| 18 | Crystal cluster (recolor of ice crystal) | Light prop | none | PointLight CRYSTAL (§6) | CRYSTAL_CHAMBER, any crystal room | CRYSTAL_DEPTHS | 2 clusters/room, 3–5 crystals | Cones 0.1–0.2 × 0.5–1.2, 0xcc88ff, opacity 0.8, emissive 0xcc66ff 1.4. Light 0xcc66ff, intensity 3.0, dist 11, decay 1.2, no shadow, pulse ±15% @ 0.8 Hz. |
| 19 | Acid pool (recolor of lava pool) | **Hazard + light** | none | PointLight ACID (§6) | any swamp room | POISON_SWAMP | 1–2/room, ≥ 3 u from exit | Emissive plane 1.5–2.5 ellipse, 0x88ff22, top y=0.02, glow sprite, flicker ±10% @ 3 Hz. Hazard: 1 dmg / 0.8 s tick within 1.2 u (i-frames respected) — same numbers as lava, keyed via `PROPS.POOLS` (§6.2). Light 0x88ff22, intensity 4.5, dist 16, decay 1.2, no shadow. |
| 20 | Water pool | Decorative (floor decal) | none | none | CHAMBER, VAULT, HALL | FLOODED_RUINS | 1–2/room | Plane 1.5–3.0, 0x1a5a5a opacity 0.45, y=0.02, opacity pulse ±10% @ 0.5 Hz. **No hazard, no collision** (arbitrated: hazard count stays at 2 types — lava/acid). |
| 21 | Altar | Decorative + light | none | PointLight (§6) | TEMPLE | GOLDEN_TEMPLE | 1/TEMPLE, centered on back wall | Box 0.8×0.5×1.2, stone 0x8a7a4a, gold trim 0xd8b44a (metalness 0.8), 2 candle flames. Light 0xffcc66, intensity 2.0, dist 8, decay 1.5, no shadow. |
| 22 | Anvil | Decorative | none | none | ARMORY (forge), CHAMBER | EMBER_FORGE | 1–2/room | Body Box 0.5×0.3×0.35, 0x4a4a52 metalness 0.8 + horn (cone 0.15) + base cylinder. Static. |

### 5.2 Per-biome prop sets (PropSystem mapping — new entries)

| Biome | Props |
|---|---|
| CRYSTAL_DEPTHS | crystal clusters, stalactites (0x6a4a8a tint), rubble |
| POISON_SWAMP | acid pools, toxic mushrooms (recolor of glowing mushroom, cap 0xccff44), roots/vines, stalactites (0x6a6a2a tint) |
| GOLDEN_TEMPLE | altars, pillars (0x8a7a4a tint), banners (gold 0xd8b44a), chandeliers, rubble |
| FLOODED_RUINS | water pools, pillars (0x3a5a5e tint), rubble, chains, wisps (recolor 0x55ddcc) |
| EMBER_FORGE | anvils, chains, barrels, crates, lava pools (existing 0xff5522 — reused as-is, no recolor variant; forge glow reads correctly), rubble |

Existing volcanic-only rules that gain a second biome: lava pools now also place
in EMBER_FORGE (same hazard, same color); wisps now also place in FLOODED_RUINS
(recolored aqua, same patrol behavior). Both are eligibility extensions, not new
mechanics.

---

## 6. Lighting

### 6.1 New light sources (2 — parameterized `LIGHT_SOURCES` entries)

| # | Light | Color | Intensity | Distance | Decay | Flicker | Shadow | Biomes |
|---|---|---|---|---|---|---|---|---|
| 8 | CRYSTAL | 0xcc66ff | 3.0 | 11 | 1.2 | emissive pulse ±15% @ 0.8 Hz | no | CRYSTAL_DEPTHS |
| 9 | ACID | 0x88ff22 | 4.5 | 16 | 1.2 | intensity ±10% @ 3 Hz | no | POISON_SWAMP |

Torch layout: **standard torches in all 5 new biomes**, tinted by each biome's
`torchColor` (LightingSystem already reads `palette.torchColor`). The fungal
special-case hardcode (`torchColor === 0x44ff88`) is NOT generalized and NOT
touched — all new torchColors are unique, so no false positive is possible.
Shadow budget untouched: nearest-8 torches only, all new lights `castShadow = false`.

New-light budget rule (FINAL): each new biome's light set adds **≤ 20 lights per
level** (crystal clusters 2/room, acid pools 1–2/room, altar 1/TEMPLE — the same
cap the extended spec already uses). Per-biome light placement:

| Biome | Light set |
|---|---|
| CRYSTAL_DEPTHS | crystal lamps (2 clusters/room), torches (0xcc66ff) |
| POISON_SWAMP | acid pools (1–2/room), toxic mushrooms (1 per non-grove room, 3 per grove), torches (0xccff44) |
| GOLDEN_TEMPLE | altar light (1/TEMPLE), chandeliers (1 per HALL/VAULT/ARENA/TEMPLE), torches (0xffcc66), VAULT god rays (existing) |
| FLOODED_RUINS | wisps (1–2 per room, aqua), torches (0x55ddcc) |
| EMBER_FORGE | lava pools (1–2/room), braziers (existing), torches (0xff7733) |

### 6.2 Pool hazard parametrization (FINAL decision)

The lava tick lives in `PropSystem` (`lavaPools: {x, z, radius}` + `lavaHazard`
callback wired to `Game._lavaDamage`). Change:

- `PROPS.POOLS = { LAVA: { damage: 1, interval: 0.8, radius: 1.2, color: 0xff5522, emissive: 2.2 }, ACID: { damage: 1, interval: 0.8, radius: 1.2, color: 0x88ff22, emissive: 2.2 } }`.
- `lavaPools` entries gain a `type` field (`'LAVA' | 'ACID'`); the tick reads
  `radius` from `PROPS.POOLS[type]`; the damage callback signature is unchanged
  (Game reads the pool type from the event payload if it ever needs to).
- `PROPS.LAVA_DAMAGE / LAVA_INTERVAL / LAVA_RADIUS` are replaced by the POOLS
  block (grep sweep: PropSystem + Game are the only consumers). Lava behavior is
  byte-identical (same numbers, same colors).

---

## 7. Enemy spawn weights (5 new columns, sum = 100 each — FINAL)

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

Column checks (recomputed): CRYSTAL 30+15+15+20+10+10+0 = **100** ✓ ·
POISON 15+10+10+10+45+10+0 = **100** ✓ · GOLDEN 20+10+25+20+10+15+0 = **100** ✓ ·
FLOODED 20+15+10+15+25+15+0 = **100** ✓ · EMBER 10+10+25+15+5+35+0 = **100** ✓.

FINAL rulings:

- **Wraith stays crypt-exclusive** (weight 0 everywhere else). This preserves the
  documented design rule from the existing spec and keeps `ROOM_ENEMY_MODIFIERS.CRYPT`
  the only wraith bump. FLOODED_RUINS does NOT get wraiths (drowned-spirit idea
  rejected — consistency wins; rats at 25 carry its identity).
- **EMBER_FORGE Brute 35 is intentional**: the forge is the last rung of the
  cycle (levels 22–23); the player is fully grown (orb-sword, buffs) and enemy
  scaling is identical to today's level 22. Risk-reward finale pressure.
- Rat pack constants are unchanged (code currently: MIN 2 / MAX 3 / CAP 6 — the
  halved values already live in Constants.js; weights are independent of pack size).

---

## 8. Integration surface (files touched — complete list)

| File | Change |
|---|---|
| `src/core/Constants.js` | +5 `BIOMES` entries; `SEQUENCE` → 10; +2 `DUNGEON.ROOM_TYPES` (CRYSTAL_CHAMBER, TEMPLE); `ROOM_BIOME_ELIGIBILITY` rows (new rooms + ARMORY += GOLDEN_TEMPLE/EMBER_FORGE + MUSHROOM_GROVE += POISON_SWAMP); +5 `BIOME_ROOM_MODIFIERS` rows; +5 `ENEMY_SPAWN_WEIGHTS` columns; +2 `LIGHT_SOURCES` (CRYSTAL, ACID); `PROPS.POOLS` (LAVA/ACID, replaces LAVA_* keys); `PROPS.PROPS_PER_ROOM` += CRYSTAL_CHAMBER 10, TEMPLE 10; `ROOM_ENEMY_MODIFIERS.TEMPLE`; prop constants (crystal cluster, acid pool, water pool, altar, anvil) |
| `src/world/BiomeSystem.js` | **No code change** — `biomeForLevel`, `SEQUENCE`, palette, and tinted-texture generation are fully data-driven; cache grows to 11 sets automatically |
| `src/world/DungeonGenerator.js` | **No code change** — `_pickRoomType` already reads eligibility + modifiers |
| `src/entities/SkeletonSystem.js` | **No code change** — weights keyed by `state.biome`; new columns picked up automatically. Runtime fallback `\|\| ENEMY_SPAWN_WEIGHTS.STONE` remains as a safety net; `biome-check.mjs` (§11) is the guard against missing columns |
| `src/world/PropSystem.js` | +5 per-biome prop-set entries (§5.2); placement for crystal clusters, acid pools, water pools, altars, anvils; `lavaPools` entries gain `type`, tick reads `PROPS.POOLS[type]`; lava/wisp eligibility extensions |
| `src/core/Game.js` | **No code change** — `_lavaDamage` callback signature unchanged; biome label/loading/HUD read `BIOMES[id].label` automatically |
| `src/systems/LightingSystem.js` | **No code change** — torch color/ambient/fog are palette-driven; fungal hardcode untouched (unique torchColors prevent false positives) |
| `index.html` | **No code change** — labels are data |
| `scripts/biome-check.mjs` | NEW — dev-time validation (§11) |
| `docs/SPEC.md` | **Unchanged** — the existing closed spec stays the contract for the current 5-biome game; this plan is the contract for the extension. A future merge is out of scope |

---

## 9. Performance & memory budgets (FINAL — verified)

| Budget | Current | After | Check |
|---|---|---|---|
| Shadow-casting lights | 8 max | 8 max | ✓ (all new lights shadow-free) |
| Total point lights | ~110 (90 base + ≤20 extended-spec) + 1 headlight | + ≤20 new (one biome's light set) + 1 headlight | ~131 < 140 ✓ |
| New lights per level | ≤ 20 (extended spec) | ≤ 20 per biome light set | ✓ |
| Prop instances / level | ≤ 400 | ≤ 400 (new props share instancing) | ✓ |
| Draw calls | ≤ 120 | +≤ 3 instanced prop types/level | ✓ |
| Texture memory | ≤ 16 MB | 11 sets × 3 × 256 px ≈ 8.6 MB + shared (web/splatter/glow/runes) | < 16 MB ✓ |
| Enemies alive / rat cap | 16 / 12 | unchanged | ✓ |
| Per-frame allocation | 0 (pools only) | unchanged | ✓ |

Texture math: 11 biome sets × 3 textures × 256 × 256 × 4 B = 8.65 MB; all other
procedural textures are shared singletons.

---

## 10. Edge cases

| # | Case | Resolution |
|---|---|---|
| 1 | New biome missing from `ENEMY_SPAWN_WEIGHTS` | `biome-check.mjs` fails; runtime falls back to STONE (existing behavior) |
| 2 | New biome missing from `BIOME_ROOM_MODIFIERS` | `biome-check.mjs` fails; runtime applies no modifiers (existing behavior) |
| 3 | Boss level in the new ladder (7, 14, 21, 28…) | SPECTRAL_COURT unchanged; the boss branch of `biomeForLevel` fires first |
| 4 | Acid pool overlaps exit | Excluded by placement rule (≥ 3 u, mirrors lava) |
| 5 | Water pool overlaps exit | Kept off exit cell (2 u) for cleanliness; no hazard either way |
| 6 | CRYSTAL_CHAMBER / TEMPLE in boss biome | Impossible — eligibility is biome-scoped; SPECTRAL_COURT rooms fall back to the arena's own layout |
| 7 | Texture cache growth on regen | 11 sets cached at run start; `dispose()` path unchanged (`biomeCached` flag) |
| 8 | HUD / loading label width | 'CRYSTAL DEPTHS' / 'GOLDEN TEMPLE' fit existing label styling (checked at ≥ 1280 px) |
| 9 | dungeon-check.mjs | Unaffected — no world-geometry changes; must still report broken=0/40 |
| 10 | Elite rolls in new biomes | Unchanged: 1-in-10, elite-eligible types only (Armored/Archer/Brute/Wraith). Wraith weight 0 in all new biomes → no new elite exposure |
| 11 | BRIGHT buff in dark biomes (CRYSTAL fog 0x120a20) | Buff multiplies ambient/fog — biome-agnostic, no change |
| 12 | `biomeIndex` for SPECTRAL_COURT | `SEQUENCE.indexOf` = −1 (existing behavior, unchanged) |
| 13 | ARMORY now eligible in 4 biomes | Weight pool math already recomputed per biome (§4.3); no spawn-slot change |
| 14 | Pool tick with mixed pool types on one level | Impossible — each level has exactly one biome's pool type (POISON acid xor EMBER lava); the `type` key still makes the code future-proof |

---

## 11. Verification — `scripts/biome-check.mjs` (NEW)

Mirrors the existing scripts/ pattern (node, no deps). Gates:

1. `BIOMES.SEQUENCE.length === 10`; every id exists as a `BIOMES` key.
2. Every SEQUENCE biome palette has **all 9 keys** (wall, floor, ceiling, fog,
   fogDensity, ambient, ambientIntensity, torchColor, label).
3. Every SEQUENCE biome has an `ENEMY_SPAWN_WEIGHTS` column summing to **exactly 100**.
4. Every SEQUENCE biome has a `BIOME_ROOM_MODIFIERS` entry (may be `{}`).
5. Every `ROOM_BIOME_ELIGIBILITY` value is `'all'` or an existing biome id;
   every SEQUENCE biome appears in ≥ 1 non-`'all'` eligibility list; every room
   type appears in ≥ 1 eligibility list.
6. Per-biome eligible-room weight sum ≥ 100 — recompute §4.3 table from
   `DUNGEON.ROOM_TYPES` + `ROOM_BIOME_ELIGIBILITY` + `BIOME_ROOM_MODIFIERS`.
7. Every room type has a `PROPS.PROPS_PER_ROOM` entry.
8. Every `LIGHT_SOURCES` id referenced by prop placement exists.
9. `ROOM_ENEMY_MODIFIERS.TEMPLE` exists.
10. Existing gate: `node scripts/dungeon-check.mjs` → broken=0/40.

---

## 12. Implementation phases (commit per phase)

| Phase | Scope | Files | Gate |
|---|---|---|---|
| 0 | Constants scaffolding: 5 BIOMES entries, SEQUENCE 10, 2 room types, eligibility rows, 5 modifier rows, 5 weight columns, 2 light sources, PROPS.POOLS, PROPS_PER_ROOM, ROOM_ENEMY_MODIFIERS.TEMPLE | `Constants.js`, `scripts/biome-check.mjs` (new) | biome-check 1–9 pass; dungeon-check 0/40 |
| 1 | Palette/texture verification: headless probe forces levels 12, 15, 17, 19, 22 and asserts wall/floor/ceiling/fog/ambient match §3 | (constants only) | headless probe green; biome-check pass |
| 2 | Rooms + props: CRYSTAL_CHAMBER, TEMPLE placement, 5 prop additions, per-biome prop-set mapping, pool `type` keying | `PropSystem.js` | biome-check pass; prop counts via `renderer.info` (≤ 400 instances, +≤ 3 draw calls) |
| 3 | Lighting: CRYSTAL/ACID sources, pool parametrization sweep (LAVA_* → POOLS) | `Constants.js`, `PropSystem.js`, `Game.js` (only if the `_lavaDamage` payload changes — it should not) | shadow-casters = 8; total lights ≤ 140; lava behavior regression-checked (VOLCANIC level identical) |
| 4 | Spawn verification: headless spawn probe over each new biome asserts enemy mix matches §7 columns (weighted sample ± tolerance) | (constants only) | probe green; biome-check pass |
| 5 | Final gates: full descend 1 → 25 (3 descends), memory stable, no console errors, dungeon-check 0/40, biome-check clean | — | all gates |

---

## 13. Out of scope (final)

- New enemy types, elites, or boss variants.
- New player mechanics (buffs, weapons, movement).
- Water/swamp status effects beyond the acid pool tick (water is decorative).
- A third hazard pool type (no ember/poison damage variants beyond LAVA/ACID).
- Audio, save/continue, new frameworks.
- Changes to levels 1–10 behavior (STONE…FROZEN_HALLS content distribution
  stays as today wherever the RNG allows).
- Changes to `BOSS.INTERVAL` / boss arena content.
- Generalizing the LightingSystem fungal torch hardcode.
- Merging this plan into `docs/SPEC.md`.

---

## 14. Gap-closure log (draft → closed)

Every open point from the draft (§15) and every additional gap found in the
hostile consistency review, with the arbitration applied.

| # | Gap | Resolution |
|---|---|---|
| 1 | Which 5 biome identities? | KEEP the 5 proposed (CRYSTAL_DEPTHS, POISON_SWAMP, GOLDEN_TEMPLE, FLOODED_RUINS, EMBER_FORGE). Each maps 1:1 onto an existing light/prop system; hue families distinct from the existing 5. |
| 2 | Ladder placement: append vs interleave | APPEND after FROZEN_HALLS. Levels 1–10 byte-identical → zero regression, no acceptance-criteria churn. |
| 3 | LEVELS_PER_BIOME 2 vs 3 | 2 (20-level cycle). Boss at 7/14/21 already interleaves; changing rung semantics would ripple into boss pacing. |
| 4 | Palette values | LOCKED (§3). All in existing ranges (fogDensity 0.010–0.013, ambient 0.32–0.36); unique torchColors. No tune pass. |
| 5 | New room count 2 / 5 / 0 | 2 (CRYSTAL_CHAMBER, TEMPLE). Identity where needed; reuse elsewhere (swamp reuses MUSHROOM_GROVE, ruins reuses VAULT/HALL, forge reuses ARMORY). |
| 6 | Prop catalog scope / water hazard | 3 new + 2 recolors (§5.1). Water stays non-hazard — hazard count stays at 2 types (LAVA, ACID). |
| 7 | Lava pools in EMBER_FORGE | REUSE lava pool as-is (0xff5522, same hazard). No third recolor variant. |
| 8 | Torch layout / fungal hardcode | Standard torches in all 5 new biomes (palette-tinted). Hardcode NOT touched — unique torchColors guarantee no false positive. |
| 9 | Hazard implementation | PARAMETRIZE via `PROPS.POOLS` keyed LAVA/ACID; same numbers for acid as lava; lava byte-identical. |
| 10 | Wraith eligibility + EMBER Brute 35 | Wraith stays crypt-exclusive (consistency with documented rule). Brute 35 KEPT — final-rung risk/reward. |
| 11 | SPEC.md merge | Plan stays separate; SPEC.md untouched (contract for current game). |
| 12 | Budget revision | CONFIRMED with the ≤ 20 new lights/level rule (§9): ~131 < 140; texture 8.65 MB < 16 MB. |
| 13 | Ladder table off-by-one (draft: 11–12 FROZEN, 13 CRYSTAL) | RE-DERIVED from `floor((level−1)/2) % 10`: FROZEN = 10–11, CRYSTAL_DEPTHS = 12–13 (§2 table). |
| 14 | biome-check "8 keys" vs 9-key schema | Fixed to 9 keys (wall…label). |
| 15 | Dead modifier entries (POISON ARMORY ×0.5, CRYSTAL MUSHROOM ×0, GOLDEN CRYPT ×0, EMBER LIBRARY ×0) | DROPPED — eligibility filter already excludes those rooms; POISON pool sum recomputed 118.5 → **113.5** (§4.3). |
| 16 | GOLDEN_TEMPLE ARMORY ×1.5 without eligibility | ARMORY eligibility += GOLDEN_TEMPLE (§4.2). |
| 17 | TEMPLE "ARMORED +20%" had no code target | `ROOM_ENEMY_MODIFIERS.TEMPLE = { ARMORED: 1.2 }` added to constants + files table (§4.1, §8). |
| 18 | FLOODED_RUINS wisps had no eligibility change | Wisp eligibility += FLOODED_RUINS (recolor 0x55ddcc, same patrol) (§5.2, §6.1). |
| 19 | Missing new-light per-level cap | Explicit rule: each biome light set ≤ 20 lights/level (§6.1, §9). |
| 20 | biome-check coverage gaps | Extended to PROPS_PER_ROOM, LIGHT_SOURCES refs, ROOM_ENEMY_MODIFIERS, per-room eligibility presence (§11). |
| 21 | Pool tick owner unspecified | Located: `PropSystem.lavaPools` + `lavaHazard` → `Game._lavaDamage`. `type` key added; callback signature unchanged (§6.2). |
| 22 | Rat pack numbers in code (MIN 2 / MAX 3 / CAP 6) vs old spec | Noted as unchanged; weights independent of pack size (§7). |

---

## 15. Verification summary for implementer

Before starting: `node scripts/dungeon-check.mjs` must report broken=0/40
(baseline). After Phase 0: `node scripts/biome-check.mjs` green. Every phase
ends with a commit (repo-local convention: commit in the consolidated
games-benchmarks parent repo, plan file at `docs/BIOME_EXPANSION_PLAN.md`).
