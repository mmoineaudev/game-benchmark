# 04 — Prioritized Implementation Plan & God-Tier Enhancement Opportunities

> Concrete build order, refactoring tasks, bug priorities, and vision-grade enhancements.  
> Uses spec anchors:
> - `[Spec:01-§n]` technical architecture section
> - `[Spec:02-UC:n]` functional use-case section
> - `[Spec:03-§n]` visual/design section
> - `[Spec:04-Pn.X]` current document task IDs

---

## 4.1 Execution-Order Dependency Map [Spec:01-§1.2]

The game is runnable today because it is already integrated in `main.js` → `Game.init()`. However, several architectural dependencies are inverted or incomplete. The correct build order for a healthy iterate is:

```
Step 1 — Strap tests around GameState + EventBus   [Spec:01-§1.3]
Step 2 — Fix physics stability + collision bugs    [Spec:01-§1.6, Spec:02-UC-09..14]
Step 3 — Refactor Game orchestrator (single ticket means every change is high-risk)
Step 4 — Introduce proper systems tick manager       [Spec:01-§1.4, Spec:04-P4.1]
Step 5 — Move HUD out of imperative JS into reactive  [Spec:03-§3.3]
Step 6 — Wire BuffSystem into actual gameplay        [Spec:02-UC-34]
Step 7 — Add missing input paths (mouse, gamepad)
Step 8 — Biome polish (audio shift, biome-specific FX) [Spec:03-§3.8]
Step 9 — Polish shaders, add LOD/occlusion
Step 10 — Ship variety, objectives, meta-progression  [Spec:04-4.4, ref P10]
```

---

## 4.2 Bug-Fix Sprint (P0 — ship-blocking) [Spec:04-P2.x]

### P2.1 Fix Projectile-Splice Collision Deduplication Bug
- **File:** `src/core/Game.js:258-289` (`_projectileHitsProcessed`)
- **Problem:** After `proj.mesh` removal + `_projectiles.splice(i,1)` between loop iterations, stored `projectileIndex` keys in the Set become stale, causing both missed hits and double-count possibilities on multihit frames.
- **Fix:** Use `projectile.uuid` or a fire-time monotonic ID instead of array index.
- **Spec anchor:** [Spec:01-§1.6.3], [Spec:02-§2.4.3].
- **Effort:** < 30 min.

### P2.2 Fix Restart `EventBus` Subscription Leak
- **File:** `src/core/Game.js:366-371`
- **Problem:** `_restart()` unsubscribes all listeners via `_unsubscribers.forEach(unsub)` and re-registers. However, `GameState` and `ScoreSystem` internal EventBus subscriptions are created on `init()` but not recreated until `new` constructs them once.
  - `ScoreSystem.init()` registers `'game:gameover'` once on construction. Restart reuses the same object but ≠ reseats listeners cleanly for *cumulative* subscriptions if `ScoreSystem` were multi-inited.
- **Fix:** Move listener registration out of `init()` into a bound `subscribe()` called after each cleanup; or turn subsystems into recreateable singletons.
- **Spec anchor:** [Spec:01-§1.4.1], [Spec:02-UC-03].

### P2.3 Reduce Particle Memory Leak on Restarts
- **File:** `src/systems/ParticleSystem.js:229-243`
- **Problem:** `destroy()` disposes but doesn't clear `this._explosionPool` or cloned geometries/materials from every explosion subclass.
- **Fix:** After scene removal, splice pool and null references.

### P2.4 ChunkManager Traverses Scene on Every Restart
- **File:** `src/level/ChunkManager.js:291-307` (`_clearAllChunks` fallback path).
- **Problem:** `scene.traverse` on 1000+ chunk objects per restart is O(N); could stall frame.
- **Fix:** Keep authoritative registry of `isChunkObject` instances per manager and skip scene traversal.

---

## 4.3 Geometry / Material / Memory Tasklist (P1) [Spec:04-P3.x]

