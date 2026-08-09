# Weapon Evolution Plan — Souls Ladder

Implementation plan for a weapon-evolution system in the dungeon crawler at
`~/Documents/games-benchmarks/dungeon-crawler-visual`.

Status: **CLOSED** — every open point from the draft arbitrated and embedded
inline; a latent electric-proc bug found and owned (§6). Resolution priority:
ease of development, maintainability, internal consistency, fun. Gap-closure log
in §12 (39 rows).

---

## 0. Implementation status (verified 2026-08-05)

STATUS: phases 0–1 SHIPPED and green. What remains is the distinct-model
redesign (§4 — NEW, replaces the shipped progressive-trims form), the HUD
total-only ruling (§7.1 — NOT yet applied: the HUD still shows tier/progress),
and the gate updates (§11). Do NOT re-implement shipped parts; change exactly
what §4.3/§7.1/§11 specify.

Verified by running (all PASS):
  node scripts/weapon-check.mjs   → weapon-check: ALL GATES PASS (8 gates)
  node scripts/dungeon-check.mjs 40 → broken=0/40

Shipped (file → what, do not touch unless §4.3/§7.1 says so):
- `Constants.js`: `EVOLUTION` block; `weaponTier()`; `swordHitDamage()`;
  `SWORD.ELECTRIC_CHANCE`/`ELECTRIC_RANGE` hoisted to the `SWORD` level (§6 fix).
- `GameState.js`: `soulsEarned` + `weaponTier` fields (constructor defaults 0).
- `OrbSystem.js`: `soulsEarned++` on the orb-pickup branch only (line ~155).
- `PlayerSword.js`: `setTier(tier)` → `_applyForm(tier)` (SHIPPED FORM = the old
  progressive-trims design: T1 bronze fuller, T2 blue stripes + torus hilt band,
  T3+ energy blade + core + glow, T5 blade light + crackle). THIS IS REPLACED
  by §4.2/§4.3. Also `currentDamage` via `swordHitDamage`; `range` includes
  `RANGE_PER_TIER`; `scale` clamped at `MAX_TOTAL_SCALE` (all keep).
- `Game.js`: `_checkWeaponEvolution()` (toast + `flashBlade()` + `hitStop 0.1`),
  `_emitLevelStart` → `sword.setTier(state.weaponTier)`, arc pool
  `_buildArcBolts`/`_spawnArcBolts`/`_updateArcBolts`/`_nearestAlive`
  (lines ~806–887), `_electricChain` proc fixed and firing, `_updateHUD`
  souls-line block (lines ~1595–1608 — REPLACED by §7.1).
- `index.html`: `#souls-line` (default `Souls 0 · Tier 0 · 100/100`) +
  `#tier-pips` (REPLACED by §7.1). Slot label still reads "Dagger".
- `scripts/weapon-check.mjs`: gates 1–6 + 8 pass; gate 7 asserts `#tier-pips`
  EXISTS — updated by §11 (must assert its ABSENCE after §7.1).

IMPLEMENTATION COMPLETE (2026-08-05): the delta below shipped and verified —
`node scripts/weapon-check.mjs` ALL GATES PASS (1–12), `node scripts/dungeon-check.mjs 40`
broken=0/40, and `node scripts/browser-smoke.mjs` PASS (headless boot: WebGL2
renderer, total-only HUD, perf warning present + hidden, zero JS exceptions;
level start builds all six forms in-browser). See also the degraded-mode perf
safeguard (§16) added the same day.

---

## 1. Overview

Every 50 souls the sword evolves (ladder 50/100/200/400/800 — halved from the
original 100/200/400/800/1600 by user ruling): **+1 base damage per evolution**
and a new aesthetic, stepping from the default blade up to **a lightsaber that
throws electric arcs**. Progression is strictly cumulative — damage and effect
both grow, the form never reverts.

Final design constraints:

1. **Souls = lifetime orb pickups.** The game's currency is orbs: picked up from
   kills, spent as ammo (`Game._handleShooting` decrements `collectedOrbs` on the
   first step of each sequence). The tier derives from the SINGLE souls counter
   (`collectedOrbs` — souls = orbs, one notion) and only ever upgrades (the
   max-reached tier is locked in `state.weaponTier`), so spending ammo never
   downgrades the blade.
2. **Sword only.** The melee weapon (floating executioner-style dagger, 3-hit
   combo) evolves. The ranged orb weapon is untouched — `orbDamageMultiplier`
   (already +2% per held orb) keeps its own scaling.
3. **Progressive in damage AND effect.** +1 per hit per tier; electric arcs ramp
   from a rare proc to guaranteed bolts at the final tier. Arc bolts deal ORB
   damage (user ruling); the T5 chain blast is damage-based (5% × 5 orb damage).
4. **No new mechanics.** Reuses the existing combo, hit, projectile-pool, and
   HUD patterns. No new keys, no new enemy logic, no new systems.
5. **Established taste holds.** Blade stays STRAIGHT (no bends — energy blade is
   a straight cylinder), weapon stays FLOATING (no hands), materials stay
   self-lit on layer 2 (never lit by the headlight), no shadow casting.
6. **Size is tier-driven** (user ruling): the blade no longer grows with orbs
   held — size = 1 + 0.8·tier (×5 at T5), EMPOWERED lengthMult stacks on top,
   clamped at MAX_TOTAL_SCALE 5.0. Attack speed = 1 + 0.001·souls (+100% at
   1000 souls), with buff multipliers applying on top.

