# Void Drift — Deep Space Expedition (Biome Ladder) & Remaster

**Source of truth for the Biome Ladder + Total Graphics Remaster update.**
Supersedes the biome/world sections of the original spec at `~/Documents/prompt-library/space-exploration-threejs-spec.md`; everything in the original spec NOT contradicted here stays in force.

- Game: Void Drift (Three.js + Vite, raw three, ES modules)
- Project: `~/Documents/games-benchmarks/space-exploration-procedural/space-explorer-dsflash/`
- Version: 2.0.0 (this update)
- Status: closed — zero TBDs, zero vague ranges, every open point resolved.

---

## 1. Overview

Void Drift becomes a **deep-space expedition**: the current repeating distance-band cycle is replaced by a fixed, strictly-ascending **Biome Ladder** of 9 content zones (the 4 existing zones rebalanced, plus 5 new hand-crafted destinations), each separated by an empty **Deep Void** travel zone, culminating in the **SPATIAL GRAVEYARD** finale at exactly 35,000 u — an endless sea of blinking wrecked ships and huge broken space-city remains. Parallel to the extension, a **total graphics remaster** redesigns the ship, upgrades every visual effect, adds new light source types with a priority-culled LightManager, and revises performance budgets so the richer visuals hold 60 FPS. The two tracks interlock: every ladder rung has its own color palette, lighting rig, VFX set, entity types and danger/reward profile; the remaster makes each rung readable and distinct at a glance.

---

## 2. Controls

All binds are `event.code`-based (AZERTY-first: Z→KeyW, Q→KeyA, S→KeyS, D→KeyD, A→KeyQ, E→KeyE). Existing binds verified in `src/systems/InputSystem.js`; none change. New actions: `L` (extra lights toggle) and `C` (ladder chart overlay).

| Action | Bind (code) | Notes |
|---|---|---|
| Pitch down (dive) | `KeyW` (Z) / `ArrowUp` | 1.5 rad/s |
| Pitch up (climb) | `KeyS` / `ArrowDown` | 1.5 rad/s |
| Strafe left | `KeyA` (Q) / `ArrowLeft` | local X, same accel as thrust |
| Strafe right | `KeyD` / `ArrowRight` | local X |
| Roll left / right | `KeyQ` (A) / `KeyE` | 3.0 rad/s, camera does not inherit roll |
| Yaw / pitch look | Mouse (pointer lock on canvas click) | 0.0025 rad/px |
| Throttle 0–100% | Scroll wheel | ±0.0005 per deltaY |
| Fire (green beam) | `Space` or left click | 8 shots/s |
| EM shield (hold) | Right click | drains 25/s, regens 15/s |
| Pause | `Escape` | toggles; resumes on Esc |
| Mute | `KeyM` | toggles |
| Restart | `KeyR` | on death screen only |
| **Extra lights toggle (NEW)** | `KeyL` | cycles LightManager profile: `auto` → `eco` → `auto`. `auto` = full rig (≤14 dynamic lights), `eco` = ship lights only (≤6) |
| **Ladder chart (NEW)** | `KeyC` | toggles overlay showing rung name, distance, progress bar to next rung |

No camera-distance control: the camera stays at 6 u behind / 3 u above (see §4).

---

## 3. Biome Ladder

### 3.1 The ladder (locked — do not reorder, rename, or change ranges)

| Rung | Key | Zone | Range (u, odometer) | Score mult | Signature content |
|---|---|---|---|---|---|
| 1 | `OPEN_SPACE` | Open Space | 0 – 1,000 | 1.0 | sparse asteroids, parallax starfield |
| 2 | `ASTEROID_BELT` | Asteroid Belt | 1,000 – 3,000 | 1.0 | dense asteroids, stations |
| 3 | `NEBULA_CORRIDOR` | Nebula Corridor | 3,000 – 5,000 | 1.2 | nebulae, comets, black holes (4%) |
| 4 | `WORMHOLE` | Wormhole | 5,000 – 7,000 | 1.5 | tunnels + blur, black holes (8%), dead stars |
| — | `DEEP_VOID` | Deep Void | 7,000 – 8,000 | 1.5 | empty travel |
| 5 | `CRYSTAL_FIELDS` | Crystal Fields | 8,000 – 11,000 | 2.0 | crystal shard clusters, beam-splitting |
| — | `DEEP_VOID` | Deep Void | 11,000 – 12,500 | 2.0 | empty travel |
| 6 | `PULSAR_REGION` | Pulsar Region | 12,500 – 16,000 | 2.5 | pulsars with sweeping beams |
| — | `DEEP_VOID` | Deep Void | 16,000 – 18,000 | 2.5 | empty travel |
| 7 | `PLASMA_STORM` | Plasma Storm | 18,000 – 22,000 | 3.0 | storm clouds, lightning, HUD static |
| — | `DEEP_VOID` | Deep Void | 22,000 – 25,000 | 3.0 | empty travel |
| 8 | `DERELICT_GRAVEYARD` | Derelict Graveyard | 25,000 – 29,000 | 3.5 | destructible ship hulks |
| — | `DEEP_VOID` | Deep Void | 29,000 – 35,000 | 3.5 | empty travel (final approach) |
| 9 | `SPATIAL_GRAVEYARD` | **SPATIAL GRAVEYARD (finale)** | 35,000 → ∞ | 4.0 | blinking ship parts + broken space city |

The `DEEP_VOID` rows are separator zones, not rungs: rung numbering counts content zones only (1–9). The finale **starts at exactly 35,000 odometer units** — the last void (29,000–35,000) is the final approach; there is no content zone between the Derelict Graveyard and the finale.

### 3.2 Deep Void zone definition

`DEEP_VOID` is itself a biome entry with near-zero content:

| Property | Value |
|---|---|
| asteroidDensity | 2 |
| nebulaCount | 0 |
| cometDensity | 3 |
| blackHoleDensity | 0 |
| deadStarDensity | 0 |
| stationDensity | 1 |
| crystalDensity / pulsarDensity / stormDensity / hulkDensity / wreckDensity / cityChance | 0 / 0 / 0 / 0 / 0 / 0 |
| color | `[0.05, 0.08, 0.15]` |
| Starfield | far layer count ×1.5 (7500), twinkle ×1.5 — cleaner, brighter stars |
| Audio | low drone (55 Hz sine + slow LFO), no music layer change |
| HUD biome text | `DEEP VOID` |
| Score multiplier | unchanged from previous rung (voids do not change the multiplier) |

Void travel is the calm/anticipation segment: distance keeps climbing (odometer monotonic), rare comets and the occasional station are the only encounters. Wormhole tunnels NEVER spawn in voids.

### 3.3 Per-rung specifications

All densities are per-chunk `count = round(base × intensity_mult × DENSITY_REDUCTION(0.75))`, chance-based spawns are per-chunk percentage rolls (all `rng()*100 >= pct` gates scaled by 0.75). Content Y always `cy × 200 ± 90`.

