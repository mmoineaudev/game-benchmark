# Void Drift — Architecture Specification (v2.0.0)

---

## 1. High-level design

Single-page browser game. Three.js r165 for rendering, Vite 5 for dev server
and bundling. No build step beyond Vite. No framework — vanilla ES modules.

The game is a **system graph**: one `Game` class owns and drives all
subsystems in a fixed update order. Subsystems communicate exclusively via
the `EventBus` singleton. There is no global mutable state object beyond
`GameState` (a plain data bag) and the `EventBus` itself.

```
main.js
  └─ Game (core/Game.js)
       ├─ InputSystem        (systems/)
       ├─ PlayerShip         (gameplay/)
       ├─ WeaponSystem       (gameplay/)
       ├─ ScoreSystem        (gameplay/)
       ├─ BuffSystem         (gameplay/)
       ├─ PhysicsSystem      (systems/)
       ├─ CameraSystem       (systems/)
       ├─ ChunkManager       (level/)
       │    └─ BiomeGenerator (level/)
       │         ├─ AsteroidField
       │         ├─ CometSystem
       │         ├─ BlackHoleSystem
       │         ├─ DeadStarSystem
       │         ├─ NebulaSystem
       │         ├─ StationSystem
       │         ├─ DebrisSystem
       │         ├─ CrystalSystem
       │         ├─ PulsarSystem
       │         ├─ StormSystem
       │         ├─ HulkSystem
       │         └─ CitySystem
       ├─ ParticleSystem     (systems/)
       ├─ Starfield          (level/)
       ├─ PostProcessingSystem (systems/)
       ├─ LightManager       (systems/)
       ├─ AdaptiveQuality    (systems/)
       ├─ AudioSystem        (systems/)
       ├─ HUD                (ui/)
       ├─ LadderChart        (ui/)
       ├─ Crosshair          (ui/)
       └─ DeathScreen        (ui/)
```

---

## 2. File structure

```
index.html                  — HTML shell, #game-container, #ui-overlay
package.json                — three ^0.165.0, vite ^5.4.0
vite.config.js              — dev server, port 5199, strictPort
scripts/check-perf.mjs      — headless perf gate (CDP over 9222)
docs/SPEC.md                — v2.0 design spec
init.md                     — implementation brief

src/
  main.js                   — bootstrap, resize, context loss, ?perf=1
  core/
    Constants.js            — ALL magic numbers (source of numeric truth)
    Game.js                 — owner of all systems, frame loop
    GameState.js            — mutable data bag (score, hp, distance, …)
    EventBus.js             — pub/sub singleton + Events constants

  systems/
    InputSystem.js          — keyboard, mouse, pointer lock, touch
    PhysicsSystem.js        — collisions, gravity, laser hits
    CameraSystem.js         — chase camera, FOV, shake
    ParticleSystem.js       — 5 particle pools + 4 mesh VFX pools
    AudioSystem.js          — Web Audio procedural synthesis
    PostProcessingSystem.js — EffectComposer pipeline
    LightManager.js         — priority-culled dynamic light budget
    AdaptiveQuality.js      — FPS-driven resolution/FX scaling

  gameplay/
    PlayerShip.js           — ship mesh, movement, shield, health, death
    WeaponSystem.js         — laser pool, beam geometry, child beams
    ScoreSystem.js          — score accumulation, high score persistence
    BuffSystem.js           — buff stacking (reserved, minimal)

  level/
    ChunkManager.js         — chunk grid lifecycle, staggered streaming
    BiomeGenerator.js       — ladder config lookup, rung change events
    AsteroidField.js        — instanced 3-tier asteroids
    CometSystem.js          — comet bodies + particle tails
    BlackHoleSystem.js      — event horizon, accretion disk, gravity
    DeadStarSystem.js       — ember sprites, instant-death collision
    NebulaSystem.js         — fbm billboard planes
    StationSystem.js        — decorative stations
    DebrisSystem.js         — small instanced rock fragments
    CrystalSystem.js        — octahedron clusters + child beam splitting
    PulsarSystem.js         — counter-rotating beam cones
    StormSystem.js          — cloud pairs, telegraph/bolt state machine
    HulkSystem.js           — procedural wrecked ships (drift+tumble)
    CitySystem.js           — city fragments + blinking wrecks (finale)
    ProceduralWrecks.js     — shared hulk/city fragment builders
    Starfield.js            — 3-layer parallax stars + shooting stars

  ui/
    HUD.js                  — DOM overlay: all readouts, bars, warnings
    LadderChart.js          — C-key expedition chart panel
    Crosshair.js            — CSS reticle
    DeathScreen.js          — death overlay

  utils/
    MathHelpers.js          — mulberry32, hash3, clamp, lerp, damp, scratch
    ShaderHelpers.js        — GLSL snippets, softDotTexture, smokeTexture
    PerfProbe.js            — ?perf=1 dev overlay (FPS, calls, tris, …)
```

