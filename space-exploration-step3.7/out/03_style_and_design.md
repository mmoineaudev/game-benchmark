# 03 — Visual / Style / UX Design Language

> Reverse-engineered visual identity, color, typography, motion, and interaction contracts.  
> See `[Ref:01-§n]` for technical backing, `[Ref:02-UC-XX]` for behavioral triggers.  
> Cross-doc spec anchors use `[Spec:03-§X]` for this doc, `[Spec:01-§n]` for architecture.

---

## 3.1 Brand & Genre Identity [Ref:03-3.1]

- **Genre:** Cinematic "zen" space exploration — "Void Drift".
- **Core feeling:** Sparse beauty, powerful motion, minimal UI intrusion.
- **Reference motifs:** 1960s muscle-car aesthetic fused with deep-space sci-fi; dusk/dark palette with neon cyan accents.
- README self-description: *"Visual immersion is the main goal; shooting is supporting."* [Ref: README.md:5]

---

## 3.2 Color & Light Palette [Ref:03-3.2]

### 3.2.1 Master Palette

| Token | Hex | Role | Where Used |
|-------|-----|------|-----------|
| Background | `#111827` | Scene background, fog, fog-exp color | `Constants.SCENE.BACKGROUND_COLOR/FOG_COLOR/DENSITY` [Ref:01-1.2] |
| HUD primary | `#7adfff` | UI text, game-over cyan | `index.html:18` |
| HUD glow | `#4aaaff`, `#2255aa` | HUD text-shadow | `index.html:19` |
| Health green | `#22cc66 / #44ee88` | Hull bar healthy | `index.html:70`, HUD.js:46 |
| Health yellow | `#cccc22 / #eeee44` | Hull bar warning | HUD.js:48 |
| Health red | `#cc2222 / #ee4444` | Hull bar critical | HUD.js:49 |
| Warning red | `rgba(255,40,40,…)` | Inset vignette border pulse | `index.html:131` |
| Ship body | `0xcc3311` (mat), `0x111111` (trim) | Main hull, dark accents | `PlayerShip.js:52-53` |
| Cockpit glass | `0x88ccff` (0.7 transparent) | Windshield transmission | `PlayerShip.js:81` |
| Engine accent | `#44aaff` / `#aaddff` | Engine glow sprites | `Constants.SHIP.ENGINE_COLOR/ENGINE_GLOW_COLOR` |
| Accent light | `#4466ff` (0x4466ff) | Interior point light | `Constants.SHIP.ACCENT_COLOR`, `PlayerShip.js:38` |
| Laser | `#00ffaa` | Projectile + impact flash | `Constants.WEAPON.LASER_COLOR` |
| Explosion base | `0xffaa00` | Particle color default | `ParticleSystem.js:117` |
| Planet sets | 7 presets, e.g. `[0x111133, 0x332244, 0x446688, 0x3388aa]` | Surface + rim | `PlanetManager.js:104-112` |
| NPC palette | 6 bright hues | Per-NPC colored traffic | `NPCShipManager.js:8` |

### 3.2.2 Fill Lights on Scene Graph
- Directional sun `0xddeeff` / fill `0x5577aa` / rim `0x335577` / hemisphere sky `0x334466` / ground `0x0a0a0a` [Ref: Game.js:77-93].

---

## 3.3 Typography & HUD Layout [Ref:03-3.3]

### 3.3.1 DOM HUD Map

| Element | CSS Class / ID | Size | Placement |
|---------|---------------|------|----------|
| Score label | `.hud-label` | 10px, `letter-spacing:4px` | Top-left block |
| Score value | `#score-display .hud-value` | 22px, `letter-spacing:2px` | Top-left block |
| Distance label/value | same | 22px | Top-right block |
| Hull bar | `#health-fill` | 10px bar, 320px width, rounded pill | Bottom-center |
| Crosshair | `#crosshair` + 4 `.crosshair-dot` | 34px square | Center |
| Warning | `#warning-overlay` | inset shadow + border ring | Fullscreen |
| Game-over panel | `#game-over` | h1: 56px, stats: 22px | Centered overlay |
| Pause screen | `#pause-screen` (imperative DOM) | h1 44px, p 18px | Center |