**Rung 1 — Open Space (0–1,000)** [unchanged]
asteroid 10, nebula 2, comet 3, black hole 0%, dead star 1%, station 0%. Palette `[0.1,0.15,0.3]`. Transition: spawn fade-in, no announcement beyond first spawn.

**Rung 2 — Asteroid Belt (1,000–3,000)** [unchanged]
asteroid 40, nebula 3, comet 6, black hole 0%, dead star 2%, station 2%. Palette `[0.4,0.2,0.1]`.

**Rung 3 — Nebula Corridor (3,000–5,000)** [unchanged]
asteroid 20, nebula 6, comet 8, black hole 4%, dead star 3%, station 3%. Palette `[0.3,0.15,0.4]`.

**Rung 4 — Wormhole (5,000–7,000)** [unchanged, tunnel spawn keyed to rung]
asteroid 60, nebula 8, comet 10, black hole 8%, dead star 4%, station 4%. Palette `[0.2,0.1,0.5]`. Tunnels spawn only when rung key is `WORMHOLE`.

**Rung 5 — Crystal Fields (8,000–11,000)** [NEW]
asteroid 25, nebula 5, comet 7, black hole 0%, dead star 0%, station 2%, **crystalDensity 8** (clusters/chunk, see §3.4.1). Palette `[0.55,0.85,0.95]` — bright cyan/magenta. Lighting: ambient 0.12 tint cyan, +2 static cyan point lights per cluster (budgeted), bloom threshold 0.12 (more bloom). VFX: prismatic refraction glints (see §5). Hazard profile: crystals fragile but dense; beam-splitting is the reward.

**Rung 6 — Pulsar Region (12,500–16,000)** [NEW]
asteroid 30, nebula 4, comet 9, black hole 2%, dead star 0%, station 2%, **pulsarDensity 6** (see §3.4.2). Palette `[0.65,0.7,1.0]` — blue-white. Lighting: ambient 0.10 tint blue, pulsar sweep lights (2 per pulsar). VFX: beam sweep cones, pulse glow. Hazard: beam touch = 50 dmg; timing/pathing gameplay.

**Rung 7 — Plasma Storm (18,000–22,000)** [NEW]
asteroid 35, nebula 7, comet 9, black hole 4%, dead star 2%, station 1%, **stormDensity 10** (see §3.4.3). Palette `[0.25,0.55,0.5]` — electric teal. Lighting: ambient 0.09 tint teal, storm flicker lights (1 per cloud). VFX: lightning arcs, HUD static overlay, screen distortion 0.002 CA. Hazard: strikes 40 dmg, telegraphed 0.5 s.

**Rung 8 — Derelict Graveyard (25,000–29,000)** [NEW]
asteroid 20, nebula 3, comet 6, black hole 6%, dead star 2%, station 0%, **hulkDensity 4** (see §3.4.4). Palette `[0.35,0.25,0.2]` — rust/brown. Lighting: ambient 0.08 tint amber, hulk emergency flicker lights. VFX: smoke haze billboards, ember drift. Hazard: hulk collisions 25 dmg; hulks destructible (HP 250) → 150 pts + scrap burst.

**Rung 9 — SPATIAL GRAVEYARD (35,000 → ∞)** [NEW — THE FINALE]
asteroid 40, nebula 5, comet 8, black hole 8%, dead star 4%, station 0%, **cityChance 50%, wreckDensity 5** (see §3.4.5). Palette `[0.15,0.45,0.4]` — dim greenish-cyan emergency. Lighting: ambient 0.07 tint cyan-green, flicker lights on city fragments + wreck strobes. VFX: window flicker, strobe pulses, haze. Hazard: city fragments indestructible (collision 25), wrecks destructible (HP 200 → 200 pts + scrap). HUD announcement at entry: **"SECTOR: DEAD CITY — you should not be here"** (5 s overlay, once per run). Endless: no biome after it; content identical in density for all d ≥ 35,000.

**Density semantics for ALL new rung content:** `crystalDensity`, `stormDensity`, `hulkDensity`, `wreckDensity` are FINAL per-chunk counts (no ×0.75 reduction, no distance multiplier — the rung band itself is the scaling); `pulsarDensity` and `cityChance` are per-chunk percentage chances (max 1 per chunk).

**Transition feedback (all rungs + voids):** on rung change, in order: (1) HUD biome indicator fades to new name, (2) `environment:biomeChanged` + new `ladder:rungChanged` events, (3) audio: rising arpeggio (biome) — finale gets the 4-tone descending "danger" arpeggio instead, (4) bloom threshold and fog tint ease to the new palette over 1.5 s, (5) if entering a content rung from a void: a 1.0 s camera FOV kick (+4°) and a single "transition shimmer" particle ring at the ship.

### 3.4 New entity specifications

All new entities register in `ChunkManager._spawnChunk` after `stationSystem`, all obey seeded rng, all dispose on `_cleanupChunk` (restart-safe), all emit their spawn event.

#### 3.4.1 Crystal shard clusters (Crystal Fields)
- **Look:** cluster of 4–8 translucent octahedra (instanced, `OctahedronGeometry(1, 0)`), per-instance scale 1.2–2.5 u, color per shard from palette `[0x66e0ff, 0xff66e0, 0x66ffcc]` with emissive 0.6, transparent opacity 0.65, additive inner glow sprite at cluster center (scale 4).
- **Stats:** shard HP 25, collision damage 5 (small), **score 40/shard**, cluster radius 6.
- **Beam-split mechanic:** a green beam that passes within `LASER_HIT_RADIUS + shard.radius` of any shard destroys the shard (25 dmg = one hit) AND spawns 2 additional beams: the original continues; 2 child beams spawn at ±18° yaw from the impact direction, same speed/damage/lifetime (max 12 concurrent child beams, pooled with the main pool — **LASER_POOL raised 32 → 44**). Child beams do not split again.
- **Drift:** shards drift 0.5–1.5 u/s + slow tumble (0.2 rad/s), like small asteroids.
- **Event:** `environment:crystalDestroyed` { position, score }.

#### 3.4.2 Pulsars (Pulsar Region)
- **Look:** blue-white neutron star — sphere radius 18–26 (landmark scale), emissive white-blue `0xcfe8ff` with pulsing emissiveIntensity 0.7→1.0 (1.5 Hz), glow sprite scale ×8, PointLight intensity 8, range 800, color `0xbfd8ff`. **Two counter-rotating beam cones**: cone length 500, half-angle 0.06 rad, additive `0x9fd8ff`, opacity 0.35, depthWrite off; cone A rotates +0.35 rad/s, cone B −0.28 rad/s (both around pulsar Y axis). A faint leading glow (sprite, opacity 0.5) precedes each cone by 0.35 rad to telegraph the sweep.
- **Interaction:** beam cone touch (distance to cone axis < 8 u) = **50 dmg** (no invulnerability bypass; 0.75 s invuln applies). Pulsar body touch = instant death (like dead star). Not destructible, no score.
- **Spawn:** `pulsarDensity 6` = 6% chance per chunk (max 1/chunk), spacing guard ≥ 800 u from any other pulsar, ≥ 400 u from ship.
- **Event:** `environment:pulsarSpawned` { position, radius }.

