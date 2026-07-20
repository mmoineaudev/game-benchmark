---
name: space-exploration-threejs
description: |
  Detailed specification for a procedurally generated, visually deep
  browser-based space exploration game built with Three.js.
  Exploration and movement are the core loop; shooting is supportive.
triggers:
  - "space exploration game"
  - "threejs space game spec"
  - "procedural starfield game"
---

# Space Exploration Game — Technical Specification

> **Primary Loop:** Fly → Discover → Navigate → (optionally destroy debris) → Push further.
> **Shooting is supporting, not the focus.** Visual immersion is the main goal.

---

## 1. Project Setup & Verification

### 1.1 Prerequisites Checklist

| Item | Required Version | Verification Command |
|------|-----------------|---------------------|
| Node.js | ≥ 18.0.0 | `node --version` |
| npm | ≥ 9.0.0 | `npm --version` |
| uv (optional) | latest | `uv --version` |

### 1.2 Project Initialization

```bash
cd /home/neo/Documents/games-benchmarks
mkdir -p space-exploration && cd space-exploration
npm init -y
npm install three@0.165.0
npm install -D vite@5.4.0 @types/three@0.165.0
```

### 1.3 Vite Configuration (`vite.config.js`)

```js
import { defineConfig } from 'vite';
export default defineConfig({
  build: { target: 'es2020' },
  server: { open: true },
});
```

### 1.4 Entry Point (`index.html`)

Single-page HTML with a full-screen `<canvas>` container (`#game-container`).
No title screen — the game boots directly into the scene.

### 1.5 Acceptance Criteria — Setup

- [ ] `npm install` completes without errors or warnings.
- [ ] `npm run dev` launches a dev server on `localhost:5173`.
- [ ] `npm run build` succeeds with exit code 0.
- [ ] Opening `localhost:5173` shows a black screen (scene is wired but no objects yet). No console errors.

---

## 2. Project Structure

All paths are relative to project root.

```
space-exploration/
├── index.html
├── vite.config.js
├── package.json
├── public/
│   └── assets/
│       ├── audio/
│       │   ├── engine-rumble.ogg
│       │   ├── laser-shot.ogg
│       │   └── explosion.ogg
│       └── textures/
│           └── star-texture.png          # procedural canvas-generated fallback
├── src/
│   ├── main.js                           # Bootstraps Game, mounts canvas
│   ├── core/
│   │   ├── Game.js                       # Orchestrator: init, loop, shutdown, restart
│   │   ├── EventBus.js                   # Singleton pub/sub with domain:action events
│   │   ├── GameState.js                  # Centralized state: player, combat, game
│   │   └── Constants.js                  # All magic numbers, colors, timings, configs
│   ├── systems/
│   │   ├── InputSystem.js                # Keyboard + mouse/pointer mapping
│   │   ├── CameraSystem.js               # Follow-cam, damping, FOV speed effect
│   │   ├── PhysicsSystem.js              # Collision detection, bounding volumes
│   │   ├── AudioSystem.js                # Web Audio API wrapper, spatial audio
│   │   ├── ParticleSystem.js             # Pool-based particle manager (trails, explosions)
│   │   └── PostProcessingSystem.js       # UnrealBloomPass, chromatic aberration, vignette, film grain
│   ├── gameplay/
│   │   ├── PlayerShip.js                 # Ship mesh, movement logic, thrust, steering
│   │   ├── WeaponSystem.js               # Laser projectiles, firing rate, cooldown
│   │   ├── ScoreSystem.js                # Score tracking, high score persistence
│   │   └── BuffSystem.js                 # Time-based stat modifiers
│   ├── level/
│   │   ├── ChunkManager.js               # Chunk/segment spawn & cleanup for infinite world
│   │   ├── Starfield.js                  # Multi-layer parallax particle starfield
│   │   ├── NebulaSystem.js               # Volumetric-feel nebula clouds (custom shaders)
│   │   ├── AsteroidField.js              # Procedural asteroid generation (InstancedMesh)
│   │   ├── DebrisSystem.js               # Floating debris, destructible objects
│   │   └── BiomeGenerator.js             # Biome variant selection (open space, asteroid belts, nebula corridors, wormhole tunnels)
│   ├── ui/
│   │   ├── HUD.js                        # Score, distance, health overlay
│   │   └── Crosshair.js                  # Reticle for targeting
│   └── utils/
│       ├── MathHelpers.js                # Vector pooling, random helpers, seeded RNG
│       └── ShaderHelpers.js              # Common GLSL noise functions, gradient templates
```

