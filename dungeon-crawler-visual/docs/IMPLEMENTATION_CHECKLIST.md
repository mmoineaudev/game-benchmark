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

- [x] `src/core/Constants.js`: add 5 `BIOMES` entries — CRYSTAL_DEPTHS,
      POISON_SWAMP, GOLDEN_TEMPLE, FLOODED_RUINS, EMBER_FORGE — with all 9
      palette keys matching §3 exactly (wall/floor/ceiling/fog/fogDensity/
      ambient/ambientIntensity/torchColor/label)
- [x] Add `torchMode: 'standard' | 'vaultOnly'` to ALL 11 BIOMES entries:
      FUNGAL_CAVERN + POISON_SWAMP = `'vaultOnly'`, the other 9 = `'standard'`
      (§6.1)
- [x] `BIOMES.SEQUENCE` → 10 entries, order per §2 (append after FROZEN_HALLS);
      `LEVELS_PER_BIOME` stays 2
- [x] `DUNGEON.ROOM_TYPES`: + CRYSTAL_CHAMBER (weight 8, 2–3 × 2–3),
      + TEMPLE (weight 8, 3 × 3) (§4.1)
- [x] `ROOM_BIOME_ELIGIBILITY`: rows for the 2 new rooms; ARMORY +=
      [GOLDEN_TEMPLE, EMBER_FORGE]; MUSHROOM_GROVE += [POISON_SWAMP] (§4.2)
- [x] `BIOME_ROOM_MODIFIERS`: +5 rows exactly per §4.3 (no dead entries)
- [x] `ENEMY_SPAWN_WEIGHTS`: +5 columns summing to exactly 100 each (§7)
- [x] `LIGHT_SOURCES`: + CRYSTAL (0xcc66ff, 3.0, 11, 1.2), + ACID (0x88ff22,
      4.5, 16, 1.2) (§6.1)
- [x] `PROPS.POOLS` = { LAVA, ACID } replacing `LAVA_DAMAGE/INTERVAL/RADIUS`
      (same numbers; §6.2) — added; legacy keys removed in A3
- [x] `PROPS.PROPS_PER_ROOM` += CRYSTAL_CHAMBER 10, TEMPLE 10
- [x] `ROOM_ENEMY_MODIFIERS.TEMPLE = { ARMORED: 1.2 }`
- [x] Perf reference constants: `LIGHT_CEILING` (AVG 154 / MAX 199;
      vaultOnly torch avg 10 / max 50, calibrated to the existing fungal biome)
      (§9)
- [x] NEW `scripts/biome-check.mjs` implementing ALL 11 gates (§11) — gate 10
      uses the faithful placement model (chain lights, not chandeliers); gate 5
      exempts FLOODED_RUINS (no signature room by design)
- [x] **Gate A0:** `node scripts/biome-check.mjs` green (1–11);
      `node scripts/dungeon-check.mjs` = broken=0/40
- [x] **Commit A0**

### A1. Phase 1 — Palette/texture verification (plan §12 P1)

- [x] Headless probe forces levels 12, 13, 15, 17, 19, 22 and asserts they map
      to CRYSTAL_DEPTHS, POISON_SWAMP, GOLDEN_TEMPLE, FLOODED_RUINS, EMBER_FORGE,
      STONE (cycle restart) per the corrected §2 table; wall/floor/ceiling/fog/
      ambient match §3 for each new biome
- [x] `BiomeSystem` texture cache is LAZY — builds each biome set on first use
      (11 sets max); regen reuses cache
      (no leak via the dispose path) (§3) — data-driven, no code change;
      cache growth verified by inspection (texturesFor keys off BIOMES)
- [x] **Gate A1:** probe green; `biome-check.mjs` green
- [x] **Commit A1**

### A2. Phase 2 — Rooms + props (plan §5, §12 P2)

- [x] CRYSTAL_CHAMBER placement: crystal clusters (3) + magenta stalactites;
      decoration density 10 (§4.1)
