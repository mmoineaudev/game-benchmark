# Space Explorer DSFlash — Init & Design Notes

> Source of truth: `~/Documents/prompt-library/space-exploration-threejs-spec.md` *(fully decided: free flight + comets + black holes + dead stars + decorative stations; zero open points)*
> Working directory: `~/Documents/games-benchmarks/space-exploration-procedural/space-explorer-dsflash/`
> Project name: **Void Drift** — Vite + Three.js 0.165, ES modules, zero external assets (procedural geometry, canvas textures, Web Audio synthesis).

**Game concept:** infinite free-flight exploration through procedurally generated space. Core loop = Fly → Discover → Navigate → (optionally destroy debris/comets) → Push further. Shooting is supportive; visual immersion is the goal. The ship has a **free 3D heading** (mouse yaw/pitch), full 6-axis feel: thrust, strafe, roll, and turn.

---

## 1. Entities

### 1.1 Player Ship (the fighter)
- **Look:** low-poly fighter — elongated fuselage, swept wings, tail fins; glass cockpit canopy (`MeshPhysicalMaterial`, transparent); two glowing engine nacelles with emissive exhaust cones; red (port) / green (starboard) wingtip lights; flickering engine flame (cone + noise shader); blue accent point light under the hull; PBR materials (roughness 0.8–1.0, metalness 0.1–0.3). Exhaust particle trail appears only while thrusting.
- **Interact:** **free flight** — **Z = dive, S = climb (keyboard pitch)**, Q/D = strafe (local X), A/E = roll, **mouse X = yaw, mouse Y = pitch** (pointer lock on canvas click — **confirmed**), **scroll wheel = throttle 0–100%** (forward velocity accelerates toward throttle × max speed; 0 = decelerate to stop), arrow keys alias Z/S/Q/D. Inertia physics (accel 40 u/s², lateral drift decay 0.98, max 80 u/s). Space / left-click = fire. 100 HP; **0.75 s invulnerability after any hit**; collision damage (20 large / 5 small+debris / 25 comet); red vignette + warning beep below 30 HP. Camera trails the heading but **does not inherit roll** (eases to world-up). Death → dissolve → death screen → R to restart.

### 1.2 Laser Projectiles
- **Look:** thin glowing beam (cylinder), emissive + bloom halo.
- **Interact:** fired by player, 8 shots/s max, travels along ship heading at 200 u/s, lifetime 3 s **or** 200 u range (whichever first), 25 damage per hit. On impact: spark particles + screen flash + explosion sound. Swallowed silently by black hole event horizons; sparks harmlessly off dead stars and station hulls.

### 1.3 Asteroids (3 tiers)
| Tier | Shape | Size | Rendering | HP | Collision dmg | Score |
|------|-------|------|-----------|-----|---------------|-------|
| Large | Icosahedron + noise displacement | 2–5 u | individual mesh | 100 (4 shots) | 20 | 30 |
| Medium | Dodecahedron + displacement | 0.8–2 u | InstancedMesh | 50 (2 shots) | 5 | 20 |
| Small | Octahedron + displacement | 0.2–0.8 u | InstancedMesh | 25 (1 shot) | 5 | 10 |

- **Look:** grey-brown PBR rock, per-instance color variation, slow tumble + drift (1–4 u/s, scales with distance); lit by directional light and ship headlight (and red-tinted near dead stars).
- **Interact:** shoot to destroy (explosion, screen shake, score); collide → ship takes damage + shake + red flash. **Attracted by black holes** — within 150 u they accelerate toward the hole (`a = 2500/d²`, capped 120 u/s²); at 8 u they're consumed. Spawn density per biome, seeded per chunk, deterministic.

### 1.4 Debris & Space Junk
- **Look:** tiny random-aspect boxes (0.05–0.3 u) and broken/rotated cylinders (0.1–0.5 u), instanced. One entity class, two visual variants.
- **Interact:** 1 score point, one-shot kill (25 HP), 5 collision damage. Also pulled into black holes. Count per chunk = `round(asteroidDensity × 0.4)`, seeded.

### 1.5 Comets
- **Look:** big icy/rocky bodies, **3–6 u** — displaced icosahedron nucleus with ice-blue/rocky PBR and faint bluish emissive tint, soft pale-cyan coma billboard (2.5× nucleus), **dust tail** (800-particle shared pool, 4 s fade), **electric-blue ion tail** (stretched sprite along velocity), and a **dark smoke trail** (300 shared sprites, 6 s fade, expanding). Slow tumble.
- **Interact:** fly at a **moderate 15–30 u/s** in a mostly straight line with a slight sine curve (amplitude 10 u, wavelength 150 u). **Shootable**: 150 HP (6 shots), score 100, big explosion + shake. **Collision**: 25 damage to the ship. **Gravity**: path bends toward black holes, can be consumed. Pass through asteroids. Spawn per chunk at `cometDensity` (3/6/8/10), **≥ 150 u from the ship**.