### P3.1 Shared Geometry for Projectiles and Pickups
- **File:** `src/gameplay/WeaponSystem.js:10-17`
- **Change:** Laser geo already shared. Reuse for crystals/debris: one `CylinderGeometry`, one `OctahedronGeometry`, one `IcosahedronGeometry` per app lifetime.
- **Spec anchor:** [Spec:01-§1.8.2], [Spec:03-§3.7].

### P3.2 Dispose Hidden Reactor Glow / Tail-Light Materials on Ship Destroy
- **File:** `src/gameplay/PlayerShip.js:293-304`
- **Change:** Add explicit dispose/clear of `_reactorGlows`, `_engineFlames`, `_tailLights`.

### P3.3 Planet Atmosphere Disposal Race
- **File:** `src/level/PlanetManager.js:148-158`
- **Change:** `atmo` and `mesh` are both removed/disposed. Ensure `disposeChildren` iterates all children of atmosphere mesh if nested.

### P3.4 Restart Fragmentation Cleanup
- **File:** `src/core/Game.js:342-374`
- **Change:** Consolidate subsystem-teardown order in a `teardown()` vs `disposeScene()` separation so no stale references survive.

### P3.5 Starfield Parallax Precision
- **File:** `src/level/Starfield.js:89-98`
- **Current:** `uCameraOffset.value.copy(shipPosition)`. Camera position diverges from ship position due to lerp damping; parallax should ideally mirror ship-space offset rather than raw position.
- **Change:** Pass camera.position or last known ship-space relative vector.

---

## 4.4 God-Tier Enhancement Opportunities (P10) [Spec:04-P10.x]

> These are not bug fixes but product-direction jumps.  
> Ordered by gameplay contrast *per unit implementation effort*.

### P10.1 Contract Mouse-Driven Flight + Cursor Steering
- **Current state:** README promises mouse control; no pointer-lock code exists [Spec:03-§3.10].
- **Why god tier:** Mouse flight fundamentally changes "feel" from arcade-keys to "flight sim lite" — dramatically widens audience without altering visuals.
- **Impl tasks:**
  1. Pointer Lock API wrapper in InputSystem.
  2. Map `movementX/Y` to yaw/pitch delta with configurable sensitivity.
  3. Add ship roll implicit to yaw (RMS-tilt) for motion smear aesthetic.
  4. Keep arrow key fallback for accessibility.
- **Spec anchor:** [Spec:03-§3.10].

### P10.2 Ship Class System (3 Archetypes)
- **Current state:** Single `PlayerShip` with fixed constants [Spec:01-§1.8.1].
- **Concept:** Swap mesh+hitbox+feel bundles between:
  1. *Scout* — fast, small hitbox, fast fire, low DPS.
  2. *Frigate* — slow, big, wide weapon spread, tank.
  3. *Drifter* — balanced, passive cargo pickups for score.
- **Implementation:**
  - Extract `PlayerShipConstants` template per class.
  - Add hangar / selection screen in `index.html`.
  - Emit `player:class_selected` event for `GameState` to load template.
- **Risk/effort:** Moderate.

### P10.3 Mission & Narrative Beacons
- **Current state:** No goal beyond distance [Spec:02-§2.3.5].
- **Concept:** Distress beacons from smaller asteroids; NPC ships offer "escort" contracts; artifacts spawn on planets and unlock lore tiles.
- **Impl tasks:**
  1. Add `MissionSystem` module in `src/gameplay/`.
  2. Chunk injection of beacon meshes by biome (green tilted beacon).
  3. Interaction on proximity — `EventBus.emit('mission:accept')`.
  4. Rewards: ship component unlocks, temporary shield boost, title fragments.
- **Spec anchor:** [Spec:02-UC-16], [Spec:02-UC-17].
- **Risk/effort:** High, but visually cheap per-using existing beacon mesh variants.

### P10.4 Planet Landing + Surface Gameplay
- **Current state:** Planets are decorative landmarks at scales 6–84u radius, ocean-like environment shell [Spec:01-§1.8].
- **Concept:** When speed → 0 and facing a planet within radius, trigger "orbit descent". Switch scene to low-altitude surface terrain streamer.
- **Impl tasks:**
  1. Add collision flag `canDock` to PlanetManager's generated meshes.
  2. Camera transition: lock-to-surface mode in `CameraSystem`.
  3. Splash to new biome-matching ground texture; rock equivalents.
