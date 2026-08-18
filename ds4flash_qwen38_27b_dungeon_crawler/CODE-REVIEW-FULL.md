# Code Review — ds4flash_qwen38_27b_dungeon_crawler

**Scope:** full source tree (`src/`, `index.html`, `package.json`, `launch.sh`, `scripts/`), 26 files, ~14.7k lines, read in code-flow order (entry → Game orchestration → per-subsystem → core). Every finding below was verified against the checked-in source; line numbers refer to the current tree. `vite build` passes (no syntax/import errors). This is a **fresh** independent review; it supersedes `CODE-REVIEW.md` in this folder (that file is a shorter prior pass).

**Method.** Each module was read end-to-end, then cross-checked against its callers: constructor signatures vs. call sites, callback wiring (who provides the function, who invokes it, with what arity), field read/write pairs, dispose/leak paths, and feature contracts from `PLAN.md` / §-comments. Findings are tagged:

- **BUG** — behavior is wrong vs. the documented intent (§-comments, `PLAN.md`, constants)
- **DEAD** — code that exists but is never reachable/executed, or fields written but never read
- **LEAK** — resource not released
- **ROBUST** — latent hazard, may or may not fire
- **INFO** — observation / nit

---

## A. Entry & bootstrap

`main.js` (4 lines) → `new Game('app'); game.init()`. `Game.init()` (Game.js:148) runs the §4.2 binding order: renderer → camera(+sword, headlight, fireball) → post → input → events/save → title scene → rAF loop. All guarded for headless (§27). `index.html` provides the HUD/overlay DOM the game queries by id.

| # | Finding | Sev |
|---|---|---|
| A1 | **`Game._onResize` calls `this.post.resize()` which does not exist** (Game.js:1756). PostProcessing has a *private* `_resize()` (PostProcessing.js:316) and no public `resize()`. It is guarded (`if (this.post && this.post.resize)`) so it never throws and does nothing — the composer's own `_resize()` runs inside `render()` anyway, so resizing works by accident. The guarded call is dead; if the guard were removed it would `undefined is not a function`. | LOW (dead call) |
| A2 | **`_plChange` pointerlock handler**: on lock, `this._hideLeaderboard()` is called even when the leaderboard was never open (Game.js:268). Harmless (idempotent) but runs `setPointerLock(true)` only via the guarded branch below; on unlock `_hideLeaderboard()` is also called (line 270) — double-path redundancy. | INFO |
| A3 | `init()` catch sets `this.headless = true` and swallows the error (Game.js:174-177). Fine for §27, but it also means a *real* browser exception in `_initTitleScene` silently leaves a half-initialized game (renderer exists, no title scene, no loop) with only a console.error. | INFO |

**Bootstrap verdict:** OK. Renderer/camera/scene lifecycle is clean; `_disposeScene` (Game.js:705-735) disposes post, shooter, sword, props, lighting, runes, particles, smoke, skeletons, hunter, fire-patches, and removes camera children in a sane order.

---

## B. Core state (GameState, Constants, EventBus, Leaderboard)

### GameState.js