#### 3.4.3 Storm clouds + lightning (Plasma Storm)
- **Look:** storm cloud = 3 stacked billboard planes (radius 20–40, dark `0x0a1512` with teal rim) + internal flash sprite; 1 flicker PointLight per cloud (intensity 0→1.2, teal, range 60, random flicker 6 Hz).
- **Lightning:** between clouds closer than 120 u, a bolt = polyline (6 segments, additive `0x9fffe0`, LineBasicMaterial linewidth 1, opacity 0.9) + glow sprite at strike point; bolt lifetime 0.15 s, re-roll every 1.5–3.5 s per pair.
- **Strike:** when a bolt forms, the struck cloud **brightens to full for 0.5 s** (telegraph); a ship within 25 u of the bolt segment takes **40 dmg**. Lightning arcs are visual-only for the ship (no physical collision body).
- **HUD static:** when any storm cloud is within 300 u of the ship, the HUD overlay (full-screen `rgba(160,255,220,0.04)` noise flicker at 20 Hz) is active; within 150 u it intensifies to 0.08 opacity. Mild CA distortion 0.002 while inside 200 u.
- **Event:** `environment:stormStrike` { position, damage }.

#### 3.4.4 Ship hulks (Derelict Graveyard)
- **Look:** procedural wreck — 1 main hull (BoxGeometry 6×3×10, rust `0x5a4632`, metalness 0.6, roughness 0.85) + 2 broken wing plates (scaled boxes, rotated) + 1 snapped engine cone + 1 flickering red emergency light (PointLight 0.6, range 20, 1.5 Hz). Per-hulk random seed for shape variants (3 variants).
- **Stats:** HP 100 (4 beam hits), collision damage 25, **score 150** + scrap burst (12 debris particles, `explosion` pool, color `0x8a6f4d`). Drift 0.3–1 u/s, tumble 0.05 rad/s.
- **Spawn:** `hulkDensity 4` per chunk, ≥ 200 u from ship, ≥ 80 u between hulks.
- **Event:** `environment:hulkDestroyed` { position, score }.

#### 3.4.5 Spatial Graveyard finale entities
**City fragments (indestructible):**
- **Look:** one fragment per chunk (50% chance, `cityChance 0.5`, max 1/chunk): procedural megastructure — 5–9 primitives assembled from a seeded variant table: shattered ring segment (torus arc, radius 60–120, tube 8–15), ruined station superstructure (cylinder 30×50 + 4 spoke boxes), broken tower cluster (3–5 boxes 8–20 wide, 60–140 tall, tilted). Material: dark hull `0x2a3533` metalness 0.7 roughness 0.6, with **window strips**: canvas texture (emissive `0x9fe8c8`, 60 windows) applied to the outer faces, windows **flicker** (emissiveIntensity = 0.4 + 0.6·pulse(t·0.8 + φ), φ per fragment, plus random dropout every 2–5 s for 0.2 s).
- **Scale:** overall bounding radius **100–400 u** (landmark-scale, visible from 2,000 u via glow sprite `0x5aa88f` opacity 0.08, scale ×3).
- **Interaction:** indestructible; collision damage 25 (with bounce), slow drift 0.2–0.5 u/s + rotation 0.01–0.03 rad/s. Spacing: fragment center ≥ 600 u from ship spawn, ≥ 500 u between fragments.
- **Event:** `environment:cityFragmentSpawned` { position, scale }.

**Blinking wrecks (destructible):**
- **Look:** 5 wrecked ships per chunk (`wreckDensity 5`, final count): reuse hulk builder with city palette (`0x3a4a45`), smaller (scale 0.5–0.9), each with **staggered red/white strobes**: 2 beacon points per wreck, emissive pulse `intensity = 0.1 + 0.9·(sin(t·3.0 + φ) > 0.75 ? 1 : 0.1)`, φ staggered per wreck (φ = seed·2.1); red `0xff5040` and white `0xd8e8e0` alternating (phase offset π).
- **Stats:** HP 100 (4 hits), collision damage 20, **score 200** + scrap burst (16 particles). Drift 0.3–1 u/s, tumble 0.1 rad/s.
- **Event:** `environment:wreckDestroyed` { position, score }.

### 3.5 Difficulty scaling (caps)

`BiomeGenerator.intensity(d)` returns **capped** multipliers (replaces the unbounded formulas):

| Multiplier | Formula | Cap |
|---|---|---|
| asteroid | 1 + d/5000 | **3.0** |
| nebula | 1 + d/8000 | **2.5** |
| comet | 1 + d/5000 | **2.5** |
| blackHolePull | 1 + d/8000 | 2.0 (unchanged) |

At the finale (35,000+): asteroid = min(3.0, 1 + d/5000) → 40 (rung base) × 3.0 × 0.75 = 90/chunk max; comet = min(2.5, …) → 8 × 2.5 × 0.75 = 15/chunk; nebula = min(2.5, …) → 5 × 2.5 × 0.75 = 9/chunk. No further escalation past 35,000 — the finale's density IS the endgame difficulty.

**Score multiplier:** `gameState.scoreMult` = rung multiplier (table §3.1); applies to ALL score gains (entity scores + distance points). Voids inherit the previous rung's multiplier.

**Backward flight:** rung index is `floor`-derived from the monotonic odometer; flying backward never decreases `rungIndex` (the odometer never regresses, so rungs never regress). `ladder:rungChanged` fires only when the index increases.

### 3.6 Post-finale behavior

The Spatial Graveyard is endless: for all d ≥ 35,000 the biome is `SPATIAL_GRAVEYARD` with constant density (caps reached), the odometer and score keep climbing, and the run ends only on death. No wrap, no loop, no "you have reached the end" — the Dead City IS the destination.

### 3.7 Ladder progression feedback

- HUD: rung indicator (top-left, under score): `SECTOR 5 — CRYSTAL FIELDS` + thin progress bar (progress = (d − rungStart) / rungWidth), cyan; finale shows `SECTOR 9 — DEAD CITY` with no progress bar.
- Events: `ladder:rungChanged` { rung, key, name, fromKey }, `ladder:finaleReached` { distance } (once per run).
- Death screen: adds final rung reached (`Reached: Pulsar Region`), and at the finale: `Reached: THE DEAD CITY`.
- Audio: rung arpeggio (3 rising sines 200/300/500 Hz, 0.3 s each — existing); finale replaces it with a 4-tone descending arpeggio (500/380/280/180 Hz, 0.25 s each) + low drone swell.

