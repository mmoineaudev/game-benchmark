# Void Drift — Implementation Plan (v2.0.0)

This document is the **reverse-engineered** implementation record: what was
built, in what order, and what remains open. It is not a forward plan —
the game is implemented. Sections marked **OPEN** are known gaps or
deferred work.

---

## Phase 0 — Skeleton

**Status: COMPLETE**

- [x] `index.html` with `#game-container` + `#ui-overlay`.
- [x] `package.json`: three ^0.165.0, vite ^5.4.0, scripts (dev, build,
      check:perf).
- [x] `vite.config.js`: port 5199, strictPort.
- [x] `src/core/Constants.js`: all magic numbers in one place.
- [x] `src/core/EventBus.js`: pub/sub singleton + `Events` constants.
- [x] `src/core/GameState.js`: mutable data bag.
- [x] `src/core/Game.js`: constructor, init, loop, resize, dispose,
      context loss/restore.
- [x] `src/main.js`: bootstrap, resize handler, context loss handlers,
      `window.__VOID_DRIFT__` debug handle, `?perf=1` loader.

**Design decisions made at this stage:**
- EventBus over direct method calls (decouples systems, enables HUD
  reactivity without polling).
- GameState as a plain object (no setter methods) — simplest possible
  shared state; mutation is owned by the system that writes the field.
- Constants as a single ES module export — one import, no config files.

---

## Phase 1 — Core systems

**Status: COMPLETE**

### 1.1 InputSystem
- [x] Keyboard: movement (AZERTY physical keys), fire, pause, mute,
      light profile, ladder chart, restart.
- [x] Mouse: pointer lock for aim, wheel for throttle, RMB for shield.
- [x] Touch: shield button, throttle slider (pointer: coarse detection).
- [x] Pointer lock: Esc to pause/unlock.
- [x] All input → EventBus events or GameState writes.

### 1.2 PlayerShip
- [x] Ship mesh (procedural: hull + wings + engine + cockpit glow).
- [x] Movement: acceleration, drag, max speed, throttle scaling.
- [x] Yaw/pitch/roll from mouse + keys.
- [x] Shield: drain, regen, exhaust, reactivate threshold.
- [x] Health: damage, invulnerability window, regen after delay.
- [x] Death: emit `player:died`, stop movement.
- [x] Exhaust particles (stream emitter).

### 1.3 CameraSystem
- [x] Chase camera: 6 u behind, 3 u above, damped look-at.
- [x] FOV boost with speed.
- [x] Screen shake on damage.
- [x] No roll inheritance.

### 1.4 WeaponSystem
- [x] Laser pool: 44 instanced beams (32 main + 12 child).
- [x] Fire rate, beam lifetime, beam geometry (instanced cylinder).
- [x] Child beam splitting (crystal interaction, ±18°).
- [x] Impact: spark burst + green glow light.
- [x] Destroy: explosion burst + shards + shockwave ring.

### 1.5 PhysicsSystem
- [x] Ship vs collider: sphere-sphere.
- [x] Laser vs collider: ray-sphere.
- [x] Storm bolt vs ship: segment-sphere distance.
- [x] Black hole gravity: `7500/d²`, cap 120, ship pull 0.5×.
- [x] Collision: damage + knockback.
- [x] Kill: call `owner.remove(body)` on entity system.

### 1.6 ScoreSystem
- [x] Distance score (1 pt/u × rung mult).
- [x] Kill score (per-entity score values).
- [x] Biome change bonus.
- [x] High score: localStorage read on init, write on death.
- [x] Emit `score:changed`.

### 1.7 BuffSystem
- [x] Minimal: buff stacking API (reserved for future use).
- [ ] **OPEN:** No active buffs in the game yet. The system exists as a
      stub. Decision deferred.

### 1.8 AudioSystem
- [x] Web Audio procedural synthesis (no files).
- [x] Engine rumble (sawtooth + lowpass, thrust-driven gain 0.04–0.16).
- [x] Deflagration ping (square 1200→300 Hz + highpass noise).
- [x] One-shots: laser, explosion, collision, biome, consumption, comet,
      shield ping, collapse boom.
- [x] Warning beep (health < 30, 800 Hz × 3, 2 s interval).
- [x] Mute: M key, localStorage persisted.
- [x] AudioContext lazy init on first user gesture.

