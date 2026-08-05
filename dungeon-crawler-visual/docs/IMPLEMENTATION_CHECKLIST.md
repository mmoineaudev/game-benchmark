# Dungeon Crawler — Biome Expansion + Weapon Evolution Implementation Checklist

Implementation checklist for two CLOSED plans in this repo:

- `docs/BIOME_EXPANSION_PLAN.md` — +5 biome types (10-biome ladder, measured perf audit)
- `docs/WEAPON_EVOLUTION_PLAN.md` — souls ladder: +1 damage/100 souls to a lightsaber with electric arcs

Both plans are closed (zero open points). Execution order: **Biome first**
(data-driven content, validates the constants/probe pipeline), then **Weapon**
(combat hot paths). Each phase ends with a **commit** (repo convention:
commit-per-phase in the consolidated games-benchmarks parent repo, then push).
Every phase gate must pass before the next phase starts. A failing gate means a
hard stop — fix, commit, continue.

---

## 0. Baseline (before any change)

- [ ] `node scripts/dungeon-check.mjs` reports `broken=0/40` (baseline green)
      (Biome plan §15; Weapon plan §15)
- [ ] `git status` clean; working tree at a known commit
- [ ] READ both plans end-to-end before starting (they are the source of truth)

---

## A. Biome Expansion — docs/BIOME_EXPANSION_PLAN.md

### A0. Phase 0 — Constants scaffolding (plan §8, §11, §12 P0)

- [ ] `src/core/Constants.js`: add 5 `BIOMES` entries — CRYSTAL_DEPTHS,
      POISON_SWAMP, GOLDEN_TEMPLE, FLOODED_RUINS, EMBER_FORGE — with all 9
      palette keys matching §3 exactly (wall/floor/ceiling/fog/fogDensity/
      ambient/ambientIntensity/torchColor/label)
- [ ] Add `torchMode: 'standard' | 'vaultOnly'` to ALL 11 BIOMES entries:
      FUNGAL_CAVERN + POISON_SWAMP = `'vaultOnly'`, the other 9 = `'standard'`
      (§6.1)
- [ ] `BIOMES.SEQUENCE` → 10 entries, order per §2 (append after FROZEN_HALLS);
      `LEVELS_PER_BIOME` stays 2
- [ ] `DUNGEON.ROOM_TYPES`: + CRYSTAL_CHAMBER (weight 8, 2–3 × 2–3),
      + TEMPLE (weight 8, 3 × 3) (§4.1)
- [ ] `ROOM_BIOME_ELIGIBILITY`: rows for the 2 new rooms; ARMORY +=
      [GOLDEN_TEMPLE, EMBER_FORGE]; MUSHROOM_GROVE += [POISON_SWAMP] (§4.2)
- [ ] `BIOME_ROOM_MODIFIERS`: +5 rows exactly per §4.3 (no dead entries)
- [ ] `ENEMY_SPAWN_WEIGHTS`: +5 columns summing to exactly 100 each (§7)
- [ ] `LIGHT_SOURCES`: + CRYSTAL (0xcc66ff, 3.0, 11, 1.2), + ACID (0x88ff22,
      4.5, 16, 1.2) (§6.1)
- [ ] `PROPS.POOLS` = { LAVA, ACID } replacing `LAVA_DAMAGE/INTERVAL/RADIUS`
      (same numbers; §6.2)
- [ ] `PROPS.PROPS_PER_ROOM` += CRYSTAL_CHAMBER 10, TEMPLE 10
- [ ] `ROOM_ENEMY_MODIFIERS.TEMPLE = { ARMORED: 1.2 }`
- [ ] Perf reference constants: `LIGHT_CEILING_AVG: 154`, `LIGHT_CEILING_MAX: 199`
      (§9)
- [ ] NEW `scripts/biome-check.mjs` implementing ALL 11 gates (§11)
- [ ] **Gate A0:** `node scripts/biome-check.mjs` green (1–11);
      `node scripts/dungeon-check.mjs` = broken=0/40
- [ ] **Commit A0**

### A1. Phase 1 — Palette/texture verification (plan §12 P1)

- [ ] Headless probe forces levels 12, 15, 17, 19, 22 and asserts
      wall/floor/ceiling/fog/ambient match §3 for CRYSTAL_DEPTHS,
      POISON_SWAMP, GOLDEN_TEMPLE, FLOODED_RUINS, EMBER_FORGE