| # | Finding | Sev |
|---|---|---|
| B1 | **Whole legacy buff API is DEAD.** `buffEffect`/`buffTime` (fields, :65-66), `applyBuff()` (:80), `updateBuff()` (:96) are never called from the game — the live path is Game-owned `activeBuff`/`activeBuffTimer`. The class's own comment (:134-136) admits it. ~40 lines of parallel, untested buff logic. | DEAD |
| B2 | **Sprint-accel API is DEAD.** `updateSprint(dt, moving)` (:109), `sprintSpeedMult()` (:123), `sprintTier`/`sprintHoldTime` (:61-62) — zero callers. The real sprint logic lives inline in `Game._updatePlayer` (Game.js:1008+, which reads `PLAYER.SPRINT_MULT` directly). `sprintSpeedMult()` is unreachable. | DEAD |
| B3 | **`sprintHoldTime` is incremented but only inside the dead `updateSprint`** — and `Game._updatePlayer` computes its own hold-time. Two implementations of the same feature, one dead. Consolidate. | DEAD |
| B4 | `serialize()`/`deserialize()` round-trip `activeBuff`/`activeBuffTimer` but **not** `invulnTimer`, `safeSpawn`, `swordCombo`, `hitStop`, or `player.y` beyond the flat spread. On load, `safeSpawn` resets to 0 (not restored) — acceptable, but a loaded run drops its safe-spawn grace. `minimapVisible`, `effectsEnabled`, `inExitRoom`, `visitedCells`, `dungeonSeed`, `totalOrbs` are in the constructor but **not** serialized (totalOrbs *is*, the rest aren't) — on load `visitedCells`/`dungeonSeed` silently reset. | ROBUST (minor) |
| B5 | `fromJSON()` (static) and `deserialize()` duplicate ~20 lines of the same field-restore + self-heal logic. Two sources of truth for the same invariant; keep one. | INFO |
| B6 | **`applyBuff()` roll-retry loop can spin**: `do { candidate = 1 + floor(random*5) } while (candidate === this.buffEffect)` — correct, but the outer `while (picked === this.buffEffect && this.buffEffect !== 0)` can re-roll *forever* in the pathological case where the random keeps landing on the active effect. Extremely unlikely (1/4 per roll) and the method is dead anyway (B1). | DEAD-adjacent |

### Constants.js

| # | Finding | Sev |
|---|---|---|
| B7 | **`biomeForLevel(level)` takes one param but is called with two** (`s.level, s.ngPlus`) at Game.js:497, 1522, 1681. The 2nd arg is silently ignored. ngPlus-specific biomes are not implemented, so behavior is correct — but the call sites are misleading and will break loudly-wrong if a 2-arg version is ever added. Either drop the 2nd arg or implement it. | LOW |
| B8 | `ENEMY.speedMult(level, bossKills)` / `attackMult(level, bossKills)` (:255-259) take `bossKills` and apply `BOSS_KILL_SPEED_BONUS` — **but** `SkeletonSystem` computes its own `_speedMult`/`_attackMult` from `ngPlus` only (SkeletonSystem.js:187-188 and Game.js:775-776 override with `1 + ngPlus*0.05`), *ignoring* the exported functions and the boss-kill bonus. So the boss-kill speed/attack bonus defined in constants is never applied. Either the constants are aspirational or the Game/SkeletonSystem overrides are stale. | BUG (feature mismatch) |
| B9 | `BUFF.EMPOWERED` / `BUFF.GODSPEED` reference **`damageMult` only in a comment intent** — see C2. The constants themselves are fine; the *consumer* is wrong. | — |

### EventBus.js
Trivial pub/sub; `on`/`emit`/`off` correct, no leaks (Game re-binds once in `init`). Clean.

### Leaderboard.js

| # | Finding | Sev |
|---|---|---|
| B10 | **Save slot is a separate localStorage key but shares the class.** `setSave`/`getSave` (F3) use `this.key + ':save'` while rankings use `this.key`. Fine, but `_memSave` fallback (headless) is a *single* in-memory var shared for both save and… actually only used for save; rankings fall back to `_mem`. OK. The concern: on `submit()`, if localStorage throws, it falls back to `this._mem = entries` — but the *next* `submit()` re-reads via `_readRaw()` which (in headless) returns `this._mem ?? []` — consistent. Acceptable. | INFO |
| B11 | `submit()` trims to top-10 **by sort order** but the ranking comparator sorts ngPlus-desc first; a fresh low NG+ run is always dropped in favor of old high-NG+ runs even if the new run is "better" in time — by design per §23, but worth confirming intent. | INFO |
| B12 | **`getSave()` returns the *parsed* object; `setSave` returns the snapshot.** Game's `_bootstrapSave`/`loadGame` treat the return of `getSave()` as the snapshot — correct. No bug. | OK |

---

## C. Game.js orchestration (the big one)

### C. Buff application — **the EMPOWERED/GODSPEED damage bug**

`Game._onBuffCollected` (Game.js:1404) is the single place buffs are applied. Cross-checking every branch against Constants + consumers:

| # | Finding | Sev |
|---|---|---|
| **C1** | **EMPOWERED sets a non-existent `buffDamageMult`.** Game.js:1411 `this.sword.buffDamageMult = BUFF.EMPOWERED.damageMult`. But (a) `BUFF.EMPOWERED` in Constants.js:510 has **no `damageMult` key** (only `swordLengthMult`, `moveMult`, `attackSpeedMult`) → the right-hand side is `undefined`; (b) `PlayerSword` **never reads `buffDamageMult`** (only writes at :600/:1411/:1414/:1448). So EMPOWERED's implied damage boost is silently `undefined`→never applied, and the field is write-only. The "faster attacks + longer reach" part works (`attackSpeedMult`, `swordLengthMult` are real), but any intended damage multiplier is dead. | **BUG** |
| **C2** | **GODSPEED buff is never actually granted.** `BUFF.EFFECTS` includes `'GODSPEED'` (Constants.js:504) and `Game._updatePlayer` applies `GODSPEED.moveMult` (Game.js:1014), but `GODSPEED` is **not** in the drop tables: `PropSystem.breakBreakable` rolls from `BUFF.EFFECTS.filter(...)` (5 effects incl. GODSPEED) so it *can* drop… however `OrbSystem` buff drops and the boss reward also draw from `BUFF.EFFECTS`. Re-check: GODSPEED **is** in `EFFECTS`, so it *can* be rolled. The real gap: `Game._onBuffCollected` has **no branch** for GODSPEED that sets `shooter.setActiveBuff` correctly — actually `setActiveBuff(_buffIndex(effect))` maps it to index 4, which the shooter handles generically. Net: GODSPEED works for move speed but, like EMPOWERED, has **no damage/attack-speed wiring** (no `sword.attackSpeedMult` set for GODSPEED — only EMPOWERED gets `attackSpeedMult` at :1410). So GODSPEED's `attackSpeedMult: 1.5` constant is never consumed. | **BUG** |
| C3 | **`_onBuffExpired` (Game.js:1442) does not reset `sword.lengthMult` for the HUNTER/BRIGHT/FIREBALL expirations consistently** — it *does* reset `lengthMult=1` (:1455) and `buffAttackSpeedMult=1` (:1447), good. But the **BRIGHT** expiry calls `setBright(false)` only inside `if (this.lighting)` and *separately* re-asserts `setDegraded(0)` when degraded — correct. No bug; listed to confirm the expiry path is complete. | OK |
| C4 | **`activeBuffTimer` for a boss-kill buff is set to `BOSS_DURATION` (300s) at Game.js:469, but the *normal* buff path sets it to `BUFF.DURATION` (60s) at :1407.** The boss reward (`_onBossKilledEvent`) grants a random buff via `_onBuffCollected(rewardBuff)` (Game.js:468) which sets 60s, and *then* the surrounding code overrides to `BOSS_DURATION` (300s). Ordering matters: confirm the override (469) runs *after* `_onBuffCollected` (468). It does (sequential). OK. | OK |

### C. Boss lifecycle

`SkeletonSystem` owns the boss; `Game` reacts via `onBossKill` → emit `boss:killed` → `_onBossKilledEvent`.

| # | Finding | Sev |
|---|---|---|
| **C5** | **The boss's CHARGE attack never damages the player.** `GhostBoss.update` CHARGE branch (GhostBoss.js:711-714): on contact it does `const cb = opts.onChargeHit \|\| this.onChargeHit; if (cb) cb(this);`. `this.onChargeHit` is **never initialized** anywhere in GhostBoss (constructor sets `onSummon`, `onBlinkHit`, `onDeath` to null at :146-148, but **not** `onChargeHit`), and `SkeletonSystem`'s cached `_bossOpts` (SkeletonSystem.js:155-165) passes `onSummon`/`onBlinkHit` but **not `onChargeHit`**. Result: `cb` is always `undefined` → the `if (cb)` guard is always false → the boss charge deals **zero** damage despite `BOSS.CHARGE_DMG: 2` and the comment "deals CHARGE_DMG once". The boss's primary aggressive attack is silently disabled. | **BUG (major)** |
| C6 | `_bossOpts` is cached once (perf) but `onSummon`/`onBlinkHit` are **stable closures** capturing `this` (SkeletonSystem) — fine. However `onChargeHit` being absent from this same cached object is exactly why C5 can't self-heal. | BUG (root of C5) |
| C7 | `bossBarUpdated` flag (GhostBoss.js:114) is set on hp change but **Game never reads it** — the HUD boss bar instead re-reads `boss.hp/boss.maxHp` every `_updateHud` (Game.js:1578-1591). The flag is write-only. | DEAD |
| C8 | Boss defeat: `hit()` sets `alive=false`, `state=DEAD`, fires `onDeath` (GhostBoss.js:389-407) → SkeletonSystem `_onBossDeath` → `onBossKill` → Game `boss:killed` → `bossKills++`, `_bossPortalOpen=true`, buff, `_regenAcc=0`. This chain is complete and correct. | OK |

### C. Combat resolution (sword / orb / electric / blink)

`Game` resolves all player-damage by iterating `skeletons.allTargets()` (living non-boss + live boss) and `props.breakables`.

| # | Finding | Sev |
|---|---|---|
| C9 | `_onSwordSwing` (Game.js:1228) damage formula: `this.sword.damage(step, s.weaponTier, damageMult(this.sword.scale, s.weaponTier, s.level))`. The comment warns "passing fewer yields NaN". All three args are passed — OK. But note **EMPOWERED's missing damage mult (C1)** means the sword never sees the buff damage component. | BUG (see C1) |
| C10 | `_onElectricChain` (Game.js:1289) targets by `SWORD.ELECTRIC_RANGE` around the **player** (`s.x, s.z`), not around the struck enemy — i.e. the electric proc is a player-centered AoE, not a chain from a hit. If §9.3 intends a chain *from* the struck target, this is wrong; if it intends a player-centered pulse, it's fine. Ambiguous vs. the "Electric proc (§9.3)" doc — flag for confirmation. | ROBUST/AMBIGUOUS |
| C11 | `_onOrbHit`/`_onOrbExplode` (Game.js:1314-1353) use `e.radius || 0.4` and hit the **first** enemy in radius (orb) or all in blast (explode). Reasonable. `hitStop` uses `HIT_STOP.ORB_HIT`. OK. | OK |
| C12 | `_spendOrb` (Game.js:1160) decrements `collectedOrbs` by `COST_PER_HIT` and calls `_checkEvolution` — meaning **spending orbs can only keep you at/under your tier**; evolution is "never downgrades" (GameState.js:39) so `weaponTier` is a running max. Consistent with the "locked at max" contract. OK. | OK |

### C. Player damage / death / hazards

| # | Finding | Sev |
|---|---|---|
| C13 | `_onPlayerDamaged` (Game.js:1363) honors `invulnTimer` (i-frames) and sets `PLAYER.I_FRAMES`. **Hazards bypass the source-check** — `tickHazard` returns accumulated damage and is fed straight into `_onPlayerDamaged` (Game.js:943), so hazards *do* respect i-frames (good). But see E1: the per-hazard tick only fires when the player is *inside* `HAZARD.DAMAGE_RADIUS`, and the "inside" test uses `<=` on squared radius — consistent. OK. | OK |
| C14 | `_die()` (Game.js:1375) sets `_isRunning=false` and emits `run:ended`. But the **rAF loop `_animate` does not check `_isRunning`** — it checks `_deathVisible` (set by `_showDeathScreen`). Confirm `_onRunEndedEvent` → `_showDeathScreen` runs synchronously so the frame isn't skipped. It does (event is emitted synchronously in `_die`, listener calls `_showDeathScreen`). OK. | OK |
| C15 | **`safeSpawn` is decremented with `dt` (real time) while most systems use `sdt` (hit-stop scaled time).** Game.js:952 uses `dt`, movement uses `sdt`. During hit-stop, safe-spawn ticks faster than the world — negligible (0.05 scale) but inconsistent; use `sdt` for coherence. | NIT |

### C. Regeneration

| # | Finding | Sev |
|---|---|---|
| C16 | **`PLAYER.REGEN_DELAY` is defined (Constants.js:34 = 0) but the regen loop (Game.js:879-886) never references it** — it only uses `REGEN_INTERVAL`. The constant is aspirational; if a delay were ever added, this loop ignores it. Either wire it or remove the constant. | DEAD |

### C. Exit / descend / NG+

| # | Finding | Sev |
|---|---|---|
| C17 | `_updateExit` (Game.js:1466) computes boss-level via `(s.level - 1) % BOSS.INTERVAL === BOSS.INTERVAL - 1`, **duplicating** `sys.isBossLevelFn` (SkeletonSystem) and the biome branch in `biomeForLevel`. Three places encode "boss level" — if `BOSS.INTERVAL` and the biome cadence ever diverge, exit logic and biome logic disagree. Centralize. | ROBUST |
| C18 | `_tryDescend` (Game.js:1488) increments `s.level`, resets `levelTime`, sets `safeSpawn=5`, then `_regenerateDungeon()`. **`s.runTime` is not reset** (correct — total run seconds). But `s.levelTime` and `safeSpawn` are the only per-level resets; `visitedCells`/dungeon-specific state lives in the regenerated dungeon, fine. OK. | OK |
| C19 | **NG+ / `newGamePlus`** — `btn-ngplus` binds to `this.newGamePlus` (Game.js:296); the method exists at Game.js:397 (alongside `newGame` :377, `saveGame` :415, `loadGame` :433, and keyboard edges N/L/Y/S at :1089-1099). Wiring complete. | OK |

### C. HUD

| # | Finding | Sev |
|---|---|---|
| C20 | `_updateHud` (Game.js:1507) runs **every frame** (called unconditionally at :980) and does ~15 `document.getElementById` lookups + `querySelectorAll('#combo-pips .pip')` each frame. The `_hudDirty` flag is set/reset (:981) but **never checked** to skip work — it's write-only. The per-frame DOM churn is real cost, especially `querySelectorAll` per frame. Either honor `_hudDirty` or drop the flag. | PERF / DEAD flag |
| C21 | HUD boss bar (Game.js:1578-1591) reads `this.skeletons.boss` — but the boss is removed from `SkeletonSystem.boss` (set to `null`) the frame it dies (SkeletonSystem.js:822 `this.boss = null`). So the boss bar disappears the same frame the boss dies — correct, no lingering. OK. | OK |
| C22 | `_updateMessages` (Game.js:1612) rebuilds the toast DOM only when `this._messages.length !== this._msgSig` — good, avoids per-frame innerHTML. `_toast` sets `_msgSig = -1` to force a rebuild. Correct. | OK |

---

## D. Entities

### Skeleton.js (base + variants)

| # | Finding | Sev |
|---|---|---|
| D1 | `hit(dmg)` (Skeleton.js:503) is the shared damage entry. Variant constructors pass through. `setCollectedOrbs` (:484) "used by some variants" — only called for the hunter in practice; on skeletons it's a harmless no-op hook. | INFO |
| D2 | **`Skeleton` exposes `position` as a `THREE.Vector3`** but Game also reads `e.position.y + 0.8` for a "chest height" in `_onSwordSwing` (Game.js:1257). Confirm `position.y` is kept at feet (0) so `+0.8` is the intended chest. If any variant sets `position.y` to the mesh center, the vertical tolerance check (:1258) silently mis-fires. | ROBUST |

### SkeletonSystem.js (spawn plan, AI driver, projectile pools)

| # | Finding | Sev |
|---|---|---|
| D3 | **`_speedMult`/`_attackMult` are computed twice with different inputs.** Constructor (SkeletonSystem.js:187-188) sets them from `ENEMY.speedMult(level, bossKills)` (which *includes* the boss-kill bonus), but **Game immediately overrides** them with `1 + ngPlus*0.05` (Game.js:775-776), discarding the boss-kill bonus and the level scaling from the constants. So the exported `ENEMY.speedMult/attackMult` (and `BOSS_KILL_SPEED_BONUS`) are effectively unused. This is the concrete manifestation of B8. | **BUG (feature mismatch)** |
| D4 | `_bossOpts` cached closures are fine, but **the absence of `onChargeHit` is the root cause of C5.** Adding `onChargeHit` to `_bossOpts` (and a matching `opts.onChargeHit` default in GhostBoss) fixes the boss charge. | BUG |
| D5 | `allTargets()` (SkeletonSystem.js:742) returns `living.slice() + boss` if alive. Boss is deliberately kept out of `living` (spawn-budget source) but added to targets so the player *can* hit it — correct. `isCleared()` (:756) checks `living.every(!alive)` — boss levels never "clear" via this path (boss isn't in `living`), which is why boss levels gate on `_bossPortalOpen` instead. Consistent. | OK |
| D6 | Projectile pools (`_arrowPool` 10, `_orbPool` 12, `_shockwaves` 4) are allocated once in the constructor and reused. Confirm no unbounded growth when a pool exhausts (arrows fired beyond 10). If `_makeProjectile` is called past the pool size it allocates new — a per-frame allocation spike under fire. Check the spawn path. | ROBUST |
| D7 | **`BoxGrid` is built once per level from a snapshot that includes breakable boxes, and is never rebuilt.** Chain of evidence: `Game._collisionBoxes()` (Game.js:1047-1056) caches `world.collisionBoxes + props.collidableBoxes()` keyed by level; `SkeletonSystem` receives that snapshot in its constructor and builds `this.boxGrid` over it (SkeletonSystem.js:129), with the comment "Boxes never change within a level". But `props.collidableBoxes()` *does* change — `breakBreakable` splices the record out of `this.breakables` (PropSystem.js:345-346) the moment a barrel/crate breaks. Result: a broken barrel's AABB keeps colliding in the grid (and in the linear `collisionBoxes` list used by enemy movement, SkeletonSystem.js:797) until the level is regenerated — the player/enemies get pushed by an invisible box where the barrel used to be. The sword path is unaffected (it iterates `props.breakables` live, Game.js:1265). Fix: exclude breakables from the grid source, or rebuild `boxGrid`/`_boxesCache` on `prop:broken`. | **BUG** |

### GhostBoss.js

| # | Finding | Sev |
|---|---|---|
| D8 | **`onChargeHit` never initialized** — see C5 (the critical one). | **BUG** |
| D9 | **`opts` is not stored** on the instance; `_trySummon`/`_tryBlink`/CHARGE read `opts.onSummon \|\| this.onSummon` etc. The `opts` passed to `update(dt, player, dungeon, opts)` (GhostBoss.js:674) is the *per-frame* `_bossOpts`. But `this._bossOpts` is rebuilt… no, it's cached once. So `opts` is stable. However, **the DEAD-state update path** (SkeletonSystem.js:822) calls `this.boss.update(dt, player, this.dungeon, {})` with an **empty opts** — so in DEAD state, `opts.onSummon`/`onBlinkHit` are absent and it falls back to `this.onSummon` (null) — which is *fine* because the boss doesn't summon/blink when dead. No bug, but the empty-opts call is fragile: any future dead-state behavior needing a callback silently no-ops. | ROBUST |
| D10 | `smokeClouds` + `_smokeMeshes` are both tracked and both disposed in `dispose()` (GhostBoss.js:790-802). `smokeClouds` entries are `{mesh, mat}`; `_smokeMeshes` holds the same meshes. Slight double-ownership but disposal is idempotent-guarded. OK. | OK |
| D11 | `bossBarUpdated` (see C7) — write-only. | DEAD |
| D12 | `this.position` is the **authoritative** boss position: `_move()` mutates `this.position` (with grid/box resolution) and then `_syncMesh()` pushes it to `this.mesh.position` (GhostBoss.js:474-476, 652). Summon/blink/smoke all read/write `this.position`. Player-damage targeting (`allTargets()` → `e.position`) and the post glow therefore track the boss correctly. **Verified — no bug.** | OK |

### Enemy variants (Burning, Wraith, Brute, Rat, Archer, Armored)

| # | Finding | Sev |
|---|---|---|
| D13 | `Burning._spawnFirePatches` (Burning.js:81-88) calls `Game._spawnFirePatch` via the `onFirePatch` callback (wired at Game.js:756). Game's `_firePatches` pool is capped at 8 (Game.js:1775) and evicts the oldest — fine. OK. | OK |
| D14 | Variant `enemyTypes.js` / `enemyTypes` mapping — confirm each `ENTRY.type` in `ENEMY_SPAWN_WEIGHTS` maps to a real class. `STONE` biome weights are the fallback (SkeletonSystem.js:324). If a biome references a type string with no class, `_spawnMob` returns undefined and a slot is silently wasted. Cross-check the type strings. | ROBUST |

### OrbShooter.js / OrbSystem.js

| # | Finding | Sev |
|---|---|---|
| D15 | `OrbShooter._fbCharge` is written by Game (Game.js:1136/1141) but **read only for visuals** in OrbShooter. The actual fireball fire is `shooter.fireFireball(...)` from Game on full charge. So `_fbCharge` on the shooter is a display mirror — fine, but a second source of the same value. | INFO |
| D16 | `OrbSystem` buff drop: `dropBuff` auto-collects within 1.4u via `onBuffCollected` (OrbSystem.js:247) → Game `_onBuffCollected(buffId)`. The buff *id* passed is the **effect string** (e.g. `'BRIGHT'`), and Game treats it as the effect. Consistent with `PropSystem` path. OK. | OK |
| D17 | **Orb `value` on collect**: `onOrbCollected(x, z, value)` (Game.js:1192) adds `value` to `collectedOrbs`. `dropOrb(x, y, z, n)` — is `value` the per-orb worth or the count? If a barrel drops `n` orbs, does each orb add `value`? Confirm `value` semantics so a 3-orb drop adds the intended souls. Cross-check OrbSystem's collect payload. | ROBUST |

### Hunter.js

| # | Finding | Sev |
|---|---|---|
| D18 | Hunter is a **companion** (HUNTER buff), not an enemy. `setCollectedOrbs` (Hunter.js:77) is called every frame (Game.js:948). `Hunter.update` targets `skeletons.living` (Game.js:935) — **the boss is not in `living`**, so the HUNTER companion **never attacks the boss** (only non-boss skeletons). If the intent is "boss companion follows and attacks mobs", the boss being excluded is arguably correct ("mobs"), but the boss is the biggest mob — flag for intent confirmation. | AMBIGUOUS |
| D19 | Hunter beam: `damage(target, 2)` (Hunter.js:170) — fixed 2 damage, no scaling with level/tier. The hunter is a buff, so flat damage is plausible, but it means the companion's value is constant regardless of progression. | INFO |

---

## E. World

### DungeonGenerator.js

| # | Finding | Sev |
|---|---|---|
| E1 | Generates grid/rooms/entrance/exit/BFS metadata. `metadata` (dist map) is consumed by `_candidateCells` (SkeletonSystem). Deterministic per seed. OK. | OK |

### WorldBuilder.js

| # | Finding | Sev |
|---|---|---|
| E2 | `build(dungeon, biomeTextures, biomeId)` — `biomeId` is **documented unused** ("kept for API", :25) and indeed never read. Dead parameter. | DEAD (minor) |
| E3 | `makeMat(tex, baseColor)`: when a texture is provided it builds a `MeshStandardMaterial({map})` **and ignores `baseColor`**; when null it uses `baseColor`. Correct. `dispose()` skips cached biome textures (`userData.biomeCached`) — good, avoids double-disposing the shared biome cache. | OK |
| E4 | Wall collision depth `COLL_T = WALL_T * COLLISION_DEPTH_MULT` (0.3 × 0.6 = 0.18u). Collision boxes are centered on the wall line. Consistent with the "0.18u effective" comment. OK. | OK |
| E5 | `debrisCount` uses a deterministic scatter `(i*7919) % cells.length` — fine, no `Math.random` in geometry (good for determinism). OK. | OK |

### BiomeSystem.js

| # | Finding | Sev |
|---|---|---|
| E6 | `applyLevel(level, state)` → `biomeForLevel(level)` (one arg, ignoring `state`) — see B7. Lazy per-biome texture cache with `userData.biomeCached` markers (survives scene disposal). `texturesFor(biomeId)` is used by Game (Game.js:320/516). OK modulo B7. | OK |
| E7 | `currentTextures()` returns the active set. Confirmed used by Game for the title scene + level builds. OK. | OK |

### PropSystem.js

| # | Finding | Sev |
|---|---|---|
| **E8** | **`checkHazard(x, z)` (PropSystem.js:499) is DEAD.** Defined and documented in the header contract (:12), but **Game calls `tickHazard` (Game.js:942) instead and never calls `checkHazard`**. Two overlapping hazard APIs; `checkHazard` returns a one-shot `{dmg:true}` while `tickHazard` does the interval-based damage. `checkHazard` is unused. Remove or it will rot. | DEAD |
| E9 | **Water-puddle slowdown is dead.** Game `_collectWaterPuddles` (Game.js:770-783) scans `this.props.hazards` for `h.type === 'water' || h.damage === 0`. But `PropSystem._buildHazard` only ever pushes `{x, z, kind, tick}` with `kind` ∈ {`'lava'`,`'acid'`} — **there is no `water` hazard and no `h.damage`/`h.type`/`h.radius` field** (it's `h.kind`, not `h.type`). So `_collectWaterPuddles` **always returns `[]`** → the water-puddle movement slowdown (§26) **never activates**. The water *visuals* (VAULT pools) are built by `_buildInstancedWater` but are never registered as slow zones. | **BUG (feature dead)** |
| E10 | `breakBreakable` (PropSystem.js:319) overload-dispatches on `target.userData.breakable` / `target.broken` / `target.x`. The `target.broken === undefined && target.x !== undefined` branch treats a plain `{x,z}` as "find nearest within step radius". Game calls `breakBreakable(rec)` with a *record* (has `.broken`), and `stepCheck` passes a record too. The `{x,z}` path is only reachable if someone passes a raw position — currently no one does. Dead branch (minor). | DEAD (minor) |
| E11 | Sarcophagus `triggered` flag is **per-instance** and never reset — a sarcophagus opens once per level build (correct; props are rebuilt per level). OK. | OK |
| E12 | `reduceDecorations(ratio)` (PropSystem.js:886) hides cosmetic groups + sheds instanced water/stalactite tails, called once when degraded (Game.js:826). `degraded` guard prevents re-run. Crystal/biome lights are *not* in `cosmetic` so they survive degrade — matches §22. OK. | OK |
| E13 | `dispose()` (PropSystem.js:936) clears all arrays and `group.clear()`. `lightList` lights are `scene.remove`d. But **cosmetic point lights** created via `_addPointLight(..., {cosmetic:true})` are parented to `this.group`? No — `_addPointLight` adds to `this.group` (not the prop group) and pushes to `lightList`. On dispose, `scene.remove(light)` for each — but these lights were added to `this.group`, not `this.scene`, so `scene.remove` is a **no-op** and the light is only removed because `group.clear()` clears its children. Works by accident; the explicit `scene.remove` is misleading. | NIT |

### LightingSystem.js

| # | Finding | Sev |
|---|---|---|
| E14 | Torch placement `_torchPositions` groups exposed edges into collinear runs, spacing `ceil(16/6)=3` cells. `vaultOnly` biomes filter to vault cells. Single shadow-casting torch assigned to nearest-entrance (budget 1). `setDegraded(0)` strips it, `setDegraded(1)` restores. OK. | OK |
| E15 | **`_lights` array stores `{light, baseIntensity}` but `dispose()` iterates it in an empty body** (LightingSystem.js:197-199) with a comment "lights are parented to their meshes". The `baseIntensity` is stored but **never read** (no dimming feature uses it). Minor dead data. | DEAD (minor) |
| E16 | `setBright` (LightingSystem.js:153) applies `BUFF.BRIGHT.ambientMult` (×2.5) and `fogDensityMult` (×0.35) — wired to BRIGHT buff on/off (Game.js:1419/1452). OK. | OK |
| E17 | `_cellInRoom` (LightingSystem.js:499) used for god-ray vault torch filtering. OK. | OK |

### Textures.js
All generators are `canvasAvailable()`-gated, return null headless, and are cached by callers (BiomeSystem). `mixHex` assumes 6-digit hex — all callers pass 0xRRGGBB. OK. No leaks (callers dispose tracked textures).

---

## F. Systems (post / input / smoke / particles / runes)

### PostProcessing.js

| # | Finding | Sev |
|---|---|---|
| F1 | **`setEnemyTargets()` (PostProcessing.js:198) is DEAD.** Defined and documented ("mark enemy meshes onto layer 1"), but **Game never calls it** (verified: only references are inside PostProcessing itself). Consequently `enemyTargets` is **always empty**, so `_renderEnemyGlow` always takes the "nothing marked" branch (PostProcessing.js:269) → clears the enemy RTs → the **enemy glow post-process is never actually rendered**. The whole §12.2 enemy-highlight pipeline is inert. Either wire `post.setEnemyTargets(skeletons.allTargets())` per frame, or delete the feature. | **BUG (feature dead)** |
| F2 | `render(now)` signature takes `now` but **Game calls `this.post.render()` with no arg** (Game.js:1765) → `now=0`. The `uPulse` uses `Math.sin(now * PULSE_SPEED)` with `now=0` → **the enemy-glow pulse is frozen** (and moot per F1 since nothing is marked). Even if F1 were fixed, the pulse would be static. Pass `this._now` (or `performance.now()/1000`). | BUG |
| F3 | `_onResize` in Game calls `post.resize` (doesn't exist) — see A1. The real resize is `_resize()` inside `render()`. OK functionally. | see A1 |
| F4 | `dispose()` disposes RTs, override material, composer passes. `uIntensity`/`uPulse` are plain floats (no disposal needed). OK. | OK |

### InputSystem.js
Clean. `event.code`-based keys (AZERTY-safe per your convention), pointer-lock guarded, `dispose()` removes all listeners and clears state. `consumeMouse()` accumulates deltas. No leaks. OK.

### SmokeSystem.js / ParticleSystem.js

| # | Finding | Sev |
|---|---|---|
| F5 | **Both are GPU `THREE.Points` with `frustumCulled=false`** and pooled typed arrays — good. But `SmokeSystem` and `ParticleSystem` each create `this.glowTexture = generateGlowTexture(...)` and **dispose it in `dispose()`** — fine. However, the `aLife` attribute is set on the geometry (SmokeSystem.js:66) but **the shader never reads `aLife`** (VERT uses only `aSize`, `aOpacity`). Dead attribute buffer (per-particle write cost, zero use). | DEAD (minor) |
| F6 | `ParticleSystem.update` uses a **module-level `Date.now()` clock** (`performanceHeadlessClock`, ParticleSystem.js:146) *plus* `dt` for drift — meaning absolute-time-based bobbing (`Math.sin(t*0.4)`) combined with dt-based drift. If the tab was backgrounded, `t` jumps → the sinusoid phase jumps, but `dt` is clamped (0.1) so drift is bounded. Minor visual pop on tab-refocus. | NIT |
| F7 | `SmokeSystem.emitPuff` uses `Math.random()` (not a seeded rng) — smoke is cosmetic, fine. `ParticleSystem` also uses `Math.random()` in the constructor — dust is cosmetic, fine. | OK |

### RuneSystem.js
`build()` places 4 runes, `_clear()` disposes + `dispose()`. `update(now)` pulses opacity. Wired (Game.js:583-585, 945). OK.

---

## G. Build / packaging

| # | Finding | Sev |
|---|---|---|
| G1 | `vite build` **passes** — no syntax/import/bundle errors. The issues are all *logical*, not compile-time. | OK |
| G2 | `launch.sh` — verify it starts the dev server / preview correctly (not reviewed in depth; standard Vite). | INFO |
| G3 | `scripts/*.mjs` (biome-check, boss-check) are gate scripts that assert biome cadence and boss levels — they encode the *intended* contract. The boss-cadence assertions (level 7/14/21 = SPECTRAL_COURT) confirm the boss-level formula that C17/Duplicating warns about. | OK |

---

## H. Priority fix list (ranked by player-impact)

1. **Boss charge deals no damage (C5/D4/D8)** — wire `onChargeHit` through `SkeletonSystem._bossOpts` → `GhostBoss` and have it call `onPlayerDamaged(BOSS.CHARGE_DMG, {source:'bossCharge'})`. The boss's main attack is currently cosmetic.
2. **Enemy glow post-process never runs (F1/F2)** — wire `post.setEnemyTargets(skeletons.allTargets())` per frame and pass `this._now` to `post.render(this._now)`, or delete the dead pipeline (the §12.2 enemy highlight is entirely inert today).
3. **Water-puddle slowdown dead (E9)** — either register water pools as slow zones in `PropSystem.hazards` with the fields `_collectWaterPuddles` expects (`type`/`radius`/`damage`), or delete the dead scanner in Game. §26's water slowdown never activates.
4. **EMPOWERED `damageMult` undefined / GODSPEED attack-speed unapplied (C1/C2)** — reconcile `BUFF.EMPOWERED`/`BUFF.GODSPEED` constants with `PlayerSword` fields; drop the phantom `damageMult` or implement `buffDamageMult` in the sword's `damage()`; apply `GODSPEED.attackSpeedMult` to the sword.
5. **Boss-kill speed/attack bonus never applied (B8/D3)** — remove the Game/SkeletonSystem ngPlus-only overrides so the exported `ENEMY.speedMult/attackMult` (with boss-kill bonus) actually take effect, or delete the constants.
6. **BoxGrid staleness after breakables break (D7)** — rebuild/re-cache the collision grid (and `_boxesCacheLevel`) when `props.collidableBoxes()` changes, or exclude breakable boxes from the grid.
7. **HUD `_hudDirty` never honored (C20)** — gate the per-frame DOM work on the flag, or remove the flag.
8. **Clean up dead code** — `GameState` legacy buff/sprint API (B1-B3), `PropSystem.checkHazard` (E8), `WorldBuilder` `biomeId` param (E2), `LightingSystem` `baseIntensity` (E15), `SmokeSystem` `aLife` (F5), `bossBarUpdated` (C7/D11), `biomeForLevel` 2-arg calls (B7), `post.resize` dead call (A1), `REGEN_DELAY` constant (C16).

---

## I. What's genuinely solid (so fixes don't regress it)

- **Determinism & disposal discipline.** Biome texture cache with `biomeCached` markers, per-level `dispose()` on every world/prop/lighting/rune/particle system, pooled projectiles/particles, no per-frame allocation in hot loops. This is the backbone the previous pass praised, and it still holds.
- **Event-driven boss chain** (hit → DEAD → onDeath → boss:killed → rewards → portal) is complete and correct.
- **Collision math** (`Collision.js` `BoxGrid`) is well-reasoned (provably-identical candidate subset, insertion sort, index-order resolution). The *staleness* risk (D7) is in the *caller*, not the grid.
- **Headless shim (§27)** is consistently applied (InputSystem, Textures, PostProcessing, LightingSystem all guard `window`/`document`), so the code imports and runs in Node.
- **Save/load (F3)** round-trips the live fields and self-heals the `maxHealth` invariant.

---

*Reviewed against the checked-in tree at `ds4flash_qwen38_27b_dungeon_crawler/`. Line numbers are from the current source. The three findings most likely to be "the bugs" the user is seeing: #1 boss charge does nothing, #2 enemy-glow pipeline inert, #3 water slowdown dead — plus the D7 ghost-box collision after breaking a barrel. The boss's own position tracking (D12) was checked and is correct.*