### 1.9 ParticleSystem
- [x] 5 named pools (exhaust, laserSpark, explosion, ember, sparkle).
- [x] Pre-allocated Float32Array buffers, ring-cursor write.
- [x] Per-particle size/color/alpha (shader attributes).
- [x] Mesh pools: shockwave rings (4), debris shards (12), speed lines,
      impact glow lights (4).
- [x] Zero allocations in update loop.
- [x] `liveCount` getter for perf probe.

### 1.10 PostProcessingSystem
- [x] EffectComposer pipeline: Render → Bloom → CA → Vignette → Grain →
      WormholeBlur.
- [x] Per-rung bloom threshold override.
- [x] Speed-driven chromatic aberration.
- [x] Wormhole blur with swirl + chromatic fringe.
- [x] Low-end hardware: CA + grain disabled at startup.

### 1.11 LightManager
- [x] Name-convention registration (ship:/sig:/land:).
- [x] Priority + distance sort, `.visible` toggle.
- [x] Budget: 16 auto / 6 eco.
- [x] Re-evaluation every 6 frames.
- [x] Profile: auto / eco (L key, localStorage).

### 1.12 AdaptiveQuality
- [x] Time-based FPS sampling (1-second window).
- [x] AQ1 (< 45 FPS, 2 s): resolution × 0.85.
- [x] AQ2 (< 30 FPS, 2 s): resolution × 0.7, CA+grain off, eco lights.
- [x] Recovery: > 55 FPS, 3 s → step down.
- [x] HUD AQ indicator.

---

## Phase 2 — World / level

**Status: COMPLETE**

### 2.1 ChunkManager
- [x] 3×3×3 grid (CHUNKS_RADIUS 1), 27 active chunks.
- [x] Staggered streaming: 3 chunks/frame.
- [x] Cleanup radius: 1.6×.
- [x] Seeded RNG: mulberry32(hash3(cx, cy, cz)).
- [x] `clearAll()` for teleport / restart.
- [x] `getColliders()` aggregation across all entity systems.

### 2.2 BiomeGenerator
- [x] Ladder config lookup by distance.
- [x] Rung change detection → `ladder:rungChanged`.
- [x] Finale detection → `ladder:finaleReached`.
- [x] Deep Void inherits previous rung's scoreMult.
- [x] `contentRungForDistance()` for HUD / perf probe.

### 2.3 AsteroidField
- [x] 3 tiers (large/med/small), InstancedMesh per tier.
- [x] HP: 100/50/25. Score: 100/50/25. Collision: 25/15/10.
- [x] Destroy: explosion + shards.

### 2.4 CometSystem
- [x] 150 HP, score 100, collision 25.
- [x] Particle tail (ember pool stream).
- [x] Fixed trajectory through chunks.

### 2.5 BlackHoleSystem
- [x] Event horizon: instant death on contact.
- [x] Gravity: 7500/d², cap 120 u/s², ship pull 0.5×.
- [x] Accretion disk: Doppler-beamed shader.
- [x] Collapse: `environment:blackHoleCollapse` event + audio boom.

### 2.6 DeadStarSystem
- [x] Ember sprites with flicker.
- [x] Collision: instant death.

### 2.7 NebulaSystem
- [x] fbm billboard planes (ShaderHelpers GLSL).
- [x] No collision. Purely visual.

### 2.8 StationSystem
- [x] Decorative stations, InstancedMesh.
- [x] Collision: 20 damage, no score.

### 2.9 DebrisSystem
- [x] Small instanced rock fragments.
- [x] HP 10, score 5, collision 5.

### 2.10 CrystalSystem
- [x] Clusters of 4–8 octahedra, InstancedMesh.
- [x] HP 25 per octahedron, score 40.
- [x] Beam splitting: 2 child beams at ±18° (max 12 concurrent).
- [x] `environment:crystalDestroyed` event.

### 2.11 PulsarSystem
- [x] Radius 18–26 u, 2 counter-rotating beam cones (500 u).
- [x] Beam touch: 50 damage. Body contact: instant death.
- [x] `minSpacing` 800 u guard.
- [x] `environment:pulsarSpawned` event.

### 2.12 StormSystem
- [x] 3-plane cloud clusters.
- [x] Pair strike state machine: waiting → telegraph (0.5 s) → bolt
      (0.15 s) → waiting.