---

## 3. Core loop (Game.js)

```
init():
  create renderer (WebGL2, antialias, HiDPI cap DPR_MAX)
  create scene, camera (perspective, 75° FOV)
  instantiate all subsystems
  bind EventBus subscriptions
  requestAnimationFrame(loop)

loop(timestamp):
  dt = clamp((timestamp - lastTs) / 1000, 0, 0.1)   // cap 100 ms
  if (paused) { render; return; }

  // 1. Input
  input.update(dt)

  // 2. Ship (movement, shield, health, death check)
  ship.update(dt)

  // 3. World (chunk streaming, entity updates)
  chunkManager.update(ship.position, state.distance)

  // 4. Weapons
  weapon.update(dt, ship)

  // 5. Physics (collisions, gravity, laser hits)
  physics.update(dt, ship, weapon, chunkManager)

  // 6. Camera
  camera.update(dt, ship)

  // 7. Particles
  particles.update(dt)

  // 8. Post-processing
  post.update(dt, speedFraction, wormholeIntensity)

  // 9. Lights
  lightManager.update(camera.position)

  // 10. Adaptive quality
  adaptiveQuality.update(dt)

  // 11. HUD (polled values, not events, for cheap readouts)
  hud.update(state, ship, chunkManager)

  // 12. Render
  post.composer.render()   // or renderer.render if post disabled
```

### 3.1 Frame budget

- `dt` capped at 0.1 s (prevents tunneling on tab-switch).
- All per-frame allocations in hot loops must be zero (scratch vectors,
  pre-allocated buffers).
- Target: 60 FPS. Floor: 30 FPS (AQ2 engages below).

---

## 4. EventBus

Singleton `eventBus` with:
- `on(event, handler) → unsubscribe`
- `emit(event, payload?)`
- `off(event, handler)`

`Events` is a frozen object of string constants (e.g. `Events.PLAYER_DIED`).
No namespacing beyond the `category:action` naming convention used in the
constants.

**Rule:** Systems never hold direct references to each other's internals.
They communicate via EventBus events + reading `GameState` for shared
numeric state. The only exceptions are:
- `Game` owns all systems (constructor injection).
- `PhysicsSystem` receives collider arrays from entity systems each frame
  (pull model, not push).
- `ChunkManager` calls `spawnChunk`/`cleanupChunk` on entity systems
  directly (lifecycle is owned by ChunkManager).

---

## 5. Chunk lifecycle

```
ChunkManager.update(shipPos, distance):
  1. Compute active chunk set (3×3×3 or 5×5×5 grid around ship)
  2. For each new chunk: allocate, seed RNG (hash3), call BiomeGenerator
     .getRungConfig(distance) → cfg, call each entity system's
     spawnChunk(chunk, rng, cfg, shipPos)
  3. For each chunk leaving cleanup radius: call each system's
     cleanupChunk(chunk), remove from scene
  4. Staggered streaming: max CHUNKS_SPAWN_PER_FRAME (3) chunks spawned
     per frame; remaining queued for next frame
```

