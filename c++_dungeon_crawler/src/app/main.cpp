// dc_app — Phase 2 playable spine.
//
// Renders the *generated* STONE dungeon first-person, driven headlessly or
// interactively:
//   • instanced world build (floors / ceilings / walls) from dc_core
//   • pointer-lock camera + AZERTY-safe input (GLFW physical key codes:
//     GLFW_KEY_W/A/S/D = the W/A/S/D *positions*, so AZERTY ZQSD is free)
//   • sub-stepped collision movement (dc::movePlayer, zero-tunneling)
//   • sprint (Shift) with the GameState sprint-accel formula + FOV kick
//   • ONE shadow-casting torch (256², static-assigned at level build)
//   • headlight (camera point light, no shadow) + ambient
//   • bloom post pass (bright → ping-pong gaussian → composite)
//   • crosshair + on-screen fps / level / biome readout
//
// Headless probe (verification):  dc_app --frames N --save out.ppm
//   renders N frames of a real generated dungeon then dumps a PPM.
// FPS gate:  dc_app --fps  (30 fps floor; degraded mode sheds debris tail)
//
// The sim state (GameState, Dungeon, collision boxes, movement) all live in
// dc_core so this is the same code the headless parity tests exercise.
#define GL_GLEXT_PROTOTYPES
#include <GL/gl.h>
#include <GL/glext.h>
#include <GLFW/glfw3.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "dc/collision.hpp"
#include "dc/constants.hpp"
#include "dc/crashdiag.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/boss.hpp"
#include "dc/skeleton_system.hpp"
#include "dc/hunter.hpp"
#include "dc/drop_system.hpp"
#include "dc/movement.hpp"
#include "dc/state.hpp"
#include "dc/world.hpp"
#include "dc/leaderboard.hpp"

#define STB_TRUETYPE_IMPLEMENTATION
#include "third_party/stb_truetype.h"

namespace {

namespace camera = dc::camera;
namespace player = dc::player;
namespace lighting = dc::lighting;
namespace world = dc::world;

constexpr int kShadowSize = 256; // spec §12.1: 256² shadow map
constexpr float kEyeHeight = 1.6f;

// ---------- tiny mat4 (column-major, GL order) ----------
struct Mat4 {
  float m[16];
  static Mat4 identity() {
    Mat4 r{};
    r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1.0f;
    return r;
  }
  static Mat4 perspective(float fovyDeg, float aspect, float n, float f) {
    float t = std::tan(fovyDeg * (float)M_PI / 360.0f);
    Mat4 m{};
    m.m[0] = 1 / (aspect * t);
    m.m[5] = 1 / t;
    m.m[10] = -(f + n) / (f - n);
    m.m[11] = -1;
    m.m[14] = -(2 * f * n) / (f - n);
    return m;
  }
  static Mat4 lookAt(const float eye[3], const float at[3], const float up[3]) {
    float f[3] = {at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]};
    float fl = std::sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]);
    f[0] /= fl; f[1] /= fl; f[2] /= fl;
    float s[3] = {f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]};
    float sl = std::sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]);
    if (sl < 1e-6f) s[0] = 1;
    s[0] /= sl; s[1] /= sl; s[2] /= sl;
    float u[3] = {s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]};
    Mat4 m{};
    m.m[0] = s[0]; m.m[4] = s[1]; m.m[8] = s[2];
    m.m[1] = u[0]; m.m[5] = u[1]; m.m[9] = u[2];
    m.m[2] = -f[0]; m.m[6] = -f[1]; m.m[10] = -f[2];
    m.m[12] = -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]);
    m.m[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
    m.m[14] = f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2];
    m.m[15] = 1;
    return m;
  }
  Mat4 operator*(const Mat4& o) const {
    Mat4 r{};
    for (int c = 0; c < 4; c++)
      for (int row = 0; row < 4; row++) {
        float s = 0;
        for (int k = 0; k < 4; k++) s += m[k * 4 + row] * o.m[c * 4 + k];
        r.m[c * 4 + row] = s;
      }
    return r;
  }
};

GLuint compileShader(GLenum type, const char* src) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[1024];
    glGetShaderInfoLog(s, 1024, nullptr, log);
    std::fprintf(stderr, "[dc_app] shader compile failed:\n%s\n", log);
  }
  return s;
}

GLuint linkProgram(GLuint vs, GLuint fs) {
  GLuint p = glCreateProgram();
  glAttachShader(p, vs);
  glAttachShader(p, fs);
  glLinkProgram(p);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) {
    char log[1024];
    glGetProgramInfoLog(p, 1024, nullptr, log);
    std::fprintf(stderr, "[dc_app] program link failed:\n%s\n", log);
  }
  glDeleteShader(vs);
  glDeleteShader(fs);
  return p;
}

// Lit cube shader: per-instance offset/scale/color, ONE shadow point light
// (the torch) + ONE headlight (camera, no shadow) + ambient.
const char* kLitVert = R"(
#version 330 core
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aOffset;
layout(location=3) in vec3 aScale;
layout(location=4) in vec3 aColor;
uniform mat4 uViewProj;
uniform mat4 uTorchVP;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
out vec4 vTorchPos;
void main() {
  vec3 wp = aPos * aScale + aOffset;
  vWorld = wp;
  vNormal = aNormal;
  vColor = aColor;
  vTorchPos = uTorchVP * vec4(wp, 1.0);
  gl_Position = uViewProj * vec4(wp, 1.0);
}
)";

const char* kLitFrag = R"(
#version 330 core
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
in vec4 vTorchPos;
uniform vec3 uTorchPos;
uniform vec3 uTorchColor;
uniform float uTorchIntensity;
uniform float uTorchDist;
uniform vec3 uHeadPos;
uniform vec3 uHeadColor;
uniform float uHeadIntensity;
uniform float uHeadDist;
uniform vec3 uAmbient;   // per-biome AmbientLight color (JS BIOMES.ambient lerp white 0.6)
uniform float uEmissive;
uniform vec3 uFogColor;  // per-biome fog color (JS BIOMES.fog lerp gray 0.55)
uniform float uFogDensity;
uniform vec3 uEyePos;
uniform sampler2D uShadowMap;
out vec4 fragColor;
float shadowFactor(vec4 lpos) {
  if (lpos.w <= 0.0) return 1.0;
  vec3 p = lpos.xyz / lpos.w;
  p = p * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float bias = 0.002;
  float s = 0.0;
  float texel = 1.0 / 256.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      s += step(p.z - bias, texture(uShadowMap, p.xy + vec2(i, j) * texel).x);
  return s / 9.0;
}
vec3 pointLight(vec3 L, vec3 lcolor, float intensity, float distance, float shadow) {
  vec3 ld = L - vWorld;
  float dist = length(ld);
  float diff = max(dot(normalize(vNormal), ld / max(dist, 1e-4)), 0.0);
  float cut = 1.0 - smoothstep(distance * 0.5, distance, dist); // JS-style cutoff
  float atten = intensity * cut / (1.0 + 0.2 * dist + 0.06 * dist * dist); // JS decay ~1.05-1.2
  return lcolor * diff * atten * shadow;
}
void main() {
  vec3 lit = vColor * uAmbient;
  lit += pointLight(uTorchPos, uTorchColor, uTorchIntensity, uTorchDist, shadowFactor(vTorchPos));
  lit += pointLight(uHeadPos, uHeadColor, uHeadIntensity, uHeadDist, 1.0);
  if (uEmissive > 0.5) lit = vColor * 0.9; // unlit emissive (boss / skeletons) — keep ≤1 to avoid bloom blowout
  // per-biome exponential fog (JS FogExp2; density pre-scaled for the C++ scene)
  float fd = length(vWorld - uEyePos);
  float fogF = 1.0 - exp(-uFogDensity * fd);
  vec3 c = mix(lit, uFogColor, clamp(fogF, 0.0, 1.0));
  fragColor = vec4(min(c, vec3(1.5)), 1.0);
}
)";

// ---- §13 decorative systems: smoke / ambient dust / wall runes / water ----

// SmokeSystem (9 pooled GPU points, puff on breakable break): soft dark puffs
// that rise and fade. gl_PointSize = 90.0 / -mv.z (JS SmokeSystem).
const char* kSmokeVert = R"(
#version 330 core
layout(location=0) in vec3 aPos;
layout(location=1) in float aAlpha;
uniform mat4 uViewProj;
uniform mat4 uView;
out float vA;
void main() {
  vA = aAlpha;
  vec4 mv = uView * vec4(aPos, 1.0);
  gl_PointSize = 90.0 / max(0.1, -mv.z);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
)";

const char* kSmokeFrag = R"(
#version 330 core
in float vA;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(d)) * vA * 0.5;
  if (a < 0.01) discard;
  fragColor = vec4(uColor, a);
}
)";

// ParticleSystem (30 ambient dust motes, torch-adjacent, additive 0.45).
const char* kDustVert = R"(
#version 330 core
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform float uSizePx;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  gl_PointSize = clamp(uSizePx / gl_Position.w, 1.0, 8.0); // JS: 0.045*(h/2)/z, up to ~8px up close
}
)";

const char* kDustFrag = R"(
#version 330 core
uniform vec3 uColor;
uniform float uOpacity;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d)) * uOpacity;
  if (a < 0.01) discard;
  fragColor = vec4(uColor, a);
}
)";

// RuneSystem (<=10 wall quads, pulsing opacity 0.55+0.45*sin).
// 8-glyph procedural atlas (1/8-width slot each), instanced quad.
const char* kRuneVert = R"(
#version 330 core
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec3 aOffset;
layout(location=3) in float aPhase;
layout(location=4) in float aUvX;
layout(location=5) in float aRot;
layout(location=6) in vec3 aColor;
uniform mat4 uViewProj;
out vec2 vUv;
out vec3 vColor;
out float vPhase;
void main() {
  // vertical quad standing on the floor, facing a horizontal direction aRot.
  // local: aPos.x = horizontal, aPos.y = vertical (world Y). Rotate the
  // horizontal extent about the vertical Y axis (a real wall-facing spin).
  vec3 wp;
  wp.x = aOffset.x + cos(aRot) * aPos.x;
  wp.y = aOffset.y + aPos.y;
  wp.z = aOffset.z - sin(aRot) * aPos.x;
  vUv = vec2(aUvX + aUv.x / 8.0, aUv.y);
  vColor = aColor;
  vPhase = aPhase;
  gl_Position = uViewProj * vec4(wp, 1.0);
}
)";

const char* kRuneFrag = R"(
#version 330 core
in vec2 vUv;
in vec3 vColor;
in float vPhase;
uniform sampler2D uAtlas;
uniform float uTime;
out vec4 fragColor;
void main() {
  vec4 t = texture(uAtlas, vUv);
  float pulse = 0.55 + 0.45 * sin(uTime * 2.0 + vPhase);
  float a = t.a * pulse;
  if (a < 0.01) discard;
  fragColor = vec4(vColor * t.rgb, a);
}
)";

// Water: VAULT-room planes, y just above the floor, sine-wave vertex wave
// (JS _placeWaterPuddles: 8x8 subdivided plane, per-frame z displacement).
const char* kWaterVert = R"(
#version 330 core
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 aOffset;
layout(location=2) in vec2 aScale;
layout(location=3) in float aPhase;
uniform mat4 uViewProj;
uniform float uTime;
out vec3 vWorld;
void main() {
  vec3 wp = vec3(aOffset.x + aPos.x * aScale.x, aOffset.y, aOffset.z + aPos.y * aScale.y);
  wp.y += sin(uTime * 1.5 + aPhase + dot(aPos, vec2(2.0))) * 0.03;
  vWorld = wp;
  gl_Position = uViewProj * vec4(wp, 1.0);
}
)";

const char* kWaterFrag = R"(
#version 330 core
in vec3 vWorld;
uniform vec3 uEyePos;
out vec4 fragColor;
void main() {
  vec3 col = vec3(0.227, 0.416, 0.541); // 0x3a6a8a
  float d = distance(vWorld, uEyePos);
  float vis = clamp(1.0 - d * 0.04, 0.3, 1.0);
  fragColor = vec4(col * vis, 0.75);
}
)";

const char* kFullscreenVert = R"(
#version 330 core
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0, 1); }
)";

const char* kBrightFrag = R"(
#version 330 core
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  fragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.2, l), 1.0);
}
)";

const char* kBlurFrag = R"(
#version 330 core
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 fragColor;
void main() {
  vec3 acc = texture(uTex, vUv).rgb * 0.227;
  acc += texture(uTex, vUv + uDir * 1.3846).rgb * 0.3162;
  acc += texture(uTex, vUv - uDir * 1.3846).rgb * 0.3162;
  acc += texture(uTex, vUv + uDir * 3.2308).rgb * 0.07027;
  acc += texture(uTex, vUv - uDir * 3.2308).rgb * 0.07027;
  fragColor = vec4(acc, 1.0);
}
)";

const char* kCompositeFrag = R"(
#version 330 core
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uStrength;
uniform sampler2D uGlowSharp;
uniform sampler2D uGlowBlur;
uniform float uGlowIntensity;
uniform float uGlowPulse;
out vec4 fragColor;
void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 sharp = texture(uGlowSharp, vUv).rgb;
  vec3 blur  = texture(uGlowBlur, vUv).rgb;
  vec3 glow = (blur * 1.6 * uGlowPulse + sharp * 0.5) * uGlowIntensity; // §12.2 EnemyGlowShader
  fragColor = vec4(scene + bloom * uStrength + glow, 1.0);
}
)";

// §12.2 enemy-glow: flat red-orange override material (JS GLOW_MAT 0xff4422)
const char* kFlatMaskFrag = R"(
#version 330 core
out vec4 fragColor;
void main() { fragColor = vec4(1.0, 0.267, 0.133, 1.0); } // 0xff4422
)";

// §12.2 enemy-glow separable gaussian: 5 taps, weights 0.227/0.194/0.121 at 0/1.4/3.4 texels
const char* kEnemyBlurFrag = R"(
#version 330 core
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227;
  c += texture(uTex, vUv + uDir * 1.4).rgb * 0.194;
  c += texture(uTex, vUv - uDir * 1.4).rgb * 0.194;
  c += texture(uTex, vUv + uDir * 3.4).rgb * 0.121;
  c += texture(uTex, vUv - uDir * 3.4).rgb * 0.121;
  fragColor = vec4(c, 1.0);
}
)";

// ---------- screen-space dark overlay (death / title dim) ----------
const char* kOverlayFrag =
    "#version 330 core\n"
    "in vec2 vUv;\n"
    "uniform vec4 uTint; // rgb = tint color, a = opacity\n"
    "out vec4 fragColor;\n"
    "void main() { fragColor = vec4(uTint.rgb, uTint.a); }\n";

// ---------- instanced world (floors / ceilings / walls) ----------
struct World {
  dc::Dungeon dungeon;
  dc::WorldCollision collision;
  // GL instance VBOs: 9 floats/instance = offset(3) + scale(3) + color(3).
  GLuint instFloor = 0, instCeil = 0, instWallH = 0, instWallE = 0;
  int nFloor = 0, nCeil = 0, nWallH = 0, nWallE = 0;
  // floor debris (JS WorldBuilder): ONE InstancedMesh of pebbles, purely cosmetic;
  // degraded mode sheds the tail instances (count halved, spec §22 rule 1).
  GLuint instDebris = 0;
  int nDebris = 0;

  void upload(const dc::Dungeon& d, const float cellCol[3], const float wallCol[3],
              const float ceilCol[3], std::uint32_t seed);
  void buildInstanceData(const dc::Dungeon& d, std::vector<float>& floorInst,
                         std::vector<float>& ceilInst, std::vector<float>& wallH,
                         std::vector<float>& wallE) const;
};

void World::buildInstanceData(const dc::Dungeon& d, std::vector<float>& floorInst,
                              std::vector<float>& ceilInst, std::vector<float>& wallH,
                              std::vector<float>& wallE) const {
  const float cs = (float)d.cellSize;
  const float H = (float)dc::world::kWallHeight;
  const float wt = (float)dc::kWallThickness;
  floorInst.clear(); ceilInst.clear(); wallH.clear(); wallE.clear();
  for (int z = 0; z < d.gridSize; z++) {
    for (int x = 0; x < d.gridSize; x++) {
      if (d.grid[z][x] == dc::Cell::kEmpty) continue;
      const float wx = (float)(x * d.cellSize), wz = (float)(z * d.cellSize);
      // floor + ceiling (thin slabs, one instance each)
      floorInst.insert(floorInst.end(), {wx, 0.1f, wz, cs, 0.2f, cs, 0, 0, 0});
      ceilInst.insert(ceilInst.end(), {wx, H - 0.1f, wz, cs, 0.2f, cs, 0, 0, 0});
      // exposed/boundary edges → walls (same logic as WorldBuilder)
      static const int kDirX[4] = {1, -1, 0, 0};
      static const int kDirZ[4] = {0, 0, 1, -1};
      for (int k = 0; k < 4; k++) {
        const int dx = kDirX[k], dz = kDirZ[k];
        const int nx = x + dx, nz = z + dz;
        const bool oob = nx < 0 || nz < 0 || nx >= d.gridSize || nz >= d.gridSize;
        if (!oob && d.grid[nz][nx] != dc::Cell::kEmpty) continue;
        const float ex = wx + (float)(dx * d.cellSize) / 2.0f, ez = wz + (float)(dz * d.cellSize) / 2.0f;
        if (dz != 0) { // N/S wall: spans x, thin in z
          wallH.insert(wallH.end(), {ex, H / 2.0f, ez, cs, H, wt, 0, 0, 0});
        } else { // E/W wall: spans z, thin in x
          wallE.insert(wallE.end(), {ex, H / 2.0f, ez, wt, H, cs, 0, 0, 0});
        }
      }
    }
  }
}

void World::upload(const dc::Dungeon& d, const float cellCol[3], const float wallCol[3],
                   const float ceilCol[3], std::uint32_t seed) {
  dungeon = d;
  collision = buildCollisionBoxes(d);
  std::vector<float> floorInst, ceilInst, wallH, wallE;
  buildInstanceData(d, floorInst, ceilInst, wallH, wallE);
  // stamp colors (9-float stride: offset,scale,color)
  auto stamp = [&](std::vector<float>& v, const float c[3]) {
    for (size_t i = 0; i < v.size(); i += 9) { v[i + 6] = c[0]; v[i + 7] = c[1]; v[i + 8] = c[2]; }
  };
  stamp(floorInst, cellCol); stamp(ceilInst, ceilCol); stamp(wallH, wallCol); stamp(wallE, wallCol);
  nFloor = (int)(floorInst.size() / 9); nCeil = (int)(ceilInst.size() / 9);
  nWallH = (int)(wallH.size() / 9); nWallE = (int)(wallE.size() / 9);
  // Floor debris — JS WorldBuilder: ONE InstancedMesh of pebbles, floor(cells * 0.2).
  // Purely cosmetic (no shadow, own budget track); degraded mode sheds the tail
  // instances at draw time (count halved, spec §22 rule 1).
  std::vector<float> debrisInst;
  {
    std::vector<int> cells; // flat z*gridSize+x of non-empty cells
    for (int z = 0; z < d.gridSize; z++)
      for (int x = 0; x < d.gridSize; x++)
        if (d.grid[z][x] != dc::Cell::kEmpty) cells.push_back(z * d.gridSize + x);
    const int nDeb = (int)std::floor((double)cells.size() * dc::props::kDebrisPerCell);
    dc::Rng drng{seed ^ 0x5EEDu}; // deterministic-by-design (JS used unseeded Math.random)
    for (int i = 0; i < nDeb && !cells.empty(); i++) {
      const int c = cells[drng.nextInt((int)cells.size())];
      const int cx = c % d.gridSize, cz = c / d.gridSize;
      const float s = 0.2f + 0.2f * (float)drng.next(); // small pebble (JS dodeca r=0.12)
      const float sy = s * 0.6f; // flattened
      const float wx = (float)(cx * d.cellSize) +
                       ((float)drng.next() - 0.5f) * (float)d.cellSize * 0.7f;
      const float wz = (float)(cz * d.cellSize) +
                       ((float)drng.next() - 0.5f) * (float)d.cellSize * 0.7f;
      const float wy = 0.2f + 0.5f * sy; // sit on the floor slab (top y=0.2)
      debrisInst.insert(debrisInst.end(), {wx, wy, wz, s, sy, s, 0.333f, 0.314f, 0.282f}); // 0x555048
    }
  }
  nDebris = (int)(debrisInst.size() / 9);
  auto mkVbo = [&](const std::vector<float>& v) -> GLuint {
    GLuint b = 0;
    glGenBuffers(1, &b);
    glBindBuffer(GL_ARRAY_BUFFER, b);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * sizeof(float)), v.data(), GL_STATIC_DRAW);
    return b;
  };
  instFloor = mkVbo(floorInst); instCeil = mkVbo(ceilInst);
  instWallH = mkVbo(wallH); instWallE = mkVbo(wallE);
  instDebris = mkVbo(debrisInst);
}