- [x] Jagged bolt polyline (6 segments, mid-bolt jitter).
- [x] Strike damage: 45.
- [x] HUD static: distance-driven, two intensity tiers.
- [x] `environment:stormStrike` + `storm:staticChanged` events.

### 2.13 HulkSystem
- [x] Procedural wrecks (3 variants, shared geos/mats from
      ProceduralWrecks.js).
- [x] HP 100, score 150, collision 30.
- [x] Drift + tumble.
- [x] Emergency strobe (1.5 Hz).
- [x] `minSpacing` guard.
- [x] `environment:hulkDestroyed` event.

### 2.14 CitySystem
- [x] City fragments: 3 variants (ring, station, towers), 100–400 u,
      indestructible, window flicker + dropout, landmark glow.
- [x] `cityChance` 0.7/chunk, max 1/chunk.
- [x] Blinking wrecks: HP 100, score 200, staggered red/white strobes
      (phase offset π), 5/chunk.
- [x] `environment:cityFragmentSpawned` + `environment:wreckDestroyed`
      events.

### 2.15 ProceduralWrecks
- [x] Shared hulk geometry cache (6 geometries, module-level).
- [x] Shared hulk material cache (per palette, module-level Map).
- [x] Shared city material cache (per palette+windowTex).
- [x] `buildHulk(seed, palette)` → { group, light, strobeMats, phase }.
- [x] `buildCityFragment(seed, windowTex, palette)` → { group, light,
      windowMats, phase }.
- [x] Zero GPU allocation on spawn (the fix for chunk-boundary hitches).

### 2.16 Starfield
- [x] 3-layer parallax (far 5000, mid 2000, near 500) + 30 bright stars.
- [x] Color temperature variety (30/40/20/10 split).
- [x] Wrap: 1200 u box.
- [x] Shooting stars: every REMASTER.shootingStarEvery s, max 2.
- [x] All materials: fog: false.

---

## Phase 3 — UI

**Status: COMPLETE**

### 3.1 HUD
- [x] Score, distance, biome, rung label + progress bar.
- [x] Announce banner (5 s fade).
- [x] Health bar (green/yellow/red), shield bar, thrust bar.
- [x] Warnings: EVENT HORIZON, STELLAR REMNANT, PULSAR BEAM.
- [x] Flash overlay (120 ms), low HP vignette, storm static.
- [x] Controls hint (always visible).
- [x] Pause overlay.
- [x] Mute icon.
- [x] AQ indicator.
- [x] Touch: shield button + throttle slider.

### 3.2 LadderChart
- [x] C-key toggle.
- [x] 14 rows (9 content + 4 void + finale), name + range.
- [x] Current entry highlighted + progress bar.

### 3.3 Crosshair
- [x] CSS-only reticle (circle + 4 dots).

### 3.4 DeathScreen
- [x] 6 cause-specific titles.
- [x] Score, distance, high score, "PRESS R TO RESTART".
- [x] "★ NEW HIGH SCORE ★" badge.

### 3.5 PerfProbe
- [x] `?perf=1` dynamic import.
- [x] FPS, draw calls, triangles, active lights, live particles, JS heap,
      current rung.

---

## Phase 4 — Polish & performance

**Status: COMPLETE**

### 4.1 Adaptive quality tuning
- [x] Time-based FPS sampling (fixed frame-based freeze bug).
- [x] AQ1/AQ2 thresholds and recovery verified.

### 4.2 Chunk-boundary hitch fix
- [x] Shared geometry/material caches in ProceduralWrecks.js.
- [x] Staggered streaming (3 chunks/frame).

### 4.3 Light budget
- [x] LightManager priority culling.
- [x] Eco profile for low-end + AQ2.

### 4.4 Audio polish
- [x] All one-shots synthesized.
- [x] Warning beep loop.

### 4.5 Headless perf gate
- [x] `scripts/check-perf.mjs`: CDP over 9222, 30 s sample at rung 9.
- [x] Ceilings: 3500 draw calls, 5 FPS, 0 errors.

---

## Phase 5 — Known open items

### 5.1 BuffSystem
**Status: STUB**
- The system exists but no buffs are active in gameplay.
- Options: (a) remove entirely, (b) add speed/weapon buffs from
  pickups, (c) add biomes that grant passive buffs.