Chunk keys: `cx,cy,cz` (integers). Chunk data object:
```
{
  key: "x,y,z",
  cx, cy, cz,
  rng: mulberry32(hash3(cx, cy, cz)),
  // per-system data (set by spawnChunk):
  asteroids: [...],
  comets: [...],
  blackHoles: [...],
  deadStars: [...],
  nebulae: [...],
  stations: [...],
  debris: [...],
  crystals: [...],
  pulsars: [...],
  storm: { clouds: [...], pairs: [...] },
  hulks: [...],
  cityFragment: {...} | null,
  cityWrecks: [...],
}
```

---

## 6. Entity system contract

Every entity system in `level/` implements:

```js
spawnChunk(chunk, rng, cfg, shipPos)   // populate chunk, add to scene
update(dt, shipPos)                    // animate, state machines
cleanupChunk(chunk)                   // remove from scene, dispose GPU
dispose()                             // full teardown
getColliders()                        // → array of { x, y, z, radius, hp,
                                       //   score, type, active, owner }
remove(body)                          // called by PhysicsSystem on kill
```

`cfg` is the current ladder rung config object from `BiomeGenerator`
(density values, scoreMult, etc.).

`getColliders()` is polled by `PhysicsSystem` every frame. Entities mark
`active = false` when destroyed; PhysicsSystem skips them.

---

## 7. Rendering strategy

| Element | Technique | Draw calls |
|---------|-----------|------------|
| Asteroids (all tiers) | InstancedMesh × 3 | 3 |
| Comets | InstancedMesh + particle tail | 1 + shared pool |
| Black holes | Mesh (disk) + Mesh (horizon) | 2 per hole |
| Dead stars | InstancedMesh (sprite-like) | 1 |
| Nebulae | Mesh × N (fbm shader) | N |
| Stations | InstancedMesh | 1 |
| Debris | InstancedMesh | 1 |
| Crystals | InstancedMesh (octahedra) | 1 |
| Pulsars | Mesh (core) + Mesh (beam cone × 2) | 3 per pulsar |
| Storm clouds | Mesh × 3 per cloud + LineSegments (bolts) | 3N + 1 |
| Hulks | Group of 5–6 Mesh per hulk (shared geos/mats) | ~5 per hulk |
| City fragments | Group of 2–8 Mesh per fragment | ~5 per fragment |
| Wrecks | Same as hulks + white beacon | ~6 per wreck |
| Starfield | Points × 3 + Points (bright) + Sprites (shooting) | 4–5 |
| Particles | Points × 5 pools + mesh pools | 5 + ~20 |
| Post-processing | EffectComposer passes | +6–8 full-screen |

**Shared resources:** `ProceduralWrecks.js` caches all hulk geometries
and materials at module level. Spawning a chunk creates ZERO new GPU
resources (the previous per-spawn material creation was a chunk-boundary
hitch).

**Instance culling:** InstancedMesh objects beyond `INSTANCE_CULL_RADIUS`
(460 u) from camera are culled (visible = false).

---

## 8. Lighting architecture

### 8.1 Static lights

- `DirectionalLight` (intensity 0.3, from top-right).
- `HemisphereLight` (sky 0x4466aa, ground 0x112244, intensity 0.4).

### 8.2 Dynamic lights (managed by LightManager)

Registered by name convention:
- `ship:head` — ship headlight (always on, not budgeted).
- `ship:impact` × 4 — laser impact glow (always on, very short range).
- `sig:pulsarSweep` — pulsar beam light.
- `sig:stormFlicker` — storm cloud flicker.
- `sig:crystalCluster` — crystal cluster glow.
- `sig:wreckStrobe` — hulk/wreck emergency strobe.
- `sig:cityWindow` — city fragment window light.
- `sig:hulkEmergency` — hulk emergency light.
- `land:deadStar` — dead star ember glow.
- `land:nebula` — nebula ambient glow.
- `land:station` — station glow.

Budget: 16 total (auto) / 6 (eco). Ship lights exempt from budget.
Re-evaluation: every 6 frames.

### 8.3 Light profile

- `auto`: full budget, all signatures.
- `eco`: cap 6, no signatures, no landmarks.
- Toggled by `L` key. Persisted to localStorage.
- AQ2 forces eco regardless of user setting.