// Per-biome light/prop palette (JS BIOMES → normalized material/fog/ambient/torch).
// The app renders one biome's identity per level; all values are the binding
// BIOMES data from Constants.js (material + fog + ambient color + torch color).
struct BiomeLight {
  float floorCol[3], wallCol[3], ceilCol[3];
  float fogColor[3];
  float fogDensity;
  float ambientCol[3]; // JS AmbientLight color = pal.ambient lerp white 0.6
  float torchCol[3];
  float torchIntensity;
};
static inline float cpx(int c, int shift) { return (float)((c >> shift) & 255) / 255.0f; }
static inline float lerpf(float a, float b, float t) { return a + (b - a) * t; }
static BiomeLight biomeLight(const std::string& biome) {
  const auto& b = dc::kBiomes.at(biome);
  BiomeLight L;
  L.floorCol[0] = cpx(b.floor, 16); L.floorCol[1] = cpx(b.floor, 8); L.floorCol[2] = cpx(b.floor, 0);
  L.wallCol[0] = cpx(b.wall, 16); L.wallCol[1] = cpx(b.wall, 8); L.wallCol[2] = cpx(b.wall, 0);
  L.ceilCol[0] = cpx(b.ceiling, 16); L.ceilCol[1] = cpx(b.ceiling, 8); L.ceilCol[2] = cpx(b.ceiling, 0);
  const int liftC = 0x8a8478; // biome-tinted gray (JS fogLifted)
  L.fogColor[0] = lerpf(cpx(b.fog, 16), cpx(liftC, 16), 0.55f);
  L.fogColor[1] = lerpf(cpx(b.fog, 8), cpx(liftC, 8), 0.55f);
  L.fogColor[2] = lerpf(cpx(b.fog, 0), cpx(liftC, 0), 0.55f);
  L.fogDensity = (float)(b.fogDensity * 1.2); // tuned for the (darker) C++ scene
  L.ambientCol[0] = lerpf(cpx(b.ambient, 16), 1.0f, 0.6f);
  L.ambientCol[1] = lerpf(cpx(b.ambient, 8), 1.0f, 0.6f);
  L.ambientCol[2] = lerpf(cpx(b.ambient, 0), 1.0f, 0.6f);
  L.torchCol[0] = cpx(b.torchColor, 16); L.torchCol[1] = cpx(b.torchColor, 8); L.torchCol[2] = cpx(b.torchColor, 0);
  L.torchIntensity = (float)dc::kLightSources.at("TORCH").intensity;
  return L;
}

// ---------- pixel font (stb_truetype + KenPixel.ttf) + screen-space text ----------
struct Font {
  GLuint tex = 0;
  int pixel = 24;
  float uv[128][4] = {};
  float adv[128] = {};
  int w[128] = {}, h[128] = {};
  bool ok = false;
};

const char* kTextVert = R"(
#version 330 core
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 aColor;
uniform vec2 uRes;
out vec2 vUv; out vec4 vColor;
void main(){
  vUv=aUv; vColor=aColor;
  vec2 ndc = vec2(aPos.x/uRes.x*2.0-1.0, 1.0-aPos.y/uRes.y*2.0);
  gl_Position=vec4(ndc,0,1);
}
)";

const char* kTextFrag = R"(
#version 330 core
in vec2 vUv; in vec4 vColor;
uniform sampler2D uFont;
out vec4 fragColor;
void main(){
  float a=texture(uFont,vUv).a;
  fragColor=vec4(vColor.rgb, vColor.a*a);
}
)";

// ---------- solid screen-space rects (hearts / souls / boss bars) ----------
const char* kRectFrag = R"(
#version 330 core
in vec2 vUv; in vec4 vColor;
out vec4 fragColor;
void main(){ fragColor=vColor; }
)";

struct App {
  GLFWwindow* window = nullptr;
  int width = 0, height = 0;
  World world;
  dc::GameState state;

  // cube geometry + instance VAO
  GLuint vao = 0, vbo = 0, ebo = 0;
  int vertCount = 0;
  // per-group instance VBOs are the World's; the VAO binds them at draw time
  GLuint progScene = 0;
  GLuint quadVao = 0, quadVbo = 0;
  GLuint progBright = 0, progBlur = 0, progComposite = 0;
  // §12.2 enemy-glow pass programs (flat mask + separable gaussian + composite)
  GLuint progMask = 0, progEnemyBlur = 0;
  GLuint sceneFbo = 0, sceneTex = 0;
  GLuint shadowFbo = 0, shadowTex = 0;
  GLuint brightFboA = 0, brightTexA = 0, brightFboB = 0, brightTexB = 0;
  // §12.2 enemy-glow half-res render targets (sharp mask + 2 blur ping-pongs)
  GLuint glowSharpFbo = 0, glowSharpTex = 0;
  GLuint glowBlurAFbo = 0, glowBlurATex = 0;
  GLuint glowBlurBFbo = 0, glowBlurBTex = 0;
  int glowW = 0, glowH = 0; // half-res dims

  // the single shadow-casting torch (static-assigned at level build)
  float torchPos[3] = {0, 6, 0};
  float torchColor[3] = {1.0f, 0.6f, 0.24f};
  float torchIntensity = 0.9f; // JS LIGHT_SOURCES.TORCH.intensity
  // per-biome light/prop identity (BIOMES) — set in buildWorldFromState
  float fogColor[3] = {0.05f, 0.05f, 0.04f};
  float fogDensity = 0.036f;
  float ambientCol[3] = {0.70f, 0.69f, 0.67f};

  // player transform (yaw/pitch are in state.player; camera pos mirrors it)
  double camX = 0, camY = kEyeHeight, camZ = 0;
  float fov = (float)camera::kFov;

  // input (GLFW physical key codes — AZERTY-safe: bind by position)
  bool keyW = false, keyS = false, keyA = false, keyD = false, keyShift = false;
  bool keyLMB = false, keyRMB = false;
  bool keyE = false;
  bool keyN = false, keyY = false; // title / death bookends
  double mouseDX = 0, mouseDY = 0;
  bool pointerLocked = false;

  // ---- entities (Phase 2 slice) ----
  // The Spectral Lord, aggro-on-sight, 25 HP at level 7, SPECTRAL_COURT.
  dc::Boss boss;
  bool bossReady = false;
  // Full enemy roster (§16): spawner + shared AI (dc_core, headless-tested).
  dc::SkeletonSystem skelsys;
  dc::DropSystem drops;   // breakables/sarcophagi/drops (§16.5/§19)
  dc::Rng rng{12345u};
  double simHealth = 3.0;   // boss/enemy damage mutates this; mirrors JS
  double invulnTimer = 0;  // i-frames (PLAYER.INVULN_TIME 0.8) — enemy damage
  bool hasArenaNow = false; // §16.1/§16.4: current level has an ARENA room
  // ---- BURN final-foe (§16.4): ash wraith spawns once when the level clears ----
  bool burnSpawnedThisLevel = false;
  // BURN ground-fire patches: visual-only 6-slot round-robin pool (§16.4).
  struct FirePatch { double x = 0, z = 0, t = 0; bool active = false; };
  std::vector<FirePatch> firePatches;
  int firePatchIdx = 0;
  GLuint dynVbo = 0;        // dynamic instance VBO (boss + enemies, 9 floats)
  int dynCount = 0;
  GLuint enemVbo = 0;       // §12.2 enemy-only instance VBO (skeleton roster, 9 floats)
  int enemCount = 0;

  // ---- §13 decorative systems: smoke / ambient dust / wall runes / water ----
  // SmokeSystem port: 9 pooled GPU points, puff on breakable break, rise+fade.
  struct SmokePuff { float x=0, y=-100, z=0, life=0, ttl=1; float alpha=0; bool active=false; };
  std::array<SmokePuff, dc::kSmokeParticles> smoke{};
  int smokeNext = 0;
  // ParticleSystem port: 30 ambient dust motes (x,y,z), gentle per-frame drift.
  std::array<float, dc::kAmbientDustParticles * 3> dust{};
  double dustT = 0;
  // RuneSystem port: <=10 wall quads (9 floats/inst: off3, phase, uvX, rot, col3).
  std::vector<float> runeData;
  // Water: VAULT-room planes (6 floats/inst: off3, scale2, phase).
  std::vector<float> waterData;
  // breakable-alive snapshot: transition true→false triggers the smoke puff.
  std::vector<bool> prevBreakableAlive;
  // GL handles for the four decorative passes (created in init).
  GLuint progSmoke = 0, progDust = 0, progRune = 0, progWater = 0;
  GLuint smokeVao = 0, smokeVbo = 0;
  GLuint dustVao = 0, dustVbo = 0;
  GLuint runeVao = 0, runeVbo = 0, runeEbo = 0, runeInst = 0;
  GLuint waterVao = 0, waterVbo = 0, waterEbo = 0, waterInst = 0;
  GLuint runeAtlas = 0;
  bool playerDead = false;
  bool bossKillCounted = false;
  bool probeInvuln = false; // --hud-view probe: keep the play screen (not death)
  bool bossPortalOpen = false; // open when !bossLevel, or on boss defeat
  bool prevE = false;
  int  dungeonSeed = 0;        // per-level seed (JS Date.now()^rand, re-rolled per level)
  int  seed = 1000;            // CLI --seed (title-run seed)

  // ---- text / screens (title + death) ----
  Font font;
  GLuint progText = 0, textVbo = 0, textVao = 0;
  GLuint progOverlay = 0;
  GLuint progRect = 0, rectVbo = 0, rectVao = 0;

  // ---- save + leaderboard (JS localStorage → JSON files, §23) ----
  std::string ledgerPath = "leaderboard.json";
  std::string saveFile = "save.json";
  std::unique_ptr<dc::Leaderboard> leaderboard;
  bool saveWritten = false; // save-for-later already written at death
  enum class Screen { Title, Play, Dead };
  Screen screen = Screen::Play;
  bool prevN = false, prevY = false;

  // ---- adaptive performance: 30 fps floor + degraded mode (JS _trackFps) ----
  // Rolling ~3 s (90-frame) fps window. Sustained <30 fps for >6 s → degraded
  // (bloom post-pass dropped = the single biggest GPU cost here) + perf warning;
  // recovers when the average returns to ≥30.
  std::vector<double> fpsWindow;
  double lowFpsTimer = 0;
  bool degraded = false;
  bool forcedDegraded = false; // --degraded: hold the state for the fps gate
  double curFps = 60.0; // last measured avg fps (label visibility, JS _avgFps)
  double avgFps() const {
    if (fpsWindow.empty()) return 60.0;
    double s = 0;
    for (double f : fpsWindow) s += f;
    return s / (double)fpsWindow.size();
  }
  void trackFps(double dt);

  // ---- sword combo (RMB, §9) ----
  int   swordStep = 0;          // 0 idle; 1..3 active
  const char* swordPhase = nullptr; // "windup"|"swing"|"recover"|"cooldown"|nullptr
  double swordPhaseT = 0, swordWindowT = 0, swordCooldownT = 0;
  bool swordBuffered = false;
  double hitStop = 0;           // freezes the sim while > 0
  int   swordHitsLanded = 0;   // debug: total cone hits

  // ---- orb weapon (LMB, §10) ----
  struct Orb { double x=0,y=0,z=0,vx=0,vy=0,vz=0,life=-1,dmg=1; int step=1; bool alive=false; };
  std::vector<Orb> orbs;        // pooled (POOL_NORMAL 48)
  int  orbSeqStep = 0;         // 0 idle; 1..3 in a 3-step sequence
  double orbSeqLast = -1e9;    // last fire time (s) for the sequence window
  double lmbAccum = 0;
  bool prevLMB = false, prevRMB = false;

  // ---- arc bolts (§9.3, T3–T5): pooled homing projectiles, orb dmg frozen at fire ----
  struct ArcBolt {
    double x = 0, y = 1.2, z = 0;
    double life = -1;       // <0 inactive
    int target = -1;       // -1 none, -2 boss, >=0 enemy id (stable across vector erase)
    int dmg = 0;
  };
  std::array<ArcBolt, dc::sword::kArcPool> arcBolts; // §13: 8-slot pool, zero per-shot alloc

  // ---- buffs (§11) ----
  double fireballCd = 0;      // FIREBALL buff (effect 2): RMB hold cooldown
  dc::Hunter hunter;          // HUNTER buff (effect 5) companion
  double buffMoveMult() const { return state.buffEffect == 3 ? 1.2 : state.buffEffect == 4 ? 1.5 : 1.0; }
  double buffAttackMult() const { return state.buffEffect == 3 ? 1.2 : state.buffEffect == 4 ? 1.5 : 1.0; }
  // Pick a buff effect that is NOT the current one (never back-to-back).
  int _pickBuffNotCurrent();
  void _fireFireball();

  // ---- HUD toasts (#messages) — JS _message(): 3.3 s life, max 4 stacked ----
  struct Toast { std::string text; double ttl = 0; };
  std::vector<Toast> toasts;
  bool noAmmoShown = false; // "No orbs!" toast latch (JS _noAmmoShown)
  void toast(const std::string& text);

  bool init(int w, int h, const char* title, const char* fontPath = nullptr);
  void buildWorldFromState();
  void placePlayerAtEntrance();
  void spawnEntities();
  void _onBossDefeated();
  void _checkExitRoom();
  void descend();
  void updateEntities(double dt);
  void updateCombat(double dt);
  void pressSword();
  void beginSwordStep(int step);
  void applySwordCone(int stepIdx);
  void _rollSwordProcs(int tier);   // §9.3: electric proc (all tiers) + arc bolts (T3–T5)
  void _spawnArcBolts(int n);       // pooled homing bolts (orb dmg frozen at fire)
  void _updateArcBolts(double dt);  // 24 u/s homing, retarget on target death
  void fireOrb(int step);
  void _fireOrbStep(bool isClick);
  void hitBoss(double dmg, const char* src);
  void orbExplode(const Orb& o);
  void uploadDynamic(std::vector<float>& dyn, std::vector<float>& enem);
  // §13 decorative systems
  void buildDecor();        // per-level: dust positions, rune quads, water pools
  void updateDecor(double dt); // per-frame: smoke rise/fade, dust drift
  void smokePuff(float x, float y, float z);
  void update(double dt, double rawDt);
  void frame();
  void drawGroup(GLuint instVbo, int count, float emissive = 0.0f);
  void savePPM(const char* path);
  void bakeFont(const char* path);
  float lineW(const char* s, float size);
  void drawTextLine(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s);
  void drawText(const std::vector<float>& v);
  void drawRects(const std::vector<float>& v);
  void drawOverlay(float r, float g, float b, float a);
  void drawHud();
  void _endRun(const char* reason);
  void startRun(int seedToUse);
  ~App();
};

App::~App() {
  if (window) glfwDestroyWindow(window);
  if (window) glfwTerminate();
}

void App::buildWorldFromState() {
  // per-biome material palette + light/prop identity (JS BIOMES — binding data)
  const BiomeLight L = biomeLight(state.biome);
  const float cellCol[3] = {L.floorCol[0], L.floorCol[1], L.floorCol[2]};
  const float wallCol[3] = {L.wallCol[0], L.wallCol[1], L.wallCol[2]};
  const float ceilCol[3] = {L.ceilCol[0], L.ceilCol[1], L.ceilCol[2]};
  world.upload(world.dungeon, cellCol, wallCol, ceilCol, (std::uint32_t)state.dungeonSeed);
  fogColor[0] = L.fogColor[0]; fogColor[1] = L.fogColor[1]; fogColor[2] = L.fogColor[2];
  fogDensity = L.fogDensity;
  ambientCol[0] = L.ambientCol[0]; ambientCol[1] = L.ambientCol[1]; ambientCol[2] = L.ambientCol[2];
  torchColor[0] = L.torchCol[0]; torchColor[1] = L.torchCol[1]; torchColor[2] = L.torchCol[2];
  torchIntensity = L.torchIntensity;
  // static-assigned torch: above the entrance room, casting the 1 shadow map
  if (world.dungeon.entranceCell) {
    torchPos[0] = (float)(world.dungeon.entranceCell->x * world.dungeon.cellSize);
    torchPos[2] = (float)(world.dungeon.entranceCell->z * world.dungeon.cellSize);
    torchPos[1] = 6.0f;
  }
  buildDecor();
}

void App::placePlayerAtEntrance() {
  const dc::CellRef e = world.dungeon.entranceCell.value_or(dc::CellRef{0, 0});
  const double cs = world.dungeon.cellSize;
  state.player.x = e.x * cs;
  state.player.z = e.z * cs;
  state.player.yaw = (float)M_PI; // face into the dungeon
  state.player.pitch = 0;
  camX = state.player.x; camY = kEyeHeight; camZ = state.player.z;
}

// ---- §13 decorative systems ---------------------------------------------
// Per-level placement (deterministic-by-design, like prop placement): the JS
// used unseeded Math.random, so placement here is NOT bit-parity gated; only
// the pools/sizes/colors/opacities are binding (spec §13/§24).
void App::buildDecor() {
  const dc::Dungeon& d = world.dungeon;
  const float cs = (float)d.cellSize;
  // Deterministic decor RNG derived from the level seed (same level → same decor).
  dc::Rng drng((std::uint32_t)state.dungeonSeed ^ 0x5DEECEA5u);

  // Ambient dust (ParticleSystem: 30 motes, torch-adjacent, y 0.5–4.0).
  for (int i = 0; i < dc::kAmbientDustParticles; i++) {
    dust[i * 3 + 0] = torchPos[0] + (float)(drng.next() - 0.5) * 4.0f;
    dust[i * 3 + 1] = 0.5f + (float)drng.next() * 3.5f;
    dust[i * 3 + 2] = torchPos[2] + (float)(drng.next() - 0.5) * 4.0f;
  }
  dustT = 0;

  // Smoke pool reset (puffs are transient — cleared per level).
  for (auto& p : smoke) p.active = false;
  smokeNext = 0;

  // Wall runes (RuneSystem: 8% of room cells, cap 10, y 2.2–3.2).
  runeData.clear();
  float cr = 1.0f, cg = 0.78f, cb = 0.29f; // 0xffc84a default
  if (state.biome == "HAUNTED_CRYPT" || state.biome == "SPECTRAL_COURT") {
    cr = 0x88 / 255.0f; cg = 0xaa / 255.0f; cb = 0xff / 255.0f; // 0x88aaff
  } else if (state.biome == "CRYSTAL_DEPTHS") {
    cr = 0xb0 / 255.0f; cg = 0x7a / 255.0f; cb = 0xff / 255.0f; // 0xb07aff
  }
  int placed = 0;
  for (int z = 1; z < d.gridSize - 1 && placed < dc::kMaxRunes; z++) {
    for (int x = 1; x < d.gridSize - 1 && placed < dc::kMaxRunes; x++) {
      if (d.grid[z][x] != dc::Cell::kRoom) continue;
      if (drng.next() > 0.08) continue;
      // JS: PlaneGeometry(0.9,0.9) at (x*cs, 2.2+rand, z*cs), NO rotation (faces
      // +Z). C++ cell centers are also x*cs (player spawn/torch/exit all use it).
      const float px = (float)x * cs, pz = (float)z * cs;
      runeData.insert(runeData.end(), {
          px, 2.2f + (float)drng.next(), pz,       // offset (y = center of 0.9 quad)
          (float)drng.next() * 6.0f,              // phase (JS: Math.random()*6)
          (float)(placed % 8) / 8.0f,             // glyph slot (uvX)
          0.0f,                                   // rot (JS: none, faces +Z)
          cr, cg, cb});
      placed++;
    }
  }

  // Water (VAULT rooms only, 80% room size, cap kWaterPools=24).
  waterData.clear();
  for (const dc::Room& r : d.rooms) {
    if (r.type != "VAULT") continue;
    if ((int)waterData.size() / 6 >= dc::props::kWaterPools) break;
    const float cx = (float)(r.cx + (r.w - 1) / 2) * cs;
    const float cz = (float)(r.cz + (r.h - 1) / 2) * cs;
    waterData.insert(waterData.end(), {
        cx, 0.22f, cz,                         // floor slab top (0.2) + 0.02 (JS y=0.02)
        (float)(r.w * cs * 0.8), (float)(r.h * cs * 0.8),
        (float)drng.next() * 6.28318f});
  }

  // Breakable-alive snapshot (smoke puffs fire on true→false transitions).
  prevBreakableAlive.assign(drops.breakables().size(), true);
}

void App::updateDecor(double dt) {
  // Smoke: rise + fade (JS SmokeSystem: vy 0.5, life 0.8).
  for (auto& p : smoke) {
    if (!p.active) continue;
    p.life += dt;
    p.y += 0.5f * (float)dt;
    p.alpha = std::max(0.0f, 1.0f - p.life / p.ttl);
    if (p.life >= p.ttl) p.active = false;
  }
  // Dust: gentle drift (JS ParticleSystem: y sin 0.7/1.2, x cos 0.4/1.7).
  dustT += dt;
  for (int i = 0; i < dc::kAmbientDustParticles; i++) {
    dust[i * 3 + 1] += 0.0015f * std::sin((float)dustT * 0.7f + (float)i);
    dust[i * 3 + 0] += 0.0012f * std::cos((float)dustT * 0.4f + (float)(i * 1.7));
  }
}

void App::smokePuff(float x, float y, float z) {
  // Round-robin pool (JS SmokeSystem.puff): read the slot at _next, THEN
  // increment _next. First usable slot is !active or >= 70% through its life.
  for (int tries = 0; tries < dc::kSmokeParticles; tries++) {
    SmokePuff& p = smoke[smokeNext];
    if (!p.active || p.life >= p.ttl * 0.7) {
      p.x = x; p.y = y; p.z = z; p.life = 0; p.ttl = 0.8; p.alpha = 1; p.active = true;
      smokeNext = (smokeNext + 1) % dc::kSmokeParticles;
      return;
    }
    smokeNext = (smokeNext + 1) % dc::kSmokeParticles;
  }
}