### Architecture Principles (from game-architecture skill)

1. **Orchestrator Pattern** — `Game.js` initializes all systems, runs the main loop, manages flow. No self-initializing systems.
2. **Event-Driven** — No direct cross-module imports for communication. All messaging through `EventBus` with `domain:action` events.
3. **Centralized State** — `GameState` singleton holds everything. Systems read/modify through events.
4. **Configuration Centralization** — Every value in `Constants.js`. Zero hardcoded numbers in logic.
5. **Restart-Safe** — `GameState.reset()` provides a clean slate. All listeners removed in shutdown. Test: restart 3× identically.
6. **Delta-Time Normalized** — All movement uses `delta = Math.min(clock.getDelta(), 0.1)`. No frame-dependent logic.

---

## 3. Visual Effects Master Plan

### 3.1 Starfield (Multi-Layer Parallax)

| Layer | Technique | Visual Goal |
|-------|-----------|-------------|
| Far background | ~5,000 particles, tiny size, slow parallax, white-blue tint | Distant stars, depth anchor |
| Mid layer | ~2,000 particles, medium size, moderate parallax, slight color variation | Standard star field |
| Near layer | ~500 particles, large size, fast parallax, occasional twinkle (perlin noise alpha) | Immediacy, speed sensation |
| Bright stars | 20–50 special particles with bloom pass | Light sources, visual anchors |

**Implementation:** `THREE.Points` with custom `ShaderMaterial` (vertex + fragment). Use `InstancedBufferGeometry` or a single `BufferGeometry` with attribute-based size/color/alpha for a single draw call per layer.

### 3.2 Nebula Clouds (Volumetric Feel)

**Technique:** Billboarded sprite clusters with custom GLSL fragment shader.

- Procedural noise-based color gradients (fBm / Perlin noise in GLSL).
- Alpha blending with additive mixing for glow.
- 3–5 cloud clusters per chunk, each made of 8–12 overlapping billboards at varying scales.
- Colors shift based on biome: blues/purples in open space, reds/oranges in asteroid belts, multi-hue in wormhole tunnels.
- Subtle animation: uniforms `uTime` for slow drift and pulse.

**Shader Details:**
```glsl
// Fragment shader — volumetric nebula
precision mediump float;

uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uDensity;

// 3D simplex noise (compact implementation)
float snoise(vec3 v);

void main() {
    vec3 p = vUv * 3.0 + uTime * 0.05;
    float n = snoise(p) * 0.5 + 0.5;
    n = smoothstep(0.2, 0.9, n);
    n = pow(n, 1.5); // Sharpen clouds

    vec3 color = mix(uColor1, uColor2, n);
    color = mix(color, uColor3, snoise(p * 2.0 + uTime * 0.02) * 0.5 + 0.5);

    float alpha = n * uDensity;
    gl_FragColor = vec4(color, alpha);
}
```

### 3.3 Dynamic Lighting

| Light | Type | Purpose |
|-------|------|---------|
| Ambient | `AmbientLight` (very dim, 0.05 intensity) | Base visibility |
| Directional | `DirectionalLight` (from "sun" direction) | Shading on asteroids, shadows |
| Point lights | `PointLight[]` (glowing nebula cores) | Local illumination, color accents |
| Ship headlight | `SpotLight` (cone ahead of ship) | Illuminates path, reveals debris |
| Ship accent | `PointLight` (blue/purple under ship) | Rim glow, cinematic feel |

**Note:** Limit active `PointLight` count to ≤ 4 per chunk to maintain performance. Use `MeshStandardMaterial` or `MeshPhysicalMaterial` for PBR responses.

### 3.4 Post-Processing Pipeline

Render through `EffectComposer` with passes in this order:

1. **RenderPass** — Base scene render.
2. **UnrealBloomPass** — Bloom for stars, nebulae, engine exhaust, light sources.
   - Strength: 1.2–1.8
   - Radius: 0.4
   - Threshold: 0.15
3. **ChromaticAberrationPass** — Simulates lens aberration at high speed.
   - Offset scales with ship velocity (0 at rest, max at top speed).
4. **Vignette** — Subtle darkening of edges for cinematic framing.
   - Darkness: 0.5
   - Offset: 0.2
5. **FilmGrainPass** — Adds texture, reduces banding in gradients.
   - Intensity: 0.02–0.04

**Performance:** On low-end devices, skip chromatic aberration and film grain. Detect via `navigator.hardwareConcurrency` or renderer capability check.

