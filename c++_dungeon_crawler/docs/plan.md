# Dungeon Crawler — C++ Rebuild Plan

Rebuild of `ox-alpha_dungeon_crawler` (Three.js + Vite, ~5.5k LOC) in native C++.
Source of truth for *what to build*: `~/Documents/prompt-library/dungeon-crawler-visual-specv2.md` (v2).
Reference implementation (behavior to match): the JS game at `../ox-alpha_dungeon_crawler/`.

---

## 0. Honest framing (read first)

- **Why C++ here, honestly.** The JS version's perf pain was *algorithmic* (entity counts, light counts, post passes, per-frame work), not the language. C++ won't magically fix those. What C++ *does* give: no JS/GC, no WebGL/JS-bridge overhead, full control of the frame loop, allocation, and GPU submission — i.e. **headroom and control**. On an RTX 4080 the 30 fps floor becomes trivially met, leaving room to *scale the game up* (bigger dungeons, more entities, richer post) without breaking the floor. That is the real win.
- **What "faithful" means.** Match every *binding* spec value: all numbers, rules, state transitions, and technical mechanisms (gen algorithm, collision model, pooling, disposal, render-pipeline structure, camera layers, budgets). Graphics *look* is free per the spec — we keep the same look, not a pixel match.
- **The thing that makes this safe:** the spec already ships a **headless, deterministic verification suite** (dungeon-check over 40 seeds, formula-check over Constants, and a boss/aggro live check). We **port that suite to C++ and use it as the parity gate.** Same seed → same dungeon; same formula → same number; boss dormant→wake→take damage→die. That turns "does it feel the same?" into an objective pass/fail on every change. This is the differentiator and it's why this rebuild is low-risk.
- **Crashes stop being black boxes (the "death loop" fix).** In JS, a crash was a silent tab death — no stack, no core dump, nothing in the console. In C++ the same failure is a `SIGSEGV`/`SIGABRT` with a native stack trace and a core dump, and — because the sim is deterministic and headless — **the exact seed + input sequence that crashed can be replayed without a browser and stopped at the crashing frame** under ASan/UBSan, which names the exact line (use-after-free on a disposed system, OOB pool write, uninit read). A watchdog also dumps state on a hung frame (>0.25 s, the same threshold as the degraded-mode hitch) instead of the browser just freezing. Details in §3.4.

---

## 1. Load-bearing decisions (defaults are recommendations; override any of them)

| # | Decision | Recommendation | Why / alternative |
|---|---|---|---|
| D1 | **Renderer** | **OpenGL core profile (GLFW)** ✅ chosen | Lower boilerplate, faster to ship, still fully native; core profile (3.3+) has instancing, VAOs, FBOs — everything the spec's render structure needs. (Vulkan remains the later upgrade path behind the same `dc_render` interface if headroom is ever needed — the sim/verification are renderer-agnostic.) |
| D2 | **Architecture** | **System-mirror 1:1** of the JS module map | Lowest-risk for a *faithful* port; each JS system → one C++ module with the same update order, so parity is provable per-system. (Can refactor to ECS later if you want; not needed for parity.) |
| D3 | **Scope** | **Vertical slice → full parity** | Ship a playable slice first (core loop + 1 biome + 1–2 mobs + sword/orb + 1 boss + HUD), then expand to full spec parity. Matches iterative dev; parity checklist is derived from spec §24 + §26. |
| D4 | **Toolchain** | CMake + g++/clang, GLFW 3, OpenGL core (stb/gl headers), Catch2 | All present except GLFW (install in Phase 0). No game engine — from-scratch, per spec. |
| D5 | **Determinism** | **Single-threaded sim, fixed-step** | Mirrors JS rAF; keeps the sim deterministic so the ported verification suite is meaningful. Render is decoupled (can be multi-threaded later). |

---

## 2. Target architecture

Four CMake targets in one repo (`dc_core`, `dc_render`, `dc_app`, `dc_repro`):

