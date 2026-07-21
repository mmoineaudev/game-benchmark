# 01 — Technical Architecture & Systems Mapping

> Reverse-engineering spec for the **Space Exploration (Void Drift)** browser game.  
> Source root: `src/` | Static entry: `main.js` | Canvas/HUD: `index.html`  
> All citations use `[Ref:XY-ZZ]` which map to section anchors in this and the other three documents.

---

## 1.1 Build & Runtime Stack [Ref:01-1.1]

| Layer | Technology | Evidence |
|-------|-----------|----------|
| Module system | ESM, `type: module` | `package.json:6` |
| Bundler | Vite 5.4 | `package.json:14`, `README.md` |
| 3D engine | Three.js r165+ (repo requires `^0.185.1`) | `package.json:16` |
| Audio | Web Audio API (native browser) | `src/systems/AudioSystem.js:24` |
| Shading | GLSL via `ShaderMaterial` + Three.js post-processing JSM | `src/utils/ShaderHelpers.js`, `src/systems/PostProcessingSystem.js:5-9` |

**Unit of work:** One render tick driven by `requestAnimationFrame` in `Game._animate()` [Ref:01-3.2].

---

## 1.2 Bootstrapping & Top-Level Control Flow [Ref:01-1.2]

**Entry:** `src/main.js`
- Waits for `DOMContentLoaded`, constructs `Game('game-container')`, calls `game.init()`.
- Hides `loading-screen` DOM element.
- Exposes `window.__game` for debug.

**Orchestrator:** `src/core/Game.js`
- Single `Game` instance owns **all** subsystems and the Three.js renderer/scene/camera triplet.
- Lifecycle: `init()` → `_animate()` loop → `shutdown()` / `_restart()`.

### 1.2.1 Init Sequence (`Game.init`, Game.js:44)
1. `WebGLRenderer` with `ACESFilmicToneMapping`, tone mapping exposure 1.2.
2. `THREE.Scene` + `THREE.PerspectiveCamera` (FOV 75, near 0.1, far 2000).
3. Exponential fog `0x111827 @ 0.0018`.
4. `_setupLighting()`: 5-light rig — Ambient, Directional sun, Directional fill, Directional rim, Hemisphere.
5. `_initSystems()`: Construction of every manager/system [Ref:01-4].
6. `_setupEvents()`: Window resize + EventBus subscriptions (audio, camera shake/zoom, pause, restart).
7. `_showPauseScreen()`: Full-screen overlay, waits for `Space`.

### 1.2.2 Render Loop (`Game._animate`, Game.js:186)
```
Frame start:
  - Compute delta-time (capped at 0.1s)
  - GameState.game.time += dt
  - InputSystem.update(dt)
  - EventBus.emit('game:tick')
  - PhysicsSystem.updatePlayerPhysics(...)
  - PlayerShip.updateRotation(...)
  - PlayerShip.updateEngineFlames(...)
  - CameraSystem.update(...)
  - WeaponSystem.update(...) ← handles projectile lifetime & range
  - Starfield / ChunkManager / ShootingStar updates
  - Exhaust particle spawning (if thrusting)
  - ParticleSystem.update(dt)
  - Collision checks: ship ↔ destructibles, projectiles ↔ destructibles
  - Post-processing uniform updates (chromatic aberration, bloom, film grain)
  - ScoreSystem + BuffSystem updates
  - Game-over detection → stop loop when dead
  - PostProcessingSystem.render()
```

---

## 1.3 Core Kernel: GameState & EventBus [Ref:01-1.3]

### GameState (`src/core/GameState.js`)
- **Singleton** (`export default new GameState()`).
- Domains:
  - `player` — `position: Vector3`, `velocity: Vector3`, `rotation: Euler('YXZ')`, `health`, `score`, `distance`, `isAlive`.
  - `combat` — `lastFireTime`, `projectiles[]`, `explosions[]`.
  - `game` — `time`, `isGameOver`, `isPaused`, `highScore`.
  - `buffs[]` — transient effect records.