- [x] TEMPLE placement: altar (1), lit brazier (1 — A3), banners (2 — adapted:
      banners/roots don't exist in the codebase; TEMPLE gets pillars (2) instead),
      pillars (2); density 10 (§4.1)
- [x] PropSystem: +5 per-biome prop-set entries exactly per §5.2 (stalactites
      implemented as instanced ceiling cones for crystal/poison; roots/vines and
      banners omitted — not in the implemented prop catalog)
- [x] Prop 18 crystal cluster — density **1 cluster/room** (perf cap, §5.1),
      3–5 crystals, CRYSTAL light; CRYSTAL_CHAMBER gets 3 dedicated clusters
- [x] Prop 19 acid pool — 1–2/room, ≥ 3 u from exit, hazard 1 dmg / 0.8 s /
      1.2 u, ACID light (§5.1)
- [x] Prop 20 water pool — decorative, **InstancedMesh** (1 draw call, shared
      material, global opacity pulse), no hazard/collision (§5.1)
- [x] Prop 21 altar — 1/TEMPLE, back wall, 0xffcc66 light (§5.1)
- [x] Prop 22 anvil — 1–2/room, decorative (§5.1)
- [x] `lavaPools` entries gain `type: 'LAVA' | 'ACID'`; tick reads
      `PROPS.POOLS[type]`; `lavaHazard` callback signature unchanged (§6.2)
- [x] Wisp eligibility += FLOODED_RUINS (recolor 0x55ddcc, same patrol);
      lava eligibility += EMBER_FORGE (color unchanged) (§5.2)
- [x] All props respect: rooms only, ≥ 1 cell from corridor openings, never on
      exit cell, breakables ≤ 3/room (§5)
- [x] **Gate A2:** `biome-check.mjs` green; headless smoke test (canvas-stub
      PropSystem per biome): no crashes, CRYSTAL/ACID/water/anvil/altar/
      stalactite placement verified, pool types valid, real per-level prop
      lights ≤ heaviest existing biome; dungeon-check 0/40
- [x] **Commit A2**

### A3. Phase 3 — Lighting (plan §6, §8, §12 P3)

- [x] `LightingSystem._placeAllTorches` reads `palette.torchMode` instead of
      `torchColor === 0x44ff88` (FUNGAL behavior preserved — verified by probe)
- [x] `_placeBraziers` extends to TEMPLE when the biome is GOLDEN_TEMPLE —
      data-driven via `palette.brazierRooms` (1 light per TEMPLE) (§4.1)
- [x] CRYSTAL/ACID light sources wired (A2); all new lights `castShadow = false`
- [x] Pool parametrization sweep: `PROPS.LAVA_*` → `PROPS.POOLS` consumers
      updated (PropSystem + Game); lava numbers/colors byte-identical (§6.2)
- [x] Per-biome light placement per §6.1 table (crystal 1 cluster/room;
      poison torchless + acid 1–2 + mushrooms; golden altar + brazier +
      chains; ruins wisps 1/room; forge lava 1/room)
- [x] **Gate A3 (perf, hard):** headless LightingSystem probe — shadow-casters
      = 8 on every biome incl. SPECTRAL_COURT; vaultOnly torch max ≤ 50;
      real per-level light totals: new biomes 96–105 avg vs existing 96–102
      (parity); golden braziers = HALL + TEMPLE rooms
- [x] **Commit A3**

### A4. Phase 4 — Spawn verification (plan §12 P4)

- [x] Headless spawn probe over each new biome asserts enemy mix matches §7
      columns (50k samples/biome, ±3pp tolerance; zero-weight types never
      picked) — all 10 columns verified
- [x] Wraith weight stays 0 in all new biomes (crypt-exclusive rule intact)
- [x] Elite rolls unchanged (1-in-10, elite-eligible types only — no code
      touched)
- [x] **Gate A4:** probe green; `biome-check.mjs` green
- [x] **Commit A4**

### A5. Phase 5 — Biome final gates (plan §12 P5)

- [x] Full descend 1 → 25 (3 descends): every biome reached in ladder order,
      boss levels at 7/14/21/28 correct — sequence PROBE-VERIFIED against
      `biomeForLevel` (§2 table, corrected to actual formula output; bosses
      pre-empt one rung each: VOLCANIC 8, POISON 13, STONE 22, VOLCANIC 27)
- [x] Memory stable over 3 descends; no console errors; no light/texture leaks —
      headless: 75 full level builds (WorldBuilder + PropSystem +
      LightingSystem) dispose to 0 scene children (Game._disposeScene pattern)
- [x] `node scripts/dungeon-check.mjs` = broken=0/40;
      `node scripts/biome-check.mjs` green
- [x] **Commit A5**

---

## B. Weapon Evolution — docs/WEAPON_EVOLUTION_PLAN.md

### B0. Phase 0 — Constants, state, counter (plan §2, §6, §8, §12 P0)

- [x] `src/core/Constants.js`: NEW `EVOLUTION` block exactly per §3
      (TIER_SOULS 100, MAX_TIER 5, DAMAGE_PER_TIER 1, BLADE_LENGTH
      [0.76, 0.81, 0.86, 0.92, 0.96, 1.0], RANGE_PER_TIER 0.04,
      MAX_TOTAL_SCALE 5.0, ARC_CHANCE/ARC_BOLTS/ARC_POOL 8/ARC_SPEED 24/
      ARC_LIFE 1.2/ARC_DAMAGE 1/ARC_RANGE 20, BOLT_COLOR, T5_BLADE_LIGHT)
      + `weaponTier()` / `swordHitDamage()` pure functions
- [x] **Bug fix (owned):** hoist `SWORD.ELECTRIC_CHANCE` (0.01) and
      `SWORD.ELECTRIC_RANGE` (20) to the `SWORD` level; Game refs now resolve
      (§6) — gate 5 proves the proc is reachable
- [x] `GameState`: +`soulsEarned: 0`, +`weaponTier: 0` (constructor params);
      carried on level-advance state rebuild in Game
- [x] `OrbSystem`: `state.soulsEarned++` in the orb-pickup branch ONLY (not
      buff/health pickups) (§2)
- [x] NEW `scripts/weapon-check.mjs` implementing ALL 8 gates (§11)
- [x] **Gate B0:** `node scripts/weapon-check.mjs` green (1–8);
      `node scripts/dungeon-check.mjs` = broken=0/40
- [x] **Commit B0**

### B1. Phase 1 — Damage ladder + HUD (plan §3, §7, §12 P1)

- [x] `PlayerSword.currentDamage = swordHitDamage(step, tier) × damageMult`
      (pure-function base; existing size scaling preserved); `setTier(tier)`
      with `_applyForm` hook (visuals B2–B4); range `+4%` per tier;
      `setOrbCount` scale clamped at `MAX_TOTAL_SCALE` (§3)
- [x] Tier recompute every frame: `weaponTier(soulsEarned)` → `state.weaponTier`
      on change; evolves mid-level with toast + blade flash + 0.1 s hit-stop;
      re-synced on `level:start` (§2, §7)
- [x] HUD: `#souls-line` (`Souls N · Tier T · M/100`, `MAX` at tier 5) +
      `#tier-pips` (5 pips, lit = earned) in `index.html`; ammo label renamed
      SOULS → ORBS (two counters, two labels) (§7) — SHIPPED but SUPERSEDED
      by the total-only ruling (B4', §7.1)
- [x] **Gate B1:** headless probe — tier damage 2/2/3 → 7/7/8, range ×1.2 at
      tier 5, scale clamp 5.0, weaponTier 237→2/500→5/999→5; weapon-check 1–8
      green; dungeon-check 0/40
- [x] **Commit B1**

### B2. Phase 2 — Distinct models (plan §4 "Arsenal of Ascension", §12 P2–P3) — SHIPPED 2026-08-05

NOTE (2026-08-05): the OLD B2 trims (bronze fuller recolor, blue stripe
planes, torus hilt band) were in the code and are REPLACED by the distinct-
model redesign — the torus band is deleted (gate 10 enforces).

- [x] §4.3 rewrite: `_applyForm` dispatch + per-tier builders
      (`_formCleaver` … `_formLightsaber`), `_formMeshes[tier]` registry,
      one-form-visible rule, `TIP_LOCAL = BLADE_LENGTH[tier] × 0.79` (§4.2/§4.3)
- [x] `_formArmingSword` (T1): steel blade Box(0.05, 0.40, 0.012) + cone tip +
      fuller + brass crossguard Box(0.16, 0.03, 0.05) + grip + brass pommel
      (§4.2 T1)
- [x] `_formRunicGreatsword` (T2): wide steel blade + 3 runes Box(0.004, 0.09,
      0.002) MeshBasic 0x4ac8ff + long grip + rectangular guard; old stripe
      planes + torus hilt band DELETED (§4.2 T2)
- [x] `_formCrystalSoulblade` (T3): spine + 4 faceted cones on a white core,
      crystalMat (0xcc88ff/0xcc66ff) (§4.2 T3)
- [x] `_formSoulfireGreatblade` (T4): energy cylinder 0xddddff + core + 2 vent
      fins; hum pulse retargeted to the T4 core (§4.2 T4)
- [x] `_formLightsaber` (T5): unchanged cylinder 0x88ffff + core + bladeLight +
      crackle; `flashBlade()` form-aware (§4.2 T5)
- [x] **Gate B2/B3:** weapon-check gates 9–10 green; straight geometry (no
      Torus), layer-2 self-lit; browser-smoke builds all six forms in-browser
      with 0 JS exceptions
- [x] **Commit B2/B3** (f8aa0da)

### B3. Phase 3 — T3–T4 energy blade + arc ladder + proc fix (plan §5, §6, §12 P3)

NOTE (2026-08-05): the "steel hidden, ONE straight additive cylinder" items
below are the OLD T3–T4 design — SUPERSEDED by the distinct models
`_formCrystalSoulblade`/`_formSoulfireGreatblade` (shipped with B2). The arc
ladder + proc fix items remain accurate and are SHIPPED.

- [x] Tier 3: steel blade/tip hidden; ONE straight additive cylinder
      (0.045 × 0.92, 0x66eeff, opacity 0.85, depthWrite false) + white-hot
      core line; blade color no longer follows BLADE_COLORS (§4)
- [x] Tier 4: core hum pulse ±5% @ 3 Hz; blade length 0.96 (§4)
- [x] Arc bolt pool (8): thin cylinder + glow, homes to nearest alive enemy
      ≤ 20 u, speed 24 u/s, life 1.2 s, damage 1, re-target on target death,
      fizzle at life end (§5)
- [x] Proc table wired: T3 = 10% → 1 bolt; T4 = 35% → 1 bolt (§5)
- [x] **Electric proc now actually fires** (1% legendary blast, §6) — constants
      hoisted (B0), gate 5 green; blast runs on every landing strike
- [x] **Gate B3:** headless probe — energy blade straight/visible/length/
      additive/color-guard/hum; arc bolts spawn → nearest-target → impact
      damage → re-target on death → pool ≤ 8 → teardown reset; weapon-check
      1–8 green; dungeon-check 0/40
- [x] **Commit B3**

### B4. Phase 4 — HUD total-only (plan §7, §7.1) — SHIPPED 2026-08-05

- [x] index.html: `#souls-line` default exactly `Souls 0`; `#tier-pips` div +
      CSS removed (§7.1)
- [x] Game.js: `_tierPipsEl` binding removed; `_updateHUD` writes
      `Souls ${soulsEarned}` only (no tier/progress/MAX) (§7.1)
- [x] weapon-check gate 7 inverted (asserts `#tier-pips` ABSENT + `Souls 0`)
      and gate 11 (Game.js total-only grep) (§11)
- [x] browser-smoke asserts `Souls 0` + `#perf-warning` present/hidden
- [x] **Commit B4** (d9b8162)

### B4'. Phase 4' — Perf safeguard / degraded mode (user feature, §16) — SHIPPED 2026-08-05

- [x] Game._updatePerfMonitor: EMA fps; <30 fps for >10 s → `_degraded`
- [x] PropSystem.reduceDecorations(0.5): halves cosmetic props + instanced
      tail; hazards/breakables/structure/biome lights untouched
- [x] New levels build at 50% density while degraded; `#perf-warning`
      bottom-right label + CSS
- [x] **Commit** (b7e6da1)

### B4'''. Perf overhaul — spike-aware degraded tiers + render budget (PERFORMANCE_PLAN.md) — SHIPPED 2026-08-05

The EMA safeguard was structurally blind to the real symptom (periodic
hitches: a 1 s 5 fps spike only moved the EMA 60 → 57, and dt > 0.25 frames
were excluded entirely). Replaced with a spike-aware tiered system; the plan
is `docs/PERFORMANCE_PLAN.md`.

- [x] Game._updatePerfMonitor: rolling ~3 s bad-frame window (dt > 50 ms = 1,
      dt > 250 ms = 3, fed the RAW uncapped dt); 6 bad frames escalate a tier,
      10 clean seconds de-escalate one tier (recovery restores shadows/post)
- [x] Tiers: 1 = hide 50% decoratives (existing reduceDecorations),
      2 = torch shadows off (LightingSystem.setShadowBudget), 3 = post off
      + second deco cut; `#perf-warning` shows the active tier
- [x] Shadow budget: TORCH_SHADOW_COUNT 8 → 1 (48 cube depth passes/frame →
      6); static assignment at level build (nearest torches to entrance) —
      the per-0.5 s re-sort + castShadow toggles that caused the recurring
      hitches are gone; PCFSoftShadowMap → PCFShadowMap
- [x] Light budget: torch spacing 16 → 20; decorative lights removed
      (chains, candles, ice crystals, mushrooms, crystal clusters → emissive
      only); crystal clusters capped at 3; lava/acid/wisps/altar lights kept
- [x] Post budget: bloom at half res, enemy glow half-rate at quarter res
      (30 Hz, ~1 frame stale — imperceptible), zero per-frame Set allocation
      (setEnemyTargets diff), Game caches the alive-enemy roster
- [x] CPU/GC/HUD: stats panel innerHTML cached (was rebuilt every frame),
      combo pips queried once, biome border color written once per level,
      water puddles freeze >20 u, particle loop hoists performance.now(),
      _hasLOS cached per 3-unit cell
- [x] Instrumentation: Game._frameStats (raw dt), window.__perfSeed dungeon
      seed hook, scripts/perf-probe.mjs (rAF fps, longtasks, light/shadow
      counts; --hard-gate enforces p95 ≤ 33 ms / max ≤ 150 ms on real
      hardware), scripts/browser-smoke.mjs asserts warning ⇔ tier consistency
- [x] Verified headless: perf-probe PASS (no exceptions; shadow torches 1 vs
      old 8; longtasks 72 → ~46), degraded tiers 9/9 (escalation, cuts,
      recovery), browser-smoke PASS, level-regen check PASS (1 → 2)
- [x] **Commit** (perf overhaul — one commit)

### B4''''. Kill-path fix — orb/fire-patch light churn, drop pooling, shadow prewarm (user report: "first enemy kill made the lag come back") — SHIPPED 2026-08-05

Root cause of the first-kill lag: three's program cache key includes the
point-light count (WebGLPrograms.js numPointLights/numPointLightShadows), so
ANY visible-light-count change force-recompiles every material's shader.
Orb impacts spawned a fire patch whose PointLight lived in a group that was
toggled `visible` — each activation/expiry recompiled ~30 programs (the
"orbs cause lag" report). Degraded tier 2's castShadow toggle had the same
effect (recompiling right when the game was struggling).

- [x] Fire patches: the 6 pooled patch lights stay VISIBLE for the whole
      level — the glow sprite + light intensity carry the FX; light count is
      now constant per level → zero recompiles on orb kill/impact/expiry
      (verified: programs 36 → 36 across kill + patch + pickup)
- [x] OrbSystem drop pooling: kill drops, health pickups and buff pickups
      reuse pooled meshes/groups (round-robin, recycled on pickup) — kills no
      longer allocate or scene.add/remove (recurring per-kill GC source)
- [x] LightingSystem.prewarmShadowVariants: two throwaway renders at level
      build cache BOTH shadow program variants, so the degraded tier-2
      castShadow toggle is free instead of a mid-game recompile storm
      (verified: tier-2 fire 36 → 36; later toggles ≤ +10 stragglers)
- [x] _regenerateDungeon now applies degraded tier 2's shadow budget too
      (boot's _initLighting already did; the regen path had missed it)
- [x] Verified headless: kill-spike PASS (kill/patch/pickup zero recompiles,
      no frame > 500 ms, pool recycling, tier toggles), perf-probe PASS,
      browser-smoke PASS
- [x] **Commit** (0fc4de7 was the perf overhaul; this is the follow-up)

### B4''. T5 lightsaber finalization (shipped with B2/B3 — plan §4/§5/§12 P4)

- [x] Tier 5: blade 0x88ffff + white core, length 1.00, TIP_LOCAL.y = 0.79 (§4)
- [x] 2 arc bolts on EVERY landing strike (up to 6/cycle ≤ pool 8) — via
      ARC_CHANCE[5] = 1.0, ARC_BOLTS[5] = 2 (B3 wiring) (§5)
- [x] Idle crackle: ≤ 3 pooled additive arc sprites along the blade, cosmetic (§5)
- [x] `T5_BLADE_LIGHT` point light (0x66eeff, 1.5, dist 6, decay 1.6, no
      shadow, layer 0, camera-attached — lights the world, not the sword);
      disposed with the form (§4, §9)
- [x] **Gate B4:** headless probe — T5 color/length, light visible + layer 0 +
      no shadow, crackle emits (pool ≤ 3), sword lights = 3 total, T4/T3
      downgrades hide light/glow correctly; dungeon-check 0/40
- [x] **Commit B4**

### B5. Phase 5 — Weapon final gates (plan §12 P5)

- [x] Full descend: weapon evolves 0 → 5 across a run (100-soul thresholds
      verified at L4/L8/L12/L16/L20 in the integration probe); form persists
      through level regens; arcs behave at every combo step
- [x] No console errors; memory stable; `weapon-check.mjs` green;
      `dungeon-check.mjs` = broken=0/40
- [x] **Commit B5**

---

## C. Cross-cutting integration gate (both plans together)

- [x] Full run 1 → 25 through all 10 biomes with the weapon evolving to T5:
      no biome/weapon interaction regressions (headless: 75 full level builds,
      all 10 biomes + SPECTRAL_COURT, sword tier-synced every level)
- [x] All three scripts green in one pass:
      `dungeon-check.mjs` (0/40), `biome-check.mjs` (1–11), `weapon-check.mjs` (1–8)
- [x] Measured perf matches plan tables: biome light probe ≤ ceiling (§9);
      weapon +1 light / 8 bolts / ≤ 4 draw calls (§9)
- [x] No console errors, no leaks over 3 descends
- [x] **Final commit + push**

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

Biome plan: SHIPPED and green (verified 2026-08-05) — biome-check ALL GATES
PASS incl. Gate 2b (palette VALUES asserted verbatim), dungeon-check 0/40,
biome-light-probe reproduces §9. §14 = 35 rows.
Weapon plan: FULLY SHIPPED (2026-08-05) — Arsenal of Ascension distinct
models (T1–T4), HUD total-only, gates 1–12 green; weapon-check ALL GATES
PASS, dungeon-check 0/40, browser-smoke PASS (0 JS exceptions). §14 = 39
rows. Perf safeguard (§16): sustained <30 fps for >10 s halves decorative
props + shows the bottom-right warning; run stays degraded. If a phase gate
surfaces a contradiction, fix the plan first (commit), then the code.

## Testing Items

- `node scripts/dungeon-check.mjs` → broken=0/40 (every phase)
- `node scripts/biome-check.mjs` → gates 1–11 (A0 onward)
- `node scripts/weapon-check.mjs` → gates 1–8 (B0 onward)
- Light probe (10 seeds/biome): avg ≤ 154, max ≤ 199, vaultOnly torches
  avg ≤ 10 / max ≤ 50 (calibrated to existing fungal)
  (A3, then every biome phase)
- Headless DOM probes for `#souls-line` (total-only), `#perf-warning`,
  biome label (browser-smoke.mjs)
- `renderer.info`: draw calls ≤ 120, prop instances ≤ 400, lights ≤ ceiling,
  shadow-casters = 8
- Memory: stable over 3 descends (no texture/light/geometry leaks)