- [ ] `BiomeSystem` texture cache grows to 11 sets; regen reuses cache
      (no leak via the dispose path) (§3)
- [ ] **Gate A1:** probe green; `biome-check.mjs` green
- [ ] **Commit A1**

### A2. Phase 2 — Rooms + props (plan §5, §12 P2)

- [ ] CRYSTAL_CHAMBER placement: crystal clusters (3) + magenta stalactites;
      decoration density 10 (§4.1)
- [ ] TEMPLE placement: altar (1), lit brazier (1), banners (2), pillars (2);
      density 10 (§4.1)
- [ ] PropSystem: +5 per-biome prop-set entries exactly per §5.2
- [ ] Prop 18 crystal cluster — density **1 cluster/room** (perf cap, §5.1),
      3–5 crystals, CRYSTAL light
- [ ] Prop 19 acid pool — 1–2/room, ≥ 3 u from exit, hazard 1 dmg / 0.8 s /
      1.2 u, ACID light (§5.1)
- [ ] Prop 20 water pool — decorative, **InstancedMesh** (1 draw call, shared
      material, global opacity pulse), no hazard/collision (§5.1)
- [ ] Prop 21 altar — 1/TEMPLE, back wall, 0xffcc66 light (§5.1)
- [ ] Prop 22 anvil — 1–2/room, decorative (§5.1)
- [ ] `lavaPools` entries gain `type: 'LAVA' | 'ACID'`; tick reads
      `PROPS.POOLS[type]`; `lavaHazard` callback signature unchanged (§6.2)
- [ ] Wisp eligibility += FLOODED_RUINS (recolor 0x55ddcc, same patrol);
      lava eligibility += EMBER_FORGE (color unchanged) (§5.2)
- [ ] All props respect: rooms only, ≥ 1 cell from corridor openings, never on
      exit cell, breakables ≤ 3/room (§5)
- [ ] **Gate A2:** `biome-check.mjs` green; `renderer.info` prop counts
      (≤ 400 instances, +≤ 3 draw calls); dungeon-check 0/40
- [ ] **Commit A2**

### A3. Phase 3 — Lighting (plan §6, §8, §12 P3)

- [ ] `LightingSystem._placeAllTorches` reads `palette.torchMode` instead of
      `torchColor === 0x44ff88` (FUNGAL behavior preserved)
- [ ] `_placeBraziers` room list extends to TEMPLE when biome is GOLDEN_TEMPLE
      (1 light per TEMPLE) (§4.1)
- [ ] CRYSTAL/ACID light sources wired; all new lights `castShadow = false`
- [ ] Pool parametrization sweep: `PROPS.LAVA_*` → `PROPS.POOLS` consumers
      updated (PropSystem + Game); lava numbers/colors byte-identical (§6.2)
- [ ] Per-biome light placement per §6.1 table (crystal 1 cluster/room;
      poison torchless + acid 1–2 + mushrooms; golden altar + brazier +
      chandeliers incl. TEMPLE; ruins wisps 1/room; forge lava 1/room)
- [ ] **Gate A3 (perf, hard):** light probe (10 seeds/biome) — every SEQUENCE
      biome avg ≤ 154 / max ≤ 199; `vaultOnly` biomes ≤ 2 torches avg (FUNGAL
      regression); shadow-casters = 8 (§9, §11)
- [ ] **Commit A3**

### A4. Phase 4 — Spawn verification (plan §12 P4)

- [ ] Headless spawn probe over each new biome asserts enemy mix matches §7
      columns (weighted sample ± tolerance)
- [ ] Wraith weight stays 0 in all new biomes (crypt-exclusive rule intact)
- [ ] Elite rolls unchanged (1-in-10, elite-eligible types only)
- [ ] **Gate A4:** probe green; `biome-check.mjs` green
- [ ] **Commit A4**

### A5. Phase 5 — Biome final gates (plan §12 P5)

- [ ] Full descend 1 → 25 (3 descends): every biome reached in ladder order,
      boss levels at 7/14/21 correct (§2 table)
- [ ] Memory stable over 3 descends; no console errors; no light/texture leaks
- [ ] `node scripts/dungeon-check.mjs` = broken=0/40;
      `node scripts/biome-check.mjs` green
- [ ] **Commit A5**

---