- Persistence: high score via `localStorage` key `space_exploration_highscore` (load on first reset, save on death).
- `takeDamage(amount)` clamps health to [0, MAX=100], sets `isAlive=false`, sets `isGameOver=true` on death.
- Restart path: `reset()` zeroes all vectors and score/distance/health, re-initializes `buffs[]`.

### EventBus (`src/core/EventBus.js`)
- Typed pub/sub registry. Returns unsubscribe closure from `on()`.
- Catalog: 20 named events covering Game flow, Player, Weapon, Environment, Score, Audio, Visual.
- Used for loose coupling between audio, HUD, camera, and physics collision responses.
- All listeners run synchronously in emission order; errors caught per-listener.

---

## 1.4 Systems Taxonomy [Ref:01-1.4]

```
src/
├── core/           Kernel (Game, GameState, EventBus, Constants)
├── systems/        Infrastructure engines (Input, Camera, Physics, Audio, Particle, PostProcessing)
├── gameplay/       Player-authored behaviors (PlayerShip, WeaponSystem, ScoreSystem, BuffSystem)
├── level/          World content & chunk orchestration
│   ├── Starfield / ShootingStarManager   — celestial atmosphere
│   ├── ChunkManager                      — world seamlessness
│   ├── BiomeGenerator                    — progression rules
│   ├── NebulaSystem / PlanetManager      — landmarks
│   ├── AsteroidField / DebrisSystem      — destructibles
│   ├── CollectibleSystem                 — pickups
│   └── NPCShipManager                    — ambient traffic
├── ui/             HUD + Crosshair
└── utils/          Math + GLSL libraries
```

### 1.4.1 System Inventory Table

| System | File | Responsibility | Events Emitted | Events Subscribed |
|--------|------|----------------|----------------|-------------------|
| InputSystem | `src/systems/InputSystem.js` | Keyboard polling, `thrust`/`brake` flags | `input:keydown`, `input:keyup` | — |
| PhysicsSystem | `src/systems/PhysicsSystem.js` | Ship kinematics, sphere-sphere collision | `physics:collision`, `camera:shake` | — |
| CameraSystem | `src/systems/CameraSystem.js` | Follow cam, damping, FOV speed curve, zoom, shake | — | `camera:shake`, `camera:zoom` |
| AudioSystem | `src/systems/AudioSystem.js` | Web Audio synth for engine/laser/explosion/collision/warning | `audio:mute` | `audio:laser`, `audio:collision`, `audio:explosion`, `audio:warning` |
| ParticleSystem | `src/systems/ParticleSystem.js` | Exhaust pool (120 ptcls), explosion pool (dynamic), sparks | — | — |
| PostProcessingSystem | `src/systems/PostProcessingSystem.js` | EffectComposer: Render→Bloom→Chromatic Aberration→Vignette→Film Grain→Output | — | — |
| PlayerShip | `src/gameplay/PlayerShip.js` | Mesh authoring, rotation yaw/pitch/roll clamp, engine flame shader, hit flash | — | — |
| WeaponSystem | `src/gameplay/WeaponSystem.js` | Laser spawning, 8 Hz fire rate, 3s lifetime, 120 u/s speed | `weapon:fire` | — |
| ScoreSystem | `src/gameplay/ScoreSystem.js` | Score awarding, distance points, HUD DOM updates, game-over panel | — | `game:gameover` |
| BuffSystem | `src/gameplay/BuffSystem.js` | Time-based stat modifiers (currently unused scaffold) | — | — |
| ChunkManager | `src/level/ChunkManager.js` | Infinite-world spawn/cleanup, owns sub-content managers | — | — |
| BiomeGenerator | `src/level/BiomeGenerator.js` | Biome selection + scaled params by distance | — | — |
| NebulaSystem | `src/level/NebulaSystem.js` | Volumetric nebula billboards with simplex-noise GLSL | — | — |
| AsteroidField | `src/level/AstersteroidField.js` | 3-tier asteroid generation (large mesh, med/small InstancedMesh) | — | — |
| DebrisSystem | `src/level/DebrisSystem.js` | Dense instanced small-rock field per chunk | — | — |
| CollectibleSystem | `src/level/CollectibleSystem.js` | Crystal (green +50) and Ruin (brown +20) pickups | — | — |
| PlanetManager | `src/level/PlanetManager.js` | Persistent large spherical landmarks with ribbon-band shader | — | — |
| NPCShipManager | `src/level/NPCShipManager.js` | Wandering NPC ships with point-trails | — | — |
| Starfield | `src/level/Starfield.js` | 4-layer parallax starfield with GPU streaking | — | — |
| ShootingStarManager | `src/level/ShootingStarManager.js` | Low-frequency rare split-shooting stars with gas trails | — | — |