---

## 4. Ship — cosmetic redesign

Camera relationship **unchanged**: 6 u behind, 3 u above, no roll inheritance, FOV 75→95 by thrust.

| Part | New spec |
|---|---|
| Fuselage | layered: main hull (box 1.6×1.0×4.6, `0x8a9aad`), dorsal spine (box 0.6×0.3×3.8, offset +0.35), belly plate (box 1.0×0.25×3.0, −0.4), 4 greeble boxes (0.2–0.4) on spine |
| Cockpit | `SphereGeometry` half (0.5 r), `MeshPhysicalMaterial` clearcoat 1.0, roughness 0.05, transmission 0.6, opacity 0.85; interior: 2 seat boxes + 1 green panel emissive (0.4) |
| Wings | swept (box 4.2×0.12×1.4 rotated yaw 0.35 rad), tip boxes 0.5³ with nav lights: red `0xff3020` (port, −X), green `0x20ff60` (starboard, +X), emissive 2.0 |
| Tail fins | 2 fins (box 0.1×1.1×0.9, rotated ±0.3) + horizontal stabilizer |
| Panel lines | canvas texture 512×512 (dark lines grid on `0x8a9aad` base, roughness variation 0.7–0.95), applied to fuselage/wings; wear: 40 random dark speckles |
| Engines | dual nacelles (cylinders r 0.35, len 1.4) at (±0.55, 0, +2.2); flame cones (cone r 0.5, len 1.8, additive `0x66ccff` core + `0x2277ff` outer, noise-shader flicker) |
| Heat shimmer | engine glow sprites ×2 (additive, scale 2.2, opacity = 0.3 + 0.7·throttle); heat distortion: slight UV shimmer on flame shader only (no post pass — cost) |
| Exhaust trail | denser: per-frame count `max(2, round(10 × thrustFraction))`, size 0.35, color `[0.4, 0.65, 1.0]` |
| Engine glow light | PointLight at each nacelle (intensity 0 → 1.6 with throttle, range 14, color `0x4488ff`) — 2 dynamic lights, budgeted in LightManager |
| Underglow | PointLight (0.5, range 10, `0x6644ff`) below hull (existing, intensity raised 0.4→0.5) |
| Beacon | red blink on spine: small emissive sphere + PointLight 0.8 range 16, 1.2 Hz (50% duty) |
| Cockpit interior light | PointLight (0.3, range 5, `0x88ffcc`) inside canopy |
| Bank/turn lean | group roll bias: visual roll = ship roll × 0.85 + 0.5·(yaw rate) × 0.6 rad max, smoothed |
| Damage states | below 30 HP: scorch (2 dark decal planes on hull), wingtip lights switch to 2 Hz flicker, beacon 2 Hz, engine flames 30% shorter; below 10 HP: flames 50% shorter + smoke wisps from engines |
| Shield bubble v2 | radius 5.5: fresnel rim shader (additive, opacity 0.25 + 0.35·pulse), **ripple**: on deflection, a ring expands from impact point on the bubble (sprite, 0.3 s); **hit flash**: bubble opacity 0.9 for 0.1 s on any deflection |

Total new ship lights: 6 (2 engine + beacon + cockpit + underglow + headlight = 6, headlight unchanged) — all registered in the LightManager (§6.3).

---

## 5. Visual Effects Remaster

Every effect: current → new → technique → cost. Implementation order P8 (§14).

| Effect | Current | New | Technique | Cost |
|---|---|---|---|---|
| Nebula clouds | 2-octave fbm billboards | 3-octave fbm + per-biome palette uniforms + depth fade (alpha × smoothstep(z − 200, 0, 30)) | shader upgrade in place, uniform palette table | +0.05 ms |
| Starfield | 3 layers, twinkle on near | + color-temperature variety (30% blue-white, 40% white, 20% warm, 10% red giants), + shooting stars (2/min, 0.4 s streak sprites, capped 2 active) | vertex colors + small sprite pool | +0.02 ms |
| Explosions | particle burst | shockwave ring mesh (expanding torus, additive, 0.4 s, scale 2→14) + radial flash sprite + debris shards (6 boxes, gravity 8 u/s², 0.8 s) + ember smoke (existing) | pooled torus + shards in explosion pool | +0.03 ms |
| Laser beams | green beam (current v1) | + impact glow (PointLight 0.5, range 8, `0x66ff88`, 0.15 s, budgeted) + heat shimmer sprite at muzzle (0.1 s) | light + sprite on WEAPON_FIRED/HIT | +0.01 ms |
| Comet tails | dust + smoke pools | + curved ion tail (tube strip, additive `0x88ddff`, length 12, follows comet curve) | per-comet strip mesh, pooled 16 | +0.02 ms |
| Black hole disk | ring shader, Doppler beaming | sharper beaming (contrast 1.2), inner edge glow sprite, disk opacity ×1.2 | uniform tweaks | +0.00 ms |
| Dead star | sphere + ember glow | + atmosphere halo (2 additive spheres, scale 1.15/1.3, opacity 0.15/0.08, noise rim) | 2 pooled meshes per star | +0.01 ms |
| Wormhole tunnel | swirl shader | + rim glow on inner surface (fresnel mix 0.15), + 3 drifting light particles inside tube | shader tweak + reuse cometDust pool | +0.01 ms |
| Engine exhaust | flame cones + trail | heat shimmer sprite, throttle-reactive glow (see §4) | sprites | +0.00 ms |
| Speed sensation | FOV kick | + speed lines: 24 radial streak sprites (additive, opacity 0.25, length 40) at FOV > 88, + CA up to 0.003 | pooled sprites, opacity by throttle | +0.02 ms |
| Bloom/tone | UnrealBloom 1.5/0.4/0.15 | per-biome bloom threshold (rung table: base 0.15; Crystal 0.12, Pulsar 0.13, Storm 0.11, Finale 0.12, else 0.15), strength 1.5 fixed | uniform per rung | +0.00 ms |
| Lightning | — | polyline bolts + strike glow (see §3.4.3) | pooled LineSegments, 8 bolts | +0.02 ms |
| Wreck/city flicker | — | strobe + window flicker (see §3.4.5) | emissiveIntensity pulses (no extra draws) | +0.00 ms |
| Crystal refraction | — | prismatic glint sprites at shard centers (2 Hz, additive, `0x88ffff`, opacity 0.35) | 1 sprite per cluster | +0.01 ms |
| HUD static | — | storm overlay (see §3.4.3) | CSS overlay, no GPU cost | +0.00 ms |

---

## 6. Lighting & Visibility

### 6.1 New light source types (≥ 4 — six specified)