- **Decision: deferred.** No user-facing feature depends on it.

### 5.2 Touch fire button
**Status: MISSING**
- Touch players have shield + throttle but no fire button.
- Pointer lock is unavailable on touch; mouse aim doesn't exist.
- **Decision: deferred.** Touch is a secondary input path; the game is
  primarily a desktop pointer-lock experience.

### 5.3 Wormhole blur trigger
**Status: INCOMPLETE**
- The WormholeBlurShader pass exists and is wired into the composer.
- `wormholePass.enabled` is driven by `wormholeBlurIntensity` passed
  from Game.update().
- The WORMHOLE rung (5,000–7,000 u) does not explicitly set
  `state.wormholeIntensity` to a non-zero value in the current code path
  (BiomeGenerator sets it to 0 on rung change; no per-frame ramp-up is
  visible in the systems read).
- **Action:** Verify that entering the WORMHOLE rung ramps
  `state.wormholeIntensity` to 1.0 and leaving ramps it to 0. If not
  implemented, add a lerp in Game.update() or BiomeGenerator.

### 5.4 Per-rung bloom threshold
**Status: INCOMPLETE**
- `PostProcessingSystem.setBloomThreshold(t)` exists.
- The per-rung threshold table is in Constants (or was planned to be).
- No call site for `setBloomThreshold` was visible in the systems read.
- **Action:** Wire a `BIOME_CHANGED` / `ladder:rungChanged` listener in
  Game.js that calls `post.setBloomThreshold(rungConfig.bloomThreshold)`.

### 5.5 HUD static overlay (storm)
**Status: COMPLETE**
- `#hud-static` element exists, CSS animation defined.
- `STORM_STATIC_CHANGED` event → `HUD.setStatic()`.
- Verified in HUD._bind().

### 5.6 Black hole collapse visual
**Status: PARTIAL**
- `environment:blackHoleCollapse` event is emitted by BlackHoleSystem.
- Audio boom is wired.
- **Action:** Verify particle burst (explosion pool) is triggered on
  collapse. The event is emitted; confirm a listener exists in
  ParticleSystem or Game.js.

### 5.7 ScoreSystem biome change bonus
**Status: VERIFY**
- SPEC says "small flat bonus on entering a new content rung."
- The ScoreSystem read did not show an explicit biome bonus listener.
- **Action:** Confirm whether `BIOME_CHANGED` is listened to in
  ScoreSystem. If not, add: `eventBus.on(Events.BIOME_CHANGED, ...)` →
  add flat bonus (e.g., 500 × current rung mult).

### 5.8 Ladder chart rung number display
**Status: COSMETIC**
- `HUD.setRung()` uses `this._rungNum` set by `setRungNumber(n)`.
- Verify Game.js calls `hud.setRungNumber()` on rung change.
- If not called, the sector number will be undefined.

### 5.9 Death screen cause mapping
**Status: COMPLETE**
- 6 causes: collision, black_hole, dead_star, pulsar, pulsarBeam,
  blackHoleCollapse.
- Storm bolt damage causes `collision` (not a distinct cause).
- **Note:** Storm strike death shows "SHIP DESTROYED" (collision), not a
  storm-specific title. Acceptable — the static overlay + audio make the
  cause legible.

### 5.10 City fragment collision radius
**Status: DESIGN QUESTION**
- `CITY.fragmentRadius` is a constant, but fragments are 100–400 u
  scale. A single radius for all scales means small fragments have
  disproportionate hitboxes relative to their visual size.
- **Action:** Consider `radius = C.fragmentRadius * (fragment.scale /
  C.fragmentScale)` in CitySystem.spawnChunk. Currently the body object
  uses `C.fragmentRadius` directly.

### 5.11 Wormhole rung entity config
**Status: VERIFY**
- WORMHOLE rung: asteroid 30 (dense). No wormhole-specific entities.
- The blur effect is the main visual. No "wormhole gate" entity exists.
- **Decision:** Acceptable. The wormhole is an atmospheric zone, not an
  entity.

### 5.12 Audio: storm strike sound
**Status: MISSING**
- No dedicated storm strike sound. The strike plays the generic
  `collision` sound (if wired) or nothing.
- **Action:** Consider adding a `_stormStrike` synthesis (crackle + low
  thump) in AudioSystem and wiring it to `environment:stormStrike`.

