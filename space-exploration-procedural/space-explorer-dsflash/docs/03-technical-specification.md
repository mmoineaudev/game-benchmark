# Void Drift — Technical Specification (v2.0.0)

All values from `src/core/Constants.js` and the systems that read them.
Where SPEC.md and code disagree, **code wins**.

---

## 1. Dependencies

| Package | Version | Role |
|---------|---------|------|
| three | ^0.165.0 | Rendering, math, post-processing addons |
| vite | ^5.4.0 (dev) | Dev server (port 5199, strictPort), bundler |

No other runtime dependencies. No TypeScript. No test framework.

---

## 2. Constants (numeric ground truth)

### 2.1 Ship

| Constant | Value |
|----------|-------|
| MAX_HEALTH | 100 |
| HEALTH_REGEN_PERCENT_PER_SEC | 0.02 (2% of max HP/s) |
| DAMAGE_INVULNERABILITY | 0.75 (s) |
| SHIELD.radius | 22 (u) |
| SHIELD.deflectPower | 60 |
| SHIELD.cooldown | 1.0 (s) |
| SHIP_ACCELERATION | 44 (u/s²) |
| MAX_SHIP_SPEED | 88 (u/s) |
| SHIP_DRAG | 0.98 |
| SHIP_ROLL_SPEED | 3.0 (rad/s) |
| MOUSE_LOOK_SPEED | 0.0025 (rad/px) |
| KEYBOARD_PITCH_SPEED | 1.5 (rad/s) |
| PITCH_LIMIT | 1.2 (rad) |
| SHIP_SPAWN | (0, 2, 0) |
| CAMERA_DISTANCE | 6 (u) |
| CAMERA_HEIGHT | 3 (u) |
| CAMERA_FOV_REST | 75 (deg) |
| CAMERA_FOV_MAX | 95 (deg) |
| CAMERA_DAMPING | 5.0 |
| HEADLIGHT.intensity | 6.5 |
| HEADLIGHT.range | 95 |
| HEADLIGHT.angle | 0.7 |

### 2.2 World

| Constant | Value |
|----------|-------|
| CHUNK_SIZE | 200 (u) |
| CHUNKS_RADIUS | 1 (→ 3×3×3 = 27 chunks) |
| CHUNKS_CLEANUP_RADIUS | 1.6 |
| CHUNKS_SPAWN_PER_FRAME | 3 |
| CONTENT_Y_BAND | 100 (u) |
| DENSITY_REDUCTION | 0.55 |
| INSTANCE_CULL_RADIUS | 460 (u) |

### 2.3 Weapon — continuous quad beams

| Constant | Value |
|----------|-------|
| FIRE_RATE | 6 (/s per muzzle) |
| PROJECTILE_SPEED | 200 (u/s) |
| PROJECTILE_LIFETIME | 1.5 (s) |
| PROJECTILE_RANGE | 200 (u) |
| PROJECTILE_DAMAGE | 25 |
| LASER_POOL | 96 (4 muzzles × sustained + 12 child) |
| LASER_LENGTH | 9 (u) |
| LASER_RADIUS | 0.18 (u) |
| LASER_GLOW_RADIUS | 0.5 (u) |
| LASER_HIT_RADIUS | 1.8 (u) |
| LASER_COLOR | 0x33ff66 |
| CRYSTAL.splitAngle | 0.3142 (rad, ±18°) |
| CRYSTAL.childBeamMax | 12 |

### 2.4 Score

| Constant | Value |
|----------|-------|
| SCORE_DISTANCE_DIVISOR | 10 (1 point per 10 u) |
| SCORE_ASTEROID | 10 (base, × tierMult: small 1 / med 2 / large 4) |
| SCORE_COMET | 60 |
| SCORE_CRYSTAL | 40 |
| SCORE_PULSAR | 150 |
| SCORE_STORM | 80 |
| SCORE_STATION | 120 |
| SCORE_HULK | 150 |
| SCORE_WRECK | 200 |
| SCORE_CITY | 300 |
| SCORE_DEBRIS | 5 |
| SCORE_BLACK_HOLE | 500 |
| SCORE_MULT_DIVISOR | 3000 (u per +1.0×) |