void App::spawnEntities() {
  const int level = state.level;
  const bool bossLevel = (level % dc::boss::kInterval == 0);
  skelsys.clear(); // drop previous level's mobs + projectiles
  drops.clear();  // breakables/sarcophagi/drops reset per level
  // BURN final-foe state resets per level (§16.4)
  burnSpawnedThisLevel = false;
  firePatches.clear(); firePatchIdx = 0;
  skelsys.onFirePatch = [this](double x, double z) {
    // round-robin 6-slot pool (JS firePatch): BURN leaves a fire trail
    if (firePatches.empty()) { firePatches.resize(6); for (auto& p : firePatches) p.active = false; }
    FirePatch& p = firePatches[firePatchIdx];
    firePatchIdx = (firePatchIdx + 1) % (int)firePatches.size();
    p.x = x; p.z = z; p.t = 0; p.active = true;
  };
  simHealth = state.maxHealth > 0 ? (double)state.maxHealth : 3.0;
  invulnTimer = 0;
  playerDead = false;
  bossReady = false;
  bossKillCounted = false;
  bossPortalOpen = !bossLevel; // non-boss levels: exit portal open from the start
  // reset sword/orb (fresh level)
  swordStep = 0; swordPhase = nullptr; hitStop = 0;
  orbSeqStep = 0; lmbAccum = 0; prevLMB = prevRMB = false;
  orbs.clear();

  // ---- breakables / sarcophagi / drops (§16.5/§19) — every level ----
  // Deterministic placement via the shared rng (JS used unseeded Math.random).
  drops.buildLevel(world.dungeon, rng);
  // ground hazards (lava/acid): biome-driven, per-room (PropSystem.build).
  drops.buildHazards(world.dungeon, state.biome, rng);
  for (auto& s : drops.sarcophagi()) world.collision.boxes.push_back(s.box); // block
  drops.onOrbCollected = [this] { state.collectedOrbs += 1; }; // a soul orb = 1 soul
  drops.onHealthCollected = [this] {
    simHealth = std::min((double)state.maxHealth, simHealth + dc::drop::kHealthRestore);
    state.health = (int)std::lround(simHealth);
  };
  drops.onBuffCollected = [this](const dc::Vec2&) {
    state.applyBuff(_pickBuffNotCurrent(), dc::buff::kMaxDuration);
  };
  drops.onSarcophagusOpened = [this](dc::Sarcophagus& s) {
    drops.spawnOrbs(s.pos.x, s.pos.z, 1, rng); // guaranteed soul orb
    if (rng.next() < dc::props::kSarcophagusWraith) { // 30% wraith minion
    const dc::CellRef c{(int)std::lround(s.pos.x / world.dungeon.cellSize),
                        (int)std::lround(s.pos.z / world.dungeon.cellSize)};
      skelsys.summonMinion(c, state.level, state.ngPlus, state.collectedOrbs,
                          state.bossKills, rng);
    }
  };
  // ground hazard (lava/acid): 1 dmg per 0.8 s tick, i-frames respected.
  drops.onHazardHit = [this](double dmg) {
    if (invulnTimer > 0 || playerDead || probeInvuln) return;
    simHealth -= dmg;
    invulnTimer = player::kInvulnTime;
  };

  if (bossLevel) {
    static const char* kVariants[7] = {"Skeleton", "Armored", "Archer", "Brute", "Wraith", "Rat", "Magician"};
    const char* variant = kVariants[(level / dc::boss::kInterval - 1) % 7];
    boss = dc::Boss::spawn(world.dungeon, level, state.ngPlus, state.collectedOrbs,
                          state.maxHealth, variant);
    // boss summons → real projectile-firing wraiths (§17)
    boss.onBossSummon = [this](const dc::CellRef& c) {
      return skelsys.summonMinion(c, state.level, state.ngPlus,
                                 state.collectedOrbs, state.bossKills, rng) >= 0;
    };
    bossReady = true;
    bossPortalOpen = false; // sealed until the lord falls
  }
  // skeleton chasers (every level): full roster via the shared spawner (§16)
  hasArenaNow = std::any_of(world.dungeon.rooms.begin(), world.dungeon.rooms.end(),
                            [](const dc::Room& r) { return r.type == "ARENA"; });
  if (!bossLevel) {
    skelsys.buildSpawnPlan(world.dungeon, level, state.collectedOrbs,
                          state.biome, {state.player.x, state.player.z},
                          hasArenaNow, rng);
    // enemy kill → soul orbs (credit + visuals) + 15% health drop (§16.5)
    skelsys.onKill = [this](dc::Enemy* e, const char*) {
      drops.spawnOrbs(e->pos.x, e->pos.z, e->drops, rng);
      if (rng.next() < dc::drop::kHealthChance)
        drops.spawnHealth(e->pos.x, e->pos.z, rng);
      const int t = dc::weaponTier((int)state.collectedOrbs);
      if (t > state.weaponTier) state.weaponTier = t;
    };
    // enemy/projectile damage (i-frames respected, mirrors JS _damagePlayer)
    skelsys.onPlayerDamaged = [this](double dmg, dc::Enemy*) {
      if (invulnTimer > 0 || playerDead || probeInvuln) return;
      simHealth -= dmg;
      invulnTimer = player::kInvulnTime;
    };
  }
}

void App::_onBossDefeated() {
  // JS _onBossDefeated: bossKills++, +1 max heart + full heal, 5-min buff,
  // soul reward, open the portal.
  state.bossKills += 1;
  state.maxHealth += 1;
  state.health = state.maxHealth;
  simHealth = state.maxHealth;
  state.applyBuff(_pickBuffNotCurrent(), dc::buff::kBossDuration);
  const int reward = state.level * std::max(1, state.ngPlus);
  state.collectedOrbs += reward;
  state.weaponTier = dc::weaponTier(state.collectedOrbs);
  bossPortalOpen = true; // the seal breaks — the exit portal opens
}

void App::_checkExitRoom() {
  const auto& ex = world.dungeon.exitCell;
  const double cs = world.dungeon.cellSize;
  if (!ex) { state.inExitRoom = false; prevE = keyE; return; }
  const double cx = ex->x * cs, cz = ex->z * cs;
  const double dx = state.player.x - cx, dz = state.player.z - cz;
  state.inExitRoom = (dx * dx + dz * dz) < player::kExitRoomDist2;
  if (state.inExitRoom && bossPortalOpen && keyE && !prevE) descend();
  prevE = keyE;
}

void App::descend() {
  // JS _descend: level+1, carry souls/tier/ngPlus/bossKills/maxHealth, keep
  // runTime, full heal, regenerate a fresh dungeon + biome for the new level.
  const int level = state.level;
  const double runTime = state.runTime;
  const int orbs = state.collectedOrbs;
  const int tier = state.weaponTier; // locked at the max reached in the run
  const int ng = state.ngPlus;
  const int bk = state.bossKills;
  const int mh = state.maxHealth;
  state.level = level + 1;
  state.biome = dc::biomeForLevel(state.level);
  state.biomeIndex = [&] {
    auto it = std::find(dc::kBiomeSequence.begin(), dc::kBiomeSequence.end(), state.biome);
    return (int)(it != dc::kBiomeSequence.end() ? (it - dc::kBiomeSequence.begin()) : 0);
  }();
  state.levelTime = 0;
  state.runTime = runTime;
  state.collectedOrbs = orbs;
  state.weaponTier = tier;
  state.ngPlus = ng;
  state.bossKills = bk;
  state.maxHealth = mh;
  state.health = state.maxHealth; // health always starts full
  // JS _descend builds a fresh GameState → the active buff does NOT carry.
  state.buffEffect = 0;
  state.buffTime = 0;
  if (hunter.active) hunter.reset();
  // fresh per-level seed (JS Date.now()^rand) + regenerate the dungeon
  dungeonSeed = (int)(rng.next() * 2147483647.0);
  state.dungeonSeed = dungeonSeed;
  dc::DungeonGenerator gen(dungeonSeed, state.biome);
  world.dungeon = gen.generate();
  buildWorldFromState();
  placePlayerAtEntrance();
  spawnEntities(); // re-seeds boss/skeletons for the new level, resets combat
  state.safeSpawn = player::kSafeSpawnTime;
  std::fprintf(stderr, "[dc_app] descended → level %d (%s) portalOpen=%d\n",
               state.level, state.biome.c_str(), (int)bossPortalOpen);
}

void App::updateEntities(double dt) {
  if (playerDead) return;
  const dc::Vec2 pp{state.player.x, state.player.z};

  // ---- buffs (§11): tick + summon/dispose the HUNTER companion ----
  if (state.updateBuff(dt)) { // returned true the frame the buff expired
    if (state.buffEffect == 0 && hunter.active) hunter.reset();
  }
  if (state.buffEffect == 5) hunter.active = true;
  else if (hunter.active) hunter.reset();
  if (hunter.active) {
    std::vector<dc::Enemy*> live;
    for (auto& e : skelsys.enemies()) if (e.alive()) live.push_back(&e);
    const auto& boxes = world.collision.boxes;
    hunter.update(dt, pp, live,
                 [&](const dc::Vec2& a, const dc::Vec2& b) {
                   return dc::hasLineOfSight(boxes, a.x, a.z, b.x, b.z);
                 },
                 [&](dc::Enemy* e) { skelsys.hitEnemy(e, dc::hunter::kBeamDmg, "beam"); },
                 state.collectedOrbs);
  }

  // ---- breakables / sarcophagi / drops (§16.5/§19) — even during safeSpawn ----
  drops.tickBreakables(pp, state.collectedOrbs, rng);
  drops.tickSarcophagi(pp);
  drops.tickHazards(dt, pp); // lava/acid: 1 dmg per 0.8 s (i-frames in the app)
  drops.update(dt, pp);
  // BURN ground-fire patches: advance + expire (visual only, §16.4)
  for (auto& p : firePatches) {
    if (!p.active) continue;
    p.t += dt;
    if (p.t >= 10.0) p.active = false;
  }

  // ---- boss (real state machine) — only on boss levels ----
  if (bossReady) {
    dc::BossCtx bctx;
  bctx.dungeon = &world.dungeon;
  bctx.boxes = &world.collision.boxes;
  bctx.playerPos = pp;
  bctx.playerMaxHealth = state.maxHealth > 0 ? (double)state.maxHealth : 3.0;
  bctx.level = state.level;
  bctx.ngPlus = state.ngPlus;
  bctx.souls = state.collectedOrbs;
  bctx.bossKills = state.bossKills;
  bctx.frozenAll = false;
  bctx.rng = &rng;
  // probe-invulnerable: boss damage no-ops (keep the play screen, not death)
  bctx.playerHealth = probeInvuln ? nullptr : &simHealth;
  boss.update(dt, bctx);
  if (boss.dead && !bossKillCounted) { bossKillCounted = true; _onBossDefeated(); }
  } // end if (bossReady)
  // ---- enemies (dc_core shared AI, §16) — every level ----
  if (!bossReady) {
    skelsys.drainQueue(dt, pp, state.level, state.ngPlus, state.collectedOrbs,
                      state.bossKills, state.safeSpawn > 0, rng);
    dc::EnemyCtx ctx;
    ctx.dungeon = &world.dungeon;
    ctx.boxes = &world.collision.boxes;
    ctx.playerPos = pp;
    ctx.dt = dt;
    ctx.frozenAll = false;
    ctx.safeSpawn = state.safeSpawn > 0;
    ctx.brightActive = state.buffEffect == 1; // BRIGHT: all enemies flee, no attacks (§11 effect 1)
    ctx.attackSpeedMult = 1.0 + dc::kAttackPer3Levels * std::floor((state.level - 1) / 3);
    ctx.level = state.level;
    ctx.ngPlus = state.ngPlus;
    ctx.souls = state.collectedOrbs;
    ctx.bossKills = state.bossKills;
    skelsys.update(dt, ctx);
    // BURN final foe: entire level cleared (non-boss, non-arena) → spawn once.
    if (!hasArenaNow && !burnSpawnedThisLevel && skelsys.queue().empty() &&
        skelsys.liveCount() == 0) {
      burnSpawnedThisLevel = true;
      skelsys.spawnBURN(world.dungeon, pp, state.ngPlus);
    }
  }
  if (invulnTimer > 0) invulnTimer -= dt;
  // ---- sync to GameState + death ----
  simHealth = std::max(0.0, simHealth);
  state.health = (int)std::lround(simHealth);
  if (simHealth <= 0.0 && !playerDead) {
    playerDead = true;
    if (screen == Screen::Play) { screen = Screen::Dead; _endRun("dead"); }
  }
}

// ---- §9 sword combo (RMB) ----
void App::pressSword() {
  if (swordPhase) {
    if (std::strcmp(swordPhase, "recover") == 0 && swordWindowT > 0 && swordStep < 3)
      swordBuffered = true;   // buffered: chains on recover start
    return;                   // busy
  }
  swordBuffered = false;
  beginSwordStep(1);
}
void App::beginSwordStep(int step) {
  swordStep = step;
  swordPhase = "windup";
  swordPhaseT = 0;
}
void App::updateCombat(double dt) {
  if (state.safeSpawn > 0 || playerDead) { prevLMB = keyLMB; prevRMB = keyRMB; return; }
  const double souls = state.collectedOrbs;

  // ---- sword combo (RMB) — suppressed while the FIREBALL buff owns RMB ----
  if (state.buffEffect != 2 && keyRMB && !prevRMB) pressSword();

  // ---- FIREBALL buff: hold RMB to hurl fireballs (no soul cost), sword hidden ----
  if (state.buffEffect == 2 && keyRMB) {
    fireballCd -= dt;
    if (fireballCd <= 0) { fireballCd = dc::orbWeapon::kFireballCooldown; _fireFireball(); }
  } else if (!keyRMB) fireballCd = 0;

  // ---- sword combo advance ----
  if (swordPhase) {
    if (std::strcmp(swordPhase, "cooldown") == 0) {
      swordCooldownT -= dt;
      if (swordCooldownT <= 0) { swordPhase = nullptr; swordStep = 0; swordWindowT = 0; }
    } else {
      const auto& def = dc::kSwordCombo[std::max(0, swordStep - 1)];
      const double speedMult = dc::attackSpeedFromSouls(souls) * buffAttackMult();
      const double wu = def.windup / speedMult;
      const double sw = def.swing / speedMult;
      const double rc = def.recover / speedMult;
      swordPhaseT += dt;
      if (std::strcmp(swordPhase, "windup") == 0 && swordPhaseT >= wu) {
        swordPhase = "swing"; swordPhaseT = 0;
        applySwordCone(swordStep - 1);
      } else if (std::strcmp(swordPhase, "swing") == 0 && swordPhaseT >= sw) {
        swordPhase = "recover"; swordPhaseT = 0; swordWindowT = dc::kComboWindow;
      } else if (std::strcmp(swordPhase, "recover") == 0) {
        swordWindowT -= dt;
        if (swordBuffered && swordStep < 3) { swordBuffered = false; beginSwordStep(swordStep + 1); }
        else if (swordPhaseT >= rc) {
          swordPhase = "cooldown"; swordCooldownT = dc::kComboCooldown;
        }
      }
    }
  }

  // ---- §10 orb weapon (LMB) ----
  if (orbSeqStep > 0 && state.runTime - orbSeqLast > dc::orbWeapon::kSequenceWindow) orbSeqStep = 0;
  if (keyLMB && !prevLMB) { _fireOrbStep(true); }
  else if (keyLMB) {
    lmbAccum += dt;
    if (lmbAccum >= dc::orbWeapon::kStepInterval) { lmbAccum = 0; _fireOrbStep(false); }
  } else {
    lmbAccum = dc::orbWeapon::kStepInterval;
  }

  // ---- advance orb projectiles ----
  for (auto& o : orbs) {
    if (!o.alive) continue;
    o.life -= dt;
    if (o.life <= 0) { if (o.step == 3) orbExplode(o); o.alive = false; continue; }
    o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
    bool hit = false;
    if (bossReady && !boss.dead) {
      const double db = std::hypot(o.x - boss.pos.x, o.z - boss.pos.z);
      if (db < 1.5) { hitBoss(o.dmg, "orb"); hit = true; }
    }
    if (!hit) {
      for (dc::Enemy* e : skelsys.nearby(o.x, o.z, 0.6)) {
        skelsys.hitEnemy(e, o.dmg, "orb"); hit = true; break;
      }
    }
    if (hit) { if (o.step == 3) orbExplode(o); o.alive = false; }
  }

  // ---- advance arc bolts (§9.3, T3–T5) ----
  _updateArcBolts(dt);

  prevLMB = keyLMB; prevRMB = keyRMB;
}
void App::applySwordCone(int stepIdx) {
  const double souls = state.collectedOrbs;
  const int tier = dc::weaponTier((int)souls);
  const double scale = dc::totalSwordScale(tier, state.buffEffect == 3 ? 1.5 : 1.0);
  const double range = 2.2 * scale * (1 + 0.04 * tier) * (stepIdx == 2 ? 1.25 : 1.0);
  const double arcDot = dc::kSwordCombo[stepIdx].arcDot;
  const float yaw = state.player.yaw;
  const double dirx = -std::sin(yaw), dirz = -std::cos(yaw);
  const double ox = state.player.x, oz = state.player.z;
  int hitCount = 0;
  const double dmgBase = dc::kSwordCombo[stepIdx].damage + tier;
  const double sizePart = (1 + (scale - 1) * 0.5);
  const double dmgMult = sizePart * std::pow(1.1, tier) * std::pow(1.1, std::floor(state.level / 5));
  const double dmg = dmgBase * dmgMult;
  auto inCone = [&](double ex, double ez) {
    double tx = ex - ox, tz = ez - oz;
    double d = std::hypot(tx, tz);
    if (d > range + 0.5) return false;
    tx /= d; tz /= d;
    return (dirx * tx + dirz * tz) >= arcDot;
  };
  if (bossReady && !boss.dead && inCone(boss.pos.x, boss.pos.z)) { hitBoss(dmg, "sword"); hitCount++; }
  for (dc::Enemy* e : skelsys.nearby(ox, oz, range + 0.5))
    if (inCone(e->pos.x, e->pos.z)) { skelsys.hitEnemy(e, dmg, "sword"); hitCount++; }
  // breakables: slightly looser cone over full reach (arcDot - 0.12)
  for (auto& br : drops.breakables()) {
    if (!br.alive) continue;
    const double tx = br.pos.x - ox, tz = br.pos.z - oz;
    const double d = std::hypot(tx, tz);
    if (d > range) continue;
    if ((dirx * (tx / d) + dirz * (tz / d)) >= arcDot - 0.12) drops.breakProp(br, souls, rng);
  }
  if (hitCount > 0) {
    hitStop = std::max(hitStop, dc::sword::kHitStop);
    swordHitsLanded += hitCount;
    _rollSwordProcs(tier); // §9.3: electric proc (all tiers) + arc bolts (T3–T5)
  }
}
void App::_rollSwordProcs(int tier) {
  const double souls = state.collectedOrbs;
  const double px = state.player.x, pz = state.player.z;
  // electric proc (all tiers): 5% chance, blast 5× orb damage within 20 u (JS _rollSwordProcs)
  if (rng.next() < dc::sword::kElectricChance) {
    const double blast = dc::sword::kElectricDamageMult * (1.0 + 0.02 * souls) * 2.0; // ×5 orb dmg
    int count = 0;
    if (bossReady && !boss.dead &&
        std::hypot(boss.pos.x - px, boss.pos.z - pz) < dc::sword::kElectricRange) {
      hitBoss(blast, "electric"); count++;
    }
    for (dc::Enemy* e : skelsys.nearby(px, pz, dc::sword::kElectricRange)) {
      if (!e->alive()) continue;
      skelsys.hitEnemy(e, blast, "electric"); count++;
    }
    if (count > 0) {
      hitStop = dc::hitStop::electricChain; // 0.12 s (JS sets, not max)
      char buf[64];
      std::snprintf(buf, sizeof(buf), "ELECTRIC CHAIN — %d foes blasted!", count);
      toast(buf);
      if (!firePatches.empty()) { // fire patch at the player (JS firePatch)
        FirePatch& p = firePatches[firePatchIdx];
        firePatchIdx = (firePatchIdx + 1) % (int)firePatches.size();
        p.x = px; p.z = pz; p.t = 0; p.active = true;
      }
    }
  }
  // arc bolts (T3–T5): pooled homing projectiles, orb dmg frozen at fire time
  const double chance = dc::kArcChance[tier];
  if (chance > 0 && rng.next() < chance) _spawnArcBolts(tier == 5 ? 2 : 1);
}
void App::_spawnArcBolts(int n) {
  const double px = state.player.x, pz = state.player.z;
  // candidates: alive enemies within 20 u + boss, nearest-first (JS _hitTargets sort)
  struct Cand { double d2; int kind; int id; }; // kind 0=enemy, 1=boss
  std::vector<Cand> cands;
  for (const auto& e : skelsys.enemies()) {
    if (!e.alive()) continue;
    const double dx = e.pos.x - px, dz = e.pos.z - pz;
    if (dx * dx + dz * dz < dc::sword::kArcTargetRange * dc::sword::kArcTargetRange)
      cands.push_back({dx * dx + dz * dz, 0, e.id});
  }
  if (bossReady && !boss.dead) {
    const double dx = boss.pos.x - px, dz = boss.pos.z - pz;
    if (dx * dx + dz * dz < dc::sword::kArcTargetRange * dc::sword::kArcTargetRange)
      cands.push_back({dx * dx + dz * dz, 1, -2});
  }
  std::sort(cands.begin(), cands.end(), [](const Cand& a, const Cand& b) { return a.d2 < b.d2; });
  const int dmg = dc::orbDirectDamage(state.collectedOrbs); // frozen at fire time
  int fired = 0;
  for (auto& b : arcBolts) {
    if (b.life >= 0 || fired >= n) continue;
    if (cands.empty()) break;
    const Cand& c = cands[fired % cands.size()];
    b.x = px; b.y = camY; b.z = pz;
    b.life = dc::sword::kArcLife; b.dmg = dmg;
    b.target = c.id; // enemy id (>=0) or -2 (boss)
    fired++;
  }
}
void App::_updateArcBolts(double dt) {
  const double px = state.player.x, pz = state.player.z;
  for (auto& b : arcBolts) {
    if (b.life < 0) continue;
    b.life -= dt;
    // resolve target (stable enemy id / boss), retarget nearest if it died
    int kind = 0, idx = -1;
    if (b.target == -2) {
      if (bossReady && !boss.dead) kind = 1;
    } else if (b.target >= 0) {
      idx = skelsys.findId(b.target); // -1 if expired/erased
      if (idx >= 0) kind = 0;
    }
    if (kind == 0 && idx < 0) {
      // re-target nearest alive enemy OR boss (JS: _hitTargets includes boss)
      double bd = 1e18; int bidx = -1; int bkind = 0;
      for (size_t i = 0; i < skelsys.enemies().size(); i++) {
        const auto& e = skelsys.enemies()[i];
        if (!e.alive()) continue;
        const double dx = e.pos.x - px, dz = e.pos.z - pz;
        const double d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; bidx = (int)i; bkind = 0; }
      }
      if (bossReady && !boss.dead) {
        const double dx = boss.pos.x - px, dz = boss.pos.z - pz;
        const double d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; bidx = -2; bkind = 1; }
      }
      if (bidx < 0 && bkind == 0) { b.life = -1; continue; }
      kind = bkind; idx = bidx;
      b.target = (bkind == 1) ? -2 : skelsys.enemies()[bidx].id; // enemy id (stable) or -2 (boss)
    }
    double tx, tz, ty = 1.2;
    if (kind == 1) { tx = boss.pos.x; tz = boss.pos.z; }
    else { const auto& e = skelsys.enemies()[idx]; tx = e.pos.x; tz = e.pos.z; }
    double dx = tx - b.x, dy = ty - b.y, dz = tz - b.z;
    double d = std::hypot(dx, dy, dz);
    if (d < 0.6) {
      if (kind == 1) hitBoss(b.dmg, "arcBolt");
      else {
        if (idx < (int)skelsys.enemies().size())
          skelsys.hitEnemy(&skelsys.enemies()[idx], b.dmg, "arcBolt");
      }
      b.life = -1;
      continue;
    }
    b.x += (dx / d) * dc::sword::kArcSpeed * dt;
    b.y += (dy / d) * dc::sword::kArcSpeed * dt;
    b.z += (dz / d) * dc::sword::kArcSpeed * dt;
    if (b.life <= 0) b.life = -1;
  }
}
void App::_fireOrbStep(bool /*isClick*/) {
  if (orbSeqStep == 0 || state.runTime - orbSeqLast > dc::orbWeapon::kSequenceWindow) {
    if (state.collectedOrbs <= 0) {
      // no-ammo: JS shows "No orbs! Slay skeletons to gather orbs" once per dry stretch
      if (!noAmmoShown) { toast("No orbs! Slay skeletons to gather orbs"); noAmmoShown = true; }
      return;
    }
    state.collectedOrbs -= 1;                      // first step of a new sequence costs 1
    orbSeqStep = 1;
    noAmmoShown = false;                           // JS resets on a successful fire
  } else {
    orbSeqStep = std::min(3, orbSeqStep + 1);
  }
  orbSeqLast = state.runTime;
  fireOrb(orbSeqStep);
}
void App::fireOrb(int step) {
  if ((int)orbs.size() >= dc::orbWeapon::kPoolNormal) return; // pool cap
  const float yaw = state.player.yaw, pitch = state.player.pitch;
  const double cp = std::cos(pitch);
  const double dirx = -std::sin(yaw) * cp, dirz = -std::cos(yaw) * cp, diry = std::sin(pitch);
  Orb o;
  o.x = state.player.x + dirx * 0.6; o.y = camY + diry * 0.6; o.z = state.player.z + dirz * 0.6;
  o.vx = dirx * dc::orbWeapon::kSpeed; o.vy = diry * dc::orbWeapon::kSpeed; o.vz = dirz * dc::orbWeapon::kSpeed;
  o.life = dc::orbWeapon::kLife; o.step = step; o.alive = true;
  const double soulsAmt = state.collectedOrbs;
  o.dmg = step == 3 ? dc::orbExplodeDamage(soulsAmt) : dc::orbDirectDamage(soulsAmt);
  orbs.push_back(o);
}
void App::hitBoss(double dmg, const char* src) {
  if (bossReady && !boss.dead) boss.hitBoss(dmg, src);
}
int App::_pickBuffNotCurrent() {
  // §11: never the same buff twice in a row — filter the current one out,
  // then pick uniformly from the remainder.
  int pool[5], n = 0;
  for (int e = 1; e <= 5; e++) if (e != state.buffEffect) pool[n++] = e;
  return pool[rng.nextInt(n)];
}
void App::_fireFireball() {
  // FIREBALL buff: free (no soul cost) step-3 fireball, capped pool 6.
  int active = 0;
  for (const auto& o : orbs) if (o.alive && o.step == 3) active++;
  if (active >= dc::orbWeapon::kPoolFireball) return;
  const float yaw = state.player.yaw, pitch = state.player.pitch;
  const double cp = std::cos(pitch);
  const double dirx = -std::sin(yaw) * cp, dirz = -std::cos(yaw) * cp, diry = std::sin(pitch);
  Orb o;
  o.x = state.player.x + dirx * 0.6; o.y = camY + diry * 0.6; o.z = state.player.z + dirz * 0.6;
  o.vx = dirx * dc::orbWeapon::kSpeed; o.vy = diry * dc::orbWeapon::kSpeed; o.vz = dirz * dc::orbWeapon::kSpeed;
  o.life = dc::orbWeapon::kLife; o.step = 3; o.alive = true;
  o.dmg = dc::orbExplodeDamage(state.collectedOrbs);
  orbs.push_back(o);
}
void App::orbExplode(const Orb& o) {
  if (bossReady && !boss.dead && std::hypot(o.x - boss.pos.x, o.z - boss.pos.z) < 2.0) hitBoss(o.dmg, "explosion");
  for (dc::Enemy* e : skelsys.nearby(o.x, o.z, 2.0)) skelsys.hitEnemy(e, o.dmg, "explosion");
  // breakables in the blast radius too
  const double souls = state.collectedOrbs;
  for (auto& br : drops.breakables()) {
    if (!br.alive) continue;
    const double dx = br.pos.x - o.x, dz = br.pos.z - o.z;
    if (dx * dx + dz * dz < 2.0 * 2.0) drops.breakProp(br, souls, rng);
  }
}

