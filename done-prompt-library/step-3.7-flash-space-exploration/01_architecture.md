# 01 — Architecture

> Implemented by step-3.7-flash. Source base: `space-exploration-step3.7/src/` + entrypoints.

## 1. High-Level Shape

| Concern | Module(s) |
|---|---|
| Bootstrap/teardown | `src/main.js`, `src/core/Game.js` |
| Central configuration | `src/core/Constants.js` |
| Global mutable state | `src/core/GameState.js` (singleton) |
| Cross-cutting messaging | `src/core/EventBus.js` (singleton) |
| Input abstraction | `src/systems/InputSystem.js` |
| Rendering/camera | `src/systems/CameraSystem.js`, `src/systems/PostProcessingSystem.js` |
| Physics/collision | `src/systems/PhysicsSystem.js` |
| Audio | `src/systems/AudioSystem.js` |
| FX | `src/systems/ParticleSystem.js` |
| Player entity | `src/gameplay/PlayerShip.js` |
| Combat | `src/gameplay/WeaponSystem.js`, `src/gameplay/ScoreSystem.js`, `src/gameplay/BuffSystem.js` |
| World/level | `src/level/Starfield.js`, `src/level/ShootingStarManager.js`, `src/level/ChunkManager.js`, `src/level/BiomeGenerator.js`, `src/level/NebulaSystem.js`, `src/level/AsteroidField.js`, `src/level/DebrisSystem.js`, `src/level/CollectibleSystem.js`, `src/level/PlanetManager.js`, `src/level/NPCShipManager.js` |
| UI overlays | `src/ui/HUD.js`, `src/ui/Crosshair.js` |
| Math/GLSL | `src/utils/MathHelpers.js`, `src/utils/ShaderHelpers.js` |
| HTML overlays | `index.html` |

## 2. Tech Stack

| Tool | Role |
|---|---|
| **Three.js 0.185.1** | WebGL rendering, scene graph, shaders, post-processing |
| **@tweenjs/tween.js 25** | Declared but not imported in inspected sources |
| **Vite 5.4** | ESM dev server + build |
| **Web Audio API** | Procedural audio synthesis |
| **GLSL** | Custom shaders: nebula, starfield, exhaust, explosion, wormhole, engine flames, post-process |
| **No physics engine** | Hand-rolled sphere collisions and axis-aligned thrust |

## 3. Directory Layout

```
src/
  main.js
  core/
    Game.js
    Constants.js
    EventBus.js
    GameState.js
  systems/
    InputSystem.js
    CameraSystem.js
    PhysicsSystem.js
    AudioSystem.js
    ParticleSystem.js
    PostProcessingSystem.js
  gameplay/
    PlayerShip.js
    WeaponSystem.js
    ScoreSystem.js
    BuffSystem.js
  level/
    Starfield.js
    ShootingStarManager.js
    ChunkManager.js
    BiomeGenerator.js
    NebulaSystem.js
    AsteroidField.js
    DebrisSystem.js
    CollectibleSystem.js
    PlanetManager.js
    NPCShipManager.js
  ui/
    HUD.js
    Crosshair.js
  utils/
    MathHelpers.js
    ShaderHelpers.js
```

## 4. Runtime Path

`main.js` → `new Game('game-container')` → `Game.init()` → `_initSystems()` → `_setupEvents()` → pause screen rendered.
User presses space → `_animate()` loop starts.

### `Game._animate()` loop (per frame, capped 60 Hz / accumulator)

1. Advance `GameState.game.time`.
2. `InputSystem.update(dt)`.
3. Emit `game:tick`.
4. Update player physics (forward-axis thrust only).
5. Update ship rotation (arrow keys).
6. Update engine flame visuals + glow.
7. Update follow camera + FOV/speed lerp + shake/zoom.
8. Handle fire input (`Space`/`KeyF`/mouse left) → `WeaponSystem.fire`.
9. Update weapon projectiles/lifetime.
10. Update starfield parallax + streaks.
11. Update `ChunkManager` → biome spawn/despawn for every sublevel.
12. Update `ShootingStarManager`.
13. Spawn exhaust particles when thrusting.
14. Update `ParticleSystem`.
15. Broad phase: `chunkManager.getCollidables`.
16. Narrow phase ship collisions → `PhysicsSystem.handleCollision` → HUD flash, screen shake, health damage.
17. Narrow phase projectile collisions → explosion particles, screen flash, score award, projectile removal.
18. Update post-processing (chromatic aberration, bloom, grain).
19. Update HUD + distance scoring.
20. Update buff timers.
21. Game-over check; if dead, render HUD and stop loop.
22. `PostProcessingSystem.render()` via composer.

## 5. Module Dependency Map