- **Risk/effort:** High.

### P10.5 Low-End Profile + Settings Screen
- **Current state:** Adaptive bypasses CA/FG on ≤4 threads but still renders Bloom+Output [Spec:01-§1.10].
- **Concept:** Two presets: Performance (720p, no bloom, no film grain, no CA, VFX slimmed) vs Quality (native res, all passes).
- **Impl tasks:**
  1. Add `GraphicSettings` module + dropdown rendered in HUD.
  2. Bind `PostProcessingSystem` composer pass toggles.
  3. Persist choice to `localStorage`.
- **Spec anchor:** [Spec:01-§1.10], [Spec:03-§3.12].

### P10.6 NPC Combat Ecology
- **Current state:** NPCs wander without aggression; they cannot collide with the player due to missing `boundingSphere` [Spec:02-§2.4.3].
- **Concept:** NPC engagement states — Outpost, Escort, Pirate. Pirates fire back, Citizens send distress messages.
- **Impl tasks:**
  1. Add `boundingSphere` to each NPC spawn; enable collision in Physics.
  2. Hard-point attachments for weapons (NPC lasers).
  3. Faction coloring + engagement distance thresholding.
- **Spec anchor:** [Spec:01-§1.6.1], [Spec:02-UC-36].

### P10.7 Weapon Plug-in System
- **Current state:** Single laser type; fire rate, speed, color hardcoded in Constants [Spec:01-§1.11].
- **Concept:** Drop-in weapon modules: Pulse (multishot burst), Rail (slow, piercing), Flak (AoE). Each with unique `WeaponBehavior` class implementing `fire()`/`update()`/`applyParams()`.
- **Spec anchor:** [Spec:01-§1.11].

### P10.8 Audio Spatialization + Music Stems
- **Current state:** Web Audio graph is non-spatial [Spec:01-§1.9].
- **Concept:** Add `PannerNode` per sound source with position updates relative to camera. Music stems cross-fade with biome zones — ambient drone for Open Space, tension build for Asteroid Belt, shimmer for Nebula, "wormhole sweep" for Tunnel.
- **Risk/effort:** Medium.

### P10.9 Buff System Activation
- **Current state:** `BuffSystem` scaffold is unused [Spec:02-UC-34].
- **Concept:** Crystal variants → temporary buffs (Speed Boost +25%, Shield Bubble 30 HP, Weapon Rapidfire +50%). Wire to `Entity.collectible` logic in `CollectibleSystem` and feed into `GameState.buffs[]`.
- **Spec anchor:** [Spec:02-UC-15].

### P10.10 Infinite-Stat Progression & Meta-Loop
- **Current state:** Single-run score, no skill tree.
- **Concept:** After each run, spend earned "warp fragments" (auto-converted) on permanent stats: hull capacity, fire rate, engine acceleration, score multiplier.
- **Branching decisions → replay pressure** = the difference between arcade toy and game-as-a-service (but offline).

---

## 4.5 Refactoring Roadmap (P1–P4 Cross-Cutting) [Spec:04-P4.x]

### P4.1 Introduce Systems Tick Manager [Spec:01-§1.4, Spec:01-§1.4.1]
- **Current problem:** `Game._animate()` is a flat 150-line monolithically ordered sequence [Spec:01-§1.2.2].
- **Goal:** A topologically sorted dependency list so adding systems (audio tweaks, trail logic) doesn't require editing `Game`.
- **Pattern:**
```
class SystemsTick {
  constructor() { this.systems = []; }
  register(sys, deps=[]) { ... }
  tick(dt) { ...topological sort... }
}
```
- **Spec anchor:** [Spec:04-P4.1].

