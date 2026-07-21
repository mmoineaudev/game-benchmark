# 02 — Functional Use Cases

> Implemented by step-3.7-flash. Use-case-first view of the analyzed game source. Cross-references point to sections in `01_architecture.md`.

## 1. Game Modes & Sessions

| ID | Name | Type | Trigger | Source |
|---|---|---|---|---|
| UC-01 | LaunchScreen / Launcher | On-rails UI | Open `/` or `/game.html` | `public/index.html`, `index.html` |
| UC-02 | PausedAtStart | Paused init state | Boot | `Game._showPauseScreen` |
| UC-03 | ExploreLoop | Repeatable run | Space → alive → collide → dead/high-score | `Game._animate()` |

## 2. States & Transitions

```
Boot → Paused (SPACE) → Running (alive) → GameOver → Restart (R) → Running
                    ↘ M mute/unmute
                    ↘ R ingame = no-op (restart handler gated by !isAlive in Game.js)
                    ↘ Window focus / autoplay policies gate AudioContext
```

## 3. Inputs & Controls

| Input | Bound constant/system code | Effect | Notes / discrepancy |
|---|---|---|---|
| Space (hold) | `Constants.INPUT.BACKWARD = 'Space'` | Brake / thrust reversed intent | README says "Space = fire"; code uses Space as brake. |
| Shift / ShiftLeft | `Constants.INPUT.FORWARD = 'ShiftLeft'` | Thrust | Matches launcher "W/A/S/D" phrasing only loosely—WASD is reportedly aspirational; actual steering is arrows. |
| Arrow Left/Right | `PlayerShip.updateRotation` | Yaw rotate on world up axis | |
| Arrow Up/Down | `PlayerShip.updateRotation` | Pitch rotate on ship local X | Limited to ±~81° pitch clamp |
| KeyF | `Constants.INPUT.FIRE = 'KeyF'` | Fire laser | Also any mouse left-click handled by InputSystem forwarding? InputSystem only tracks `keys[]`. Mouse fire path is absent in inspected code. |
| KeyR | `Constants.INPUT.RESTART` | Restart if !isAlive | Live game - no reset offered. |
| KeyM | N/A direct handler | Toggle mute | Routed via input `keydown`. |
| Wheel / Zoom | Not in InputSystem, routed via EventBus `camera:zoom` | Camera zoom | No binding found in UI; likely external UI handling not in inspected code. |

> **Reality vs README mismatch:** README claims `W/A/S/D` strafe + mouse steer. The actual source only listens for `ArrowLeft/Right/Up/Down` yaw/pitch and `ShiftLeft` thrust. No WASD strafe, no mouse steer implemented in inspected files.

## 4. Movement Model

### 4.1 Physics model (`PhysicsSystem.updatePlayerPhysics`)
- Ship velocity lives on `ship.userData.velocity`.
- **Forward-axis only**: velocity is recomputed as `_forward * targetSpeed` where `_forward = world forward of ship quaternion`. **There is no lateral/strafe velocity** and no gravity/drag beyond the clamp and a dead code comment. The drag constant `Constants.SHIP.DRAG = 0.97` is defined but never applied in physics.
- Thrust increases `targetForwardSpeed` by `ACCELERATION * dt`. Brake decreases by `DECELERATION * dt` but cannot push speed negative.
- Hard clamp: `[0, MAX_SPEED]`.
- Position advanced by `velocity * dt`.
- Distance = `|pos.x| + |pos.y| + |pos.z|` delta applied to `GameState.addDistance`.

### 4.2 Camera model (`CameraSystem`)
- Follow cam: target position offset above + behind ship with `FOLLOW_HEIGHT=6`, `FOLLOW_DISTANCE=12`.
- Lerp damping factor: exponential-decay-style `1 - Math.pow(0.01, DAMPING_SPEED * dt)`.
- Speed → FOV lerp targets `MIN_FOV=60` to `MAX_FOV=110`.
- Shake on collision/muzzle/hit: `Math.random() * shakeAmount` per axis, decays through `Math.pow(0.001, dt)`.
- Zoom: multiplies `FOLLOW_DISTANCE` by `zoomFactor` in `[ZOOM_MIN=1, ZOOM_MAX=3]`.