### 2.5 Particles

| Pool | Max | Lifetime | Size |
|------|-----|----------|------|
| exhaust | 200 | 0.8 s | 0.6 |
| laserSpark | 50 | 0.3 s | 0.4 |
| explosion | 80 | 1.2 s | 1.4 (grow) |
| ember | 100 | 1.5 s | 0.5 |
| sparkle | 256 | 0.6 s | 2.5 (grow) |

Mesh pools: shockwave rings 4 (life 0.4 s), debris shards 12 (life 0.8 s,
gravity 20), speed lines (count from REMASTER), impact glow lights 4
(life 0.15 s, intensity from REMASTER).

### 2.6 Starfield

| Constant | Value |
|----------|-------|
| STAR_LAYERS.far.count | 5000 |
| STAR_LAYERS.mid.count | 2000 |
| STAR_LAYERS.near.count | 500 |
| BRIGHT_STAR_COUNT | 30 |
| STARFIELD_WRAP | 1200 (u) |

Parallax speeds: far 0.1, mid 0.3, near 0.8.
Shooting stars: every 30 s, max 2, life 0.45 s, speed 1600 u/s.

### 2.7 Post-processing

| Constant | Value |
|----------|-------|
| BLOOM.strength | 1.5 |
| BLOOM.radius | 0.4 |
| BLOOM.threshold | 0.15 |
| VIGNETTE.darkness | 0.5 |
| VIGNETTE.offset | 0.2 |
| FILM_GRAIN.intensity | 0.03 |
| CHROMATIC_ABERRATION_MAX | 0.003 |
| FOG_COLOR | 0x000011 |
| FOG_DENSITY | 0.008 |

### 2.8 Light manager

| Constant | Value |
|----------|-------|
| LIGHT_MANAGER.capAuto | 16 |
| LIGHT_MANAGER.capEco | 6 |
| LIGHT_MANAGER.signatureBudget | 4 |
| LIGHT_MANAGER.landmarkBudget | 4 |
| LIGHT_MANAGER.reevalEvery | 6 (frames) |

Priorities (lower = higher priority):
pulsarSweep 1, stormFlicker 2, crystalCluster 3, wreckStrobe 4,
cityWindow 5, hulkEmergency 6.

### 2.9 Adaptive quality

| Constant | Value |
|----------|-------|
| ADAPTIVE_QUALITY.sampleFrames | 60 (reference only) |
| ADAPTIVE_QUALITY.dropFps | 45 |
| ADAPTIVE_QUALITY.dropHold | 2 (s) |
| ADAPTIVE_QUALITY.scale1 | 0.85 |
| ADAPTIVE_QUALITY.hardFps | 30 |
| ADAPTIVE_QUALITY.scale2 | 0.7 |
| ADAPTIVE_QUALITY.recoverFps | 55 |
| ADAPTIVE_QUALITY.recoverHold | 3 (s) |

### 2.10 Ladder (14 entries)

| Index | Key | Range (u) | Score mult | Key densities |
|-------|-----|-----------|------------|---------------|
| 0 | OPEN_SPACE | 0 – 1,000 | 1.0 | asteroid 5 |
| 1 | ASTEROID_BELT | 1,000 – 3,000 | 1.0 | asteroid 20 |
| 2 | NEBULA_CORRIDOR | 3,000 – 5,000 | 1.2 | blackHole 3 |
| 3 | WORMHOLE | 5,000 – 7,000 | 1.5 | asteroid 30 |
| 4 | DEEP_VOID | 7,000 – 8,000 | inherit | (void base) |
| 5 | CRYSTAL_FIELDS | 8,000 – 11,000 | 2.0 | crystal 4 |
| 6 | DEEP_VOID | 11,000 – 12,500 | inherit | (void base) |
| 7 | PULSAR_REGION | 12,500 – 16,000 | 2.5 | pulsar 3 |
| 8 | DEEP_VOID | 16,000 – 18,000 | inherit | (void base) |
| 9 | PLASMA_STORM | 18,000 – 22,000 | 3.0 | storm 3 |
| 10 | DEEP_VOID | 22,000 – 25,000 | inherit | (void base) |
| 11 | DERELICT_GRAVEYARD | 25,000 – 29,000 | 3.5 | hulk 3 |
| 12 | DEEP_VOID (Final) | 29,000 – 35,000 | inherit | (void base) |
| 13 | SPATIAL_GRAVEYARD | 35,000 → ∞ | 4.0 | wreck 5, cityChance 0.7 |

