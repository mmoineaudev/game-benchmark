// dc/crashdiag.cpp — signal handler + hung-frame watchdog (§3.4).
#include "dc/crashdiag.hpp"

#include <csignal>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <execinfo.h>
#include <unistd.h>

namespace dc {

namespace {

const CrashContext* g_ctx = nullptr;

// Async-signal-safe write that ignores the (irrelevant) short/err return.
static void awrite(int fd, const char* s, size_t n) {
  ssize_t r = ::write(fd, s, n);
  (void)r;
}

// Async-signal-safe-ish dump. backtrace()/backtrace_symbols_fd are not strictly
// async-signal-safe, but are the standard way to produce a native stack trace
// from a crash handler; the process is dying anyway.
void dumpState(const CrashContext* c, const char* signame) {
  char buf[512];
  int n = std::snprintf(buf, sizeof buf,
    "[dc_crash] signal=%s frame=%d seed=%d pos=(%.2f, %.2f) phase=%s\n",
    signame, c ? c->frame : -1, c ? c->seed : -1,
    c ? c->px : 0.0, c ? c->pz : 0.0, (c && c->phase) ? c->phase : "?");
  if (n > 0) awrite(2, buf, (size_t)n);
}

void onCrash(int sig) {
  const char* name = "?";
  if      (sig == SIGSEGV) name = "SIGSEGV";
  else if (sig == SIGABRT) name = "SIGABRT";
  else if (sig == SIGFPE)  name = "SIGFPE";
  else if (sig == SIGBUS)  name = "SIGBUS";
  else if (sig == SIGILL)  name = "SIGILL";
  dumpState(g_ctx, name);

  void* frames[64];
  const int n = backtrace(frames, 64);
  char buf[4096];
  int off = std::snprintf(buf, sizeof buf,
    "[dc_crash] native backtrace (%d frames):\n", n);
  if (off > 0) awrite(2, buf, (size_t)off);
  backtrace_symbols_fd(frames, n, 2);

  // Restore default and re-raise so the shell/core-dump sees the real signal.
  std::signal(sig, SIG_DFL);
  raise(sig);
}

} // namespace

bool installCrashHandler(const CrashContext* ctx) {
  g_ctx = ctx;
  struct sigaction sa{};
  sa.sa_handler = onCrash;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = 0;
  for (int sig : {SIGSEGV, SIGABRT, SIGFPE, SIGBUS, SIGILL})
    if (sigaction(sig, &sa, nullptr) != 0) return false;
  return true;
}

void uninstallCrashHandler() {
  struct sigaction sa{};
  sa.sa_handler = SIG_DFL;
  sigemptyset(&sa.sa_mask);
  for (int sig : {SIGSEGV, SIGABRT, SIGFPE, SIGBUS, SIGILL})
    (void)sigaction(sig, &sa, nullptr);
  g_ctx = nullptr;
}

} // namespace dc