```
ox-dungeon-crawler-cpp/
  CMakeLists.txt
  include/ dc/            # public headers
  src/
    core/                 # -> dc_core  (static lib, NO GPU, deterministic)
      constants.hpp       #   ALL numbers from Constants.js (the data contract)
      rng.hpp            #   mulberry32 (identical to JS)
      dungeon_gen.cpp    #   §5 generator (rooms/MST/corridors/dead-ends/entrance-exit)
      world.cpp          #   WorldBuilder: geometry build + collision AABBs (thick*0.6)
      collision.cpp      #   circleHitsBox / resolveCircleCollisions + 0.08u sub-stepping
      movement.cpp       #   player + enemy movers, LOS ray-march, greedy pathing
      combat.cpp         #   sword combo, orb weapon, buffs, electric/arc-bolt, damage formulas
      skeleton_system.cpp#  spawner/queue/reveal pacing/per-type AI/boss hookup (mirrors SkeletonSystem)
      state.cpp          #   GameState (serializable run state) + save/load schema
      leaderboard.cpp    #   top-10 (file-backed, mirrors localStorage + save-server)
    render/               # -> dc_render (static lib, renderer-agnostic interface)
      opengl/             #   core profile: VAOs, instancing, FBOs, 1 shadow pass, post (bloom+enemy-glow)
      null_renderer.cpp   #   headless: drives sim, no GPU (used by the parity tests)
    app/                  # -> dc_app (executable)
      main.cpp            #   GLFW window+input, main loop, HUD overlay, title/death screens
      input.cpp           #   event.code physical-key mapping (AZERTY-safe, per spec §2)
    repro/                # -> dc_repro (executable, headless, no GPU)
      repro.cpp           #   replays (seed, input-script, frame) -> stops at the crashing frame;
                          #   ASan/UBSan build + signal handler + frame watchdog (§3.4)
  tests/                  # Catch2: ported verification suite (headless, no GPU)
  docs/
```

- **`dc_core` is where parity lives** and is testable with no GPU (via `null_renderer` / direct test driver).
- **Renderer-agnostic interface** (a `Renderer` abstraction: `init`, `beginFrame`, `submitInstancedDraw`, `submitShadow`, `submitPost`, `present`, `dispose`) is what makes D1 a swappable module *and* lets the headless parity tests run without a GPU.
- **Pools** mirror spec §13 exactly (48+6 orb slots, 8 arc bolts, 10 arrows, 12 enemy orbs, 8/6 rings, 9 smoke, 30 dust, 60 stalactites, 24 water, …). **Zero per-frame heap in hot paths** (the §13 contract becomes a C++ RAII/`std::array`+index pool contract).
- **Threading:** single-threaded sim for determinism first. (Optionally split to a sim thread + render thread in Phase 3 if profiling says so — not required for the floor.)

### Module map (1:1 with the JS — the parity unit)
| JS file | C++ module |
|---|---|
| `core/Constants.js` | `core/constants.hpp` |
| `core/GameState.js` | `core/state.cpp` |
| `core/Collision.js` | `core/collision.cpp` |
| `core/Leaderboard.js` | `core/leaderboard.cpp` |
| `core/EventBus.js` | direct callbacks / small event bus (C++) |
| `core/Game.js` (orchestrator) | split: level lifecycle in `app/main.cpp`, systems update order preserved |
| `world/DungeonGenerator.js` | `core/dungeon_gen.cpp` |
| `world/WorldBuilder.js` | `core/world.cpp` |
| `world/BiomeSystem.js` | `core/biome.cpp` (palette/sequence/lazy texture cache) |
| `world/PropSystem.js` | `core/props.cpp` |
| `entities/SkeletonSystem.js` | `core/skeleton_system.cpp` |
| `entities/Skeleton.js` + `enemies/*` | `core/enemies/*` (skeleton, rat, wraith, brute, armored, archer, boss, burning) |
| `entities/PlayerSword.js` | `core/sword.cpp` |
| `entities/OrbShooter.js` | `core/orb_shooter.cpp` |
| `entities/OrbSystem.js` | `core/orbs.cpp` |
| `entities/Hunter.js` | `core/hunter.cpp` |
| `systems/InputSystem.js` | `app/input.cpp` |
| `systems/LightingSystem.js` | `core/lighting.cpp` (placement/budget) + `render/` (actual lights/shadow) |
| `systems/Smoke/Particle/Rune/PostProcessing` | `core/*` (state) + `render/*` (draw/post) |

---

## 3. Determinism & verification (the parity gate — the core of the plan)

Port the spec's headless suite into `tests/` and run it on **every change** (pre-commit + CI):

