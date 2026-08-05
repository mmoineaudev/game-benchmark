# Dungeon Crawler Visual — Performance Enhancement Plan

**Goal:** Eliminate the recurring "big lag every few seconds" and make the degraded mode actually trigger, actually help, and keep a 30fps floor.

**Current state (measured by code inspection):** the frame pipeline is ~55+ render passes at full res (1 main pass + 48 point-light cube-shadow depth passes + ~5 post passes + 1 half-res enemy pass + 2 blurs), plus per-frame CPU allocation churn. The degraded-mode detector is structurally unable to see the symptom it was built for (spikes, not sustained low fps), and when it does fire it only cuts decorative props — not the actual cost drivers.

---

## Diagnosis (evidence, file:line)

### A. Why "big lags every few seconds"

1. **8 cube-shadow point lights = 48 depth passes per frame.**
   - `src/core/Constants.js:43-44` — `TORCH_SHADOW_COUNT: 8`, `TORCH_SHADOW_MAP: 256`.
   - Three.js renders PointLight shadows as cube maps = **6 scene depth renders per light**, every frame. 8 lights ≈ 48 extra full-scene renders per frame, each at 256². With `PCFSoftShadowMap` (`Game.js:158`) this dominates the GPU frame time.
2. **Shadow re-assignment every 0.5 s causes allocation + toggle spikes.**
   - `src/systems/LightingSystem.js:209-212` — `update()` sorts *all* torches every 0.5 s (`_updateShadowCasting`, line 217: `[...this.torches].sort(...)` → GC churn) and **toggles `light.castShadow`** on the nearest-8 boundary (line 226-235). Enabling `castShadow` mid-game allocates 6 new shadow render targets and forces the renderer to rebuild shadow state → a visible hitch. While the player moves, the nearest-8 set changes constantly → repeated hitches every ~0.5 s. This is the "every few seconds" signature.
3. **50+ point lights in a forward renderer.** Torches + braziers + crystals + decorative lights (candles, chains, lava/acid pools) + headlight + portal + sword lights. Every in-range object is shaded per light, and three.js **recompiles shaders when the per-object light count changes** (lights entering/leaving range while walking) → further move-dependent hitches.
4. **Post pipeline is expensive and unconditional.**
   - `src/systems/PostProcessing.js:95-139` — EffectComposer with full-res `UnrealBloomPass` (multi-pass, full res) + saturation pass + enemy-glow pass.
   - `PostProcessing.js:163-199` — every frame, when any enemy is alive: an **extra full-scene render at half res** + 2 full-screen gaussian blurs.
5. **Per-frame CPU/GC churn.**
   - `PostProcessing.js:144-159` — `setEnemyTargets` allocates a `new Set()` and `traverse()`s every enemy group **every frame**; `_enemyMeshes` replaced wholesale.
   - `Game.js:1734-1736` — `_updateStatsPanel` rebuilds 11-row `innerHTML` **every frame** (DOM parse + node replacement + layout invalidation).
   - `Game.js:1641` — `querySelectorAll('.pip')` every frame; `Game.js:1637` — `borderBottomColor` style write (string build) every frame.
   - `src/systems/ParticleSystem.js:75-76` — `performance.now()` called twice per particle per frame.
   - Skeleton AI (`SkeletonSystem.js:518-555`) — `_hasLOS` raycast per archer **per frame**, substep collision resolution per mob.

### B. Why degraded mode never applies (`src/core/Game.js:638-650`)

```js
_updatePerfMonitor(dt) {
  if (this._degraded || this._titleActive) return;
  if (dt <= 0 || dt > 0.25) return;              // ← the actual hitches are EXCLUDED
  const fps = 1 / dt;
  this._fpsEma = this._fpsEma * 0.95 + fps * 0.05;
  if (this._fpsEma < 30) this._lowFpsTime += dt; // ← needs EMA BELOW 30
  else this._lowFpsTime = 0;
  if (this._lowFpsTime > 10) { ... }             // ← …sustained for 10 s
}
```

1. **EMA (0.95/0.05) is spike-blind.** A 1 s hitch at 5 fps moves the EMA from 60 to ~57 — it needs *sustained* <30 fps, but the actual symptom is *periodic* spikes. 10 s of continuous sub-30 fps is never reached.
2. **The worst frames are excluded.** `dt > 0.25` (the big hitches themselves) are skipped entirely.
3. **Degraded only cuts cosmetics.** `reduceDecorations(0.5)` hides decorative props/lights — none of the cost drivers (torch cube shadows, light count, post-processing, HUD thrash).