void App::uploadDynamic(std::vector<float>& dyn, std::vector<float>& enem) {
  dyn.clear();
  enem.clear();
  auto push = [&](float ox, float oy, float oz, float sx, float sy, float sz,
                  float r, float g, float b) {
    dyn.insert(dyn.end(), {ox, oy, oz, sx, sy, sz, r, g, b});
  };
  // §12.2 enemy-only push: same 9-float layout, appended to enem for the glow mask
  auto epush = [&](float ox, float oy, float oz, float sx, float sy, float sz,
                   float r, float g, float b) {
    enem.insert(enem.end(), {ox, oy, oz, sx, sy, sz, r, g, b});
  };
  // boss (glowing SPECTRAL_COURT accent ~0xaa88ff): pulse while awake
  if (bossReady && !boss.dead) {
    const float s = 1.6f + 0.15f * (float)std::sin(state.runTime * 6.0);
    push((float)boss.pos.x, 1.1f, (float)boss.pos.z, s, 2.2f, s, 0.66f, 0.53f, 1.0f);
  } else if (bossReady) {
    push((float)boss.pos.x, 0.4f, (float)boss.pos.z, 1.4f, 0.2f, 1.4f, 0.4f, 0.3f, 0.5f); // corpse
  }
  // ---- full enemy roster (cubes, emissive spectral) — by type ----
  for (const auto& e : skelsys.enemies()) {
    if (e.state == dc::EnemyState::kDead) continue;
    float r = 0.85f, g = 0.85f, b = 0.8f; // SKELETON bone white (default)
    float sx = 0.6f, sy = 1.7f, sz = 0.6f, y = 0.85f;
    if (e.type == "MAGICIAN") { r = 0.7f; g = 0.5f; b = 0.9f; }
    else if (e.type == "ARMORED") { r = 0.6f; g = 0.62f; b = 0.66f; sx = 0.9f; sy = 1.8f; sz = 0.9f; y = 0.9f; }
    else if (e.type == "ARCHER") { r = 0.5f; g = 0.8f; b = 0.5f; sx = 0.55f; sz = 0.55f; }
    else if (e.type == "RAT") { r = 0.6f; g = 0.5f; b = 0.4f; sx = 0.5f; sy = 0.5f; sz = 0.9f; y = 0.25f; }
    else if (e.type == "BRUTE") { r = 0.7f; g = 0.3f; b = 0.3f; sx = 1.5f; sy = 2.2f; sz = 1.5f; y = 1.1f; }
    else if (e.type == "WRAITH") { r = 0.7f; g = 0.8f; b = 0.9f; sx = 0.7f; sy = 1.8f; sz = 0.7f;
                                   y = 1.2f + 0.15f * (float)std::sin(state.runTime * 3.0 + e.pos.x); }
    else if (e.isBURN) { r = 1.0f; g = 0.4f; b = 0.1f; sx = 1.2f; sy = 1.4f; sz = 1.2f; y = 0.7f; }
    const float sc = (float)(e.eliteScale * (1.0 + e.hitFlash * 0.3)); // elite + hit-pop
    push((float)e.pos.x, y, (float)e.pos.z, sx * sc, sy * sc, sz * sc, r, g, b);
    epush((float)e.pos.x, y, (float)e.pos.z, sx * sc, sy * sc, sz * sc, r, g, b); // §12.2 glow mask
  }
  // enemy projectiles — arrows amber, fireball orbs violet
  for (const auto& p : skelsys.arrows())
    if (p.active) push((float)p.pos.x, 1.2f, (float)p.pos.z, 0.25f, 0.25f, 0.25f, 1.0f, 0.7f, 0.3f);
  for (const auto& p : skelsys.orbs())
    if (p.active) push((float)p.pos.x, 1.2f, (float)p.pos.z, 0.3f, 0.3f, 0.3f, 0.7f, 0.5f, 1.0f);
  // soul-fire orbs (blue-white)
  for (const auto& o : orbs)
    if (o.alive) push((float)o.x, (float)o.y, (float)o.z, 0.3f, 0.3f, 0.3f, 0.6f, 0.8f, 1.0f);
  // floating sword (no hands) — a pale blade in front of the camera during a combo
  if (swordPhase && std::strcmp(swordPhase, "cooldown") != 0) {
    const float yaw = state.player.yaw;
    const double fx = -std::sin(yaw), fz = -std::cos(yaw);
    const double reach = std::strcmp(swordPhase, "swing") == 0 ? 0.7 : 0.45;
    const double sx = state.player.x + fx * reach, sz = state.player.z + fz * reach;
    const double sy = camY - 0.15;
    push((float)sx, (float)sy, (float)sz, 0.06f, 0.9f, 0.06f, 0.85f, 0.9f, 1.0f);
  }
  // ---- BURN ground-fire patches (visual, §16.4): grow 0.3 s, fade last 1 s ----
  for (const auto& p : firePatches) {
    if (!p.active) continue;
    const float grow = (float)std::min(1.0, p.t / 0.3);
    const float fade = (p.t > 9.0) ? (float)std::max(0.0, 10.0 - p.t) : 1.0f;
    const float s = 0.5f * grow * fade;
    if (s <= 0.001f) continue;
    push((float)p.x, 0.04f, (float)p.z, s, 0.06f, s, 1.0f, 0.45f, 0.1f);
  }
  // ---- breakables (barrels/crates) — warm brown, emissive ----
  for (const auto& b : drops.breakables())
    if (b.alive) push((float)b.pos.x, 0.5f, (float)b.pos.z, 0.5f, 0.7f, 0.5f, 0.55f, 0.4f, 0.25f);
  // ---- sarcophagi (CRYPT) — stone slab; lid dims once opened ----
  for (const auto& s : drops.sarcophagi()) {
    const float r = s.opened ? 0.3f : 0.55f;
    push((float)s.pos.x, 0.6f, (float)s.pos.z, 1.1f, 1.2f, 2.3f, r, r, r + 0.05f);
  }
  // ---- ground hazards (lava/acid) — flat emissive pools (§16.5) ----
  // lava 0xff5a1e / acid 0x99ff33, y 0.03, radius 1.0..1.6 (JS PropSystem).
  for (const auto& hz : drops.hazards()) {
    const float r = (float)hz.radius;
    if (hz.kind == 0) push((float)hz.pos.x, 0.03f, (float)hz.pos.z, r, 0.08f, r, 1.0f, 0.353f, 0.118f); // lava
    else              push((float)hz.pos.x, 0.03f, (float)hz.pos.z, r, 0.08f, r, 0.6f, 1.0f, 0.2f); // acid
  }
  // ---- drop pickups: health = red cross, buff = gold orb (bob) ----
  for (const auto& p : drops.pickups()) {
    const float y = 0.5f + 0.15f * (float)std::sin(p.bob);
    if (p.kind == 0) push((float)p.pos.x, y, (float)p.pos.z, 0.3f, 0.3f, 0.3f, 0.9f, 0.2f, 0.2f);
    else            push((float)p.pos.x, y, (float)p.pos.z, 0.3f, 0.3f, 0.3f, 1.0f, 0.85f, 0.3f);
  }
  // ---- soul-orb visuals (credit is instant; the orb floats ~1.0 s) ----
  for (const auto& v : drops.orbVisuals())
    if (v.t >= 0) {
      const float y = 0.5f + 0.15f * (float)std::sin(v.t * 6.0);
      push((float)v.pos.x, y, (float)v.pos.z, 0.18f, 0.18f, 0.18f, 0.5f, 0.7f, 1.0f);
    }
}