---

## 1.5 Subsystem Interconnection Map [Ref:01-1.5]

```
Game (orchestrator)
  ├── InputSystem  ◄── keyboard ──► Game._attemptFire() + PlayerShip._yawInput + thrust/brake flags
  │
  ├── PhysicsSystem
  │     ├── reads shipObject (position, velocity, quaternion)
  │     ├── reads InputSystem (thrust/brake)
  │     ├── writes GameState (position, distance)
  │     ├── emits 'physics:collision' ──► HUD.damageFlash() + HUD.screenFlash()
  │     └── emits 'camera:shake' ──► CameraSystem.triggerShake()
  │
  ├── PlayerShip
  │     ├── reads InputSystem for arrow keys
  │     ├── reads GameState.time for shader uniforms
  │     ├── writes shipObject.userData (velocity in Physics)
  │     └── reads thrusting flag from Game for flame visibility
  │
  ├── WeaponSystem
  │     ├── reads shipMesh quaternion + position
  │     ├── writes scene (laser meshes)
  │     ├── emits 'weapon:fire' / 'audio:laser'
  │     └── provides `getProjectiles()` to Physics for hit tests
  │
  ├── CameraSystem
  │     ├── reads shipObject (position, quaternion, velocity)
  │     ├── reacts to 'camera:shake' / 'camera:zoom'
  │     └── FOV dynamically lerped by speedRatio
  │
  ├── ParticleSystem
  │     ├── receives manual spawns from Game (exhaust) / Weapon (sparks)
  │     ├── interacts only with scene graph
  │     └── pool-based economies for exhaust/explosions
  │
  ├── PostProcessingSystem
  │     ├── reads speedRatio for bloom/chromatic
  │     ├── reads GameState.time for film grain
  │     └── final render terminal
  │
  ├── AudioSystem
  │     ├── listens to 'audio:laser', 'audio:collision', 'audio:explosion', 'audio:warning'
  │     └── AudioContext lazy init on first user gesture
  │
  ├── HUD
  │     ├── reads GameState every tick (health, score, distance)
  │     ├── listens 'game:gameover'
  │     └── imperative full-screen flash overlay DOM injection
  │
  └── ChunkManager (world wrapper)
        ├── BiomeGenerator ──► params per chunk
        ├── NebulaSystem ──► scene clusters
        ├── AsteroidField ──► scene meshes
        ├── DebrisSystem ──► scene meshes
        ├── CollectibleSystem ──► scene meshes + score
        ├── PlanetManager ──► scene meshes
        └── NPCShipManager ──► scene meshes
              └── Physics checks invasiveness via `getCollidables()`
```

---

## 1.6 Physics & Collision Architecture [Ref:01-1.6]

### 1.6.1 Ship Kinematics (PhysicsSystem.updatePlayerPhysics)
- **1-DOF ship motion** along forward axis only. No lateral/vertical drift from frame to frame.
- Forward vector computed each tick from ship quaternion `q`: `forward = (0,0,-1) * q`.
- `targetForwardSpeed` integrates acceleration/deceleration, clamped to `[0, MAX_SPEED=50]`.
- Velocity vector is always parallel to forward axis: `vel = forward.vector * speed`.
- Distance tracking via Manhattan distance from origin. Added only when growing.
- Fixed-step accumulator present (`_fixedDt = 1/60`, `_accumulator`) but **not used** in current loop — delta-time is variable (capped).

