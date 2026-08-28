# Crash diagnostics (§3.4) — "the browser died with no error" → a debuggable bug

In JS a crash was a silent tab death: no stack, no core dump, nothing in the
console. In C++ the same failure is a `SIGSEGV`/`SIGABRT` with a native stack
trace and a core dump — and because the sim is **deterministic and headless**,
the exact `(seed, input, frame)` that crashed can be replayed without a browser
and stopped at the failing frame, under ASan/UBSan, which names the exact line
(use-after-free on a disposed system, OOB pool write, uninit read).

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Crash handler | `include/dc/crashdiag.hpp` + `src/core/crashdiag.cpp` | `installCrashHandler(ctx)` catches SIGSEGV/SIGABRT/SIGFPE/SIGBUS/SIGILL, dumps the current `CrashContext` (frame/seed/pos/phase) + a native backtrace (`backtrace_symbols_fd`), then re-raises for a core dump. Installed by both `dc_app` (render loop) and `dc_repro` (sim loop). |
| Frame watchdog | `crashdiag.hpp::FrameWatchdog` | Flags a **hung frame** (>0.25 s, the same threshold as the degraded-mode hitch) instead of the process just freezing: prints `HUNG FRAME <el> at: <phase>`. |
| Repro harness | `src/repro/repro.cpp` (`dc_repro`, no GPU) | Drives the headless sim: generate a dungeon, spawn the player at the entrance, stream them to the exit with sub-stepped + collision-resolved movement, and check **zero tunneling** after every frame. Accepts a fault to *inject* a synthetic crash and prove the diagnostics. |
| Sanitizer build | `-DDC_SANITIZERS=On` (CMake option) | Adds `-fsanitize=address,undefined -fno-omit-frame-pointer` to every target. This is the build that names the exact crashing line for a real (or injected) UAF/OOB. Use a `Debug` build for a readable report. |

## Proving a real crash is now a debuggable bug

```
# clean headless sim (no GPU) — the ZERO-tunneling gate
./build/dc_repro --seed 1000 --frames 300
#   → [dc_repro] seed 1000 biome STONE grid 15 boxes 110: ran 300 frames, exit 0

# synthetic UAF (use-after-free on a disposed system) — caught by ASan
cmake -S . -B build_asan -DCMAKE_BUILD_TYPE=Debug -DDC_SANITIZERS=On
cmake --build build_asan -j --target dc_repro
./build_asan/dc_repro --seed 1000 --frames 50 --fault uaf --fault-at-frame 5
#   → ERROR: AddressSanitizer: heap-use-after-free ... repro.cpp:43 in tick
#     (#1 main repro.cpp:114)   ← the exact crashing frame

# synthetic OOB (heap-buffer-overflow) — caught by ASan
./build_asan/dc_repro --seed 1000 --frames 50 --fault oob --fault-at-frame 5
#   → ERROR: AddressSanitizer: heap-buffer-overflow ... repro.cpp:121 in main

# plain SIGSEGV (any build, no sanitizer) — the installed handler fires
./build/dc_repro --seed 1000 --frames 50 --fault segv --fault-at-frame 7
#   → [dc_crash] signal=SIGSEGV frame=7 seed=1000 pos=(18.31, 12.35) phase=fault-injection
#     [dc_crash] native backtrace (6 frames): ...
#   (exit 139 / SIGSEGV, stopped at exactly the injected frame 7)
```

So "the browser crashed with no console error" becomes "repro #N crashes at
frame 7 in `SimSystem::tick` — heap-use-after-free on a disposed system", which
is a fixable bug, not a mystery.

## Build & test

```
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
cd build && ctest                 # dc_tests + dc_repro_headless
# sanitizer build for crash diagnosis:
cmake -S . -B build_asan -DCMAKE_BUILD_TYPE=Debug -DDC_SANITIZERS=On
cmake --build build_asan -j
```
