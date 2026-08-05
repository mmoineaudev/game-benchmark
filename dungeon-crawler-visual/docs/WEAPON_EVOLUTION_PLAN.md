# Weapon Evolution Plan — Souls Ladder

Implementation plan (DRAFT — open points flagged `[OPEN #n]`, arbitrated in the
redraft) for a weapon-evolution system in the dungeon crawler at
`~/Documents/games-benchmarks/dungeon-crawler-visual`.

Status: DRAFT — not implementation-ready. Open points in §12.

---

## 1. Overview

Every 100 souls the sword evolves: **+1 base damage per evolution** and a new
aesthetic, stepping from the default blade up to **a lightsaber that throws
electric arcs**. Progression is strictly cumulative — damage and effect both
grow, the form never reverts.

Design constraints (intent, refined in redraft):

1. **Souls = lifetime orb pickups.** The game's currency is orbs: picked up from
   kills, spent as ammo (`collectedOrbs--` on fire). "Every 100 souls" must use a
   NEW monotonic counter (`soulsEarned`), because the banked count fluctuates —
   a tier based on it could regress when firing.
2. **Sword only.** The melee weapon (floating executioner-style dagger, 3-hit
   combo) evolves. The ranged orb weapon is untouched.
3. **Progressive in damage AND effect.** +1 per hit per tier; electric arcs ramp
   from a rare proc to guaranteed bolts at the final tier.
4. **No new mechanics.** Reuses the existing combo, hit, projectile-pool, and
   HUD patterns. No new keys, no new enemy logic.

---

## 2. Soul economy

`[OPEN #1]` — Source of the counter: (a) lifetime pickups via new `soulsEarned`
(monotonic, recommended), (b) banked `collectedOrbs` (regresses when firing), or
(c) leaderboard score.

Proposed (a): `GameState.soulsEarned` — incremented exactly where `collectedOrbs`
increments today (`OrbSystem` pickup path). Buff pickups and health pickups do
NOT count. Tier = `min(floor(soulsEarned / 100), MAX_TIER)`.

`[OPEN #2]` — Tier cap: MAX_TIER = 5 (500 souls) vs endless. Enemies have fixed
HP (only NG+ multiplies), so uncapped damage trivializes them.

---

## 3. Evolution ladder

`[OPEN #3]` — Ladder shape (thresholds, damage per tier, per-hit application).

Proposed:

| Tier | Souls | Form | Damage (per hit) | Effects |
|---|---|---|---|---|
| 0 | 0–99 | Default blade (current) | 2 / 2 / 3 | existing 1% electric proc (latent bug — see §6) |
| 1 | 100–199 | Slightly bigger, bronze edge | 3 / 3 / 4 | — |
| 2 | 200–299 | Bigger, blue energy edge stripe | 4 / 4 / 5 | — |
| 3 | 300–399 | Energy blade (translucent), white-hot core | 5 / 5 / 6 | arc bolt 10% chance |
| 4 | 400–499 | Bright energy blade, humming glow | 6 / 6 / 7 | arc bolt 35% chance |
| 5 | 500+ | **Lightsaber throwing electric arcs** | 7 / 7 / 8 | 2 arc bolts on EVERY landing strike + idle crackle |

`[OPEN #4]` — Damage applied as `+tier` to each combo hit (2/2/3 → 7/7/8) vs
`+tier` to hit 1 only. Also: cap reached at 500 souls — what happens at 1000?
(HUD "MAX"; damage stops; arcs stay.)

---

## 4. Aesthetics (visual ladder)

`[OPEN #5]` — Exact per-tier geometry/materials. Constraints from established
taste: blade must stay STRAIGHT (no bends), weapon stays floating (no hands),
self-lit materials (layer 2, never lit by the headlight), no shadow casting.

Proposed:

| Tier | Scale (×) | Form change |
|---|---|---|
| 0 | 1.00 | current executioner blade (gunmetal + brass pommel) |
| 1 | 1.12 | + bronze edge tint on the fuller/edge (recolor only) |
| 2 | 1.25 | + emissive blue stripe planes on both blade faces; hilt glow band |
| 3 | 1.40 | blade becomes translucent energy blade (additive cylinder, replaces steel blade mesh); white-hot core line; blade color no longer follows the orb-size color ladder |
| 4 | 1.55 | brighter core, larger glow sprite, subtle hum pulse (sprite scale ±5%) |
| 5 | 1.70 | full lightsaber: bright cyan-white blade, idle crackle arcs (≤ 3 pooled sprites), +1 blade point light |

Scale interaction: `_rangeScale` (orb ladder, ×1–4) and `evolveScale` multiply;
total group scale capped at ×3.5 so the ready pose never covers the crosshair
(edge case §10).

`[OPEN #6]` — Lightsaber color: cyan (0x66eeff) vs blue vs white. And: does the
orb-size color ladder (BLADE_COLORS, 11 steps) keep tinting the CORE at T3+, or
does the evolution form fully own the blade color?

---

## 5. Electric arcs (progressive effect)

`[OPEN #7]` — Arc behavior ladder, bolt vs instant chain, damage, pool size.

Proposed:

- **Arc bolt**: pooled projectile (glow sprite + thin cylinder, 8 in pool),
  homes to the nearest enemy within 20 u, speed 24 u/s, life 1.2 s, damage 1,
  impact sparks on hit. `[OPEN #8]` — bolt damage: flat 1 vs 1 + tier.
- Per-tier proc: T0–T2 = existing rare proc (see §6); T3 = 10% chance, 1 bolt;
  T4 = 35%, 1 bolt; T5 = **100%**, 2 bolts per landing strike.
- **Idle crackle** (T5 only): ≤ 3 pooled additive arc sprites flickering along
  the blade, cosmetic.
- The existing full-screen electric blast (1% chance, kills all in 20 u) stays
  as the legendary proc at every tier.

---

## 6. Latent bug discovered (must fix)

`Game._electricChain` reads `SWORD.ELECTRIC_CHANCE` / `SWORD.ELECTRIC_RANGE`,
but the constants live inside `SWORD.COMBO` (`SWORD.COMBO.ELECTRIC_CHANCE:
0.01`, `ELECTRIC_RANGE: 20`). Both top-level reads are `undefined` →
`Math.random() < undefined` is always false → **the 1% electric chain never
fires today**. The evolution work hoists these to `SWORD.ELECTRIC_*` (or
corrects the references) so the legendary proc actually works, then layers the
tier ladder on top. `[OPEN #9]` — confirm the fix approach (hoist vs reference).

---

## 7. HUD

`[OPEN #10]` — HUD content. Per taste: every element must reflect real state;
no fake indicators.

Proposed:
- Souls line (near the orb line): `Souls: N · Tier III · 42/100 to IV`.
- Tier shown as roman numerals + 5 pips (lit = earned).
- Toast on evolution: `Your blade awakens — Tier III` + blade flash + brief
  hit-stop (0.1 s, non-blocking).
- At MAX: `Tier V · MAX`.

---

## 8. Integration surface

| File | Change |
|---|---|
| `src/core/Constants.js` | NEW `EVOLUTION` block (thresholds, damage, scale, range, arc table, bolt pool); hoist/fix `SWORD.ELECTRIC_*` |
| `src/core/GameState.js` | +`soulsEarned`, +`weaponTier` (defaults 0) |
| `src/entities/OrbSystem.js` | +`soulsEarned++` on orb pickup; notify Game on threshold crossing |
| `src/entities/PlayerSword.js` | tier application: form build per tier, `evolveScale`, energy-blade swap at T3+, arc emission hooks, idle crackle, `evolve(tier)` |
| `src/core/Game.js` | damage `+tier` per hit; arc spawning (pooled); electric proc fix; evolution toast/flash/hit-stop; HUD updates |
| `index.html` | +souls line, +tier pips |
| `scripts/weapon-check.mjs` | NEW — tier/damage/pool validation |
| `docs/SPEC.md` | unchanged (separate plan, same convention) |