### 3.5 Particle Systems

| System | Technique | Use Case |
|--------|-----------|----------|
| Ship exhaust trail | `THREE.Points` with velocity attribute, custom shader, pool of 200 particles | Continuous thrust visual |
| Engine flame | Cone geometry with `ShaderMaterial` (flickering noise animation) | Dynamic flame shape |
| Laser beams | Thin `CylinderGeometry` with `MeshBasicMaterial` + emissive + bloom | Projectile visual |
| Laser impact spark | Burst of 10–20 particles, fade out in 0.3s | Hit feedback |
| Destruction explosion | 40–80 particles, expanding sphere, color fade (yellow → red → black) | Asteroid/debris destruction |
| Debris fragments | Small `InstancedMesh` shards with physics, fade out | Destruction secondary visual |
| Wormhole distortion | Ring geometry with `ShaderMaterial` (time-based vertex displacement + color shift) | Biome transition marker |
| Cosmic dust | Sparse `THREE.Points` in wormhole tunnels, swirling motion | Tunnel atmosphere |

**Implementation:** Object pooling pattern. Pre-allocate particle pools. Reset particles to origin on reuse. Use `BufferAttribute` updates each frame (no `new THREE.Vector3()` in the loop).

### 3.6 Ship Visual Design

- Low-poly fighter aesthetic (procedural geometry, no external models needed).
- Body: elongated fuselage with swept wings and tail fins.
- Cockpit: small glass canopy with `MeshPhysicalMaterial` (transmission, roughness).
- Engine nacelles: glowing exhaust cones on each side.
- Wingtip lights: small emissive spheres (red/green).
- All materials use PBR (`MeshStandardMaterial` / `MeshPhysicalMaterial`).

### 3.7 Asteroid & Debris Generation

| Type | Geometry | Scale |
|------|----------|-------|
| Large asteroid | IcosahedronGeometry with vertex displacement (random noise) | 2–5 units |
| Medium asteroid | DodecahedronGeometry with vertex displacement | 0.8–2 units |
| Small rocks | OctahedronGeometry with vertex displacement | 0.2–0.8 units |
| Debris | BoxGeometry (random aspect ratios) | 0.05–0.3 units |
| Space junk | CylinderGeometry (broken, rotated) | 0.1–0.5 units |

**Vertex displacement:** Apply a simplex noise function to vertex positions in the vertex shader or during geometry creation. Use `InstancedMesh` for medium and small objects (thousands of instances, single draw call).

**Material:** `MeshStandardMaterial` with roughness 0.8–1.0, metalness 0.1–0.3, color variation per instance via `InstancedMesh.setColorAt()`.

### 3.8 Biome-Specific Visuals

| Biome | Visual Signature |
|-------|-----------------|
| Open space | Sparse stars, 1–2 small nebulae, low debris density, deep blue-black background |
| Asteroid belt | Dense asteroid field, warm-toned nebula, increased debris, orange/red ambient tint |
| Nebula corridor | Tight passage of billowing nebula clouds, reduced star visibility, multi-hue palette |
| Wormhole tunnel | Curved corridor geometry, swirling particle vortex, intense bloom, chromatic aberration at peak, purple/blue/cyan palette, speed distortion shader on tunnel walls |

### 3.9 Speed & Motion Effects

- **FOV breathing:** Camera FOV expands from 75° to 95° under full thrust, contracts when decelerating.
- **Star streaking:** Near-layer particle size increases with speed.
- **Motion blur:** Optional additive-blur post-pass (accumulation buffer). Toggle based on performance.
- **Camera shake:** Additive random offset to camera position, damped exponentially, triggered on:
  - Ship taking damage
  - Large explosion nearby
  - Burst of acceleration

### 3.10 Atmospheric Haze / Depth Cues

- `scene.fog = new THREE.FogExp2(0x000011, 0.008)` — exponential fog matching background color.
- Distant objects fade into fog color, creating natural depth cutoff.
- Nebula density increases slightly in fog to blend seamlessly.

---

## 4. Gameplay Systems

### 4.1 Player Ship

- **Movement:** WASD / arrow keys for translation. Mouse/pointer for roll/yaw (optional).
- **Inertia-based:** Ship has velocity vector. Input accelerates; no instant direction change.
- **Thrust:** Hold forward key → constant acceleration. Release → velocity decays (small drag).
- **Max speed:** Capped by `Constants.MAX_SHIP_SPEED`.
- **Roll:** Mouse X or Q/E key adds roll rotation (smoothly interpolated).