bool App::init(int w, int h, const char* title, const char* fontPath) {
  if (!glfwInit()) {
    std::fprintf(stderr, "[dc_app] glfwInit failed\n");
    return false;
  }
  glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
  glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
  glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
  glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
  window = glfwCreateWindow(w, h, title, nullptr, nullptr);
  if (!window) {
    std::fprintf(stderr, "[dc_app] glfw window failed (no display / no GL?)\n");
    glfwTerminate();
    return false;
  }
  glfwMakeContextCurrent(window);
  glfwSwapInterval(1);
  width = w; height = h;
  glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED); // pointer-lock equivalent

  int maj = 0, mino = 0;
  glGetIntegerv(GL_MAJOR_VERSION, &maj);
  glGetIntegerv(GL_MINOR_VERSION, &mino);
  std::fprintf(stderr, "[dc_app] GL %d.%d %s\n", maj, mino, (const char*)glGetString(GL_VERSION));

  // ---- cube geometry (24 verts pos+normal, 36 idx) ----
  struct Face { float n[3]; float v[4][3]; };
  static const Face faces[6] = {
      {{0, 0, 1}, {{-1, -1, 1}, {1, -1, 1}, {1, 1, 1}, {-1, 1, 1}}},
      {{0, 0, -1}, {{1, -1, -1}, {-1, -1, -1}, {-1, 1, -1}, {1, 1, -1}}},
      {{1, 0, 0}, {{1, -1, 1}, {1, -1, -1}, {1, 1, -1}, {1, 1, 1}}},
      {{-1, 0, 0}, {{-1, -1, 1}, {-1, -1, -1}, {-1, 1, -1}, {-1, 1, 1}}},
      {{0, 1, 0}, {{-1, 1, 1}, {1, 1, 1}, {1, 1, -1}, {-1, 1, -1}}},
      {{0, -1, 0}, {{-1, -1, 1}, {1, -1, 1}, {1, -1, -1}, {-1, -1, -1}}},
  };
  std::vector<float> verts;
  std::vector<GLuint> idx;
  for (int f = 0; f < 6; f++) {
    for (int i = 0; i < 4; i++) {
      verts.push_back(faces[f].v[i][0] * 0.5f);
      verts.push_back(faces[f].v[i][1] * 0.5f);
      verts.push_back(faces[f].v[i][2] * 0.5f);
      verts.push_back(faces[f].n[0]);
      verts.push_back(faces[f].n[1]);
      verts.push_back(faces[f].n[2]);
    }
    GLuint base = (GLuint)(f * 4);
    idx.insert(idx.end(), {base, base + 1, base + 2, base, base + 2, base + 3});
  }
  vertCount = (int)idx.size();
  glGenBuffers(1, &vbo);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(verts.size() * sizeof(float)), verts.data(), GL_STATIC_DRAW);
  glGenBuffers(1, &ebo);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
  glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizeiptr)(idx.size() * sizeof(GLuint)), idx.data(), GL_STATIC_DRAW);

  // cube VAO: attrib 0,1 from vbo; the element buffer ebo is bound HERE so the
  // VAO retains it (a VAO captures the EBO at bind time, not at draw time).
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
  glEnableVertexAttribArray(1);
  glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo); // ← retained by the VAO
  // attribs 2/3/4 (offset/scale/color) are set in drawGroup() from the inst VBO
  glBindVertexArray(0);

  // ---- fullscreen triangle ----
  float tri[6] = {-1.f, -1.f, 3.f, -1.f, -1.f, 3.f};
  glGenVertexArrays(1, &quadVao);
  glGenBuffers(1, &quadVbo);
  glBindVertexArray(quadVao);
  glBindBuffer(GL_ARRAY_BUFFER, quadVbo);
  glBufferData(GL_ARRAY_BUFFER, sizeof(tri), tri, GL_STATIC_DRAW);
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, (void*)0);
  glBindVertexArray(0);

  // ---- programs ----
  progScene = linkProgram(compileShader(GL_VERTEX_SHADER, kLitVert),
                          compileShader(GL_FRAGMENT_SHADER, kLitFrag));
  progBright = linkProgram(compileShader(GL_VERTEX_SHADER, kFullscreenVert),
                           compileShader(GL_FRAGMENT_SHADER, kBrightFrag));
  progBlur = linkProgram(compileShader(GL_VERTEX_SHADER, kFullscreenVert),
                         compileShader(GL_FRAGMENT_SHADER, kBlurFrag));
  progComposite = linkProgram(compileShader(GL_VERTEX_SHADER, kFullscreenVert),
                              compileShader(GL_FRAGMENT_SHADER, kCompositeFrag));
  // §12.2 enemy-glow programs: flat-mask (lit vertex + flat frag) + separable gaussian
  progMask = linkProgram(compileShader(GL_VERTEX_SHADER, kLitVert),
                         compileShader(GL_FRAGMENT_SHADER, kFlatMaskFrag));
  progEnemyBlur = linkProgram(compileShader(GL_VERTEX_SHADER, kFullscreenVert),
                              compileShader(GL_FRAGMENT_SHADER, kEnemyBlurFrag));

  // ---- FBOs ----
  auto makeColorTex = [&](int tw, int th) {
    GLuint t;
    glGenTextures(1, &t);
    glBindTexture(GL_TEXTURE_2D, t);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB8, tw, th, 0, GL_RGB, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    return t;
  };
  auto makeFbo = [&](GLuint tex, bool depth) {
    GLuint f;
    glGenFramebuffers(1, &f);
    glBindFramebuffer(GL_FRAMEBUFFER, f);
    if (depth) glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, tex, 0);
    else glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    return f;
  };

  sceneTex = makeColorTex(width, height);
  sceneFbo = makeFbo(sceneTex, false);
  {
    GLuint rb;
    glGenRenderbuffers(1, &rb);
    glBindRenderbuffer(GL_RENDERBUFFER, rb);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, width, height);
    glBindFramebuffer(GL_FRAMEBUFFER, sceneFbo);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, rb);
    glDrawBuffer(GL_COLOR_ATTACHMENT0);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
  }
  {
    GLuint t;
    glGenTextures(1, &t);
    glBindTexture(GL_TEXTURE_2D, t);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT32F, kShadowSize, kShadowSize, 0,
                 GL_DEPTH_COMPONENT, GL_FLOAT, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    shadowTex = t;
  }
  shadowFbo = makeFbo(shadowTex, true);
  {
    // depth-only FBO: GL_NONE drawbuffer (a color attach would make it incomplete)
    glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo);
    glDrawBuffer(GL_NONE);
    glReadBuffer(GL_NONE);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
  }
  brightTexA = makeColorTex(width, height);
  brightFboA = makeFbo(brightTexA, false);
  brightTexB = makeColorTex(width, height);
  brightFboB = makeFbo(brightTexB, false);

  // ---- §12.2 enemy-glow half-res RTs (sharp mask + 2 blur ping-pongs) ----
  glowW = std::max(2, width / 2);
  glowH = std::max(2, height / 2);
  glowSharpTex = makeColorTex(glowW, glowH);
  glowSharpFbo = makeFbo(glowSharpTex, false);
  glowBlurATex = makeColorTex(glowW, glowH);
  glowBlurAFbo = makeFbo(glowBlurATex, false);
  glowBlurBTex = makeColorTex(glowW, glowH);
  glowBlurBFbo = makeFbo(glowBlurBTex, false);

  // ---- dynamic entity VBO (boss + full roster + projectiles + props), streamed
  //      each frame. Capacity: ~120 combat (30 mobs + 24 arrows + 16 orbs +
  //      48 soul orbs + boss + sword) + 400 props (breakables/sarcophagi hard
  //      cap) + headroom = 560 instances worst case. ----
  constexpr int kDynCap = 560;
  glGenBuffers(1, &dynVbo);
  glBindBuffer(GL_ARRAY_BUFFER, dynVbo);
  { std::vector<float> tmp(kDynCap * 9, 0.0f);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(tmp.size() * sizeof(float)), tmp.data(), GL_DYNAMIC_DRAW); }
  glBindBuffer(GL_ARRAY_BUFFER, 0);

  // §12.2 enemy-only VBO (skeleton roster, 9 floats/inst) for the flat glow mask
  glGenBuffers(1, &enemVbo);
  glBindBuffer(GL_ARRAY_BUFFER, enemVbo);
  { std::vector<float> tmp(64 * 9, 0.0f); // <= 64 live mobs
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(tmp.size() * sizeof(float)), tmp.data(), GL_DYNAMIC_DRAW); }
  glBindBuffer(GL_ARRAY_BUFFER, 0);

  // ---- §13 decorative systems: smoke / ambient dust / wall runes / water ----
  // Programs (each a tiny point/quad/instanced-quad pass, all drawn into the
  // scene FBO before the enemy-glow mask so they read the lit scene depth).
  progSmoke = linkProgram(compileShader(GL_VERTEX_SHADER, kSmokeVert),
                          compileShader(GL_FRAGMENT_SHADER, kSmokeFrag));
  progDust  = linkProgram(compileShader(GL_VERTEX_SHADER, kDustVert),
                         compileShader(GL_FRAGMENT_SHADER, kDustFrag));
  progRune  = linkProgram(compileShader(GL_VERTEX_SHADER, kRuneVert),
                         compileShader(GL_FRAGMENT_SHADER, kRuneFrag));
  progWater = linkProgram(compileShader(GL_VERTEX_SHADER, kWaterVert),
                         compileShader(GL_FRAGMENT_SHADER, kWaterFrag));

  // Smoke: 9 pooled points (x,y,z + alpha).
  glGenVertexArrays(1, &smokeVao);
  glGenBuffers(1, &smokeVbo);
  {
    std::vector<float> tmp(dc::kSmokeParticles * 4, 0.0f);
    for (int i = 0; i < dc::kSmokeParticles; i++) tmp[i * 4 + 1] = -100.0f; // hidden
    glBindVertexArray(smokeVao);
    glBindBuffer(GL_ARRAY_BUFFER, smokeVbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(tmp.size() * sizeof(float)), tmp.data(), GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 16, (void*)0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 1, GL_FLOAT, GL_FALSE, 16, (void*)12);
    glBindVertexArray(0);
  }

  // Ambient dust: 30 points (x,y,z).
  glGenVertexArrays(1, &dustVao);
  glGenBuffers(1, &dustVbo);
  {
    std::vector<float> tmp(dc::kAmbientDustParticles * 3, 0.0f);
    glBindVertexArray(dustVao);
    glBindBuffer(GL_ARRAY_BUFFER, dustVbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(tmp.size() * sizeof(float)), tmp.data(), GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 12, (void*)0);
    glBindVertexArray(0);
  }

  // Runes: instanced quad (pos2+uv2 per-vertex) + per-instance (offset3,phase,uvX,rot,color3).
  {
    // quad standing 0.9×0.9, centered (aPos.x horizontal, aPos.y vertical), 0.5–0.5 extent
    const unsigned int qidx[6] = {0, 1, 2, 0, 2, 3};
    glGenVertexArrays(1, &runeVao);
    glGenBuffers(1, &runeVbo);
    glGenBuffers(1, &runeEbo);
    glGenBuffers(1, &runeInst);
    glBindVertexArray(runeVao);
    {
      // interleaved pos2+uv2 = 16B/vertex, 4 verts
      const float inter[16] = {
          -0.5f, -0.5f, 0.0f, 1.0f,
           0.5f, -0.5f, 1.0f, 1.0f,
          -0.5f,  0.5f, 0.0f, 0.0f,
           0.5f,  0.5f, 1.0f, 0.0f};
      glBindBuffer(GL_ARRAY_BUFFER, runeVbo);
      glBufferData(GL_ARRAY_BUFFER, sizeof(inter), inter, GL_STATIC_DRAW);
      glEnableVertexAttribArray(0);
      glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 16, (void*)0);
      glEnableVertexAttribArray(1);
      glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 16, (void*)8);
    }
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, runeEbo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(qidx), qidx, GL_STATIC_DRAW);
    // instance buffer (9 floats/inst = 36B): offset3, phase, uvX, rot, color3
    glBindBuffer(GL_ARRAY_BUFFER, runeInst);
    glBufferData(GL_ARRAY_BUFFER, dc::kMaxRunes * 9 * (GLsizeiptr)sizeof(float), nullptr, GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(2); glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, 36, (void*)0);  glVertexAttribDivisor(2, 1);
    glEnableVertexAttribArray(3); glVertexAttribPointer(3, 1, GL_FLOAT, GL_FALSE, 36, (void*)12); glVertexAttribDivisor(3, 1);
    glEnableVertexAttribArray(4); glVertexAttribPointer(4, 1, GL_FLOAT, GL_FALSE, 36, (void*)16); glVertexAttribDivisor(4, 1);
    glEnableVertexAttribArray(5); glVertexAttribPointer(5, 1, GL_FLOAT, GL_FALSE, 36, (void*)20); glVertexAttribDivisor(5, 1);
    glEnableVertexAttribArray(6); glVertexAttribPointer(6, 3, GL_FLOAT, GL_FALSE, 36, (void*)24); glVertexAttribDivisor(6, 1);
    glBindVertexArray(0);
  }

  // Water: instanced subdivided quad (pos2 per-vertex) + per-instance (offset3,scale2,phase).
  {
    const int N = 9; // 9×9 grid verts (JS PlaneGeometry(…,8,8))
    std::vector<float> grid(N * N * 2);
    for (int gz = 0; gz < N; gz++)
      for (int gx = 0; gx < N; gx++) {
        grid[(gz * N + gx) * 2 + 0] = (float)gx / (N - 1) - 0.5f;
        grid[(gz * N + gx) * 2 + 1] = (float)gz / (N - 1) - 0.5f;
      }
    // indexed: N-1 × N-1 quads × 2 tris
    std::vector<unsigned int> widx;
    for (int gz = 0; gz < N - 1; gz++)
      for (int gx = 0; gx < N - 1; gx++) {
        const unsigned int a = (unsigned int)(gz * N + gx), b = a + 1, c = (unsigned int)((gz + 1) * N + gx), d = c + 1;
        widx.insert(widx.end(), {a, c, b, b, c, d});
      }
    glGenVertexArrays(1, &waterVao);
    glGenBuffers(1, &waterVbo);
    glGenBuffers(1, &waterEbo);
    glGenBuffers(1, &waterInst);
    glBindVertexArray(waterVao);
    glBindBuffer(GL_ARRAY_BUFFER, waterVbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(grid.size() * sizeof(float)), grid.data(), GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, (void*)0);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, waterEbo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizeiptr)(widx.size() * sizeof(unsigned int)), widx.data(), GL_STATIC_DRAW);
    // per-instance: aOffset(3) + aScale(2) + aPhase(1) = 6 floats (24B)
    glBindBuffer(GL_ARRAY_BUFFER, waterInst);
    glBufferData(GL_ARRAY_BUFFER, dc::props::kWaterPools * 6 * (GLsizeiptr)sizeof(float), nullptr, GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);  glVertexAttribDivisor(1, 1);
    glEnableVertexAttribArray(2); glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, 24, (void*)12); glVertexAttribDivisor(2, 1);
    glEnableVertexAttribArray(3); glVertexAttribPointer(3, 1, GL_FLOAT, GL_FALSE, 24, (void*)20); glVertexAttribDivisor(3, 1);
    glBindVertexArray(0);
  }

  // Rune glyph atlas: 8 procedural runic strokes (ᚠᚢᚦᚨᚱᚲᛃᛇ), 1/8-width slot each.
  glGenTextures(1, &runeAtlas);
  glBindTexture(GL_TEXTURE_2D, runeAtlas);
  {
    // 8 slots × 32×32 white alpha; build a thin-stroke glyph per slot (rune-ish strokes)
    const int S = 32, slots = 8;
    std::vector<unsigned char> px(S * slots * S * 4, 0);
    auto stamp = [&](int sx, int sy, int r) {
      // stamp a soft disc at (sx,sy) radius r in the 32-wide slot
      for (int dy = -r; dy <= r; dy++) for (int dx = -r; dx <= r; dx++) {
        int x = sx + dx, y = sy + dy;
        if (x < 0 || x >= S * slots || y < 0 || y >= S) continue;
        if (dx * dx + dy * dy <= r * r) {
          unsigned char& a = px[(y * S * slots + x) * 4 + 3];
          if (a < 255) a = 255;
          px[(y * S * slots + x) * 4] = 255;
          px[(y * S * slots + x) * 4 + 1] = 255;
          px[(y * S * slots + x) * 4 + 2] = 255;
        }
      }
    };
    auto line = [&](int slot, int x0, int y0, int x1, int y1, int r) {
      // stamp along a line in slot coords (0..31)
      const int steps = 64;
      for (int i = 0; i <= steps; i++) {
        float t = (float)i / steps;
        int x = (int)std::round(x0 + (x1 - x0) * t);
        int y = (int)std::round(y0 + (y1 - y0) * t);
        stamp(slot * S + x, y, r);
      }
    };
    // 8 distinct angular runic glyphs (2-3 strokes each), 1px radius
    line(0, 8, 2, 8, 30, 1);            // ᚠ-ish: vertical
    line(0, 8, 8, 22, 2, 1);
    line(0, 8, 16, 22, 22, 1);
    line(1, 24, 2, 24, 30, 1);          // ᚢ-ish
    line(1, 24, 8, 10, 14, 1);
    line(1, 24, 22, 10, 28, 1);
    line(2, 10, 4, 10, 28, 1);          // ᚦ-ish
    line(2, 10, 10, 22, 16, 1);
    line(3, 16, 2, 16, 30, 1);          // ᚨ-ish
    line(3, 16, 10, 4, 16, 1);
    line(3, 16, 10, 28, 16, 1);
    line(4, 6, 6, 6, 28, 1);            // ᚱ-ish
    line(4, 6, 10, 20, 4, 1);
    line(4, 6, 18, 20, 24, 1);
    line(5, 22, 4, 10, 16, 1);          // ᚲ-ish
    line(5, 22, 4, 22, 28, 1);
    line(6, 6, 6, 20, 16, 1);           // ᛃ-ish
    line(6, 6, 26, 20, 16, 1);
    line(6, 20, 16, 20, 28, 1);
    line(7, 8, 4, 8, 28, 1);            // ᛇ-ish
    line(7, 24, 4, 24, 28, 1);
    line(7, 8, 16, 24, 16, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, S * slots, S, 0, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  }
  glBindTexture(GL_TEXTURE_2D, 0);

  // ---- pixel font + screen-space text (title / death screens) ----
  if (fontPath) bakeFont(fontPath);
  progText = linkProgram(compileShader(GL_VERTEX_SHADER, kTextVert),
                         compileShader(GL_FRAGMENT_SHADER, kTextFrag));
  progOverlay = linkProgram(compileShader(GL_VERTEX_SHADER, kFullscreenVert),
                            compileShader(GL_FRAGMENT_SHADER, kOverlayFrag));
  progRect = linkProgram(compileShader(GL_VERTEX_SHADER, kTextVert),
                         compileShader(GL_FRAGMENT_SHADER, kRectFrag));
  // ---- save + leaderboard (JS localStorage → JSON files, §23) ----
  leaderboard = std::make_unique<dc::Leaderboard>(ledgerPath);
  if (font.ok) {
    glGenVertexArrays(1, &textVao);
    glGenBuffers(1, &textVbo);
    glBindVertexArray(textVao);
    glBindBuffer(GL_ARRAY_BUFFER, textVbo);
    glBufferData(GL_ARRAY_BUFFER, 4096, nullptr, GL_DYNAMIC_DRAW);
    // 8 floats/vertex: pos2 | uv2 | color4
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 32, (void*)0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 32, (void*)8);
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, 32, (void*)16);
    glBindVertexArray(0);

    // solid-rect VAO (same vertex layout as text; fragment ignores the font)
    glGenVertexArrays(1, &rectVao);
    glGenBuffers(1, &rectVbo);
    glBindVertexArray(rectVao);
    glBindBuffer(GL_ARRAY_BUFFER, rectVbo);
    glBufferData(GL_ARRAY_BUFFER, 4096, nullptr, GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 32, (void*)0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 32, (void*)8);
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, 32, (void*)16);
    glBindVertexArray(0);
  }

  return true;
}

void App::drawGroup(GLuint instVbo, int count, float emissive) {
  if (count <= 0 || instVbo == 0) return;
  glUseProgram(progScene);
  glUniform1f(glGetUniformLocation(progScene, "uEmissive"), emissive);
  glBindVertexArray(vao);
  glBindBuffer(GL_ARRAY_BUFFER, instVbo);
  glEnableVertexAttribArray(2);
  glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, 36, (void*)0);   // offset
  glVertexAttribDivisor(2, 1);
  glEnableVertexAttribArray(3);
  glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, 36, (void*)12);  // scale
  glVertexAttribDivisor(3, 1);
  glEnableVertexAttribArray(4);
  glVertexAttribPointer(4, 3, GL_FLOAT, GL_FALSE, 36, (void*)24);  // color
  glVertexAttribDivisor(4, 1);
  glDrawElementsInstanced(GL_TRIANGLES, vertCount, GL_UNSIGNED_INT, nullptr, count);
  glBindVertexArray(0);
}

void App::toast(const std::string& text) {
  toasts.push_back(Toast{text, 3.3}); // JS _message: 3.3 s life
  while (toasts.size() > 4) toasts.erase(toasts.begin()); // JS keeps max 4
}

void App::update(double dt, double rawDt) {
  // ---- adaptive performance: rolling fps + 30 fps floor + degraded mode ----
  trackFps(rawDt);
  // ---- HUD toasts tick in real time (JS setTimeout 3.3 s) — all screens ----
  for (auto& t : toasts) t.ttl -= rawDt;
  while (!toasts.empty() && toasts.front().ttl <= 0) toasts.erase(toasts.begin());
  // ---- title / death bookends (sim frozen, screen keys only) ----
  if (screen == Screen::Title) {
    if (keyN && !prevN) startRun(seed);
    prevN = keyN; prevY = keyY;
    return;
  }
  if (screen == Screen::Dead) {
    if (keyN && !prevN) startRun((int)(rng.next() * 2147483647));
    else if (keyY && !prevY) { state.ngPlus += 1; startRun((int)(rng.next() * 2147483647)); }
    prevN = keyN; prevY = keyY;
    return;
  }
  prevN = keyN; prevY = keyY;

  // hit-stop: freeze the whole sim (movement + entities + combat) for kHitStop
  if (hitStop > 0) { hitStop -= rawDt; mouseDX = mouseDY = 0; return; }
  const float sens = (float)player::kSensitivity;
  // ---- look (pointer-locked) ----
  if (pointerLocked) {
    state.player.yaw -= mouseDX * sens;
    state.player.pitch -= mouseDY * sens;
    const double cl = player::kPitchClamp;
    state.player.pitch = std::max(-cl, std::min(cl, state.player.pitch));
  }
  mouseDX = mouseDY = 0;

  // ---- movement (sub-stepped, anti-tunneling) ----
  const float yaw = state.player.yaw;
  const float fwdX = -std::sin(yaw), fwdZ = -std::cos(yaw);
  const float rightX = std::cos(yaw), rightZ = -std::sin(yaw);
  float mx = 0, mz = 0;
  if (keyW) { mx += fwdX; mz += fwdZ; }
  if (keyS) { mx -= fwdX; mz -= fwdZ; }
  if (keyA) { mx -= rightX; mz -= rightZ; }
  if (keyD) { mx += rightX; mz += rightZ; }
  const bool moving = (mx != 0 || mz != 0) && state.safeSpawn <= 0;
  const bool sprintHeld = keyShift;
  const bool sprinting = sprintHeld && moving;
  // JS: updateSprint(rawDt, sprintHeld, moving && sprintHeld, safeSpawn>0)
  state.updateSprint(rawDt, sprintHeld, moving && sprintHeld, state.safeSpawn > 0);
  const double sprintMult = state.sprintSpeedMult();
  if (moving) {
    dc::Mover pos{camX, camZ};
    dc::movePlayer(pos, mx, mz, sprinting, sprintMult, state.buffEffect, dt, world.collision.boxes);
    camX = pos.x; camZ = pos.z;
  }
  camY = kEyeHeight;
  state.player.x = camX;
  state.player.z = camZ;

  // ---- entities: boss (state machine) + skeleton chasers ----
  updateEntities(dt);

  // ---- combat: sword combo (RMB) + orb weapon (LMB) + projectiles ----
  updateCombat(dt);

  // ---- §13 decorative systems: smoke puffs on breakable breaks + motion ----
  // The breakable vector is stable within a level (only `alive` flips), so a
  // true→false transition = a break this frame (step/cone/orb-blast all land
  // before this point). JS: smoke.puff(x, 0.6, z) in _breakProp.
  if (prevBreakableAlive.size() == drops.breakables().size()) {
    for (size_t i = 0; i < drops.breakables().size(); i++) {
      const auto& br = drops.breakables()[i];
      if (prevBreakableAlive[i] && !br.alive)
        smokePuff((float)br.pos.x, 0.6f, (float)br.pos.z);
      prevBreakableAlive[i] = br.alive;
    }
  } else {
    prevBreakableAlive.assign(drops.breakables().size(), true);
  }
  updateDecor(dt);

  // ---- FOV kick while sprinting ----
  const float targetFov = (float)(camera::kFov + (sprinting ? camera::kSprintFovKick : 0));
  if (std::abs(fov - targetFov) > 0.1f) fov += (targetFov - fov) * 0.15f;

  // ---- timers ----
  state.levelTime += dt;
  state.runTime += dt;
  if (state.safeSpawn > 0) state.safeSpawn -= rawDt;

  // ---- exit portal: in the exit room + portal open + E → descend ----
  _checkExitRoom();
}

void App::trackFps(double dt) {
  if (dt <= 0) return;
  fpsWindow.push_back(1.0 / std::max(dt, 1e-4));
  if (fpsWindow.size() > 90) fpsWindow.erase(fpsWindow.begin()); // ~3 s at 30 fps
  const double a = avgFps();
  curFps = a;
  if (a < 30.0) {
    lowFpsTimer += dt;
    if (lowFpsTimer > 6.0 && !degraded) degraded = true; // sustained low fps → shed bloom
  } else {
    // JS _trackFps: degraded is STICKY (spec §22 rule 4 — "once triggered, the run
    // STAYS degraded"). Recovery only hides the warning label; it never re-enables
    // the shed cost (bloom here). lowFpsTimer just decays so a fresh <30 s window
    // is re-measured, but `degraded` itself is never reset mid-run.
    lowFpsTimer = std::max(0.0, lowFpsTimer - dt);
  }
}