---

## 2. Soul economy (FINAL)

- **ONE souls counter** (user ruling: souls = orbs): `state.collectedOrbs` is the
  banked ammo, score, spawn driver AND the weapon-ladder source. There is no
  separate `soulsEarned` field — spending ammo never downgrades the blade
  because `state.weaponTier` locks at the max reached (only-upgrade guard in
  `Game._checkWeaponEvolution`).
- Tier = `weaponTier(collectedOrbs)` — thresholds 50/100/200/400/800 (halved
  from 100/200/400/800/1600, user ruling), capped at `MAX_TIER`. Recompute on
  every pickup (and on boss-kill soul rewards); store in `state.weaponTier`;
  persists across level regens AND NG+ (the ladder is never reset).
- NG+ keeps the tier (no downgrade to Dagger); the 75% soul toll still shapes
  how fast the ladder re-climbs after a death.

---

## 3. Evolution ladder (FINAL)

`EVOLUTION = { TIER_SOULS: 50, TIER_THRESHOLDS: [50,100,200,400,800], MAX_TIER: 5,
DAMAGE_PER_TIER: 1, SIZE_PER_TIER: 0.8, ATTACK_SPEED_PER_SOUL: 0.001,
BLADE_LENGTH: [0.76, 0.81, 0.86, 0.92, 0.96, 1.0],  // form length per tier (u)
RANGE_PER_TIER: 0.04, MAX_TOTAL_SCALE: 5.0,
ARC_CHANCE: [0, 0, 0, 0.10, 0.35, 1.0], ARC_BOLTS: [0, 0, 0, 1, 1, 2],
ARC_POOL: 8, ARC_SPEED: 24, ARC_LIFE: 1.2, ARC_RANGE: 20,
BOLT_COLOR: 0x66eeff, T5_BLADE_LIGHT: { color: 0x66eeff, intensity: 1.5,
distance: 6, decay: 1.6 } }`

| Tier | Souls | Form | Damage (per hit) | Effects |
|---|---|---|---|---|
| 0 | 0–99 | Default blade (current, unchanged) | 2 / 2 / 3 | legendary electric proc (1%, fixed — §6) |
| 1 | 100–199 | Slightly bigger (×1.12), bronze edge tint | 3 / 3 / 4 | — |
| 2 | 200–299 | Bigger (×1.25), blue energy edge stripe | 4 / 4 / 5 | — |
| 3 | 300–399 | Energy blade (translucent), white-hot core (×1.40) | 5 / 5 / 6 | arc bolt 10% chance |
| 4 | 400–499 | Bright energy blade, humming glow (×1.55) | 6 / 6 / 7 | arc bolt 35% chance |
| 5 | 500+ | **Lightsaber throwing electric arcs** (×1.70) | 7 / 7 / 8 | 2 arc bolts on EVERY landing strike + idle crackle |

- **Damage application (FINAL):** pure function — no constant mutation:
  `swordHitDamage(step, tier) = SWORD.COMBO.HIT{1,2,3}_DAMAGE + tier`. Applied
  in `Game`'s sword-hit path for all three steps. At tier 5: 7/7/8.
- **Cap (FINAL):** 500 souls = tier 5 = max. Beyond that damage and arcs stop
  growing (the souls counter keeps counting; there is no `MAX` readout).
  Uncapped damage would trivialize the fixed-HP
  roster (brute 8, armored 5) — capped, tier 5 still needs 2 hits on a brute
  (7+7) and 1-hit clears the rest, which is the intended endgame power fantasy,
  offset by the existing spawn pressure (held orbs raise enemy counts).
- **Range (FINAL):** `range = SWORD.RANGE × _rangeScale × (1 + RANGE_PER_TIER ×
  tier)` — +4% reach per tier (+20% at tier 5), stacked on the existing orb
  size ladder.