### 4.2 Weapon System

- **Fire mode:** Click / spacebar → single laser burst.
- **Fire rate:** Capped by `Constants.FIRE_RATE` (e.g., 8 shots/sec).
- **Projectile speed:** Fast, travels forward relative to ship heading.
- **Range:** Limited lifetime (e.g., 3 seconds) or distance (e.g., 200 units).
- **Destructible targets:** Only asteroids, rocks, and debris. Non-destructible obstacles.
- **Impact feedback:** Spark particles + sound + brief screen flash.

### 4.3 Procedural World Generation

**Chunk-based infinite world:**

```
Chunk size: 200 units wide × 200 units long
Spawn ahead: 3 chunks in front of ship
Cleanup behind: 2 chunks behind ship
```

**Per-chunk content:**
1. Starfield particles (full scene, not per-chunk).
2. Nebula cloud clusters (0–3 per chunk, based on biome).
3. Asteroid field (density × 5–50 asteroids).
4. Debris objects (density × 10–100 pieces).
5. Biome decorations (wormhole tunnel geometry, space stations, etc.).

**Seeded RNG:** Use a seeded PRNG (e.g., mulberry32) with chunk coordinates as seed. Same coordinates → same generation → deterministic exploration.

### 4.4 Biome Generation Logic

```
distanceTraveled → determine biome zone
zone 0–1000:   Open space
zone 1000–3000: Asteroid belt
zone 3000–5000: Nebula corridor
zone 5000–7000: Wormhole tunnel
zone 7000+:    Repeat with increasing intensity
```

Intensity scaling:
- Debris count × (1 + distance / 5000)
- Nebula density × (1 + distance / 8000)
- Asteroid speed × (1 + distance / 6000)

### 4.5 Score System

- **Asteroid destroyed:** 10 points × size tier
- **Debris destroyed:** 1 point
- **Distance traveled:** 1 point per 10 units
- **High score:** Persisted in `localStorage`.

### 4.6 Health System

- **Health:** 100 points.
- **Collision with large asteroid:** −20 health + screen shake + red flash.
- **Collision with small debris:** −5 health.
- **Health below 30:** Red vignette pulse, warning sound.
- **Health at 0:** Game over → restart prompt.

---

## 5. UI / HUD

### 5.1 HUD Overlay

All UI is an HTML/CSS overlay on top of the canvas (not 3D objects).

| Element | Position | Content |
|---------|----------|---------|
| Score | Top-left | `SCORE: 12,450` |
| Distance | Top-center | `DISTANCE: 3,200 units` |
| Health bar | Bottom-center | Horizontal bar (green → yellow → red) |
| Crosshair | Center | Subtle reticle (circle + 4 dots) |

### 5.2 Game Over Screen

Appears when health reaches 0. Shows:
- Final score
- Distance traveled
- High score
- "Press R to restart" prompt

---

## 6. Audio System

| Sound | Trigger | Technique |
|-------|---------|-----------|
| Engine rumble | Always (while flying) | Web Audio oscillator (low freq sawtooth + low-pass filter), volume scales with thrust |
| Laser shot | Fire event | Short noise burst + frequency sweep |
| Explosion | Destruction event | Noise burst, low-pass, 0.5s decay |
| Collision hit | Damage event | Low thud, 0.3s decay |
| Warning beep | Health < 30 | 800 Hz sine, 3 short pulses |

**Spatial audio:** Laser and explosion sounds pan based on direction from ship (optional, adds immersion).

---

## 7. Test Strategy

### 7.1 Unit Tests (Jest + Vite)

| Test File | Tests |
|-----------|-------|
| `GameState.test.js` | `reset()` clears all state; initial values are correct |
| `EventBus.test.js` | Events emit and receive; duplicate listeners prevented |
| `Constants.test.js` | All values are numbers or valid typed arrays; no NaN or Infinity |
| `MathHelpers.test.js` | Seeded RNG produces deterministic output; vector pooling works |
| `BuffSystem.test.js` | Buffs expire after duration; multipliers compose correctly |

### 7.2 Integration Tests (Playwright / Puppeteer)

| Test Scenario | Steps |
|---------------|-------|
| Game boots | Open page → scene renders → no console errors within 5s |
| Ship responds | Press W → ship moves forward (position changes) |
| Shooting works | Press space → laser projectile spawns → reaches range limit → despawns |
| Destructibles respond | Shoot asteroid → asteroid removed → particle explosion spawns → score increases |
| Restart works | Restart 3× → ship in same starting position → no memory growth (check heap snapshot) |
| Visual effects active | Bloom pass renders → bloom intensity > 0 in composer output |
| Performance | Run 60 seconds → FPS never drops below 30 (measure with performance API) |