- **Font family:** `Courier New, monospace` (and the same in imperative pause screen Inline CSS).
- **Glow model:** Two-layer `text-shadow` (tight 0 0 6px at 4aaaff + wide 0 0 12px at 2255aa).
- Is consistent with `pulse` animation for restart hint (1.5s).

### 3.3.2 HUD State Visuals
- Hull bar transitions:
  - >60%: green gradient `linear-gradient(90deg, #22cc66, #44ee88)`.
  - 30-60%: yellow gradient `linear-gradient(90deg, #cccc22, #eeee44)`.
  - <30%: red gradient `linear-gradient(90deg, #cc2222, #ee4444)`.
- Health bar damage flash: `brightness(2) saturate(0.5)` for 100ms.

---

## 3.4 Motion Language & Feedback [Ref:03-3.4]

### 3.4.1 Speed-Reliant Effects

| Effect | Driver | Curve / Behavior |
|--------|--------|-----------------|
| FOV zoom | `speedRatio ∈ [0,1]` | MIN_FOV=60 → MAX_FOV=110, lerp ×3 per second |
| Bloom strength | `speedRatio` | min 0.7 → max 1.35 |
| Chromatic aberration offset | `speedRatio` | max offset 0.012 when max thrust |
| Ship engine flame scale | `speedRatio` | 0.6 + 0.9*speedRatio at idle; ×1.6 with yaw |
| Engine glow opacity | `speedRatio` | 0.08 + 0.28*speedRatio, scale 1.4→3.6 |
| Accent light intensity | `speedRatio` | 0.8 + 1.2*speedRatio |
| Reactor glow opacity | `speedRatio` + abs(yaw)| 0.15 + 0.2*speedRatio + abs(yaw)*0.25 |
| Starfield streak | `uSpeed` in vertex shader | `streakLength = speed * 0.5`; stars elongate radially |
| Point size speed bump | `uSpeed` | `+ speed * 2.0` additive |
| Twinkle brightness | speed | `*(1.0 + speed*0.3)` |
| Engine audio pitch | `speedRatio` | 55 Hz → 180 Hz |
| Engine audio volume | thrusting → `0.12 + speed*0.15`, idle 0.05 |

### 3.4.2 Camera Language
- **Follow cam:** Player + `FOLLOW_HEIGHT=6` up + `FOLLOW_DISTANCE×zoomFactor` back along ship quaternion axis.
- **Look target offset:** `-2.5` up, `-14` back from ship (dynamic).
- **Shake:** Raster random displacement × `shakeAmount`, exponential decay `pow(0.001, dt)`. Mapped to:
  - Small asteroid: 0.5
  - Debris: 0.2
  - Ship-landing collision: 0.3 (small), 0.8 (isLarge).

### 3.4.3 Impact Feedback Pipeline
1. Impact occurs.
2. Physics emits `'physics:collision'` or `'weapon:destroy'` events.
3. Game listens and calls:
   - `HUD.damageFlash()` + `HUD.screenFlash(color, duration)` for UX.
   - `CameraSystem.triggerShake(amount)` for visceral impact.
   - `ParticleSystem.createExplosion(...)` or `createSparks(...)` for spatial feedback.
   - `AudioSystem.playExplosion(size)` / `playCollision()` / `playWarning()` for audio feedback.

---

## 3.5 Post-Processing Design [Ref:03-3.5]

### 3.5.1 Pipeline Order
```
RenderPass → UnrealBloomPass → ChromaticAberration → Vignette → FilmGrain → OutputPass
```