## 5. Combat Model

### 5.1 WeaponSystem
- Lasers are `CylinderGeometry` meshes with emissive mat.
- Spawn point: ship forward * 2.2, + y+0.3.
- Shot velocity = `Constants.WEAPON.PROJECTILE_SPEED=120`.
- Lifetime = 3 s / max range = 200 units.
- Fire rate = 8 Hz.
- Recoil vector added to ship velocity on fire.

### 5.2 Collision Flow (`PhysicsSystem`)
**Ship collisions:**
- Broad: `chunkManager.getCollidables(shipPosition)` returns non-instanced destructibles + NPCs.
- Narrow: sphere vs sphere with ship radius 1.2.
- On hit: `GameState.takeDamage(10)`.
- Visual: `HUD.damageFlash`, HUD screen flash `#ff4444`, camera shake, hit-flash emissive.

**Projectile collisions:**
- Sphere vs sphere, proj radius 0.3.
- **InstancedMesh targets are skipped entirely.** Projectiles never collide with instanced asteroid/debris geometry.
- Non-instanced hit target (individual large asteroid): `userData.isDestroyed=true`; explosion particles; camera shake 0.5; screen flash; score.

### 5.3 Damage & Death
- Max health 100; warning overlay at ≤30 (health bar turns red).
- Death when health ≤ 0; game over screen; `Game._isRunning = false`.
- On restart: systems destroyed and rebuilt; `GameState.restart()` resets vectors/health/score/distance/buffs/projectiles/explosions/time/camera zoom.

## 6. Scoring Model

| Source | Points | Condition |
|---|---|---|
| `SCORE.ASTEROID_LARGE=30` | 30 | Asteroid size > 2 |
| `SCORE.ASTEROID_MEDIUM=20` | 20 | Asteroid size > 0.8 |
| `SCORE.ASTEROID_SMALL=10` | 10 | Asteroid size ≤ 0.8 |
| `SCORE.DEBRIS=1` | 1 | Debris (though projectile collision skips instanced debris in practice) |
| Distance | 0.1 × distance units traveled | Awarded in integer floors every `updateDistanceScore` tick |
| Collectibles | Crystal = 50, Ruin = 20 | Via `CollectibleSystem.update` proximity check |

- High score stored in `localStorage` under key `space_exploration_highscore` and triggered on death if current > prior.

## 7. Level Generation & Biome Rules

### 7.1 Biome progression (`Constants.BIOME.ZONES`, `BiomeGenerator`)
| Zone | Distance range | Nebula count | Asteroid density | Debris count | Wormhole? |
|---|---|---|---|---|---|
| Open Space | 0–1000 | 1 | 0.35 | 8 | No |
| Asteroid Belt | 1000–3000 | 1 | 0.8 | 8 | No |
| Nebula Corridor | 3000–5000 | 3 | 0.2 | 10 | No |
| Wormhole Tunnel | 5000–7000 | 2 | 0.05 | 4 | Yes |
| Wrap | ≥7000 | modulus alias | intensity scaling | intensity scaling | No |

Intensity = `1 + distance / 5000`, clamped at 2.5–3.0 multipliers.

### 7.2 Chunk system (`ChunkManager`)
- Chunk W/H/L = 240 units each, cubic.
- SPAWN_AHEAD = 1 ahead in X/Z; in Y it is biased toward `y < 10` to keep early spawn safe.
- CLEANUP_BEHIND = 1 behind in all axes.
- Per-chunk budget: nebula clusters (biome-tuned), asteroids (1–12 × density), debris (10–100 × density), crystals (1–3), ruins (1–2), optional wormhole tunnel.
- Safety-radius at origin: 25 units around ship when `|shipPos| < 10` → keeps initial spawn clean.

### 7.3 Sublevel/entity behavior

#### AsteroidField
- Large: individual meshes, vertex-displaced icosahedrons (size 2–5), bounded sphere radius = size.
- Medium: `DodecahedronGeometry` instanced mesh, size ~0.5–1.5, collidables exposed.
- Small: `OctahedronGeometry` instanced, size ~0.2–0.6, collidables exposed.
- All rotate/drift at render time; bounding spheres updated for large only.
- **Destruction gap**: only large non-instanced asteroids can be destroyed by weapons in current code because physics skips instanced targets.