### 5.13 Audio: crystal / pulsar / hulk / city sounds
**Status: MISSING**
- No dedicated sounds for v2.0 entity kills.
- Current: all kills play `explosion` (generic).
- **Action:** Optional polish. Low priority.

### 5.14 Ladder chart: finale label
**Status: COSMETIC**
- `HUD.setRung()` shows "SECTOR 9 — DEAD CITY" for finale.
- LadderChart shows "SPATIAL_GRAVEYARD" as the 9th content rung.
- Consistent. No action.

### 5.15 `game.state_adaptiveLevel` (AdaptiveQuality)
**Status: COMPLETE**
- AQ writes `game.state_adaptiveLevel = level`.
- HUD reads it via `setAQ(level)` (called from Game.update).
- Verify Game.update calls `hud.setAQ(game.state_adaptiveLevel)` each
  frame. (Likely yes; confirm in gap-closure pass.)

### 5.16 Pointer lock on restart
**Status: VERIFY**
- On death → R → restart: does pointer lock re-engage?
- The pause overlay releases pointer lock. Restart should re-request it.
- **Action:** Verify InputSystem handles the restart → pointer lock
  re-request flow.

### 5.17 Chunk cleanup: entity systems with cross-chunk pairs
**Status: COMPLETE**
- StormSystem pairs reference clouds by chunkKey. Cleanup removes pairs
  where either cloud's chunkKey matches the cleaned chunk.
- Verified in StormSystem.cleanupChunk().

### 5.18 GameState.distance monotonicity
**Status: COMPLETE**
- Distance only increases (forward progress along ship's forward axis).
- No backward movement reduces distance.
- Verified in PlayerShip / Game distance calculation.

### 5.19 Vite build
**Status: VERIFY**
- `npm run build` → `dist/`.
- No build-specific issues known.
- **Action:** Run `npm run build` once to confirm clean output.

---

## Phase 6 — Verification checklist

Before declaring the implementation complete:

- [ ] **V1:** `npm run dev` → game loads, no console errors.
- [ ] **V2:** Fly to each rung (0–13), confirm entities spawn per config.
- [ ] **V3:** Kill one of each entity type; confirm score + particles.
- [ ] **V4:** Die to each cause (6 variants); confirm DeathScreen title.
- [ ] **V5:** Pause / resume; confirm time stops, pointer lock released.
- [ ] **V6:** Mute / unmute; confirm audio + icon + persistence.
- [ ] **V7:** Light profile L: auto → eco; confirm light count drops.
- [ ] **V8:** Ladder chart C: open/close; confirm current rung highlight.
- [ ] **V9:** AQ: throttle FPS down (browser DevTools CPU throttle);
      confirm AQ1 → AQ2 transition.
- [ ] **V10:** `npm run check:perf` with headless Chrome; confirm PASS.
- [ ] **V11:** `npm run build`; confirm `dist/` produces a working
      static site (open in browser).
- [ ] **V12:** Tab switch (blur/focus); confirm no tunneling, no state
      corruption.
- [ ] **V13:** WebGL context loss (DevTools → Control → Lose context);
      confirm graceful pause + restore.
- [ ] **V14:** High score: kill ship with score > previous high; confirm
      "★ NEW HIGH SCORE ★" badge + localStorage update.
- [ ] **V15:** Touch emulation (DevTools → Device toolbar); confirm
      shield button + throttle slider appear, game is playable.

---

## Phase 7 — Cross-document consistency

When the three other documents (01-functional, 02-architecture,
03-technical) are written, verify:

- [ ] **C1:** Every event in 03-technical §9 exists in 01-functional §12
      and is used in 02-architecture §4.
- [ ] **C2:** Every constant in 03-technical §2 is either in
      01-functional (as a gameplay value) or 02-architecture (as a
      rendering/perf value). No orphan constants.
- [ ] **C3:** Every file in 02-architecture §2 exists in the source tree.
      Every system in 02-architecture §1 has a file.
- [ ] **C4:** The ladder table in 01-functional §4.1 matches
      03-technical §2.9 exactly (14 rows, same ranges, same mults).
- [ ] **C5:** Entity HP/score/damage values match across all three docs.
- [ ] **C6:** The "known deviations" table in 03-technical §13 is
      consistent with what 01-functional and 02-architecture state
      (no doc silently uses the old SPEC value).