---

## 9. Performance budgets

| Budget | Current | After | Check |
|---|---|---|---|
| New point lights | 2 sword lights (danger + growth) | +1 blade light at T5 only (camera-attached, no shadow) | ✓ |
| Arc projectiles | 0 | pool 8 (arrow-pattern) | ✓ |
| New sprites | trail 3 + glow 2 + smoke 1 | + idle crackle ≤ 3 (T5) | ✓ |
| Draw calls | sword ~10 | +≤ 4 (energy blade 1-2, stripe 2, bolt 1-2) | ✓ |
| Per-frame allocation | 0 | 0 (all pooled) | ✓ |
| Textures | 0 new | 0 (reuse glow texture) | ✓ |

---

## 10. Edge cases

| # | Case | Resolution (proposed) |
|---|---|---|
| 1 | Firing orbs drops banked count below a threshold | Impossible — tier derives from `soulsEarned` (lifetime) |
| 2 | Tier up mid-combat | Immediate: toast + flash + 0.1 s hit-stop; combo state preserved |
| 3 | Tier up mid-level / on regen | `weaponTier` persists in state; form rebuilt on `level:start` |
| 4 | Evolution scale + max orb scale + EMPOWERED buff | Total scale capped ×3.5 (ready pose never covers crosshair) |
| 5 | FIREBALL buff active | RMB fires fireballs; evolution is visual-only during the buff (form stays) |
| 6 | Energy blade + BRIGHT buff | Blade is layer-2 self-lit; buffs don't relight it — no change |
| 7 | T5 arcs at level start (no enemies) | Bolts fizzle at life end; no crash (pool pattern) |
| 8 | Arc bolt targets dead enemy | Re-target nearest alive within 20 u; else fizzle |
| 9 | NG+ / new run | Fresh run = fresh `soulsEarned` (0); NG+ enemy HP ×2 keeps T5 in check |
| 10 | 1000+ souls | Tier capped at V; HUD shows MAX; damage/arcs stop growing |
| 11 | Electric proc + arc bolt same strike | Both can fire; proc is screen-clear, bolts single-target — no conflict |
| 12 | dungeon-check.mjs | Unaffected (no world geometry change); must stay broken=0/40 |

---

## 11. Implementation phases (commit per phase)

| Phase | Scope | Gate |
|---|---|---|
| 0 | Constants `EVOLUTION`, GameState fields, OrbSystem `soulsEarned`, `weapon-check.mjs` | weapon-check green; dungeon-check 0/40 |
| 1 | Damage ladder + HUD (souls line, tier pips, toast) | tier math verified headlessly |
| 2 | Visuals T1–T2 (scale, bronze/blue edge) | visual/console probe |
| 3 | T3–T4 energy blade + arc chance ladder + ELECTRIC bug fix | arc proc table matches constants; proc now actually fires |
| 4 | T5 lightsaber: guaranteed bolts, idle crackle, blade light | pool ≤ 8; lights +1; no alloc |
| 5 | Final gates: full descend, no console errors, dungeon-check 0/40, weapon-check clean, perf probe | all gates |

---

## 12. OPEN POINTS (to arbitrate in redraft)

| # | Question | Options |
|---|---|---|
| 1 | Souls counter source | lifetime `soulsEarned` / banked orbs / score |
| 2 | Tier cap | MAX_TIER 5 / endless |
| 3 | Ladder thresholds & damage | as proposed / other spacing |
| 4 | Damage application | +tier per hit / +tier hit 1 only |
| 5 | Visual tier details | as proposed / color / scale steps |
| 6 | Lightsaber color + orb-ladder color interaction | cyan / blue / white; core tinted or form-owned |
| 7 | Arc ladder | as proposed / other chances |
| 8 | Arc bolt damage | flat 1 / 1 + tier |
| 9 | ELECTRIC bug fix approach | hoist constants / fix references |
| 10 | HUD content | as proposed / fewer elements |
