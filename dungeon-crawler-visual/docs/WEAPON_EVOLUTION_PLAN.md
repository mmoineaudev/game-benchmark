# Weapon Evolution Plan — Souls Ladder

Implementation plan for a weapon-evolution system in the dungeon crawler at
`~/Documents/games-benchmarks/dungeon-crawler-visual`.

Status: **CLOSED** — every open point from the draft arbitrated and embedded
inline; a latent electric-proc bug found and owned (§6). Resolution priority:
ease of development, maintainability, internal consistency, fun. Gap-closure log
in §12 (26 rows).

---

## 1. Overview

Every 100 souls the sword evolves: **+1 base damage per evolution** and a new
aesthetic, stepping from the default blade up to **a lightsaber that throws
electric arcs**. Progression is strictly cumulative — damage and effect both
grow, the form never reverts.

Final design constraints:

1. **Souls = lifetime orb pickups.** The game's currency is orbs: picked up from
   kills, spent as ammo (`Game._handleShooting` decrements `collectedOrbs` on the
   first step of each sequence — line 748). "Every 100 souls" therefore uses a
   NEW monotonic counter, `soulsEarned`, because the banked count fluctuates and
   a tier based on it could regress mid-fire. `totalOrbs` is not usable either —
   it is the per-level pickup count (reset to 0 on level build).
2. **Sword only.** The melee weapon (floating executioner-style dagger, 3-hit
   combo) evolves. The ranged orb weapon is untouched — `orbDamageMultiplier`
   (already +2% per held orb) keeps its own scaling.
3. **Progressive in damage AND effect.** +1 per hit per tier; electric arcs ramp
   from a rare proc to guaranteed bolts at the final tier.
4. **No new mechanics.** Reuses the existing combo, hit, projectile-pool, and
   HUD patterns. No new keys, no new enemy logic, no new systems.
5. **Established taste holds.** Blade stays STRAIGHT (no bends — energy blade is
   a straight cylinder), weapon stays FLOATING (no hands), materials stay
   self-lit on layer 2 (never lit by the headlight), no shadow casting.

---

## 2. Soul economy (FINAL)

- New `GameState` fields: `soulsEarned: 0` (monotonic, lifetime), `weaponTier: 0`
  (derived, stored for HUD/persistence). Both constructor params with default 0
  (mirrors `collectedOrbs`/`bossKills` pattern).
- `OrbSystem` increments `state.soulsEarned++` in the SAME branch that
  increments `collectedOrbs` (the orb-pickup path). Buff pickups and health
  pickups do NOT count.
- Tier = `Math.min(Math.floor(soulsEarned / EVOLUTION.TIER_SOULS), EVOLUTION.MAX_TIER)`.
  Recompute on every pickup; store in `state.weaponTier`; persists across level
  regens (state field, like `collectedOrbs`).
- New run (incl. NG+) = fresh `soulsEarned: 0`. NG+ enemy HP ×2 keeps high-tier
  damage in check without touching the ladder.

---

## 3. Evolution ladder (FINAL)