### 7.3 Visual Acceptance Tests

| Criterion | Method |
|-----------|--------|
| Bloom is visible | Take screenshot → check that bright pixels have glow halos |
| Nebulae are visible | Render in a nebula biome → verify nebula billboards are in scene graph |
| Starfield has parallax | Move camera → far/mid/near layers move at different speeds |
| Post-processing chain | Render a white object → verify it has bloom + possible chromatic fringe |
| Fog exists | Render at distance → verify objects fade to fog color |
| No black screen | After boot → scene is not completely black (stars visible) |

### 7.4 Performance Benchmarks

| Metric | Target | Measurement |
|--------|--------|-------------|
| Frame rate | ≥ 60fps on mid-range GPU | `performance.now()` delta between frames |
| Draw calls | ≤ 50 in typical scene | `renderer.info.render.calls` |
| Triangles | ≤ 200K active | `renderer.info.render.triangles` |
| Memory growth | < 10MB over 5 minutes | Check `performance.memory` or DevTools |
| Load time | < 3 seconds to first frame | `performance.mark('boot')` to `performance.mark('firstFrame')` |

---

## 8. Acceptance Criteria (Agent Advancement Checklist)

An agent building this project should verify each criterion as it completes. Mark as done only when the criterion passes in a live browser.

### Phase 1 — Foundation

- [ ] **P1.1** Project initializes: `npm install` succeeds, `npm run dev` serves on port 5173, `npm run build` succeeds.
- [ ] **P1.2** Canvas renders: `index.html` contains a full-screen canvas, no console errors on load.
- [ ] **P1.3** Scene is black but valid: Scene, camera, and renderer are instantiated. Camera can see something (even if empty).
- [ ] **P1.4** Animation loop runs: `requestAnimationFrame` fires, `renderer.render()` executes, delta-time is measured.
- [ ] **P1.5** Resize handling: Window resize updates camera aspect and renderer size. DPR is clamped to 2.

### Phase 2 — Core Architecture

- [ ] **P2.1** `Game.js` orchestrator exists: Initializes all systems in order, runs the loop, handles shutdown.
- [ ] **P2.2** `EventBus` singleton works: Modules can emit and listen to events without importing each other.
- [ ] **P2.3** `GameState` singleton exists: Holds player, combat, and game state domains. `reset()` clears all state.
- [ ] **P2.4** `Constants.js` centralizes all values: No magic numbers in game logic files. Verified by grep for bare literals.
- [ ] **P2.5** Delta-time normalization: Movement uses `delta`, capped at 0.1s. Tab-out does not cause death spiral.

### Phase 3 — Ship & Controls

- [ ] **P3.1** Ship mesh exists: Visible in scene, has fuselage, wings, engines, and cockpit.
- [ ] **P3.2** WASD movement: Ship translates in the correct directions relative to heading.
- [ ] **P3.3** Inertia-based physics: Ship accelerates smoothly, does not instant-turn. Velocity decays when thrust released.
- [ ] **P3.4** Max speed cap: Ship cannot exceed `Constants.MAX_SHIP_SPEED`.
- [ ] **P3.5** Mouse/pointer roll: Ship rotates (rolls) smoothly in the direction of mouse movement.
- [ ] **P3.6** Camera follows ship: Camera tracks the ship with damping, maintains a cinematic offset.

### Phase 4 — Starfield & Environment

- [ ] **P4.1** Three-layer starfield: Far, mid, and near particle layers are visible and move at different parallax speeds.
- [ ] **P4.2** Star particles use custom shader: Single draw call per layer, alpha-based twinkle for near layer.
- [ ] **P4.3** Bright stars with bloom: At least 20 large star particles that glow via bloom pass.
- [ ] **P4.4** Fog is active: Distant objects fade to background color, creating depth cues.
- [ ] **P4.5** Background color: Scene background is dark (not pure black), e.g., `0x000011`.

### Phase 5 — Nebulae & Clouds

- [ ] **P5.1** Nebula billboards exist: At least 2 nebula clusters in the scene, each with 8–12 overlapping billboards.
- [ ] **P5.2** Custom GLSL nebula shader: Noise-based color gradients, animated over time, alpha blending.
- [ ] **P5.3** Biome color variation: Nebula colors differ between biomes (blue/purple in open space, red/orange in belts).
- [ ] **P5.4** Nebula density scales: Nebulae become denser as distance increases.