#### DebrisSystem
- Small instanced icosahedrons, 0.1–0.3 scale, still visible in collision but projectile hit is skipped for instanced meshes. Debris remains purely decorative and collision-cosmetic.

#### NebulaSystem
- Billboard-quad clusters using GLSL noise; additive blending; billboard orient to camera every frame.
- Per biome: distinct color palettes (`params.nebulaColors`) and density.
- Exposes `nebulaCount` × 15 scale cluster count.

#### CollectibleSystem
- Crystals: green emissive octahedrons, value 50, proximity pickup 3.5 units → invisible + scored.
- Ruins: tan tetrahedrons, value 20, **spawn with `visible=false`**, so they are non-collectible cosmetics unless toggled elsewhere.

#### PlanetManager
- Spaced on 4800-unit grid with view-distance pruning at 18750 units.
- Only rocks with grid hash < 0.38 spawn (~38%).
- Radius classes: min ~60 units, max up to 240–324-ish.
- Atmosphere sphere at 1.12× radius added if radius > 12.
- Shader bands using layered sin combos + rim fresnel.

#### NPCShipManager
- Max 28 NPCs, spaced on 2400-unit grid, prune at 11250 units, spawn similar ~40% grid coverage.
- Four geometric types: cone, box, dodecahedron, cylinder.
- Wandering AI: random direction wish with lerp, tweening velocity, yaw/pitch spin.
- Trail particles regenerated as point strip with 256-point pool, lifetime decay 0.9 / sec.

#### ShootingStarManager
- Check every 3.5s: 35% chance to spawn.
- Each star: 12–32 points, speed 40–90, lifetime 1.2–2.6s, 35%–85% opacity.

## 8. World Camera / Follow Logic

`CameraSystem.update(ship, dt)`:
- Computes `speedRatio = |velocity| / MAX_SPEED`.
- `fovTarget = LERP(MIN_FOV, MAX_FOV, speedRatio)`.
- Back+Right+Up axes recomputed from ship quaternion each frame.
- Target camera pos = ship pos + up*FOLLOW_HEIGHT + back*(FOLLOW_DISTANCE * max(zoomFactor, 1)).
- Look target = ship pos + up*`-2.5` + back*`-14`; produces classic chase framing.
- Zoom is `FOLLOW_DISTANCE * zoomFactor` (handled only via external `camera:zoom` events).

## 9. Audio Architecture

`AudioSystem` uses Web Audio API lazy init on first user click/keydown:
- `masterGain = 0.3`, bus to destination.
- One long-running engine oscillator (sawtooth 55–180 Hz, bandpassed, gain 0.11–0.27 depending on thrust/speed).
- Laser: short sawtooth sweep 800→200 Hz with exponential decay.
- Explosion: ~0.5s buffer white noise, lowpassed at `800 * size`, gain decays exponentially.
- Collision: low-gain 0.4s lowpass noise burst with faster decay.
- Warning beeps: 3 × sine chirps at 800 Hz, 0.2s each, separated by 0.3s, cooldown 1.5s.
- Mute toggle stops engine/master gain instantly and emits `audio:mute`.

No music system; only SFX + engine drone.

## 10. Particle System Model

Two pools:
1. Exhaust: reusable `Points` instances with per-particle life/velocity. Each particle stores `_position/_velocity/_life/_maxLife`. Lifetime 0.3–0.7s, velocity damps 0.95 per step. Spawn rate scales with speed.
2. Explosions/sparks: `Points` created per event, stored in `_explosionPool`, iterated in reverse and removed when `allDead`.

Shaders included but largely unused in basic form; `ParticleSystem` uses `PointsMaterial`.

## 11. Post-Processing Pipeline (`PostProcessingSystem`)

Composer order:
1. `RenderPass`
2. `UnrealBloomPass` (base 0.7–1.35 strength depending on speed)
3. `ChromaticAberration` — conditional: disabled on `navigator.hardwareConcurrency <= 4`
4. `Vignette` — generic `ShaderPass`
5. `FilmGrain` — conditional, same low-end gate
6. `OutputPass` for tone mapping

