# 04 — Implementation Plan

> Implemented by step-3.7-flash. This plan explicitly maps each objective back to the three specs above and elevates five god-tier enhancements. Sections marked **God-Tier** should be treated as "icebox but documented" additions.

## Legend

- `↗01` → reference to `01_architecture.md`
- `↗02` → reference to `02_functional_use_cases.md`
- `↗03` → reference to `03_style_and_design.md`

---

## Phase 0 — Stabilize the surface (1–2 days)

### 0.1 Unify input legend and bindings
**Reference:** `↗01 §10`, `↗02 §3`
**Problem:** README lists WASD + mouse steer, but the code binds arrows + Shift for thrust + `Space` as brake. There is no WASD strafe and no mouse look in inspected files.
**Action:**
1. Define a single `INPUT_SCHEME` in `Constants.js`.
2. Either implement WASD translation into system or update README + pause screen + launcher copy to match the arrow-only reality.
**Priority:** P0 (ship feel).
**Open question:** Do we re-add mouse steer? If yes, schedule into Phase 1.

### 0.2 Fix projectile-removal indexing mismatch
**Reference:** `↗02 §5.2`, `↗01 §10`
**Problem:** When `WeaponSystem.update` removes a projectile from `_projectiles`, it passes the now-stale index to `GameState.removeProjectile(i)`. Can desync state arrays.
**Action:** Refactor so GameState owns projectile data fully, or track removal via UUID/object keys.
**Priority:** P0 (correctness bug).

### 0.3 Make instanced destructibles hitable
**Reference:** `↗02 §5.2`, `↗02 §7.3`
**Problem:** `PhysicsSystem.checkProjectileCollisions` skips `instanced` asteroids/debris. Projectiles pass through instanced geometry.
**Action:** Maintain a parallel broadphase list per frame of instanced collidables; ray/sphere test against de-duplicated per-frame flats.
**Priority:** P1 (makes combat meaningful).

### 0.4 Dispose nebula cluster geometry on chunk cleanup
**Reference:** `↗02 §7.3`
**Problem:** `NebulaSystem.clear()` disposes cluster materials but the shared `this._sharedGeo` is galaxy-scoped; when `ChunkManager.destroy` runs it may be needed again if rebuild path is reused, but `destroy` is full teardown.
**Action:** Make nebula geo lifespan explicit — shareGeo creator should own refcounted lifecycle.
**Priority:** P2 (memory rarer in browser sessions but real).

### 0.5 Unify HTML variants
**Reference:** `↗01 §10`
**Problem:** Four HTML files exist (`index.html`, `game.html`, `public/index.html`, `public/game.html`) with slightly different DOM IDs but overlapping feature sets.
**Action:** Choose one canonical game entrypoint (prefer `index.html`) and redirect `/game.html`. Delete stale launcher variant or fold it into `public/index.html`.
**Priority:** P1 (prettiness).

### 0.6 Audio autoplay policy UX
**Reference:** `↗01 §10`, `↗02 §9`
**Problem:** AudioContext requires gesture. The code attaches click+keydown listeners, so users can launch with no sound until they touch input.
**Action:** Show a subtle "sound on" toast after first gesture and force `AudioContext.resume()`.
**Priority:** P2 (polish).

---

## Phase 1 — Competitive loop (3–7 days)

### 1.1 Add WASD strafe + mouse steer
**Reference:** `↗02 §3`, `↗03 §9`
**Problem:** Arrow-only yaw/pitch makes combat feel dated vs the README promise.
**Action:**
1. Expand `InputSystem` to emit `input:mouse` events.
2. Map pitch/yaw from pointer lock or center-crosshair delta.
3. Map WASD → world-frame lateral thrust; compute lateral velocity component via `right` and `up` axes.
**Priority:** P1 (core gameplay feel).
**Open question:** Pointer lock vs non-lock mouse? Pointer lock maximizes FPS feel; non-lock is friendlier to casuals.

### 1.2 Reverse brake
**Reference:** `↗02 §4.1`
**Problem:** Brake clamp stops at 0; no retro thrust.
**Action:** Allow `targetForwardSpeed` negative, then clamp to `[-MAX_SPEED * 0.3, MAX_SPEED]` to give a "drift/brake-boost" feel. Allow pitch/yaw to continue to rotate ship arbitrarily so dodging stays crisp.
**Priority:** P1 (feel).
**God-Tier spin:** Combine with **Kino-style blur streaks** where camera streak length is a function of velocity magnitude, tuned via post-processing.

### 1.3 Real instanced hit testing (parallel broadphase)
**Reference:** `↗02 §5.2`, `↗01 §Module Dependency Map`
**Plan:**
1. Each frame, from `ChunkManager` build per-frame "hit-proxies" for instanced geometry (position + radius).
2. Feed into `PhysicsSystem.checkProjectileCollisions`.
3. Mark individual instance destroyed rather than whole mesh when small asteroids.
**Priority:** P1.
**Open question:** Should large instanced meshes survive partial destruction? Probably yes, per-instance kill-flag.