| # | Type | Geometry | Params | Biomes | Budget |
|---|---|---|---|---|---|
| 1 | Crystal cluster light | point at cluster center | `0x66e0ff`, 1.0, range 40, decay 2 | Crystal Fields | 1/cluster, ≤4 visible |
| 2 | Pulsar sweep light | spotlight (2/pulsar) | `0x9fd8ff`, 2.0, range 500, angle 0.06, penumbra 1.0, rotates with cone | Pulsar Region | 2/pulsar, ≤2 pulsars lit |
| 3 | Storm flicker light | point per cloud | `0x55ffcc`, 0→1.2 flicker 6 Hz, range 60 | Plasma Storm | 1/cloud, ≤3 visible |
| 4 | Hulk emergency light | point per hulk | `0xff5040`, 0.6, range 20, 1.5 Hz | Derelict | ≤2 visible |
| 5 | City fragment window light | point per fragment (1) | `0x9fe8c8`, 1.2, range 150 | Finale | ≤2 visible |
| 6 | Wreck strobe light | point per wreck (1) | `0xff5040`, 0.5, range 24, 3 Hz | Finale | ≤3 visible |
| 7 | Ship engine glow | point per nacelle | `0x4488ff`, 0→1.6 with throttle, range 14 | all | always on |
| 8 | Ship beacon | point on spine | `0xff5040`, 0.8, range 16, 1.2 Hz | all | always on |
| 9 | Cockpit interior | point in canopy | `0x88ffcc`, 0.3, range 5 | all | always on |