### Phase 6 — Asteroids & Debris

- [ ] **P6.1** Procedural asteroids: At least 20 asteroids in the scene, each with randomized vertex displacement.
- [ ] **P6.2** InstancedMesh usage: Medium and small objects use `InstancedMesh` (not individual meshes).
- [ ] **P6.3** PBR materials: Asteroids use `MeshStandardMaterial` with roughness > 0.5 and per-instance color variation.
- [ ] **P6.4** Debris objects: At least 10 small floating debris pieces with varied shapes and slow rotation.
- [ ] **P6.5** Lighting response: Asteroids show shading from the directional light and ship spotlight.

### Phase 7 — Shooting & Destruction

- [ ] **P7.1** Laser fires: Pressing fire key spawns a laser projectile that travels forward from the ship.
- [ ] **P7.2** Fire rate limiting: Projectiles spawn at most `Constants.FIRE_RATE` times per second.
- [ ] **P7.3** Laser visual: Projectiles are visible (glowing beam with emissive material + bloom).
- [ ] **P7.4** Destructible targets: Shooting an asteroid removes it from the scene.
- [ ] **P7.5** Explosion particles: Destroying an asteroid spawns 40–80 particles expanding outward with color fade.
- [ ] **P7.6** Impact feedback: Brief screen flash or camera shake on destruction.
- [ ] **P7.7** Score updates: Score increases when objects are destroyed. HUD reflects the change.
- [ ] **P7.8** Projectiles despawn: Projectiles are removed after reaching range limit or lifetime.

### Phase 8 — Post-Processing & Visual Polish

- [ ] **P8.1** Bloom is active: Bright objects (stars, engines, lasers) have visible glow halos.
- [ ] **P8.2** Bloom parameters are tuned: Strength 1.2–1.8, radius 0.4, threshold 0.15.
- [ ] **P8.3** Chromatic aberration: At high speed, bright edges show slight color separation.
- [ ] **P8.4** Vignette: Screen edges are subtly darkened.
- [ ] **P8.5** Film grain: Subtle noise texture visible in gradient areas (dark space).
- [ ] **P8.6** FOV speed effect: Camera FOV widens from 75° to 95° under full thrust.
- [ ] **P8.7** Ship exhaust trail: Visible particle trail behind the ship during thrust.
- [ ] **P8.8** Engine flame: Dynamic cone geometry at ship engines with flickering shader.

### Phase 9 — World Generation

- [ ] **P9.1** Chunk system: New chunks spawn ahead of the ship, old chunks are cleaned up behind.
- [ ] **P9.2** Seamless transitions: Chunk boundaries do not cause visible pops or gaps.
- [ ] **P9.3** Seeded randomness: Visiting the same chunk coordinates regenerates the same content.
- [ ] **P9.4** Biome variation: Different biomes have distinct visual signatures (density, colors, decorations).
- [ ] **P9.5** Infinite exploration: Ship can fly indefinitely without running out of environment.

### Phase 10 — Game Flow & Systems

- [ ] **P10.1** Health system: Ship takes damage on collision. Health bar reflects current value.
- [ ] **P10.2** Game over: At 0 health, game over screen appears with score and restart prompt.
- [ ] **P10.3** Restart works: Pressing restart resets everything cleanly (ship position, score, health, scene objects).
- [ ] **P10.4** Restart safety: Restarting 3× in a row produces identical results. No memory leaks.
- [ ] **P10.5** Score persistence: High score survives page reload (localStorage).

### Phase 11 — Audio

- [ ] **P11.1** Engine rumble: Low-frequency sound plays continuously while flying, volume scales with thrust.
- [ ] **P11.2** Laser sound: Distinct shooting sound on fire event.
- [ ] **P11.3** Explosion sound: Distinct destruction sound on asteroid removal.
- [ ] **P11.4** Warning beep: Audible alert when health drops below 30.
- [ ] **P11.5** Mute toggle: Space/M key mutes/unmutes all audio.

### Phase 12 — Performance & Polish