`EVOLUTION = { TIER_SOULS: 100, MAX_TIER: 5, DAMAGE_PER_TIER: 1,
BLADE_LENGTH: [0.76, 0.81, 0.86, 0.92, 0.96, 1.0],  // form length per tier (u)
RANGE_PER_TIER: 0.04, MAX_TOTAL_SCALE: 5.0,
ARC_CHANCE: [0, 0, 0, 0.10, 0.35, 1.0], ARC_BOLTS: [0, 0, 0, 1, 1, 2],
ARC_POOL: 8, ARC_SPEED: 24, ARC_LIFE: 1.2, ARC_DAMAGE: 1, ARC_RANGE: 20,
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
- **Cap (FINAL):** 500 souls = tier 5 = max. Beyond that the HUD shows `MAX`;
  damage and arcs stop growing. Uncapped damage would trivialize the fixed-HP
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

## 4. Aesthetics — per-tier form (FINAL)

All geometry stays primitive-based, straight, self-lit (layer 2), no shadows.

| Tier | Blade length | Change |
|---|---|---|
| 0 | 0.76 | current executioner blade (gunmetal 0x2a2d33 + brass pommel) — byte-identical |
| 1 | 0.81 | bronze edge: fuller material recolored 0xd8a060 (was bright silver); blade + tip meshes scaled to length |
| 2 | 0.86 | + 2 emissive blue stripe planes (0.006 × 0.40, 0x4ac8ff, emissive 1.6) on both blade faces; hilt glow band (thin torus, 0x2a6a9a emissive) |
| 3 | 0.92 | **energy blade**: steel blade + tip meshes hidden; replaced by ONE straight additive cylinder (0.045 × 0.92, 0x66eeff, opacity 0.85, depthWrite false) + white-hot core line (0.012 × 0.85, 0xfff4d8, MeshBasic). Blade color no longer follows the orb-size `BLADE_COLORS` ladder — the evolution form fully owns blade color from here on (the orb ladder keeps driving size/range only) |
| 4 | 0.96 | core brightens (emissive 2.0), glow sprite grows 0.3 → 0.5, hum pulse: sprite scale ±5% @ 3 Hz |
| 5 | 1.00 | **full lightsaber**: blade 0x66eeff → 0x88ffff, white core, idle crackle (≤ 3 pooled additive arc sprites flickering along the blade, cosmetic), + blade point light `EVOLUTION.T5_BLADE_LIGHT` (layer 0, camera-attached — it lights the WORLD around the player in cyan; the sword itself stays self-lit) |

`TIP_LOCAL.y = BLADE_LENGTH[tier] × 0.79` drives trails and hit arcs at every
tier (the tip is where the arc trace spawns).

Rest pose, trail colors, and combo animation are unchanged at every tier (the
form swaps meshes; the rig and state machine do not move).

---

## 5. Electric arcs — progressive effect (FINAL)

- **Arc bolt**: pooled projectile (thin cylinder 0.02 × 0.5 + glow sprite,
  additive, `ARC_POOL: 8` — arrow-pool pattern). On spawn it homes to the
  nearest ALIVE enemy within `ARC_RANGE` (20 u); speed 24 u/s, life 1.2 s
  (fizzles at life end), damage `ARC_DAMAGE: 1` (flat — bolts are effect/utility;
  the sword hits carry the damage). Impact: burstSparks + short arc line VFX
  (pooled, 0.12 s).
- **Proc table (per landing strike):** T0–T2 = legendary proc only (§6); T3 =
  10% → 1 bolt; T4 = 35% → 1 bolt; T5 = **100% → 2 bolts** (combo of 3 hits =
  up to 6 bolts per cycle, fits the pool of 8).
- **Re-target rule:** if the target dies mid-flight, the bolt re-targets the
  nearest alive enemy within 20 u; else fizzles (pool slot returns).
- **Idle crackle (T5):** ≤ 3 pooled additive arc sprites, random along the
  blade, 0.15–0.3 s life, cosmetic only.
- **Legendary proc** (all tiers): the existing screen-clear electric blast —
  with the bug fixed (§6) it actually fires at 1% per landing strike. It and the
  arc bolts can both trigger on the same strike; no conflict (blast = AOE kill,
  bolts = single-target).

---

## 6. Latent bug — electric proc is dead code (must fix)

`Game._electricChain` reads `SWORD.ELECTRIC_CHANCE` and `SWORD.ELECTRIC_RANGE`,
but those constants are defined inside `SWORD.COMBO` (`SWORD.COMBO.ELECTRIC_CHANCE:
0.01`, `SWORD.COMBO.ELECTRIC_RANGE: 20`). Both top-level reads are `undefined` →
`Math.random() < undefined` is always false → **the 1% electric chain has never
fired**. Fix (FINAL): hoist both to the `SWORD` level (`SWORD.ELECTRIC_CHANCE:
0.01`, `SWORD.ELECTRIC_RANGE: 20`) and update the `Game._electricChain`
references (line 779, 885). Values unchanged. `weapon-check.mjs` asserts both
are finite and the proc path is reachable. The tier ladder (§5) layers on top of
this fixed proc.

---

## 7. HUD (FINAL)

- **Souls line** (below the orb line, same styling): `Souls: 237 · Tier 2 ·
  63/100`. At tier 5: `Souls: 537 · Tier 5 · MAX`. (Decimal tier number —
  roman numerals were rejected in review for an off-by-one between "3 evolutions
  = Tier III" and the capped "Tier V" display.)
- **Tier pips**: 5 small pips beside the tier number, lit = earned (real
  state, same rule as combo pips).
- **Evolution toast**: `Your blade awakens — Tier 3`; final tier:
  `Your blade is whole — the lightsaber sings`. Plus blade flash (emissive spike
  0.1 s) and a non-blocking hit-stop of 0.1 s (existing `state.hitStop`
  mechanism, slightly longer than the 0.06 s combat hit-stop).
- Label distinction: the ammo line keeps reading `Orbs` (banked ammo); the new
  line reads `Souls` (lifetime) — two counters, two labels, both real state.
- All elements are static-positioned divs in `index.html`; no new framework.

---

## 8. Integration surface (complete)

| File | Change |
|---|---|
| `src/core/Constants.js` | NEW `EVOLUTION` block (§3); hoist `SWORD.ELECTRIC_CHANCE`/`ELECTRIC_RANGE` to `SWORD` level (§6) |
| `src/core/GameState.js` | +`soulsEarned`, +`weaponTier` (constructor params, default 0) |
| `src/entities/OrbSystem.js` | +`state.soulsEarned++` on the orb-pickup branch (NOT buff/health pickups) |
| `src/entities/PlayerSword.js` | `evolve(tier)`: form build per tier (T3+ energy blade swap, stripes, glow, crackle, blade light), `evolveScale` in the scale getter, arc-bolt emission hooks, `swordHitDamage` consumer side |
| `src/core/Game.js` | `swordHitDamage(step, tier)` applied in the hit path; arc spawning (pooled, Game-managed like `_electricChain`); electric proc references fixed; evolution toast/flash/hit-stop on threshold crossing; HUD update |
| `index.html` | +souls line, +tier pips |
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
| 10 | 1000+ souls | Tier capped at V; HUD `MAX`; damage/arcs stop growing |
| 11 | Legendary proc + arc bolts on the same strike | Both fire; blast is AOE screen-clear, bolts are single-target — no conflict, no double-application |
| 12 | Arc bolt vs breakable props | Bolts only target enemies (spawned via the enemy system); props untouched |
| 13 | Tier 3 form while combo is mid-animation | Form swap touches meshes only; the rig/state machine is untouched — safe mid-swing |
| 14 | dungeon-check.mjs | Unaffected (no world-geometry change); must stay broken=0/40 |
| 15 | weapon-check fails on constants | CI-style failure at the phase gate (see §11) |

---

## 11. Verification — `scripts/weapon-check.mjs` (NEW)

1. `EVOLUTION` block complete; every table value finite (no NaN — guards the
   same class of bug as §6).
2. Tier math: `tier(souls)` for 0, 99, 100, 199, 200, 500, 999 → 0, 0, 1, 1, 2,
   5, 5; cap at MAX_TIER.
3. Damage ladder: `swordHitDamage(step, tier)` = 2/2/3 + tier → 7/7/8 at tier 5;
   brute breakpoint: tier 5 needs 2 hits on HP 8 (7+7), armored 5 dies in 1.
4. Arc table: `ARC_CHANCE`/`ARC_BOLTS` lengths = MAX_TIER + 1; T5 = 1.0/2;
   pool 8 ≥ 6 max bolts per combo.
5. **Electric proc fix**: `SWORD.ELECTRIC_CHANCE` and `SWORD.ELECTRIC_RANGE`
   are finite numbers (not undefined); `Game` references resolve.
6. Scale/size cap: max group scale (150 orbs × EMPOWERED) ≤ 5.0; `BLADE_LENGTH`
   monotonic (0.76 → 1.0); `TIP_LOCAL.y = BLADE_LENGTH[tier] × 0.79` for all tiers.
7. HUD: `#souls-line` and `#tier-pips` elements exist; updated on pickup
   (DOM probe in the game, or static id check in the script).