### 1.4 Per-instance debris destruction
**Reference:** `↗02 §7.3`
**Action:** Debris is currently collision-cosmetic. Tie destruction to score and slight health restore on crystal collection to set a risk/reward loop.
**Priority:** P2.

### 1.5 Ammo / overheat arcade layer
**Reference:** `↗03 §9`
**Action:** Introduce a heat/cooldown bar; clipping on overheat silences weapons with a per-coil sound; alternate fire strategies (single/charge).
**Priority:** P2.

---

## Phase 2 — Production quality (1–2 weeks)

### 2.1 Settings/volume persistence
**Reference:** `↗03 §11`
**Action:** Store masterSFX/masterMusic volumes + first-run boot flag in localStorage; expose a minimal settings menu overlay with sliders.
**Priority:** P1.

### 2.2 Visual landing / pickup feedback
**Reference:** `↗02 §7.3`, `↗03 §9`
**Problem:** Collected crystals vanish silently.
**Action:** Spawn a short burst of +50 floating text at collection position using CSS or Three.js sprite billboard.
**Priority:** P2.

### 2.3 Save system beyond high score
**Reference:** `↗02 §6`, `↗01 §8`
**Action:** Save last-run distance + unlocked aura/cosmetic unlocks into `localStorage`. Use a dotted versioned schema to handle forward migration.
**Priority:** P2.

### 2.4 Controller support
**Reference:** `↗02 §3`
**Action:** Add `Gamepad API` reader; map sticks to yaw/pitch + thrust + fire. Rumble on collision proportional to shake magnitude.
**Priority:** P3.

### 2.5 Accessibility layers
**Reference:** `↗03 §10`
**Action:**
- HUD text scaling + high-contrast palette override.
- Screen-reader-friendly `aria-live` regions for score/health.
- Colorblind-safe palette preset.
**Priority:** P3.

### 2.6 Environmental audio cues
**Reference:** `↗03 §11`, `↗02 §7.3`
**Problem:** Entry into different biomes is silent.
**Action:** Crossfade ambient "tonal zone" filter based on `BiomeGenerator.getCurrentBiome(name)` with low drones.
**Priority:** P2.

### 2.7 Browser compatibility / low-end detection
**Reference:** `↗01 §9`, `↗02 §13`
**Action:** Enhance `_detectLowEnd` to use `WEBGL_debug_renderer_info`, GPU memory budget, and `OffscreenCanvas` availability; fall back to `MeshBasicMaterial` when `roughnessMap` causes thermal throttling.
**Priority:** P2.

### 2.8 Performance profiling + worker offload
**Reference:** `↗01 §9`
**Action:** Move `BiomeGenerator`, chunk seed PRNG jobs, and nebula instancing into a `Worker` so the main thread has a steady ≤5 ms spare when spawning.
**Priority:** P3.

---

## Phase 3 — God-Tier Enhancements (icebox but fully specified)

### God-Tier 1: Session-Scoped Query Logging Layer
**Reference:** `↗01 §6`, `↗02 §5`
**Specification:**
- Build a wiretap over `EventBus.emit` that writes structured JSONL logs: `{ ts, event, data, deviceContext:{ cores, dpr, gpu, fpsBucket, hpBucket } }`.
- Surface via dev console command `window.__game.logging.pipe(fn)` and a file-download button.
- Adds a query language that can filter: `game:tick AND action:fire AND damage>0`.
- Makes *why something failed* discoverable without attaching debugger.
**Difficulty:** Medium.
**Impact:** High for gameplay QA and support.

### God-Tier 2: Optimistic Cache / Lock File for Feature Flags
**Specification:**
- Replace ad-hoc Settings with a feature-flag manifest in `localStorage` and a shadow `pending_flags.jsonl` log.
- On toggle, write the new value to a `pending` index, apply the optimistic UI change immediately, then replay confirmed state after 300 ms.
- If the parent app opens a new tab, share state via `BroadcastChannel`.
- For offline VR scenarios, this becomes the only reliable "read your writes" path.
**Difficulty:** Medium.
**Impact:** Extremely high for multi-window / headless users.

### God-Tier 3: ParityDB Write Monitor with Scan-to-Speech
**Reference:** `↗01 §8`, `↗03 §9`
**Specification:**
- Integrate a tiny ParityDB-style write monitor that reports success/failure via `SpeechSynthesisUtterance` "Write conflict resolved / now in sync" on event completion.
- Use an exponential back-off cooldown matching `AudioSystem._warningCooldown` so events don't overlap.
- Add a headless VR mode flag that treats audio as primary UX, not decoration.
**Difficulty:** Low.
**Impact:** Accessibility/VP/headless productivity.