Chromatic offset capped to `speedRatio * 0.012`.
Film grain time fed by `GameState.game.time`.

## 12. UI Behavior

- HUD divs are `pointer-events: none` overlay.
- `HUD.js` listens on `game:tick` for health bar, score, distance, low-health warning overlay.
- Low-health condition: `GameState.health <= Constants.HEALTH.WARNING_THRESHOLD=30`.
- Game-over overlay shown by `ScoreSystem.showGameOver()` or `HUD.showGameOver()` — both called from Game when `!isAlive`.
- Restart requires `KeyR` after death.

## 13. Edge Cases / Pitfalls

| ID | Description | Location | Mitigation idea |
|---|---|---|---|
| EC-01 | Audio autoplay policy blocks AudioContext creation until click/keydown | `AudioSystem.init` | Lazy creation already handled. |
| EC-02 | `Constants.INPUT.FORWARD = 'ShiftLeft'` but launcher says W | Input docs/code conflict | Unify in a single legend/source. |
| EC-03 | `GameState.removeProjectile(i)` is called with an already-spliced index | `WeaponSystem.update` → `GameState.removeProjectile(i)` | Should track last valid index or decouple indices. |
| EC-04 | Projectile collision skips instanced asteroids entirely | `PhysicsSystem.checkProjectileCollisions` | Opportunity: add per-instance collision proxy. |
| EC-05 | `Math.pow(0.01, dt)` camera damping needs extreme precision in `Game.CameraSystem` quasi-normalized lerp formula | `CameraSystem.update` | Could replace with a cleaner closed-form lerp. |
| EC-06 | Tab-out delta capped at 0.1s | `Game._animate` | Deliberate safety; can cascade slow-mo on return. |
| EC-07 | Ruins spawn with `visible=false` | `CollectibleSystem.spawnRuins` | Guarantees collectible spawn but ruins are effectively invisible in runtime. |
| EC-08 | `BuffSystem` is unused/not connected | `BuffSystem.js`, `GameState.buffs` exists but not populated and `Game._animate.buffs.update` uses system's own BuffSystem._activeBuffs map rather than GameState.buffs. | Duplicate buff ownership; cleanup required. |
| EC-09 | Restart re-reads `window.__game` not used elsewhere | — | No functional issue. |
| EC-10 | `Ship.DRAG = 0.97` is defined but never reused | `Constants.js` | Dead constant. |
| EC-11 | Mouse steer + wheel zoom referenced in README not implemented | README/HTML vs source | Confusing UX. |
| EC-12 | Partial HTML variants | `index.html`, `game.html`, `public/index.html`, `public/game.html` | Merge to one canonical build artifact. |
| EC-13 | `_projectileHitsProcessed` dedupe via string key `${projIdx}-${tgtIdx}` — fragile against array mutations across frames | `Game._animate` collision loop | Better: use UUID/projectile id. |
| EC-14 | Physics uses `normal.lengthSq() === 0` which tests subpixel collisions incorrectly because `THREE.Vector3` zero check is fine, but `velocity.lengthSq()` is recomputed only if zero; minor. | `PhysicsSystem.handleCollision` | Cosmetic. |
| EC-15 | `chunkManager.update` predicate: `shipPosition.y < 10` to bias Y spawn | `ChunkManager._updateChunks` | Hardcoded magic number. |

## 14. Cross-References

- Movement → `CameraSystem`, `PhysicsSystem` (`01_architecture.md §Module Dependency Map`).
- Biome rules → `BiomeGenerator`, `ChunkManager`, `Constants.BIOME.ZONES`.
- Combat/collisions → `PhysicsSystem`, `WeaponSystem`, `AsteroidField`, `ChunkManager.getCollidables`.
- Scoring → `ScoreSystem`, `GameState.combat`, `EventBus`, `localStorage`.
- Audio → `AudioSystem`, `Constants.AUDIO`.
- Post-FX → `PostProcessingSystem`, `Constants.POST_PROCESSING`.

---

*Next:* `03_style_and_design.md` covers aesthetic intent, visual language, and control feel.
