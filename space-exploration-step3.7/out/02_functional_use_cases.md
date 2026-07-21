# 02 — Functional Use Cases & Game Rules

> Exhaustive behavior catalog for the **Void Drift** space exploration game.  
> Cross-references: `[Ref:01-§n]` → architecture sections, `[Ref:03-§n]` → style/design sections, `[Spec:03-§2.1]` → style doc section, `[Spec:04-P1.1]` → implementation plan task.

---

## 2.1 Actor / Entity Catalog [Ref:02-2.1]

| Entity | Class / Module | Domain | Persistence |
|--------|---------------|--------|-------------|
| PlayerShip | `PlayerShip` | Gameplay | Transient (per run) |
| Laser Projectile | `WeaponSystem._projectiles[]` | Combat | 3s or 200u max |
| Asteroid (large) | `AsteroidField._asteroids[]` | Destructible | Per-chunk |
| Asteroid (medium/small) | `InstancedMesh` in AsteroidField | Destructible | Per-chunk |
| Debris fragment | `DebrisSystem._debris[]` | Destructible | Per-chunk |
| Crystal pickup | `CollectibleSystem` | Collectible | Per-chunk |
| Ruin pickup | `CollectibleSystem` | Collectible | Per-chunk |
| NPC ship | `NPCShipManager._ships{}` | Ambient | Up to 28 total |
| Planet | `PlanetManager._planets{}` | Landmark | Persistent if within viewDistance=18750u |
| Nebula cluster | `NebulaSystem._clusters[]` | Atmosphere | Per-chunk |
| Wormhole tunnel | `ChunkManager._activeChunks` | Atmosphere + progression | Per-chunk |
| Shooting star | `ShootingStarManager._stars{}` | Atmosphere | ~3.5s spawn window |

---

## 2.2 Use Case Index

| ID | Title | Primary Modules |
|----|-------|-----------------|
| UC-01 | Boot & Pause Screen | `main.js`, `Game`, InputSystem, EventBus |
| UC-02 | Session Start | `Game._showPauseScreen`, player press Space |
| UC-03 | Session Restart | `Game._restart`, `GameState.restart`, ScoreSystem, BuffSystem |
| UC-04 | Session Shutdown | `Game.shutdown`, all `destroy()` |
| UC-05 | Ship Forward Thrust | `PhysicsSystem`, `InputSystem`, `ParticleSystem`, `AudioSystem` |
| UC-06 | Ship Braking | `PhysicsSystem`, `InputSystem` |
| UC-07 | Ship Yaw & Pitch | `PlayerShip`, `InputSystem` |
| UC-08 | Engine Flame Update | `PlayerShip`, `GameState.time`, `ParticleSystem` (exhaust optional) |
| UC-09 | Firing Lasers | `WeaponSystem`, `GameState`, `ParticleSystem`, `AudioSystem`, `EventBus` |
| UC-10 | Laser Impact on Large Asteroid | `PhysicsSystem`, `ParticleSystem`, `AudioSystem`, `ScoreSystem`, `CameraSystem`, `HUD`, `ChunkManager` |
| UC-11 | Laser Impact on Instanced (Med/Small) Asteroid | Same as UC-10, with instanced-marked path |
| UC-12 | Laser Impact on Debris | `WeaponSystem`, `ScoreSystem`, "debris", 1 pt |
| UC-13 | Ship ↔ Destructible Collision | `PhysicsSystem`, `GameState.takeDamage`, `AudioSystem`, `HUD`, `CameraSystem` |
| UC-14 | Ship ↔ NPC Collision | Same as UC-13 (NPC passed as target) |
| UC-15 | Crystal Pickup | `CollectibleSystem`, `GameState.addScore(50)` |
| UC-16 | Ruin Pickup | `CollectibleSystem`, `GameState.addScore(20)` |
| UC-17 | Hull Depletion & Game Over | `GameState.takeDamage`, `HUD.showGameOver`, loop stop |
| UC-18 | Biome Transition | `BiomeGenerator.getBiomeParams`, `ChunkManager._spawnChunk` |
| UC-19 | Wormhole Tunnel | `ChunkManager._createWormholeTunnel`, biome params |
| UC-20 | Infinite World Chunk Spawning | `ChunkManager._updateChunks`, deterministic RNG |
| UC-21 | Infinite World Chunk Cleanup | `ChunkManager._removeChunk`, geometry/material disposal |
| UC-22 | Starfield Parallax | `Starfield.update`, GPU shader offset by `uCameraOffset` |
| UC-23 | Shooting Star Spawn | `ShootingStarManager._maybeSpawn` (35% chance / 3.5s window) |
| UC-24 | Camera Speed Follow & FOV Warp | `CameraSystem.update`, `Constants.CAMERA` |
| UC-25 | Camera Zoom | `CameraSystem.applyZoom`, scroll-wheel event on EventBus |
| UC-26 | Camera Shake Decay | `CameraSystem.triggerShake` + exponential decay |
| UC-27 | HUD Refresh every Tick | `HUD.updateHealthBar/updateScore/updateDistance/checkWarning` |
| UC-28 | Low-Health Warning Overlay | `HUD`, CSS pulse, Warning beeps via `AudioSystem.playWarning` |
| UC-29 | Score Persistence | `GameState._loadHighScore/_saveHighScore` localStorage |
| UC-30 | Audio Context Resumption | `AudioSystem._resumeContext`, browser autoplay policy |
| UC-31 | Mute Toggle | `KeyM` → `AudioSystem.toggleMute`, event `audio:mute` |
| UC-32 | Screen Flash Effects | `HUD.screenFlash`, opacity transition, time-based removal |
| UC-33 | Particle Exhaust Pool | `ParticleSystem.spawnExhaust`, max 120 active, life 0.3-0.7s |
| UC-34 | Explosion Particle Burst | `ParticleSystem.createExplosion`, dynamic point cloud + dynamic spline |
| UC-35 | Debris Particle Sparks | `ParticleSystem.createSparks`, transient points (disposed when alive-ended) |
| UC-36 | NPC Ship Wandering | `NPCShipManager._moveNPC`, 10u/s, direction lerp with 0.8-2.3s interval |
| UC-37 | NPC Trail Rendering | `NPCShipManager._spawnTrailAt` → ring buffer of points |
| UC-38 | Planet Appearance | `PlanetManager._spawnPlanet`, procedurally sized, ribbon-band shader, optional atmosphere |