void App::frame() {
  const float aspect = (float)width / (float)height;
  const float eye[3] = { (float)camX, (float)camY, (float)camZ };
  const float yaw = state.player.yaw, pitch = state.player.pitch;
  const float at[3] = {
      eye[0] + (-std::sin(yaw) * std::cos(pitch)),
      eye[1] + (-std::sin(pitch)),
      eye[2] + (-std::cos(yaw) * std::cos(pitch)),
  };
  const float up[3] = {0, 1, 0};
  Mat4 view = Mat4::lookAt(eye, at, up);
  Mat4 proj = Mat4::perspective(fov, aspect, (float)camera::kNear, (float)camera::kFar);
  Mat4 viewProj = proj * view; // GL order: project *after* view

  // torch shadow VP (single 256² pass, static)
  Mat4 torchView = Mat4::lookAt(torchPos, at, up);
  Mat4 torchProj = Mat4::perspective(90.0f, 1.0f, 0.2f, 80.0f);
  Mat4 torchVP = torchProj * torchView;

  // ---- dynamic entities (boss + skeletons) → streamed VBO, drawn in both passes ----
  {
    std::vector<float> dyn;
    std::vector<float> enem;
    uploadDynamic(dyn, enem);
    dynCount = (int)(dyn.size() / 9);
    if (dynCount > 0) {
      glBindBuffer(GL_ARRAY_BUFFER, dynVbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(dyn.size() * sizeof(float)), dyn.data());
      glBindBuffer(GL_ARRAY_BUFFER, 0);
    }
    enemCount = (int)(enem.size() / 9);
    if (enemCount > 0) {
      glBindBuffer(GL_ARRAY_BUFFER, enemVbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(enem.size() * sizeof(float)), enem.data());
      glBindBuffer(GL_ARRAY_BUFFER, 0);
    }
  }

  // ---- 1) shadow pass ----
  glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo);
  glViewport(0, 0, kShadowSize, kShadowSize);
  glClear(GL_DEPTH_BUFFER_BIT);
  glUseProgram(progScene);
  glUniformMatrix4fv(glGetUniformLocation(progScene, "uViewProj"), 1, GL_FALSE, torchVP.m);
  glUniformMatrix4fv(glGetUniformLocation(progScene, "uTorchVP"), 1, GL_FALSE, torchVP.m);
  drawGroup(world.instWallH, world.nWallH);
  drawGroup(world.instWallE, world.nWallE);
  drawGroup(world.instFloor, world.nFloor);
  drawGroup(world.instCeil, world.nCeil);
  drawGroup(dynVbo, dynCount); // boss/skeletons cast the torch shadow

  // ---- 2) scene pass ----
  glBindFramebuffer(GL_FRAMEBUFFER, sceneFbo);
  glViewport(0, 0, width, height);
  glClearColor(0.02, 0.02, 0.03, 1.0);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glEnable(GL_DEPTH_TEST);
  glUseProgram(progScene);
  glUniformMatrix4fv(glGetUniformLocation(progScene, "uViewProj"), 1, GL_FALSE, viewProj.m);
  glUniformMatrix4fv(glGetUniformLocation(progScene, "uTorchVP"), 1, GL_FALSE, torchVP.m);
  glUniform3f(glGetUniformLocation(progScene, "uTorchPos"), torchPos[0], torchPos[1], torchPos[2]);
  glUniform3f(glGetUniformLocation(progScene, "uTorchColor"), torchColor[0], torchColor[1], torchColor[2]);
  glUniform1f(glGetUniformLocation(progScene, "uTorchIntensity"), torchIntensity);
  glUniform1f(glGetUniformLocation(progScene, "uTorchDist"), 16.0f);
  glUniform3f(glGetUniformLocation(progScene, "uHeadPos"), eye[0], eye[1], eye[2]);
  glUniform3f(glGetUniformLocation(progScene, "uHeadColor"), 0.9f, 0.9f, 0.85f);
  glUniform1f(glGetUniformLocation(progScene, "uHeadIntensity"), 1.0f);
  glUniform1f(glGetUniformLocation(progScene, "uHeadDist"), 30.0f);
  glUniform3f(glGetUniformLocation(progScene, "uAmbient"),
              ambientCol[0] * (state.buffEffect == 1 ? 2.0f : 1.0f), // BRIGHT: ambient ×2 (§11 effect 1)
              ambientCol[1] * (state.buffEffect == 1 ? 2.0f : 1.0f),
              ambientCol[2] * (state.buffEffect == 1 ? 2.0f : 1.0f));
  glUniform3f(glGetUniformLocation(progScene, "uFogColor"), fogColor[0], fogColor[1], fogColor[2]);
  glUniform1f(glGetUniformLocation(progScene, "uFogDensity"), fogDensity);
  glUniform3f(glGetUniformLocation(progScene, "uEyePos"), eye[0], eye[1], eye[2]);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, shadowTex);
  drawGroup(world.instWallH, world.nWallH);
  drawGroup(world.instWallE, world.nWallE);
  drawGroup(world.instFloor, world.nFloor);
  drawGroup(world.instCeil, world.nCeil);
  // floor debris (cosmetic pebbles, no shadow) — degraded mode sheds the tail
  // instances: draw count halved (spec §22 rule 1, JS WorldBuilder.setDegraded).
  const int debrisDraw = degraded ? (world.nDebris / 2) : world.nDebris;
  drawGroup(world.instDebris, debrisDraw);

  // ---- §13 decorative passes (JS SmokeSystem / ParticleSystem / RuneSystem
  //      + water puddles): transparent, depth-tested, no depth write. Degraded
  //      mode sheds the tail: draw count halved (spec §22 rule 1). ----
  glDepthMask(GL_FALSE);
  {
    const float tDec = (float)state.runTime;
    // (a) water: VAULT-room puddles (0x3a6a8a, opacity 0.75, sine wave).
    if (!waterData.empty()) {
      int wn = (int)(waterData.size() / 6);
      if (degraded) wn /= 2;
      if (wn > 0) {
        glBindBuffer(GL_ARRAY_BUFFER, waterInst);
        glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(wn * 6 * sizeof(float)), waterData.data());
        glUseProgram(progWater);
        glUniformMatrix4fv(glGetUniformLocation(progWater, "uViewProj"), 1, GL_FALSE, viewProj.m);
        glUniform1f(glGetUniformLocation(progWater, "uTime"), tDec);
        glUniform3f(glGetUniformLocation(progWater, "uEyePos"), eye[0], eye[1], eye[2]);
        glBindVertexArray(waterVao);
        glDrawElementsInstanced(GL_TRIANGLES, 384, GL_UNSIGNED_INT, nullptr, wn); // 8×8 grid ×2 tris
        glBindVertexArray(0);
      }
    }
    // (b) ambient dust: 30 motes, additive (JS opacity 0.45).
    {
      int dn = degraded ? (dc::kAmbientDustParticles / 2) : dc::kAmbientDustParticles;
      glBindBuffer(GL_ARRAY_BUFFER, dustVbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(dn * 3 * sizeof(float)), dust.data());
      glUseProgram(progDust);
      glUniformMatrix4fv(glGetUniformLocation(progDust, "uViewProj"), 1, GL_FALSE, viewProj.m);
      // JS PointsMaterial size 0.045: px = 0.045 * (height/2) / -mv.z
      glUniform1f(glGetUniformLocation(progDust, "uSizePx"), 0.045f * (float)height * 0.5f);
      glUniform3f(glGetUniformLocation(progDust, "uColor"), 0.784f, 0.722f, 0.533f); // 0xc8b888
      glUniform1f(glGetUniformLocation(progDust, "uOpacity"), 0.45f);
      glBlendFunc(GL_SRC_ALPHA, GL_ONE); // additive (JS blending: AdditiveBlending)
      glBindVertexArray(dustVao);
      glDrawArrays(GL_POINTS, 0, dn);
      glBindVertexArray(0);
    }
    // (c) wall runes: <=10 quads, per-biome color, pulsing opacity.
    if (!runeData.empty()) {
      int rn = (int)(runeData.size() / 9);
      if (degraded) rn /= 2;
      if (rn > 0) {
        glBindBuffer(GL_ARRAY_BUFFER, runeInst);
        glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(rn * 9 * sizeof(float)), runeData.data());
        glUseProgram(progRune);
        glUniformMatrix4fv(glGetUniformLocation(progRune, "uViewProj"), 1, GL_FALSE, viewProj.m);
        glUniform1f(glGetUniformLocation(progRune, "uTime"), tDec);
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, runeAtlas);
        glBindVertexArray(runeVao);
        glDrawElementsInstanced(GL_TRIANGLES, 6, GL_UNSIGNED_INT, nullptr, rn);
        glBindVertexArray(0);
        glBindTexture(GL_TEXTURE_2D, 0);
      }
    }
    // (d) smoke: 9 pooled puffs (breakable breaks), 0.8 s rise+fade.
    {
      int sn = degraded ? (dc::kSmokeParticles / 2) : dc::kSmokeParticles;
      std::vector<float> sp(dc::kSmokeParticles * 4);
      for (int i = 0; i < dc::kSmokeParticles; i++) {
        sp[i * 4 + 0] = smoke[i].x; sp[i * 4 + 1] = smoke[i].y;
        sp[i * 4 + 2] = smoke[i].z; sp[i * 4 + 3] = smoke[i].active ? smoke[i].alpha : 0.0f;
      }
      glBindBuffer(GL_ARRAY_BUFFER, smokeVbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(sn * 4 * sizeof(float)), sp.data());
      glUseProgram(progSmoke);
      glUniformMatrix4fv(glGetUniformLocation(progSmoke, "uViewProj"), 1, GL_FALSE, viewProj.m);
      glUniformMatrix4fv(glGetUniformLocation(progSmoke, "uView"), 1, GL_FALSE, view.m);
      glUniform3f(glGetUniformLocation(progSmoke, "uColor"), 0.2f, 0.2f, 0.251f); // 0x333340
      glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); // JS: transparent (normal blend)
      glBindVertexArray(smokeVao);
      glDrawArrays(GL_POINTS, 0, sn);
      glBindVertexArray(0);
    }
  }
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glDepthMask(GL_TRUE);

  drawGroup(dynVbo, dynCount, 1.0f); // boss/skeletons: unlit emissive spectral figures

  // ---- 2.5) §12.2 enemy-glow: flat red-orange enemy mask → half-res → blur H/V ----
  // JS PostProcessing: clone camera on layer 1, overrideMaterial 0xff4422, half-res RT,
  // separable 5-tap gaussian. Depth disabled (depthBuffer:false) → flat silhouettes.
  const bool anyEnemyGlow = enemCount > 0;
  double nearestEnemyDist = 1e18;
  if (anyEnemyGlow) {
    const double px = state.player.x, pz = state.player.z;
    for (const auto& e : skelsys.enemies()) {
      if (e.state == dc::EnemyState::kDead) continue;
      const double d = std::hypot(e.pos.x - px, e.pos.z - pz);
      if (d < nearestEnemyDist) nearestEnemyDist = d;
    }
  }
  double glowIntensity = 0.0;
  if (anyEnemyGlow && !degraded) {
    const float fade = std::min(1.0f, std::max(0.15f, (float)((nearestEnemyDist - 1.2) / 4.5)));
    glowIntensity = 0.05f * fade; // §12.2 min(1, 1*0.05) * fade
    // flat enemy mask → half-res sharp RT (no depth: flat silhouettes)
    glDisable(GL_DEPTH_TEST);
    glBindFramebuffer(GL_FRAMEBUFFER, glowSharpFbo);
    glViewport(0, 0, glowW, glowH);
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    glUseProgram(progMask);
    glUniformMatrix4fv(glGetUniformLocation(progMask, "uViewProj"), 1, GL_FALSE, viewProj.m);
    glBindVertexArray(vao);
    glBindBuffer(GL_ARRAY_BUFFER, enemVbo);
    { void* z = nullptr;
      glEnableVertexAttribArray(2); glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, 36, z); glVertexAttribDivisor(2, 1);
      glEnableVertexAttribArray(3); glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, 36, (void*)12); glVertexAttribDivisor(3, 1);
      glEnableVertexAttribArray(4); glVertexAttribPointer(4, 3, GL_FLOAT, GL_FALSE, 36, (void*)24); glVertexAttribDivisor(4, 1); }
    glDrawElementsInstanced(GL_TRIANGLES, vertCount, GL_UNSIGNED_INT, nullptr, enemCount);
    glBindVertexArray(0);
    // separable gaussian: sharp → H(ping) → V(pong)
    glUseProgram(progEnemyBlur);
    glBindFramebuffer(GL_FRAMEBUFFER, glowBlurAFbo);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, glowSharpTex);
    glUniform2f(glGetUniformLocation(progEnemyBlur, "uDir"), 1.0f / glowW, 0.0f);
    glUniform1i(glGetUniformLocation(progEnemyBlur, "uTex"), 0);
    glBindVertexArray(quadVao);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    glBindVertexArray(0);
    glBindFramebuffer(GL_FRAMEBUFFER, glowBlurBFbo);
    glBindTexture(GL_TEXTURE_2D, glowBlurATex);
    glUniform2f(glGetUniformLocation(progEnemyBlur, "uDir"), 0.0f, 1.0f / glowH);
    glBindVertexArray(quadVao);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    glBindVertexArray(0);
  }
  const double glowPulse = 0.75 + 0.25 * std::sin(state.runTime * 3.0); // 0.003/ms = 3.0/s

  // ---- 3) bloom (skipped in degraded mode — the single biggest GPU cost) ----
  glDisable(GL_DEPTH_TEST);
  if (!degraded) {
  glBindFramebuffer(GL_FRAMEBUFFER, brightFboA);
  glViewport(0, 0, width, height);
  glClear(GL_COLOR_BUFFER_BIT);
  glUseProgram(progBright);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, sceneTex);
  glUniform1i(glGetUniformLocation(progBright, "uScene"), 0);
  glUniform1f(glGetUniformLocation(progBright, "uThreshold"), 0.5f);
  glBindVertexArray(quadVao);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glBindVertexArray(0);
  glUseProgram(progBlur);
  glBindFramebuffer(GL_FRAMEBUFFER, brightFboB);
  glBindTexture(GL_TEXTURE_2D, brightTexA);
  glUniform2f(glGetUniformLocation(progBlur, "uDir"), 1.0f / width, 0.0f);
  glUniform1i(glGetUniformLocation(progBlur, "uTex"), 0);
  glBindVertexArray(quadVao);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glBindVertexArray(0);
  glBindFramebuffer(GL_FRAMEBUFFER, brightFboA);
  glBindTexture(GL_TEXTURE_2D, brightTexB);
  glUniform2f(glGetUniformLocation(progBlur, "uDir"), 0.0f, 1.0f / height);
  glBindVertexArray(quadVao);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glBindVertexArray(0);
  } // end bloom (!degraded)
  // composite to default framebuffer
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glViewport(0, 0, width, height);
  glUseProgram(progComposite);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, sceneTex);
  glUniform1i(glGetUniformLocation(progComposite, "uScene"), 0);
  glActiveTexture(GL_TEXTURE1);
  glBindTexture(GL_TEXTURE_2D, brightTexA);
  glUniform1i(glGetUniformLocation(progComposite, "uBloom"), 1);
  glUniform1f(glGetUniformLocation(progComposite, "uStrength"), degraded ? 0.0f : 0.35f);
  // §12.2 enemy-glow additive (intensity 0 when no enemies / degraded)
  glActiveTexture(GL_TEXTURE2);
  glBindTexture(GL_TEXTURE_2D, glowSharpTex);
  glUniform1i(glGetUniformLocation(progComposite, "uGlowSharp"), 2);
  glActiveTexture(GL_TEXTURE3);
  glBindTexture(GL_TEXTURE_2D, glowBlurBTex);
  glUniform1i(glGetUniformLocation(progComposite, "uGlowBlur"), 3);
  glUniform1f(glGetUniformLocation(progComposite, "uGlowIntensity"), (float)glowIntensity);
  glUniform1f(glGetUniformLocation(progComposite, "uGlowPulse"), (float)glowPulse);
  glBindVertexArray(quadVao);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glBindVertexArray(0);

  // ---- 4) title / death text overlay (screen-space, blended) ----
  if (screen == Screen::Title || screen == Screen::Dead) {
    // dim / tint the scene behind the bookend text (Dark Souls "YOU DIED" red)
    if (screen == Screen::Dead) drawOverlay(0.10f, 0.02f, 0.02f, 0.72f);
    else drawOverlay(0.01f, 0.01f, 0.03f, 0.55f);
    std::vector<float> v;
    const float gold[3] = {0.91f, 0.78f, 0.35f};
    const float sub[3] = {0.60f, 0.54f, 0.38f};
    const float hint[3] = {0.55f, 0.55f, 0.55f};
    const float red[3] = {0.69f, 0.19f, 0.19f};
    const float stat[3] = {0.85f, 0.79f, 0.63f};
    const float cx = width / 2.0f, cy = height * 0.30f;
    if (screen == Screen::Title) {
      const char* t = "THE DEPTHS";
      drawTextLine(v, cx - lineW(t, 3.0f) / 2, cy, 3.0f, gold, t);
      const char* s = "A SOULS DESCENT";
      drawTextLine(v, cx - lineW(s, 0.9f) / 2, cy + 110, 0.9f, sub, s);
      const char* n = "New Game  [N]";
      drawTextLine(v, cx - lineW(n, 1.2f) / 2, cy + 200, 1.2f, hint, n);
    } else {
      const char* t = "The dead claim you";
      drawTextLine(v, cx - lineW(t, 2.4f) / 2, cy, 2.4f, red, t);
      char buf[160];
      std::snprintf(buf, sizeof(buf), "Level %d   Souls %d   Time %ds",
                    state.level, state.collectedOrbs, (int)state.runTime);
      drawTextLine(v, cx - lineW(buf, 1.0f) / 2, cy + 90, 1.0f, stat, buf);
      const char* n = "[N] Restart   [Y] New Game+";
      drawTextLine(v, cx - lineW(n, 1.2f) / 2, cy + 180, 1.2f, hint, n);
    }
    drawText(v);
  }

  // ---- 5) in-game HUD (hearts / souls / timer / weapon slot / boss bar) ----
  drawHud();
}

void App::savePPM(const char* path) {
  std::vector<unsigned char> px((size_t)width * height * 3);
  glReadPixels(0, 0, width, height, GL_RGB, GL_UNSIGNED_BYTE, px.data());
  FILE* f = fopen(path, "wb");
  if (!f) {
    std::fprintf(stderr, "[dc_app] cannot write %s\n", path);
    return;
  }
  std::fprintf(f, "P6\n%d %d\n255\n", width, height);
  for (int y = height - 1; y >= 0; y--)
    fwrite(px.data() + (size_t)y * width * 3, 1, (size_t)width * 3, f);
  fclose(f);
  std::fprintf(stderr, "[dc_app] saved %s (%dx%d)\n", path, width, height);
}

void App::bakeFont(const char* path) {
  FILE* f = fopen(path, "rb");
  if (!f) { std::fprintf(stderr, "[dc_app] font: cannot open %s\n", path); return; }
  fseek(f, 0, SEEK_END); long fsz = ftell(f); fseek(f, 0, SEEK_SET);
  std::vector<unsigned char> buf((size_t)fsz);
  fread(buf.data(), 1, (size_t)fsz, f);
  fclose(f);
  stbtt_fontinfo fi;
  stbtt_InitFont(&fi, buf.data(), stbtt_GetFontOffsetForIndex(buf.data(), 0));
  const int P = 24, AW = 512, AH = 256;
  std::vector<unsigned char> atlas((size_t)AW * AH * 4, 0);
  int x = 2, y = 2, rowH = 0;
  const float scale = stbtt_ScaleForPixelHeight(&fi, P);
  for (int c = 32; c < 128; c++) {
    int x0, y0, x1, y1;
    stbtt_GetCodepointBitmapBox(&fi, c, scale, scale, &x0, &y0, &x1, &y1);
    int w = x1 - x0, h = y1 - y0;
    int advW = 0, lsb = 0;
    stbtt_GetCodepointHMetrics(&fi, c, &advW, &lsb);
    font.adv[c] = advW * scale;
    if (w <= 0 || h <= 0) { font.w[c] = 0; continue; }
    if (x + w >= AW - 2) { x = 2; y += rowH + 2; rowH = 0; }
    std::vector<unsigned char> bmp((size_t)w * h, 0);
    stbtt_MakeCodepointBitmap(&fi, bmp.data(), w, h, w, scale, scale, c);
    for (int j = 0; j < h; j++)
      for (int i = 0; i < w; i++) {
        unsigned char a = bmp[(size_t)j * w + i];
        unsigned char* d = &atlas[((size_t)(y + j) * AW + (x + i)) * 4];
        d[3] = a; // alpha
      }
    font.uv[c][0] = x / (float)AW;      font.uv[c][1] = y / (float)AH;
    font.uv[c][2] = (x + w) / (float)AW; font.uv[c][3] = (y + h) / (float)AH;
    font.w[c] = w; font.h[c] = h;
    x += w + 1; rowH = std::max(rowH, h);
  }
  glGenTextures(1, &font.tex);
  glBindTexture(GL_TEXTURE_2D, font.tex);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, AW, AH, 0, GL_RGBA, GL_UNSIGNED_BYTE, atlas.data());
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  font.ok = true;
  std::fprintf(stderr, "[dc_app] font baked %s (%dpx)\n", path, P);
}

float App::lineW(const char* s, float size) {
  float w = 0;
  for (const char* p = s; *p; p++) {
    int c = (unsigned char)*p;
    if (c < 32 || c >= 128) continue;
    w += font.adv[c] * size;
  }
  return w;
}

void App::drawTextLine(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s) {
  for (const char* p = s; *p; p++) {
    int c = (unsigned char)*p;
    if (c < 32 || c >= 128) continue;
    float gw = (float)font.w[c] * size, gh = (float)font.h[c] * size;
    float u0 = font.uv[c][0], v0 = font.uv[c][1], u1 = font.uv[c][2], v1 = font.uv[c][3];
    float x1 = x + gw, y1 = y + gh;
    auto P = [&](float px, float py, float u, float vv) {
      v.insert(v.end(), {px, py, u, vv, col[0], col[1], col[2], 1.0f});
    };
    P(x, y, u0, v0); P(x1, y, u1, v0); P(x1, y1, u1, v1); // tri 1
    P(x, y, u0, v0); P(x1, y1, u1, v1); P(x, y1, u0, v1); // tri 2
    x += font.adv[c] * size;
  }
}

void App::drawText(const std::vector<float>& v) {
  if (v.empty() || !font.ok) return;
  glUseProgram(progText);
  glUniform2f(glGetUniformLocation(progText, "uRes"), (float)width, (float)height);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, font.tex);
  glBindBuffer(GL_ARRAY_BUFFER, textVbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * 4), v.data(), GL_DYNAMIC_DRAW);
  glBindVertexArray(textVao);
  glEnable(GL_BLEND);
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glDepthMask(false);
  glDrawArrays(GL_TRIANGLES, 0, (GLsizei)(v.size() / 8));
  glDepthMask(true);
  glDisable(GL_BLEND);
  glBindVertexArray(0);
}

void App::drawOverlay(float r, float g, float b, float a) {
  if (a <= 0) return;
  glUseProgram(progOverlay);
  glUniform4f(glGetUniformLocation(progOverlay, "uTint"), r, g, b, a);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, 0);
  glBindVertexArray(quadVao);
  glDisable(GL_DEPTH_TEST);
  glEnable(GL_BLEND);
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glDisable(GL_BLEND);
  glEnable(GL_DEPTH_TEST);
  glBindVertexArray(0);
}

void App::drawRects(const std::vector<float>& v) {
  if (v.empty() || !font.ok) return;
  glUseProgram(progRect);
  glUniform2f(glGetUniformLocation(progRect, "uRes"), (float)width, (float)height);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, 0);
  glBindBuffer(GL_ARRAY_BUFFER, rectVbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * 4), v.data(), GL_DYNAMIC_DRAW);
  glBindVertexArray(rectVao);
  glEnable(GL_BLEND);
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glDepthMask(false);
  glDrawArrays(GL_TRIANGLES, 0, (GLsizei)(v.size() / 8));
  glDepthMask(true);
  glDisable(GL_BLEND);
  glBindVertexArray(0);
}