Deep void base: asteroid 2, comet 2, station 1, color [0.05, 0.08, 0.15].

### 2.11 Entity constants (v2.0)

| System | Key values |
|--------|------------|
| CRYSTAL | density 8, instancedPool 5000, cluster 4–8, childBeamMax 12, hp 25, score 40 |
| PULSAR | density 4, beamLength 500, damage 50, minSpacing 800, radius 18–26 |
| STORM | density 4, strikeDamage 45, boltLife 0.15, boltSegments 6, telegraphTime 0.5, boltRe 2–6 s, staticRange / staticRangeIntense, flickerHz, cloudRadiusMin/Max, boltDistanceMax, lightColor, cloudColor, boltColor |
| HULK | density 4, hp 100, damage 30, score 150, minSpacing, minDistShip, driftMin/Max, tumble, hullColor, emergencyColor |
| CITY | cityChance 0.7, fragmentScale, fragmentRadius, fragmentHp 0, windowCount 90, wreckDensity 5, wreckHp 100, wreckScore 200, wreckScaleMin/Max, minSpacing, minDistShip, driftMin/Max, rotMin/Max, flickerFreq, dropoutEvery, strobeFreq, glowOpacity, glowScale, hullColor, windowColor, wreckColor, strobeRed, strobeWhite |

### 2.12 Remaster (v2.0 visual polish)

| Constant | Value |
|----------|-------|
| REMASTER.shootingStarEvery | (s) |
| REMASTER.shootingStarMax | 2 |
| REMASTER.shockRingLife | 0.4 (s) |
| REMASTER.shockRingScale | (expansion factor) |
| REMASTER.shardGravity | 20 (u/s²) |
| REMASTER.speedLineCount | (sprites) |
| REMASTER.speedLineOpacity | (0..1) |
| REMASTER.impactGlowIntensity | (light intensity) |

---

## 3. Renderer configuration

```js
new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_MAX))
DPR_MAX = 2
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
```

Canvas: appended to `#game-container`. Size: full viewport.
Resize: window `resize` event → `game.resize(w, h)` →
`renderer.setSize` + `camera.aspect` + `post.setSize`.

---

## 4. Camera

- PerspectiveCamera, FOV 75°, near 0.1, far 5000.
- Chase: 6 u behind, 3 u above ship position.
- Look-at: ship position (damped, lambda 8).
- FOV boost: +15° at full throttle (lerp with speed fraction).
- Shake: 0.25 × damage impulse, decays over 0.3 s.
- No roll inheritance from ship (camera roll = 0 always).
- Pointer lock: mouse movement → yaw/pitch on ship (not camera).

---

## 5. Math utilities

| Function | Signature | Notes |
|----------|-----------|-------|
| mulberry32 | `(seed) → () → float` | Deterministic PRNG, 32-bit |
| hash2 | `(x, z) → uint` | 2D chunk hash (unused; kept for compat) |
| hash3 | `(x, y, z) → uint` | 3D chunk hash (includes y!) |
| clamp | `(v, min, max) → float` | |
| lerp | `(a, b, t) → float` | |
| damp | `(a, b, lambda, dt) → float` | Frame-rate independent exp smooth |
| randRange | `(rng, min, max) → float` | Uses provided rng |
| scratch | `{ v1..v3, q1..q2, e1, m1 }` | Shared Vector3/Quat/Euler/Matrix4 |

**Critical:** `hash3` must include `y`. Seeding by `(x, z)` only makes
every vertical layer an exact copy (black holes stacked, etc.).

---

## 6. Shader inventory