- **Size (FINAL):** the "slightly bigger, step by step" requirement is baked
  into the FORM GEOMETRY, not the group scale — the orb ladder already pushes
  `_rangeScale` to 3–4× at 100+ orbs, which would drown or clamp any
  group-level multiplier. Each tier builds its blade to `BLADE_LENGTH[tier]`
  (0.76 → 1.0 u), and `TIP_LOCAL` (used by trails and hit arcs) derives from it:
  `TIP_LOCAL.y = BLADE_LENGTH[tier] × 0.79`. The group scale stays
  `_rangeScale × lengthMult` exactly as today, with a safety clamp at
  `MAX_TOTAL_SCALE` (5.0, up from today's unclamped 4× max) so the ready pose
  never covers the crosshair at the extreme (max orbs + EMPOWERED).

---

## 4. Weapon models — Arsenal of Ascension (FINAL)

USER RULING (2026-08-05): every tier is a DIFFERENT weapon, not a trim of the
same dagger. Cosmetic only — the damage ladder, range, arc table, combo rig,
and TIP_LOCAL math (§3/§5) are untouched. Narrative arc: makeshift cleaver →
proper steel → enchanted steel → soul-crystal → pure soul-energy → perfected
light. Every blade stays STRAIGHT (no bends), FLOATING (no hands),
primitive-based, self-lit on layer 2, no shadow casting, ≤ 6 meshes per form,
one form visible at a time.

### 4.1 Model ladder (identity per tier)

| Tier | Souls | Model | Blade len | Silhouette | Color identity |
|---|---|---|---|---|---|
| 0 | 0–99 | Executioner's Cleaver (unchanged) | 0.76 | broad short single-edge, NO guard | gunmetal 0x2a2d33 + brass pommel |
| 1 | 100–199 | Knight's Arming Sword | 0.81 | classic crossguard + central fuller | silver steel + bronze crossguard |
| 2 | 200–299 | Runic Greatsword | 0.86 | long two-hand grip, wide blade, 3 glowing runes | steel + runes 0x4ac8ff |
| 3 | 300–399 | Crystal Soulblade | 0.92 | faceted violet crystal shards on a straight white core | crystal 0xcc88ff / core 0xfff4d8 |
| 4 | 400–499 | Soulfire Greatblade | 0.96 | smooth white-hot energy blade, vented emitter | energy 0xddddff / core 0xfff4d8 |
| 5 | 500+ | Lightsaber (unchanged) | 1.00 | perfect straight energy cylinder | 0x88ffff / white core |

Color ramp across the run: gunmetal → bronze → blue runes → violet crystal →
white-hot → cyan. Forms are cumulative and never revert.

### 4.2 Geometry recipes (exact; group origin = grip, blade along +y, faces ±z)

Conventions: all dimensions in units (u); `L = EVOLUTION.BLADE_LENGTH[tier]`;
materials — reuse the existing `bladeMat` (0x2a2d33 gunmetal), `steelMat`
(0x9aa0aa, tintable by the orb ladder), `brassMat` (0xd8b44a), `dark`
(grip/wood), `fullerMat` (0xd8dce2) where possible; new materials pushed to
`this._mats` for `dispose()`. Every mesh: `layers.set(2)`, `castShadow = false`.

T0 (byte-identical to today — `PlayerSword._build`):
  blade Box(0.045, 0.42, 0.08) bladeMat @ y 0.21; tip Cone(r 0.05, h 0.34, 4)
  bladeMat @ y 0.56, rotY π/4, scale(0.6, 1, 1); fuller Box(0.012, 0.4, 0.006)
  fullerMat @ (0, 0.21, 0.033); grip Cyl(0.026, 0.024, 0.18, 8) dark @ y −0.09;
  collar Cyl(0.028, 0.03, 0.03, 8) dark @ y 0; pommel Sphere(0.045, 8, 6)
  brassMat @ y −0.21.

T1 Knight's Arming Sword (replaces the T0 blade block when tier ≥ 1):
  blade Box(0.05, 0.40, 0.012) steelMat @ y 0.20 (orb ladder keeps tinting);
  tip Cone(r 0.06, h 0.30, 4) steelMat @ y 0.62, rotY π/4, scale(0.55, 1, 1)
  (tip reaches 0.77 ≥ TIP_LOCAL 0.64); fuller Box(0.01, 0.34, 0.004) fullerMat
  @ (0, 0.20, 0.024); crossguard Box(0.16, 0.03, 0.05) brassMat @ y 0;
  grip Cyl(0.022, 0.02, 0.16, 8) dark @ y −0.08; pommel Sphere(0.04, 8, 6)
  brassMat @ y −0.18.

T2 Runic Greatsword (adds to T1 skeleton — wider, longer, runes):
  blade Box(0.055, 0.44, 0.014) steelMat @ y 0.22; tip Cone(r 0.065, h 0.32, 4)
  steelMat @ y 0.68, rotY π/4, scale(0.5, 1, 1); 3 runes: Box(0.004, 0.09,
  0.002) MeshBasic 0x4ac8ff @ (0, 0.16 / 0.28 / 0.40, 0.026) — straight, on the
  +z face (this replaces the old stripe planes + torus hilt band; the torus is
  REMOVED); crossguard Box(0.22, 0.035, 0.06) bladeMat @ y 0; grip
  Cyl(0.026, 0.024, 0.22, 8) dark @ y −0.11 (long two-hand grip); pommel
  Cyl(0.035, 0.035, 0.06, 8) brassMat @ y −0.24.

T3 Crystal Soulblade (steel hidden; crystal takes over — form owns color):
  spine Box(0.025, 0.52, 0.025) crystalMat @ y 0.26; 4 facet shards: Cone(
  r 0.035, h 0.22–0.30, 5) crystalMat @ y 0.12 / 0.28 / 0.44 / 0.60, x jitter
  ±0.015, rotZ ±0.1 (straight segments — jagged silhouette, no bends); core
  Cyl(0.006, 0.006, 0.90, 6) MeshBasic 0xfff4d8 @ y 0.45 (tip 0.90 ≥ 0.727);
  emitter grip Cyl(0.024, 0.028, 0.16, 8) dark @ y −0.08; collar as T0.
  crystalMat = MeshStandardMaterial({ color 0xcc88ff, emissive 0xcc66ff,
  emissiveIntensity 1.4, transparent, opacity 0.8, roughness 0.2 }) — mirrors
  the existing `_spawnCrystalCluster` material.

T4 Soulfire Greatblade (energy form):
  blade Cyl(0.03, 0.03, 0.92, 8) energyMat @ y 0.46 (base at 0, tip 0.92);
  core Cyl(0.008, 0.008, 0.88, 6) MeshBasic 0xfff4d8 @ y 0.44; 2 vent fins
  Box(0.02, 0.1, 0.02) bladeMat @ (x ±0.035, y 0.02), rotZ ∓0.35 (straight
  angled — emitters); emitter hilt Cyl(0.026, 0.03, 0.14, 8) dark @ y −0.07;
  glow sprite scale 0.5, opacity 0.35 (existing `_bladeGlow`, already built).
  energyMat = MeshBasicMaterial({ color 0xddddff, transparent, opacity 0.9,
  blending Additive, depthWrite false }).

T5 Lightsaber (unchanged — keep the current T3+ energy-blade block at tier 5:
  blade 0x88ffff, core, `_bladeGlow` 0x88ffff, `bladeLight`, crackle pool).

Shared rules:
- `TIP_LOCAL.set(0, L * 0.79, 0.02)` for every tier — trails/arcs need no change.
- `BLADE_COLORS` tints `bladeMat`/`steelMat` ONLY while `tier < 3` (T3+ owns
  color) — existing rule, keep.
- `setOrbCount`/`_rangeScale`/`MAX_TOTAL_SCALE` clamp: unchanged (group scale
  still drives overall size; form geometry only carries the silhouette).
- `flashBlade()` per form: steel forms flash `bladeMat.emissive` 0xffdd88;
  energy forms (T3+) flash `material.color` 0xffdd88 (current behavior — keep).

### 4.3 Build-function contract (replaces the shipped `_applyForm` internals)

1. Name the per-tier builders `_formCleaver()`, `_formArmingSword()`,
   `_formRunicGreatsword()`, `_formCrystalSoulblade()`, `_formSoulfireGreatblade()`,
   `_formLightsaber()`. Each is idempotent (creates its meshes once on first
   call, records them in `this._formMeshes[tier]`, tags them layer 2 / no
   shadow, pushes new materials to `this._mats`).
2. `_applyForm(tier)` becomes a dispatch: for t in 0..5, hide every mesh in
   `_formMeshes[t]` unless t === tier, then call the tier builder (ensures
   meshes exist) and show its set; update `_tipLocal`. Steel-group meshes may
   be shared between T0–T2 only if the silhouette differs by ADDED meshes
   (T1/T2 build on T0's grip/pommel pattern but must swap the blade block —
   see 4.2) — the point is a distinct silhouette per tier, not recolors.
3. The old lazy `tier >= N` stripe/torus/energy branches are deleted (their
   meshes either move into the new builders or vanish; the torus hilt band is
   removed entirely — no curved primitives in any form).
4. Keep `setTier(tier)` clamp, `range`, `currentDamage`, `scale`, hum pulse
   (T4 — retarget it to `_formSoulfireGreatblade` core), crackle (T5), and
   `update()` calls. `dispose()` must dispose `_formMeshes` too.

### 4.4 Perf (unchanged): ≤ 6 meshes/form; +0 textures; draw calls ≤ +4 vs T0;
one form visible at a time; all new materials pooled into `_mats`.

---

## 5. Electric arcs — progressive effect (FINAL)

- **Arc bolt**: pooled projectile (thin cylinder 0.02 × 0.5 + glow sprite,
  additive, `ARC_POOL: 8` — arrow-pool pattern). On spawn it homes to the
  nearest ALIVE enemy within `ARC_RANGE` (20 u); speed 24 u/s, life 1.2 s
  (fizzles at life end). Damage = **orb damage at fire time** (user ruling:
  `orbDamage(souls)` = 2·(1+0.02·souls), frozen per-bolt — arcs are no longer
  a flat 1). Impact: burstSparks + short arc line VFX (pooled, 0.12 s).
- **Proc table (per landing strike):** T0–T2 = legendary proc only (§6); T3 =
  10% → 1 bolt; T4 = 35% → 1 bolt; T5 = **100% → 2 bolts** (combo of 3 hits =
  up to 6 bolts per cycle, fits the pool of 8).
- **Re-target rule:** if the target dies mid-flight, the bolt re-targets the
  nearest alive enemy within 20 u; else fizzles (pool slot returns).
- **Idle crackle (T5):** ≤ 3 pooled additive arc sprites, random along the
  blade, 0.15–0.3 s life, cosmetic only.
- **Legendary blast** (T5, 5% per landing strike — user ruling): damage-based
  electric chain dealing `ELECTRIC_DAMAGE_MULT` (5) × orb damage to every enemy
  within 20 u. No longer an instant kill — elites and bosses survive. It and the
  arc bolts can both trigger on the same strike; no conflict (blast = AOE,
  bolts = single-target).

---

## 6. Latent bug — electric proc is dead code (must fix)

`Game._electricChain` reads `SWORD.ELECTRIC_CHANCE` and `SWORD.ELECTRIC_RANGE`,
but those constants are defined inside `SWORD.COMBO` (`SWORD.COMBO.ELECTRIC_CHANCE:
0.01`, `SWORD.COMBO.ELECTRIC_RANGE: 20`). Both top-level reads are `undefined` →
`Math.random() < undefined` is always false → **the 1% electric chain has never
fired**. Fix (FINAL): hoist both to the `SWORD` level (`SWORD.ELECTRIC_CHANCE:
0.01`, `SWORD.ELECTRIC_RANGE: 20`) and update both `Game._electricChain` read
sites. Values unchanged. `weapon-check.mjs` asserts both
are finite and the proc path is reachable. The tier ladder (§5) layers on top of
this fixed proc.

---

## 7. HUD (FINAL)

- **Souls line** (below the orb line, same styling): `Souls: 237` — the TOTAL
  lifetime souls only. No tier number, no progress fraction, no `MAX` readout
  (USER RULING: display only the total; the blade form and the evolution toast
  convey the tier). The old example's arithmetic (237 → "63/100") is moot —
  there is no progress field.
- **Tier pips**: removed (they were tied to the tier number, which the
  total-only ruling drops).
- **Evolution toast**: `Your blade awakens — Tier 3`; final tier:
  `Your blade is whole — the lightsaber sings`. Plus blade flash (emissive spike
  0.1 s) and a non-blocking hit-stop of 0.1 s (existing `state.hitStop`
  mechanism, slightly longer than the 0.06 s combat hit-stop).
- Label distinction: the ammo line keeps reading `Orbs` (banked ammo); the new
  line reads `Souls` (lifetime) — two counters, two labels, both real state.
- All elements are static-positioned divs in `index.html`; no new framework.

### 7.1 Exact change (index.html + Game.js — NOT yet applied, verified 2026-08-05)

index.html — replace the current `#vp-souls` block (lines ~304–309):

    <div id="vp-souls">
      <div class="souls"><span class="lbl">ORBS</span><span id="orb-count">0</span></div>
      <div id="orb-scale"></div>
      <div id="souls-line">Souls 0</div>
    </div>

  (delete the `#tier-pips` div entirely; default `#souls-line` content is
  exactly `Souls 0`. Keep the `#souls-line` CSS rule — gold #9a8a5c, 16px,
  ds-font-body — and DELETE the `#tier-pips` CSS rules, lines ~73–74.)

Game.js `_updateHUD()` — replace lines ~1595–1608 (the souls-line + tier-pips
blocks) with exactly:

    if (this._soulsLineEl) {
      this._soulsLineEl.textContent = `Souls ${this.state.soulsEarned || 0}`;
    }

  (remove the tier/progress/MAX logic and the `_tierPipsEl` block; the
  `#souls-line` color stays CSS-driven. In the constructor, the
  `this._tierPipsEl = document.getElementById('tier-pips')` line (line ~37)
  can stay — it will be null — but it must NOT be re-added to index.html.)

---

## 8. Integration surface (complete)

| File | Change |
|---|---|
| `src/core/Constants.js` | NEW `EVOLUTION` block (§3); hoist `SWORD.ELECTRIC_CHANCE`/`ELECTRIC_RANGE` to `SWORD` level (§6) |
| `src/core/GameState.js` | +`soulsEarned`, +`weaponTier` (constructor params, default 0) |
| `src/entities/OrbSystem.js` | +`state.soulsEarned++` on the orb-pickup branch (NOT buff/health pickups) |
| `src/entities/PlayerSword.js` | §4.3 rewrite: `_applyForm` dispatch + per-tier builders (`_formCleaver`…`_formLightsaber`); `setTier`/`range`/`currentDamage`/`scale`/`dispose` updated per §4.3; hum pulse retargeted to T4 core; crackle + blade light stay T5-only |
| `src/core/Game.js` | `swordHitDamage(step, tier)` applied in the hit path (SHIPPED); arc spawning pooled & Game-managed (SHIPPED, lines ~806–887); electric proc references fixed (SHIPPED); evolution toast/flash/hit-stop on threshold crossing (SHIPPED); `_updateHUD` souls-line = total-only (§7.1) |
| `index.html` | +souls line (total only) |
| `scripts/weapon-check.mjs` | NEW — validation (§11) |
| `docs/SPEC.md` | unchanged (separate plan, same convention as the biome plan) |

No changes to: `DungeonGenerator`, `WorldBuilder`, `BiomeSystem`, `LightingSystem`,
`SkeletonSystem`, `InputSystem`, `Leaderboard`, enemy files.

---

## 9. Performance budgets (FINAL)

| Budget | Current | After | Check |
|---|---|---|---|
| Sword-attached lights | 2 (danger + growth) | +1 blade light at T5 only (camera-attached, layer 0, no shadow, intensity 1.5 dist 6) | ✓ +1 max |
| Arc projectiles | 0 | pool 8 (arrow-pattern, no per-shot alloc) | ✓ |
| New sprites | trail 3 + glow 2 + smoke 1 | + idle crackle ≤ 3 (T5 only) | ✓ |
| Draw calls | sword ~10 | +≤ 4 (2 stripes T2, energy blade 2 T3+, bolt 1–2 in flight) | ✓ |
| Per-frame allocation | 0 | 0 — bolts, crackle, stripes all pooled/pre-built | ✓ |
| New textures | 0 | 0 — reuses `generateGlowTexture` | ✓ |
| Shadow maps | 8 torches | unchanged | ✓ |

Arc bolts cap: 8 in flight (2 per strike × 3 combo steps = 6 max per cycle).
Blade light only exists at tier 5 and is disposed/rebuilt with the form.

---

## 10. Edge cases

| # | Case | Resolution |
|---|---|---|
| 1 | Firing orbs drops the bank below a threshold | Impossible — tier derives from `soulsEarned` (lifetime, monotonic) |
| 2 | Tier up mid-combat | Immediate: toast + blade flash + 0.1 s hit-stop (non-blocking); combo state preserved; `weaponTier` updated in the same frame |
| 3 | Tier up then level regen | `weaponTier` persists in state; form rebuilt on `level:start` from the stored tier |
| 4 | Evolution size + max orb scale + EMPOWERED | Size steps are baked into form geometry (`BLADE_LENGTH[tier]`, always visible); group scale stays `_rangeScale × lengthMult` with a `MAX_TOTAL_SCALE: 5.0` safety clamp — ready pose never covers the crosshair |
| 5 | FIREBALL buff active | RMB fires fireballs; the evolved form stays visible; evolution unaffected |
| 6 | Energy blade + BRIGHT buff / headlight | Blade is layer-2 self-lit — no relight; no change |
| 7 | T5 arcs with no enemies alive | Bolts fizzle at life end; pool pattern, no crash |
| 8 | Arc bolt target dies mid-flight | Re-target nearest alive within 20 u; else fizzle |
| 9 | NG+ / new run | Fresh `soulsEarned = 0`; NG+ enemy HP ×2 keeps tier-5 damage in check |
| 10 | 1000+ souls | Tier capped at V; souls counter keeps counting; damage/arcs stop growing |
| 11 | Legendary proc + arc bolts on the same strike | Both fire; blast is AOE screen-clear, bolts are single-target — no conflict, no double-application |
| 12 | Arc bolt vs breakable props | Bolts only target enemies (spawned via the enemy system); props untouched |
| 13 | Tier 3 form while combo is mid-animation | Form swap touches meshes only; the rig/state machine is untouched — safe mid-swing |
| 14 | dungeon-check.mjs | Unaffected (no world-geometry change); must stay broken=0/40 |
| 15 | weapon-check fails on constants | CI-style failure at the phase gate (see §11) |

---

## 11. Verification — `scripts/weapon-check.mjs` (NEW)

1. `EVOLUTION` block complete; every table value finite (no NaN — guards the
   same class of bug as §6). — SHIPPED (gate passes)
2. Tier math: `tier(souls)` for 0, 99, 100, 199, 200, 500, 999 → 0, 0, 1, 1, 2,
   5, 5; cap at MAX_TIER. — SHIPPED
3. Damage ladder: `swordHitDamage(step, tier)` = 2/2/3 + tier → 7/7/8 at tier 5;
   brute breakpoint: tier 5 needs 2 hits on HP 8 (7+7), armored 5 dies in 1.
   — SHIPPED
4. Arc table: `ARC_CHANCE`/`ARC_BOLTS` lengths = MAX_TIER + 1; T5 = 1.0/2;
   pool 8 ≥ 6 max bolts per combo. — SHIPPED
5. **Electric proc fix**: `SWORD.ELECTRIC_CHANCE` and `SWORD.ELECTRIC_RANGE`
   are finite numbers (not undefined); `Game` references resolve. — SHIPPED
6. Scale/size cap: max group scale (150 orbs × EMPOWERED) ≤ 5.0; `BLADE_LENGTH`
   monotonic (0.76 → 1.0); `TIP_LOCAL.y = BLADE_LENGTH[tier] × 0.79` for all tiers.
   — SHIPPED
7. HUD (total-only ruling — §7.1): `#souls-line` exists in
   index.html AND its default content is exactly `Souls 0`; `#tier-pips` must
   NOT be present. Implementation: `html.includes('id="souls-line"')`,
   `html.includes('>Souls 0<')`, `!html.includes('tier-pips')`. — SHIPPED
8. Existing gate: `node scripts/dungeon-check.mjs` → broken=0/40. — SHIPPED
9. **Distinct silhouettes** (§4.3): PlayerSword.js source contains all six
   builder names from §4.3 (`_formCleaver`, `_formArmingSword`,
   `_formRunicGreatsword`, `_formCrystalSoulblade`, `_formSoulfireGreatblade`,
   `_formLightsaber`) and `_applyForm` dispatches on tier. Proxy assertion:
   source includes `_formMeshes` and the six builder names. — SHIPPED
10. **Straightness** (§4): PlayerSword.js contains no curved/hollow blade
    primitives — grep asserts the file does NOT construct `TorusGeometry`/
    `TorusKnotGeometry` (the legacy T2 hilt band is gone after §4.3). — SHIPPED
11. **HUD grep** (§7.1): Game.js `_updateHUD` writes the total only — source
    assertion: Game.js contains `Souls ${this.state.soulsEarned` and does NOT
    contain `tier-pips`. — SHIPPED
12. Existing gate: dungeon-check broken=0/40 (same as 8 — kept for parity with
    biome-check's numbering).

---

## 12. Implementation phases (commit per phase)

| Phase | Scope | Gate |
|---|---|---|
| 0 | `EVOLUTION` constants, `SWORD.ELECTRIC_*` hoist, GameState fields, OrbSystem `soulsEarned`, `weapon-check.mjs` | weapon-check 1–8 green; dungeon-check 0/40 — **SHIPPED** |
| 1 | Damage ladder (pure function in Game) + HUD (souls line, toasts) | headless tier-math probe; `#souls-line` id present — **SHIPPED** (toast + arcs also shipped) |
| 2 | **Distinct models T1–T2** (§4.2: `_formArmingSword`, `_formRunicGreatsword`; delete stripes/torus) | weapon-check 9–10 green; visual probe: crossguard/runes visible, torus gone — **SHIPPED** |
| 3 | **Distinct models T3–T4** (§4.2: `_formCrystalSoulblade`, `_formSoulfireGreatblade`) | weapon-check 9–10 green; hum pulse targets T4 core; T3 faceted silhouette headless-verified (mesh count per tier) — **SHIPPED** |
| 4 | **HUD total-only** (§7.1: index.html + `Game._updateHUD` + delete `#tier-pips`) | weapon-check gates 7 + 11 green; `#souls-line` default `Souls 0`; no `tier-pips` anywhere — **SHIPPED** |
| 5 | Final gates: full descend through all tiers, no console errors, dungeon-check 0/40, weapon-check clean (1–12), perf probe (draw calls, lights) | all gates — **SHIPPED** (browser-smoke PASS: 0 JS exceptions) |

---

## 13. Out of scope

- Evolution of the ranged orb weapon (keeps its own +2%/orb scaling).
- New enemy types, boss changes, NG+ changes.
- Souls in the leaderboard (leaderboard counts orbs only, unchanged).
- Audio (no sound system; visual cues only).
- Damage numbers beyond `+1 per tier` (no crits, no elemental affixes).
- Changes to the combo rig, timings, or rest pose.

---

## 14. Gap-closure log (draft → closed)

| # | Gap | Resolution |
|---|---|---|
| 1 | Souls counter source (banked orbs regress when firing — `_handleShooting` decrements `collectedOrbs` on the first step of each sequence; `totalOrbs` resets per level) | NEW monotonic `soulsEarned` in GameState, incremented in the OrbSystem pickup branch (§2) |
| 2 | Tier cap | MAX_TIER 5 (500 souls). Enemies have fixed HP; uncapped damage trivializes them. Souls keep counting past the cap; the ladder stops (§3) |
| 3 | Ladder thresholds | Exactly 100 souls per tier (user-specified); 6 forms T0–T5 (§3) |
| 4 | Damage application | `+tier` to EVERY combo hit via pure function `swordHitDamage(step, tier)`; constants never mutated (§3) |
| 5 | Visual tier details | Fixed scale steps 1.00→1.70; T3+ straight additive energy-blade cylinder (taste: no bends, floating, self-lit) (§4) |
| 6 | Lightsaber color + orb-ladder interaction | Cyan 0x66eeff core, white-hot line; at T3+ the evolution form OWNS blade color (BLADE_COLORS stops applying); orb ladder keeps size/range only (§4) |
| 7 | Arc ladder | T3 10% / T4 35% / T5 100% ×2 bolts; T0–T2 keep the (fixed) 1% legendary proc (§5) |
| 8 | Arc bolt damage | Flat 1 — bolts are effect/utility; sword hits carry the damage (§5) |
| 9 | ELECTRIC bug fix | Hoist to `SWORD.ELECTRIC_CHANCE`/`ELECTRIC_RANGE` (values unchanged); both consumers fixed; weapon-check asserts finiteness (§6) |
| 10 | HUD content | Souls line = ONLY the total lifetime souls (`Souls: 237`); no tier/progress/MAX (user ruling). Toasts; two labels (Orbs = ammo, Souls = lifetime). Roman-numeral question moot — no tier readout (§7) |
| 11 | Sword-attached light at T5 | Layer-0 camera light (lights world around player), intensity 1.5 dist 6, no shadow; sword stays self-lit (§4, §9) |
| 12 | Range stacking | +4% reach per tier on top of orb range ladder (§3) |
| 13 | Size steps drowned by the orb scale ladder | Size baked into FORM GEOMETRY (`BLADE_LENGTH[tier]` 0.76→1.0, `TIP_LOCAL` derived); group scale unchanged with a 5.0 safety clamp (§3, §4) |
| 14 | Bolt re-target on target death | Re-target nearest alive within 20 u; else fizzle (§5, §10) |
| 15 | Form swap mid-combo | Meshes only — rig/state machine untouched; safe mid-swing (§10) |
| 16 | BURN enemy and arcs | Arcs spawn via the enemy system — any living enemy (incl. Burning) is a valid target (§5) |
| 17 | FIREBALL buff interaction | RMB replaced during the buff; evolved form stays visible; no interference (§10) |
| 18 | New run / NG+ | Fresh souls; NG+ HP ×2 keeps tier 5 in check (§2, §10) |
| 19 | HUD must show real state only | Souls line = lifetime total (real); tier/progress readout removed under the total-only ruling; no fake elements (§7) |
| 20 | Pool sizing for arcs | ARC_POOL 8 ≥ 6 max in-flight (2/strike × 3 steps) (§5, §9) |
| 21 | Perf parity | +1 light (T5), +8 pooled bolts, +≤3 crackle sprites, +≤4 draw calls; zero per-frame alloc; no new textures (§9) |
| 22 | weapon-check scope | Tier math, damage ladder + brute breakpoint, arc table, ELECTRIC fix, scale cap, HUD ids, dungeon-check gate (§11) |
| 23 | Toast content | `Your blade awakens — Tier 3`; final `Your blade is whole — the lightsaber sings` (§7) |
| 24 | Hit-stop on evolution | 0.1 s non-blocking via existing `state.hitStop` mechanism (vs 0.06 combat) (§7) |
| 25 | Leaderboard untouched | Souls not added; leaderboard counts orbs only (§13) |
| 26 | Plan placement | New file `docs/WEAPON_EVOLUTION_PLAN.md`; SPEC.md and the biome plan untouched; commit-per-phase in the consolidated repo |
| 27 | HUD souls-line arithmetic (237 → "63/100" was wrong) | USER RULING: display ONLY the total lifetime souls — `Souls: 237`. No tier number, no progress fraction, no MAX readout; the blade form + evolution toast convey the tier (§7). |
| 28 | Tier pips orphaned by the total-only ruling | Removed — they were tied to the tier number (§7). |
| 29 | weapon-check item 7 "DOM probe in the game, or static id check" | Arbitrated: static id + initial-content check in weapon-check.mjs (headless node has no DOM); pickup-path updates verified at state level by the tier-math probe and the Phase 5 full-descend gate (§11, §12 P1). |
| 30 | Drift-prone code line references (748 / 779 / 885) | Replaced with symbolic refs: `Game._handleShooting` first-step decrement; `Game._electricChain` read sites (§1, §6, §14 #1). |
| 31 | User wants a DIFFERENT weapon model per tier (cosmetic) | **Arsenal of Ascension** adopted (2026-08-05): T0 cleaver (unchanged), T1 arming sword, T2 runic greatsword, T3 crystal soulblade, T4 soulfire greatblade, T5 lightsaber (unchanged). §4 rewritten with exact geometry recipes + build contract (§4.2/§4.3). |
| 32 | HUD total-only ruling (display ONLY total souls) — not yet applied in code | §7.1 specifies the exact index.html + Game._updateHUD diff; weapon-check gate 7 now asserts `#souls-line` default `Souls 0` AND the ABSENCE of `#tier-pips` (§7, §11). |
| 33 | weapon-check gate 7 previously REQUIRED `#tier-pips` | Inverted by the total-only ruling: gate 7 asserts no `tier-pips` anywhere; new gates 9 (six distinct builders present), 10 (no TorusGeometry — legacy T2 band removed), 11 (Game.js writes total-only) (§11). |
| 34 | Implementation status unverifiable by a fresh model | §0 status map (verified 2026-08-05): phases 0–1 + arcs + toast + electric fix SHIPPED and green; the remaining delta is §4 models (B2–B3), §7.1 HUD (B4), gate updates (B5) (§0, §12). |
| 35 | Straightness / no-bends taste needed a guard | Gate 10 greps PlayerSword for Torus/TorusKnot geometry — the legacy T2 hilt band is the only offender and §4.3 deletes it (§11). |
| 36 | Silhouette-distinctness needed a guard | Gate 9 asserts the six named builders exist and `_applyForm` dispatches on tier — prevents the redesign degrading back into trims (§11). |
| 37 | Arsenal of Ascension implementation | All six forms shipped (B2/B3, 2026-08-05): `_ensureForms` + per-tier builders + `_formMeshes` registry; T0/T5 byte-identical; gates 9–10 green (§4, §11). |
| 38 | HUD total-only implementation | index.html + Game.js updated (B4, 2026-08-05); gates 7/11 green; browser-smoke asserts `Souls 0` + perf-warning (§7.1, §11). |
| 39 | Degraded-mode perf safeguard (user feature) | Sustained <30 fps for >10 s flips the run into degraded mode: `PropSystem.reduceDecorations(0.5)` hides half the current level's cosmetic props (hazards/breakables/structure/biome lights untouched) + bottom-right warning label; run stays degraded; smoke-verified (§16). |

---

## 15. Verification summary for implementer

STATUS: COMPLETE (2026-08-05). All phases shipped. Verification commands:
`node scripts/dungeon-check.mjs 40` → broken=0/40; `node scripts/weapon-check.mjs`
→ ALL GATES PASS (1–12); `node scripts/browser-smoke.mjs` → PASS (headless boot,
WebGL2, total-only HUD, 0 JS exceptions — all six forms build in-browser on
level start). The legendary proc FIRES (gate 5 guards it). No open items from
§5/§6/§7; the degraded-mode perf safeguard (§16) landed with the same
verification.

---

## 16. Perf safeguard — degraded mode (user feature, 2026-08-05)

If sustained fps < 30 for more than 10 s, the run enters degraded mode:

- `Game._updatePerfMonitor(dt)` (called every frame): EMA fps
  (`_fpsEma = _fpsEma·0.95 + fps·0.05`), accumulates `_lowFpsTime` while
  `_fpsEma < 30` (reset to 0 when ≥ 30). Frame hitches (dt > 0.25 s, e.g.
  level regen) and the title screen (`_titleActive`) are excluded from the
  measurement. When `_lowFpsTime > 10`: set `_degraded = true`, call
  `props.reduceDecorations(0.5)`, unhide `#perf-warning`.
- `PropSystem.reduceDecorations(0.5)`: hides a random 50% of purely cosmetic
  props recorded in `_decoratives` (rubble, skull piles, blood decals, anvils,
  chains, candles, ice crystals, mushrooms — their lights included) and sheds
  the tail instances of the instanced water/stalactite meshes (count halved).
  NEVER touches hazards, breakables, interactives, structural props, or biome
  light props (crystal clusters, wisps, altars).
- Once degraded, the run STAYS degraded: `_initProps` applies
  `reduceDecorations(0.5)` to every new level so fluidity holds.
- HUD: `#perf-warning` div + CSS in index.html ("⚠ DEGRADED MODE — decorations
  reduced for performance", bottom-right, amber, hidden at start);
  browser-smoke asserts its presence + hidden state.
