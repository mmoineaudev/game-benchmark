# Space Explorer DSFlash — Init & Design Notes

> Source of truth: **`docs/SPEC.md`** — *"Void Drift — Deep Space Expedition (Biome Ladder) & Remaster"* (v2.0: 9-rung ladder + Deep Voids + Spatial Graveyard finale at 35,000 u + ship/VFX/lighting remaster; zero open points). Supersedes the original `~/Documents/prompt-library/space-exploration-threejs-spec.md` for biome/world/visual sections; the original stays authoritative for everything not contradicted.
> Working directory: `~/Documents/games-benchmarks/space-exploration-procedural/space-explorer-dsflash/`
> Project name: **Void Drift** — Vite + Three.js 0.165, ES modules, zero external assets (procedural geometry, canvas textures, Web Audio synthesis).

**Game concept:** infinite free-flight exploration through procedurally generated space. Core loop = Fly → Discover → Navigate → (optionally destroy debris/comets) → Push further. Shooting is supportive; visual immersion is the goal. The ship has a **free 3D heading** (mouse yaw/pitch), full 6-axis feel: thrust, strafe, roll, and turn.

---

## 1. Entities

### 1.1 Player Ship (the fighter)
- **Look:** low-poly fighter — elongated fuselage, swept wings, tail fins; glass cockpit canopy (`MeshPhysicalMaterial`, transparent); two glowing engine nacelles with emissive exhaust cones; red (port) / green (starboard) wingtip lights; flickering engine flame (cone + noise shader); blue accent point light under the hull; PBR materials (roughness 0.8–1.0, metalness 0.1–0.3). Exhaust particle trail appears only while thrusting.
- **Interact:** **free flight** — **Z = dive, S = climb (keyboard pitch)**, Q/D = strafe (local X), A/E = roll, **mouse X = yaw, mouse Y = pitch** (pointer lock on canvas click — **confirmed**), **scroll wheel = throttle 0–100%** (forward velocity accelerates toward throttle × max speed; 0 = decelerate to stop), arrow keys alias Z/S/Q/D. Space / left-click = fire. **Right-click hold = EM shield** (bubble deflects asteroids/debris/comets, 100 energy draining 25/s, regen 15/s). **Very powerful headlight** (spotlight, intensity 6.5, range 95) reveals asteroids ahead. **Camera half closer** (6 u behind, 3 u above). Inertia physics (accel 40 u/s², lateral drift decay 0.98, max 80 u/s). 100 HP; **0.75 s invulnerability after any hit**; collision damage (20 large / 5 small+debris / 25 comet); red vignette + warning beep below 30 HP. Camera trails the heading but **does not inherit roll** (eases to world-up). Death → dissolve → death screen → R to restart.

### 1.2 Laser Projectiles — large green beam
- **Look:** a **big green beam** (9 u long) — thick core cylinder (radius 0.18) + wide outer glow cylinder (radius 0.5) + bright tip sprite, all green (`#33ff66` core / `#22ff66` glow) with additive blending + bloom.
- **Interact:** fired by player, 8 shots/s max, travels along ship heading at 200 u/s, lifetime 3 s **or** 200 u range (whichever first), 25 damage per hit, generous collision radius (1.8 u) so the fat beam connects easily. On impact: green sparks + screen flash + explosion sound. Swallowed silently by black hole event horizons; sparks harmlessly off dead stars and station hulls.

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
  - **Gravity:** asteroids, comets, debris within **450 u** accelerate toward the center with `a = 7500 / d²` (capped 120 u/s²) — **tripled range and strength; pull grows as you get closer**.
  - **Ship:** pulled at **FULL strength** (1.0×) — near the horizon the pull (up to 120 u/s²) overwhelms the engines: you get dragged in. Pulsing red **"⚠ EVENT HORIZON"** warning within 40 u of the horizon surface.
  - **Consumption:** anything touching the horizon (8 u) disappears with a flash + low descending sweep sound — asteroids, comets, debris, projectiles… and the ship (instant death, bypasses invulnerability).
  - **Mutual attraction & collapse:** holes attract each other (40000/d², capped 80 u/s²); a close pair **collapses in a massive flash + shockwave** — white screen flash, big shake, deep boom, and **50 damage** if the ship is within 60 u. Emits `environment:blackHoleCollapsed`.
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