### 3.5.2 Pass Behaviors
- **Bloom:** Threshold 0.35, radius 0.4; intensity adaptive [Ref:03-3.4].
- **Chromatic Aberration:** Radial RGB offset `(vUv - 0.5) * uOffset`; disabled on ≤4-thread CPUs.
- **Vignette:** Smoothstep edge from offset 0.22 with 0.3 transition; darkness 0.6.
- **Film Grain:** Hash-based per-pixel noise; intensity 0.025; animated by `uTime` uniform; disabled on ≤4-thread CPUs.
- **Tone mapping:** ACES Filmic, exposure 1.2 [Ref:01-1.2].

---

## 3.6 Ship Visual Design [Ref:03-3.6]

### 3.6.1 Model Parts (all Three.js primitives)
1. **Body** — Box 2.0×0.55×4.2, metallic red `0xcc3311`, roughness 0.25, metalness 0.7.
2. **Hood** — trimmed Box 1.7×0.15×1.4, dark `0x111111`, at front.
3. **Nose** — hemisphere (half-sphere) with low aspect.
4. **Deck/Trunk** — Box + trim panels.
5. **Cockpit** — `MeshPhysicalMaterial` glass (`transmission:0.7, thickness:0.1`).
6. **Wings** — Box 1.4×0.08×0.8, dark red.
7. **Nacelles** — Cylinder, per wing, dark `0x223344`.
8. **Reactor rings** — TorusGeometry 0.2 radius × 0.04 tube, engine-color emissive.
9. **Tail fins** — vertical Boxes with rotation skew.
10. **Skid strip** — bumper on belly.

### 3.6.2 Dynamic Lighting / Effects
- Headlight SpotLight (white, 0.55 intensity, 18 range, mid-penumbra).
- Accent PointLight (blue 0x4466ff, 0.6 intensity, 8 range).
- Tail lights (two small spheres with emissive red 0xff3300).
- Engine glow sprite on nacelle area + two reactor glow sprites.

### 3.6.3 Flame Shader Behavior
- Vertex displacement `(sin(t*15+y*12), cos(...)) * 0.03 * thrust`.
- Fragment: bright core at base, gradient to engine color at tip; alpha `(1-t²)*(0.75+flicker)`.
- Two flame cones per wing; yaw active-wider, one increases size by 1.6×.

---

## 3.7 Particle System Visual Design [Ref:03-3.7]

### 3.7.1 Exhaust Particles
- Pool of 120 `Points` objects, each with single position attribute in memory.
- Simple velocity drag @0.95; max life 0.3-0.7s.
- Additive blending; color `ENGINE_COLOR=0x44aaff`; size ~0.18 u.
- No built-in shaders — uses raw `PointsMaterial`.

### 3.7.2 Explosions
- Dynamic `Points` pool, 20-40 particles per explosion (size-tier scaled).
- Per-particle velocity in 3D shell (speed 20-60, sizeTier×); drag 0.98.
- Orange `0xffaa00` additive.
- Max life 0.5-1.1s by size.

### 3.7.3 Sparks
- 15 cyan/green particles via shared function arg color.
- 0.14 size; max life 0.3s.

### 3.7.4 Shooting Stars
- ~12-32 point seg forming a streak behind velocity direction.
- Colors from `COLORS` `[0xffccaa, 0xaaccff, 0xccffee, 0xffddcc]`.
- 0.12 point size; opacity 0.55-0.85 additive.

---

## 3.8 Biome Visual Language [Ref:03-3.8]

Biomes change chunk-level generation priors. They primarily encode **atmosph colors, density, and active wormholes** rather than mechanically different enemies.

| Biome | Distance | Key Visuals | Color Profile |
|-------|----------|------------|---------------|
| Open Space | 0-1000 | Sparse asteroids/debris | Cool blues/teals |
| Asteroid Belt | 1000-3000 | Dense rock fields, warm lights | Orange/amber tint |
| Nebula Corridor | 3000-5000 | Volumetric nebula billboards, many | Purple/pink/cyan fbm clouds |
| Wormhole Tunnel | 5000-7000 | Cylindrical tunnel mesh + pulsing | `0x332266` torso, `0x221144` emissive, frosted glass backface |