---

## 9. Performance architecture

### 9.1 Adaptive quality

Time-based FPS sampling (1-second window). Not frame-count-based
(frame-based froze at low FPS because frames > 0.5 s were discarded and
the 60-frame window never filled).

| Level | Resolution scale | CA | Grain | Lights |
|-------|-----------------|----|-------|--------|
| 0 | 1.0 | on | on | auto profile |
| 1 | 0.85 | on | on | auto profile |
| 2 | 0.7 | off | off | eco profile |

### 9.2 Headless perf gate

`scripts/check-perf.mjs`:
- Requires: dev server on 5199, CDP browser on 9222.
- Teleports to rung 9 (Spatial Graveyard) with `CHUNKS_RADIUS` 1.
- Samples 30 s: FPS, draw calls, triangles, console errors.
- Ceilings: draw calls ≤ 3500 (software renderer; real-GPU budget is 500),
  avg FPS ≥ 5 (sanity for SwiftShader), 0 console errors.
- Exits 0 on pass, 1 on fail.

### 9.3 Perf probe

`?perf=1` query param loads `PerfProbe.js` dynamically. Shows:
FPS (60-frame avg), draw calls, triangles, active lights, live particles,
JS heap MB, current rung.

### 9.4 Allocation discipline

- `scratch` object in `MathHelpers.js`: shared `Vector3`, `Quaternion`,
  `Euler`, `Matrix4` instances for hot loops.
- Particle pools: pre-allocated `Float32Array` buffers, ring-cursor write.
- Bolt pool: single `LineSegments` with `setDrawRange` (no geometry
  recreation).
- Wreck/city geometries and materials: module-level cache
  (`ProceduralWrecks.js`).
- No `new THREE.Vector3()` in update loops (except in spawn paths, which
  are amortized by chunk streaming).

---

## 10. State management

### 10.1 GameState (mutable data bag)

```js
{
  score: 0,
  distance: 0,          // u, monotonically increasing
  health: 100,
  maxHealth: 100,
  shield: 100,
  throttle: 0,          // 0..1
  rungIndex: 0,         // 0..13
  lightProfile: 'auto',
  muted: false,
  paused: false,
  dead: false,
  highScore: 0,
  adaptiveLevel: 0,
  wormholeIntensity: 0,
}
```

Read by: HUD, PerfProbe, check-perf script (via `window.__VOID_DRIFT__`).
Written by: systems via direct property assignment (no setter methods).

### 10.2 Debug exposure

`window.__VOID_DRIFT__` = `{ game, state, three, constants, version }`.
Used by: PerfProbe, check-perf script, console debugging.

### 10.3 Persistence

`localStorage`:
- `void_drift_high_score` — number
- `void_drift_muted` — 'true' | 'false'
- `void_drift_light_profile` — 'auto' | 'eco'

---

## 11. Input architecture

`InputSystem` owns all raw input:
- `keydown` / `keyup` → movement keys, fire, pause, mute, light profile,
  ladder chart, restart.
- `mousedown` / `mouseup` → fire, shield.
- `mousemove` → camera look (pointer lock).
- `wheel` → throttle.
- `pointerdown` / `pointerup` on HUD touch elements → shield, throttle.
- `pointerlockchange` → pause/unlock.

All input is converted to `EventBus` events or direct `GameState` writes.
Systems never read `event` objects directly.

---

## 12. Error / edge-case handling

| Case | Handling |
|------|----------|
| WebGL context lost | `onContextLost()`: pause, show message |
| WebGL context restored | `onContextRestored()`: resume |
| Tab hidden | `dt` capped at 0.1 s (no tunneling) |
| AudioContext suspended | Resume on first pointerdown/keydown |
| Chunk spawn too close to ship | `shipPos` guard in every spawnChunk |
| Pulsar too close to another pulsar | `minSpacing` guard, skip spawn |
| City fragment too close to ship/other | `minDistShip` + `minSpacing` guards |
| Low-end hardware | CA + grain disabled at startup |
| Perf regression | `check:perf` gate in CI/dev workflow |