---

## 2.3 Functional Detail — Play Session Behavioral Rules [Ref:02-2.3]

### 2.3.1 Session State Machine
```
EXITED → PAUSED  (Game.init + pause overlay)
PAUSED → PLAYING (Space)
PLAYING → PAUSED (not reachable except restart path)
PLAYING → DEAD   (health <= 0)
DEAD → PLAYING   (KeyR)
DEAD → EXITED    (Game.shutdown)
```

### 2.3.2 Movement Physics
- **Speed:** Max 50 units/s. Acceleration 38u/s². Deceleration 25u/s². Drag factor 0.97 per frame on collision bounce only; normally drag is not applied during thrust — no coasting drift since velocity is always along forward.
- **Rotation:** Yaw rate 2.2 rad/s, pitch rate 2.2 rad/s, **no roll input** (roll only occurs indirectly via rotation quaternion), pitch clamped to ±π/2.2 (~81°).
- **Speed-gated rotation:** `speedLerp = 0.6 + 0.4 * speedRatio`. Effective rate = 2.2 * speedLerp (so ~2.2 at idle, ~3.1 at max speed).

### 2.3.3 Weapon Balances
- Fire rate: 8 Hz => 125 ms between shots.
- Muzzle velocity: 120 u/s.
- Projectile lifetime: 3 s.
- Max range: 200 u.
- Recoil: 0.5 forward-unit added to ship velocity on fire. No damage to self.
- Ammo: unlimited.

### 2.3.4 Damage Model
- Single hit to player: –10 health.
- 10 hits to die from full 100 HP.
- Shield-down colliding again = further knockback but no extra damage logic (just additive).

### 2.3.5 Scoring Model
- **Large asteroid (>2u radius):** +30 points.
- **Medium asteroid (>0.8, ≤2):** +20.
- **Small asteroid (≤0.8):** +10.
- **Debris:** +1.
- **Distance:** +0.1 per unit traveled (floored to int snapshot per frame).
- **Crystal:** +50 (Collectible).
- **Ruin:** +20 (Collectible).
- High score persists to `localStorage` across sessions.

### 2.3.6 Collision Priority & Deduplication
- Ship-world collision runs first; sets `hitFlash` and emits shake/flash immediately.
- Projectile-world collision runs after; flags destroyed, awards score, removes projectile.
- Same (proj-index, target-index) pair is skipped if already in `Game._projectileHitsProcessed`.
- **Known limitation:** When projectile is removed with `splice`, indices shift but Set retains stale keys — could miss future hits or allow double-counts on rare loops.

### 2.3.7 World Generation Rules
- **Deterministic:** chunk content is seeded by `chunkSeed(cx,cy,cz)`. Same coords always produce identical content.
- **Progressive:** Biome scales intensity with `1 + distance/5000` toward infinity; values above 3x cap at 3.
- **Chunk adjacency logic:** World spawns chunks one cell ahead in forward X and all Z/Y within spawnAhead=1 band; cleanup backfills old chunks. Near-origin behavior special-cased with `y = -1` anchor for initial player protection.

---

## 2.4 Edge Cases & Failure Modes [Ref:02-2.4]

### 2.4.1 Tab-Out Stability
- Delta capped at 0.1s (100ms) to prevent large position jumps.
- Fixed-step accumulator variables exist in Game (`_accumulator`, `_fixedDt`, `_maxSteps`) but are **never used** — physics accumulates drift on heavy frame drops.

### 2.4.2 Restart Cleanup Gaps
- `Game._restart` disposes through explicit lists and `_disposeScene` traverse.
- `PostProcessingSystem.composer?.dispose()` is called; each pass' internal dispose is not explicitly invoked (potential GPU resource leak after many restarts).

### 2.4.3 NPC Collision Edge
- NPC ships are **visible filter only** in `getCollidables()` — their `userData` lacks a `boundingSphere`. Physics falls through to the next target or returns no collision, making NPCs effectively intangible in current implementation.