- Biomes cycle every 7000 u once past end via modulo. Intensity scales with distance no upper biome cap — cosmic density increases indefinitely.

---

## 3.9 Atmosphere Objects [Ref:03-3.9]

- **Stars:** 4-layer parallax point cloud (far/mid/near/bright). Far layer has 1800 stars; bright 40.
- **Shooting stars:** Low-frequency meteoric streaks with trailing gas.
- **Nebulae:** 5-13 billboard planes per cluster, each with simplex-noise fragment shader and additive blending; 1 cluster / chunk at minimum, up to ~ dynamically scaled.
- **Planets:** Large `IcosahedronGeometry` with animated `band()` cos/sin flow shader. Fresnel rim glow. Optional atmosphere shell (backside).

---

## 3.10 UI Micro-Interactions & Controls Layout [Ref:03-3.10]

### Visible Controls (per README)
- **W/A/S/D** ✗ **Mismatch note:** Actual implementation binds:
  - **ShiftLeft** → Thrust
  - **Space** → Brake
  - **Left/Right Arrows** → Yaw
  - **Up Arrow** → pitch down (nose down)
  - **Down Arrow** → pitch up (nose up)
  - **F** → Fire
  - **M** → Mute
  - **R** → Restart on game over

The README mentions "W/A/S/D" and "Mouse", but mouse is **not implemented** in source; there is no pointer-lock or pointermove listener anywhere in `src/`.

### Canonical Input State Diagram
```
Down Arrow  ──► pitch rate -1 * rate * dt
Up Arrow    ──► pitch rate +1 * rate * dt
Left Arrow  ──► yaw   +1
Right Arrow ──► yaw   -1
Shift       ──► thrust=true
Space       ──► brake=true
F (held)    ──► fire on Game._attemptFire()
M (once)    ──► AudioSystem.toggleMute()
R (dead)    ──► Game._restart()
Space (init) ─► start game from paused screen
```

---

## 3.11 Sound Design Language [Ref:03-3.11]

- **Engine rumble:** Continuous, sawtooth-based; low-pass filtered. Pitch and loudness connect to perceived velocity.
- **Laser:** Short breathy saw sweep — sci-fi staccato.
- **Explosion:** Low-pass filtered noise burst — rumble feel. Longer duration = bigger size.
- **Collision:** Similar noise burst, shorter, softer — impacts feel "crunch" vs "boom".
- **Warning:** 3-tone sine beep at low volume. Only audible ≤30 HP; internal rate limit 1.5s prevents spam.

---

## 3.12 Performance-Oriented Design Constraints [Ref:03-3.12]

- `setPixelRatio(Math.min(dpr, 2))`: caps retina rendering.
- Hardware concurrency <= 4 skips Chromatic Aberration + Film Grain shader passes.
- GPU instancing for medium/small asteroids and debris.
- Particle pools pre-allocated (exhaust) or reuse recycled explosion instances.
- Exhaust spawn capped per frame: `ceil(3 + speedRatio*5)` ~ 3-8 per frame.

---

## 3.13 Accessibility, Polish, and UX Gaps Identified [Ref:03-3.13]

1. **Mouse controls are missing** despite README claiming them. This is a content vs. implementation mismatch.
2. **No settings screen.** Audio mute is the only toggle; no resolution/graphics settings.
3. **No onboarding beyond** PAUSED overlay and a single line of controls.
4. **Crosshair** is purely decorative (pure CSS, no center dot); useful as aim feedback is absent.
5. **No color-blind mode** or UI scaling.
6. **No controller support** — keyboard-only.
7. **Loading screen** DOM node referenced in code (`loading-screen`) is expected from secondary `index.html` that is *not* shipped in repo as a game HUD element; `public/index.html` exists but its text is not shown in the spec.
8. **Popular web designs** (linear segmented nav, card UI) are **not used** — this game's UI is minimal sci-fi HUD; no card layout, no routes.
