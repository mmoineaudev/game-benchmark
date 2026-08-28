// dc_repro — headless repro/replay harness (no GPU, no display).
//
// The sim is single-threaded, fixed-step and seeded, so a crash is fully
// reproducible from (seed, biome, frames). This driver:
//   - generates a dungeon, spawns the player at the entrance, streams them
//     toward the exit with sub-stepped + collision-resolved movement, and
//     checks ZERO tunneling after every frame (headless sim proof);
//   - installs the §3.4 crash handlers (state dump + native backtrace);
//   - runs a hung-frame watchdog (default 0.25 s, degraded-mode hitch);
//   - can INJECT a synthetic crash to prove the diagnostics: a use-after-free
//     of a disposed "system" (the exact JS bug class we fixed), an
//     out-of-bounds pool write, or a plain SIGSEGV (null deref). Under an
//     ASan build (-DDC_SANITIZERS=On) the UAF/OOB abort with a clean report
//     naming the crashing frame; the SIGSEGV (any build) exercises the
//     installed handler, which dumps sim state + a native backtrace. The
//     process exits non-zero / crashes, so `dc_repro` IS the reproduction.
//
// Usage:
//   dc_repro [--seed N] [--frames N] [--dt f] [--fault none|uaf|oob|segv]
//            [--fault-at-frame N] [--watchdog-threshold f]
// Exit codes: 0 ok; 3 injected fault fired (crash reproduced); 4 zero-
// tunneling violation (sim bug); 2 bad args. (segv exits via SIGSEGV;
// uaf/oob under ASan exit via SIGABRT/SIGSEGV with a sanitizer report.)
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <string>
#include <vector>

#include "dc/crashdiag.hpp"
#include "dc/constants.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/movement.hpp"
#include "dc/state.hpp"
#include "dc/world.hpp"

namespace {

// A "system" the sim disposes mid-run. The UAF fault disposes it at frame N
// and still ticks it — the use-after-free-on-a-disposed-system bug.
// (GCC -Wuse-after-free flags this definition; that's the injected fault.)
struct SimSystem {
  int state = 0;
  double tick(double dt) { state += 1; return dt; }
};

struct Args {
  int seed = 1000;
  int frames = 600;
  double dt = 1.0 / 60.0;
  std::string fault = "none";
  int faultAtFrame = 5;
  double watchdogThreshold = 0.25;
};

Args parseArgs(int argc, char** argv) {
  Args a;
  for (int i = 1; i < argc; i++) {
    const std::string s = argv[i];
    if (s == "--seed" && i + 1 < argc) a.seed = std::atoi(argv[++i]);
    else if (s == "--frames" && i + 1 < argc) a.frames = std::atoi(argv[++i]);
    else if (s == "--dt" && i + 1 < argc) a.dt = std::atof(argv[++i]);
    else if (s == "--fault" && i + 1 < argc) a.fault = argv[++i];
    else if (s == "--fault-at-frame" && i + 1 < argc)
      a.faultAtFrame = std::atoi(argv[++i]);
    else if (s == "--watchdog-threshold" && i + 1 < argc)
      a.watchdogThreshold = std::atof(argv[++i]);
  }
  return a;
}

} // namespace

int main(int argc, char** argv) {
  const Args args = parseArgs(argc, argv);

  dc::CrashContext ctx{0, args.seed, 0.0, 0.0, "init"};
  if (!dc::installCrashHandler(&ctx))
    std::fprintf(stderr, "[dc_repro] warning: could not install crash handlers\n");
  dc::FrameWatchdog wd(args.watchdogThreshold);

  const std::string biome = dc::kBiomeSequence[static_cast<size_t>(args.seed % 10)];
  dc::DungeonGenerator gen(args.seed, biome);
  const dc::Dungeon d = gen.generate();
  const dc::WorldCollision wc = dc::buildCollisionBoxes(d);
  const std::vector<dc::AABB> boxes = wc.boxes;

  // Headless sim state: player at the entrance cell center, streaming toward
  // the exit cell center. Mirrors the JS player loop (sub-step + resolve).
  dc::Mover player{
      static_cast<double>(d.entranceCell->x) * d.cellSize,
      static_cast<double>(d.entranceCell->z) * d.cellSize};
  const double tx = static_cast<double>(d.exitCell->x) * d.cellSize;
  const double tz = static_cast<double>(d.exitCell->z) * d.cellSize;

  const std::string fault = args.fault;
  SimSystem* system = new SimSystem(); // owned; disposed at the fault frame
  bool systemDisposed = false;
  std::vector<float> pool(8);          // the "pooled" buffer for the OOB fault

  int exitCode = 0;
  for (int frame = 0; frame < args.frames; frame++) {
    ctx.frame = frame;
    ctx.px = player.x;
    ctx.pz = player.z;
    wd.begin();
    ctx.phase = "fault-injection";
    if (frame == args.faultAtFrame) {
      if (fault == "uaf") {
        // dispose the system, then still tick it: use-after-free.
        delete system;
        systemDisposed = true;
        // Integer round-trip keeps the dangling use out of the compiler's
        // alias analysis (GCC -Wuse-after-free) — ASan catches it at runtime.
        const uintptr_t dangling = reinterpret_cast<uintptr_t>(system);
        (void)reinterpret_cast<SimSystem*>(dangling)->tick(args.dt);
        ctx.phase = "uaf-fault";
        exitCode = 3; // unreachable under ASan (it aborts first)
      } else if (fault == "oob") {
        // write one past the end of the pool: heap-buffer-overflow.
        volatile size_t idx = pool.size(); // == 8, one past the end
        pool[idx] = 1.0f; // ASan: heap-buffer-overflow
        ctx.phase = "oob-fault";
        exitCode = 3; // unreachable under ASan (it aborts first)
      } else if (fault == "segv") {
        // deterministic null-pointer deref: SIGSEGV in any build. Proves the
        // §3.4 signal handler dumps sim state + a native backtrace on a real
        // crash (no sanitizer required).
        SimSystem* null = nullptr;
        null->tick(args.dt); // SIGSEGV
        ctx.phase = "segv-fault"; // unreachable (the crash handler fires)
        exitCode = 3;
      }
    }
    ctx.phase = "move";
    {
      const double dx = tx - player.x, dz = tz - player.z;
      const double len = std::hypot(dx, dz);
      if (len > 1e-6)
        dc::movePlayer(player, dx / len, dz / len, /*sprinting=*/false,
                       /*sprintMult=*/1.0, /*buffEffect=*/0, args.dt, boxes);
    }
    ctx.phase = "tunneling-check";
    for (const auto& b : boxes) {
      if (player.x > b.minX && player.x < b.maxX && player.z > b.minZ &&
          player.z < b.maxZ) {
        std::fprintf(stderr,
                     "[dc_repro] ZERO-TUNNELING VIOLATION at frame %d: player "
                     "(%.2f,%.2f) inside box (%.2f..%.2f, %.2f..%.2f)\n",
                     frame, player.x, player.z, b.minX, b.maxX, b.minZ, b.maxZ);
        exitCode = 4;
      }
    }
    wd.end("move");
  }
  if (!systemDisposed) delete system; // clean path: dispose at the end (no UAF)

  std::fprintf(stderr,
               "[dc_repro] seed %d biome %s grid %d boxes %zu: ran %d frames, "
               "final pos (%.2f, %.2f), exit %d\n",
               args.seed, biome.c_str(), d.gridSize, boxes.size(), args.frames,
               player.x, player.z, exitCode);
  return exitCode;
}
