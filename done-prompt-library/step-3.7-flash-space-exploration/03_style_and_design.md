# 03 — Style & Design

> Implemented by step-3.7-flash. Aesthetic analysis sourced from HTML/CSS, material/color constants, shaders, and particle/spawn configs.

## 1. Visual Design Language

| Concept | Manifestation |
|---|---|
| Palette | Deep-space near-black backgrounds (`#111827`), cyan HUD accents (`#aaccff`/`#7adfff`), red danger/`#ff4444`, orange/teal laser (`#00ffaa`), blue engine flame (`#44aaff`). |
| Typography | Monospace throughout — `Courier New` on HUD and HTML overlays; technical/sci-fi connotation. |
| Transparency & Glass | HUD panels: `rgba(4, 14, 28, 0.55)` backgrounds, `backdrop-filter: blur(4px)`; blur-glass panels. |
| Glow | Frequent neon text-shadows/blur (`0 0 12px rgba(100,150,255,0.8)`), additive blending for particles, bloom post-process amplifies emissives. |
| Shape vocabulary | Rounded HUD blocks (`border-radius: 10px`), pill health bar. Ship: box-based "1960s muscle car" geometry, cockpit glass transparency, nacelle cylinders, ring torii. |

## 2. Aesthetic Intent

Reading the code linearly: the authorship intention is **immersion first, clarity second**. The ship reads as a red mid-century cruiser through volumetric nebula clouds, feeling at once high-performance racing and "Last Starfighter" nostalgia. The cockpit glass with `transmission: 0.7` and the主角 `145` pinkish tint reinforce a "tropical glass spaceship" vibe. Engine nacelles on wings and glowing exhaust cones suggest twin-reactor configuration even though movement is single-axis.

## 3. HUD Design

### 3.1 Structure
- Top HUD (score left, distance right).
- Bottom center health bar, labeled `HULL INTEGRITY`.
- Center reticule crosshair.
- Low-health warning: animated full-screen red inset glow via `#warning-overlay` with `@keyframes warningPulse`.
- Damage flash: transient colored overlay for 80–150ms.
- Game-over: centered overlay with score, distance, high-score, pulsing restart hint.

### 3.2 Color-coded health states
- >60%:-green gradient (`#22cc66` → `#55ffaa`).
- 30–60%:yellow gradient (`#cccc22` → `#eeee44`).
- ≤30%:red gradient (`#cc2222` → `#ee4444`).

## 4. Ship Visual Language

| Part | Implementation | Visual role |
|---|---|---|
| Fuselage | Box geometry + hemisphere nose | Red metal body, high metalness/roughness, broad horizon |
| Hood Deck / Trunk | Trim boxes | Dark, almost black, panel lines |
| Windshield | Box + `transmission: 0.7` glass | Cyan/teal tint; depth by transparency |
| Wings | Red wing boxes | Color continuity with body |
| Nacelles | Cylinders on wing tips | Dark metal, transition to ship form |
| Rings | Torus geometries, engine color emissive | "Reactor glow" touchpoints |
| Fins | Trims + rotation | Muscle-car gesture |
| Headlight | SpotLight + target 18 units ahead | Illuminates environment while moving |
| Accent light | Point light near cockpit | Blue rim illumination |
| Reactor glows | Sprites with additive blend | Ambient engine glow at nacelles |
| Tail lights | Red emissive spheres | Navigation,1 visible in all orientations |
| Engine flames | ShaderMaterial cones per nacelle | Core visual feedback for speed/thrust/yaw |
| hit-flash | emissive emissiveIntensity 0.8 red on damage | Instant readback "took a hit" |

## 5. VFX / Post-Process Language

| Effect | Role | Trigger |
|---|---|---|
| Bloom | Emissive "pop": engines, lasers, explosions, stars | Speed-locked range 0.7–1.35 |
| Chromatic Aberration | Speed-induced lens artifact, adds cinematic warping | Only on non-low-end hardware; tied to speedRatio |
| Vignette | Darkens edges, focuses eye on center crosshair | Constant, tunable darkness 0.6 / offset 0.22 |
| Film Grain | Tactile, analog космос texturing | Constant; intensity 0.025 |
| Damage flash | Red full-screen wash | Collision |
| Screen flash | Orange for asteroid kills / gray for debris | Kill proxied via `chunkManager.destroyAsteroid` |

### FOG
- `FogExp2(0x111827, 0.0018)` unifies distant geometry to background color, creating infinite recede.

## 6. Audio Language