---

## Target numbers

- p95 frame time ≤ 33 ms (30 fps floor), no frame > 150 ms outside level regen.
- Shadow depth passes: 48 → ≤ 6 (one nearest torch) or 0 (no dynamic shadows).
- Frame-time budget: render ≤ 24 ms, CPU/JS ≤ 8 ms, leaving headroom so spikes don't cross the budget.

---

## Phase 1 — Instrument first (prove the diagnosis)

**Objective:** Add a repeatable perf probe so every later phase is verified against real numbers, not vibes.

**Files:**
- Modify: `src/core/Game.js` (expose counters)
- Create: `scripts/perf-probe.mjs`
- Modify: `package.json` (`"probe"` script)

**Step 1: expose live counters on `window.game`.** In `Game.js` `_animate()` (line 566), before `this.post.render()`, accumulate frame stats:

```js
// Frame stats for headless perf probes (cheap: 3 adds + 1 shift per frame)
this._frameStats = this._frameStats || { n: 0, sum: 0, max: 0, p95buf: [] };
const fs = this._frameStats;
fs.n++; fs.sum += this._delta;
if (this._delta > fs.max) fs.max = this._delta;
fs.p95buf.push(this._delta);
if (fs.p95buf.length > 300) fs.p95buf.shift(); // 5 s at 60 fps
```

Also expose counts in `_animate()`: `renderer.info.render.calls`, `renderer.info.render.triangles`, `scene` light count (walk `scene.children` once per second into `this._lightCount`).

**Step 2: `scripts/perf-probe.mjs`** — copy the CDP harness from `scripts/browser-smoke.mjs` (lines 1-38), then:
- boot `npx vite --host 127.0.0.1 --port 5173` and headless chromium (`--remote-debugging-port=9228`, see browser-smoke header);
- `Runtime.evaluate` `window.game.state.player.x += 1` every 100 ms for 30 s to simulate movement through the level;
- every 1 s read `window.game._frameStats` + `renderer.info` + light count; keep `window.game` healthy with `awaitPromise: true`; log per-second snapshots;
- exit code 1 on: p95 > 33 ms, any frame > 150 ms, or console exceptions.

**Step 3: baseline run.** Record before/after numbers per phase. Expected baseline: p95 well over 33 ms, max frames > 150 ms, `renderer.info.render.calls` in the hundreds, light count 50+.

**Verify:** `node scripts/perf-probe.mjs` runs clean and prints the baseline table.
**Commit:** `perf: add frame-stat counters + headless perf probe`

---

## Phase 2 — Fix degraded mode (make it fire, make it help)

**Objective:** Spike-aware detection with escalation tiers that cut the real cost drivers, plus automatic recovery. This directly fixes "the degraded mode does not apply despite this".

**Files:**
- Modify: `src/core/Game.js` (replace `_updatePerfMonitor`, lines 38-42 + 632-650; add tier application hooks)
- Modify: `src/systems/LightingSystem.js` (add `setShadowBudget(count)`)
- Modify: `src/systems/PostProcessing.js` (add `setEnabled(false)` — already exists via `enabled` flag; wire it)
- Modify: `index.html` (perf-warning label text reflects the active tier)

**Step 1: replace the detector with a rolling bad-frame counter.**

```js
// Spike-aware: counts "bad" frames in a rolling ~3 s window.
// A 50 ms frame counts 1, a >250 ms hitch counts 3 (they are the worst
// offenders — previously excluded entirely).
_updatePerfMonitor(dt) {
  if (this._titleActive) return;
  if (dt <= 0) return;
  this._perfWindow.push(dt);
  this._perfSum += dt;
  while (this._perfSum > 3) this._perfSum -= this._perfWindow.shift();
  const bad = dt > 0.05 ? (dt > 0.25 ? 3 : 1) : 0;
  this._perfBad += bad;
  if (this._perfBad >= 6) { this._setDegradedTier(this._degradedTier + 1); this._perfBad = 0; }
  // Recovery: a clean 10 s (rolling window with no bad frames) drops one tier
  if (this._perfBad === 0 && this._degradedTier > 0) {
    this._recoverTimer = (this._recoverTimer || 0) + dt;
    if (this._recoverTimer > 10) { this._setDegradedTier(this._degradedTier - 1); this._recoverTimer = 0; }
  } else this._recoverTimer = 0;
}
```