void App::drawHud() {
  if (screen != Screen::Play || !font.ok) return;
  const float W = (float)width, H = (float)height, m = 14.0f;

  // ---- colors (JS index.html palette) ----
  const float label[3] = {0.69f, 0.60f, 0.38f};   // #b09a62
  const float panel[4] = {0.08f, 0.055f, 0.03f, 0.55f};
  const float hpBg[4] = {0.10f, 0.05f, 0.05f, 1.0f};  // #1a0c0c
  const float hpFill[4] = {0.69f, 0.19f, 0.19f, 1.0f}; // #b03030
  const float hpNum[3] = {0.85f, 0.79f, 0.63f};    // #d8c9a0
  const float souls[3] = {0.91f, 0.78f, 0.35f};    // #e8c85a
  const float weapon[3] = {0.85f, 0.79f, 0.63f};   // #d8c9a0
  const float biome[3] = {0.80f, 0.72f, 0.48f};    // #cdb87a
  const float timerC[3] = {0.91f, 0.86f, 0.75f};   // #e8dcc0
  const float timerLow[3] = {0.85f, 0.29f, 0.21f}; // #d84a35
  const float bossLbl[3] = {0.85f, 0.69f, 0.42f};  // #d8b06a
  const float bossBg[4] = {0.08f, 0.04f, 0.04f, 1.0f}; // #140a0a
  const float bossFill[4] = {0.75f, 0.28f, 0.22f, 1.0f}; // #c04838

  std::vector<float> v; // 8 floats/vertex: pos2 | uv2 | color4
  auto P = [&](float x, float y, float r, float g, float b, float a) {
    v.insert(v.end(), {x, y, 0, 0, r, g, b, a});
  };
  // solid screen-space rect (y-down), 6 verts
  auto rect = [&](float x, float y, float w, float h, float r, float g, float b, float a) {
    if (w <= 0 || h <= 0) return;
    float x1 = x + w, y1 = y + h;
    P(x, y, r, g, b, a); P(x1, y, r, g, b, a); P(x1, y1, r, g, b, a);
    P(x, y, r, g, b, a); P(x1, y1, r, g, b, a); P(x, y1, r, g, b, a);
  };
  std::vector<float> t; // text verts

  // diamond (rotated square) — 4 triangles, centered at (cx,cy), half-diagonal d
  auto diamond = [&](float cx, float cy, float d, float r, float g, float b, float a) {
    P(cx, cy - d, r, g, b, a); P(cx - d, cy, r, g, b, a); P(cx, cy, r, g, b, a);
    P(cx, cy + d, r, g, b, a); P(cx + d, cy, r, g, b, a); P(cx, cy, r, g, b, a);
    P(cx, cy - d, r, g, b, a); P(cx, cy, r, g, b, a); P(cx + d, cy, r, g, b, a);
    P(cx - d, cy, r, g, b, a); P(cx, cy, r, g, b, a); P(cx, cy - d, r, g, b, a);
  };
  // vertical gradient band (4-vertex per-vertex alpha): a0 at top → a1 at bottom
  auto vgrad = [&](float x, float y, float w, float h, float r, float g, float b, float a0, float a1) {
    if (w <= 0 || h <= 0) return;
    float x1 = x + w, y1 = y + h;
    P(x, y, r, g, b, a0); P(x1, y, r, g, b, a0); P(x1, y1, r, g, b, a1);
    P(x, y, r, g, b, a0); P(x1, y1, r, g, b, a1); P(x, y1, r, g, b, a1);
  };
  // horizontal gradient band (per-vertex alpha): a0 at left → a1 at right
  auto hgrad = [&](float x, float y, float w, float h, float r, float g, float b, float a0, float a1) {
    if (w <= 0 || h <= 0) return;
    float x1 = x + w, y1 = y + h;
    P(x, y, r, g, b, a0); P(x1, y, r, g, b, a1); P(x1, y1, r, g, b, a1);
    P(x, y, r, g, b, a0); P(x1, y1, r, g, b, a1); P(x, y1, r, g, b, a0);
  };

  // ---- DANGER GLOW: 4 screen-edge red gradients, alpha = min(1, Σ(1/d)/2) ----
  // living enemies within 40 m, sector-relative to view yaw (JS _updateHUD)
  {
    const float px = camX, pz = camZ;
    const float yaw = state.player.yaw;
    double sTop = 0, sBottom = 0, sLeft = 0, sRight = 0;
    for (const dc::Enemy& e : skelsys.enemies()) {
      if (e.state == dc::EnemyState::kDead) continue;
      const double dx = e.pos.x - px, dz = e.pos.z - pz;
      const double d = std::hypot(dx, dz);
      if (d > 40 || d < 0.5) continue;
      const double rel = std::atan2(dx, dz) - (yaw + 3.14159265358979323846);
      const double twoPi = 6.2831853071795864769;
      double a = fmod(rel, twoPi);
      if (a < 0) a += twoPi; // 0..2π, 0 = front
      const double contrib = 1.0 / d;
      if (a < 0.7853981633974483 || a > 5.497787143782138) sTop += contrib;
      else if (a < 2.3561944901923449) sRight += contrib;
      else if (a < 3.9269908169872415) sBottom += contrib;
      else sLeft += contrib;
    }
    const float band = 110.0f; // JS .danger-edge thickness
    const float dr = 0.784f, dg = 0.118f, db = 0.078f; // #c81e14
    auto op = [](double s) { return (float)std::min(1.0, s / 2.0); };
    if (sBottom > 0) vgrad(0, H - band, W, band, dr, dg, db, 0, 0.85f * op(sBottom));
    if (sTop > 0) vgrad(0, 0, W, band, dr, dg, db, 0.85f * op(sTop), 0);
    if (sLeft > 0) hgrad(0, 0, band, H, dr, dg, db, 0.85f * op(sLeft), 0);
    if (sRight > 0) hgrad(W - band, 0, band, H, dr, dg, db, 0, 0.85f * op(sRight));
  }

  // ---- top-left: VITALITY (hearts) ----
  {
    float pw = 196.0f;
    rect(m, m, pw, 62, panel[0], panel[1], panel[2], panel[3]);
    drawTextLine(t, m + 10, m + 8, 0.45f, label, "VITALITY");
    const float bw = 178.0f, bh = 12.0f, bx = m + 10, by = m + 26;
    rect(bx, by, bw, bh, hpBg[0], hpBg[1], hpBg[2], hpBg[3]);
    const double frac = std::max(0.0, std::min(1.0, simHealth / std::max(1.0, (double)state.maxHealth)));
    rect(bx, by, (float)(bw * frac), bh, hpFill[0], hpFill[1], hpFill[2], hpFill[3]);
    char num[32];
    std::snprintf(num, sizeof(num), "%d / %d", state.health, state.maxHealth);
    drawTextLine(t, m + 10, by + bh + 5, 0.45f, hpNum, num);
  }

  // ---- top-right: SOULS + weapon slot + buff badge + sprint-bonus ----
  {
    float xR = W - m;
    const float pw = 150.0f;
    // buff badge (#9ecbe0) + sprint-bonus (#8fae7e) hang below the slot
    const bool hasBuff = state.buffEffect > 0;
    const bool hasSprint = state.sprintTier > 0;
    const float ph = 74.0f + (hasBuff ? 16.0f : 0.0f) + (hasSprint ? 14.0f : 0.0f);
    rect(xR - pw, m, pw, ph, panel[0], panel[1], panel[2], panel[3]);
    auto drawRight = [&](float y, float size, const float c[3], const char* s) {
      drawTextLine(t, xR - 12 - lineW(s, size), y, size, c, s);
    };
    drawRight(m + 8, 0.45f, label, "SOULS");
    char cnt[16];
    std::snprintf(cnt, sizeof(cnt), "%d", state.collectedOrbs);
    drawRight(m + 20, 1.1f, souls, cnt);
    char wslot[64];
    const std::string& tn = dc::evolution::kTierNames[state.weaponTier];
    std::snprintf(wslot, sizeof(wslot), "%s — T%d", tn.c_str(), state.weaponTier);
    // separator line under the souls count
    rect(xR - 12, m + 50, pw - 24, 1, 0.29f, 0.25f, 0.16f, 1.0f); // #4a3f28
    drawRight(m + 55, 0.5f, weapon, wslot);
    float yy = m + 76;
    if (hasBuff) {
      // #buff-badge: "<NAME> <ceil(s)>s" in #9ecbe0
      const float buffBadge[3] = {0.62f, 0.80f, 0.88f}; // #9ecbe0
      char bb[40];
      std::snprintf(bb, sizeof(bb), "%s %ds", dc::GameState::kBuffNames[state.buffEffect], (int)std::ceil(state.buffTime));
      drawRight(yy, 0.42f, buffBadge, bb);
      yy += 16;
    }
    if (hasSprint) {
      // #sprint-bonus: acceleration above the base ×1.55 (tier 0 hidden)
      const float sprintC[3] = {0.56f, 0.68f, 0.49f}; // #8fae7e
      char sb[24];
      std::snprintf(sb, sizeof(sb), "SPRINT +%d%%", (int)std::lround((state.sprintSpeedMult() / dc::player::kSprintMult - 1.0) * 100.0));
      drawRight(yy, 0.42f, sprintC, sb);
    }
  }

  // ---- combo pips (bottom-right, above boss bar): 3 diamonds, i < swordStep lit ----
  {
    const float px0 = W - 26.0f, py0 = H - 120.0f; // JS #combo-pips anchor
    for (int i = 2; i >= 0; i--) { // leftmost first (JS flex row order)
      const float cx = px0 - (2 - i) * 16.0f, cy = py0;
      if (i < swordStep) diamond(cx, cy, 7.0f, 0.784f, 0.659f, 0.306f, 1.0f); // #c8a84e
      else diamond(cx, cy, 7.0f, 0.420f, 0.353f, 0.204f, 1.0f);                 // #6b5a34 border
    }
  }

  // ---- right side: COMBAT live-stats panel (JS #side-stats, always on) ----
  {
    const float pw = 172.0f, xR = W - m, y0 = 128.0f;
    char lines[7][48];
    const double scale = dc::totalSwordScale(state.weaponTier, state.buffEffect == 3 ? 1.5 : 1.0);
    const double dmgMult = dc::damageMult(scale, state.weaponTier, state.level);
    std::snprintf(lines[0], sizeof(lines[0]), "DMG \xc3\x97%.2f", dmgMult);
    std::snprintf(lines[1], sizeof(lines[1]), "Orb DMG %.2f", 1.0 + 0.02 * state.collectedOrbs);
    std::snprintf(lines[2], sizeof(lines[2]), "Reach %.1f", 2.2 * scale * (1.0 + 0.04 * state.weaponTier));
    std::snprintf(lines[3], sizeof(lines[3]), "Enemy HP \xc3\x97%.1f", 1.0 + 3.0 * state.ngPlus);
    std::snprintf(lines[4], sizeof(lines[4]), "Mob speed \xc3\x97%.2f",
                   (1.0 + 0.02 * (state.level - 1)) * (1.0 + 0.1 * state.bossKills));
    std::snprintf(lines[5], sizeof(lines[5]), "Spawns \xc3\x97%.2f",
                   std::min(1.0 + (state.level + state.collectedOrbs) / 10.0, 100.0));
    std::snprintf(lines[6], sizeof(lines[6]), "Regen +1/%ds", (int)dc::player::kRegenInterval);
    const float lineH = 14.0f;
    const float ph = 24.0f + 7 * lineH + 6.0f;
    rect(xR - pw, y0, pw, ph, panel[0], panel[1], panel[2], panel[3]);
    drawTextLine(t, xR - pw / 2 - lineW("COMBAT", 0.4f) / 2, y0 + 8, 0.4f, label, "COMBAT");
    const float statC[3] = {0.85f, 0.79f, 0.63f}; // #d8c9a0
    for (int i = 0; i < 7; i++) drawTextLine(t, xR - pw + 12, y0 + 24 + i * lineH, 0.42f, statC, lines[i]);
  }

  // ---- top-center: LEVEL · BIOME + timer ----
  {
    const float cx = W / 2.0f;
    char lvl[64];
    const auto& bd = dc::kBiomes.at(state.biome);
    std::snprintf(lvl, sizeof(lvl), "LEVEL %d · %s", state.level, bd.label.c_str());
    drawTextLine(t, cx - lineW(lvl, 0.55f) / 2, m + 6, 0.55f, biome, lvl);
    const double remain = std::max(0.0, dc::kLevelTimeLimit - state.levelTime);
    const int mm = (int)(remain / 60.0), ss = (int)(remain - 60.0 * mm);
    char tm[24];
    std::snprintf(tm, sizeof(tm), "%d:%02d%s", mm, ss,
                  state.ngPlus > 0 ? " NG+" : "");
    const float* tc = (remain < 30.0) ? timerLow : timerC;
    drawTextLine(t, cx - lineW(tm, 0.85f) / 2, m + 26, 0.85f, tc, tm);
  }

  // ---- bottom-center: boss bar (only when a boss is live) ----
  if (bossReady && !boss.dead) {
    const float cx = W / 2.0f, bw = 420.0f, bh = 10.0f;
    const float by = H - 64.0f;
    const std::string lbl = dc::kBossLabels.count(boss.variant) ? dc::kBossLabels.at(boss.variant) : std::string("BOSS");
    drawTextLine(t, cx - lineW(lbl.c_str(), 0.5f) / 2, by - 20, 0.5f, bossLbl, lbl.c_str());
    rect(cx - bw / 2, by, bw, bh, bossBg[0], bossBg[1], bossBg[2], bossBg[3]);
    const double frac = std::max(0.0, std::min(1.0, boss.hp / std::max(1.0, boss.maxHp)));
    rect(cx - bw / 2, by, (float)(bw * frac), bh, bossFill[0], bossFill[1], bossFill[2], bossFill[3]);
  }

  // degraded-mode perf warning (bottom-right, gold) — mirrors JS #perf-warning.
  // Sticky state (bloom stays off), but the LABEL hides on fps recovery (JS does the same).
  if (degraded && (curFps < 30.0 || forcedDegraded)) {
    const char* w = "DEGRADED MODE — bloom off for performance";
    const float perfWarn[4] = {0.85f, 0.63f, 0.23f, 1.0f};
    drawTextLine(t, W - m - lineW(w, 0.4f), H - 24, 0.4f, perfWarn, w);
  }

  // ---- toasts (#messages): bottom-center stack, oldest on top, newest at
  //      bottom:170 — JS _message() 3.3 s life, max 4, color #efe0ac ----
  {
    const float toastC[3] = {0.937f, 0.878f, 0.675f}; // #efe0ac
    const float baseY = H - 170.0f, lineH = 24.0f;
    for (size_t i = toasts.size(); i-- > 0; ) {
      const float y = baseY - (int)(toasts.size() - 1 - i) * lineH;
      drawTextLine(t, W / 2.0f - lineW(toasts[i].text.c_str(), 0.6f) / 2, y, 0.6f, toastC, toasts[i].text.c_str());
    }
  }

  drawRects(v);
  drawText(t);
}

void App::_endRun(const char* reason) {
  (void)reason;
  if (!leaderboard) return;
  dc::ScoreEntry e;
  e.level = state.level;
  e.time = state.runTime;
  e.orbs = state.collectedOrbs;
  e.ngPlus = state.ngPlus;
  e.date = (std::int64_t)(std::time(nullptr) * 1000);
  leaderboard->submit(e);
  // save-for-later (JS writes this at death; Load restores a full-health level)
  const auto sv = state.toSave();
  std::string j = std::string("{\"level\":") + std::to_string(sv.level) +
                 ",\"runTime\":" + std::to_string(sv.runTime) +
                 ",\"collectedOrbs\":" + std::to_string(sv.collectedOrbs) +
                 ",\"weaponTier\":" + std::to_string(sv.weaponTier) +
                 ",\"maxHealth\":" + std::to_string(sv.maxHealth) +
                 ",\"ngPlus\":" + std::to_string(sv.ngPlus) +
                 ",\"bossKills\":" + std::to_string(sv.bossKills) +
                 ",\"health\":" + std::to_string(sv.health) + "}";
  FILE* f = fopen(saveFile.c_str(), "w");
  if (f) { std::fputs(j.c_str(), f); std::fclose(f); saveWritten = true; }
  std::fprintf(stderr, "[dc_app] run ended — leaderboard rank #%d, save written (%s)\n",
               leaderboard->rankOf(e), saveFile.c_str());
}

void App::startRun(int seedToUse) {
  state = dc::GameState::fromOpts();
  state.level = 1;
  state.biome = dc::biomeForLevel(1);
  state.dungeonSeed = seedToUse;
  state.health = state.maxHealth;
  state.safeSpawn = player::kSafeSpawnTime;
  dc::DungeonGenerator gen(seedToUse, state.biome);
  world.dungeon = gen.generate();
  buildWorldFromState();
  placePlayerAtEntrance();
  spawnEntities();
  simHealth = state.maxHealth;
  playerDead = false;
  screen = Screen::Play;
  std::fprintf(stderr, "[dc_app] run started (seed %d, level 1)\n", seedToUse);
}

// ---- GLFW callbacks (file-static because they're C-function pointers) ----
static App* g_app = nullptr;
static void keyCb(GLFWwindow* w, int key, int, int action, int) {
  if (!g_app) return;
  const bool down = action == GLFW_PRESS || action == GLFW_REPEAT;
  if (key == GLFW_KEY_W) g_app->keyW = down;
  else if (key == GLFW_KEY_S) g_app->keyS = down;
  else if (key == GLFW_KEY_A) g_app->keyA = down;
  else if (key == GLFW_KEY_D) g_app->keyD = down;
  else if (key == GLFW_KEY_E) g_app->keyE = down;
  else if (key == GLFW_KEY_N) g_app->keyN = down;
  else if (key == GLFW_KEY_Y) g_app->keyY = down;
  else if (key == GLFW_KEY_LEFT_SHIFT || key == GLFW_KEY_RIGHT_SHIFT) g_app->keyShift = down;
  else if (key == GLFW_KEY_ESCAPE && action == GLFW_PRESS) glfwSetWindowShouldClose(w, 1);
}
static void cursorCb(GLFWwindow*, double x, double y) {
  static double lx = 0, ly = 0;
  if (g_app) { g_app->mouseDX += x - lx; g_app->mouseDY += y - ly; }
  lx = x; ly = y;
}
static void mouseButtonCb(GLFWwindow* w, int button, int action, int) {
  if (!g_app) return;
  const bool down = action == GLFW_PRESS || action == GLFW_REPEAT;
  if (button == GLFW_MOUSE_BUTTON_LEFT) g_app->keyLMB = down;
  else if (button == GLFW_MOUSE_BUTTON_RIGHT) g_app->keyRMB = down;
}

} // namespace