```
main.js → Game.js
Game.js → core: Constants, EventBus, GameState; systems: Input/Camera/Physics/Audio/Particles/PostProcessing;
          gameplay: PlayerShip/Weapon/Score/Buff; level: Starfield/ChunkManager/ShootingStar; ui: HUD/Crosshair
Core: EventBus → none (vendor)
        GameState → Constants only
        Constants → none
        Game → everything else
Systems:
  InputSystem → Constants, EventBus
  CameraSystem → Constants, GameState
  PhysicsSystem → GameState, EventBus, Constants
  AudioSystem → Constants
  ParticleSystem → Constants
  PostProcessingSystem → THREE, three postprocess addons, Constants
Gameplay:
  PlayerShip → THREE, Constants, GameState, ShaderHelpers
  WeaponSystem → THREE, Constants, GameState, EventBus, ParticleSystem
  ScoreSystem → Constants, GameState, EventBus
  BuffSystem → none beyond JS stdlib
Level:
  Starfield → THREE, Constants, ShaderHelpers, MathHelpers
  ShootingStarManager → THREE
  ChunkManager → THREE, Constants, GameState, EventBus, BiomeGenerator, NebulaSystem, AsteroidField, DebrisSystem, CollectibleSystem, PlanetManager, NPCShipManager, MathHelpers
  BiomeGenerator → Constants, MathHelpers
  NebulaSystem → THREE, Constants, ShaderHelpers
  AsteroidField → THREE, MathHelpers
  DebrisSystem → THREE, MathHelpers
  CollectibleSystem → THREE, GameState
  PlanetManager → THREE, Constants, MathHelpers
  NPCShipManager → THREE, Constants, MathHelpers
UI:
  HUD → GameState, Constants, EventBus
  Crosshair → none
Utils:
  MathHelpers → THREE (mulberry32, vectors)
  ShaderHelpers → none, GLSL strings only
```

## 6. Global State / Data Ownership

- **`EventBus`**: singleton pub/sub for decoupled cross-system events.
- **`GameState`**: singleton holding `player { position, velocity, rotation, health, score, distance, isAlive }`, `combat { lastFireTime, projectiles[], explosions[] }`, `game { time, isGameOver, isPaused, highScore }`, `buffs[]`.
- **DOM overlay state**: `HUD.js`, `ScoreSystem.js`, HTML elements hold telemetry-bound text directly (`#score-display`, `#distance-display`, `#health-fill`, `#game-over`).

## 7. Memory/Persistence

| Store | Scope | Medium |
|---|---|---|
| `GameState.player.score` | runtime | JS heap |
| `localStorage["space_exploration_highscore"]` | persistent | string-parsed int |
| Scene graph objects | per-run | GPU/JS refs; disposed via `destroy()` / `_disposeScene()` |

## 8. Core Rules Governing Architecture

- **God-object caveat**: `Game.js` owns the tight loop; systems are manually instantiated in `_initSystems()` and destroyed in `shutdown()`/`_restart()`.
- **No automated tests**: no test runner or framework present; there is only a Vite dev server + manual browser execution.
- **No networking/multiplayer**: purely local, one player, no backend.
- **No save state:** only high score survives refresh via localStorage; everything else resets.

## 9. Data Flow Summary

```
Keyboard/Mouse
  → InputSystem.{keys, thrust, brake}
  → Game._animate()
    → PhysicsSystem.updatePlayerPhysics() → ship.position/velocity
    → PlayerShip.updateRotation()
    → PlayerShip.updateEngineFlames()
    → CameraSystem.update()
    → WeaponSystem.fire()
    → WeaponSystem.update()
    → ChunkManager.update() → Nebula/Asteroids/Debris/Collectibles/Planets/NPCs
    → ParticleSystem.spawnExhaust() + update()
    → PhysicsSystem.checkShipCollisions()/checkProjectileCollisions()
    → HUD screen flash + damage
    → ScoreSystem.awardDestruction()/updateDistanceScore()
    → PostProcessingSystem.updateChromaticAberration()/updateBloom()/updateFilmGrain()
    → GameOver if health<=0
```

## 10. Technical Caveats

- **`InputSystem` docs/constants mismatch**: documented as `W/A/S/D` in README/HTML, but `Constants.INPUT` defines `FORWARD=ShiftLeft`, `BACKWARD=Space`, `FIRE=KeyF`, `RESTART=KeyR`. `PlayerShip.updateRotation` uses `ArrowLeft/Right/Up/Down` directly. Actual binding for WASD is absent unless handled elsewhere not in inspected code.
- **Projectile removal indexing mismatch**: `WeaponSystem.update` removes from `_projectiles` using backward iteration, then calls `GameState.removeProjectile(i)` where `i` has already been decremented—potential mismatch with `GameState.combat.projectiles[]`.
- **Instanced collision granularity**: projectile collision skips instanced asteroids entirely (`if (target.isInstanced) continue;`), only impacting individual `Mesh` destructibles.
- **Asteroid destruction vs physics**: chunk collision checks `hit.target.userData.isDestroyed` but `AsteroidField.removeDestroyed` only removes from `_asteroids` array; `PhysicsSystem` reuses boundings so stale entries may briefly persist.

## 11. Cross-Reference Index

| Internal reference | Externally documented at |
|---|---|
| PhysicsSystem collision/hit logic | §Collision, §Edge Cases — `02_functional_use_cases.md` |
| Biome program rules, flow | §Level Generation — `02_functional_use_cases.md` |
| Camera shake/zoom behavior | §Post-Processing and Camera — `03_style_and_design.md` |
| Ship color language | §Ship Viz — `03_style_and_design.md` |
| Per-feature prioritization | §Architecture-Referred Plan — `04_implementation_plan.md` |
| God-tier opportunities | §God-Tier Enhancements — `04_implementation_plan.md` |

---

*Next:* `02_functional_use_cases.md` enumerates player-facing behaviors, rules, and edge cases with full cross-references to this architecture.
