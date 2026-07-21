# 05 — Final Implementation Spec (Kimi K3 Init)

> **Purpose:** Single-file, self-contained specification to re-implement **Void Drift** — a procedural Three.js space-exploration browser game — from scratch, at production quality. Authored by **kimi-k3** as a consolidation of the step-3.7-flash reverse-engineering package (`01_architecture.md`, `02_functional_use_cases.md`, `03_style_and_design.md`, `04_implementation_plan.md`), with corrections, exact source constants, and deliberate design upgrades baked in.
>
> **Audience:** A future coding agent (or human) implementing the game in one pass. Everything needed is in this file; the four source documents remain authoritative for fine detail. **This file wins on any conflict** (especially controls, movement, and the §13 defect resolutions).
>
> **Reference source:** `/home/neo/Documents/games-benchmarks/space-exploration-step3.7/` (Three.js 0.185.1, Vite 5.4).

---

## 0. Executive Summary

Void Drift is a single-player, endless, procedurally generated 3D space-exploration game for the browser. The player pilots a stylized red "muscle-car" spaceship through an infinite chunked universe of biome zones (open space, asteroid belt, nebula corridor, wormhole tunnel), shooting asteroids, collecting crystals, surviving collisions, and accumulating score from distance + destruction + pickups. Pure procedural generation — no textures, no models, no music; all geometry, shaders, and audio are synthesized at runtime.

**Tech stack (fixed):**

| Tool | Version | Role |
|---|---|---|
| Three.js | 0.185.x | WebGL rendering, scene graph, shaders, post-processing |
| Vite | 5.4.x | ESM dev server + build |
| Web Audio API | native | Fully procedural SFX + engine drone |
| GLSL | — | Custom shaders: nebula, starfield, engine flames, post-FX |
| No physics engine | — | Hand-rolled sphere-vs-sphere collisions |
| No test framework | — | Manual browser QA + build/syntax validation |

**`package.json` baseline:** `"three": "^0.185.1"`, `"vite": "^5.4.0"`, `"type": "module"`, scripts `{ "dev": "vite", "build": "vite build", "preview": "vite preview" }`. Import post-processing from `three/addons/postprocessing/*` and `three/addons/shaders/*`.

**Hard constraints:**
- Local-only. No networking, no backend, no multiplayer.
- Persistence limited to `localStorage` (high score + mute flag).
- Must run acceptably on low-end hardware (conditional post-FX).
- All gameplay keyboard bindings must use `event.code` (physical key position) so the scheme is layout-independent (AZERTY/QWERTY safe). **Never bind gameplay keys by `event.key`.**

---

## 1. Target Directory Layout

```
<project-root>/
  index.html                  # canonical entry (game + embedded pause/launch overlay)
  vite.config.js              # minimal; root entry only
  package.json
  src/
    main.js                   # bootstrap
    core/
      Game.js                 # god-object: owns loop, system lifecycle
      Constants.js            # single source of truth for all tunables
      EventBus.js             # singleton pub/sub
      GameState.js            # singleton mutable state
    systems/
      InputSystem.js          # event.code bindings, pointer lock, wheel
      CameraSystem.js         # follow cam, FOV lerp, shake, wheel zoom
      PhysicsSystem.js        # thrust model + sphere collisions
      AudioSystem.js          # lazy-init Web Audio synth
      ParticleSystem.js       # exhaust pool + explosion pool
      PostProcessingSystem.js # composer: bloom, chromatic aberration, vignette, grain
    gameplay/
      PlayerShip.js           # ship mesh assembly, rotation, engine flames
      WeaponSystem.js         # laser projectiles, fire rate, recoil
      ScoreSystem.js          # scoring, distance score, game-over overlay
    level/
      Starfield.js            # parallax star points + speed streaks
      ShootingStarManager.js
      ChunkManager.js         # cubic chunk spawn/despawn orchestration
      BiomeGenerator.js       # distance→biome zone mapping + params
      NebulaSystem.js         # GLSL billboard nebula clusters
      AsteroidField.js        # large meshes + medium/small instanced
      DebrisSystem.js         # instanced micro-debris
      CollectibleSystem.js    # crystals (+ visible ruins)
      PlanetManager.js        # sparse large shader planets w/ atmospheres
      NPCShipManager.js       # wandering geometric NPC ships + trails
    ui/
      HUD.js                  # score/distance/health/warning/game-over overlays
      Crosshair.js            # center reticule
    utils/
      MathHelpers.js          # mulberry32 seeded PRNG, vector helpers
      ShaderHelpers.js        # shared GLSL chunks
```

**One canonical HTML entry.** The step-3.7 package had four divergent HTML variants (`index.html`, `game.html`, `public/index.html`, `public/game.html`) — a defect (EC-12). The new implementation has exactly one `index.html` at root containing the container div, HUD skeleton, pause/launch overlay, and game-over overlay, with `<script type="module" src="/src/main.js">`. Mismatched entry paths are a known silent-failure mode in this project family.

**BuffSystem is deleted** (was dead code — EC-08). Do not create the file.

---

## 2. Core Architecture

### 2.1 Object model