## B. Weapon Evolution — docs/WEAPON_EVOLUTION_PLAN.md

### B0. Phase 0 — Constants, state, counter (plan §2, §6, §8, §12 P0)

- [ ] `src/core/Constants.js`: NEW `EVOLUTION` block exactly per §3
      (TIER_SOULS 100, MAX_TIER 5, DAMAGE_PER_TIER 1, BLADE_LENGTH
      [0.76, 0.81, 0.86, 0.92, 0.96, 1.0], RANGE_PER_TIER 0.04,
      MAX_TOTAL_SCALE 5.0, ARC_CHANCE/ARC_BOLTS/ARC_POOL 8/ARC_SPEED 24/
      ARC_LIFE 1.2/ARC_DAMAGE 1/ARC_RANGE 20, BOLT_COLOR, T5_BLADE_LIGHT)
- [ ] **Bug fix (owned):** hoist `SWORD.ELECTRIC_CHANCE` (0.01) and
      `SWORD.ELECTRIC_RANGE` (20) to the `SWORD` level; update `Game` refs
      (lines 779, 885) (§6)
- [ ] `GameState`: +`soulsEarned: 0`, +`weaponTier: 0` (constructor params)
- [ ] `OrbSystem`: `state.soulsEarned++` in the orb-pickup branch ONLY (not
      buff/health pickups) (§2)
- [ ] NEW `scripts/weapon-check.mjs` implementing ALL 8 gates (§11)
- [ ] **Gate B0:** `node scripts/weapon-check.mjs` green (1–8);
      `node scripts/dungeon-check.mjs` = broken=0/40
- [ ] **Commit B0**

### B1. Phase 1 — Damage ladder + HUD (plan §3, §7, §12 P1)

- [ ] Pure function `swordHitDamage(step, tier) = HIT{1,2,3}_DAMAGE + tier`
      in Game's hit path; constants never mutated (§3)
- [ ] Tier recompute on every pickup: `min(floor(soulsEarned/100), 5)`;
      stored in `state.weaponTier`; persists across regens (§2)
- [ ] HUD: `#souls-line` (`Souls: N · Tier T · M/100`, `MAX` at tier 5) +
      `#tier-pips` (5 pips, lit = earned) in `index.html` (§7)
- [ ] Evolution toast on threshold crossing + blade flash + 0.1 s non-blocking
      hit-stop; final tier toast `Your blade is whole — the lightsaber sings`
      (§7)
- [ ] **Gate B1:** headless tier-math probe (0/99/100/199/200/500/999 →
      0/0/1/1/2/5/5); DOM ids present; dungeon-check 0/40
- [ ] **Commit B1**

### B2. Phase 2 — Visuals T1–T2 (plan §4, §12 P2)

- [ ] Tier 1: bronze fuller/edge recolor 0xd8a060; blade + tip meshes scaled
      to BLADE_LENGTH[1] = 0.81; TIP_LOCAL.y = 0.64 (§4)
- [ ] Tier 2: 2 emissive blue stripe planes (0x4ac8ff) on blade faces + hilt
      glow band; blade length 0.86; TIP_LOCAL.y = 0.68 (§4)
- [ ] `TIP_LOCAL` derived from `BLADE_LENGTH[tier] × 0.79` at every tier
      (trails + hit arcs follow the tip) (§4)
- [ ] **Gate B2:** console/visual probe — scale values match table; straight
      geometry; floating weapon (no hands); layer-2 self-lit preserved
- [ ] **Commit B2**

### B3. Phase 3 — T3–T4 energy blade + arc ladder + proc fix (plan §5, §6, §12 P3)

- [ ] Tier 3: steel blade/tip hidden; ONE straight additive cylinder
      (0.045 × 0.92, 0x66eeff, opacity 0.85, depthWrite false) + white-hot
      core line; blade color no longer follows BLADE_COLORS (§4)
- [ ] Tier 4: core emissive 2.0, glow sprite 0.3 → 0.5, hum pulse ±5% @ 3 Hz;
      blade length 0.96 (§4)
- [ ] Arc bolt pool (8): thin cylinder + glow sprite, homes to nearest alive
      enemy ≤ 20 u, speed 24 u/s, life 1.2 s, damage 1, re-target on target
      death, fizzle at life end (§5)