### 1.15 Biome Ladder (v2.0 — replaces the old band cycle)
| Rung | Zone | Distance (u) | Score × | Asteroids | Nebulae | Comets | Black holes | Dead stars | Stations | New content |
|------|------|-------------|---------|-----------|---------|--------|-------------|------------|----------|-------------|
| 1 | Open Space | 0–1000 | 1.0 | 10/chunk | 2 | 3/chunk | 0 | 1%/chunk | 0 | — |
| 2 | Asteroid Belt | 1000–3000 | 1.0 | 40/chunk | 3 | 6/chunk | 0 | 2%/chunk | 2%/chunk | — |
| 3 | Nebula Corridor | 3000–5000 | 1.2 | 20/chunk | 6 | 8/chunk | 4%/chunk | 3%/chunk | 3%/chunk | — |
| 4 | Wormhole | 5000–7000 | 1.5 | 60/chunk | 8 | 10/chunk | 8%/chunk | 4%/chunk | 4%/chunk | tunnels + blur |
| — | Deep Void | 7000–8000 | 1.5 | 2/chunk | 0 | 3/chunk | 0 | 0 | 1%/chunk | empty travel |
| 5 | Crystal Fields | 8000–11000 | 2.0 | 25/chunk | 5 | 7/chunk | 0 | 0 | 2%/chunk | crystal shards, beam-split |
| — | Deep Void | 11000–12500 | 2.0 | 2/chunk | 0 | 3/chunk | 0 | 0 | 1%/chunk | empty travel |
| 6 | Pulsar Region | 12500–16000 | 2.5 | 30/chunk | 4 | 9/chunk | 2%/chunk | 0 | 2%/chunk | pulsars + sweeping beams |
| — | Deep Void | 16000–18000 | 2.5 | 2/chunk | 0 | 3/chunk | 0 | 0 | 1%/chunk | empty travel |
| 7 | Plasma Storm | 18000–22000 | 3.0 | 35/chunk | 7 | 9/chunk | 4%/chunk | 2%/chunk | 1%/chunk | storm clouds + lightning |
| — | Deep Void | 22000–25000 | 3.0 | 2/chunk | 0 | 3/chunk | 0 | 0 | 1%/chunk | empty travel |
| 8 | Derelict Graveyard | 25000–29000 | 3.5 | 20/chunk | 3 | 6/chunk | 6%/chunk | 2%/chunk | 0 | ship hulks |
| — | Deep Void | 29000–35000 | 3.5 | 2/chunk | 0 | 3/chunk | 0 | 0 | 1%/chunk | final approach |
| 9 | **SPATIAL GRAVEYARD** | 35000 → ∞ | 4.0 | 40/chunk | 5 | 8/chunk | 8%/chunk | 4%/chunk | 0 | **city fragments + blinking wrecks (finale)** |

Intensity multipliers are capped (asteroid ≤3.0, nebula ≤2.5, comet ≤2.5, BH pull ≤2.0); the finale's density is the endgame. Rung multiplier applies to all scores. Backward flight never regresses rungs (monotonic odometer). Full per-rung specs: `docs/SPEC.md` §3.

### 1.16 Crystal Shard Clusters (Crystal Fields)
- **Look:** 4–8 translucent instanced octahedra (1.2–2.5 u), cyan/magenta/mint palette, additive core glint sprite, slow drift + tumble.
- **Interact:** 25 HP (1 beam hit), **40 pts**, 5 collision dmg. **Beam-split:** a beam hitting a shard spawns 2 child beams at ±18° (≤12 concurrent, no re-split). Event `environment:crystalDestroyed`.

### 1.17 Pulsars (Pulsar Region)
- **Look:** blue-white neutron star (18–26 u), pulsing emissive (1.5 Hz), 8× glow, PointLight 8/800 u, **two counter-rotating beam cones** (500 u long) with leading telegraph glow.
- **Interact:** beam touch = **50 dmg** (invulnerability applies); body touch = instant death. Not destructible, no score. Spacing ≥ 800 u, ≥ 400 u from ship.

### 1.18 Storm Clouds + Lightning (Plasma Storm)
- **Look:** 3-stack billboard clouds (20–40 u, dark teal, flicker light), polyline lightning bolts between clouds ≤ 120 u apart, re-roll every 1.5–3.5 s.
- **Interact:** strike telegraphed 0.5 s (cloud brightens) then **40 dmg** within 25 u of the bolt (shield deflects). HUD static overlay within 300 u (0.04 → 0.08 within 150 u). Event `environment:stormStrike`.