Init `_degradedTier = 0`, `_perfBad = 0`, `_perfWindow = []`, `_perfSum = 0` in the constructor (replace lines 40-42).

**Step 2: tier application.** `_setDegradedTier(t)` clamps `[0..3]`, sets `_degradedTier`, applies cumulatively:
- Tier 1 — `this.props.reduceDecorations(0.5)` (existing) + warning label.
- Tier 2 — `this.lighting.setShadowBudget(0)` (all torch shadows off — the 48-pass cost dies here).
- Tier 3 — `this.post.enabled = false` (composer off → plain `renderer.render`, `PostProcessing.js:225-227` already handles this) + second `reduceDecorations(0.5)` for the remainder.

Each `reduceDecorations` call is idempotent per prop (add a `hidden` flag check in `PropSystem.reduceDecorations`, `PropSystem.js:740+`). Update the perf-warning label to show `DEGRADED (tier N)`.

**Step 3: `LightingSystem.setShadowBudget(count)`.** Set `LIGHTING.TORCH_SHADOW_COUNT = count` and call `_updateShadowCasting` once. Make `_updateShadowCasting` **static-safe** (Phase 3 removes the per-frame call; with count 0 every torch gets `castShadow = false`).

**Verify:** from the browser console run `window.game._setDegradedTier(2)` → shadow pass count drops to 0 (probe shows renderer.info shadow-map renders / frame time drop); `_setDegradedTier(0)` restores. Simulate the detector: `window.game._perfBad = 5; window.game._updatePerfMonitor(0.1);` → tier 1 fires within a frame.
**Commit:** `perf: spike-aware degraded mode with cost-cutting tiers`

---

## Phase 3 — Shadow budget (the biggest win)

**Objective:** 48 cube-shadow passes per frame → ≤ 6, and no mid-game shadow allocation.

**Files:**
- Modify: `src/core/Constants.js:43-44`
- Modify: `src/systems/LightingSystem.js:172-238`