- [ ] **P12.1** 60fps target: Sustained ≥ 60fps on the developer's machine for 60 seconds of gameplay.
- [ ] **P12.2** Draw calls ≤ 50: Checked via `renderer.info.render.calls` during typical gameplay.
- [ ] **P12.3** Triangle count ≤ 200K: Checked via `renderer.info.render.triangles` during typical gameplay.
- [ ] **P12.4** No memory leaks: Heap snapshot after 5 minutes shows < 10MB growth.
- [ ] **P12.5** Mobile input: Touch controls work (virtual joystick or swipe-based).
- [ ] **P12.6** Responsive canvas: Window resize updates correctly without distortion.
- [ ] **P12.7** No console errors: Zero uncaught exceptions or warnings in the browser console.
- [ ] **P12.8** Build succeeds: `npm run build` produces a production bundle with no errors.
- [ ] **P12.9** Visual "wow" factor: The scene looks dense, layered, atmospheric, and alive. A casual observer remarks "this is impressive for a browser."

---

## 9. Visual Effects Implementation Priority

When building, follow this priority to get the "wow" factor fastest:

1. **Tier 1 (Core Visuals)** — Starfield, ship mesh, basic lighting, bloom post-processing. These give immediate visual impact.
2. **Tier 2 (Immersion)** — Nebula shaders, exhaust trail, engine flame, fog, ship spotlight. These create atmosphere.
3. **Tier 3 (Polish)** — Chromatic aberration, vignette, film grain, camera FOV effects, screen shake. These elevate quality.
4. **Tier 4 (Wow)** — Wormhole tunnel shader, particle vortex, dynamic god rays, volumetric light shafts, holographic UI elements, speed distortion effects. These are the "look at this" moments.

---

## 10. GLSL Reference Functions

### 10.1 3D Simplex Noise (Compact)

```glsl
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}
```

### 10.2 Fractal Brownian Motion (fBm)

```glsl
float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
        value += amplitude * snoise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}
```

---

## 11. Constants.js Template

```js
export const Constants = {
    // Game
    GAME_NAME: 'Void Drift',
    VERSION: '1.0.0',

    // Ship
    MAX_SHIP_SPEED: 80,
    SHIP_ACCELERATION: 40,
    SHIP_DRAG: 0.98,
    SHIP_ROLL_SPEED: 3.0,
    SHIP_BASIS: {
        position: { x: 0, y: 2, z: 0 },
        scale: 1.0,
    },

    // Camera
    CAMERA_DISTANCE: 12,
    CAMERA_HEIGHT: 5,
    CAMERA_FOV_REST: 75,
    CAMERA_FOV_MAX: 95,
    CAMERA_DAMPING: 0.05,

    // Weapon
    FIRE_RATE: 8,
    PROJECTILE_SPEED: 200,
    PROJECTILE_LIFETIME: 3.0,
    PROJECTILE_RANGE: 200,
    PROJECTILE_DAMAGE: 25,

    // Health
    MAX_HEALTH: 100,
    COLLISION_DAMAGE_LARGE: 20,
    COLLISION_DAMAGE_SMALL: 5,
    WARNING_HEALTH_THRESHOLD: 30,

    // World
    CHUNK_SIZE: 200,
    CHUNKS_AHEAD: 3,
    CHUNKS_BEHIND: 2,

    // Biomes
    BIOMES: {
        OPEN_SPACE:    { range: [0, 1000],  debrisDensity: 1.0,  nebulaCount: 2,  color: [0.1, 0.15, 0.3] },
        ASTEROID_BELT: { range: [1000, 3000], debrisDensity: 2.0, nebulaCount: 3, color: [0.4, 0.2, 0.1] },
        NEBULA_CORRIDOR: { range: [3000, 5000], debrisDensity: 1.5, nebulaCount: 6, color: [0.3, 0.15, 0.4] },
        WORMHOLE:      { range: [5000, 7000], debrisDensity: 3.0, nebulaCount: 8, color: [0.2, 0.1, 0.5] },
    },

    // Starfield
    STAR_LAYERS: {
        far:   { count: 5000, size: 0.5,  speed: 0.1,  color: [0.8, 0.85, 1.0] },
        mid:   { count: 2000, size: 1.0,  speed: 0.3,  color: [1.0, 0.95, 0.8] },
        near:  { count: 500,  size: 2.0,  speed: 0.8,  color: [1.0, 0.9, 0.7] },
    },

    // Post-processing
    BLOOM: {
        strength: 1.5,
        radius: 0.4,
        threshold: 0.15,
    },
    VIGNETTE: {
        darkness: 0.5,
        offset: 0.2,
    },
    FILM_GRAIN: {
        intensity: 0.03,
    },

    // Particles
    PARTICLE_POOLS: {
        exhaust:   { maxParticles: 200, lifetime: 0.8,  size: 0.3 },
        laserSpark:{ maxParticles: 50,  lifetime: 0.3,  size: 0.15 },
        explosion: { maxParticles: 80,  lifetime: 1.2,  size: 0.4 },
    },

    // Performance
    MAX_DRAW_CALLS: 50,
    MAX_TRIANGLES: 200000,
    MAX_INSTANCED_OBJECTS: 2000,
    DPR_MAX: 2,
};
```