### 1.6.2 Collision Detection
- **Ship ↔ World:** Sphere-sphere test. Ship radius = 1.2.
- **Instanced targets:** `PhysicsSystem.checkShipCollisions` iterates `_collidables` array from `userData`.
- **Projectile ↔ World:** Sphere-sphere test, projectile radius = 0.3.
- Projectile hit **deduplication** via `Game._projectileHitsProcessed` Set keyed `"projectileIndex-targetIndex"`. **Critical flaw:** indices shift on splice; key can become stale after array mutation (see [Ref:01-1.6] note in 04_implementation_plan).

### 1.6.3 Collision Response
- `handleCollision()`:
  - `GameState.takeDamage(10)`.
  - Bounce: `vel += -(vn + 3.5) * normal` if approaching, else `+= 3.5 * normal`.
  - Scale velocity by 0.7.
  - Push ship out along normal by `penetration + 0.2`.
  - Emits `camera:shake` (large: 0.8, small: 0.3).
  - Sets `ship.userData.hitFlash = 0.25` (triggers emissive flash in PlayerShip).

---

## 1.7 Chunking & Infinite World [Ref:01-1.7]

### 1.7.1 Grid & Spacing
- Chunk dimensions: `Constants.CHUNK`: W=240, H=240, L=240.
- Ship position → chunk coords via `Math.floor(coord / dimension)`.
- Active range: `-spawnAhead=+1` in x/z; y extends from `ship.y-1` upward when near origin, symmetric when >10 units out.
- Lagging chunks: any with `dx,dy,dz < -1` are culled.

### 1.7.2 Seeded Content Generation
- Chunk seed via `chunkSeed(cx, cy, cz)` (helpers.js:32).
- RNG per chunk via `mulberry32(seed)` — deterministic.
- Per chunk spawns:
  - `biomeParams.nebulaCount` nebula clusters.
  - 1–12 asteroids.
  - 10–100 debris.
  - 1–3 crystals, 1–2 ruins.
  - Optional wormhole tunnel if biome active.

### 1.7.3 Stability Zone
- Near origin (`distanceToOrigin < 10`), `AsteroidField` enforces `safetyRadius=25` around ship; retries up to 20 attempts (large) or 10 (instanced).

---

## 1.8 Rendering & Materials [Ref:01-1.8]

### 1.8.1 Materials Used
- `MeshStandardMaterial`: asteroids, debris, NPC ships, smoke/dust-colored parts.
- `MeshPhysicalMaterial` (transmission): ship windshield.
- `MeshBasicMaterial`: atmosphere shell (backside).
- `ShaderMaterial`: planet surface, nebula clouds, starfield, engine flames, exhaust, explosions, wormhole tunnel, custom crosshair not used.
- `PointsMaterial`: exhaust pool, explosions, sparks, shooting stars, starfield is ShaderMaterial too.

### 1.8.2 Instancing
- **Asteroids:** Medium (`InstancedMesh`, DodecahedronGeometry), Small (`InstancedMesh`, OctahedronGeometry).
- **Debris:** Single `InstancedMesh` per chunk (IcosahedronGeometry).
- **Collision with instancing:** Per-instance AABB spheres precomputed in `_collidables` array, attached to `userData._collidables`. Non-instanced targets use `userData.boundingSphere`.

---

## 1.9 Audio Architecture [Ref:01-1.9]