### P4.2 Dedicated Collision Broad-phase [Spec:01-§1.6]
- Current collision is O(Asteroids × Projectiles + Targets × Ship). In dense chunks, cost approaches O(N) per frame for 100+ destructibles × 20+ projectiles.
- **Fix:** Two-layer broad phase:
  1. Grid voxel over ship-local area (e.g., 60u cells).
  2. Narrow-phase sphere-sphere only inside same/adjacent voxel.

### P4.3 Decouple HUD from JS Mutation [Spec:03-§3.3]
- HUD currently uses direct `element.textContent = ...` on each tick. Move to an observer pattern or proxy from GameState so React/vanilla cleanliness is possible and DOM reads/writes are batched.
- Not critical for perf but enables future UI refactors.

### P4.4 Replace Magic Numbers with Named Constants [Spec:01-§1.11]
- Many numbers live inline: `0.95` drag, `0.7` friction, `3.5` push, `25` planet spacing, `1.4` speed ratio factor.
- Migrate ALL inline values to `Constants.SHIP`, `Constants.PHYSICS`, `Constants.PARTICLE` groups.

### P4.5 Ship-Mesh Build-Time Separation
- Current `PlayerShip._createShipMesh()` is God-method with ~15 sub-primitives.
- **Refactor:** Split into `buildBody()`, `buildCockpit()`, `buildWings()`, `buildEmitters()`. Each returns a Group or primitives array; constructor composes. Enables future ship swap and blueprint loaders.

### P4.6 Replace Float32 Splicing in Particle Pool
- `ParticleSystem.js` allocates/frees Float32Arrays live in `createExplosion`. Switch to a pooled ring buffer with explicit heads/tails to avoid GC spikes.

---

## 4.6 Testing Strategy Recommendations [Spec:04-P4.6]

| Layer | Scope | Tooling |
|-------|-------|---------|
| GameState | `takeDamage`, `addScore`, `restart`, buff expiration | Vitest + tiny-dom |
| PhysicsSystem | sphere-sphere collision with mock meshes | Vitest + Three.mock |
| ChunkManager | world determinism, chunk bounds | run seed through `mulberry32` and assert positions |
| BiomeGenerator | getCurrentBiome wraparound | simple unit table |
| InputSystem | key state tables | simulate KeyboardEvent dispatches |
| Integration | loop tick correctness (delta, distance) | Playwright + vitest |

- No unit tests exist today; a solid unit-test pass over `GameState` and `PhysicsSystem` would prevent 80% of future regressions.

---

## 4.7 Acceptance Gates (Definition of Done) [Spec:04-4.7]

Feature marked done when:
1. Deterministic content regression passes (`same chunk coords == same obj count + shape`).
2. Full restart 3× in a row with zero webgl context lost warnings in console.
3. `localStorage` high-score survives a reload and progresses correctly after a new high score.
4. 2 minutes of idle flight in Open Space maintains ≥ 58 fps on mid-tier hardware (perf.now delta caps).
5. In-game HUD menu / brief instructions for every input control actually wired (no README/UI drift).
6. Accessibility checklist: keyboard-only completion, no color-only game state indicators (audio cues already exist).

---

## 4.8 God-Tier vs. Maintenance — Decision Matrix [Spec:04-4.8]

| Effort | Gameplay Impact | Recommended Level | Comments |
|---------|--------------|------------------|---------|
| P2.1-P2.4 (30-120 min each) | High (stability) | **Do this sprint** | Unblock future work |
| P3.x (1-2 h each) | Medium (memory headroom) | **Do this sprint** | Cleaner multi-session support |
| P4.1-P4.6 (half day – 2 days) | High (dev velocity) | **Next** | Enables all other work |
| P10.1 (half day) | High (audience expand) | **Next** | Salesy but cheap |
| P10.2, P10.3, P10.8 (2-3 days each) | Very High | **V2 targets** | Plan, scope, implement |
| P10.4, P10.6, P10.7 (3-5 days each) | High (depth) | **Post-launch** | Need content pipeline |
| P10.5, P10.9 (1 day each) | Medium | **V1 polish** | Quality-of-life |
| P10.10 (1-2 days) | Retention | **Post V1** | Meta-loop design work |
