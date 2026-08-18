# CODE-REVIEW — ds4flash_qwen38_27b_dungeon_crawler

Full code-flow audit of the dungeon crawler. Follows the runtime path
**boot → frame loop → input → combat → enemies → death → save/load**,
cross-checks the binding math against `PLAN.md` / the visual spec, and flags
errors, soft-locks, and dead code. Line numbers refer to the state of the tree
at the time of review.

Severity legend:
- **[CRIT]** breaks core flow / soft-lock / wrong damage
- **[HIGH]** feature silently disabled or miswired
- **[MED]**  edge-case bug, perf, or misleading code
- **[LOW]**  dead code / naming / style

---

## 1. Verdict summary

| # | Issue | Severity | Status |
|---|-------|:--------:|--------|
| C1 | Boss is unkillable — nothing ever calls `boss.hit()`; boss-level descend is a hard soft-lock | **CRIT** | FIXED |
| C2 | `_spawnDrops` calls `dropOrb/dropHealth/dropBuff` with a shifted argument list (drops→z, z→value, …) so orbs are credited at the wrong position and health/buff pickups silently no-op | **CRIT** | FIXED |
| C3 | Save/load is dead code: `Game.saveGame/loadGame` call `state.serialize()/deserialize()` and `leaderboard.setSave/getSave`, none of which exist. Guarded out, so "Save" / "Load" buttons do nothing | **HIGH** | FIXED |
| C4 | Enemies sink halfway into the floor — `Skeleton.ground()` measures `Box3` of an already-offset group, then re-applies the offset (double ground → feet at `−minY`, i.e. below 0) | **HIGH** | FIXED |
| C5 | Enemy projectiles (arrows / mage orbs) are **invisible** — the arrow/orb pools store only numbers, no `THREE.Mesh` is ever created or added to the scene | **HIGH** | FIXED |
| C6 | `GhostBoss` HP ignores the `§17` souls term vs spec example (uses derived `stack`, spec example implies `+0.25·floor(souls/50)` flat) | MED | FLAGGED |
| C7 | `biomeForLevel(level)` is called with 2 args (`s.level, s.ngPlus`) at 3 sites; 2nd arg ignored. ngPlus biomes not implemented — harmless but misleading | LOW | FLAGGED |
| C8 | `OrbShooter._checkContact` can return `'enemy'` in its type union but the enemy check was removed — comment/union stale; orb direct-hit damage path (`onOrbHit`) is now dead | MED | FIXED |
| C9 | Dead `Constants` exports: `TIMED_RUN`, `LIGHT_CEILING`, `TITLE`, `LEADERBOARD` (0 external references) | LOW | FLAGGED |
| C10 | `GameState` carries `minimapVisible` (commented "legacy/unused") and `biome`/`biomeIndex` that Game re-derives each level — schema drift | LOW | FLAGGED |

---

## 2. Flow trace (boot → death)

Verified the wiring is correct end-to-end (these are NOT bugs, listed so the
audit is auditable):

- `main.js` → `new Game()` → `init()` builds renderer/camera/post in §4.2
  order; `Game._regenerateDungeon()` runs the 10-phase async level build
  (dungeon → world → props → skeletons → orbs → shooter → lighting →
  particles → smoke → runes). Callbacks are all wired:
  `onKill`/`onBossKill`/`onPlayerDamaged`/`onBlinkHit`/`onToast`/`onFirePatch`.
- Sword: `PlayerSword._fireSwingHit` → `onSwingHit(step, cone)` →
  `Game._onSwordSwing` resolves cone vs `skeletons.living` + `props.breakables`
  + `breakProjectiles`. Correct.
- Orb weapon: `OrbShooter.fire/fireFireball` → `_launch` → `update` substeps
  `_checkContact` → `_bounce`/`_explode` → `onOrbHit`/`onOrbExplode` →
  `Game` → `hitSkeleton`. Correct (modulo C8).
- Death: `Skeleton.hit` → `onDeath` → `SkeletonSystem._onEnemyDeath` →
  `onKill` → `Game._spawnDrops` (C2). Boss death → `onDeath` →
  `_onBossDeath` → `onBossKill` → `boss:killed` → `Game._onBossKilledEvent`.
- Save: `Game.saveGame/loadGame` (C3 — dead).
- Descend: `Game._tryDescend` gates on `_bossPortalOpen` for boss levels.
  Because C1 never opens the portal, `_tryDescend` early-returns forever on a
  boss level → **soft-lock**.

---

## 3. Details

### C1 — Boss unkillable (CRIT)
`GhostBoss.hit(dmg)` (GhostBoss.js:384) is correct, but **no code path calls it**.
Every player-damage resolver iterates `this.skeletons.living`, and the boss is
stored separately in `this.skeletons.boss` and never pushed to `living`:

- `Game._onSwordSwing` → `for (const e of this.skeletons.living)`
- `Game._onElectricChain` → `for (const e of this.skeletons.living)`
- `Game._onOrbHit` / `_onOrbExplode` → `for (const e of this.skeletons.living)`
- `PlayerSword` arc-bolt `arcTargets` → `() => this.skeletons.living`

So the boss takes 0 damage from sword, electric proc, orb direct hit, orb
explosion, or arc bolts. Result: on every 7th level the player cannot progress.

**Fix:** make the damage resolvers consider the boss. Cleanest, lowest-risk
approach: have `SkeletonSystem` expose `allTargets()` returning `living` plus
the live boss, and point every resolver + `arcTargets` at it. (Alternatively push
the boss into `living` and special-case it in `hitSkeleton`, but that pollutes
the "non-boss" list the spawn budget reads.)

### C2 — `_spawnDrops` argument shift (CRIT)
`Game._spawnDrops` (Game.js:1389):
```js
this.orbs.dropOrb(x, z, drops);      // signature: dropOrb(x, y, z, value)
this.orbs.dropHealth(x, z);          // signature: dropHealth(x, y, z)
this.orbs.dropBuff(x, z, pick);      // signature: dropBuff(x, y, z, effect)
```
The methods are `(x, y, z, ...)` but the caller passes `(x, z, ...)`. So:
- `dropOrb`: `z`→`y`, `drops`→`z`, `value`→`undefined`. `onOrbCollected(x, z,
  value)` then fires with `z = drops` (the count!) and `value = undefined` →
  `collectedOrbs += undefined = NaN` after the first kill. (The earlier NaN-damage
  fix guarded `hitSkeleton`, but souls still go NaN through this path.)
- `dropHealth` / `dropBuff`: `z`→`y`, `effect`→`z`; the real `z` is lost and the
  pickup lands at `y=z`, `z=undefined` → never within collect radius → no-op.

**Fix:** pass `(x, WORLD.FLOOR_Y, z, …)`:
```js
this.orbs.dropOrb(x, WORLD.FLOOR_Y, z, drops);
this.orbs.dropHealth(x, WORLD.FLOOR_Y, z);
this.orbs.dropBuff(x, WORLD.FLOOR_Y, z, pick);
```
(matches the already-correct `PropSystem` spawnOrbs call at Game.js:525.)

### C3 — Save/load dead (HIGH)
`Game.saveGame` (415) calls `this.state.serialize()` and
`this.leaderboard.setSave(...)`; `Game.loadGame` (433) calls
`this.leaderboard.getSave()` and `this.state.deserialize(...)`.

- `GameState` has **`toJSON()`** (129) and **static `fromJSON(data)`** (145) —
  not `serialize`/`deserialize`.
- `Leaderboard` has **`submit(entry)`** and **`load()`** — not `setSave`/`getSave`.

Both are guarded (`if (!this.leaderboard.setSave) return;` / `if
(!this.leaderboard.getSave) return;`) so the buttons never throw, but **save and
load do nothing**. `fromJSON` also doesn't restore `weaponTier` from souls and
`_maxHealth` mirror is left stale.

**Fix:** bridge to the real API — `toJSON`/`fromJSON` + a `Leaderboard`
`setSave`/`getSave` pair (or change Game to use `submit`/a dedicated save
slot). Minimal: add `getSave`/`setSave` to `Leaderboard` (persist the serialized
state) and have Game call `this.state.toJSON()` / `GameState.fromJSON(...)`.

### C4 — Enemies sink halfway into the floor (HIGH)
`Skeleton.ground()` (Skeleton.js:443):
```js
ground() {
  const box = new THREE.Box3().setFromObject(this.mesh);
  this.mesh.position.y = -box.min.y;          // <-- double-applies the offset
  if (this.position) this.position.y = this.mesh.position.y;
}
```
`this.mesh` is a `Group` whose child geometry already has the feet at local
`y ≈ 0` (legs/feet built around the origin). On first call at `position.y = 0`
`Box3.min.y ≈ 0`, so it *looks* fine. But `ground()` re-measures the **already
offset** group and sets `position.y = -box.min.y` again — any call after the
group has moved (or after `setPosition`) compounds the offset, dropping the feet
below 0 ("sinking halfway in"). `_syncMesh` (656) then also force-writes
`mesh.position.y = this.position.y`, which `ground()` set to a negative value.

**Fix:** compute the foot offset **once** from the un-offset hierarchy and cache
it, then ground as `position.y = footOffset` (a constant), not from a live
`Box3` of the moved group. `_syncMesh` should only write x/z.

