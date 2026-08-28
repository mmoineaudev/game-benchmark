// dc/crashdiag.hpp — crash diagnostics layer (§3.4 of the plan).
//
// Two pieces, both GPU-free and usable by the headless sim / dc_repro:
//
//   1) installCrashHandler(ctx) — installs SIGSEGV/SIGABRT/SIGFPE/SIGBUS/
//      SIGILL handlers that dump: the current sim state (frame/seed/pos/
//      phase) from a CrashContext the sim updates every frame, then a native
//      backtrace, then re-raise to produce a core dump. This turns
//      "the browser died with no error" into "repro #N crashed at frame K in
//      <phase>".
//
//   2) FrameWatchdog — flags a hung frame (>0.25 s, the same threshold as the
//      degraded-mode hitch) instead of the process just freezing.
//
// The CrashContext fields are updated by the sim once per frame; the signal
// handler only reads them, so no locking is needed (a torn read of a couple of
// ints is acceptable for a crash report).
#pragma once
#include <chrono>
#include <cstdio>
#include <unistd.h>

namespace dc {

struct CrashContext {
  int frame = 0;
  int seed = 0;
  double px = 0.0, pz = 0.0;
  const char* phase = "init";
};

// Install the signal handlers. Pass the address of a CrashContext the sim
// keeps current; the handler reads it on crash. Pass nullptr to skip the
// state dump (backtrace still prints). Returns true if handlers installed.
bool installCrashHandler(const CrashContext* ctx);

// Uninstall the handlers (restores defaults). Mainly for tests.
void uninstallCrashHandler();

// Hung-frame watchdog. begin() marks the start of a frame; end(where) checks
// elapsed wall time and, if it exceeds the threshold, prints a HUNG FRAME
// report naming `where`. Default threshold 0.25 s (degraded-mode hitch).
class FrameWatchdog {
public:
  explicit FrameWatchdog(double thresholdS = 0.25) : threshold_(thresholdS) {}
  void begin() { t0_ = std::chrono::steady_clock::now(); }
  void end(const char* where) {
    auto t1 = std::chrono::steady_clock::now();
    const double el = std::chrono::duration<double>(t1 - t0_).count();
    if (el > threshold_) {
      // stderr write is safe enough for a diagnostic; keep it one line.
      static int hung = 0;
      if (hung++ < 8) {
        char buf[160];
        int n = std::snprintf(buf, sizeof buf,
                              "[dc_watchdog] HUNG FRAME %.3fs (> %.2fs) at: %s\n",
                              el, threshold_, where ? where : "?");
        if (n > 0) {
          ssize_t r = ::write(2, buf, (size_t)n);
          (void)r;
        }
      }
    }
  }
private:
  double threshold_;
  std::chrono::steady_clock::time_point t0_;
};

} // namespace dc