### 1.6 Black Holes
- **Look:** pure-black event-horizon sphere (8 u radius, renders black under all light), thin emissive orange-white **photon ring** with bloom, rotating **accretion disk** (ring shader: radial falloff, Doppler beaming, white→yellow→orange). Brief radial flash when something gets eaten.
- **Interact:**
  - **Gravity:** asteroids, comets, debris within 150 u accelerate toward the center with `a = 2500 / d²` (capped 120 u/s²) — **pull grows as you get closer**.
  - **Ship:** pulled at **0.5×** strength (**confirmed**) — escapable with thrust. Pulsing red **"⚠ EVENT HORIZON"** warning within 40 u of the horizon surface.
  - **Consumption:** anything touching the horizon (8 u) disappears with a flash + low descending sweep sound — asteroids, comets, debris, projectiles… and the ship (instant death, bypasses invulnerability).
  - **Not destroyable**, no score. Spawn: never in Open Space/Asteroid Belt; 4% of chunks in Nebula Corridor, 8% in Wormhole.

### 1.7 Dead Stars
- **Look:** enormous dark-red spheres, **25–45 u radius** — deep red-black PBR surface with patchy **hot cracks** (canvas emissive map), **pulsing ember glow** (emissive intensity 0.4–1.2 via noise), a **6× glow sprite** (additive, `fog: false` — visible from afar) and a **red point light** (intensity 3, range 600) that tints nearby asteroids. Faint ember sparks drift off the surface.
- **Interact:**
  - **Visible from afar** — spot them several chunks away and steer around.
  - **Landmark only:** no gravity, indestructible, no score; lasers spark harmlessly.
  - **Collision: instant death** (**confirmed**) — "VAPORIZED BY A DEAD STAR", bypasses invulnerability.
  - **Warning:** pulsing red **"⚠ STELLAR REMNANT"** within 60 u of the surface.
  - **Spawn:** 1/2/3/4% per chunk by biome, max 1 per chunk, ≥ 1500 u apart, **≥ 400 u from the ship**.

### 1.8 Nebula Clouds
- **Look:** 8–12 overlapping billboards per cluster, custom GLSL fragment shader (3D simplex noise), slow drift + pulse via `uTime`, biome-colored palettes, core point light (0.8–1.5, ≤4 per chunk). `nebulaCount` clusters per chunk (2/3/6/8 by biome).
- **Interact:** none — fly straight through. Pure atmosphere and light source.

### 1.9 Wormhole Tunnel (WORMHOLE biome only, 5000–7000 u)
- **Look:** `TubeGeometry` along a curved CatmullRom path, swirling UV-distortion shader walls, 200+ particle vortex, purple/blue/cyan, intense bloom.
- **Interact: pass-through walls** (**confirmed**): flying inside the wall shell (40–65 u from centerline) triggers the **WormholeBlurPass** — heavy gaussian blur + UV distortion + chromatic fringe, intensity ramps with penetration, fades 0.5 s after exiting. **No damage, no slowdown** — the opening is the comfortable path; cutting through a wall is the shortcut with a visual cost.

### 1.10 Space Stations — decorative (**confirmed**)
- **Look:** procedural station — central cylindrical hull (12–20 u long), torus ring around the middle, emissive window bands, slow rotation, blinking beacon light. Grey/blue PBR.
- **Interact:** decorative and non-destructible — no score, lasers spark off the hull, collision = 20 dmg (solid). Spawn 2/3/4% per chunk (Asteroid Belt onward), max 1 per chunk, ≥ 300 u from ship.
- **Future-proofing:** standalone entities with stable IDs in a world registry, kept out of the chunk-cleanup path, data-modeled — a later version may add real functionality (landing, trading, refuel).

### 1.11 Starfield (background)
- **Look:** 3 parallax `Points` layers — far (5,000 × 0.5 u, blue-white), mid (2,000 × 1.0 u, warm), near (500 × 2.0 u, warm, noise twinkle) — plus 30 bright stars with bloom. Custom shader, one draw call per layer, **`fog: false`**.
- **Interact:** none — depth and speed anchor.

### 1.12 Particle Systems (feedback layer)
- Exhaust (200, 0.8 s), engine flame (cone, flicker), laser sparks (50, 0.3 s), explosion (80, 1.2 s, yellow→red→black), debris fragments (100 shards, 2 s), comet dust (800, shared) + smoke (300, shared), dead-star embers (100, 2 s). Pooled, zero allocations in the loop. No player interaction.

### 1.13 Lighting Rig
- Ambient 0.05 + directional 0.3 + nebula point lights + dead star red point lights (range 600, ≤8 active total) + ship headlight spotlight (range 30) + ship accent light (blue/purple rim glow).