| Shader | Location | Purpose |
|--------|----------|---------|
| STAR_VERTEX / STAR_FRAGMENT | ShaderHelpers.js | Starfield points (size, twinkle, soft dot) |
| NEBULA_VERTEX / NEBULA_FRAGMENT | ShaderHelpers.js | Nebula fbm billboards |
| DISK_VERTEX / DISK_FRAGMENT | ShaderHelpers.js | Black hole accretion disk (Doppler) |
| GLSL_SNOISE | ShaderHelpers.js | Simplex noise + fBm (inlined into nebula) |
| PARTICLE_VERTEX / PARTICLE_FRAGMENT | ParticleSystem.js | Particle points (size, alpha, color) |
| VignetteShader | PostProcessingSystem.js | Screen vignette |
| GrainShader | PostProcessingSystem.js | Film grain (time-driven hash) |
| ChromaticAberrationShader | PostProcessingSystem.js | Speed CA |
| WormholeBlurShader | PostProcessingSystem.js | Wormhole blur + swirl + fringe |

All shaders: GLSL ES 1.0 (WebGL2-compatible). No `#include`. No custom
precision beyond default `highp float`.

---

## 7. Audio graph

```
AudioContext
  └─ master (GainNode, 0.5, muted → 0)
       ├─ engine: OscillatorNode(sawtooth, 60Hz)
       │           → BiquadFilterNode(lowpass, 200Hz)
       │           → GainNode(0..0.16, thrust-driven)
       │           → master
       ├─ shield: OscillatorNode(triangle, 220Hz)
       │           → BiquadFilterNode(lowpass, 900Hz)
       │           → GainNode(0..0.05)
       │           → master
       ├─ one-shots (transient nodes, auto-GC after stop)
       └─ warning: OscillatorNode(sine, 800Hz) × 3 pulses, 2 s interval
```

All synthesis is procedural. No audio files. No external libraries.
AudioContext created lazily on first user gesture (pointerdown/keydown).

---

## 8. DOM structure (UI overlay)

```
#ui-overlay (pointer-events: none, z-index: 10)
  ├─ <style> (HUD styles)
  ├─ #hud-score
  ├─ #hud-rung > span + #hud-rung-bar > #hud-rung-fill
  ├─ #hud-announce
  ├─ #hud-aq
  ├─ #hud-distance
  ├─ #hud-biome
  ├─ #hud-mute
  ├─ #hud-health-wrap > #hud-health-bg > #hud-health-fill + #hud-health-label
  ├─ #hud-shield-wrap > #hud-shield-bg > #hud-shield-fill + #hud-shield-label
  ├─ #hud-shield-btn (touch only)
  ├─ #hud-thrust > #hud-thrust-label + #hud-thrust-bg > #hud-thrust-fill
  ├─ #hud-warnings > .hud-warn × 3
  ├─ #hud-flash
  ├─ #hud-lowhp
  ├─ #hud-static
  ├─ #hud-hint
  ├─ #hud-pause > h1 + p × 2
  ├─ #hud-throttle-slider (touch only)
  ├─ #ladder-chart (LadderChart)
  ├─ #crosshair (Crosshair)
  ├─ #death-screen (DeathScreen)
  └─ #perf-probe (?perf=1 only)
```

Z-index layers:
- 12: crosshair
- 14: low HP vignette
- 15: damage flash
- 16: storm static
- 20: HUD elements
- 25: touch shield button
- 30: announce banner
- 35: ladder chart
- 40: pause overlay
- 50: death screen, perf probe

---

## 9. Event catalog (complete)

### 9.1 Input events

| Event | Payload |
|-------|---------|
| `input:fire` | { active: bool } |
| `input:shield` | { active: bool } |
| `input:throttleSet` | { value: 0..1 } |
| `input:pause` | { paused: bool } |

### 9.2 Player events

| Event | Payload |
|-------|---------|
| `player:healthChanged` | { health, maxHealth } |
| `player:healthRegen` | { health, maxHealth } |
| `player:died` | { reason: string } |

### 9.3 Score events

| Event | Payload |
|-------|---------|
| `score:changed` | { score: number } |