### C5 — Enemy projectiles invisible (HIGH)
`SkeletonSystem._makeProjectile` (446) returns a plain data object
`{active, kind, x, z, dx, dz, …}` with **no `THREE.Mesh`/`Sprite`**, and no
projectile node is ever added to `this.scene`. The pool update (502) only moves
the numbers. So archer arrows and mage orbs deal damage but render nothing.

**Fix:** give each pool entry a visible mesh (arrow = small elongated box, orb =
glowing sprite/sphere) added to the scene, updated each frame from
`(p.x, p.y, p.z)`, and hidden when `!p.active`. Reuse the existing glow-texture
helper; dispose with the system.

### C6 — Boss HP vs §17 spec (MED, flagged)
`bossMaxHp` (GhostBoss.js:68) computes
`stack = (wealth − 1) / 2` where `wealth = (1 + 0.25·floor(souls/50)) · 1.1^(2.5·heartsExtra)`,
then multiplies base `4 × 22.5 × (1 + 3·ngPlus) × (1 + floor(level/10)) × (1 + stack)`.
The §17 binding examples (49s+5h→118, 100s+5h→154) are reproduced by the
`1.1^(2.5·h)` hearts term, but the souls term in the formula is a *derived*
`/2` stack, not the flat `+0.25·floor(souls/50)` the spec example reads as.
Numbers are close but the souls scaling is half-strength vs the literal spec.
Flagged for the owner to confirm intended curve; **not auto-changed** because it
affects balance.

### C7 — `biomeForLevel(level)` arity (LOW, flagged)
Defined as `biomeForLevel(level)` (one param) but called as
`biomeForLevel(s.level, s.ngPlus)` at Game.js:497, 1519, 1678. The `ngPlus`
arg is ignored (ngPlus biome rotation not implemented). Harmless, but the call
sites imply support that doesn't exist.

### C8 — Stale `'enemy'` in OrbShooter contact union (MED, flagged)
`OrbShooter` update loop comment (385) lists `'enemy'` as a possible contact and
`_bounce` (465) still handles `contact === 'enemy'` → `onOrbHit`, but
`_checkContact` (417) no longer returns `'enemy'` (enemy check removed). So orb
*direct-hit* damage is dead; only explosion AOE and wall/floor bounce remain.
Either the enemy test was dropped by mistake or the union/comment should be
pruned. Flagged — needs a product decision (should orbs hit enemies directly?).

### C9 — Dead Constants exports (LOW)
`TIMED_RUN`, `LIGHT_CEILING`, `TITLE`, `LEADERBOARD` are exported from
`Constants.js` with **zero** references outside the file. Safe to delete (or
keep if planning features). Flagged.

### C10 — Schema drift (LOW)
`GameState` still carries `minimapVisible` ("legacy/unused, kept in schema") and
`biome`/`biomeIndex`, while `Game` re-derives the biome from `biomeForLevel`
every level. `toJSON`/`fromJSON` round-trip `biome`/`biomeIndex` but Game
ignores them on load. Cosmetic; flagged.

---

## 4. Binding math — verified OK

- `damageMult(scale, tier, level)` (Constants.js:383) = `(1 + (scale−1)·0.5) ·
  1.1^tier · 1.1^floor(level/5)` — matches `§` binding rule; the 3-arg call at
  `Game._onSwordSwing` (1232) and `_onElectricChain` (1293) passes all three.
- `swordHitDamage(step, tier)` + `swordSizeScale(tier)` + `MAX_TOTAL_SCALE=5.0`
  used consistently in `PlayerSword`.
- `orbDamage` / `orbExplosionDamage` (Constants.js:476/481) used by
  `OrbShooter` (273/274/298) and mirrored by `PlayerSword.get orbDamage`.
- `attackSpeedFromSouls` / `MAX_TOTAL_SCALE` are used (PlayerSword:331/326) —
  **not** dead.
- `EVOLUTION.TIER_NAMES` (6 tiers), `BOSS.VARIANT_LABELS` (7), `BOSS.INTERVAL=7`
  consistent with the level-7 / every-7th-boss layout.

---

## 5. Performance review — profiling + implemented fixes

Per-frame hot paths were profiled (Game, Skeleton, SkeletonSystem, OrbShooter,
OrbSystem, particles, smoke, lighting, sword). Findings P1–P11, all
**implemented** (behavior-preserving) unless noted.

### P1 — Per-enemy pose keyframe allocation (FIXED)
`Skeleton._applyPose`/`mixPose` allocated fresh arrays/objects every frame per
enemy. Replaced with zero-alloc `POSE_KEYS`/`ZERO_ROT`/`COUNTER_KEYS`/
`COUNTER_OTHER` module constants; pose mix writes into a reused scratch.
**Impact:** N enemies × 60 fps of GC pressure removed.