**Step 1: cut the count.** `TORCH_SHADOW_COUNT: 8` → `1` (single nearest torch = 6 cube faces). If the probe still shows > 33 ms p95 on the target hardware, go `0` (torch shadows off entirely; keep sconce/geometry shadows via the existing castShadow flags on world meshes — they don't cast unless a shadowed light exists).

**Step 2: make shadow assignment static — delete the 0.5 s re-sort.**
- Remove the `_updateShadowCasting` call from `update()` (`LightingSystem.js:209-212`).
- In `init()` (after `_placeAllTorches`), pick the `TORCH_SHADOW_COUNT` torches nearest to the entrance room, set `light.castShadow = true` once, and configure their shadow cameras (`LightingSystem.js:229-235` logic, moved into a `_assignStaticShadows()`). All other torches keep `castShadow = false` for the whole level.
- Keep `_updateShadowCasting` as the one-shot re-assign used only by `setShadowBudget` (Phase 2 tier 2).

This removes the per-0.5 s `[...torches].sort()` allocation *and* the castShadow-toggle allocation spikes entirely. Tradeoff: shadows don't follow the player across the level — acceptable; the nearest torch to the spawn covers most of the first room, and Tier-0 visual cost is massively lower.

**Step 3: cheaper soft shadows.** `Game.js:158` — `THREE.PCFSoftShadowMap` → `THREE.PCFShadowMap` (PCFSoft re-samples 9x on point lights; PCF is ~1/3 the cost with a barely visible quality loss at 256²).

**Verify:** probe shows shadow-pass count 48 → 6, p95 frame time drops sharply (expect ~10-15 ms recovered), no console errors, `browser-smoke.mjs` still passes.
**Commit:** `perf: static 1-torch shadow budget + PCF shadow map (48→6 depth passes)`

---

## Phase 4 — Light budget (kill the shader-recompile spikes)

**Objective:** cut total point lights by ~50%, removing move-dependent shader recompiles and per-light shading cost.

**Files:**
- Modify: `src/core/Constants.js` (LIGHTING + PROPS counts)
- Modify: `src/world/PropSystem.js` (decorative lights → emissive only)

**Step 1: torch spacing** `LightingSystem.js:62` — `spacing: 16` → `20` (torches −~20%; keeps every room readable). 

**Step 2: decorative lights off.** In `PropSystem.js`:
- `_spawnChain` (line 377) — the chain-brazier `PointLight`: remove the light, raise the flame `MeshBasicMaterial` color/emissive so it still reads as fire.
- `_spawnCandle` (line 554+) — same: candle flame becomes emissive-only, no light.
- Lava/acid pools: keep pool glow on the material, drop per-pool `PointLight` (find in the pool spawn path, ~line 200), unless the biome probe shows headroom.
- This also makes `reduceDecorations` (degraded T1) cheaper to apply — fewer lights to hide.

**Step 3: crystal/brazier caps.** `LightingSystem.js` — `_placeCrystals` clusters of 3-5 (line 391): cap at 3; brazier count per room: cap at 2 (find the count in `init`/room walk).

**Step 4: emissive bakes for static glow.** Where a light's only job is a glow pool (crystals, portal), keep the light *only* if `LIGHTING` distance < 12 — small-radius lights contribute less to the per-object light count. (Optional; skip if probe after Phase 3 already meets budget.)

**Verify:** probe reports light count down ~50%; walk-through (simulated movement) shows no frame spikes correlated with room transitions; visuals still readable (biome palette + emissive carries the mood).
**Commit:** `perf: cut light count ~50% (emissive bakes, spacing, caps)`

---

## Phase 5 — Post-processing budget

**Objective:** halve post cost without visible change to the ~5% effects.

**Files:**
- Modify: `src/systems/PostProcessing.js`

**Step 1: bloom at half res.** In `init()` (line 105) and `resize()` (line 240): `this.bloomPass.resolution.set(Math.max(1, Math.floor(w/2)), Math.max(1, Math.floor(h/2)))`. UnrealBloom is a multi-pass downsample/upsample chain — half-res input roughly quarters its cost. At 5% strength the difference is invisible.

**Step 2: enemy glow half-rate + quarter-res.** In `render()` (line 206):
- skip `_renderEnemyGlow()` on alternate frames (`this._glowTick = (this._glowTick + 1) % 2; if (this._glowTick) this._renderEnemyGlow();`) — the glow is a slow pulse, 30 Hz is plenty;
- `rtOpts` targets at `Math.floor(w/4)` (lines 127-132);
- early-out when nothing to glow: already returns on empty `_enemyMeshes` (line 164) — keep, and also skip when `enemyDist > 60` (nothing visible anyway).

**Step 3: stop allocating per frame.** `setEnemyTargets` (line 144): reuse one `Set` — `this._current.clear(); this._current.add(...)` during the traverse, then diff against `_enemyMeshes`; only re-traverse when the caller's group count changes (Game.js calls it every frame with `_hlTargets` — change the call site at `Game.js:620-627` to a cached roster: rebuild `_hlTargets` only when `skeletons.skeletons.length` or the alive-count changes).

**Verify:** probe p95 drops (expect another ~3-6 ms); game still shows glow + bloom at 5%; `browser-smoke.mjs` passes; VISION/xray path (which forces the composer on) still renders.
**Commit:** `perf: half-res bloom, half-rate quarter-res enemy glow, zero per-frame Set churn`

---

## Phase 6 — CPU/GC/HUD hygiene

**Objective:** remove per-frame DOM rebuilds and hot-loop allocations (GC pauses are the silent "every few seconds" contributor).

**Files:**
- Modify: `src/core/Game.js` (`_updateStatsPanel` 1734-1736, `_updateHUD` 1637/1641, `_animateWater` 1604-1613)
- Modify: `src/systems/ParticleSystem.js:75-76`
- Modify: `src/entities/SkeletonSystem.js` (`_hasLOS`)

**Step 1: cache the stats panel.** In `_updateStatsPanel`, build the HTML string, compare to `this._statsCache`, and skip `innerHTML` when identical:

```js
const html = rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join('');
if (html !== this._statsCache) { this._statsEl.innerHTML = html; this._statsCache = html; }
```

Most frames change nothing → zero DOM work. (Init `_statsCache = ''` in constructor.)

**Step 2: cache DOM lookups.** Query `.pip` nodes once in `init()` into `this._comboPips`; store `pal.fog` as a precomputed hex string at level start instead of rebuilding `#${...toString(16).padStart(...)}` per frame (Game.js:1637).

**Step 3: water animation** — freeze when the player is > 20u from the puddle (`_animateWater`), and/or only update `needsUpdate` when values actually moved. Minor, but it's a per-frame VBO upload.

**Step 4: particle loop** — hoist `performance.now()` out of the per-particle loop into `const now = performance.now();` above the loop (ParticleSystem.js:75-76).

**Step 5: LOS cache** — in `SkeletonSystem`, cache `_hasLOS` results per skeleton keyed by target cell, invalidated every 0.25 s (stagger per skeleton with `(skel.id * 0.05) % 0.25`). Cuts archer raycasts ~4x.

**Verify:** probe shows JS time (from `_frameStats` deltas minus renderer.info.render time via `performance.now()` around `post.render()`) under 8 ms; no DOM layout jank (longtask observer in probe: zero `longtask` > 50 ms after warmup).
**Commit:** `perf: cache HUD DOM writes, hoist hot-loop allocs, stagger LOS raycasts`

---

## Phase 7 — Verification gate + regression

**Objective:** prove the 30 fps floor holds and degraded mode works end-to-end.

**Files:**
- Modify: `scripts/perf-probe.mjs` (final thresholds)
- Run: `scripts/browser-smoke.mjs` (existing regression)
- Create: `scripts/degraded-check.mjs` (or fold into probe)

**Step 1: automated gate.** `perf-probe.mjs` asserts, after warmup, over 30 s with simulated movement:
- p95 frame ≤ 33 ms; max frame ≤ 150 ms;
- zero `PerformanceObserver('longtask')` entries > 50 ms;
- no console errors; `window.game._degradedTier === 0` on a healthy machine.

**Step 2: degraded end-to-end.** Headless scripted run: force the detector via synthetic bad frames (`window.game._perfBad = 5; _updatePerfMonitor(0.1)`) → assert tier 1 label visible, `props._decoratives` hidden count > 0; `_setDegradedTier(2)` → `lighting.torches.every(t => !t.light.castShadow)`; `_setDegradedTier(3)` → `game.post.enabled === false`. Then recovery: 11 s of clean `_updatePerfMonitor(0.016)` → tier 0.

**Step 3: manual QA** (you): play 3 levels on the dev server, confirm torch shadows still ground the scene, glow reads at ~5%, and no recurring hitch cadence. Visual checks stay headless-per-user-preference — I won't rely on screenshots.

**Step 4: commit discipline.** Repo root is the parent `games-benchmarks` repo (check `git rev-parse --show-toplevel`). **Commit + push after every phase**, not at the end: `perf: <phase>` messages as listed.

---

## Risks / tradeoffs / open questions

- **Shadows:** static single-torch shadows mean far rooms have no dynamic shadow; sconces/geometry keep their existing cast flags. If the look matters more than perf on the target machine, `TORCH_SHADOW_COUNT: 2` is the fallback (12 passes, still −75%).
- **Light cuts:** torch spacing 16→20 changes rhythm slightly in halls; emissive bakes are the compensation.
- **Post:** half-res bloom at 5% strength is visually identical in practice; enemy glow at 30 Hz is imperceptible (it pulses at ~0.5 Hz).
- **Open question:** what's the target GPU (integrated vs discrete)? The Phase-3 fallback (shadows → 0) is only needed for iGPU-class hardware.
- **Tier-3 recovery:** post toggling back on after 10 clean seconds re-enables the composer — one-time cost, acceptable.

---

## Phase summary (for the commit log)

| Phase | What | Expected win |
|---|---|---|
| 1 | Instrument + probe | measurable baseline |
| 2 | Spike-aware degraded tiers | degradation actually fires & helps |
| 3 | 48→6 shadow passes, static assignment, PCF | biggest single win (~10-15 ms) |
| 4 | Lights −50% (emissive bakes) | removes move-dependent shader recompiles |
| 5 | Half-res bloom, half-rate glow | −3-6 ms |
| 6 | HUD/DOM/GC hygiene | removes GC + layout pauses |
| 7 | Gate + regression | p95 ≤ 33 ms proven |