### 9.4 Biome / ladder events

| Event | Payload |
|-------|---------|
| `biome:changed` | { to, from } |
| `ladder:rungChanged` | { rung, index, isFinale } |
| `ladder:finaleReached` | {} |

### 9.5 Environment events

| Event | Payload |
|-------|---------|
| `environment:crystalDestroyed` | { position } |
| `environment:pulsarSpawned` | { position } |
| `environment:stormStrike` | { position, damage } |
| `environment:hulkDestroyed` | { position, score } |
| `environment:cityFragmentSpawned` | { position, scale } |
| `environment:wreckDestroyed` | { position, score } |
| `environment:blackHoleCollapse` | { position } |
| `storm:staticChanged` | { active, intensity } |

### 9.6 Audio events

| Event | Payload |
|-------|---------|
| `audio:muted` | { muted: bool } |

---

## 10. localStorage keys

| Key | Type | Written by |
|-----|------|------------|
| `void_drift_highscore` | number | ScoreSystem (on death) |
| `void_drift_muted` | 'true'/'false' | InputSystem (M key) |
| `void_drift_light_profile` | 'auto'/'eco' | InputSystem (L key) |

---

## 11. Headless perf check (scripts/check-perf.mjs)

**Prerequisites:**
- Dev server: `npm run dev` (port 5199).
- Headless Chrome: `chromium --headless=new --remote-debugging-port=9222`.

**Procedure:**
1. Connect to CDP on 9222. Find or create tab pointing to 5199.
2. Reload page, wait for `window.__VOID_DRIFT__.version === '2.0.0'`.
3. Teleport: set `CHUNKS_RADIUS = 1`, `CHUNKS_CLEANUP_RADIUS = 1.6`,
   `CITY.minDistShip = 0`, `CITY.minSpacing = 0`.
   Set `state.distance = 36000`, `ship.position.set(3000, 2, 1000)`.
   `chunkManager.clearAll()`, `chunkManager.update(...)`.
4. Wait 2 s for world to populate.
5. Sample 30 × 1 s: FPS, draw calls, triangles, rung index.

**Assertions:**
- 0 console errors (Runtime.exceptionThrown).
- Max draw calls ≤ 3500 (software renderer ceiling; real GPU budget 500).
- Avg FPS ≥ 5 (SwiftShader sanity floor).

**Exit codes:** 0 = pass, 1 = fail.

**Why 3500 not 500:** SwiftShader (software renderer) frustum-culls
nothing and renders the whole world. 3500 catches runaway pools while
staying achievable. Real GPU with frustum culling targets ≤ 500.

---

## 12. Vite configuration

```js
// vite.config.js
export default {
  server: {
    port: 5199,
    strictPort: true,
  },
  // ... (standard Vite config, no plugins)
}
```

- Dev server: port 5199, strict (fails if port taken).
- No HMR-specific config needed (vanilla ES modules).
- Build: `vite build` → `dist/`.

---

## 13. Known deviations from SPEC.md

| SPEC.md says | Code actually does | Resolution |
|--------------|-------------------|------------|
| Storm strike damage 40 | `STORM.strikeDamage` = 45 | Code wins |
| `MAX_ACTIVE_LIGHTS`: 8 (old) | `LIGHT_MANAGER.capAuto` = 16 | v2.0 superseded |
| PerfProbe in systems/ | In utils/ | Moved; SPEC file list is stale |
| 5×5×5 chunk grid (radius 2) | `CHUNKS_RADIUS` = 1 (3×3×3) | Reduced for perf |
| 75 chunks (old) | 27 chunks (radius 1) | Same as above |
| Camera 12 u behind, 5 u above | 6 u / 3 u | Tightened chase |
| DENSITY_REDUCTION 0.75 (old) | 0.55 | More aggressive late-game scaling |
| `MAX_SHIP_SPEED` 80 | 88 | Slight speed bump |
| `SHIP_ACCELERATION` 40 | 44 | Slight accel bump |
| `void_drift_high_score` (old) | `void_drift_highscore` | Key renamed |