1. **`dungeon_check`** (port of `scripts/dungeon-check.mjs`): run the C++ seeded generator over 40 seeds; mirror WorldBuilder collision (0.3×0.6, player r 0.35); BFS from entrance; assert `escapes=0, unreachableInside=0, disconnected=0`; report avg rooms / avg exit distance. **Same seed must produce the same layout** — and ideally we assert it equals the JS output for a pinned seed set (golden files) to prove *cross-implementation* parity, not just self-consistency.
2. **`formula_check`** (port of `scripts/formula-check.mjs`): pure-function checks over `constants.hpp` — tier thresholds 50/100/200/400/800 + 11-point ceiling table, sword damage ladder 2/2/3→7/7/8, `swordSizeScale`, `attackSpeedFromSouls`, `orbDamageMultiplier`, explosion, electric, boss base HP (25, current tuning) + wealth/hearts halved-stack, spawn-weight columns sum to 100, per-biome eligible room weight ≥ 100, `enemyHpMultiplier` linear overflow, BURN HP. **Guarantees every formula is bit-identical.**
3. **`boss_aggro_check`** (port of `scripts/boss-aggro-check.mjs`): headless sim driver (no GPU) that descends to level 7 and asserts: boss dormant at spawn (no teleport), wakes on LOS, chases, blink-nova damages player, **sword damages the boss**, boss kill increments `bossKills`. This directly protects the exact bugs we just fixed in the JS version.
4. **Invariants** (port of the smoke "in-game invariants"): memory stable over 3 descends; camera + sword survive regens; a `window.game`-equivalent QA handle exposed in `dc_app` for headless probing.

### 3.4 Crash diagnostics (turning "browser died with no error" into a reproducible bug)
The JS version's failures were silent tab deaths — no stack, no core dump, empty console. This section is how the C++ build makes every crash debuggable:

- **Repro harness (`dc_repro`, headless)**: the sim is single-threaded, fixed-step, and seeded, so a crash is fully reproducible from `(seed, input-script, frame)`. `dc_app`/`dc_repro` records a lightweight **input+frame trace** (or accepts a replay file) so the exact sequence that crashed in-game can be run headlessly (no GPU, no browser) and stopped at the failing frame.
- **Sanitizer builds in CI**: the verification suite runs under **AddressSanitizer + UndefinedBehaviorSanitizer** (and a ThreadSanitizer build if/when we go multi-threaded). The exact bug classes that silently killed the browser — use-after-free on a disposed system, out-of-bounds pool write, uninit read — are caught here with the offending line, not a dead tab.
- **Signal handler + watchdog**: `dc_app` installs a `SIGSEGV`/`SIGABRT`/`SIGFPE` handler that dumps a native stack trace + a core dump (and, in the repro harness, the current `GameState` + system pointers). A frame watchdog flags a hung frame (>0.25 s, the same threshold as the degraded-mode hitch) and dumps where the loop is stuck instead of the browser just freezing.
- **Result**: "the browser crashed with no console error" becomes "repro #N crashes at frame K in `SkeletonSystem::update` — `std::out_of_range` / use-after-free on `GhostBoss`", which is a fixable bug, not a mystery.

> Golden-file cross-parity (C++ vs JS) is optional but high-value: pin ~10 seeds + a few formula inputs, emit C++ output, diff against JS output. If you want it, Phase 1 produces it.

---

## 4. Phases (each has a concrete exit / verification)

### Phase 0 — De-risk (≈1 day)
- Install toolchain gaps: `libglfw3-dev` (and OpenGL headers via `libgl-dev`/`mesa` — or just ship `gl/glext.h` via stb/opengl).
- CMake scaffold (3 targets) + GLFW window with an **OpenGL 3.3 core context** + **one instanced lit mesh + 1 shadow pass (FBO depth) + 1 bloom post pass (ping-pong FBOs)**.
- Stand up `dc_core` with `rng` + `dungeon_gen`; port `dungeon_check` (40 seeds).
- **Exit:** 60 fps lit instanced box with shadow + bloom on the 4080; `dungeon_check` green. (If GL ever proves limiting, Vulkan is the documented upgrade behind `dc_render` — no sim/verification change.)