- Lazy-loaded `AudioContext` on first user gesture (click or non-modifier keydown).
- Master gain = 0.3; engine engine gain = 0.15.
- **Engine rumble:** Persistent sawtooth oscillator → lowpass filter (`Q=1`, freq 200) → gain node. Frequency and volume interpolated by speed ratio via `setTargetAtTime` time-constant 0.1s.
- **Laser:** Short sawtooth sweep 800→200 Hz in 0.1s, gain 0.08→0.001.
- **Explosion:** White-noise buffer with exponential decay envelope through 800*size Hz lowpass, duration 0.5s.
- **Collision:** White-noise decay in 0.4s through 300 Hz lowpass, gain 0.2.
- **Warning:** 3 beeps at 800 Hz sine, 0.3s spacing, internal cooldown 1.5s.
- Mute toggle via `KeyM`; publishes `audio:mute` event; independently gates engine and master gains to 0.

---

## 1.10 Shader Inventory [Ref:01-1.10]

| Shader | File/Const | Used By | Algorithm |
|--------|-----------|---------|-----------|
| Planet surface | `PLANET_VERT/FRAG` (PlanetManager.js:8-47) | `PlanetManager` | Fresnel rim + 2-octave sinusoidal `band()` flow |
| Nebula body | `NEBULA_VERT` + `SIMPLEX_3D_GLSL` + `NEBULA_FRAGMENT_BODY` | `NebulaSystem` | 3-octave FBM simplex noise, smoothed, additive blend, pulsing alpha |
| Starfield | `STAR_VERTEX_SHADER` + `STAR_FRAGMENT_SHADER` | `Starfield` | GPU parallax offset, speed-based streak elongation, twinkle |
| Engine flame | `FLAME_VERTEX_SHADER` + `FLAME_FRAGMENT_SHADER` | `PlayerShip` | Per-vertex flicker sin-wave, elongation by thrust, bright-core gradient |
| Wormhole | `WORMHOLE_VERT/FRAG` | `ChunkManager` | Fresnel glow on tunnel walls, animating displacement |
| Bloom | UnrealBloomPass (Three.js JSM) | `PostProcessingSystem` | Threshold 0.35, radius 0.4 |
| Chromatic Aberration | Custom `ShaderPass` | `PostProcessingSystem` | Gaussian offset by speed; skipped on ≤4 hardware threads |
| Vignette | Custom `ShaderPass` | `PostProcessingSystem` | Distance-to-center smoothstep darkening |
| Film Grain | Custom `ShaderPass` | `PostProcessingSystem` | Hash-based pseudo-noise with time; skipped on ≤4 threads |
| Exhaust particle | `EXHAUST_VERT/FRAG` (ShaderHelpers) | `ParticleSystem` | Point attenuation, fade by life |
| Explosion particle | `EXPLOSION_VERT/FRAG` (ShaderHelpers) | `ParticleSystem` | Size attenuates, color gradient over life |
| Laser (defined but unused in WeaponSystem) | `LASER_VERT/FRAG` | — | Present in ShaderHelpers but weapon uses standard mat |

> **Note:** `La ser_mesh` currently uses `MeshStandardMaterial` with emissive, not a `ShaderMaterial`. The laser GLSL is dead code.

---

## 1.11 Data-Model Summary [Ref:01-1.11]

### Core State Object
```js
{
  player: { position: Vector3, velocity: Vector3, rotation: Euler, health, score, distance, isAlive, isRestarting },
  combat: { lastFireTime, projectiles[], explosions[] },
  game: { time, isGameOver, isPaused, highScore },
  buffs: []  // currently unused by gameplay, managed here and via BuffSystem scaffolding
}
```

### World Object Identity
- Every placeable carries `userData.isChunkObject = true` to aid global cleanup on restart (`ChunkManager._clearAllChunks`).
- Destructibles carry `userData.size`, `userData.isDestroyed`, optional `userData.boundingSphere`.
- Instanced arrays carry `userData._collidables[]` for physicking.

### Chunk Map
- `ChunkManager._activeChunks`: Map `"cx,cy,cz"` → `{ cx, cy, cz, objects[] }`.
- Each manager owns its own scene children; `ChunkManager` does not enumerate them — instead, cleanup relies on:
  1. Per-chunk `chunk.objects[]` references.
  2. Fallback `scene.traverse` filter on `userData.isChunkObject || userData.isWormhole`.