- **`Game`** (god object, accepted deliberately): constructs all systems in `_initSystems()`, wires events in `_setupEvents()`, runs `_animate()`, tears down in `shutdown()`/`_restart()`. Accept the god-object; do not over-abstract for a game of this size.
- **`EventBus`**: dependency-free singleton `on/off/emit`.
- **`GameState`**: singleton holding:
  - `player { position, velocity, rotation, health, score, distance, isAlive }`
  - `combat { lastFireTime, projectiles: Map<uuid, projectile>, explosions[] }`
  - `game { time, isGameOver, isPaused, highScore }`
  - Mutator methods: `takeDamage(n)`, `addScore(n)`, `addDistance(d)`, `restart()`, high-score load/save via `localStorage["space_exploration_highscore"]` (string-parsed int).
- **`Constants`**: every tunable lives here. No magic numbers elsewhere (the step-3.7 `shipPosition.y < 10` chunk-spawn bias and similar literals must be named constants, e.g. `CHUNK.LOW_ALTITUDE_SPAWN_BIAS_Y`).

### 2.2 Frame loop (`Game._animate`)

Capped at 60 Hz via accumulator; per-frame delta clamped to 0.1 s (tab-out safety, EC-06 — keep deliberately). Order:

1. Advance `GameState.game.time`.
2. `InputSystem.update(dt)`.
3. Emit `game:tick`.
4. `PhysicsSystem.updatePlayerPhysics()` — thrust model (§4.1).
5. `PlayerShip.updateRotation()` — mouse-driven yaw/pitch (§3.3) + idle self-level.
6. `PlayerShip.updateEngineFlames()` + glow.
7. `CameraSystem.update()` — follow, FOV lerp, shake, zoom.
8. Fire input → `WeaponSystem.fire()`.
9. `WeaponSystem.update()` — projectile motion/lifetime.
10. `Starfield.update()` — parallax + streaks.
11. `ChunkManager.update()` — biome spawn/despawn of all sublevels.
12. `ShootingStarManager.update()`.
13. `ParticleSystem.spawnExhaust()` when thrusting; `ParticleSystem.update()`.
14. Broad phase: `chunkManager.getCollidables(shipPos)`.
15. Ship collisions → damage, HUD flash, shake (§5.2).
16. Projectile collisions → explosion particles, screen flash, score (§5.3).
17. Post-processing updates (bloom/chromatic/grain from speed & events).
18. HUD update + distance scoring.
19. Game-over check → if dead: show overlay, stop loop.
20. `PostProcessingSystem.render()` via composer.

### 2.3 Module dependencies

Mirror the step-3.7 dependency map (see `01_architecture.md §5`) — it is acyclic and sound. Key rules:
- `core/` depends on nothing but vendor.
- `systems/` depend only on `core/` + THREE.
- `gameplay/` and `level/` depend on `core/` + `utils/` + THREE.
- Only `Game.js` knows everything.

### 2.4 Event listener hygiene (mandatory)

Every `addEventListener` registered by a system has a matching removal in that system's `destroy()`; restart must be idempotent (no stacking listeners — the classic source of double-fire and double-spawn bugs on restart). Pointer-lock change listeners, wheel listeners, and keyboard listeners all included.

---

## 3. Input & Controls (REDESIGNED — supersedes step-3.7)

The step-3.7 build had a broken/conflicting input story: README promised WASD + mouse steer, code bound arrows + Shift, and `Space` was simultaneously "fire" (docs) and "brake" (code). This spec fixes the scheme definitively.

### 3.1 Binding rules (mandatory)

1. **All keyboard bindings use `event.code`** (physical position), never `event.key`. The same physical diamond works on AZERTY and QWERTY. Document controls to the user by physical position ("left-hand diamond: top/bottom/left/right"), optionally noting both layouts.
2. No key is bound to two unrelated actions.
3. `Constants.INPUT` is the single source of truth; the pause screen and HUD legend are generated from it, not hand-written (eliminates EC-02 doc drift).

### 3.2 Final control scheme

| Action | `event.code` | Notes |
|---|---|---|
| Thrust forward | `KeyZ` (= `KeyW` physical position) | AZERTY Z / QWERTY W — top of left diamond |
| Brake / reverse | `KeyS` | bottom of left diamond |
| Strafe left | `KeyQ` (= `KeyA` physical) | AZERTY Q / QWERTY A |
| Strafe right | `KeyD` | right of left diamond |
| Vertical down | `KeyA` (= `KeyQ` physical) | AZERTY A / QWERTY Q |
| Vertical up | `KeyE` | |
| Pitch / yaw | **Mouse** (pointer lock) | see §3.3 |
| Fire | `Space` **and** left mouse button | both live simultaneously |
| Restart (after death) | `KeyR` | gated on `!isAlive` |
| Mute toggle | `KeyM` | |
| Camera zoom | **Mouse wheel** | direct binding in InputSystem → `camera:zoom` event |
| Arrow keys | optional alias for yaw/pitch | accessibility fallback; keep |

Never reuse keys across axes (the finalized AZERTY scheme above assigns each of the six movement degrees of freedom to a distinct physical key).

### 3.3 Mouse flight model (mandatory implementation details)