- [ ] Proc table wired: T3 = 10% → 1 bolt; T4 = 35% → 1 bolt (§5)
- [ ] **Electric proc now actually fires** (1% legendary blast, §6) — prove it
      headlessly; `weapon-check.mjs` gate 5 green
- [ ] **Gate B3:** arc proc table matches constants; proc fires; energy blade
      is a straight cylinder; pool ≤ 8; no per-frame alloc
- [ ] **Commit B3**

### B4. Phase 4 — T5 lightsaber (plan §4, §5, §12 P4)

- [ ] Tier 5: blade 0x88ffff + white core, length 1.00, TIP_LOCAL.y = 0.79 (§4)
- [ ] 2 arc bolts on EVERY landing strike (up to 6/cycle ≤ pool 8) (§5)
- [ ] Idle crackle: ≤ 3 pooled additive arc sprites, cosmetic (§5)
- [ ] `T5_BLADE_LIGHT` point light (0x66eeff, 1.5, dist 6, decay 1.6, no
      shadow, layer 0, camera-attached); disposed/rebuilt with the form (§4, §9)
- [ ] **Gate B4:** pool ≤ 8; lights +1 only; no per-frame alloc; dungeon-check
      0/40
- [ ] **Commit B4**

### B5. Phase 5 — Weapon final gates (plan §12 P5)

- [ ] Full descend: weapon evolves 0 → 5 across a run; form persists through
      level regens; arcs behave at every combo step
- [ ] No console errors; memory stable; `weapon-check.mjs` green;
      `dungeon-check.mjs` = broken=0/40
- [ ] **Commit B5**

---

## C. Cross-cutting integration gate (both plans together)

- [ ] Full run 1 → 25 through all 10 biomes with the weapon evolving to T5:
      no biome/weapon interaction regressions (edge cases §10 of both plans)
- [ ] All three scripts green in one pass:
      `dungeon-check.mjs` (0/40), `biome-check.mjs` (1–11), `weapon-check.mjs` (1–8)
- [ ] Measured perf matches plan tables: biome light probe ≤ ceiling (§9);
      weapon +1 light / 8 bolts / ≤ 4 draw calls (§9)
- [ ] No console errors, no leaks over 3 descends
- [ ] **Final commit + push**

---

## Implementation Notes

- **Priority:** A0 (constants + biome-check) is the critical path — everything
  else reads from it. B0's ELECTRIC hoist is a bug fix and must land before
  B3/B4 (they depend on the proc firing).
- **Dependencies:** Biome before weapon (content pipeline first; combat hot
  paths second). Within each plan, phases are strictly sequential — a phase's
  gate is the entry ticket to the next.
- **Ordering rationale:** A and B share no constants (BIOMES vs EVOLUTION), so
  the two ladders could interleave; sequential keeps the diff and the probes
  reviewable.
- **Commit rule:** one commit per phase (A0–A5, B0–B5, C), in the consolidated
  parent repo (`games-benchmarks`), pushed after each — do NOT `git add` the
  child as a gitlink.
- **Perf policy:** 30 fps floor. Gates are hard — if the light probe or a pool
  check fails, cut content decisively (torchless pattern, density caps) rather
  than tweaking. Do NOT lower `LIGHT_CEILING_AVG/MAX` to make a failing biome
  pass.
- **Regression markers:** FUNGAL torch layout, Skeleton/Magician behavior,
  VOLCANIC lava numbers, and sword combo timings must stay byte-identical —
  they are the regression gates (biome plan §13; weapon plan §13).

## Open Issues

None — both source plans are CLOSED with zero TBDs (biome plan §14: 29 rows;
weapon plan §14: 26 rows). If a phase gate surfaces a contradiction, fix the
plan first (commit), then the code.

## Testing Items

- `node scripts/dungeon-check.mjs` → broken=0/40 (every phase)
- `node scripts/biome-check.mjs` → gates 1–11 (A0 onward)
- `node scripts/weapon-check.mjs` → gates 1–8 (B0 onward)
- Light probe (10 seeds/biome): avg ≤ 154, max ≤ 199, vaultOnly torches ≤ 2
  (A3, then every biome phase)
- Headless DOM probes for `#souls-line`, `#tier-pips`, biome label
- `renderer.info`: draw calls ≤ 120, prop instances ≤ 400, lights ≤ ceiling,
  shadow-casters = 8
- Memory: stable over 3 descends (no texture/light/geometry leaks)