(9 types; #7–9 are ship lights from §4.) Dead-star and nebula lights remain.

### 6.2 Per-rung lighting rig table

| Rung | Ambient (color, intensity) | Directional | Signature lights | Headlight interaction |
|---|---|---|---|---|
| Open Space | `0x000011` 0.05 | 0.3 white | — | full effect |
| Belt | `0x221100` 0.05 | 0.3 `0xffd8a0` | — | full |
| Corridor | `0x1a0a24` 0.06 | 0.3 `0xc8a0ff` | nebula cores ≤4 | full |
| Wormhole | `0x0a0a24` 0.06 | 0.3 `0xa0a0ff` | tunnel rim | full |
| Void | `0x00000a` 0.04 | 0.2 white | — | full (contrast on stars) |
| Crystal | `0x08222a` 0.12 | 0.25 `0x88ddff` | crystal cluster lights | bloom threshold 0.12 |
| Pulsar | `0x0a0a2a` 0.10 | 0.25 `0xbfd8ff` | sweep spotlights | full |
| Storm | `0x03150f` 0.09 | 0.2 `0x88ffcc` | flicker lights | reduced (fog density 0.012) |
| Derelict | `0x140a08` 0.08 | 0.25 `0xffb060` | hulk emergency lights | full |
| Finale | `0x031412` 0.07 | 0.2 `0x9fe8c8` | fragment + strobe lights | full |

Readability guarantee: every gameplay-relevant object (asteroid, comet, crystal, bolt, hulk, wreck, city fragment edge) is lit by at least the directional + ambient + its own signature light; no rung relies on headlight alone.

### 6.3 LightManager (priority-culled)

- New module `src/systems/LightManager.js`: registry of every dynamic light (type, priority, position, range, cost class: `always`/`budget`).
- Caps: total active dynamic lights **≤ 14** (raised from 8), budgeted as: ship lights (always on, 6) + landmark lights (dead star/nebula, ≤ 4) + signature lights (≤ 4, priority-culled from: pulsar sweep > storm flicker > crystal cluster > wreck strobe > city window > hulk emergency).
- Culling: every frame, `budget` lights sorted by (priority, distance); the closest N within the cap are `.visible = true`, others false. Distance re-evaluated at 10 Hz (every 6th frame) — no per-frame sort cost.
- Profile toggle (`L` key): `auto` (cap 14) / `eco` (cap 6 — ship lights only; landmark + signature lights off; visuals dimmer, +5 FPS on weak GPUs). Persisted in localStorage key `void_drift_light_profile`.

---

## 7. Performance Update

### 7.1 Revised budget tables (per rung)

| Rung | Draw calls | Triangles | Active lights | Particles (max live) | Notes |
|---|---|---|---|---|---|
| Open Space | 200 | 120 K | 8 | 800 | baseline |
| Asteroid Belt | 260 | 160 K | 8 | 900 | |
| Nebula Corridor | 300 | 180 K | 14 | 1,000 | |
| Wormhole | 380 | 220 K | 14 | 1,200 | tunnels + blur |
| Deep Void | 180 | 90 K | 8 | 600 | cheapest |
| Crystal Fields | 300 | 160 K | 14 | 1,000 | |
| Pulsar Region | 320 | 200 K | 14 | 1,100 | sweep lights |
| Plasma Storm | 350 | 200 K | 14 | 1,100 | bolts + static |
| Derelict Graveyard | 400 | 240 K | 14 | 1,200 | hulks |
| SPATIAL GRAVEYARD | 500 | 300 K | 14 | 1,400 | heaviest |

Justification: the original ≤50 calls / ≤200 K tris targets were aspirational and already exceeded (current game measures 240–420 calls). The new tables are per-rung ceilings derived from the current measured baseline + the added entities, sized so a mid-range GPU (GTX 1060 class) holds 60 FPS; weak hardware falls back via adaptive quality (§7.2.5).

### 7.2 Techniques

1. **LODs:** large individual meshes get 2 levels: large asteroids (LOD1 = 80-face icosahedron, LOD2 = 20-face), hulks (full → 50% tri count), city fragments (full → simplified box shells at > 800 u), pulsars (glow sprite only > 1,500 u). Instanced small/medium asteroids: no LOD (GPU instancing already cheap).
2. **Instancing audit:** crystal shards → 1 InstancedMesh (pool 500); wreck strobes → reuse hulk instanced pool where possible; bolts → 1 LineSegments pool (8 bolts × 6 segs). No new individual-mesh entities beyond: large asteroids (existing), hulks (≤ 4/chunk × 75 chunks = 300), city fragments (≤ 1/chunk), pulsars (≤ 1/chunk), comets (existing, capped 6/chunk).
3. **Particle consolidation:** crystal glints and wreck strobe glows reuse the existing `laserSpark` pool (no new pools); scrap bursts reuse `explosion`; storm static is CSS (no GPU).
4. **Shader cost controls:** nebula fbm fixed at 3 octaves (no branches), tunnel shader unchanged, flame shader 1 octave + time-only flicker. All new shaders: max 3 texture fetches, no loops with dynamic bounds.
5. **Adaptive quality:** rolling 60-frame FPS average; if < 45 for 2 s → resolutionScale 0.85; if < 30 for 2 s → 0.7 + disable CA + grain (if hardwareConcurrency ≥ 4, else already off) + LightManager `eco`; recovery at > 55 FPS for 3 s steps back up. Flags in GameState (`adaptiveQualityLevel`: 0/1/2) and HUD indicator (tiny "AQ1/AQ2" bottom-right when level > 0).
6. **Batching:** ship remains one group; city fragment windows = 1 canvas texture shared by all fragments (no per-fragment texture); hulk variants = 3 shared geometries, per-hulk material clone only for emergency light intensity (no per-hulk texture).

### 7.3 Verification procedure

- `src/utils/PerfProbe.js` (dev-only, toggled by `?perf=1` query): on-screen overlay with FPS (60-frame avg), draw calls (`renderer.info.render.calls`), triangles, active lights count, live particles, memory (`performance.memory?.usedJSHeapSize`), rung name.
- Manual test matrix: fly each rung at max throttle for 60 s; record worst-frame numbers; assert against §7.1 table. Memory: < 15 MB growth over 5 min (was < 10 — raised due to richer content; justified: new pools total +1.2 MB, LOD geoms +0.8 MB, canvas textures +0.5 MB).
- CI-style headless check: `npm run check:perf` runs the game headless for 120 s at rung 9 teleport, fails if avg FPS < 30 or calls > 550.

---

## 8. Architecture

### 8.1 File tree (new/changed)

```
src/
  core/
    Constants.js          [CHANGED] new blocks: LADDER, CRYSTAL, PULSAR, STORM, HULK, CITY, LIGHT_MANAGER, ADAPTIVE_QUALITY, REMASTER
    Game.js               [CHANGED] rung detection hook, ladder events, adaptive quality driver, L/C key routing
    GameState.js          [CHANGED] rungIndex/rungName/scoreMult/adaptiveQualityLevel/lightProfile
    EventBus.js           [CHANGED] new events (§8.3)
  level/
    BiomeGenerator.js     [CHANGED] ladder table (9 rungs + voids), capped intensity(), no cycling
    ChunkManager.js       [CHANGED] calls crystalSystem/pulsarSystem/stormSystem/hulkSystem/citySystem; tunnel only in WORMHOLE
    CrystalSystem.js      [NEW] shard clusters, beam-split hook
    PulsarSystem.js       [NEW] pulsars + sweep cones
    StormSystem.js        [NEW] clouds, bolts, strikes, HUD static state
    HulkSystem.js         [NEW] derelict hulks (shared builder with CitySystem wrecks)
    CitySystem.js         [NEW] city fragments + blinking wrecks (finale)
  systems/
    LightManager.js       [NEW] priority-culled dynamic light registry
    AdaptiveQuality.js    [NEW] FPS monitor + resolution/effect scaling
    PostProcessingSystem.js [CHANGED] per-rung bloom threshold uniform
    ParticleSystem.js     [CHANGED] shockwave ring, shards, speed lines, glint helpers (all pooled)
  gameplay/
    PlayerShip.js         [CHANGED] remastered visuals (§4), shield v2
    WeaponSystem.js       [CHANGED] beam-split child beams, impact glow light
  ui/
    HUD.js                [CHANGED] rung indicator, ladder chart (C), storm static overlay, AQ indicator
    LadderChart.js        [NEW] C overlay (DOM, no canvas)
  utils/
    PerfProbe.js          [NEW] dev overlay
```

### 8.2 Existing module changes

- `BiomeGenerator`: replace ORDER/cycle with LADDER array of 13 entries (9 rungs + 4 voids), `getBiome` returns `{ key, cfg, mult, rungIndex }`; `intensity()` capped per §3.5; voids share DEEP_VOID cfg.
- `ChunkManager`: spawn calls extended (5 new systems); tunnel gate `biome.key === 'WORMHOLE'`.
- `Game`: rung change detection (compare `rungIndex`), emits `ladder:rungChanged`/`ladder:finaleReached`, routes `KeyL`/`KeyC`, drives `AdaptiveQuality` and `LightManager.setProfile`.
- `HUD`: new elements per §10; storm static overlay subscribes to `storm:staticChanged`.
- `ScoreSystem`: unchanged — `GameState.addScore` applies `scoreMult` internally (single hook, covers entity + distance scores).

### 8.3 New EventBus events

```
ladder:rungChanged      { rung, key, name, fromKey, distance }
ladder:finaleReached    { distance }
environment:crystalDestroyed { position, score }
environment:pulsarSpawned    { position, radius }
environment:stormStrike      { position, damage }
environment:hulkDestroyed    { position, score }
environment:cityFragmentSpawned { position, scale }
environment:wreckDestroyed   { position, score }
storm:staticChanged     { active, intensity }
input:ladderChart       { open }        (C key)
input:lightProfile      { profile }     (L key)
```

### 8.4 Constants plan

New blocks in `Constants.js` (all numbers concrete, zero magic numbers):

```
LADDER: { 13 entries as §3.1 table: key, range, densities, palette, scoreMult }
CRYSTAL: { density 8, hp 25, score 40, radiusMin 1.2, radiusMax 2.5, clusterMin 4, clusterMax 8, driftMin 0.5, driftMax 1.5, tumble 0.2, splitAngle 0.3142, childBeamMax 12, colorPool [0x66e0ff, 0xff66e0, 0x66ffcc] }
PULSAR: { density 6, radiusMin 18, radiusMax 26, beamLength 500, beamHalfAngle 0.06, beamTouchRadius 8, damage 50, speedA 0.35, speedB 0.28, leadAngle 0.35, lightIntensity 8, lightRange 800, pulseRate 1.5, minSpacing 800, minDistFromShip 400 }
STORM: { density 10, cloudRadiusMin 20, cloudRadiusMax 40, boltDistanceMax 120, boltSegments 6, boltLife 0.15, boltReMin 1.5, boltReMax 3.5, telegraphTime 0.5, strikeDamage 40, strikeRadius 25, staticRange 300, staticRangeIntense 150, staticOpacity 0.04, staticOpacityIntense 0.08, staticHz 20, flickerHz 6 }
HULK: { density 4, hp 250, damage 25, score 150, driftMin 0.3, driftMax 1.0, tumble 0.05, minDistShip 200, minSpacing 80, scrapParticles 12 }
CITY: { fragmentChance 0.5, hp 0 (indestructible), damage 25, driftMin 0.2, driftMax 0.5, rotMin 0.01, rotMax 0.03, minDistShip 600, minSpacing 500, windowCount 60, flickerFreq 0.8, dropoutEvery 2, dropoutLen 0.2, glowColor 0x5aa88f, glowOpacity 0.08, glowScale 3; wreckDensity 5, wreckHp 200, wreckDamage 20, wreckScore 200, wreckScaleMin 0.5, wreckScaleMax 0.9, wreckScrap 16, strobeFreq 3.0 }
LIGHT_MANAGER: { capAuto 14, capEco 6, landmarkBudget 4, signatureBudget 4, reevalEvery 6, priorities { pulsarSweep: 1, stormFlicker: 2, crystalCluster: 3, wreckStrobe: 4, cityWindow: 5, hulkEmergency: 6 } }
ADAPTIVE_QUALITY: { sampleFrames 60, dropFps 45, dropHold 2, hardFps 30, scale1 0.85, scale2 0.7, recoverFps 55, recoverHold 3, storageKey 'void_drift_light_profile' }
REMASTER: { shootingStarEvery 30, shootingStarMax 2, speedLineCount 24, speedLineOpacity 0.25, speedLineLength 40, shockRingLife 0.4, shockRingScale 14, shardCount 6, shardGravity 8, impactGlowIntensity 0.5, impactGlowRange 8, ionTailLength 12 }
```

---

## 9. GameState Schema

`reset()` gains:

```
rungIndex: 1,                 // 1..9 content rungs
rungKey: 'OPEN_SPACE',
rungName: 'Open Space',
rungProgress: 0,              // 0..1 within current rung (voids: progress toward next rung end)
scoreMult: 1.0,
adaptiveQualityLevel: 0,      // 0 | 1 | 2
lightProfile: 'auto',         // 'auto' | 'eco'
finaleReached: false,         // latched once per run
```

All existing fields unchanged. `addScore` applies `scoreMult` internally (single hook).

---

## 10. HUD

| Element | Position | Content | Update rule |
|---|---|---|---|
| Score | top-left | `SCORE: 12,450` | existing |
| **Rung indicator** | top-left, under score | `SECTOR 5 — CRYSTAL FIELDS` + 120×6 px cyan progress bar (width = rungProgress×100%) | every frame while rungProgress changes; finale: `SECTOR 9 — DEAD CITY`, no bar |
| Distance | top-center | `DISTANCE: 35,000 u` | existing |
| Health bar | bottom-center | existing | existing |
| Shield bar | bottom-center above health | existing | existing |
| Crosshair | center | existing | existing |
| Biome indicator | top-right | rung name, fades in/out on transition | existing (now uses rung names incl. `DEEP VOID`) |
| Thrust bar | bottom-left | existing | existing |
| Warnings | center-top | EVENT HORIZON / STELLAR REMNANT + new **PULSAR BEAM** (pulsar cone within 60 u of ship) | existing pulse style |
| **Storm static overlay** | full-screen | `rgba(160,255,220,X)` noise flicker at 20 Hz | X = 0.04 within 300 u, 0.08 within 150 u of a cloud; off otherwise |
| **Ladder chart (C)** | right-center panel | table: rung number, name, range, current position marker, progress bar; auto-closes on Esc/pause | DOM, toggled by `input:ladderChart` |
| **Finale announcement** | center | `SECTOR: DEAD CITY — you should not be here` (title-styled, 5 s fade) | once per run |
| AQ indicator | bottom-right | `AQ1`/`AQ2` when adaptive level > 0 | on level change |
| Death screen | center | existing + `Reached: <rung name>` | on death |

---

## 11. Performance Targets (final)

| Target | Value |
|---|---|
| FPS (mid-range GPU, any rung) | ≥ 60, min 30 |
| Draw calls | per-rung ceilings §7.1 (max 500 at finale) |
| Triangles | per-rung ceilings §7.1 (max 300 K at finale) |
| Active dynamic lights | ≤ 14 (auto) / ≤ 6 (eco) |
| Live particles | per-rung ceilings §7.1 (max 1,400) |
| Memory growth (5 min, any rung) | < 15 MB |
| DPR cap | 2 |
| Delta cap | 0.1 s |
| Adaptive fallback | AQ1 0.85 scale, AQ2 0.7 + no CA/grain + eco lights |

---

## 12. Edge Cases & State Handling

| Edge case | Resolution |
|---|---|
| Backward flight across a rung border | Odometer monotonic → rung never regresses; `rungChanged` fires only on increase; content behind keeps its rung until chunks clean |
| Ship crosses rung border mid-chunk | Rung = f(odometer) only; chunk content spawns with the odometer value at spawn time; mixed-rung chunk edges are visually blended by fog/palette ease (1.5 s) |
| Spawn guards at rung transitions | New entities use existing ≥ ship-distance guards (crystal ≥ 150, pulsar ≥ 400, hulk ≥ 200, city ≥ 600, wreck ≥ 300); no entity spawns inside the ship's own chunk column at spawn time |
| Two pulsar beams hit simultaneously | Damage 50 once (invulnerability 0.75 s absorbs the second) |
| Lightning strike while shield up | Shield deflects bolts (same deflect path as comets): no damage, energy drain applies, spark burst |
| City fragment collision | Bounce + 25 dmg + shake (same as large asteroid, indestructible flag prevents destroy) |
| Fragment drifts into the ship while paused | World updates frozen while paused (existing); resume re-evaluates collision |
| Low FPS | Adaptive quality ladder (§7.2.5); light profile auto → eco at AQ2 |
| Pointer-lock loss | Esc/click re-lock (existing); C and L work regardless of lock |
| Tab hidden | RAF stops; delta capped 0.1 s on return (existing) |
| Black hole collapse near finale fragments | Fragments are not bodies — unaffected; flash/shockwave as normal |
| Restart from the finale | Full reset: chunk clearAll, registry clears, finaleReached latches false, ladder chart closes |
| Death screen while ladder chart open | Chart closes on death |
| `localStorage` unavailable | Light profile + high score degrade silently (existing pattern) |

---

## 13. Color Palette

| Element | Hex | Use |
|---|---|---|
| Crystal shard A | `#66e0ff` | cyan crystal |
| Crystal shard B | `#ff66e0` | magenta crystal |
| Crystal shard C | `#66ffcc` | mint crystal |
| Crystal glint | `#88ffff` | refraction sprite |
| Pulsar body | `#cfe8ff` | star surface |
| Pulsar beam | `#9fd8ff` | sweep cones |
| Pulsar light | `#bfd8ff` | point/spot lights |
| Storm cloud | `#0a1512` | cloud body |
| Storm bolt | `#9fffe0` | lightning |
| Storm light | `#55ffcc` | flicker |
| Storm static | `rgba(160,255,220,0.04/0.08)` | HUD overlay |
| Hulk hull | `#5a4632` | rust hull |
| Hulk scrap | `#8a6f4d` | scrap particles |
| Hulk emergency | `#ff5040` | emergency light |
| City hull | `#2a3533` | fragment structure |
| City window | `#9fe8c8` | flickering windows |
| City glow | `#5aa88f` | landmark glow sprite |
| Wreck hull | `#3a4a45` | finale wrecks |
| Wreck strobe red | `#ff5040` | red beacon |
| Wreck strobe white | `#d8e8e0` | white beacon |
| Ship hull | `#8a9aad` | fuselage |
| Ship flame | `#66ccff` / `#2277ff` | engine core/outer |
| Ship engine light | `#4488ff` | engine glow |
| Ship underglow | `#6644ff` | belly light |
| Ship cockpit | `#88ffcc` | interior light |
| Ship nav port | `#ff3020` | left wingtip |
| Ship nav starboard | `#20ff60` | right wingtip |
| Ship beacon | `#ff5040` | spine beacon |
| Rung indicator | `#33ffcc` | HUD sector bar |

Rung ambient/void palettes: §6.2 and §3.2 (arrays in `LADDER`).

---

## 14. Acceptance Criteria (ordered by implementation phase)

**P0 — Baseline & tooling**
- [ ] P0.1 `?perf=1` overlay shows FPS/draw calls/tris/lights/particles/memory/rung
- [ ] P0.2 `npm run check:perf` headless script exists and runs

**P1 — Ladder core**
- [ ] P1.1 BiomeGenerator returns the 13-entry ladder (9 rungs + 4 voids), no cycling
- [ ] P1.2 Intensity multipliers capped per §3.5; values verified at 0/7000/22000/35000/60000
- [ ] P1.3 Deep Void zones: 2 asteroids, 0 nebulae, no holes/stars/storm/crystal/pulsar/hulk/wreck; HUD shows `DEEP VOID`
- [ ] P1.4 `ladder:rungChanged` fires exactly once per rung increase with correct payload
- [ ] P1.5 `ladder:finaleReached` fires once at 35,000
- [ ] P1.6 Backward flight from 40,000 to 20,000: rung stays 9, odometer monotonic
- [ ] P1.7 Rung indicator + progress bar render correctly in every rung and void
- [ ] P1.8 Score multiplier applies to entity + distance scores (verify 2.0 in Crystal Fields)
- [ ] P1.9 Wormhole tunnels spawn only in rung 4
- [ ] P1.10 Ladder chart (C) opens/closes, shows correct progress; closes on death/Esc

**P2 — Crystal Fields**
- [ ] P2.1 Clusters spawn (8/chunk), instanced shards, 3-color palette, drift + tumble
- [ ] P2.2 Shard dies to 1 beam hit, 40 pts, `environment:crystalDestroyed` fires
- [ ] P2.3 Beam split: 2 child beams at ±18°, ≤ 12 concurrent, children don't split
- [ ] P2.4 No crystals in other rungs; bloom threshold 0.12 in rung 5

**P3 — Pulsar Region**
- [ ] P3.1 Pulsars spawn (≤ 1/chunk, spacing 800), blue-white pulse, landmark glow
- [ ] P3.2 Two counter-rotating beam cones + leading telegraph glow
- [ ] P3.3 Beam touch = 50 dmg (invuln applies); body touch = instant death
- [ ] P3.4 `environment:pulsarSpawned` fires; pulsars never in other rungs

**P4 — Plasma Storm**
- [ ] P4.1 Clouds spawn (10/chunk) with flicker lights; bolts arc between pairs ≤ 120 u
- [ ] P4.2 Strike telegraph (0.5 s brighten) then 40 dmg within 25 u; shield deflects
- [ ] P4.3 HUD static intensity by distance (0.04 / 0.08); CA 0.002 inside 200 u
- [ ] P4.4 `environment:stormStrike` fires per strike

**P5 — Derelict Graveyard**
- [ ] P5.1 Hulks spawn (4/chunk, 3 shape variants), emergency lights flicker
- [ ] P5.2 Hulk dies to 4 beam hits → 150 pts + 12 scrap particles; collision 25 dmg
- [ ] P5.3 `environment:hulkDestroyed` fires

**P6 — Spatial Graveyard (finale)**
- [ ] P6.1 City fragments spawn (≤ 1/chunk, 100–400 u, window flicker + dropout) with landmark glow visible from 2,000 u
- [ ] P6.2 Fragments indestructible; collision bounce + 25 dmg
- [ ] P6.3 Wrecks spawn (5/chunk) with staggered red/white strobes; HP 200 → 200 pts + 16 scrap
- [ ] P6.4 `SECTOR: DEAD CITY — you should not be here` announcement plays once
- [ ] P6.5 Finale is endless: at 60,000 u the world is identical in density to 35,000 u

**P7 — Ship remaster**
- [ ] P7.1 Layered hull + greebles + panel-line/wear canvas texture render
- [ ] P7.2 Clearcoat cockpit with interior (seat + panel), interior light
- [ ] P7.3 Dual engines: flame cones, heat shimmer sprites, throttle-reactive glow lights
- [ ] P7.4 Nav lights, spine beacon, underglow; bank/turn lean animation
- [ ] P7.5 Damage states at < 30 HP and < 10 HP (scorch, flicker, smoke)
- [ ] P7.6 Shield v2: fresnel rim, deflection ripple, hit flash

**P8 — VFX & lighting remaster**
- [ ] P8.1 Nebula 3-octave + per-rung palette + depth fade
- [ ] P8.2 Starfield color-temperature variety + shooting stars (2/min, ≤ 2 active)
- [ ] P8.3 Explosions: shockwave ring + radial flash + debris shards + embers
- [ ] P8.4 Laser impact glow light + muzzle shimmer; comet curved ion tail
- [ ] P8.5 Black-hole disk contrast, dead-star halo, tunnel rim glow
- [ ] P8.6 Speed lines at FOV > 88; per-rung bloom thresholds
- [ ] P8.7 LightManager: ≤ 14 active lights, priority order verified (pulsar > storm > crystal > wreck > city > hulk); `L` toggles eco (≤ 6, ship lights only)

**P9 — Performance & release**
- [ ] P9.1 Every rung meets §7.1 budgets (measured via `?perf=1`, worst frame)
- [ ] P9.2 Adaptive quality triggers at < 45 FPS (AQ1), < 30 FPS (AQ2), recovers at > 55
- [ ] P9.3 Memory growth < 15 MB over 5 min at finale
- [ ] P9.4 Restart from finale: no leaks, no double listeners, registry clears (test 3×)
- [ ] P9.5 `npm run check:perf` passes (avg FPS ≥ 30, calls ≤ 550 at finale)
- [ ] P9.6 Existing controls all functional (regression: fly/shoot/shield/pause/restart)
- [ ] P9.7 Determinism: same seed → same world at 10,000 / 25,000 / 40,000 u

---

## 15. What's NOT in Scope

- No new gameplay systems beyond the ladder entities: no docking, trading, crafting, upgrades, persistent meta-progression, or ship loadouts.
- No multiplayer, networking, or save files (high score + light profile only).
- No new audio assets or music system; all sounds stay Web Audio synthesis (new: finale arpeggio + void drone + strike/boom variants use existing synthesis helpers).
- No external assets of any kind (procedural geometry, canvas textures, shaders only).
- No physics engine change; no third-party libraries beyond three addons.
- No changes to: controls layout, camera distance, weapon damage/rate balance, shield economy, black-hole constants, scoring for existing entities (except the rung multiplier), high-score key.
- No mobile/console targets; desktop + touch (existing touch throttle/shield buttons remain functional; new L/C keys are desktop-only).