---

## 12. EventBus Event Catalog

```js
export const Events = {
    // Game flow
    GAME_STARTED:       'game:started',
    GAME_PAUSED:        'game:paused',
    GAME_OVER:          'game:over',
    GAME_RESTART:       'game:restart',

    // Player
    PLAYER_THRUST:      'player:thrust',
    PLAYER_THRUST_END:  'player:thrust_end',
    PLAYER_ROLL_LEFT:   'player:roll_left',
    PLAYER_ROLL_RIGHT:  'player:roll_right',
    PLAYER_DAMAGED:     'player:damaged',
    PLAYER_DIED:        'player:died',
    PLAYER_HEALTH_CHANGED: 'player:health_changed',

    // Weapon
    WEAPON_FIRED:       'weapon:fired',
    WEAPON_HIT:         'weapon:hit',
    WEAPON_DESPAWNED:   'weapon:despawned',

    // Environment
    ASTEROID_DESTROYED: 'environment:asteroid_destroyed',
    DEBRIS_DESTROYED:   'environment:debris_destroyed',
    CHUNK_SPAWNED:      'environment:chunk_spawned',
    CHUNK_CLEANED:      'environment:chunk_cleaned',

    // Score
    SCORE_CHANGED:      'score:changed',
    HIGH_SCORE_SAVED:   'score:high_score_saved',

    // Audio
    AUDIO_PLAY:         'audio:play',
    AUDIO_STOP:         'audio:stop',
    AUDIO_MUTE:         'audio:mute',

    // Visual
    SCREEN_SHAKE:       'visual:shake',
    SCREEN_FLASH:       'visual:flash',
    WARNING_PULSE:      'visual:warning_pulse',
};
```

---

## 13. Build & Run Commands

```bash
# Development
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Lint (optional, add eslint)
npm run lint

# Test
npm test
```

---

## 14. Known Pitfalls & Solutions

| Pitfall | Solution |
|---------|----------|
| Memory leaks from undisposed geometries/materials | Always call `.dispose()` on geometries, materials, textures when removing objects. Implement a cleanup pass in `Game.shutdown()`. |
| GC stutters from creating objects in animation loop | Pre-allocate all vectors, matrices, and particle objects. Reuse via pooling. Never `new THREE.Vector3()` in the loop. |
| Too many draw calls | Use `InstancedMesh` for repeated objects (asteroids, debris, stars). Merge static geometries where possible. |
| Z-fighting with near plane too small | Use the largest `near` value possible (e.g., 0.1, not 0.001). Adjust `far` to cover the world. |
| Mobile black screen from highp precision | Use `precision mediump float` in shaders, wrap highp in `#ifdef GL_FRAGMENT_PRECISION_HIGH`. |
| WebGL context loss | Listen for `webglcontextlost` and `webglcontextrestored` events on the renderer canvas. Re-initialize resources on restore. |
| High-DPI blur | Set `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`. |
| Post-processing kills performance | Profile before and after each pass. Remove passes on low-end devices. Use `EffectComposer` efficiently. |
| Tab-out death spiral | Always cap delta at 0.1s: `delta = Math.min(clock.getDelta(), 0.1)`. |
| Stale event listeners on restart | Store unsubscribe functions from `eventBus.on()` and call them all in `shutdown()`. |

---

## 15. Stretch Goals (If Time/Performance Allows)

1. **Holographic UI elements** — Scanline-effect overlays on the HUD using a `ShaderMaterial` plane.
2. **Dynamic god rays** — Volumetric light shafts from nebula cores using a screen-space post-process.
3. **Speed distortion** — Vertex displacement shader on geometry near the ship when moving at high speed.
4. **Cosmic background radiation** — Subtle static/noise texture overlay for texture.
5. **Procedural music** — Web Audio API generative ambient soundscape that responds to biome and speed.
6. **Speed run leaderboard** — Web-compatible leaderboard for distance-based records.
7. **Photo mode** — Pause with free camera, screenshot capability.
8. **Shader-based wormhole vortex** — Full-screen post-process that distorts the scene into a tunnel effect during wormhole biomes.

---

*This specification is the source of truth for building the space exploration game. All visual, architectural, and gameplay decisions should reference back to these criteria.*