### 1.19 Ship Hulks (Derelict Graveyard)
- **Look:** procedural wrecks — rust hull + broken wings + snapped engine + flickering red emergency light; 3 shape variants; 4/chunk.
- **Interact:** **100 HP** (4 beam hits) → **150 pts** + 12 scrap particles; collision 25 dmg; drift + tumble. Event `environment:hulkDestroyed`.

### 1.20 City Fragments + Blinking Wrecks (SPATIAL GRAVEYARD — the finale)
- **Look:** huge broken space-city remains — shattered ring segments, ruined superstructures, broken towers, **100–400 u** landmark-scale, flickering window strips (canvas texture, random dropout), landmark glow visible from 2,000 u. Blinking wrecks: 5 smaller wrecks/chunk with **staggered red/white strobes** (time-offset emissive pulses).
- **Interact:** fragments **indestructible** (collision 25 + bounce); wrecks **100 HP** → **200 pts** + 16 scrap, collision 20. 5 wrecks/chunk. Entry announcement: **"SECTOR: DEAD CITY — you should not be here"** (once per run). Endless past 35,000 u. Events: `environment:cityFragmentSpawned`, `environment:wreckDestroyed`.

### 1.21 Starfield (background)
- **Look:** 3 parallax `Points` layers — far (5,000 × 0.5 u, blue-white), mid (2,000 × 1.0 u, warm), near (500 × 2.0 u, warm, noise twinkle) — plus 30 bright stars with bloom. Custom shader, one draw call per layer, **`fog: false`**. *(v2.0 remaster: color-temperature variety + shooting stars — see docs/SPEC.md §5.)*
- **Interact:** none — depth and speed anchor.

---

## 2. Decisions — all closed

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
- Event namespaces: `game:*`, `player:*` (died reasons: `collision` | `black_hole` | `dead_star`), `weapon:*`, `environment:*` (incl. `cometDestroyed`, `objectConsumed`, `blackHoleSpawned`, `blackHoleCollapsed`, `deadStarSpawned`, `stationSpawned`, `crystalDestroyed`, `pulsarSpawned`, `stormStrike`, `hulkDestroyed`, `cityFragmentSpawned`, `wreckDestroyed`), `ladder:*` (`rungChanged`, `finaleReached`), `storm:*`, `score:*`, `audio:*`, `visual:*`.
- Chunked infinite world: 200 u chunks, **3 vertical layers** (below/current/above, `CHUNKS_VERTICAL_RADIUS` 1) × 5×5 horizontal grid, mulberry32 seeded by chunk coords → deterministic regeneration; per-layer density ×0.75; content in `cy×200 ± 90 u`. **Biome ladder (v2.0): 9 rungs + 4 voids, monotonic odometer, capped intensity multipliers** — see docs/SPEC.md §3. Stations live in a persistent world registry (not chunk-owned). New rung systems: `CrystalSystem`, `PulsarSystem`, `StormSystem`, `HulkSystem`, `CitySystem` (all chunk-owned, dispose-safe).
- Gravity (black holes): cap iterations (~32 bodies/frame), squared distances, skip beyond 450 u, cap acceleration at 120 u/s².
- Post-processing: RenderPass → UnrealBloom (1.5 / 0.4 / per-rung threshold 0.11–0.15) → chromatic aberration (speed-scaled) → vignette → film grain → **WormholeBlurPass (only inside a wormhole wall shell)**; CA + grain skipped when `hardwareConcurrency < 4`; adaptive quality AQ1/AQ2 per docs/SPEC.md §7.2.5.
- Dynamic lights: **LightManager (v2.0)** — priority-culled registry, ≤14 active (auto) / ≤6 (eco, `L` key), ship lights always on; dead star + nebula point lights included in budget.
- Delta-time capped at 0.1 s; `setPixelRatio(min(dpr, 2))`; `near=0.1`; dispose everything on cleanup (restart-safe, tested 3×).
- Performance targets (v2.0, per-rung ceilings): draw calls ≤ 180–500 by rung, triangles ≤ 90–300 K, ≥60 fps (min 30), <15 MB memory growth over 5 min, live particles ≤ 1,400. Verified via `?perf=1` overlay + `npm run check:perf`.
- **Environment quirk:** global npm sets `omit=dev` → use `npm install --include=dev` or vite won't install.

---

**Implementation-ready (v2.0).** Next step: implement the Deep Space Expedition remaster per `docs/SPEC.md` — Phase P0 (perf tooling) → P1 (ladder core) → P2–P6 (new rungs → finale) → P7 (ship remaster) → P8 (VFX/lighting) → P9 (performance & release).