### Phase 1 — Deterministic core (≈3–5 days)
- Port `Constants` → `constants.hpp`; port `formula_check`.
- Port collision + sub-stepped movement + LOS + greedy pathing + WorldBuilder collision.
- Port `GameState` + save/load schema + leaderboard.
- Stand up the **crash-diagnostics layer** (§3.4): `dc_repro` headless harness, ASan/UBSan test build, signal handler + frame watchdog.
- **Exit:** `formula_check` + `dungeon_check` green; a headless sim can spawn/move/resolve a player through generated dungeons with zero tunneling; save/load round-trips; **a synthetic UAF/OOB injected into the sim is caught by ASan and reproduced by `dc_repro`** (proves a real crash is now a debuggable bug). (Optional golden-file cross-parity vs JS.)

### Phase 2 — Vertical slice (≈1–2 weeks) — *playable*
- Camera (pointer-lock look) + input (physical-key mapping, AZERTY-safe).
- Player movement + 1 biome (STONE) + instanced world build (floor/ceiling/walls) + 1 shadow-casting torch.
- 1–2 enemy types (skeleton + rat), sword combo (cone, hit-stop, damage), orb weapon (pooled), orbs=souls, 1 boss (SPECTRAL_COURT) with **aggro-on-sight + 25 HP (current tuning)**, exit portal + descend.
- HUD (hearts, souls, timer, weapon slot), 30 fps floor + degraded mode, title/death screens, save + leaderboard.
- **Exit:** playable vertical slice; headless `boss_aggro_check` green; 30 fps on 4080 with headroom.

### Phase 3 — Full parity (≈2–4 weeks)
- All enemy types (armored/archer/brute/wraith/burning + 7 boss variants), all 10 biomes + SPECTRAL_COURT.
- Props/breakables/hazards (lava/acid), all 5 buffs + HUNTER companion, arc bolts + electric proc + 6 weapon-evolution forms.
- Full post (bloom + enemy-glow render-target passes), smoke/particles/runes/water, NG+ + full save/leaderboard, per-biome light budgets, degraded-mode decoration reduction.
- **Exit:** full spec parity; **all verification green**; 30 fps floor across the heaviest biomes (VOLCANIC_DEPTHS / FROZEN_HALLS); memory stable over 3 descends.

---

## 5. Performance plan (30 fps floor → headroom)

- **OpenGL core instancing** (`glDrawElementsInstanced` / `glDrawArraysInstanced`) for all repeated geometry (floors/ceilings/walls/debris/stalactites/water = 1 draw call each), per spec §13/§5.4.
- **Shadows:** exactly 1 shadow-casting light, static assignment at level build, 256² map (spec §12.1) — a single shadow pass, no per-frame re-sort (the JS hitch source).
- **Post:** bloom (5% rule) + enemy-glow (half-res render target → separable gaussian → composite) as render passes (spec §12.2).
- **Pools + zero per-frame allocation** (§13 contract) via RAII + fixed `std::array` index pools.
- **§22 budgets stay the contract** (1 shadow light, ≤120 draw calls, ≤400 prop instances, light ceilings, degraded-mode 50% decoration cut). On the 4080 expect 100+ fps — the headroom is the point.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| GL boilerplate / perf ceiling | Phase-0 spike first; core-profile GL on a 4080 is far above the 30 fps floor. If headroom is ever needed, **Vulkan is the documented upgrade** behind `dc_render` (sim/verification unchanged). |
| Parity drift (C++ ≠ JS) | **Ported verification suite as the gate**, run on every change; optional golden-file cross-parity vs JS. |
| Scope creep | Vertical slice first; parity checklist derived from spec §24 + §26; one system at a time, each verified before the next. |
| Toolchain gaps | Phase 0 installs GLFW (+ GL headers if not via system) — confirmed missing today. |
| Determinism vs render decoupling | Single-threaded fixed-step sim; render behind an interface with a `null_renderer` for headless tests. |

---

## 7. Effort (solo, focused)

- Playable vertical slice: **~1–2 weeks.**
- Full spec parity: **~4–7 weeks** total.
- (Phase 0+1 give a verified, headless-provable core in ~a week.)

---

## 8. Immediate next steps
1. **D1 is decided: OpenGL core (GLFW).** Nothing left to choose — start building.
2. Install `libglfw3-dev` (+ GL headers if not already); the project repo is at `~/Documents/games-benchmarks/ox-dungeon-crawler-cpp/` (this plan lives in `docs/`).
3. Run **Phase 0**: CMake scaffold + GLFW/OpenGL-core window + instanced lit mesh + shadow + bloom, and `dc_core` (rng + dungeon gen) with `dungeon_check` green.