### 1.14 HUD / UI (DOM overlay)
- Score (top-left), distance odometer (top-center), health bar (bottom-center), crosshair (center), biome indicator (top-right), thrust bar (bottom-left), **event horizon** + **stellar remnant** warnings (center-bottom, pulsing red), mute icon. Death screen title by cause: "SHIP DESTROYED" / "CONSUMED BY A BLACK HOLE" / "VAPORIZED BY A DEAD STAR" — all with score/distance/high score + "Press R to restart".

### 1.15 Biomes (world regions)
| Biome | Distance (u) | Asteroids | Nebulae | Comets | Black holes | Dead stars | Stations | Colors |
|-------|-------------|-----------|---------|--------|-------------|------------|----------|--------|
| Open Space | 0–1000 | 10/chunk | 2 | 3/chunk | 0 | 1%/chunk | 0 | blue-black |
| Asteroid Belt | 1000–3000 | 40/chunk | 3 | 6/chunk | 0 | 2%/chunk | 2%/chunk | orange/red |
| Nebula Corridor | 3000–5000 | 20/chunk | 6 | 8/chunk | 4%/chunk | 3%/chunk | 3%/chunk | multi-hue |
| Wormhole | 5000–7000 | 60/chunk | 8 | 10/chunk | 8%/chunk | 4%/chunk | 4%/chunk | purple/blue/cyan |
| 7000+ | cycle repeats, ×1.5 intensity | | | | | | | |

---

## 2. Decisions — all closed

All previously open points are now decided. Your answers are baked in; the spec has zero TBDs.

| # | Topic | Decision |
|---|-------|----------|
| 1 | Space stations | **Keep as decorative** — hull + ring + windows + beacon, non-destructible, 20 dmg collision, no score. Standalone entities with stable IDs in a world registry so they can gain real functionality (landing/trading) later. Spec §6.9, Phase 15. |
| 2 | Wormhole walls | **Pass-through + blur** — WormholeBlurPass (blur + UV distortion + chromatic fringe) ramps with wall penetration, fades 0.5 s after exit. No damage, no slowdown. Spec §6.3, §5.4 step 6, P9.6. |
| 3 | Pointer lock | **Click to lock** — mouse = yaw/pitch + click fires; Esc unlocks AND pauses; second Esc resumes. |
| 4 | Black hole ship pull | **0.5×** — escapable hazard; touching horizon = instant death. |
| 5 | Dead star collision | **Instant death** — bypasses the 0.75 s invulnerability window. |

Also baked in from the review: asteroid HP (100/50/25), drift 1–4 u/s, debris ×0.4, invulnerability 0.75 s, nebula `nebulaCount` authoritative, comet sine curve (10 u / 150 u), odometer distance, ±60 u Y band, spawn fairness guards (comet ≥150 u, dead star ≥400 u, station ≥300 u), `fog: false` on starfield + dead star glow, camera never inherits roll, wormhole/station constants, `STATION_SPAWNED` event, death screen titles by cause.

---

## 3. Architecture Notes (non-negotiable per spec)

- Orchestrator `Game.js`; all communication via `EventBus` (catalog in spec §11); `GameState` singleton with `reset()`; every number in `Constants.js` (zero magic numbers in logic).
- Event namespaces: `game:*`, `player:*` (died reasons: `collision` | `black_hole` | `dead_star`), `weapon:*`, `environment:*` (incl. `cometDestroyed`, `objectConsumed`, `blackHoleSpawned`, `deadStarSpawned`, `stationSpawned`), `score:*`, `audio:*`, `visual:*`.
- Chunked infinite world: 200 u chunks, 3 ahead / 2 behind, mulberry32 seeded by chunk coords → deterministic regeneration; biome distance = monotonic odometer; content in ±60 u Y band. Stations live in a persistent world registry (not chunk-owned).
- Gravity (black holes): cap iterations (~32 bodies/frame), squared distances, skip beyond 150 u, cap acceleration at 120 u/s².
- Post-processing: RenderPass → UnrealBloom (1.5 / 0.4 / 0.15) → chromatic aberration (speed-scaled) → vignette → film grain → **WormholeBlurPass (only while inside a wall shell)**; CA + grain skipped when `hardwareConcurrency < 4`.
- Dynamic lights: dead star + nebula point lights only, cull by range, ≤8 active.
- Delta-time capped at 0.1 s; `setPixelRatio(min(dpr, 2))`; `near=0.1`; dispose everything on cleanup (restart-safe, tested 3×).
- Performance targets: ≤50 draw calls, ≤200K triangles, ≥60 fps (min 30), <10 MB memory growth over 5 min.
- **Environment quirk:** global npm sets `omit=dev` → use `npm install --include=dev` or vite won't install.

---

**Implementation-ready.** Next step: scaffold the Vite + Three.js project in `space-explorer-dsflash/` and start Phase 1 (foundation) → Phase 13–15 (comets, black holes, dead stars, stations).