### God-Tier 4: Virtual Browser Link Resolver for Clean Parity
**Reference:** `↗01 §10`, `↗02 §13`
**Specification:**
- Build a `BrowserVerifier` class that loads launcher and game overlay pages in a hidden iframe, walks the visible text for screenshot comparison with an upstream mirror page, and emits a single `visual:diff` event with pixel-delta counts.
- Provide a CLI runner via `vite-plugin-mock-upstream` so CI can build, preview, and compare in one command.
- Exposes pre-generated mirror pages with exact href canonicalization on the `/mirror/` route.
**Difficulty:** High.
**Impact:** Creates a "markdown-for-games" mirror protocol.

### God-Tier 5: Observer-Pattern Settings Storm Shield
**Specification:**
- Block repeated settings writes inside a 150 ms window; persist only the last effective value.
- Visualize active settings via a debug overlay showing `current / pending / conflicts`.
- For multiplayer fan mods, this reduces desync by honoring reads-after-writes as the canonical source.
**Difficulty:** Low.
**Impact:** Prevents desync and user-induced collisions.

---

## Open Questions (kept across all phases)

1. **Networking destiny**: Is this ever going online (leaderboards, co-op)? Affects event serialization, anti-cheat, and save locations.
2. **Asset budget**: Should we keep the pure-procedural no-texture stance, or bake a skybox cubemap for nebula transition?
3. **Save format**: localStorage alone has a ~5 MB cap, works locally, but no sync. Do we want `IndexedDB` so replays can be saved?
4. **Mod/plugin surface**: Are scaling collectibles moddable via JS/JSON config? Should `CollectibleSystem` be driven by a manifest?
5. **Resolution target**: The low-end gate is `navigator.hardwareConcurrency <= 4`. What counts as mid-range in 2026? Does this gate correctly reflect GPU-bound bloom ops?

---

## Phased Summary Table (priority within phase)

| ID | Name | Tier | Priority | Spec refs |
|---|---|---|---|---|
| 0.1 | Unify input legend/bindings | Phase 0 | P0 | `↗01 §10`, `↗02 §3` |
| 0.2 | Fix projectile-removal index bug | Phase 0 | P0 | `↗02 §5.2`, `↗01 §10` |
| 0.3 | Make instanced destructibles hitable | Phase 0 | P1 | `↗02 §5.2`, `↗02 §7.3` |
| 0.4 | Dispose nebula geo lifecycle | Phase 0 | P2 | `↗02 §7.3` |
| 0.5 | Unify HTML variants | Phase 0 | P1 | `↗01 §10` |
| 0.6 | Audio autoplay UX toast | Phase 0 | P2 | `↗02 §9` |
| 1.1 | WASD strafe + mouse steer | Phase 1 | P1 | `↗02 §3`, `↗03 §9` |
| 1.2 | Reverse brake / drift mechanic | Phase 1 | P1 | `↗02 §4.1` |
| 1.3 | Real instanced hit testing | Phase 1 | P1 | `↗02 §5.2` |
| 1.4 | Per-instance debris destruction/value | Phase 1 | P2 | `↗02 §7.3` |
| 1.5 | Ammo / overheat arcade layer | Phase 1 | P2 | `↗03 §9` |
| 2.1 | Settings/volume persistence | Phase 2 | P1 | `↗03 §11` |
| 2.2 | Visual landing / pickup feedback | Phase 2 | P2 | `↗02 §7.3`, `↗03 §9` |
| 2.3 | Save system beyond high score | Phase 2 | P2 | `↗02 §6`, `↗01 §8` |
| 2.4 | Controller support | Phase 2 | P3 | `↗02 §3` |
| 2.5 | Accessibility layers | Phase 2 | P3 | `↗03 §10` |
| 2.6 | Environmental audio cues | Phase 2 | P2 | `↗03 §11`, `↗02 §7.3` |
| 2.7 | Low-end detection + material fallbacks | Phase 2 | P2 | `↗01 §9`, `↗02 §13` |
| 2.8 | Worker offloading for chunk seed PRNG | Phase 2 | P3 | `↗01 §9` |
| GT1 | Session-scoped query logging layer | God-Tier | Medium | `↗01 §6`, `↗02 §5` |
| GT2 | Optimistic cache/lock for feature flags | God-Tier | Medium | — |
| GT3 | ParityDB write monitor + speech | God-Tier | Low | `↗01 §8`, `↗03 §9` |
| GT4 | Virtual browser link resolver + mirror CI | God-Tier | High | `↗01 §10`, `↗02 §13` |
| GT5 | Observer-pattern settings storm shield | God-Tier | Low | — |

---

## Final Note

Forward references in god-tier section hint at the intended build of the next spec package: **session query logging + mirror parity CI + observable settings store**. Use the trailing category-defined specs above as a strong auxiliary prompt for the next model: "implement god-tier tier A, objective O, spec ref S".

---

*The package is complete. The parent case-study will lead with these four documents.*
