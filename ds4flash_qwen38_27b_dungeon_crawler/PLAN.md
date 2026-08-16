# Dungeon Crawler Visual — Implementation Plan

**Spec**: `/home/neo/Documents/prompt-library/dungeon-crawler-visual-specv1.md` (v1, binding).
**Project root**: `/home/neo/Documents/games-benchmarks/ds4flash_qwen38_27b_dungeon_crawler` (git root is `/home/neo/Documents/games-benchmarks` — commit from there, scoping paths to this directory).
**Stack**: Vite + Three.js (npm ESM), raw Three.js, `three/examples/jsm` for post only. No audio, no asset files, procedural canvas only (§4.1, §30).
**Rule**: after EVERY step, run its verification then `git -C /home/neo/Documents/games-benchmarks add ds4flash_qwen38_27b_dungeon_crawler && git -C /home/neo/Documents/games-benchmarks commit -m "..."`.

Verification shorthand:
- `SHELL` check = `node --check <file>` (run for each new `.js`; `.mjs` scripts also get `node --check`).
- `BOOT` check = `npx vite build` succeeds (or `vite` dev boots without module errors) after the project is sufficiently complete; until then, node import-graph checks.
- Spec sections cited as §n.

---

## Step 1 — Scaffold

**Files to create** (spec §4.1, §4.2, §21 HUD ids, §25 strings):
- `package.json` — deps: `three`; devDependencies: `vite`. Scripts: `dev`, `build`, `check:*` for the suite.
- `vite.config.js` — plain Vite config, root `.`.
- `index.html` — `#app` mount point; static HUD DOM per §21 (ids required by the §24 browser smoke test: `#orb-count` single `SOULS` counter, `#hp-fill` + hp number, `#timer`, `#combo-pips`, `#weapon-slot`, `#stats-panel`, `#biome-label`, `#perf-warning`, `#boss-bar` (hidden), `#buff-badge` (hidden), `#safe-spawn`, `#danger` borders ×4, damage-flash div, messages/toasts container, leaderboard panel (`DEPTH LEDGER`, `[Tab] close`), death screen (Restart [N] / New Game+ [Y] / Save [S]), start menu (New Game [N] / Load last save [L]), loading/title overlay, `#prompt` ("Click to explore"), exit prompt, HUD hint line (§25 exact strings). NO `#souls-line`, NO `#tier-pips` (weapon-check gate).
- `src/main.js` — `import { Game } from './Game.js'; const game = new Game('app'); game.init(); window.game = game;` (§4.2 bootstrap; `window.game` is the QA hook, §27).

**Verify**: `node --check src/main.js` (main.js references Game.js which doesn't exist yet — instead verify scaffold by `node -e "import('three')"` after `npm install` and confirm `index.html` contains all §24-required ids with a grep one-liner; defer `vite build` until Step 7). Also `npx vite build` will fail on the missing Game.js, so for this step the gate is: `npm install` succeeds and `npm run dev` serves (curl the page), or at minimum `node --check` on config + grep for ids.
**Commit**: `scaffold: package.json, vite config, HUD index.html, main.js bootstrap`.

---

## Step 2 — Core (`src/core/`)

**Order within the step is binding**: `Constants.js` first (it is the data contract every later module imports), then the rest.

1. `src/core/Constants.js` — ALL numbers, spec §1, §3, §5, §7, §9, §10, §11, §16, §17, §18, §19, §20, §22, §24. Contents: `WORLD`, `PLAYER` (speed 4, radius 0.35, sprint ×1.55, SPRINT_ACCEL_*), `CAMERA` (FOV 90, near 0.1, far 160, sensitivity 0.002, pitch ±85°), `LIGHTING` (TORCH_SPACING 16, y 2.5, TORCH_SHADOW_COUNT 1, shadow map params), `MATERIALS`, `DUNGEON` (grid 12–16, cell 6, rooms 8–12, wall height 20, 200 attempts, ROOM_TYPES weights/sizes, eligibility, DEAD_END_MAX 4, 200 max), `BIOMES` (11 entries with the §7.1 schema incl. `torchMode`, `brazierRooms`, `label` strings per §25), `BIOME_ROOM_MODIFIERS`, `ROOM_ENEMY_MODIFIERS`, `ENEMY_SPAWN_WEIGHTS` (keyed by biome id, each value = [Skeleton, Magician, Armored, Archer, Rat, Brute, Wraith] summing to 100, §16.4), `ENEMY_TYPES`, `BOSS` (INTERVAL 7, HP_MULT 22.5, MAX_MINIONS 25, CHARGE_DMG 2, BLINK/SMOKE constants, SUMMON_HEARTS_MULT 1.5, variant labels §25), `BIOME_ROOM_MODIFIERS`, `SKELETON`, `ENEMY` (scaling: SPEED_PER_LEVEL 0.02, attack 0.05/floor((level−1)/3), bossKills 0.1, MAX_ALIVE 200, SPAWN_PLAYER_DIST 30, FROZEN_DIST 40, SPAWN_INTERVAL 0.5, elite 1/10, overflow formula), per-type blocks `ARMORED/ARCHER/RAT/BRUTE/WRAITH`/`MAGICIAN` (§16.3 stat tables incl. elites), `ELITE`, `SWORD` (COMBO table windup/swing/recover/damage/arcs, RANGE 2.2, combo window 0.34, cooldown 0.30, **ELECTRIC_CHANCE 0.05 / ELECTRIC_RANGE 20 / ELECTRIC_DAMAGE_MULT 5 at SWORD level — §27 hoist**, ARC_CHANCE/ARC_BOLTS/ARC pool 8/max 6/24 u/s/life 1.2, ARC chance table T3 .10 T4 .35 T5 1.0×2), `HIT_STOP` (0.06/0.12/0.1), `EVOLUTION` (TIER_THRESHOLDS [50,100,200,400,800], TIER_NAMES ×6, TIER_EFFECTS, swordTier(souls), swordSizeScale, swordHitDamage(step,tier), damageMult, attackSpeedFromSouls), `ORB_WEAPON` (STEP_INTERVAL 0.22, SEQUENCE_WINDOW 1.2, speed 12.4, life 2.5, radius 0.3, EXPLODE_RADIUS 2, EXPLODE_DAMAGE 5, y-gate 2.6, FIREBALL_COOLDOWN 0.35, pool 48+6, orbDamageMultiplier, orbPowerMultiplier, excessOrbs, enemyHpMultiplier), `BUFF` (CHANCE 0.06, ORB_DROP 1–5 @ 0.20, MAX_DURATION 90, BOSS_DURATION 300, effect ids 1–5, HUNTER stats 9999/6.5/2.5/7/2/interval/0.35), `MAGICIAN`, `BURN` (HP formula, 2.6/1/1.3/1.4, fire 0.6 s), `DROP` (health 0.15, HEALTH_RESTORE 3, VISUAL_LIFE 1, pickup 1.4 u), `PROPS` (+ POOLS sizes per §13 table), `LIGHT_SOURCES` (mushroom 3.2/12/1.2 etc.), `LIGHT_CEILING` (AVG 154, MAX 199; vaultOnly avg ≤10/max ≤50), `TIMED_RUN` (180 s), `REGEN` (delay 0, +1/5 s), plus `biomeForLevel(level)` (§7, boss branch first). Pure functions, no three.js import (must be importable in plain Node for the check suite — §24, §27 headless shim).
2. `src/core/GameState.js` — schema per §4.5; constructor accepts `maxHealth`; `applyBuff` (replace, never repeat active), `updateBuff(dt)`, `updateSprint(dt)`, `sprintSpeedMult()` (×5 tiers, cap ×3, reset on stop/safe-spawn); `toJSON`/`fromJSON` with self-heal of stale `maxHealth` → `base + bossKills` (§26/§27); serialize: level, runTime, collectedOrbs (single souls counter), weaponTier, maxHealth, ngPlus, bossKills, biome, biomeIndex, health.
3. `src/core/Collision.js` — `circleHitsBox(boxes, x, z, r)`, `resolveCircleCollisions(boxes, pos, r)` (§6), pure, no three import.
4. `src/core/Leaderboard.js` — localStorage top-10, entry `{level, time, orbs, ngPlus, date}`, ranking NG+ desc → level desc → time asc → orbs desc (§23).
5. `src/core/EventBus.js` — `on/off/emit` (§4.4).
6. `src/core/Materials.js` — seeded factories `makeBone/Metal/Cloth/Leather/Hide/Stone/Wood/Basic/Glow/SpriteGlow`, seeded mulberry32 normal/roughness map generation, cached by `style:seed:strength`, **`canvasCapable()` gate → map-less materials in headless Node** (§15, §27 headless shim).

**Verify**:
- `node --check` every file.
- Node import check: `node -e "import('./src/core/Constants.js').then(m => { const c = m.default ?? m; /* assert biomeForLevel(7) boss, weights sums, thresholds */ })"` — assert: `biomeForLevel` cadence (7/14/21 SPECTRAL_COURT, 1–2 STONE … 22 STONE), every `ENEMY_SPAWN_WEIGHTS` column sums to 100 with 7 entries, all 11 biomes present with `torchMode`/`brazierRooms`/`label`, TIER_THRESHOLDS = [50,100,200,400,800], `swordHitDamage` 2/2/3→7/7/8, `enemyHpMultiplier(0,1,0)=1`, GameState round-trip + self-heal.
**Commit**: `core: Constants data contract, GameState, Collision, Leaderboard, EventBus, Materials`.

---

## Step 3 — World (`src/world/`)

**Spec**: §5 (generator), §5.4 (WorldBuilder), §7 (biomes), §13 (instancing), §14 (dispose), §15 (textures), §22 (budgets).

1. `src/world/DungeonGenerator.js` — seeded mulberry32; exact algorithm order §5.2: `_initGrid` → `_placeRooms` (weighted `_pickRoomType` with `BIOME_ROOM_MODIFIERS`, size rules, `_canPlaceRoom` margin 1, 200 attempts) → `_connectRooms` (Prim MST on room centers, loop corridors ≤ gridSize, ≤ min(3, n/3)) → `_carveCorridor` (0.35/0.70/else-Z roll, `_carveH`/`_carveV` flip empty→corridor only) → `_addDeadEnds` (0–4, 1–2 cells, ≤50 attempts) → `_designateEntranceAndExit` (min cx+cz entrance; BFS last-reached room cell exit). Output contract `{grid, metadata, rooms, gridSize, cellSize, entranceCell, exitCell}`.
2. `src/world/WorldBuilder.js` — grid → ONE InstancedMesh floors (y0, rotX −π/2), ONE ceilings (y 20, rotX +π/2), per-exposed-edge wall `BoxGeometry(cell, 20, 0.3)` (cast/receiveShadow), collision AABBs at **thickness ×0.6 (0.18 u)**, one InstancedMesh floor debris (~1/cell, 80% cut), materials from biome texture set (RepeatWrapping ×2), `dispose()`.
3. `src/world/Textures.js` — `generateStoneWallTexture(size, tint)`, `generateFloorTexture`, `generateCeilingTexture`, `generateRuneTexture(char, color)`, `generateGlowTexture()`, `mixHex` (0.35) (§15); sizes 256 surfaces / 64 glow+runes.
4. `src/world/BiomeSystem.js` — `applyLevel(level, state)` via `biomeForLevel`, palette resolution, **lazy per-biome texture cache with `userData.biomeCached` markers** (survives `_disposeScene`, §14), emits `biome:change` on change.
5. `src/world/PropSystem.js` — weighted per-room+biome prop pools, breakables (≤3/room, HP 1, buff roll 6%+0.05%/orb>100, orb drop 1–5 @20%, step-on-break 0.45 u §26), interactives (sarcophagi §26: 0.6 s lid, 30% wraith, 1 orb, one-time, collision AABB), hazards (lava VOLCANIC/EMBER, acid POISON: 1 dmg/0.8 s within 1.2 u, ≥3 u from exit §26), instanced decoratives (stalactites 60, water 24, skull piles, books — one InstancedMesh per type), wisps (CRYPT 1–2, FLOODED 1 aqua, patrol 2 u @y1.2), mushrooms (~6/grove, ~2/other FUNGAL, toxic POISON; green point light `LIGHT_SOURCES.MUSHROOM`), crystal lamps (CRYSTAL 1/room, FROZEN 2/room), `reduceDecorations(0.5)` for degraded mode (never touches hazards/breakables/interactives/structural/biome-light props §22), `dispose()` incl. lights removed from scene (§14).

**Verify**: `node --check` all five. Node harness: import DungeonGenerator with a fixed seed for 40 seeds — assert output contract shape, room count 8–12, entrance ≠ exit, all cells of rooms/corridors non-empty; run a 4-connectivity BFS from the entrance cell over non-empty cells asserting exit reachable (pre-flight for dungeon-check). Textures/Materials must not crash in plain Node (no-op when canvas absent, §27).
**Commit**: `world: DungeonGenerator, WorldBuilder, Textures, BiomeSystem, PropSystem`.

---

## Step 4 — Systems (`src/systems/`)

**Spec**: §2, §12, §13, §14, §22, §25.

1. `src/systems/InputSystem.js` — `keydown/keyup` (by `event.code`), `mousedown/mouseup`, `mousemove` accumulated deltas; `isPressed(code)`, `isMouseDown(button)`, `consumeMouse()`, `isPointerLocked()`; canvas click → requestPointerLock; prevent RMB context menu; windowed listeners (§2, §4.1).
2. `src/systems/LightingSystem.js` — ambient + fog per biome, torches per exposed grid edge (spacing 16 u, y 2.5) or `vaultOnly` → VAULT rooms only (FUNGAL, POISON); **exactly ONE shadow-casting torch assigned statically at build** (256², near 0.5, far 11, bias −0.005, normalBias 0.02) to the torches nearest the entrance; braziers per `brazierRooms` (TEMPLE added for GOLDEN_TEMPLE); crystals; god rays only in VAULTs (additive shaft per vault torch); entrance marker (green ring+light) and exit marker (golden ring+glow+beam+light, §26); BRIGHT buff lighting (ambient ×2.5, fog density ×0.35); `dispose()` removes torch lights AND ambient from scene (§14/§27).
3. `src/systems/SmokeSystem.js` — pooled GPU point-sprite smoke: pool 9, shared geometry, emitters + transient puffs, distance fade (§13); `dispose()`.
4. `src/systems/ParticleSystem.js` — ambient dust motes: pool 30, Points, torch-adjacent opacity (§13); `dispose()`.
5. `src/systems/RuneSystem.js` — procedural wall runes, pulsing opacity (`generateRuneTexture`), few per level within budget; `dispose()`.
6. `src/systems/PostProcessing.js` — EffectComposer: RenderPass → UnrealBloomPass(res, 0.055, 0.5, 0.5) → HueSaturationShader saturation 0.0175 → custom EnemyGlowShader composite (§12.2 binding values); enemy-glow pass: clone camera `layers.set(1)`, half-res target, overrideMaterial flat red-orange, 5-tap separable gaussian (0.227/0.194/0.121) ping-pong, composite `(blur×1.6×uPulse + sharp×0.5)×uIntensity`, `uPulse = 0.75+0.25·sin(t·0.003)`, `uIntensity = min(1, base×0.05)` with distance fade; `setEnemyTargets` (idempotent layer-1 marking, unmark on death); `render()` composer when enabled else direct; `toggle()` via P, **default ON** (§12).

**Verify**: `node --check` all six (three.js imports resolve via node_modules). No browser needed for syntax; visual/pipeline correctness deferred to Step 8 boot + §29 manual QA.
**Commit**: `systems: Input, Lighting, Smoke, Particles, Runes, PostProcessing`.

---

## Step 5 — Entities (`src/entities/`)

**Spec**: §9 (sword), §10 (orb weapon), §11 (buffs/hunter), §16 (enemies), §17 (boss), §18 (BURN), §13 (pools), §15 (rig), §26.

1. `src/entities/PlayerSword.js` — combo state machine (windup/swing/recover/window/cooldown 0.30, table §9.1), cone multi-hit (±68°/±68°/±16°, thrust range ×1.25), `swordHitDamage × damageMult` applied, breakables (looser cone ±(maxDot−0.12)), `breakProjectiles`, per-tier forms 0–5 (6 form builders + `_formMeshes` registry; straight blades, no Torus/TorusKnot; camera child, layer 2, self-lit, no shadow, T5 +1 point light), tier size ladder `scale = min(swordSizeScale(tier)×lengthMult, 5.0)`, range `2.2×scale×(1+0.04·tier)`, attack-speed composition (§9.2), 5% electric chain blast (5× orb dmg, 20 u, hit-stop 0.12, §25 string), arc bolts T3–5 (pool 8, max 6 in flight, 24 u/s, life 1.2 s, re-target, frozen orb damage at fire), evolution feedback (toast §25, flash, 0.1 s hit-stop, form rebuilt from stored tier), trails (1 per pool ×3), sparks (1), smoke (1), T5 crackle (3), fireball-held group swap (hidden while FIREBALL), blade never red (§28).
2. `src/entities/OrbSystem.js` — drop-only economy: instant-credit on drop (`collectedOrbs++`, visual bobs 1 s), health pickups (+3, 15% roll), buff pickups (never-repeat roll), pickup rings (pool 8, TTL 0.45 s), death bursts (pool 3), auto-collect 1.4 u, `onBuffCollected` wiring, `dispose()`.
3. `src/entities/OrbShooter.js` — **48 normal + 6 fireball slot pool, round-robin filtered by slot type** (§27); 3-step sequence (LMB hold 0.22 s, window 1.2 s, only first step costs 1 orb, `No orbs! Slay skeletons to gather orbs` once per dry stretch), bounce up to 3 reflecting dominant axis, step 3 explodes on first contact (AOE `round(5×mult)` within 2 u, y < 2.6 gate), direct hit `round(2×orbDamageMultiplier)`, breakables breakable by orbs, explosion rings pool 8/6, fireball variant (no shot-smear, emissive 2.2, 0.22 s rings), **fireball module singletons `getFireballShared()` built once, never disposed** (§27), FIREBALL RMB hold 0.35 s cooldown, `dispose()`.
4. `src/entities/SkeletonSystem.js` — spawn plan/queue (§16.1: slots formula, SPAWN_CAP ×100 + linear HP overflow, BFS-distance ≥6 candidate cells, 0.5 s reveal, 30 m deferral rotate-to-back, rat packs 2–3, elite 1/10 + ARENA guaranteed first), per-type AI drivers, LOS ray march 0.4 u steps radius 0.25 + greedy 4-neighbor pathing (300 ms re-eval, §6), enemy projectiles (arrow pool 10, orb pool 12), brute shockwave (pool 4, TTL 0.25 s), boss hookup (onKill/onBossKill), BURN spawn on full clear (not boss/arena, farthest walkable cell, §18/§26), boss smoke `_tickBossSmoke` + `onBlinkHit` wiring (§26), BURN handling, `hitSkeleton`, frozen flags (>40 m, title hold, safe-spawn idle), flee under BRIGHT, `dispose()`.
5. `src/entities/Skeleton.js` — base enemy: procedural rig (named bones root/ribcage/head/armL-R/forearm/leg/shin, pose keyframes, DORMANT/WAKING/CHASE/ATTACK/DEAD state machine, transparent materials, Box3 grounding), hit/death (corpse → fade → dispose; orb drop instant-credit, 15% health, purple burst), sub-stepped 0.08 u movement + circle 0.35, attack cycle windup/swing/recover, hit at swing ≥0.35 via `onAttackHit`, i-frames respected, scaling multipliers (§16.1/§20).
6. `src/entities/Hunter.js` — HP 9999, follow 6.5 u/s keeping 2.5 u, LOS-targeted 2-damage beam at nearest visible enemy ≤7 u, interval `1.0 / clamp(orbs/100, 0.25, 5)`, flash 0.35 s, `dispose()`.
7. `src/entities/enemies/ArmoredSkeleton.js`, `ArcherSkeleton.js` (kiter: stop 8 u, retreat <4 u at 2.0, 2-arrow fan elite ±8°), `Brute.js` (slam ±50° cone), `Rat.js` (straight chase, 0 drops), `Wraith.js` (phases through walls — no pathing/LOS/collision-block), `GhostBoss.js` (7 variants §17/§25 labels, drift 2.2, charge 14 u/s ×0.9 s telegraph cd 3.2 first ×0.6 dmg 2 radius 1.4, summon every 6 s `⌊3×1.5^heartsExtra⌋` cap 25, BLINK cd 8 s first ×0.5: teleport-onto-player + 1.0 s spark telegraph + 3 u/3-dmg nova, SMOKE cd 6 s first ×0.7 homing cloud 0.7 s flight / 4 s linger / 2.2 r / 1 heart/s, canvas HP bar sprite, defeat rewards §17), `Burning.js` (BURN: HP 90·(1+3·ngPlus), 2.6/1/1.3/1.4, straight chase sub-stepped, fire patch every 0.6 s pooled visual-only, drops 2).

**Verify**: `node --check` every file. Node harness: import `Constants` + re-implement-free assertions — sword combo table values, arc chance table, pool sizes match §13, boss HP formula examples (49 souls→90, 100→113, 300→158, 5 hearts→118, 100 souls+5 hearts→154, §17/§24), elite roster stats vs §16.3 tables.
**Commit**: `entities: PlayerSword, OrbSystem, OrbShooter, SkeletonSystem, Skeleton, Hunter, enemies/*`.

---

## Step 6 — Orchestrator (`src/Game.js`) + HUD wiring

**Spec**: §3, §4.2, §4.3, §4.4, §8, §11, §19, §21, §22, §23, §24 (smoke ids), §25 (all strings).

`src/Game.js`:
- `init()` exact order §4.2 (renderer → camera [FOV 90, layers 0+2, sword child layer 2, headlight layer 0, fireball group] → post → input → toasts + save bootstrap [drop corrupt local, pull file-backed copy from save-server] → title scene [spectral showcase: portal, hovering orbs, idling Spectral Lord, pillar flames, `_showStartMenu`, `_animateTitleScene`] …).
- `_regenerateDungeon({newRun, nextState, startMessage})` — async phased loader, one rAF yield between phases, exact phase order §4.3 (teardown → capture carried buff → rebuild state [fresh/NG+/carry, maxHealth reset rules] → biomes.applyLevel → build phases → water puddles → player start → messages → `_emitLevelStart` → re-apply buff → restart loop).
- `_teardownLevel()` + `_disposeScene()` per §14 (dispose order; camera/sword/headlight survive; biome-cache textures spared; `scene.clear()`).
- `_animate()` update loop in §4.3 order (dt clamp 0.1; perf monitor + degraded mode §22; title-fps gate (~3 s avg ≥30 fps AND spawn queue drained, 8 s hard max); hit-stop world-dt zeroing; timers (180 s/level, `time` death); exit check (inExitRoom <2 u + portal open, E); combat gating (not title, safeSpawn ≤ 0); invuln 0.8 s; regen +1/5 s; safe-spawn 5 s rooted/invincible; weapon evolution check (only upgrades); HUD).
- Meta: level advance (E) keeps runTime/orbs/ngPlus/bossKills/tier/maxHealth, buff ×5 cap 90 re-applied after rebuild, full health; death (dead/time) → leaderboard submit + death screen (Restart [N] fresh, NG+ [Y] = `floor(level/2)`, keep `floor(souls×0.25)`, `weaponTier(⌊kept⌋)`, +300% HP, button shows `keep X of Y Souls → Tn · mobs +200·ng% HP` §25, Save [S] → localStorage `dungeonCrawlerSave` + POST to save-server, one per death screen); startup title (Load [L] when save exists — resumes saved level fresh, keeps ALL meta, does NOT consume the save, removes stale death entry, no buff carries; New Game [N]).
- Combat glue: sword hits → hit-stop 0.06, toasts; orb/shooter wiring; buff application (§11 effects: BRIGHT flee + lights, FIREBALL swap, EMPOWERED lengthMult+speeds, GODSPEED, HUNTER spawn/despawn); boss defeat (§17 rewards + §25 string); BURN trigger.
- HUD per §21 mapping — single `SOULS` counter (`#orb-count`), weapon slot `TIER_NAMES[weaponTier] + effect`, timer (red <30 s), combo pips, sprint bonus, buff badge, danger borders (Σ(1/d)/2 per sector ≤40 m), boss bar (green→amber→red), stats panel via `_liveStats()` (shared with loading screen: Souls/DMG ×/Orb DMG/Reach/Enemy HP/Mob speed/Spawns/Regen), perf warning (§25 string), damage flash, toasts (§25 goal/hint/evolution/ELECTRIC CHAIN/boss strings, 8 s directional hint with 8-way compass), prompts (`Click to explore`, exit prompt), leaderboard panel (`DEPTH LEDGER`, `[Tab] close`, empty `No runs yet — descend!`), death screen strings, loading screen strings, HUD hint line.
- **Grep gates** (weapon-check §24): no `soulsEarned` in Game.js; no `#souls-line`/`#tier-pips` in index.html; single souls counter writes; `SWORD.ELECTRIC_*` referenced at SWORD level.

**Verify**: `node --check src/Game.js`; `npx vite build` must succeed (first full build gate); then `npm run dev` + headless boot: canvas present, WebGL context, all §24 smoke ids present, zero JS exceptions, loading screen lifts, timer advances (this is the browser smoke from §24; run the CDP smoke or agent_browser check at this step).
**Commit**: `Game.js orchestrator: lifecycle, combat glue, meta-loop, HUD`.

---

## Step 7 — Verification suite + launch + save server

**Spec**: §24 (commands + gates), §22 (light probe table), §23/§26 (save).

1. `scripts/dungeon-check.mjs` — 40 seeds; generator + mirrored WorldBuilder collision (wall 0.3, depth ×0.6, radius 0.35); 0.2 u walkable-sample BFS from entrance; count escapes/unreachableInside/disconnected; any > 0 → BROKEN; print `broken=N/40` (must be `broken=0/40`) + avg rooms + avg BFS exit distance.
2. `scripts/biome-check.mjs` — the 11 gates (§24): 10-biome sequence; palettes 9 keys; spawn columns sum 100 ×7; `BIOME_ROOM_MODIFIERS` entries; eligibility (FLOODED_RUINS exempt from themed-room rule, every room appears); eligible weight ≥100; `PROPS.PROPS_PER_ROOM` per room; light sources exist; TEMPLE = {ARMORED 1.2}; embedded light probe (10 seeds default, arg-configurable): avg ≤154/max ≤199, vaultOnly avg ≤10/max ≤50 → print `biome-check: ALL GATES PASS`.
3. `scripts/weapon-check.mjs` — 12 gates + 5b (§24): EVOLUTION completeness; thresholds 50/100/200/400/800 with boundary souls→tier table; damage ladder + brute/armored breakpoints; arc table (lengths MAX_TIER+1, T5 = 1.0/2, pool ≥6); ELECTRIC constants finite + referenced in Game; 5b formulas (swordSizeScale T0=1/T5=5, attackSpeedFromSouls(1000)=2, orbDamage 100→6/1000→42, electric 5%×5, explosion 5@2u); blade length monotonic 0.76→1.0, TIP_LOCAL = length×0.79, clamp ≥5; HUD single souls counter + 6 tier icons, no `#souls-line`/`#tier-pips`; no `soulsEarned` in Game.js; 6 form builders + `_formMeshes`; no Torus/TorusKnot in PlayerSword; ends with the dungeon-check 0/40 gate → `weapon-check: ALL GATES PASS`.
4. `scripts/boss-check.mjs` — cadence (7/14/21 SPECTRAL_COURT; 6/8 not); BOSS constants (7, 22.5, 25, 2); base HP 4→90; wealth/hearts halved-stack examples (90/113/158/118/154); spawn folding; death at 90 dmg fires onKill; CHARGING gating; BLINK/SMOKE wiring (no blink/smoke without a live player, `onBlinkHit` + `_tickBossSmoke` + BLINK_DMG in SkeletonSystem); BURN type/HP/death/dispose → `ALL CHECKS PASSED`.
5. `scripts/biome-light-probe.mjs` — 25 seeds; builds lighting per biome; reproduces the §22 measured table (per-biome avg/peak point lights; heaviest = VOLCANIC/FROZEN ≤154 avg / 199 max).
6. `scripts/save-server.mjs` — Node http server, port 5174: GET/POST the run save (level, runTime, souls, weaponTier, maxHealth, ngPlus, bossKills, last death entry) to a local file (§3, §23).
7. `launch.sh` — starts `save-server.mjs` (port 5174) then `vite` dev server; clean trap on exit.

**Verify (the §24 suite, all must pass)**:
- `node scripts/dungeon-check.mjs 40` → `broken=0/40`
- `node scripts/biome-check.mjs` → `biome-check: ALL GATES PASS`
- `node scripts/weapon-check.mjs` → `weapon-check: ALL GATES PASS`
- `node scripts/boss-check.mjs` → `ALL CHECKS PASSED`
- `node scripts/biome-light-probe.mjs` → table within §22 ceilings
- `bash launch.sh` → dev server + save server up; headless browser smoke per §24 (canvas + WebGL2, HUD ids, single `SOULS`, `#perf-warning` hidden, timer advances, zero JS exceptions); `curl` the save-server GET/POST round-trip.
**Commit**: `verification suite, launch.sh, save-server`.

---

## Step 8 — Final parity pass (manual §29 + regression)

- Re-run the full §24 suite + `npx vite build`.
- Walk the §29 manual QA checklist in a browser (title gate, biome cadence 1–22, boss level 7 flow incl. BLINK/SMOKE/portal, sword tiers up to T5, orb sequence, buff rules, degraded mode, 3-descend memory stability, NG+ button math, leaderboard, `renderer.info` budgets: draw calls ≤120, instances ≤400, shadow casters = 1, `window.game` present).
- Fix any gap in the module that owns it; re-verify; commit `parity: final QA fixes`.