- **Pointer lock** on canvas click during play; `Esc` releases (browser built-in). Re-lock on next click. Show a subtle "click to capture mouse" hint when unlocked mid-run.
- **Unbounded yaw/pitch accumulator**: accumulate raw `movementX/movementY` into persistent angular targets. Per-frame deltas passed through `tanh(delta * k)` soft-bounding for smoothness. **Never clamp input rates to [-1, 1] before steering** — that destroys fast-flick aiming.
- Pitch clamped to ±~81° (as in step-3.7) to avoid gimbal weirdness at the poles; yaw unbounded.
- **Idle self-level**: after 3 s with no mouse input, gently ease **pitch and roll toward level only — never touch yaw**. (Yaw self-leveling fights the player's chosen heading.)
- No keyboard roll. Roll is purely cosmetic banking (§4.2).

### 3.4 Wheel zoom

- Wheel delta → `zoomFactor` in `[ZOOM_MIN=1, ZOOM_MAX=3]` stepping by `ZOOM_STEP=0.25`, exponential smoothing. Emits `camera:zoom`; CameraSystem multiplies `FOLLOW_DISTANCE`.

---

## 4. Movement Model

### 4.1 Physics (`PhysicsSystem.updatePlayerPhysics`)

Ship velocity on `ship.userData.velocity`. Source constants: `MAX_SPEED=50`, `ACCELERATION=38`, `DECELERATION=25`, `ROTATION_SPEED=2.2`.

- Forward thrust: `KeyZ` raises `targetForwardSpeed` by `ACCELERATION * dt`; `KeyS` lowers it by `DECELERATION * dt`.
- **Reverse thrust allowed** (upgrade over step-3.7 where brake clamped at 0): clamp to `[-MAX_SPEED * 0.3, MAX_SPEED]` = [-15, 50]. Enables retro-drift dodging in corridors (addresses the "no retro" frustration flagged in `03_style_and_design.md §9`).
- Strafe/vertical: lateral and vertical thrust along ship-local `right`/`up` axes, at `STRAFE_SPEED_RATIO = 0.6 × MAX_SPEED` (30 u/s), damped toward zero when released.
- Velocity composition: `velocity = forward * fwdSpeed + right * strafeSpeed + up * vertSpeed`. This retains the arcadey "velocity follows orientation" feel of the original while adding lateral freedom. (Full Newtonian drift is explicitly **rejected** for this title — keep the accessible arcade model.)
- Position: `pos += velocity * dt`.
- Distance score: Manhattan delta `|Δx|+|Δy|+|Δz|` → `GameState.addDistance`.
- `Constants.SHIP.DRAG = 0.97` was dead in step-3.7 (EC-10): **apply it to lateral/vertical components only** (per-second exponential decay `Math.pow(0.97, dt * 60)`), giving drift feel on strafe axes while forward speed stays explicit. Do not leave dead constants.

### 4.2 Ship rotation & banking (`PlayerShip`)

- Yaw around world-up; pitch around ship-local X, driven by the mouse accumulator (§3.3).
- **Cosmetic roll banking**: roll the ship mesh proportional to yaw rate and strafe input (visual only, does not affect heading). This restores the "banking into turns" feel the original lacked.
- Rotation speed multiplier scales with speed ratio in `[0.6, 1.0]`.

### 4.3 Camera (`CameraSystem`)

Source constants: `FOLLOW_DISTANCE=12`, `FOLLOW_HEIGHT=6`, `DAMPING_SPEED=2.5`, `FOV_LERP_SPEED=3`, `MIN_FOV=60`, `MAX_FOV=110`, `ZOOM_MIN=1`, `ZOOM_MAX=3`, `ZOOM_STEP=0.25`, `LOOK_OFFSET_Y=-2.5`, `LOOK_OFFSET_Z=-14`.

- **3/4 above-behind chase view**: camera offset above + behind so the **ship sits in the lower half of the screen** (ship center ≈ 60–65% down the frame), giving forward visibility for aiming at the crosshair. Start from the source numbers above and tune to hit that framing.
- Position damping: `1 - Math.pow(0.01, DAMPING_SPEED * dt)` per frame (keep; EC-05 is cosmetic — add a comment explaining the formula).
- FOV lerp with speed ratio: `MIN_FOV=60 → MAX_FOV=110`. Note: the source also has a stale `SCENE.MIN_FOV=75/MAX_FOV=95` pair — delete it; `CAMERA.*` is canonical.
- Shake: per-axis `random * shakeAmount`, decay `Math.pow(0.001, dt)`. Triggered by collisions (0.5–0.8 asteroid, 0.2 debris) and muzzle/hits.
- Wheel zoom: effective distance = `FOLLOW_DISTANCE * zoomFactor`.

---

## 5. Combat Model

### 5.1 WeaponSystem

Source constants: `FIRE_RATE=8` Hz, `PROJECTILE_SPEED=120`, `PROJECTILE_RANGE=200`, `PROJECTILE_LIFETIME=3` s, `LASER_COLOR=0x00ffaa`, `LASER_LENGTH=2`, `LASER_RADIUS=0.04`, `IMPACT_FLASH_DURATION=0.1` s.

- Lasers: `CylinderGeometry(LASER_RADIUS, LASER_RADIUS, LASER_LENGTH)`, emissive material, teal `#00ffaa`.
- Spawn: `ship.forward * 2.2 + up * 0.3`, aligned to ship orientation.
- Small recoil impulse on ship velocity per shot.
- **Fix EC-03 (mandatory):** projectile lifecycle must not use shared mutable indices. Give each projectile a UUID (`crypto.randomUUID()`); `GameState.combat.projectiles` is a `Map<uuid, projectile>`; `WeaponSystem.update` removes by id during backward iteration. The step-3.7 splice-then-remove-by-stale-index bug must not be reproduced.
- **Fix EC-13 (mandatory):** per-frame hit dedupe keyed by `${projectileUuid}:${targetId}`, not `"${i}-${j}"` array indices. Clear the dedupe set each frame.

### 5.2 Ship collisions

- Broad phase: `chunkManager.getCollidables(shipPos)` → destructibles + NPCs near ship.
- Narrow: sphere-vs-sphere, ship radius 1.2.
- On hit: `takeDamage(HEALTH.COLLISION_DAMAGE=10)`, HUD damage flash `#ff4444`, camera shake, red emissive hit-flash on ship (emissiveIntensity 0.8, decaying).

### 5.3 Projectile collisions (REDESIGNED)

- **Instanced targets are now hittable** (Phase 0.3 / 1.3 of the plan, promoted to core spec). Implementation:
  1. `AsteroidField`/`DebrisSystem` maintain per-instance records `{ id, position, radius, alive, chunkId, instanceIndex }` alongside each `InstancedMesh`.
  2. `getCollidables()` flattens nearby per-instance records (both individual meshes and instanced entries) into one broadphase list.
  3. Narrow phase: sphere-vs-sphere per instance (proj radius 0.3).
  4. Instanced kill: set `alive=false`, collapse that instance's matrix to zero-scale (cheapest) or swap-with-tail + decrement `mesh.count`, spawn explosion at instance position, award score.
- Large asteroids remain individual meshes with `userData.isDestroyed` + mesh removal; `AsteroidField.removeDestroyed` and the PhysicsSystem bounding cache must be updated in the same frame (fix the stale-bounding gap, `01_architecture.md §10`).
- NPC ships are hittable, award score, despawn with explosion.

### 5.4 Damage & death

- `HEALTH.MAX=100`, `COLLISION_DAMAGE=10`, `WARNING_THRESHOLD=30`.
- Warning state ≤ 30: red health bar + pulsing full-screen warning overlay + triple warning beeps w/ 1.5 s cooldown.
- Death at ≤ 0: game-over overlay (score, distance, high score, pulsing "press R"), loop stops.
- Restart (`KeyR`, gated on death): full system teardown + rebuild, `GameState.restart()`.

---

## 6. Scoring Model

| Source | Points | Condition |
|---|---|---|
| Large asteroid | 30 | size > 2 |
| Medium asteroid | 20 | size > 0.8 |
| Small asteroid | 10 | size ≤ 0.8 |
| Debris | 1 | now actually hittable (§5.3) |
| Distance | 0.1 × units traveled (`DISTANCE_PER_UNIT`) | floored accumulation per tick |
| Crystal | 50 | proximity pickup ≤ 3.5 units |
| Ruin | 20 | proximity pickup (now visible, §7.5) |
| NPC ship | 15 | destruction (new; tunable via `SCORE.NPC_SHIP`) |

- High score persisted to `localStorage["space_exploration_highscore"]` on death when beaten.
- **Pickup feedback (mandatory, was a noted gap):** floating "+50" text (CSS-abs-positioned div animated over ~1 s, or Three.js sprite billboard) + small sparkle burst + short chime on collection.

---

## 7. Level Generation

### 7.1 Biome zones (`Constants.BIOME.ZONES` + `BiomeGenerator`)

Source zone table (exact):

```js
ZONES: [
  { start: 0,    end: 1000, name: 'Open Space' },
  { start: 1000, end: 3000, name: 'Asteroid Belt' },
  { start: 3000, end: 5000, name: 'Nebula Corridor' },
  { start: 5000, end: 7000, name: 'Wormhole Tunnel' },
]
```

| Zone | Nebula clusters | Asteroid density | Debris | Wormhole |
|---|---|---|---|---|
| Open Space | 1 | 0.35 | 8 | — |
| Asteroid Belt | 1 | 0.8 | 8 | — |
| Nebula Corridor | 3 | 0.2 | 10 | — |
| Wormhole Tunnel | 2 | 0.05 | 4 | yes |
| Wrap ≥7000 | zones cycle (modulus alias), intensity scales | | | |

Intensity multiplier: `1 + distance/5000`, clamped ≈ 2.5–3.0, applied to densities.

### 7.2 Chunk system (`ChunkManager`)

Source constants: `WIDTH=HEIGHT=LENGTH=240`, `SPAWN_AHEAD=1`, `CLEANUP_BEHIND=1`.

- Cubic chunks, 240 units per side.
- Spawn 1 chunk ahead on X/Z; Y-spawn biased when below `CHUNK.LOW_ALTITUDE_SPAWN_BIAS_Y=10` (newly named constant) to keep low-altitude starts clean.
- Cleanup 1 chunk behind on all axes; full dispose of geometries/materials on cleanup. Nebula shared geometry gets explicit refcounted ownership (fix Phase 0.4 lifecycle ambiguity: the creator owns it; `destroy()` is full teardown only).
- Per-chunk budget: biome-tuned nebula clusters, 1–12 asteroids × density, 10–100 debris × density, 1–3 crystals, 1–2 ruins, optional wormhole tunnel.
- **Origin safety radius**: no hostile spawns within 25 units of ship while `|shipPos| < 10` (clean initial spawn). Name these `CHUNK.ORIGIN_SAFETY_RADIUS=25` and `CHUNK.ORIGIN_SAFETY_SHIP_RADIUS=10`.
- All spawn randomness via seeded `mulberry32` from `MathHelpers`, seed derived from chunk coordinates → deterministic world per run seed.

### 7.3 AsteroidField

- Large (2–5): individual vertex-displaced icosahedron meshes, bounding sphere = size, hittable.
- Medium (0.5–1.5): instanced `DodecahedronGeometry`, per-instance hittable (§5.3).
- Small (0.2–0.6): instanced `OctahedronGeometry`, per-instance hittable.
- All rotate/drift at render time; large update bounding spheres.

### 7.4 DebrisSystem

Instanced micro-icosahedrons (0.1–0.3). Now destructible for 1 pt each (§5.3) — no longer purely cosmetic.

### 7.5 CollectibleSystem

- Crystals: green emissive octahedrons, 50 pts, pickup radius 3.5, spin + bob animation.
- Ruins: tan tetrahedrons, 20 pts. **Fix EC-07:** spawn with `visible=true` (the original spawned them invisible — an obvious bug).
- Collection: hide + score + feedback (§6).

### 7.6 NebulaSystem

- Billboard quad clusters, GLSL noise fragment shader, additive blending, re-oriented to camera each frame.
- Per-biome color palettes (`params.nebulaColors`) and density.
- Cluster scale ≈ 15 units per cluster count unit.

### 7.7 PlanetManager

- 4800-unit grid, hash < 0.38 spawn chance, prune beyond 18750 units.
- Radius 60–320; atmosphere shell at 1.12× radius when radius > 12.
- Shader: layered sine bands + fresnel rim.

### 7.8 NPCShipManager

- Max 28, 2400-unit grid, ~40% coverage, prune at 11250.
- Four geometric archetypes (cone, box, dodecahedron, cylinder).
- Wander AI: lerped random direction wishes, gentle yaw/pitch spin.
- Trail: 256-point pool strip, lifetime decay 0.9/s.
- Hittable (§5.3), 15 pts.

### 7.9 ShootingStarManager

Every 3.5 s, 35% spawn chance; 12–32 points, speed 40–90, life 1.2–2.6 s, opacity 35–85%.

---

## 8. Audio (`AudioSystem`, Web Audio API)

Source constants: `ENGINE_FREQ_MIN=55`, `ENGINE_FREQ_MAX=180`, `LASER_FREQ_START=800`, `LASER_FREQ_END=200`, `EXPLOSION_DECAY=0.5`, `COLLISION_DECAY=0.3`, `WARNING_FREQ=800`, `WARNING_BEIPS=3`, `WARNING_INTERVAL=0.3`.

- Lazy `AudioContext` init on first user gesture (click/keydown) — required by autoplay policy (EC-01). After init, show a brief "SOUND ON" toast (Phase 0.6 promoted in).
- `masterGain = 0.3` → destination.
- **Engine drone**: continuous sawtooth 55–180 Hz, bandpass filtered, gain 0.11–0.27 tracking thrust + speed.
- **Laser**: sawtooth sweep 800→200 Hz, exponential decay.
- **Explosion**: ~0.5 s white-noise buffer, lowpass at `800 * size`, exponential gain decay.
- **Collision**: short low-gain lowpassed noise thud (decay 0.3).
- **Warning**: 3 × 800 Hz sine chirps (0.2 s each, 0.3 s apart), 1.5 s cooldown.
- **Pickup chime** (new): short two-note sine blip (e.g. 880→1320 Hz, 0.12 s).
- **Biome ambience (new, Phase 2.6 promoted in):** low filtered drone layer per biome, crossfaded on zone transition — entering the asteroid belt should be audible.
- Mute (`KeyM`): instant master+engine gain cut, `audio:mute` event. Mute state persisted to `localStorage["void_drift_muted"]` and restored on boot. No music by design.

---

## 9. Particles & VFX

### 9.1 ParticleSystem

Source pool sizes: `EXHAUST_POOL=120`, `EXPLOSION_MIN=20`, `EXPLOSION_MAX=40`, `SPARK_COUNT=8`, `DEBRIS_FRAGMENT_COUNT=4`.

- Exhaust pool: reusable `Points`, per-particle `_position/_velocity/_life/_maxLife`, life 0.3–0.7 s, velocity damping 0.95/step, spawn rate ∝ speed. Emit at both nacelles.
- Explosion pool: `Points` per event, reverse-iterated, removed when all particles dead.
- Use `PointsMaterial` (the original's unused shader variants may be dropped — no dead code).

### 9.2 Post-processing (`PostProcessingSystem`)

Source constants: `BLOOM_STRENGTH=1.0`, `BLOOM_RADIUS=0.4`, `BLOOM_THRESHOLD=0.35`, `VIGNETTE_DARKNESS=0.6`, `VIGNETTE_OFFSET=0.22`, `FILM_GRAIN_INTENSITY=0.025`.

Composer order:
1. `RenderPass`
2. `UnrealBloomPass` — strength lerped 0.7 → 1.35 with speed ratio
3. Chromatic aberration — offset ≤ `speedRatio * 0.012`; **skipped on low-end**
4. Vignette (darkness 0.6, offset 0.22)
5. Film grain (intensity 0.025, time from `GameState.game.time`); **skipped on low-end**
6. `OutputPass` (tone mapping)

Low-end detection: `navigator.hardwareConcurrency <= 4` as baseline gate; optionally strengthen via `WEBGL_debug_renderer_info` renderer string heuristics (keep as a small utility, don't over-engineer).

### 9.3 Starfield

Source counts: `STAR_FAR_COUNT=1800`, `STAR_MID_COUNT=700`, `STAR_NEAR_COUNT=150`, `STAR_BRIGHT_COUNT=40`. Three parallax layers + bright streak layer; streak length scales with speed ratio.

### 9.4 Fog & background

`SCENE.BACKGROUND_COLOR = 0x111827`, `FogExp2(0x111827, 0.0018)` — merges distance into background.

---

## 10. Visual Design Language

(Consolidated from `03_style_and_design.md`; implement faithfully.)

- **Palette:** near-black `#111827` space; cyan HUD `#aaccff`/`#7adfff`; danger `#ff4444`; laser teal `#00ffaa`; engine blue `#44aaff`; ship body red metallic.
- **Typography:** monospace everywhere (`'Courier New', monospace`).
- **HUD:** glass panels `rgba(4,14,28,0.55)` + `backdrop-filter: blur(4px)`, `border-radius: 10px`, neon text-shadow glow, `pointer-events: none`.
- **HUD layout:** score top-left, distance top-right, health bar bottom-center labeled `HULL INTEGRITY`, center crosshair, high-score readout.
- **Health colors:** >60% green gradient (`#22cc66`→`#55ffaa`); 30–60% yellow (`#cccc22`→`#eeee44`); ≤30% red (`#cc2222`→`#ee4444`) + pulsing `#warning-overlay`.
- **Damage feedback:** transient full-screen red flash 80–150 ms; kill flash orange (asteroid) / gray (debris).
- **Ship ("1960s muscle car in space"):** box fuselage + hemisphere nose, dark hood/trunk trim, `transmission: 0.7` cyan glass canopy, red wings, dark cylindrical nacelles on wingtips, emissive torus reactor rings, fins, red emissive tail lights, additive reactor-glow sprites, SpotLight headlight aimed ~18 u ahead (dim), subtle blue accent point light near cockpit, per-nacelle shader engine-flame cones reacting to thrust/speed/yaw. Source ship constants for reference: `MESH_COLOR=0x7799bb`, `MESH_EMISSIVE=0x112233`, `ACCENT_COLOR=0x4466ff`, `ENGINE_COLOR=0x44aaff`, `ENGINE_GLOW_COLOR=0xaaddff`, `WINGTIP_RED=0xff3300`, `WINGTIP_GREEN=0x00ff66`. **Keep emission restrained** — headlight, accent, and wingtip light intensities low enough that the ship reads as sleek, not as a Christmas tree (tune down from the original values).
- **Biome moods:** Open Space = cool minimal blues; Asteroid Belt = warm amber industrial haze; Nebula Corridor = saturated purple/cyan painterly clouds; Wormhole = psychedelic purple/teal tunnel bands.
- **Launch/pause screen:** minimal typographic `VOID DRIFT` headline, CSS twinkling radial-gradient starfield, single action button, dynamically generated controls legend (§3.1.3).
- **Game over:** centered glass overlay, score / distance / high score, pulsing restart hint.

---

## 11. State & Persistence

| Store | Scope | Medium |
|---|---|---|
| `GameState` (all runtime state) | per run | JS heap |
| High score | persistent | `localStorage["space_exploration_highscore"]` |
| Mute flag | persistent | `localStorage["void_drift_muted"]` |
| Scene objects | per run | GPU/JS refs, disposed via `destroy()` paths |

Version any future localStorage schema (`void_drift_save_v1`) for forward migration.

---

## 12. Constants Reference (canonical, from source)

Full `Constants.js` shape for the new implementation — source values preserved, new values marked **[new]**, corrections marked **[fix]**:

```js
export const SCENE = {
  BACKGROUND_COLOR: 0x111827,
  FOG_COLOR: 0x111827,
  FOG_DENSITY: 0.0018,
  // [fix] stale MIN_FOV/MAX_FOV pair deleted; CAMERA.* is canonical
};

export const CAMERA = {
  START_FOV: 75,
  FOLLOW_DISTANCE: 12,
  FOLLOW_HEIGHT: 6,
  DAMPING_SPEED: 2.5,
  FOV_LERP_SPEED: 3,
  MIN_FOV: 60,
  MAX_FOV: 110,
  ZOOM_MIN: 1,
  ZOOM_MAX: 3,
  ZOOM_STEP: 0.25,
  LOOK_OFFSET_Y: -2.5,
  LOOK_OFFSET_Z: -14,
};

export const SHIP = {
  MAX_SPEED: 50,
  ACCELERATION: 38,
  DECELERATION: 25,
  REVERSE_SPEED_RATIO: 0.3,        // [new] §4.1
  STRAFE_SPEED_RATIO: 0.6,         // [new] §4.1
  ROTATION_SPEED: 2.2,
  ROLL_SPEED: 2.2,
  DRAG: 0.97,                      // [fix] now applied to lateral/vertical axes
  COLLISION_RADIUS: 1.2,           // [new] was inline
  MESH_COLOR: 0x7799bb,
  MESH_EMISSIVE: 0x112233,
  ACCENT_COLOR: 0x4466ff,
  ENGINE_COLOR: 0x44aaff,
  ENGINE_GLOW_COLOR: 0xaaddff,
  WINGTIP_RED: 0xff3300,
  WINGTIP_GREEN: 0x00ff66,
};

export const INPUT = {             // [fix] full redesigned scheme, §3.2
  FORWARD: 'KeyZ',
  BACKWARD: 'KeyS',
  STRAFE_LEFT: 'KeyQ',
  STRAFE_RIGHT: 'KeyD',
  DOWN: 'KeyA',
  UP: 'KeyE',
  FIRE: 'Space',                   // + left mouse button, both live
  RESTART: 'KeyR',
  MUTE: 'KeyM',
};

export const WEAPON = {
  FIRE_RATE: 8,
  PROJECTILE_SPEED: 120,
  PROJECTILE_RANGE: 200,
  PROJECTILE_LIFETIME: 3,
  PROJECTILE_RADIUS: 0.3,          // [new] was inline
  LASER_COLOR: 0x00ffaa,
  LASER_LENGTH: 2,
  LASER_RADIUS: 0.04,
  IMPACT_FLASH_DURATION: 0.1,
};

export const PARTICLE = {
  STAR_FAR_COUNT: 1800,
  STAR_MID_COUNT: 700,
  STAR_NEAR_COUNT: 150,
  STAR_BRIGHT_COUNT: 40,
  EXHAUST_POOL: 120,
  EXPLOSION_MIN: 20,
  EXPLOSION_MAX: 40,
  SPARK_COUNT: 8,
  DEBRIS_FRAGMENT_COUNT: 4,
};

export const POST_PROCESSING = {
  BLOOM_STRENGTH: 1.0,
  BLOOM_RADIUS: 0.4,
  BLOOM_THRESHOLD: 0.35,
  VIGNETTE_DARKNESS: 0.6,
  VIGNETTE_OFFSET: 0.22,
  FILM_GRAIN_INTENSITY: 0.025,
  CHROMATIC_MAX_OFFSET: 0.012,     // [new] was inline
};

export const BIOME = {
  ZONES: [
    { start: 0,    end: 1000, name: 'Open Space' },
    { start: 1000, end: 3000, name: 'Asteroid Belt' },
    { start: 3000, end: 5000, name: 'Nebula Corridor' },
    { start: 5000, end: 7000, name: 'Wormhole Tunnel' },
  ],
  INTENSITY_DISTANCE_SCALE: 5000,  // [new] was inline
  INTENSITY_MAX: 2.75,             // [new] clamp ~2.5–3.0
};

export const CHUNK = {
  WIDTH: 240,
  HEIGHT: 240,
  LENGTH: 240,
  SPAWN_AHEAD: 1,
  CLEANUP_BEHIND: 1,
  LOW_ALTITUDE_SPAWN_BIAS_Y: 10,   // [new] was magic number
  ORIGIN_SAFETY_RADIUS: 25,        // [new] was inline
  ORIGIN_SAFETY_SHIP_RADIUS: 10,   // [new] was inline
};

export const SCORE = {
  ASTEROID_LARGE: 30,
  ASTEROID_MEDIUM: 20,
  ASTEROID_SMALL: 10,
  DEBRIS: 1,
  CRYSTAL: 50,                     // [new] was inline
  RUIN: 20,                        // [new] was inline
  NPC_SHIP: 15,                    // [new]
  DISTANCE_PER_UNIT: 0.1,
};

export const HEALTH = {
  MAX: 100,
  COLLISION_DAMAGE: 10,
  WARNING_THRESHOLD: 30,
};

export const AUDIO = {
  MASTER_GAIN: 0.3,                // [new] was inline
  ENGINE_FREQ_MIN: 55,
  ENGINE_FREQ_MAX: 180,
  LASER_FREQ_START: 800,
  LASER_FREQ_END: 200,
  EXPLOSION_DECAY: 0.5,
  COLLISION_DECAY: 0.3,
  WARNING_FREQ: 800,
  WARNING_BEIPS: 3,
  WARNING_INTERVAL: 0.3,
  WARNING_COOLDOWN: 1.5,           // [new] was inline
};
```

---

## 13. Known Defects in step-3.7 — Resolution Checklist

Every one of these MUST be resolved (not reproduced) in the new implementation:

| ID | Defect | Resolution |
|---|---|---|
| EC-02 | Input docs contradict code | Controls legend generated from `Constants.INPUT` (§3.1.3) |
| EC-03 | Projectile removal by stale index | UUID-keyed projectiles (§5.1) |
| EC-04 | Projectiles skip instanced targets | Per-instance hit proxies (§5.3) |
| EC-07 | Ruins spawn invisible | `visible=true` (§7.5) |
| EC-08 | BuffSystem unused / duplicated ownership | **BuffSystem deleted** from v1 — no dead code |
| EC-10 | Dead `SHIP.DRAG` constant | Applied to lateral/vertical damping (§4.1) |
| EC-11 | Mouse steer / wheel zoom promised but absent | Fully implemented (§3.3, §3.4) |
| EC-12 | Four divergent HTML files | Single canonical `index.html` (§1) |
| EC-13 | Index-based hit dedupe keys | UUID keys (§5.1) |
| — | Stale `SCENE.MIN/MAX_FOV` pair | Deleted; `CAMERA.*` canonical (§12) |
| — | No pickup feedback | Floating text + chime (§6) |
| — | No reverse thrust | `[-0.3·MAX, MAX]` clamp (§4.1) |
| — | No strafe/vertical movement | Q/D/A/E axes (§3.2, §4.1) |
| — | Silent biome transitions | Ambient drone crossfade (§8) |
| — | Chunk-spawn magic numbers | Named constants (§12) |
| — | Nebula shared-geo lifecycle ambiguous | Refcounted owner (§7.2) |

(EC-01, EC-05, EC-06, EC-09, EC-14, EC-15 are either already-fine behaviors to keep, or cosmetic.)

---

## 14. Deferred Enhancements (do NOT implement in v1)

Documented so they aren't accidentally half-built. From `04_implementation_plan.md`:

- **Phase 2:** settings menu + volume persistence, save system beyond high score/mute, gamepad support + rumble, accessibility layers (HUD scaling, high contrast, aria-live, colorblind palette), worker offload of chunk generation.
- **God-Tier (icebox):** session query logging over EventBus, optimistic feature-flag store, write-monitor with speech synthesis, visual mirror-parity CI, settings storm-shield debounce. Speculative; revisit only after v1 ships.

Open questions inherited from the plan (networking destiny, texture budget, IndexedDB saves, mod manifest, low-end gate calibration) remain open and out of scope for v1.

---

## 15. Acceptance Criteria

v1 is done when **all** hold:

1. `vite build` succeeds; `vite dev` serves the game with zero console errors.
2. Boot → pause screen with generated controls legend → Space/click starts run → death → R restarts cleanly (no duplicated listeners, no leaked geometries after 3 restarts).
3. All §3.2 controls work on both AZERTY and QWERTY layouts (verified by `event.code` bindings).
4. Pointer-lock mouse flight with unbounded accumulator + tanh smoothing; 3 s idle self-levels pitch/roll, never yaw.
5. Wheel zoom between ZOOM_MIN and ZOOM_MAX.
6. Forward + reverse + strafe + vertical thrust all function; reverse capped at 0.3 × MAX_SPEED.
7. Projectiles destroy large asteroids (mesh), medium/small asteroids (instances), debris (instances), and NPC ships; correct per-tier score; explosion particles + screen flash + shake each time.
8. Crystals (50) and **visible** ruins (20) collectible with floating-text feedback and chime.
9. All four biome zones transition by distance with distinct palettes/densities; ambient drone crossfades; wormhole tunnel spawns in its zone.
10. Chunk streaming shows no pop-in ahead and no memory growth behind (spot-check `renderer.info.memory` stable over 2 min of flight).
11. Health/damage/warning/death/high-score flow complete; high score survives reload.
12. Post-FX pipeline matches §9.2; chromatic aberration + grain disabled on the low-end gate.
13. Mute toggles all audio; mute state persists across reload.
14. No dead code: every constant referenced, every system wired, no unused shader variants, no BuffSystem file.

---

## 16. Implementation Notes for the Coding Agent

- **Order of work:** bootstrap + Constants/EventBus/GameState → InputSystem (with pointer lock) → ship + camera + starfield (flyable empty space) → physics + collisions → chunks + asteroids → weapons → collectibles → remaining level systems → HUD → audio → post-FX → polish against §15.
- **Validate incrementally:** after each system, `vite build` + syntax check + dev-server smoke test. Do not write all files then debug everything at once.
- **Event listener hygiene:** §2.4 — restart must be idempotent.
- **Root `index.html` must match the Vite entry** (`<script type="module" src="/src/main.js">`).
- **Ship framing:** camera tuned so the ship sits in the lower screen half (§4.3); verify visually, not just by numbers.
- Commit frequently; treat each acceptance criterion as a checkpoint.
- The four source documents in this directory contain additional fine detail (per-module dependency lists, emotional/aesthetic rationale); consult them when this file is ambiguous, but **this file wins on any conflict** (especially controls, movement, and the §13 defect resolutions).