int main(int argc, char** argv) {
  int width = 1280, height = 720, frames = 0, seed = 1000, saveFrame = -1, level = 1;
  const char* savePath = nullptr;
  bool showFps = false, bossView = false, combatView = false, descendView = false;
  bool titleView = false, deathView = false, hudView = false, degradedView = false;
  bool enemyView = false, dropView = false, burnView = false;
  bool vaultView = false;
  for (int i = 1; i < argc; i++) {
    if (!std::strcmp(argv[i], "--width")) width = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--height")) height = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--frames")) frames = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--save")) savePath = argv[++i];
    else if (!std::strcmp(argv[i], "--fps")) showFps = true;
    else if (!std::strcmp(argv[i], "--seed")) seed = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--save-frame")) saveFrame = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--level")) level = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--boss-view")) bossView = true;
    else if (!std::strcmp(argv[i], "--combat-view")) combatView = true;
    else if (!std::strcmp(argv[i], "--descend-view")) descendView = true;
    else if (!std::strcmp(argv[i], "--title")) titleView = true;
    else if (!std::strcmp(argv[i], "--death-view")) deathView = true;
    else if (!std::strcmp(argv[i], "--hud-view")) hudView = true;
    else if (!std::strcmp(argv[i], "--degraded")) degradedView = true;
    else if (!std::strcmp(argv[i], "--enemy-view")) enemyView = true;
    else if (!std::strcmp(argv[i], "--drop-view")) dropView = true;
    else if (!std::strcmp(argv[i], "--vault-view")) vaultView = true;
    else if (!std::strcmp(argv[i], "--burn-view")) burnView = true;
  }

  App app;
  const char* fontPath = "assets/kenpixel.ttf";
  if (!app.init(width, height, "dc_app — Phase 2 playable spine (STONE)", fontPath)) return 1;
  g_app = &app;
  app.seed = seed;
  app.screen = titleView ? App::Screen::Title : App::Screen::Play;
  glfwSetKeyCallback(app.window, keyCb);
  glfwSetCursorPosCallback(app.window, cursorCb);
  glfwSetMouseButtonCallback(app.window, mouseButtonCb);

  // build the world from a generated STONE dungeon
  app.state = dc::GameState::fromOpts();
  app.state.level = level;
  app.state.biome = dc::biomeForLevel(level);
  app.state.biomeIndex = [&] {
    auto it = std::find(dc::kBiomeSequence.begin(), dc::kBiomeSequence.end(), app.state.biome);
    return (int)(it != dc::kBiomeSequence.end() ? (it - dc::kBiomeSequence.begin()) : 0);
  }();
  app.state.dungeonSeed = seed;
  app.state.safeSpawn = player::kSafeSpawnTime;
  {
    dc::DungeonGenerator gen(seed, app.state.biome);
    app.world.dungeon = gen.generate();
  }
  app.buildWorldFromState();
  app.placePlayerAtEntrance();
  app.spawnEntities();

  dc::CrashContext ctx{0, 0, 0.0, 0.0, "render"};
  dc::installCrashHandler(&ctx);
  dc::FrameWatchdog wd(0.25);

  if (frames > 0) {
    glfwShowWindow(app.window);
    double t0 = glfwGetTime();
    const double dt = 1.0 / 60.0;
    // boss/combat/death probes need a boss → force a level-7 dungeon if the run isn't there
    if ((bossView || combatView || deathView || hudView) && app.state.level % dc::boss::kInterval != 0) {
      std::fprintf(stderr, "[dc_app] view: no boss at level %d — regenerating at level 7\n", app.state.level);
      app.state.level = 7;
      app.state.biome = dc::biomeForLevel(7);
      dc::DungeonGenerator gen(app.state.dungeonSeed, app.state.biome);
      app.world.dungeon = gen.generate();
      app.buildWorldFromState();
      app.placePlayerAtEntrance();
      app.spawnEntities();
    }
    // --boss-view: stand 8u in front of the throne so the boss wakes,
    // charges/blinks and the skeletons converge — a live combat shot.
    if (bossView) {
      const dc::Dungeon& dg = app.world.dungeon;
      const double cs = dg.cellSize;
      const dc::Vec2 b = app.boss.pos;
      // ring-scan a walkable spot with clear LOS (mirror of the aggro-check)
      static const double dirs[6][2] = {{1, 0}, {0, 1}, {-1, 0}, {0, -1}, {0.7, 0.7}, {-0.7, 0.7}};
      bool found = false;
      for (double dist = 6.0; dist <= 12.0 && !found; dist += 1.0)
        for (const auto& d : dirs) {
          const double wx = b.x + d[0] * dist, wz = b.z + d[1] * dist;
          if (dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) continue;
          if (!dc::hasLineOfSight(app.world.collision.boxes, b.x, b.z, wx, wz)) continue;
          app.camX = wx; app.camZ = wz;
          app.state.player.x = wx; app.state.player.z = wz;
          app.state.player.yaw = (float)std::atan2(-(b.x - wx), -(b.z - wz));
          found = true; break;
        }
      std::fprintf(stderr, "[dc_app] boss-view placed player %s throne (boss %s, hp %.0f)\n",
                   found ? "beside" : "FALLBACK", app.boss.state.c_str(), app.boss.hp);
    }
    // --combat-view: stand ~3u from the throne, face the boss, grant souls,
    // then the frame loop drives LMB (orbs) + RMB taps (sword) so the weapons
    // actually fire and land — a headless combat check.
    if (combatView) {
      const dc::Vec2 b = app.boss.pos;
      static const double dirs[6][2] = {{1, 0}, {0, 1}, {-1, 0}, {0, -1}, {0.7, 0.7}, {-0.7, 0.7}};
      bool found = false;
      for (double dist = 2.5; dist <= 5.0 && !found; dist += 0.5)
        for (const auto& d : dirs) {
          const double wx = b.x + d[0] * dist, wz = b.z + d[1] * dist;
          if (dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) continue;
          if (!dc::hasLineOfSight(app.world.collision.boxes, b.x, b.z, wx, wz)) continue;
          app.camX = wx; app.camZ = wz;
          app.state.player.x = wx; app.state.player.z = wz;
          found = true; break;
        }
      app.state.collectedOrbs = 25; // enough souls for a full 3-step orb seq + tier 1
      app.state.safeSpawn = 0;    // skip the spawn protection so combat runs immediately
      app.state.player.yaw = (float)std::atan2(-(b.x - app.state.player.x), -(b.z - app.state.player.z));
      std::fprintf(stderr, "[dc_app] combat-view placed player %s throne (boss hp %.0f, souls %d)\n",
                   found ? "at" : "FALLBACK", app.boss.hp, app.state.collectedOrbs);
    }
    // --descend-view: exit-portal test — stand in the exit room, hold E, and the
    // portal should carry the player to level+1 with a freshly generated dungeon.
    if (descendView) {
      const dc::Dungeon& dg = app.world.dungeon;
      const double cs = dg.cellSize;
      const dc::Vec2 ex{dg.exitCell->x * cs, dg.exitCell->z * cs};
      app.camX = ex.x; app.camZ = ex.z;
      app.state.player.x = ex.x; app.state.player.z = ex.z;
      app.state.safeSpawn = 0;
      app.keyE = true; // held for the first frames → descend on entering the portal
      std::fprintf(stderr, "[dc_app] descend-view: player in exit room (level %d, portalOpen=%d)\n",
                   app.state.level, (int)app.bossPortalOpen);
    }
    // --death-view: stand in the boss throne room with no weapons/souls and let the
    // boss + skeletons kill the player → the death screen (YOU DIED) appears.
    if (deathView) {
      const dc::Vec2 b = app.boss.pos;
      static const double dirs[6][2] = {{1, 0}, {0, 1}, {-1, 0}, {0, -1}, {0.7, 0.7}, {-0.7, 0.7}};
      bool found = false;
      for (double dist = 8.0; dist <= 14.0 && !found; dist += 1.0)
        for (const auto& d : dirs) {
          const double wx = b.x + d[0] * dist, wz = b.z + d[1] * dist;
          if (dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) continue;
          if (!dc::hasLineOfSight(app.world.collision.boxes, b.x, b.z, wx, wz)) continue;
          app.camX = wx; app.camZ = wz;
          app.state.player.x = wx; app.state.player.z = wz;
          found = true; break;
        }
      app.state.safeSpawn = 0;
      app.state.collectedOrbs = 0;
      std::fprintf(stderr, "[dc_app] death-view: player at throne, no weapons (boss %s)\n",
                   app.boss.state.c_str());
    }
    // --hud-view: showcase every HUD element at once — level 7 (boss bar),
    // souls (weapon slot), and partial health (hearts bar) all visible.
    if (hudView) {
      const dc::Vec2 b = app.boss.pos;
      static const double dirs[6][2] = {{1, 0}, {0, 1}, {-1, 0}, {0, -1}, {0.7, 0.7}, {-0.7, 0.7}};
      bool found = false;
      for (double dist = 9.0; dist <= 14.0 && !found; dist += 1.0)
        for (const auto& d : dirs) {
          const double wx = b.x + d[0] * dist, wz = b.z + d[1] * dist;
          if (dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) continue;
          if (!dc::hasLineOfSight(app.world.collision.boxes, b.x, b.z, wx, wz)) continue;
          app.camX = wx; app.camZ = wz;
          app.state.player.x = wx; app.state.player.z = wz;
          found = true; break;
        }
      app.state.safeSpawn = 0;
      app.state.collectedOrbs = 120; // souls → weapon tier 2 (Runic Greatsword)
      app.state.weaponTier = dc::weaponTier(app.state.collectedOrbs);
      app.simHealth = 2.0;           // partial hearts bar (of maxHealth 3)
      app.state.health = 2;
      // probe player is invulnerable: the boss charges/blinks and would kill
      // the standing probe before the frame capture, hiding the HUD under the
      // death overlay. Keep the hearts readout at 2/3 but make simHealth
      // effectively immortal so the PLAY screen (with the boss bar) is shot.
      app.probeInvuln = true;
      // p3-hud-full: force the new HUD elements visible
      app.state.buffEffect = 1; app.state.buffTime = 4.7; // → "BRIGHT 5s" badge
      app.state.sprintTier = 3;                           // → "SPRINT +15%" line
      app.swordStep = 2;                                  // → 2/3 combo pips lit
      app.toast("Something stirs in the ashes...");      // #messages toast
      app.toast("No orbs! Slay skeletons to gather orbs"); // no-ammo toast
      // danger glow: boss levels spawn no regular skeletons, so push a small
      // cluster of living SKELETONs in FRONT of the player (view dir = -sin,-cos)
      // to light the TOP edge (a=0 → top). 6 mobs @ d≈6 → Σ(1/d)≈1.0, opacity 0.5.
      // JS iterates skeletons.enemies, not the boss — parity. def set so
      // skelsys.update is safe; the glow reads only pos/state.
      {
        const float yw = app.state.player.yaw;
        // FRONT of view = (-sin(yaw), -cos(yaw)); fan the cluster across it.
        for (int k = 0; k < 6; k++) {
          dc::Enemy sk;
          sk.type = "SKELETON";
          sk.def = &dc::kEnemyTypes.at("SKELETON");
          sk.hp = sk.maxHp = 2;
          sk.speed = 2.6; sk.dmg = 1; sk.drops = 1;
          sk.state = dc::EnemyState::kChase;
          const float spread = (float)(k - 2.5f) * 0.4f; // fan across the front
          const float off = 6.0f + 0.4f * spread;
          // front view dir (-sin,-cos), lateral offset along right dir (cos,-sin)
          sk.pos.x = app.state.player.x + off * -std::sin(yw) + spread * std::cos(yw);
          sk.pos.z = app.state.player.z + off * -std::cos(yw) + spread * -std::sin(yw);
          app.skelsys.enemies().push_back(std::move(sk));
        }
      }
      // hold Shift so updateSprint keeps the tier (probe stands still, so it
      // decays to 0 otherwise) — the sprint-bonus line stays up for the shot
      app.keyShift = true;
      const double dx = b.x - app.state.player.x, dz = b.z - app.state.player.z;
      app.state.player.yaw = (float)std::atan2(-dx, -dz);
      std::fprintf(stderr, "[dc_app] hud-view: player %s throne (souls %d → T%d, hp %d/%d)\n",
                   found ? "beside" : "FALLBACK", app.state.collectedOrbs,
                   app.state.weaponTier, app.state.health, app.state.maxHealth);
    }
    // --enemy-view: showcase the live roster — stand still, face the nearest mob.
    if (enemyView) {
      app.state.safeSpawn = 0;
      // run a few frames off-screen so at least one mob reveals from the queue,
      // then stand adjacent (LOS) to it so the cube is guaranteed on screen.
      for (int warm = 0; warm < 45; warm++) app.update(1.0 / 60.0, 1.0 / 60.0);
      const dc::Vec2 p2{app.state.player.x, app.state.player.z};
      const auto near = app.skelsys.nearby(p2.x, p2.z, 60.0);
      if (!near.empty()) {
        const dc::Enemy* e = near.front();
        static const double dirs[8][2] = {{1,0},{-1,0},{0,1},{0,-1},{0.7,0.7},{-0.7,0.7},{0.7,-0.7},{-0.7,-0.7}};
        bool found = false;
        for (const auto& d : dirs) {
          const double wx = e->pos.x + d[0] * 3.0, wz = e->pos.z + d[1] * 3.0;
          if (dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) continue;
          if (!dc::hasLineOfSight(app.world.collision.boxes, e->pos.x, e->pos.z, wx, wz)) continue;
          app.camX = wx; app.camZ = wz;
          app.state.player.x = wx; app.state.player.z = wz;
          found = true; break;
        }
        std::fprintf(stderr, "[dc_app] enemy-view: beside %s%s\n",
                     e->type.c_str(), found ? "" : " (FALLBACK: no LOS spot)");
      } else {
        std::fprintf(stderr, "[dc_app] enemy-view: no live mob yet\n");
      }
    }
    // --drop-view: showcase breakables/sarcophagi — stand adjacent (LOS) to the
    // nearest breakable (or sarcophagus) so the prop cubes are on screen.
    if (dropView) {
      app.state.safeSpawn = 0;
      // prefer a breakable; fall back to a sarcophagus
      const dc::Vec2* target = nullptr;
      for (const auto& b : app.drops.breakables())
        if (b.alive) { target = &b.pos; break; }
      const char* kind = "breakable";
      if (!target) {
        for (const auto& s : app.drops.sarcophagi()) { target = &s.pos; kind = "sarcophagus"; break; }
      }
      if (target) {
        static const double dirs[8][2] = {{1,0},{-1,0},{0,1},{0,-1},{0.7,0.7},{-0.7,0.7},{0.7,-0.7},{-0.7,-0.7}};
        bool found = false;
        for (const auto& d : dirs) {
          const double wx = target->x + d[0] * 2.5, wz = target->z + d[1] * 2.5;
          if (dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) continue;
          if (!dc::hasLineOfSight(app.world.collision.boxes, target->x, target->z, wx, wz)) continue;
          app.camX = wx; app.camZ = wz;
          app.state.player.x = wx; app.state.player.z = wz;
          app.state.player.yaw = (float)std::atan2(-(target->x - wx), -(target->z - wz));
          found = true; break;
        }
        std::fprintf(stderr, "[dc_app] drop-view: beside %s at (%.1f,%.1f) %s\n",
                     kind, target->x, target->z, found ? "" : "(FALLBACK: no LOS spot)");
      } else {
        std::fprintf(stderr, "[dc_app] drop-view: no breakables/sarcophagi this level\n");
      }
    }
    // --burn-view: showcase the BURN final-foe + its ground-fire patches.
    // Force-spawn BURN at the farthest cell (bypassing the clear trigger), then
    // stand adjacent (LOS) facing it; fire patches emit every 0.6 s.
    if (burnView) {
      app.state.safeSpawn = 0;
      app.burnSpawnedThisLevel = true; // suppress the natural (duplicate) trigger
      const int bi = app.skelsys.spawnBURN(app.world.dungeon,
                                           {app.camX, app.camZ}, app.state.ngPlus);
      if (bi >= 0) {
        const dc::Vec2& bp = app.skelsys.enemies()[bi].pos;
        static const double dirs[8][2] = {{1,0},{-1,0},{0,1},{0,-1},{0.7,0.7},{-0.7,0.7},{0.7,-0.7},{-0.7,-0.7}};
        bool found = false;
        for (const auto& d : dirs) {
          const double wx = bp.x + d[0] * 3.0, wz = bp.z + d[1] * 3.0;
          if (dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) continue;
          if (!dc::hasLineOfSight(app.world.collision.boxes, bp.x, bp.z, wx, wz)) continue;
          app.camX = wx; app.camZ = wz;
          app.state.player.x = wx; app.state.player.z = wz;
          app.state.player.yaw = (float)std::atan2(-(bp.x - wx), -(bp.z - wz));
          found = true; break;
        }
        std::fprintf(stderr, "[dc_app] burn-view: BURN at (%.1f,%.1f) %s\n",
                     bp.x, bp.z, found ? "" : "(FALLBACK: no LOS spot)");
      } else {
        std::fprintf(stderr, "[dc_app] burn-view: spawnBURN failed (no walkable cell)\n");
      }
    }
    // --vault-view: showcase the §13 decorative systems — teleport into the
    // first VAULT room (water pool) facing room center; dust + runes are
    // ambient around the room.
    if (vaultView) {
      const dc::Room* vault = nullptr;
      for (const auto& r : app.world.dungeon.rooms)
        if (r.type == "VAULT") { vault = &r; break; }
      if (vault) {
        const float cs = (float)app.world.dungeon.cellSize;
        const float cx = (float)(vault->cx + (vault->w - 1) / 2) * cs;
        const float cz = (float)(vault->cz + (vault->h - 1) / 2) * cs;
        app.camX = cx; app.camZ = cz;
        app.state.player.x = cx; app.state.player.z = cz;
        app.state.player.yaw = 0.0f;
        // face the nearest wall rune (showcase water + dust + rune together);
        // with no runes, face -Z.
        if (!app.runeData.empty()) {
          size_t best = 0; double bd = 1e9;
          for (size_t i = 0; i < app.runeData.size(); i += 9) {
            const double dx = app.runeData[i] - cx, dz = app.runeData[i + 2] - cz;
            const double d2 = dx * dx + dz * dz;
            if (d2 < bd) { bd = d2; best = i; }
          }
          const double dx = app.runeData[best] - cx, dz = app.runeData[best + 2] - cz;
          app.state.player.yaw = (float)std::atan2(-dx, -dz);
        }
        std::fprintf(stderr, "[dc_app] vault-view: VAULT %dx%d at (%.1f,%.1f) yaw=%.2f\n",
                     vault->w, vault->h, cx, cz, app.state.player.yaw);
        // TEMP-verify: force a smoke puff 2u ahead of the eye (smoke is
        // event-driven by breakable breaks; this isolates the point-sprite pass)
        {
          const float fw = -std::sin(app.state.player.yaw), fwz = -std::cos(app.state.player.yaw);
          app.smokePuff(cx + fw * 2.0f, 1.2f, cz + fwz * 2.0f);
        }
      } else {
        std::fprintf(stderr, "[dc_app] vault-view: no VAULT room this level\n");
      }
    }
    // --degraded: force the degraded-mode state (bloom off) for the 30 fps gate
    if (degradedView) { app.degraded = true; app.forcedDegraded = true; app.lowFpsTimer = 0; }
    // watch level transitions (descend-view) so a descent is provable headlessly
    int prevLevel = app.state.level;
    bool deathSeen = false;
    int deathAt = -1;
    bool restartSeen = false;
    for (int i = 0; i < frames; i++) {
      ctx.frame = i; ctx.phase = "render"; wd.begin();
      if (!bossView && !descendView && !deathView && !hudView && !enemyView && !dropView && !burnView && !vaultView) app.keyW = true; // interior-walk shot: drive forward
      else if (hudView) { // sprint toward the boss: keeps the SPRINT bonus line up
        // (updateSprint decays sprintTier to 0 when not moving+Shift)
        app.keyW = true; app.keyShift = true;
        const double dx = app.boss.pos.x - app.state.player.x;
        const double dz = app.boss.pos.z - app.state.player.z;
        app.state.player.yaw = (float)std::atan2(-dx, -dz);
      }
      else if (enemyView) { // stand still, face the nearest live mob (roster showcase)
        const dc::Vec2 p2{app.state.player.x, app.state.player.z};
        const auto near = app.skelsys.nearby(p2.x, p2.z, 60.0);
        if (!near.empty()) {
          const dc::Enemy* e = near.front();
          app.state.player.yaw = (float)std::atan2(-(e->pos.x - p2.x), -(e->pos.z - p2.z));
        }
      }
      else if (dropView) { /* stand still, face the prop (yaw set at placement) */ }
      else if (burnView) { /* stand still, face BURN (yaw set at placement) */ }
      else if (vaultView) { /* stand still, face room center (yaw set at placement) */ }
      else { // face the live boss each frame so it stays on screen
        const double dx = app.boss.pos.x - app.state.player.x;
        const double dz = app.boss.pos.z - app.state.player.z;
        app.state.player.yaw = (float)std::atan2(-dx, -dz);
      }
      if (combatView) {
        // face the boss, then drive the weapons:
        //  LMB hold for ~1s → a full 3-step soul-orb sequence (+ repeats)
        //  RMB short taps → sword combo cones (each tap = 1 cone at tier dmg)
        const double dx = app.boss.pos.x - app.state.player.x;
        const double dz = app.boss.pos.z - app.state.player.z;
        app.state.player.yaw = (float)std::atan2(-dx, -dz);
        app.keyLMB = (i >= 5 && i < 65);
        app.keyRMB = (i % 30 >= 10 && i % 30 < 13);
      }
      if (descendView) app.keyE = (i < 8); // hold E briefly → trigger the exit portal
      if (deathView) { // face the boss each frame so the kill is on-screen; no weapons
        const double dx = app.boss.pos.x - app.state.player.x;
        const double dz = app.boss.pos.z - app.state.player.z;
        app.state.player.yaw = (float)std::atan2(-dx, -dz);
        // after death, hold N to exercise the death-screen restart (→ fresh level-1 run)
        app.keyN = (deathSeen && (i - deathAt) >= 30);
      }
      app.update(dt, dt);
      if (descendView && app.state.level != prevLevel) {
        prevLevel = app.state.level;
        std::fprintf(stderr, "[dc_app] descend-view: LEVEL %d (biome %s) player=(%.1f,%.1f) portalOpen=%d\n",
                     app.state.level, app.state.biome.c_str(), app.state.player.x,
                     app.state.player.z, (int)app.bossPortalOpen);
      }
      if (deathView && !deathSeen && app.screen == App::Screen::Dead) {
        deathSeen = true;
        deathAt = i;
        std::fprintf(stderr, "[dc_app] death-view: player DIED at frame %d (level %d, souls %d) → death screen\n",
                     i, app.state.level, app.state.collectedOrbs);
      }
      if (deathView && deathSeen && !restartSeen && app.screen == App::Screen::Play) {
        restartSeen = true;
        std::fprintf(stderr, "[dc_app] death-view: RESTART at frame %d → level %d (biome %s), fresh dungeon\n",
                     i, app.state.level, app.state.biome.c_str());
      }
      app.frame();
      if (savePath && saveFrame == i) app.savePPM(savePath); // capture an in-flight frame
      glfwSwapBuffers(app.window);
      glfwPollEvents();
      wd.end("app.frame");
    }
    double el = glfwGetTime() - t0;
    if (savePath && saveFrame < 0) app.savePPM(savePath); // final frame (or use --save-frame)
    std::fprintf(stderr, "[dc_app] %d frames in %.3fs (%.1f fps) seed=%d level=%d biome=%s boss=%s(%.0fhp) skels=%d portalOpen=%d degraded=%d\n",
                 frames, el, frames / el, seed, app.state.level, app.state.biome.c_str(),
                 app.boss.state.c_str(), app.boss.hp, app.skelsys.liveCount(), (int)app.bossPortalOpen, (int)app.degraded);
  } else {
    double last = glfwGetTime(), acc = 0;
    int n = 0;
    while (!glfwWindowShouldClose(app.window)) {
      ctx.frame = n; ctx.phase = "render";
      double now = glfwGetTime();
      double rawDt = std::min(now - last, 0.1);
      last = now;
      wd.begin();
      app.update(rawDt, rawDt);
      app.frame();
      glfwSwapBuffers(app.window);
      glfwPollEvents();
      wd.end("app.frame");
      n++; acc += now - last;
      if (acc >= 0.5) {
        if (showFps) std::fprintf(stderr, "[dc_app] %.0f fps (degraded=%d)\n", n / acc, (int)app.degraded);
        acc = 0; n = 0;
      }
    }
  }
  return 0;
}