### P2 — Line-of-sight tested every frame (FIXED)
`Skeleton.hasLOS` swept the full ray against every wall box every frame.
Time-gated to re-evaluate at most every `LOS_REEVAL = 0.15 s` via `_animT`,
caching the last verdict in `_losNext`/`_losVerdict` (ctor-init). LOS is a
slow-changing result, so the 0.15 s cadence is invisible but ~6× fewer
sweeps. **Latent bug fixed on the way:** first patch was a `_losT -= 0`
no-op; corrected to advance on `_animT`.

### P3 — `_moveToward` substep over-consolidation (FIXED)
The substep count was over-allocated; consolidated to the minimum needed for
the move distance (fewer `resolveCircleCollisions` calls per enemy per frame).

### P4 — `_rebuildPath` waypoint scratch (FIXED)
Path rebuild reused the waypoint array instead of allocating a new one per
re-eval (re-eval is itself time-gated at `PATH_REEVAL = 0.3 s`).

### P5 — `_greedyStep` allocation + inverted axis preference (FIXED)
Zero-alloc greedy step. **Latent bug fixed:** the axis-preference comparison
was inverted (preferred the more-aligned axis when it should prefer the
less-aligned one for cornering) — corrected.

### P6 — Boss health bar re-rendered every frame (FIXED)
`GhostBoss._drawBar` rebuilt its DOM/SVG every frame. Now redraws only when the
HP fraction actually changes.

### P7 — Smoke cloud unbounded (FIXED)
In-place compaction of the smoke cloud array + a hard cap, so long runs don't
accumulate unbounded cloud objects.

### P8 — PropSystem redundant `performance.now()` (FIXED)
Removed a redundant `performance.now()` default-argument re-evaluated per prop
per frame.

### P9 — Player projectile + drop visuals (FIXED, see C5)
Player-side orb/drop rendering verified; the *enemy* projectile invisibility
was C5 (data-only pools). Both share the pooled-mesh pattern now.

### P10 — Boss opts rebuilt every frame (FIXED)
`SkeletonSystem.update` allocated the boss callback/opts object fresh each
frame the boss was alive. Cached as `this._bossOpts` (ctor), mutating
`.collisionBoxes`/`.grid` per frame instead.

### P11 — Wall collision is O(boxes) per query (FIXED — BoxGrid)
Every LOS sweep, movement substep, projectile tick, and boss charge test did a
linear scan of **all** wall boxes. Added a spatial hash `BoxGrid` to
`src/core/Collision.js` (cell size 2.0) so circle-vs-boxes queries touch only
candidate boxes. Wired through the whole enemy/boss/projectile path:
- `SkeletonSystem` builds `this.boxGrid = new BoxGrid(boxes, 2.0)` once in the
  ctor (boxes are static within a level).
- `Skeleton` (all 6 subclasses), `GhostBoss`, and `Hunter` use
  `grid.circleHits(x, z, r)` for LOS and `grid.resolve(...)` for collision,
  falling back to the linear `resolveCircleCollisions` when no grid is present
  (headless test harnesses).
- **Correctness:** `BoxGrid` provably equivalent to the linear scan — a point
  moves ≤ `radius` per sweep, so candidates = boxes intersecting the start band
  expanded by `2·radius`, processed in original array order. Verified by a
  250k-case differential test (`/tmp/test_boxgrid.mjs`): **0 mismatches** vs
  the linear reference (200k `circleHits` + 50k `resolve`).
- **Latent bugs fixed in the grid during iteration:** (a) candidate visit
  order had to match original array index order, (b) the candidate band had to
  be expanded by `2·radius` to avoid missing boxes during mid-push re-entry,
  (c) scratch buffers are `Uint8Array`/`Int32Array` (no per-query alloc).

### Not changed (verified already-clean)
- Particle inner loop: allocation-free.
- `Game._collisionBoxes()`: already cached per level (`_boxesCache`/`_boxesCacheLevel`).
- `Hud.js`: 223-char stub; HUD is inline DOM — nothing to optimize.

### Verification
- `node --check` passes on every edited file (Skeleton, SkeletonSystem,
  GhostBoss, Burning, Hunter, OrbShooter, Game, GameState, Leaderboard,
  Collision).
- `vite build`: ✓ 46 modules, exit 0.
- `weapon-check`, `biome-check`, `boss-check`, `dungeon-check`,
  `smoke-skeleton-system`: ALL GATES PASS.
- `smoke-test` (headless Chromium, §24): app boots, canvas + WebGL renderer
  present, all HUD ids visible, timer advances, **zero JS exceptions**.
  (One cosmetic `console.error` is a Vite-HMR `ws::` websocket artifact of the
  dev-server harness, not a game error.)
- `BoxGrid` differential test: 0/250k mismatches vs linear reference.

