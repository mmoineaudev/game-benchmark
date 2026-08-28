// dc/renderer.hpp — renderer-agnostic interface (D1 swappable module).
// dc_render exposes this; dc_app talks to it; dc_core stays GPU-free.
// Headless parity tests run against NullRenderer (no GPU).
#pragma once
#include <cstdint>
#include <vector>

namespace dc {

// A single instanced draw submission. The renderer decides how to batch.
struct InstancedDraw {
  int vao;              // caller-managed VAO handle (renderer-specific)
  int count;            // vertices per instance
  int instances;        // how many instances to draw
  int primitive;        // 0 = triangle list, 1 = line list, 2 = point list
};

// Shadow-casting light (exactly 1 per level, spec §12.1).
struct ShadowLight {
  double origin[3];
  double color[3];
  double intensity;
};

class Renderer {
public:
  virtual ~Renderer() = default;

  // Window/GL setup. Returns false on hard failure (no context, etc).
  virtual bool init(int width, int height, const char* title) = 0;

  // Per-frame.
  virtual void beginFrame() = 0;
  virtual void endFrame() = 0; // present

  // Clear to a color (r,g,b in 0..1).
  virtual void clear(double r, double g, double b) = 0;

  // Submit an instanced draw of an already-uploaded VAO.
  virtual void submitInstancedDraw(const InstancedDraw& d) = 0;

  // Submit the single shadow pass (light + scene).
  virtual void submitShadow(const ShadowLight& light) = 0;

  // Submit a post pass (bloom / enemy-glow).
  virtual void submitPost() = 0;

  // True if this renderer is headless (drives the sim, no GPU).
  virtual bool isHeadless() const { return false; }

  // Optional: expose a QA handle for headless probing (window.game-equivalent).
  virtual void* qaHandle() { return nullptr; }
};

// Headless renderer: drives the sim with no GPU. Used by parity tests and
// the repro harness.
class NullRenderer : public Renderer {
public:
  bool init(int, int, const char*) override { return true; }
  void beginFrame() override {}
  void endFrame() override {}
  void clear(double, double, double) override {}
  void submitInstancedDraw(const InstancedDraw&) override {}
  void submitShadow(const ShadowLight&) override {}
  void submitPost() override {}
  bool isHeadless() const override { return true; }
};

} // namespace dc