8. Existing gate: `node scripts/dungeon-check.mjs` → broken=0/40.

---

## 12. Implementation phases (commit per phase)

| Phase | Scope | Gate |
|---|---|---|
| 0 | `EVOLUTION` constants, `SWORD.ELECTRIC_*` hoist, GameState fields, OrbSystem `soulsEarned`, `weapon-check.mjs` | weapon-check 1–8 green; dungeon-check 0/40 |
| 1 | Damage ladder (pure function in Game) + HUD (souls line, tier pips, toasts) | headless tier-math probe; DOM ids present |
| 2 | Visuals T1–T2 (scale steps, bronze edge, blue stripes, hilt band) | console/visual probe; scale values match table |
| 3 | T3–T4 energy blade + arc chance ladder + proc actually firing (bug fix verified) | arc proc table matches constants; proc fires headlessly; blade is straight cylinder |
| 4 | T5 lightsaber: guaranteed bolts (2/strike), idle crackle, blade light | pool ≤ 8; lights +1; no per-frame alloc |
| 5 | Final gates: full descend through all tiers, no console errors, dungeon-check 0/40, weapon-check clean, perf probe (draw calls, lights) | all gates |

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
| 1 | Souls counter source (banked orbs regress when firing — `collectedOrbs--` at Game.js:748; `totalOrbs` resets per level) | NEW monotonic `soulsEarned` in GameState, incremented in the OrbSystem pickup branch (§2) |
| 2 | Tier cap | MAX_TIER 5 (500 souls). Enemies have fixed HP; uncapped damage trivializes them. HUD `MAX` beyond (§3) |
| 3 | Ladder thresholds | Exactly 100 souls per tier (user-specified); 6 forms T0–T5 (§3) |
| 4 | Damage application | `+tier` to EVERY combo hit via pure function `swordHitDamage(step, tier)`; constants never mutated (§3) |
| 5 | Visual tier details | Fixed scale steps 1.00→1.70; T3+ straight additive energy-blade cylinder (taste: no bends, floating, self-lit) (§4) |
| 6 | Lightsaber color + orb-ladder interaction | Cyan 0x66eeff core, white-hot line; at T3+ the evolution form OWNS blade color (BLADE_COLORS stops applying); orb ladder keeps size/range only (§4) |
| 7 | Arc ladder | T3 10% / T4 35% / T5 100% ×2 bolts; T0–T2 keep the (fixed) 1% legendary proc (§5) |
| 8 | Arc bolt damage | Flat 1 — bolts are effect/utility; sword hits carry the damage (§5) |
| 9 | ELECTRIC bug fix | Hoist to `SWORD.ELECTRIC_CHANCE`/`ELECTRIC_RANGE` (values unchanged); both consumers fixed; weapon-check asserts finiteness (§6) |
| 10 | HUD content | Souls line + decimal tier + pips + progress + MAX; toasts; two labels (Orbs = ammo, Souls = lifetime). Roman numerals rejected — off-by-one at the cap (§7) |
| 11 | Sword-attached light at T5 | Layer-0 camera light (lights world around player), intensity 1.5 dist 6, no shadow; sword stays self-lit (§4, §9) |
| 12 | Range stacking | +4% reach per tier on top of orb range ladder (§3) |
| 13 | Size steps drowned by the orb scale ladder | Size baked into FORM GEOMETRY (`BLADE_LENGTH[tier]` 0.76→1.0, `TIP_LOCAL` derived); group scale unchanged with a 5.0 safety clamp (§3, §4) |
| 14 | Bolt re-target on target death | Re-target nearest alive within 20 u; else fizzle (§5, §10) |
| 15 | Form swap mid-combo | Meshes only — rig/state machine untouched; safe mid-swing (§10) |
| 16 | BURN enemy and arcs | Arcs spawn via the enemy system — any living enemy (incl. Burning) is a valid target (§5) |
| 17 | FIREBALL buff interaction | RMB replaced during the buff; evolved form stays visible; no interference (§10) |
| 18 | New run / NG+ | Fresh souls; NG+ HP ×2 keeps tier 5 in check (§2, §10) |
| 19 | HUD must show real state only | Souls = lifetime (real), pips = earned tiers (real), progress = remainder to next threshold (real); no fake elements (§7) |
| 20 | Pool sizing for arcs | ARC_POOL 8 ≥ 6 max in-flight (2/strike × 3 steps) (§5, §9) |
| 21 | Perf parity | +1 light (T5), +8 pooled bolts, +≤3 crackle sprites, +≤4 draw calls; zero per-frame alloc; no new textures (§9) |
| 22 | weapon-check scope | Tier math, damage ladder + brute breakpoint, arc table, ELECTRIC fix, scale cap, HUD ids, dungeon-check gate (§11) |
| 23 | Toast content | `Your blade awakens — Tier 3`; final `Your blade is whole — the lightsaber sings` (§7) |
| 24 | Hit-stop on evolution | 0.1 s non-blocking via existing `state.hitStop` mechanism (vs 0.06 combat) (§7) |
| 25 | Leaderboard untouched | Souls not added; leaderboard counts orbs only (§13) |
| 26 | Plan placement | New file `docs/WEAPON_EVOLUTION_PLAN.md`; SPEC.md and the biome plan untouched; commit-per-phase in the consolidated repo |

---

## 15. Verification summary for implementer

Baseline: `node scripts/dungeon-check.mjs` = broken=0/40. After Phase 0:
`node scripts/weapon-check.mjs` green (1–8). Phase 3 must prove the legendary
proc actually fires (it has never fired — §6). Every phase ends with a commit in
the consolidated games-benchmarks parent repo.