- **No EDM/music:** purely source-generated SFX + 1 engine drone oscillator.
- Engine drone: sawtooth, filtered low-end rumble 55–180 Hz; volume modulated by thrust + speed.
- Lasers: descending saw chirp (800–200 Hz), aggressive timbre.
- Explosions: white noise burst with size-based lowpass, supporting feeling of scale.
- Collision: low-thud noise, smaller impact emotion.
- Warning beeps: triple intermittent beeps; implied "hull integrity critical" emotional tone.

## 7. Biome Aesthetics

| Biome | Emotional tone | Color signature |
|---|---|---|
| Open Space | Quiet, serene, speed | Cool blues, minimal nebula density |
| Asteroid Belt | Hazy, industrial | Warm ambers/browns, dense rocks |
| Nebula Corridor | Mysterious, painterly | Saturated purple/cyan blobs, additive clouds |
| Wormhole Tunnel | Psychedelic, fast | Tunnel cylinder + vivid purple/teal nebula bands |

- Biome parameters also scale `nebulaDensity`, `asteroidDensity`, `debrisCount` by intensity multiplier, so later biomes compress visually but with more saturated fixtures.

## 8. Camera & Motion Design

- **Chase view:** behind and above the ship, look target biased downward/backward (-Y, -Z) so you always see the horizon.
- **Speed feel:** FOV widens at high speed; bloom brightens; chromatic aberration appears; stars streak at greater speed ratio.
- **Camera shake:** triggered by combat/collisions; magnitude differentiates asteroid hit (0.5/0.8) vs debris (0.2) — supports "punch" language.
- **Zoom:** scroll/wheel zoom not evident in source; resolved only via external EventBus routes.

## 9. Controls & Feel Analysis

| Control | Current feel | Issue |
|---|---|---|
| Thrust (`Shift`) | Rate-limited linear accel; speed ratio drives nearly every sensation | No inertia beyond velocity hold; rate feels same at low/high delta |
| Brake (`Space`) | Decel to zero only—**cannot reverse** | Frustrating in tight corridors; no drift/retro |
| Yaw/Pitch (Arrows) | Rotates at base rate modulated by speed ratio (0.6–1.0 multiplier) | No lateral strafe or boost missile option |
| Fire (`F`/Space/mouse?) | Single-column lasers with recoil kick | No spread, no ammo, no overheat—arcade-y |
| Mute (`M`) | Instant global mute of master + engine buses | No fade; abrupt |

### Missing "feel" elements
- **No drift:** ship velocity is zeroed on each frame into forward vector—this removes Newtonian joy.
- **No lateral feel:** no G-turn, no hang-time banking animations tied to side-input (yaw only).
- **No environmental hazard audio:** entering an asteroid belt doesn't escalate ambient tone.
- **No visual landing/pickup feedback:** crystals go invisible the instant collected with no HUD increment flash.

## 10. Animation / Pacing

- Scene is everything-at-once; no menus/missions.
- Tension is created by: increasing debris density, bloom intensity, and screen shake over longer runs, plus the red warning pulse when health < 30.
- Restart is instant; no fade-to-black or vignette-out.

## 11. Audio Vision Summary

| Layer | Role | Implementation |
|---|---|---|
| Engine drone | Baseline identity | Continuous oscillator; tracks thrust/speed |
| Laser/explosion FX | Combat clarity | Short, sharp saw/noise bursts |
| Warning beeps | Hull state cue | OSHA-like triple beep at ≤30 HP |
| No ambience | — | No asteroid wind, no engine layer alternation |
| Mute | Accessibility | Global gain mute; config toggle |

## 12. Title Screen Aesthetic

- Minimal typographic launcher: `VOID DRIFT` headline + subtitle with `Courier New`, twinkling CSS radial-gradient star field, one `LAUNCH` button with hover inversion.

## 13. Cross-References

- Ship palette → `Constants.SHIP.*` → Game architecture, weapon bloom relationship: `PostProcessingSystem.updateBloom` + `WeaponSystem.fire` in `01_architecture.md`.
- Biome palette → `BiomeGenerator.getBiomeParams` + `NebulaSystem` fragment shader (`NEBULA_FRAGMENT_BODY`) — see `02_functional_use_cases.md` §7.4.
- HUD/flash behavior → `HUD.js`, `Game._showPauseScreen`, inline pause screen — same file as pause behavior in `02_functional_use_cases.md` §12.

---

*Next:* `04_implementation_plan.md` proposes rebuild priorities tied back to these specs and flags god-tier enhancements.
