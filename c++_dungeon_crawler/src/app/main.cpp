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
// Instance layout: offset(3) + scale(3) + color(3) + regionData(4)
// regionData: regionType(0=dead-end,1=corridor,2=intersection,3=room,4=stair),
//             faceDir(-1=floor/ceil,0=horizontal wall,1=vertical wall),
//             surfaceType(0=floor,1=wall,2=ceil),
//             edgeCount(0-4 neighbors)
const char* kLitVert = R"(
#version 330 core
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aOffset;
layout(location=3) in vec3 aScale;
layout(location=4) in vec3 aColor;
layout(location=5) in vec3 aRot0;
layout(location=6) in vec3 aRot1;
layout(location=7) in vec3 aRot2;
layout(location=8) in vec4 aRegion;
uniform mat4 uViewProj;
uniform mat4 uTorchVP;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
out vec4 vTorchPos;
out vec3 vRegionData; // regionType, faceDir, surfaceType
void main() {
  mat3 R = mat3(aRot0, aRot1, aRot2);
  vec3 wp = R * (aPos * aScale) + aOffset;
  vWorld = wp;
  vNormal = R * aNormal;
  vColor = aColor; // pass through instance color
  vTorchPos = uTorchVP * vec4(wp, 1.0);
  vRegionData = vec3(aRegion.xyz);
  gl_Position = uViewProj * vec4(wp, 1.0);
}
)";

const char* kLitFrag = R"(
#version 330 core
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
in vec4 vTorchPos;
in vec3 vRegionData;
uniform vec3 uTorchPos;
uniform vec3 uTorchColor;
uniform float uTorchIntensity;
uniform float uTorchDist;
uniform vec3 uHeadPos;
uniform vec3 uHeadColor;
uniform float uHeadIntensity;
uniform float uHeadDist;
uniform vec3 uAmbient;
uniform float uEmissive;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uEyePos;
uniform sampler2D uShadowMap;
uniform float uTime;
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
  float cut = 1.0 - smoothstep(distance * 0.5, distance, dist);
  float atten = intensity * cut / (1.0 + 0.2 * dist + 0.06 * dist * dist);
  return lcolor * diff * atten * shadow;
}

// ---- Procedural stone surface: per-surface variation + biome branching ----
// hash: fast 2D→1D noise seed
float hash12(vec2 p) {
  p = fract(p * vec2(123.34, 345.78));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y * 34.11);
}
float hash21(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898 + seed, 78.233)) + seed) * 43758.5453);
}

// Per-surface surface normal variation (subtle bumps for detail)
float bumpHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
vec3 bumpNormal(vec3 wp, vec3 n, float scale) {
  float eps = 0.02;
  vec2 p = vec2(wp.x, wp.z);
  float h = bumpHash(p * scale);
  float dx = bumpHash((p + vec2(eps, 0.0)) * scale) - h;
  float dz = bumpHash((p + vec2(0.0, eps)) * scale) - h;
  return n + vec3(dx, 0.0, dz) * 0.5;
}

// ---- Per-surface procedural detail based on regionType ----
// regionType: 0=dead-end, 1=corridor, 2=intersection, 3=room
vec3 surfaceDetail(vec3 wp, vec3 n, int regionType, int surfaceType) {
  vec2 uv;
  if (surfaceType == 2) { // ceiling
    uv = wp.xz;
    // Ceiling: dark-sooty pools + drips + torch-reflection gradient
    vec2 gid = floor(uv / 1.5);
    float pool = hash12(gid);
    float soot = smoothstep(0.4, 0.7, pool); // soot pools
    float drip = smoothstep(0.7, 0.8, hash12(gid * 1.3)) * step(0.3, fract(uv.y * 0.2));
    float blockVar = 0.80 + 0.20 * hash12(gid);
    // Uniform brightness (all channels equal) so the biome albedo hue is
    // preserved — per-channel detail would tint the ceiling.
    float d = blockVar * (1.0 - soot * 0.3) * (1.0 - drip * 0.15);
    return vec3(d);
  } else if (surfaceType == 0) { // floor
    uv = wp.xz;
    // Floor: worn/smooth with foot-trail patterns + stair tread marks
    vec2 gid = floor(uv / 1.2);
    float blockVar = 0.82 + 0.32 * hash12(gid);
    vec2 f = fract(uv / 1.2) - 0.5;
    // Mortar lines (wider on floors)
    float edge = smoothstep(0.5, 0.38, max(abs(f.x), abs(f.y)));
    float mortar = mix(0.5, 1.0, edge);
    // Foot-trail wear: streaks along corridor direction (subtle brightness)
    float trail = hash12(floor(uv * vec2(0.5, 2.0)));
    float wear = smoothstep(0.3, 0.7, trail); // worn paths
    float tread = smoothstep(0.15, 0.3, abs(f.y)) * step(0.4, hash12(gid + vec2(0, 1)));
    // Crevice AO
    float ao = 0.85 + 0.15 * clamp(wp.y * 0.25 + 0.5, 0.0, 1.0);
    // Uniform brightness (all channels equal) so the biome albedo hue is
    // preserved — per-channel detail would tint the tan floor magenta.
    float d = blockVar * mortar * (0.85 + 0.15 * wear) * (1.0 + tread * 0.05) * ao;
    return vec3(d);
  } else { // walls
    uv = wp.xy; // walls are vertical
    // Walls: varied block sizes + mortar density + crack networks
    vec2 gid = floor(uv / 1.0);
    float blockVar = 0.80 + 0.35 * hash12(gid);
    vec2 f = fract(uv / 1.0) - 0.5;
    // Mortar seam (tighter on walls)
    float edge = smoothstep(0.5, 0.42, max(abs(f.x), abs(f.y)));
    float mortar = mix(0.55, 1.0, edge);
    // Crack network (more on intersection/corridor walls)
    float crackMask = step(0.5, hash12(gid * 2.0));
    float crack1 = 1.0 - smoothstep(0.0, 0.03, abs(f.x * f.y) / max(length(f), 0.01));
    float crack2 = 1.0 - smoothstep(0.0, 0.02, abs(f.x * 0.7 + f.y * 0.3 - 0.1));
    float crack = max(crack1, crack2) * crackMask * 0.3;
    // Vertical streaks (water/age stains)
    float streak = smoothstep(0.6, 0.8, hash21(uv * 0.3, 2.0)) * 0.15;
    // Uniform brightness (all channels equal) so the biome albedo hue is
    // preserved — per-channel detail would tint the walls with colored stripes.
    float d = blockVar * mortar * (1.0 - crack) * (1.0 - streak);
    return vec3(d);
  }
}

void main() {
  // torch flicker: layered sin waves + noise
  float flick = 0.94 + 0.06 * sin(uTime * 3.7) * sin(uTime * 7.1) + 0.03 * sin(uTime * 13.3);
  vec3 torchCol = uTorchColor * flick;

  // Surface-specific albedo based on regionData
  int regionType = int(vRegionData.x);
  int surfaceType = int(vRegionData.z);
  vec3 detail = surfaceDetail(vWorld, vNormal, regionType, surfaceType);

  vec3 albedo = vColor * detail;
  vec3 lit = albedo * uAmbient;
  lit += pointLight(uTorchPos, torchCol, uTorchIntensity, uTorchDist, shadowFactor(vTorchPos)) * albedo;
  lit += pointLight(uHeadPos, uHeadColor, uHeadIntensity, uHeadDist, 1.0) * albedo;
  if (uEmissive > 0.5) lit = vColor * 0.9;
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
layout(location=0) in vec2 aC;      // corner -0.5..0.5 (per-vertex quad)
layout(location=1) in vec4 aData;  // pos3 + alpha (per-instance)
uniform mat4 uViewProj;
uniform mat4 uView;
uniform float uSmokeRad;
out float vA;
out vec2 vC;
void main() {
  vec3 right = vec3(uView[0].x, uView[0].y, uView[0].z);
  vec3 upv   = vec3(uView[1].x, uView[1].y, uView[1].z);
  vA = aData.w;
  vC = aC;
  // JS gl_PointSize=90.0/-mv.z px <=> constant world radius (distance cancels).
  gl_Position = uViewProj * vec4(aData.xyz + (right * aC.x + upv * aC.y) * uSmokeRad, 1.0);
}
)";

const char* kSmokeFrag = R"(
#version 330 core
in float vA;
in vec2 vC;
uniform vec3 uColor;
uniform float uTime;
out vec4 fragColor;
void main() {
  float d = length(vC);
  float a = smoothstep(0.5, 0.1, d) * vA * 0.5;
  if (a < 0.01) discard;
  // ambient shimmer: slight brightness variation over time
  float shimmer = 1.0 + 0.15 * sin(uTime * 1.5 + d * 10.0);
  fragColor = vec4(uColor * shimmer, a);
}
)";

// ParticleSystem (30 ambient dust motes, torch-adjacent, additive 0.45).
const char* kDustVert = R"(
#version 330 core
layout(location=0) in vec2 aC;
layout(location=1) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform float uDustRad;
out vec2 vC;
void main() {
  vec3 right = vec3(uView[0].x, uView[0].y, uView[0].z);
  vec3 upv   = vec3(uView[1].x, uView[1].y, uView[1].z);
  vC = aC;
  gl_Position = uViewProj * vec4(aPos + (right * aC.x + upv * aC.y) * uDustRad, 1.0);
}
)";

const char* kDustFrag = R"(
#version 330 core
in vec2 vC;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
out vec4 fragColor;
void main() {
  float d = length(vC);
  float a = smoothstep(0.5, 0.0, d) * uOpacity;
  if (a < 0.01) discard;
  // additive glow: bright center, fading halo
  float glow = exp(-d * 3.0) * 0.3;
  vec3 col = uColor * (1.0 + glow + 0.1 * sin(uTime * 2.0));
  fragColor = vec4(col, a + glow);
}
)";

// §13 Atmospheric particles: biome-specific ambient particles (embers, snow, spores, crystal dust).
// Shared vertex shader for all atmospheric particles — GPU billboard quads.
const char* kAtmoVert = R"(
#version 330 core
layout(location=0) in vec2 aC;      // corner -0.5..0.5 (per-vertex quad)
layout(location=1) in vec3 aPos;    // per-instance position
uniform mat4 uViewProj;
uniform mat4 uView;
uniform float uAtmoRad;
out vec2 vC;
void main() {
  vec3 right = vec3(uView[0].x, uView[0].y, uView[0].z);
  vec3 upv   = vec3(uView[1].x, uView[1].y, uView[1].z);
  vC = aC;
  gl_Position = uViewProj * vec4(aPos + (right * aC.x + upv * aC.y) * uAtmoRad, 1.0);
}
)";

const char* kAtmoFrag = R"(
#version 330 core
in vec2 vC;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uParticleType; // 0=ember, 1=snow, 2=spore, 3=crystal_dust
out vec4 fragColor;
void main() {
  float d = length(vC);
  float a = smoothstep(0.5, 0.0, d) * uOpacity;
  if (a < 0.01) discard;
  // additive glow: bright center, fading halo
  float glow = exp(-d * 3.0) * 0.4;
  // per-type animation
  float flicker = 1.0;
  if (uParticleType > 0.5 && uParticleType < 1.5) {
    // ember: flickering bright particles
    flicker = 0.8 + 0.2 * sin(uTime * 5.0 + d * 20.0);
    glow *= 1.5;
  } else if (uParticleType > 1.5 && uParticleType < 2.5) {
    // spore: gentle pulsing glow
    flicker = 0.9 + 0.1 * sin(uTime * 2.0 + d * 10.0);
  } else if (uParticleType > 3.5) {
    // crystal dust: subtle sparkle
    flicker = 0.7 + 0.3 * pow(1.0 - d, 2.0);
    glow *= 2.0;
  } else {
    // snow: subtle drift shimmer
    flicker = 0.85 + 0.15 * sin(uTime * 1.5);
  }
  vec3 col = uColor * (1.0 + glow * flicker);
  fragColor = vec4(col, a + glow);
}
)";

// §14 Enemy projectile trail particles
const char* kProjTrailVert = R"(
#version 330 core
layout(location=0) in vec2 aC;
layout(location=1) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform float uTrailRad;
out vec2 vC;
void main() {
  vec3 right = vec3(uView[0].x, uView[0].y, uView[0].z);
  vec3 upv   = vec3(uView[1].x, uView[1].y, uView[1].z);
  vC = aC;
  gl_Position = uViewProj * vec4(aPos + (right * aC.x + upv * aC.y) * uTrailRad, 1.0);
}
)";

const char* kProjTrailFrag = R"(
#version 330 core
in vec2 vC;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
out vec4 fragColor;
void main() {
  float d = length(vC);
  float a = smoothstep(0.5, 0.0, d) * uOpacity;
  if (a < 0.01) discard;
  // trailing glow with color shift
  float trailGlow = exp(-d * 4.0) * 0.4;
  vec3 col = uColor * (1.0 + trailGlow + 0.15 * sin(uTime * 4.0));
  fragColor = vec4(col, a + trailGlow);
}
)";

// §14 Portal/exit marker enhancements: orbiting particles + beacon beam sweep
const char* kPortalParticleVert = R"(
#version 330 core
layout(location=0) in vec2 aC;
layout(location=1) in vec3 aPos;
layout(location=2) in float aPhase;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform float uPortalRad;
uniform float uTime;
out vec2 vC;
out float vPhase;
void main() {
  vec3 right = vec3(uView[0].x, uView[0].y, uView[0].z);
  vec3 upv   = vec3(uView[1].x, uView[1].y, uView[1].z);
  vC = aC;
  vPhase = aPhase;
  // orbiting motion: slight rotation around center
  float orbitAngle = uTime * 2.0 + aPhase;
  vec3 orbitOffset = vec3(cos(orbitAngle) * 0.15, sin(orbitAngle) * 0.15, 0.0);
  gl_Position = uViewProj * vec4(aPos + orbitOffset + (right * aC.x + upv * aC.y) * uPortalRad, 1.0);
}
)";

const char* kPortalParticleFrag = R"(
#version 330 core
in vec2 vC;
in float vPhase;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
out vec4 fragColor;
void main() {
  float d = length(vC);
  float a = smoothstep(0.5, 0.0, d) * uOpacity;
  if (a < 0.01) discard;
  // beacon beam sweep: brightness oscillates per particle
  float sweep = 0.7 + 0.3 * sin(uTime * 3.0 + vPhase * 6.28);
  vec3 col = uColor * sweep;
  // sparkle highlight
  float sparkle = pow(1.0 - d, 3.0) * 0.3;
  col += vec3(sparkle);
  fragColor = vec4(col, a);
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
  vUv = vec2(aUvX + aUv.x / 16.0, aUv.y);
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
  // bioluminescent glow: inner bright core + outer halo
  float glow = smoothstep(0.3, 0.9, t.a) * 0.35 * pulse; // glow halo
  float a = t.a * pulse + glow;
  vec3 col = vColor * (1.0 + glow); // brighten by glow amount
  if (a < 0.01) discard;
  fragColor = vec4(col, min(a, 0.95));
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
  // multi-frequency wave for natural ripple
  wp.y += sin(uTime * 1.5 + aPhase + dot(aPos, vec2(2.0))) * 0.03;
  wp.y += sin(uTime * 3.2 + aPhase * 1.7 + dot(aPos, vec2(-1.5, 2.3))) * 0.015;
  vWorld = wp;
  gl_Position = uViewProj * vec4(wp, 1.0);
}
)";

const char* kWaterFrag = R"(
#version 330 core
uniform float uTime;
in vec3 vWorld;
uniform vec3 uEyePos;
out vec4 fragColor;
void main() {
  vec3 col = vec3(0.227, 0.416, 0.541); // 0x3a6a8a
  float d = distance(vWorld, uEyePos);
  float vis = clamp(1.0 - d * 0.04, 0.3, 1.0);
  // caustic shimmer: intersecting sine waves
  float caustic = 0.85 + 0.15 * sin(d * 4.0 + uTime * 1.5) * sin(dot(vWorld.xz * 2.0, vec2(1.0, 0.7) + uTime * 0.3));
  col *= caustic;
  // fresnel rim brightness
  vec3 viewDir = normalize(uEyePos - vWorld);
  vec3 normal = normalize(vWorld - vec3(vWorld.x, vWorld.y + 0.1, vWorld.z));
  float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 2.0);
  col += vec3(0.15, 0.2, 0.25) * fresnel;
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
uniform float uGlowPulse;
out vec4 fragColor;
void main() {
  vec3 acc = texture(uTex, vUv).rgb * 0.227;
  acc += texture(uTex, vUv + uDir * 1.3846).rgb * 0.3162;
  acc += texture(uTex, vUv - uDir * 1.3846).rgb * 0.3162;
  acc += texture(uTex, vUv + uDir * 3.2308).rgb * 0.07027;
  acc += texture(uTex, vUv - uDir * 3.2308).rgb * 0.07027;
  // wider pass for pulsing glow
  acc += texture(uTex, vUv + uDir * 5.6308).rgb * 0.0269;
  acc += texture(uTex, vUv - uDir * 5.6308).rgb * 0.0269;
  fragColor = vec4(acc * uGlowPulse, 1.0);
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
uniform float uTime;
uniform float uNearMiss; // 0.0 = no near-miss, 1.0 = triggered
out vec4 fragColor;
void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 sharp = texture(uGlowSharp, vUv).rgb;
  vec3 blur  = texture(uGlowBlur, vUv).rgb;
  vec3 glow = (blur * 1.6 * uGlowPulse + sharp * 0.5) * uGlowIntensity; // §12.2 EnemyGlowShader
  vec3 c = scene + bloom * uStrength + glow;
  // enhanced vignette: deeper corners, smoother falloff
  vec2 q = vUv - 0.5;
  float vig = 1.0 - dot(q, q) * 0.45; // 1.0 → ~0.78 corners
  vig *= 0.95 + 0.05 * sin(uGlowPulse * 0.5); // subtle pulse synced with glow
  // HUD danger glow: soft gradient border on near-miss
  float nearMiss = uNearMiss * sin(uTime * 3.0) * 0.5; // pulsing near-miss (halved for perf)
  vec2 hudEdge = vec2(abs(q.x * 4.0 - 0.5), abs(q.y * 4.0 - 0.5));
  float borderGlow = smoothstep(0.3, 0.0, min(hudEdge.x, hudEdge.y)) * nearMiss * 0.25;
  c += vec3(0.4, 0.1, 0.1) * borderGlow; // subtle red border pulse
  // ---- visual detail: subtle radial vignette (cinematic depth, focuses the
  //      eye; the HUD is drawn on top so it is unaffected) ----
  fragColor = vec4(c * vig, 1.0);
}
)";

// §12.2 enemy-glow: flat red-orange override material (JS GLOW_MAT 0xff4422)
// Enhanced: pulsing edge flash, brighter core, multi-frame hit-flash support
const char* kFlatMaskFrag = R"(
#version 330 core
uniform float uTime;
uniform float uHitFlash; // 0.0 = normal glow, 1.0 = flash active
out vec4 fragColor;
void main() {
  float pulse = 1.0 + 0.15 * sin(uTime * 3.0);
  vec3 baseColor = vec3(1.0, 0.267, 0.133); // 0xff4422
  // hit-flash: rapid bright→white→cool→fade (3-frame sequence)
  float flashT = mod(uTime * 8.0, 1.0); // 0→1 over 0.125s flash
  vec3 flashColor = vec3(0.0);
  if (flashT < 0.15) {
    // frame 1: bright white flash
    float flashAmt = clamp(flashT / 0.15 * uHitFlash, 0.0, 1.0);
    flashColor = mix(baseColor * pulse, vec3(1.0), flashAmt);
  } else if (flashT < 0.4) {
    // frame 2: cool blue shift
    float t = clamp((flashT - 0.15) / 0.25, 0.0, 1.0);
    flashColor = mix(vec3(1.0), baseColor * 0.6, t) + vec3(0.0, 0.3, 0.5) * uHitFlash;
  } else {
    // frame 3: fade back to normal
    float t = clamp((flashT - 0.4) / 0.6, 0.0, 1.0);
    flashColor = mix(baseColor * 0.6, baseColor * pulse, t);
  }
  fragColor = vec4(flashColor, 1.0);
}
)";

// §14 Sword enhancements: blade shimmer + highlight
const char* kSwordShimmerVert = R"(
#version 330 core
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aOffset;
layout(location=3) in vec3 aScale;
layout(location=4) in vec3 aColor;
layout(location=5) in vec3 aRot0;
layout(location=6) in vec3 aRot1;
layout(location=7) in vec3 aRot2;
uniform mat4 uViewProj;
uniform float uTime;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
out float vShimmer;
void main() {
  mat3 R = mat3(aRot0, aRot1, aRot2);
  vec3 wp = R * (aPos * aScale) + aOffset;
  vWorld = wp;
  vNormal = R * aNormal;
  vColor = aColor;
  // shimmer: moving highlight along blade
  float shimmer = 0.7 + 0.3 * sin(uTime * 6.0 + wp.y * 3.0);
  vShimmer = shimmer;
  gl_Position = uViewProj * vec4(wp, 1.0);
}
)";

const char* kSwordShimmerFrag = R"(
#version 330 core
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
in float vShimmer;
uniform vec3 uHeadPos;
uniform vec3 uHeadColor;
uniform float uHeadIntensity;
uniform float uHeadDist;
uniform vec3 uAmbient;
out vec4 fragColor;
void main() {
  vec3 albedo = vColor * vShimmer;
  vec3 lit = albedo * uAmbient;
  lit += pointLight(uHeadPos, uHeadColor, uHeadIntensity, uHeadDist, 1.0) * albedo;
  // edge highlight
  vec3 viewDir = normalize(uHeadPos - vWorld);
  float rim = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.0);
  lit += vec3(0.3, 0.35, 0.4) * rim * 0.5;
  fragColor = vec4(min(lit, vec3(1.5)), 1.0);
}
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
  // §13 wall props (sconces, pillars, giant mushrooms, broken statues):
  // instanced wall decorations per-biome.
  GLuint instWallProps = 0;
  int nWallProps = 0;

  void upload(const dc::Dungeon& d, const float cellCol[3], const float wallCol[3],
              const float ceilCol[3], std::uint32_t seed, const std::string& biome = "");
  void buildInstanceData(const dc::Dungeon& d, std::vector<float>& floorInst,
                         std::vector<float>& ceilInst, std::vector<float>& wallH,
                         std::vector<float>& wallE) const;
  void buildProps(const dc::Dungeon& d, std::vector<float>& wallProps,
                  const std::string& biome, std::uint32_t seed) const;
};

void World::buildInstanceData(const dc::Dungeon& d, std::vector<float>& floorInst,
                              std::vector<float>& ceilInst, std::vector<float>& wallH,
                              std::vector<float>& wallE) const {
  const float cs = (float)d.cellSize;
  const float H = (float)dc::world::kWallHeight;
  const float wt = (float)dc::kWallThickness;
  floorInst.clear(); ceilInst.clear(); wallH.clear(); wallE.clear();

  // Pre-compute region types based on neighbor count (dead-end=0, corridor=1-2, intersection=3, room=4)
  std::vector<int> cellRegion(d.gridSize * d.gridSize, 0);
  for (int z = 0; z < d.gridSize; z++) {
    for (int x = 0; x < d.gridSize; x++) {
      if (d.grid[z][x] == dc::Cell::kEmpty) continue;
      int nc = 0;
      static const int kDirX[4] = {1, -1, 0, 0};
      static const int kDirZ[4] = {0, 0, 1, -1};
      for (int k = 0; k < 4; k++) {
        const int nx = x + kDirX[k], nz = z + kDirZ[k];
        const bool oob = nx < 0 || nz < 0 || nx >= d.gridSize || nz >= d.gridSize;
        if (!oob && d.grid[nz][nx] != dc::Cell::kEmpty) nc++;
      }
      cellRegion[z * d.gridSize + x] = (nc < 2) ? 0 : (nc < 3) ? 1 : (nc < 4) ? 2 : 3;
    }
  }

  for (int z = 0; z < d.gridSize; z++) {
    for (int x = 0; x < d.gridSize; x++) {
      if (d.grid[z][x] == dc::Cell::kEmpty) continue;
      const float wx = (float)(x * d.cellSize), wz = (float)(z * d.cellSize);
      const int regType = cellRegion[z * d.gridSize + x];
      const int edgeCount = (d.gridSize * d.gridSize > 0) ? (4 - ((regType < 3) ? regType + 1 : 4)) : 4;
      // floor: 22 floats — offset(3) + scale(3) + color(3) + rot3x3(9) + regionData(4)
      // regionData: regionType, faceDir(-1=floor/ceil), surfaceType(0=floor/1/2), edgeCount
      floorInst.insert(floorInst.end(), {wx, 0.1f, wz, cs, 0.2f, cs, 0, 0, 0,
        1,0,0, 0,1,0, 0,0,1, (float)regType, -1.0f, 0.0f, 0.0f});
      ceilInst.insert(ceilInst.end(), {wx, H - 0.1f, wz, cs, 0.2f, cs, 0, 0, 0,
        1,0,0, 0,1,0, 0,0,1, (float)regType, -1.0f, 2.0f, 0.0f});
      // exposed/boundary edges → walls (same logic as WorldBuilder)
      static const int kDirX[4] = {1, -1, 0, 0};
      static const int kDirZ[4] = {0, 0, 1, -1};
      for (int k = 0; k < 4; k++) {
        const int dx = kDirX[k], dz = kDirZ[k];
        const int nx = x + dx, nz = z + dz;
        const bool oob = nx < 0 || nz < 0 || nx >= d.gridSize || nz >= d.gridSize;
        if (!oob && d.grid[nz][nx] != dc::Cell::kEmpty) continue;
        const float ex = wx + (float)(dx * d.cellSize) / 2.0f, ez = wz + (float)(dz * d.cellSize) / 2.0f;
        if (dz != 0) { // N/S wall: spans x, thin in z (horizontal wall)
          wallH.insert(wallH.end(), {ex, H / 2.0f, ez, cs, H, wt, 0, 0, 0,
            1,0,0, 0,1,0, 0,0,1, (float)regType, 0.0f, 1.0f, (float)edgeCount});
        } else { // E/W wall: spans z, thin in x (vertical wall)
          wallE.insert(wallE.end(), {ex, H / 2.0f, ez, wt, H, cs, 0, 0, 0,
            1,0,0, 0,1,0, 0,0,1, (float)regType, 1.0f, 1.0f, (float)edgeCount});
        }
      }
    }
  }
}

void World::buildProps(const dc::Dungeon& d, std::vector<float>& wallProps,
                       const std::string& biome, std::uint32_t seed) const {
  const float cs = (float)d.cellSize;
  const float H = (float)dc::world::kWallHeight;
  // Wall props sit against exposed wall edges.
  // Ceiling props, floor patches, and debris have been removed (floating/static cosmetics).
  dc::Rng drng{seed ^ 0xDEADu};

  const bool isCave = (biome == "FUNGAL_CAVERN" || biome == "POISON_SWAMP" || biome == "VOLCANIC_DEPTHS");
  const bool isFrozen = (biome == "FROZEN_HALLS");
  const bool isTemple = (biome == "GOLDEN_TEMPLE");
  const bool isCrypt = (biome == "HAUNTED_CRYPT" || biome == "SPECTRAL_COURT");

  // ---- WALL PROPS: sconces, pillars, mushrooms, statues ----
  // Wall props are placed against exposed walls (boundary edges)
  for (int z = 0; z < d.gridSize; z++) {
    for (int x = 0; x < d.gridSize; x++) {
      if (d.grid[z][x] != dc::Cell::kEmpty) continue; // only wall surface cells
      // Check if this is an exposed edge (wall boundary)
      static const int kDirX[4] = {1, -1, 0, 0};
      static const int kDirZ[4] = {0, 0, 1, -1};
      for (int k = 0; k < 4; k++) {
        const int dx = kDirX[k], dz = kDirZ[k];
        const int nx = x + dx, nz = z + dz;
        const bool oob = nx < 0 || nz < 0 || nx >= d.gridSize || nz >= d.gridSize;
        if (!oob && d.grid[nz][nx] != dc::Cell::kEmpty) continue; // interior edge

        // Found an exposed wall cell - chance to place a prop
        const float prob = isTemple ? 0.04f : (isFrozen ? 0.03f : 0.025f); // props on walls
        if ((int)(drng.next() * 1.0) > prob * 100.0f) continue;

        const float wx = (float)(x * d.cellSize) + (float)(dx * d.cellSize) / 2.0f;
        const float wz = (float)(z * d.cellSize) + (float)(dz * d.cellSize) / 2.0f;
        const bool isNorth = (dz != 0); // N/S wall

        if (isTemple) {
          // Golden pillars on walls (ornate columns)
          const float pillarH = 3.0f + (float)drng.next() * 2.0f;
          const float pillarR = 0.15f + (float)drng.next() * 0.05f;
          const float pillarY = 0.2f + pillarH * 0.5f;
          const float gold = 0.7f + (float)drng.next() * 0.15f;
          const float prop = isNorth ? wz : wx;
          const float off = isNorth ? 0.0f : (float)dx;
          wallProps.insert(wallProps.end(), {prop, pillarY, wz, pillarR * 2.0f, pillarH, pillarR * 2.0f, gold, gold * 0.85f, gold * 0.3f, 0,0,0, 0,1,0, 0,0,1, 0.0f, 1.0f, 1.0f, 0.0f});
        } else if (isCrypt) {
          // Candle sconces on walls (small glowing spheres)
          const float sconceY = 1.5f + (float)drng.next() * 1.5f;
          const float sconceR = 0.08f + (float)drng.next() * 0.04f;
          const float prop = isNorth ? wz : wx;
          wallProps.insert(wallProps.end(), {prop, sconceY, wz, sconceR * 2.0f, sconceR * 2.0f, sconceR * 2.0f, 0.6f, 0.4f, 0.25f, 0,0,0, 0,1,0, 0,0,1, 0.0f, 1.0f, 1.0f, 0.0f});
        } else if (isFrozen) {
          // Ice formations on walls
          const float iceLen = 0.6f + (float)drng.next() * 1.5f;
          const float iceR = 0.06f + (float)drng.next() * 0.08f;
          const float iceY = H * 0.5f + (float)drng.next() * H * 0.3f;
          const float icCol = 0.65f + (float)drng.next() * 0.25f;
          const float prop = isNorth ? wz : wx;
          wallProps.insert(wallProps.end(), {prop, iceY, wz, iceR * 2.0f, iceLen, iceR * 2.0f, icCol, icCol, icCol + 0.05f, 0,0,0, 0,1,0, 0,0,1, 0.0f, 1.0f, 1.0f, 0.0f});
        } else {
          // Generic sconce/cracks on walls
          const float sconceY = 1.2f + (float)drng.next() * 2.0f;
          const float sconceW = 0.12f + (float)drng.next() * 0.1f;
          const float prop = isNorth ? wz : wx;
          const float col = 0.35f + (float)drng.next() * 0.15f;
          wallProps.insert(wallProps.end(), {prop, sconceY, wz, sconceW * 2.0f, sconceW * 2.0f, sconceW * 2.0f, col, col, col, 0,0,0, 0,1,0, 0,0,1, 0.0f, 1.0f, 1.0f, 0.0f});
        }
      }
    }
  }
}

void World::upload(const dc::Dungeon& d, const float cellCol[3], const float wallCol[3],
                   const float ceilCol[3], std::uint32_t seed, const std::string& biome) {
  dungeon = d;
  collision = buildCollisionBoxes(d);
  std::vector<float> floorInst, ceilInst, wallH, wallE;
  buildInstanceData(d, floorInst, ceilInst, wallH, wallE);
  // stamp colors (22-float stride: offset,scale,color,rot3x3,regionData)
  auto stamp = [&](std::vector<float>& v, const float c[3]) {
    for (size_t i = 0; i < v.size(); i += 22) { v[i + 6] = c[0]; v[i + 7] = c[1]; v[i + 8] = c[2]; }
  };
  stamp(floorInst, cellCol); stamp(ceilInst, ceilCol); stamp(wallH, wallCol); stamp(wallE, wallCol);
  nFloor = (int)(floorInst.size() / 22); nCeil = (int)(ceilInst.size() / 22);
  nWallH = (int)(wallH.size() / 22); nWallE = (int)(wallE.size() / 22);
  // ---- §13 biome-specific props (wall props only; ceiling props/floor patches/debris removed) ----
  std::vector<float> wallPropsInst;
  buildProps(d, wallPropsInst, biome, seed);

  nWallProps = (int)(wallPropsInst.size() / 22);

  auto mkVbo = [&](const std::vector<float>& v) -> GLuint {
    GLuint b = 0;
    glGenBuffers(1, &b);
    glBindBuffer(GL_ARRAY_BUFFER, b);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * sizeof(float)), v.data(), GL_STATIC_DRAW);
    return b;
  };
  instFloor = mkVbo(floorInst); instCeil = mkVbo(ceilInst);
  instWallH = mkVbo(wallH); instWallE = mkVbo(wallE);
  instWallProps = mkVbo(wallPropsInst);
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
  GLuint sceneFbo = 0, sceneTex = 0, sceneDepthRb = 0;
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

  // surface color uniforms for lit shader (set before drawGroup)
  float uSurfaceColorR = -1.0f, uSurfaceColorG = -1.0f, uSurfaceColorB = -1.0f;

  // §13 Atmospheric particles: 50 instances (pos3 + type1 + per-biome color).
  float atmoPos[50][3];  // world-space position
  float atmoType[50];    // 0=ember, 1=snow, 2=spore, 3=crystal_dust
  float atmoColor[3];    // per-biome color (set in buildWorldFromState)

  // player transform (yaw/pitch are in state.player; camera pos mirrors it)
  double camX = 0, camY = kEyeHeight, camZ = 0;
  float fov = (float)camera::kFov;

  // viewProj matrix (from frame) for 3D→screen projection
  float viewProjM[16] = {};

  // health bar screen positions (computed in _computeHpBars(), drawn in drawHud)
  struct HpBarPos { float sx, sy, frac; };
  std::vector<HpBarPos> bossHpBar;
  std::vector<HpBarPos> enemyHpBars;

  // input (GLFW physical key codes — AZERTY-safe: bind by position)
  bool keyW = false, keyS = false, keyA = false, keyD = false, keyShift = false;
  bool keyLMB = false, keyRMB = false;
  bool keyE = false;
  bool keyN = false, keyY = false, keyL = false; // title / death bookends + Load
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
  // Electric chain visuals (§16.4): screen flash + lightning arcs
  double flashT = 0;             // >0 = white flash fading out
  std::array<double, 30> arcX{}; // segment start X (6 segments × 5 pairs)
  std::array<double, 30> arcY{}; // segment start Y
  std::array<double, 30> arcZ{}; // segment start Z
  std::array<double, 30> arcEx{};// segment end X
  std::array<double, 30> arcEy{};// segment end Y
  std::array<double, 30> arcEz{};// segment end Z
  int arcCount = 0;              // how many segments active
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
  GLuint progSmoke = 0, progDust = 0, progRune = 0, progWater = 0, progAtmo = 0;
  GLuint smokeVao = 0, smokeVbo = 0, smokeQuad = 0;
  GLuint dustVao = 0, dustVbo = 0, dustQuad = 0;
  GLuint runeVao = 0, runeVbo = 0, runeEbo = 0, runeInst = 0;
  GLuint waterVao = 0, waterVbo = 0, waterEbo = 0, waterInst = 0;
  GLuint atmoVao = 0, atmoVbo = 0, atmoQuad = 0;
  GLuint runeAtlas = 0;
  bool playerDead = false;
  bool bossKillCounted = false;
  bool phase1Defeated = false; // phase 1 boss has been killed, awaiting phase 2
  double phase2Timer = 0;    // countdown timer to spawn phase 2
  int bossPhase = 1;         // current boss phase (1 or 2)
  bool phase1BossDead = false; // phase 1 boss is actually dead (for dimming)
  bool probeInvuln = false; // --hud-view probe: keep the play screen (not death)
  bool bossPortalOpen = false; // open when !bossLevel, or on boss defeat
  bool prevE = false;
  int  dungeonSeed = 0;        // per-level seed (JS Date.now()^rand, re-rolled per level)
  int  seed = 1000;            // CLI --seed (title-run seed)

  // ---- text / screens (title + death) ----
  Font font;
  Font menuFont;  // URW Bookman Blackletter: old-style serif for menu/leaderboard (Dark Souls vibe)
  GLuint progText = 0, textVbo = 0, textVao = 0;
  GLuint progTextMenu = 0, textMenuVbo = 0, textMenuVao = 0;
  GLuint progOverlay = 0;
  GLuint progRect = 0, rectVbo = 0, rectVao = 0;

  // ---- save + leaderboard (JS localStorage → JSON files, §23) ----
  std::string ledgerPath = "leaderboard.json";
  std::string saveFile = "save.json";
  std::unique_ptr<dc::Leaderboard> leaderboard;
  bool saveWritten = false; // save-for-later already written at death
  enum class Screen { Title, Play, Dead };
  Screen screen = Screen::Play;
  bool prevN = false, prevY = false, prevL = false, prevS = false;
  const char* deathReason = "dead"; // "dead" (killed) | "time" (timer ran out)
  std::optional<dc::GameState::Save> savedRun; // save-for-later available (Load [L])
  std::optional<std::int64_t> lastRunDate; // ms epoch from last _endRun (for rankOf lookup)

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
  struct Orb { double x=0,y=0,z=0,vx=0,vy=0,vz=0,life=-1,dmg=1; int step=1; bool alive=false; int bounces=0; };
  std::vector<Orb> orbs;        // pooled (POOL_NORMAL 48)
  int  orbSeqStep = 0;         // 0 idle; 1..3 in a 3-step sequence
  double orbSeqLast = -1e9;    // last fire time (s) for the sequence window
  double lmbAccum = 0;
  bool prevLMB = false, prevRMB = false;
  bool prevTitleLMB = false; // title "New Game" edge (mouse)

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
  void recreateWindowTargets(); // resize: realloc window-sized FBOs (scene/bright/glow)
  void toggleFullscreen();      // F11: windowed <-> native fullscreen
  bool fullscreen = false;
  GLFWmonitor* monitor = nullptr;
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
  void hitBoss(double dmg, const char* src, const dc::Vec2& playerPos);
  void orbExplode(const Orb& o);
  void uploadDynamic(std::vector<float>& dyn, std::vector<float>& enem);
  // §13 decorative systems
  void buildDecor();        // per-level: dust positions, rune quads, water pools
  void updateDecor(double dt); // per-frame: smoke rise/fade, dust drift
  void smokePuff(float x, float y, float z);
  void update(double dt, double rawDt);
  void frame();
  void drawGroup(GLuint instVbo, int count, float emissive = 0.0f, int strideBytes = 88);
  void savePPM(const char* path);
  void bakeFont(const char* path);
  float lineW(const char* s, float size);
  void drawTextLine(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s);
  // Readable outlined text: dark 4-way outline + soft drop shadow behind the fill.
  void drawTextOutline(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s);
  void drawText(const std::vector<float>& v);
  float menuLineW(const char* s, float size);
  void drawTextLineMenu(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s);
  void drawTextOutlineMenu(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s);
  void drawTextMenu(const std::vector<float>& v);
  void drawRects(const std::vector<float>& v);
  void drawOverlay(float r, float g, float b, float a);
  void drawHud();
  void drawLeaderboard(double cyOffset, int topN, const float col[3], std::vector<float>& v, std::vector<float>& vMenu, float cx);
  void _endRun(const char* reason);
  // Save-for-later: write the current run to save.json (death + manual [S]).
  void _writeSave();
  void loadRun();             // Load [L]: restore the save-for-later (full-health level)
  bool _readSaveFile();       // load save.json into `savedRun` (true if present)
  void startRun(int seedToUse);
  void _computeHpBars();      // §4.5: project enemy/boss HP onto screen coords
  // New Game+: 25% soul toll, start at max(1, floor(level/2)), carry
  // bossKills/maxHealth/runTime, recalc weapon tier from the kept bank.
  void _ngPlus();
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
  world.upload(world.dungeon, cellCol, wallCol, ceilCol, (std::uint32_t)state.dungeonSeed, state.biome);
  fogColor[0] = L.fogColor[0]; fogColor[1] = L.fogColor[1]; fogColor[2] = L.fogColor[2];
  fogDensity = L.fogDensity;
  ambientCol[0] = L.ambientCol[0]; ambientCol[1] = L.ambientCol[1]; ambientCol[2] = L.ambientCol[2];
  // Phase 1 death: dim the dungeon by 60% for dramatic effect
  if (phase1BossDead) {
    ambientCol[0] *= 0.4f; ambientCol[1] *= 0.4f; ambientCol[2] *= 0.4f;
  }
  torchColor[0] = L.torchCol[0]; torchColor[1] = L.torchCol[1]; torchColor[2] = L.torchCol[2];
  torchIntensity = L.torchIntensity;
  if (phase1BossDead) torchIntensity *= 0.4f;
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

  // §13 Atmospheric particles: 50 instances, biome-specific.
  {
    const bool isEmber = (state.biome == "EMBER_FORGE");
    const bool isFrozen = (state.biome == "FROZEN_HALLS");
    const bool isCrystal = (state.biome == "CRYSTAL_DEPTHS");
    const bool isFungal = (state.biome == "FUNGAL_CAVERN");
    const bool isFlooded = (state.biome == "FLOODED_RUINS");
    const bool isCrypt = (state.biome == "HAUNTED_CRYPT" || state.biome == "SPECTRAL_COURT");
    const bool isCave = (state.biome == "POISON_SWAMP" || isFungal);
    const bool isTemple = (state.biome == "GOLDEN_TEMPLE");

    // Set per-biome color
    if (isEmber) { atmoColor[0] = 0.9f; atmoColor[1] = 0.3f; atmoColor[2] = 0.1f; }
    else if (isFrozen) { atmoColor[0] = 0.7f; atmoColor[1] = 0.85f; atmoColor[2] = 1.0f; }
    else if (isCrystal) { atmoColor[0] = 0.7f; atmoColor[1] = 0.5f; atmoColor[2] = 1.0f; }
    else if (isFungal) { atmoColor[0] = 0.3f; atmoColor[1] = 0.8f; atmoColor[2] = 0.3f; }
    else if (isFlooded) { atmoColor[0] = 0.2f; atmoColor[1] = 0.6f; atmoColor[2] = 0.8f; }
    else if (isCrypt) { atmoColor[0] = 0.4f; atmoColor[1] = 0.6f; atmoColor[2] = 0.9f; }
    else if (isTemple) { atmoColor[0] = 1.0f; atmoColor[1] = 0.85f; atmoColor[2] = 0.3f; }
    else { atmoColor[0] = 0.5f; atmoColor[1] = 0.5f; atmoColor[2] = 0.6f; }

    for (int i = 0; i < 50; i++) {
      // Place particles randomly around the dungeon rooms
      int ri = (int)(drng.next() * (d.gridSize * d.gridSize));
      int ridx = ri % ((int)d.gridSize * (int)d.gridSize);
      int rz = ridx / d.gridSize, rx = ridx % d.gridSize;
      if (d.grid[rz][rx] == dc::Cell::kEmpty) {
        // Place near a wall cell
        atmoPos[i][0] = (float)rx * cs + cs * 0.5f;
        atmoPos[i][2] = (float)rz * cs + cs * 0.5f;
        atmoPos[i][1] = 1.0f + (float)drng.next() * 5.0f;
      } else {
        atmoPos[i][0] = (float)rx * cs + cs * 0.5f;
        atmoPos[i][2] = (float)rz * cs + cs * 0.5f;
        atmoPos[i][1] = 0.3f + (float)drng.next() * 5.0f;
      }
      // Assign particle type based on biome
      if (isEmber) atmoType[i] = 0.0f;       // ember
      else if (isFrozen) atmoType[i] = 1.0f; // snow
      else if (isFungal) atmoType[i] = 2.0f; // spore
      else if (isCrystal) atmoType[i] = 3.0f; // crystal dust
      else atmoType[i] = 1.0f;               // default: snow
    }
  }

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

  // Water (VAULT rooms only, 45% room size, cap kWaterPools=24).
  waterData.clear();
  for (const dc::Room& r : d.rooms) {
    if (r.type != "VAULT") continue;
    if ((int)waterData.size() / 6 >= dc::props::kWaterPools) break;
    const float cx = (float)(r.cx + (r.w - 1) / 2) * cs;
    const float cz = (float)(r.cz + (r.h - 1) / 2) * cs;
    waterData.insert(waterData.end(), {
        cx, 0.35f, cz,                        // above floor (avoids z-fight, floor spans y=-0.1..0.3)
        (float)(r.w * cs * 0.45), (float)(r.h * cs * 0.45),
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
  // Phase 2 reset
  bossPhase = 1;
  phase1Defeated = false;
  phase2Timer = 0;
  phase1BossDead = false;
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
    boss = dc::Boss::spawn(world.dungeon, level, state.ngPlus,
                           state.collectedOrbs, skelsys.excessHpMult(), variant);
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
  // Buffs carry through the exit portal and their countdown resets to full
  // (ruling: "Buffs should be kept and their countdown reset when using an
  // exit portal" — supersedes the JS fresh-GameState parity).
  if (state.buffEffect > 0) state.buffTime = dc::buff::kMaxDuration;
  // The HUNTER companion walks through the portal with the player: no reset.
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
  else if (hunter.active && state.buffEffect != 0) hunter.reset(); // replace hunter with other buffs
  else if (hunter.active) hunter.reset();
  if (hunter.active) {
    std::vector<dc::Enemy*> live;
    for (auto& e : skelsys.enemies()) if (e.alive()) live.push_back(&e);
    // Collect live breakables for the hunter to target
    std::vector<dc::Breakable*> liveBr;
    for (auto& br : drops.breakables()) if (br.alive) liveBr.push_back(&br);
    const auto& boxes = world.collision.boxes;
    hunter.update(dt, pp, live, liveBr,
                 [&](const dc::Vec2& a, const dc::Vec2& b) {
                   return dc::hasLineOfSight(boxes, a.x, a.z, b.x, b.z);
                 },
                 [&](dc::Enemy* e) { skelsys.hitEnemy(e, (int)(dc::hunter::kBeamDmg * dc::ngPlusDamageMult(state.ngPlus)), "beam", {state.player.x, state.player.z}); },
                 [&](dc::Breakable* br) { drops.breakProp(*br, state.collectedOrbs, rng); },
                 state.collectedOrbs);
    // VISIBLE ANCHOR: use `pos` directly — the sim already follows the player.
    // No longer park to a fixed side offset; the hunter tracks behind the player.
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
  // Phase 1 death: trigger phase 2 transition (dim dungeon, 5s delay)
  if (boss.dead && !bossKillCounted) {
    bossKillCounted = true;
    if (bossPhase == 1 && !phase1Defeated) {
      // Phase 1 defeated: dim dungeon, start 5s countdown for phase 2
      phase1Defeated = true;
      phase1BossDead = true;
      phase2Timer = 5.0; // 5 second delay
    }
  }
  // Phase 2 spawn countdown
  if (phase1Defeated && !boss.dead) {
    phase2Timer -= dt;
    if (phase2Timer <= 0 && !phase1BossDead) {
      // Spawn phase 2 boss after delay
      static const char* kVariants[7] = {"Skeleton", "Armored", "Archer", "Brute", "Wraith", "Rat", "Magician"};
      const char* variant = kVariants[(state.level / dc::boss::kInterval - 1) % 7];
      boss.spawnPhase2(world.dungeon, state.level, state.ngPlus, state.collectedOrbs,
                       skelsys.excessHpMult(), variant);
      bossPhase = 2;
      phase1Defeated = false;
      phase1BossDead = false;
    }
  }
  // Phase 2 death: only grant power upgrade + heart, no buff/souls/portal
  if (boss.dead && bossKillCounted && bossPhase == 2 && !phase1Defeated) {
    phase1Defeated = true; // mark as defeated (phase 2 final)
    // Grant power upgrade + heart only (no buff, no souls, no portal)
    state.maxHealth += 1;
    state.health = state.maxHealth;
    simHealth = state.maxHealth;
    const int reward = state.level * std::max(1, state.ngPlus);
    state.collectedOrbs += reward;
    state.weaponTier = dc::weaponTier(state.collectedOrbs);
    // Phase 2 final: still open portal so player can descend
    bossPortalOpen = true;
  }
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

  // ---- advance orb projectiles (with bounce) ----
  // World geometry: floor slab top at y=0.2, ceiling slab bottom at y=kWallHeight-0.2.
  // Orbs bounce off floor/ceiling (vertical) and walls (horizontal, 2D circle-vs-AABB)
  // with a restitution coefficient. After kMaxOrbBounces they stop bouncing (slide).
  {
    const double kRestitution = 0.78;   // energy kept per bounce
    const double kOrbR = 0.15;          // half the 0.3 render scale
    const double floorY = 0.2 + kOrbR;
    const double ceilY  = (double)dc::world::kWallHeight - 0.2 - kOrbR;
    const int kMaxOrbBounces = 3;
    const auto& boxes = world.collision.boxes;
    for (auto& o : orbs) {
      if (!o.alive) continue;
      o.life -= dt;
      if (o.life <= 0) { if (o.step == 3) orbExplode(o); o.alive = false; continue; }
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;

      // ---- vertical bounces (floor / ceiling) ----
      if (o.y < floorY) {
        o.y = floorY;
        if (o.vy < 0) o.vy = -o.vy * kRestitution;
        if (o.bounces < kMaxOrbBounces) o.bounces++;
      } else if (o.y > ceilY) {
        o.y = ceilY;
        if (o.vy > 0) o.vy = -o.vy * kRestitution;
        if (o.bounces < kMaxOrbBounces) o.bounces++;
      }

      // ---- horizontal wall bounces (2D circle vs AABB) ----
      if (o.bounces < kMaxOrbBounces) {
        for (const auto& b : boxes) {
          const double cx = std::max(b.minX, std::min(o.x, b.maxX));
          const double cz = std::max(b.minZ, std::min(o.z, b.maxZ));
          double dx = o.x - cx, dz = o.z - cz;
          const double d2 = dx * dx + dz * dz;
          if (d2 >= kOrbR * kOrbR) continue;
          if (d2 < 1e-9) { dx = 1; dz = 0; } // center inside: push out on X
          const double d = std::sqrt(d2);
          const double nx = dx / d, nz = dz / d; // wall normal (toward orb)
          o.x = cx + nx * kOrbR; o.z = cz + nz * kOrbR;
          const double vdot = o.vx * nx + o.vz * nz;
          if (vdot < 0) { o.vx -= 2 * vdot * nx; o.vz -= 2 * vdot * nz; }
          // restitution dampen
          o.vx *= kRestitution; o.vz *= kRestitution;
          o.bounces++;
          break; // one wall per frame
        }
      }

      bool hit = false;
      if (bossReady && !boss.dead) {
        const double db = std::hypot(o.x - boss.pos.x, o.z - boss.pos.z);
        if (db < 1.5) { hitBoss(o.dmg, "orb", {state.player.x, state.player.z}); hit = true; }
      }
      if (!hit) {
        for (dc::Enemy* e : skelsys.nearby(o.x, o.z, 0.6)) {
          skelsys.hitEnemy(e, o.dmg, "orb", {state.player.x, state.player.z}); hit = true; break;
        }
      }
      // Destroy breakables (crates/barrels) on hit — fireballs use same pool
      if (!hit) {
        for (auto& br : drops.breakables()) {
          if (!br.alive) continue;
          const double dx = o.x - br.pos.x, dz = o.z - br.pos.z;
          if (dx * dx + dz * dz < 1.0 * 1.0) { drops.breakProp(br, state.collectedOrbs, rng); hit = true; break; }
        }
      }
      if (hit) { if (o.step == 3) orbExplode(o); o.alive = false; }
    }
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
  const double dmgMult = dc::damageMult(scale, tier, state.level, (int)souls) * dc::ngPlusDamageMult(state.ngPlus);
  const double dmg = dmgBase * dmgMult;
  auto inCone = [&](double ex, double ez) {
    double tx = ex - ox, tz = ez - oz;
    double d = std::hypot(tx, tz);
    if (d > range + 0.5) return false;
    tx /= d; tz /= d;
    return (dirx * tx + dirz * tz) >= arcDot;
  };
  if (bossReady && !boss.dead && inCone(boss.pos.x, boss.pos.z)) { hitBoss(dmg, "sword", {state.player.x, state.player.z}); hitCount++; }
  for (dc::Enemy* e : skelsys.nearby(ox, oz, range + 0.5))
    if (inCone(e->pos.x, e->pos.z)) { skelsys.hitEnemy(e, dmg, "sword", {state.player.x, state.player.z}); hitCount++; }
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
    const double blast = dc::sword::kElectricDamageMult * (1.0 + 0.02 * souls) * 2.0 * dc::ngPlusDamageMult(state.ngPlus); // ×5 orb dmg × NG+
    int count = 0;
    if (bossReady && !boss.dead &&
        std::hypot(boss.pos.x - px, boss.pos.z - pz) < dc::sword::kElectricRange) {
      hitBoss(blast, "electric", {state.player.x, state.player.z}); count++;
    }
    for (dc::Enemy* e : skelsys.nearby(px, pz, dc::sword::kElectricRange)) {
      if (!e->alive()) continue;
      skelsys.hitEnemy(e, blast, "electric", {state.player.x, state.player.z}); count++;
    }
    if (count > 0) {
      hitStop = dc::hitStop::electricChain; // 0.12 s (JS sets, not max)
      char buf[64];
      std::snprintf(buf, sizeof(buf), "ELECTRIC CHAIN — %d foes blasted!", count);
      toast(buf);
      flashT = 0.25; // bright white flash, lasts 0.25 s
      // Fire multiple firePatches at hit locations (player + each target)
      for (int i = 0; i < 3 && !firePatches.empty(); ++i) {
        FirePatch& p = firePatches[firePatchIdx];
        firePatchIdx = (firePatchIdx + 1) % (int)firePatches.size();
        // Spread patches: player + offsets
        const double ox = (i - 1) * 1.5;
        const double oz = (i % 2) * 2.0 - 1.0;
        p.x = px + ox; p.z = pz + oz; p.t = 0; p.active = true;
      }
      // Build lightning arc segments from player to each nearby hit target
      arcCount = 0;
      // Arc to boss
      if (bossReady && !boss.dead &&
          std::hypot(boss.pos.x - px, boss.pos.z - pz) < dc::sword::kElectricRange) {
        if (arcCount < (int)arcX.size()) {
          arcX[arcCount] = px; arcY[arcCount] = 1.2; arcZ[arcCount] = pz;
          arcEx[arcCount] = boss.pos.x; arcEy[arcCount] = 1.2; arcEz[arcCount] = boss.pos.z;
          arcCount++;
        }
      }
      for (dc::Enemy* e : skelsys.nearby(px, pz, dc::sword::kElectricRange)) {
        if (!e->alive() || arcCount >= (int)arcX.size()) continue;
        arcX[arcCount] = px; arcY[arcCount] = 1.2; arcZ[arcCount] = pz;
        arcEx[arcCount] = e->pos.x; arcEy[arcCount] = 1.2; arcEz[arcCount] = e->pos.z;
        arcCount++;
      }
      // Add zigzag segments for drama (split each arc into 3 jagged segments)
      int origCount = arcCount;
      for (int i = origCount - 1; i >= 0; i--) {
        if (arcCount + 2 >= (int)arcX.size()) break;
        const double sx = arcX[i], sy = arcY[i], sz = arcZ[i];
        const double ex = arcEx[i], ey = arcEy[i], ez = arcEz[i];
        // 2 intermediate zigzag points
        for (int j = 1; j <= 2; ++j) {
          const double t = (double)j / 3.0;
          double mx = sx + (ex - sx) * t;
          double my = 0.5 + 0.7 * (1.0 - t); // arch up
          double mz = sz + (ez - sz) * t;
          // Offset perpendicular to direction for jagged look
          double dx = ex - sx, dz = ez - sz;
          double len = std::hypot(dx, dz);
          if (len > 0.01) {
            double px2 = -dz / len * (0.3 + 0.5 * ((i * 7 + j * 13) % 10) / 10.0);
            double pz2 = dx / len * (0.3 + 0.5 * ((i * 7 + j * 13) % 10) / 10.0);
            mx += px2; mz += pz2;
          }
          arcX[arcCount] = mx - (ex - mx) * 0.0; // keep as start
          arcY[arcCount] = my;
          arcZ[arcCount] = mz;
          arcEx[arcCount] = ex; arcEy[arcCount] = ey; arcEz[arcCount] = ez;
          // Actually: start at intermediate, end at next intermediate
          if (arcCount + 1 < (int)arcX.size()) {
            double nx = sx + (ex - sx) * (j + 1) / 3.0;
            double ny = 0.5 + 0.7 * (1.0 - (j + 1) / 3.0);
            double nz = sz + (ez - sz) * (j + 1) / 3.0;
            double ndx = nx - sx, ndz = nz - sz;
            double nlen = std::hypot(ndx, ndz);
            if (nlen > 0.01) {
              double npx = -ndz / nlen * (0.3 + 0.5 * ((i * 7 + j * 17) % 10) / 10.0);
              double npz = ndx / nlen * (0.3 + 0.5 * ((i * 7 + j * 17) % 10) / 10.0);
              nx += npx; nz += npz;
            }
            arcX[arcCount] = mx; arcY[arcCount] = my; arcZ[arcCount] = mz;
            arcEx[arcCount] = nx; arcEy[arcCount] = ny; arcEz[arcCount] = nz;
            arcCount++;
          }
        }
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
  const int dmg = static_cast<int>(std::round(dc::orbDirectDamage(state.collectedOrbs) * dc::ngPlusDamageMult(state.ngPlus))); // frozen at fire time
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
      if (kind == 1) hitBoss(b.dmg, "arcBolt", {state.player.x, state.player.z});
      else {
        if (idx < (int)skelsys.enemies().size())
          skelsys.hitEnemy(&skelsys.enemies()[idx], b.dmg, "arcBolt", {state.player.x, state.player.z});
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
  // aim = camera forward: Y is -sin(pitch) (matches the look-at, item 5)
  const double dirx = -std::sin(yaw) * cp, dirz = -std::cos(yaw) * cp, diry = -std::sin(pitch);
  Orb o;
  o.x = state.player.x + dirx * 0.6; o.y = camY + diry * 0.6; o.z = state.player.z + dirz * 0.6;
  o.vx = dirx * dc::orbWeapon::kSpeed; o.vy = diry * dc::orbWeapon::kSpeed; o.vz = dirz * dc::orbWeapon::kSpeed;
  o.life = dc::orbWeapon::kLife; o.step = step; o.alive = true;
  const double soulsAmt = state.collectedOrbs;
  o.dmg = step == 3 ? static_cast<int>(std::round(dc::orbExplodeDamage(soulsAmt) * dc::ngPlusDamageMult(state.ngPlus))) : static_cast<int>(std::round(dc::orbDirectDamage(soulsAmt) * dc::ngPlusDamageMult(state.ngPlus)));
  orbs.push_back(o);
}
void App::hitBoss(double dmg, const char* src, const dc::Vec2& playerPos) {
  if (bossReady && !boss.dead) boss.hitBoss(dmg, src, playerPos);
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
  // aim = camera forward: Y is -sin(pitch) (matches the look-at, item 5)
  const double dirx = -std::sin(yaw) * cp, dirz = -std::cos(yaw) * cp, diry = -std::sin(pitch);
  Orb o;
  o.x = state.player.x + dirx * 0.6; o.y = camY + diry * 0.6; o.z = state.player.z + dirz * 0.6;
  o.vx = dirx * dc::orbWeapon::kSpeed; o.vy = diry * dc::orbWeapon::kSpeed; o.vz = dirz * dc::orbWeapon::kSpeed;
  o.life = dc::orbWeapon::kLife; o.step = 3; o.alive = true;
  o.dmg = static_cast<int>(std::round(dc::orbExplodeDamage(state.collectedOrbs) * dc::ngPlusDamageMult(state.ngPlus)));
  orbs.push_back(o);
}
void App::orbExplode(const Orb& o) {
  if (bossReady && !boss.dead && std::hypot(o.x - boss.pos.x, o.z - boss.pos.z) < 2.0) hitBoss(o.dmg, "explosion", {state.player.x, state.player.z});
  for (dc::Enemy* e : skelsys.nearby(o.x, o.z, 2.0)) skelsys.hitEnemy(e, o.dmg, "explosion", {state.player.x, state.player.z});
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
  // 18-float instance: offset(3) scale(3) color(3) rot(3x3, column-major).
  // rot orients the box (see kLitVert). push() builds rot from the classic
  // yaw/pitch (identical to the old shader); pushM() takes a full 3x3 so the
  // sword can carry its base-tilt + swing as ONE rigid rotation. 0,0 = identity.
  auto yawPitchMat = [](float yaw, float pitch) {
    const float cy = std::cos(yaw), sy = std::sin(yaw), cp = std::cos(pitch), sp = std::sin(pitch);
    return std::array<float, 9>{
        cy, 0.0f, -sy,
        -sy * sp, cp, -cy * sp,
        sy * cp, sp, cy * cp};
  };
  auto push = [&](float ox, float oy, float oz, float sx, float sy, float sz,
                  float r, float g, float b, float yaw = 0.0f, float pitch = 0.0f) {
    const auto m = yawPitchMat(yaw, pitch);
    dyn.insert(dyn.end(), {ox, oy, oz, sx, sy, sz, r, g, b});
    dyn.insert(dyn.end(), m.begin(), m.end());
  };
  // full-matrix push (sword): m is a column-major 3x3 (9 floats).
  auto pushM = [&](float ox, float oy, float oz, float sx, float sy, float sz,
                   float r, float g, float b, const float m[9]) {
    dyn.insert(dyn.end(), {ox, oy, oz, sx, sy, sz, r, g, b});
    dyn.insert(dyn.end(), m, m + 9);
  };
  // §12.2 enemy-only push: same 18-float layout, appended to enem for the glow mask
  auto epush = [&](float ox, float oy, float oz, float sx, float sy, float sz,
                   float r, float g, float b, float yaw = 0.0f, float pitch = 0.0f) {
    const auto m = yawPitchMat(yaw, pitch);
    enem.insert(enem.end(), {ox, oy, oz, sx, sy, sz, r, g, b});
    enem.insert(enem.end(), m.begin(), m.end());
  };
  // boss (glowing SPECTRAL_COURT accent ~0xaa88ff) — multi-part spectral figure:
  //      floating crown, head, broad torso, arms, lower robe, pulsing aura ring,
  //      facing the player. Feet at floor (y≈0.2); parts pulse while awake.
  if (bossReady && !boss.dead) {
    const float bt = (float)std::sin(state.runTime * 6.0);
    const float bs = 1.0f + 0.1f * bt; // global pulse scale
    const float bx = (float)boss.pos.x, bz = (float)boss.pos.z;
    const float byaw = std::atan2((float)state.player.x - bx,
                                  (float)state.player.z - bz);
    const float bcy = std::cos(byaw), bsy = std::sin(byaw);
    auto BL = [&](float px, float py, float pz, float& ox, float& oy, float& oz) {
      ox = bx + px * bcy + pz * bsy;
      oy = 0.2f + py;
      oz = bz - px * bsy + pz * bcy;
    };
    // palette (SPECTRAL_COURT ~0xaa88ff core, 0x403862 shadow)
    const float kR = 0.66f, kG = 0.53f, kB = 1.0f;
    const float kSR = 0.25f, kSG = 0.18f, kSB = 0.35f; // shadow
    // aura ring (flat disc, pulsing)
    {
      float ox, oy, oz;
      BL(0, 0.05f, 0, ox, oy, oz);
      push(ox, oy, oz, 1.7f * bs, 0.08f, 1.7f * bs, kSR, kSG, kSB);
    }
    // lower robe (wide, tall)
    {
      float ox, oy, oz;
      BL(0, 0.9f * bs, 0, ox, oy, oz);
      push(ox, oy, oz, 1.4f * bs, 1.8f * bs, 1.4f * bs, 0.45f, 0.34f, 0.72f);
    }
    // torso (broad chest)
    {
      float ox, oy, oz;
      BL(0, 1.9f * bs, 0, ox, oy, oz);
      push(ox, oy, oz, 1.8f * bs, 1.1f * bs, 1.2f * bs, kR, kG, kB);
    }
    // arms (raised, splayed)
    {
      float ox, oy, oz;
      BL(-1.1f * bs, 1.9f * bs, 0.2f, ox, oy, oz);
      push(ox, oy, oz, 0.3f, 1.1f, 0.3f, 0.5f, 0.38f, 0.8f);
      BL(1.1f * bs, 1.9f * bs, 0.2f, ox, oy, oz);
      push(ox, oy, oz, 0.3f, 1.1f, 0.3f, 0.5f, 0.38f, 0.8f);
    }
    // head
    {
      float ox, oy, oz;
      BL(0, 2.8f * bs, 0, ox, oy, oz);
      push(ox, oy, oz, 0.7f * bs, 0.7f * bs, 0.7f * bs, 0.8f, 0.68f, 1.0f);
    }
    // floating crown (hovers above head, bobbing)
    {
      float ox, oy, oz;
      const float crownY = 3.4f * bs + 0.15f * std::sin(state.runTime * 3.0);
      BL(0, crownY, 0, ox, oy, oz);
      push(ox, oy, oz, 0.9f * bs, 0.18f, 0.9f * bs, 1.0f, 0.85f, 0.4f);
    }
  } else if (bossReady) {
    push((float)boss.pos.x, 0.4f, (float)boss.pos.z, 1.4f, 0.2f, 1.4f, 0.4f, 0.3f, 0.5f); // corpse
  }
  // ---- full enemy roster — multi-part spectral figures (head/torso/limbs),
  //      each part an instanced box; the enemy yaws to face the player.
  //      Part offsets are given in the enemy's local frame (y up, FRONT = +Z)
  //      and composed into world here; the per-instance yaw then rotates each
  //      part's box about its own center. Feet sit at the floor (y≈0.2). ----
  for (const auto& e : skelsys.enemies()) {
    if (e.state == dc::EnemyState::kDead) continue;
    float sx = 0.6f, sy = 1.7f, sz = 0.6f; // torso dims (per-branch)
    const float ex = (float)e.pos.x, ez = (float)e.pos.z;
    const float yaw = (float)e.facing;
    const float cyaw = std::cos(yaw), syaw = std::sin(yaw);
    // local→world (enemy space: y up, front +Z)
    auto L = [&](float px, float py, float pz, float& ox, float& oy, float& oz) {
      ox = ex + px * cyaw + pz * syaw;
      oy = 0.2f + py; // floor slab top
      oz = ez - px * syaw + pz * cyaw;
    };
    // walk bob: feet-driven, per-enemy phase so the pack doesn't move in lockstep
    const float phase = e.id * 0.7f + (float)e.pos.x * 0.13f;
    const float bob = 0.05f * std::sin(state.runTime * 7.0f + phase) *
                      (e.state == dc::EnemyState::kChase ? 1.0f : 0.3f);
    // attack lunge: torso leans toward the player during windup/swing
    const float lunge = (e.attackPhase == 1) ? 0.18f : (e.attackPhase == 2 ? 0.3f : 0.0f);
    float R2, G2, B2; // part color (hit-flash brightens everything)
    const float hitB = 1.0f + e.hitFlash * 1.5f;
    auto tint = [&](float cr, float cg, float cb, float& rr, float& gg, float& bb) {
      rr = std::min(1.0f, cr * hitB); gg = std::min(1.0f, cg * hitB); bb = std::min(1.0f, cb * hitB);
    };
    const float sc = (float)(e.eliteScale * (1.0 + e.hitFlash * 0.3));
    const float f2 = 0.0f; // (unused; keeps lambdas readable)
    (void)f2;
    if (e.type == "MAGICIAN") {
      // robed caster: tall robe (2-part), hood, staff with a floating tip
      float ox, oy, oz;
      tint(0.45f, 0.32f, 0.62f, R2, G2, B2); // robe lower
      L(-lunge * 0.3f, 0.55f, 0.0f, ox, oy, oz);
      push(ox, oy, oz, 0.5f * sc, 1.1f * sc, 0.5f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.5f * sc, 1.1f * sc, 0.5f * sc, R2, G2, B2, yaw);
      tint(0.55f, 0.4f, 0.75f, R2, G2, B2); // robe upper + hood
      L(-lunge * 0.5f, 1.45f + bob, 0.05f, ox, oy, oz);
      push(ox, oy, oz, 0.42f * sc, 0.7f * sc, 0.42f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.42f * sc, 0.7f * sc, 0.42f * sc, R2, G2, B2, yaw);
      tint(0.85f, 0.8f, 1.0f, R2, G2, B2); // hood
      L(-lunge * 0.6f, 1.95f + bob, 0.0f, ox, oy, oz);
      push(ox, oy, oz, 0.34f * sc, 0.3f * sc, 0.34f * sc, R2, G2, B2, yaw);
      tint(0.35f, 0.3f, 0.45f, R2, G2, B2); // staff shaft
      L(0.28f, 1.0f, 0.12f, ox, oy, oz);
      push(ox, oy, oz, 0.05f, 2.0f * sc, 0.05f, R2, G2, B2, yaw);
      tint(0.9f, 0.8f, 1.0f, R2, G2, B2); // staff orb (floats, pulses)
      L(0.28f, 2.1f + 0.05f * std::sin(state.runTime * 3.0f + phase), 0.12f, ox, oy, oz);
      push(ox, oy, oz, 0.14f, 0.14f, 0.14f, R2, G2, B2, yaw);
    } else if (e.type == "ARMORED") {
      // heavy: broad shoulders, helmet with a glowing visor slit
      sx = 0.9f; sy = 1.8f; sz = 0.9f;
      float ox, oy, oz;
      tint(0.45f, 0.47f, 0.52f, R2, G2, B2); // torso
      L(-lunge * 0.4f, 0.9f, 0.0f, ox, oy, oz);
      push(ox, oy, oz, sx * sc, 1.0f * sc, sz * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, sx * sc, 1.0f * sc, sz * sc, R2, G2, B2, yaw);
      tint(0.5f, 0.52f, 0.58f, R2, G2, B2); // pauldrons
      L(-lunge * 0.5f, 1.55f, 0.3f, ox, oy, oz); push(ox, oy, oz, 0.3f * sc, 0.28f * sc, 0.34f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.3f * sc, 0.28f * sc, 0.34f * sc, R2, G2, B2, yaw);
      L(-lunge * 0.5f, 1.55f, -0.3f, ox, oy, oz); push(ox, oy, oz, 0.3f * sc, 0.28f * sc, 0.34f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.3f * sc, 0.28f * sc, 0.34f * sc, R2, G2, B2, yaw);
      tint(0.55f, 0.57f, 0.63f, R2, G2, B2); // helmet
      L(-lunge * 0.55f, 1.95f + bob, 0.05f, ox, oy, oz);
      push(ox, oy, oz, 0.4f * sc, 0.4f * sc, 0.4f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.4f * sc, 0.4f * sc, 0.4f * sc, R2, G2, B2, yaw);
      tint(1.0f, 0.45f, 0.2f, R2, G2, B2); // visor slit (emissive)
      L(-lunge * 0.55f, 1.95f + bob, 0.34f, ox, oy, oz);
      push(ox, oy, oz, 0.26f * sc, 0.07f * sc, 0.06f, R2, G2, B2, yaw);
      tint(0.4f, 0.42f, 0.48f, R2, G2, B2); // legs (two)
      L(-0.15f * sc, 0.35f, -0.1f, ox, oy, oz); push(ox, oy, oz, 0.26f * sc, 0.7f * sc, 0.3f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.26f * sc, 0.7f * sc, 0.3f * sc, R2, G2, B2, yaw);
      L(0.15f * sc, 0.35f, -0.1f, ox, oy, oz); push(ox, oy, oz, 0.26f * sc, 0.7f * sc, 0.3f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.26f * sc, 0.7f * sc, 0.3f * sc, R2, G2, B2, yaw);
    } else if (e.type == "ARCHER") {
      // lean, hooded, a bow slung forward; aims (faces) the player
      sx = 0.55f; sz = 0.55f;
      float ox, oy, oz;
      tint(0.35f, 0.55f, 0.35f, R2, G2, B2); // torso
      L(-lunge * 0.5f, 0.85f, 0.0f, ox, oy, oz);
      push(ox, oy, oz, sx * sc, 1.0f * sc, sz * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, sx * sc, 1.0f * sc, sz * sc, R2, G2, B2, yaw);
      tint(0.3f, 0.45f, 0.3f, R2, G2, B2); // hood
      L(-lunge * 0.6f, 1.65f + bob, 0.0f, ox, oy, oz);
      push(ox, oy, oz, 0.32f * sc, 0.3f * sc, 0.32f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.32f * sc, 0.3f * sc, 0.32f * sc, R2, G2, B2, yaw);
      tint(1.0f, 0.7f, 0.4f, R2, G2, B2); // bow (vertical, held forward)
      L(0.2f, 1.1f, 0.35f, ox, oy, oz);
      push(ox, oy, oz, 0.05f, 0.8f * sc, 0.05f, R2, G2, B2, yaw);
      tint(0.3f, 0.4f, 0.25f, R2, G2, B2); // legs
      L(-0.12f * sc, 0.35f, -0.05f, ox, oy, oz); push(ox, oy, oz, 0.2f * sc, 0.7f * sc, 0.24f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.2f * sc, 0.7f * sc, 0.24f * sc, R2, G2, B2, yaw);
      L(0.12f * sc, 0.35f, -0.05f, ox, oy, oz); push(ox, oy, oz, 0.2f * sc, 0.7f * sc, 0.24f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.2f * sc, 0.7f * sc, 0.24f * sc, R2, G2, B2, yaw);
    } else if (e.type == "RAT") {
      // low crawler: elongated body + head + tail, scurrying (fast bob)
      sx = 0.5f; sy = 0.5f; sz = 0.9f;
      float ox, oy, oz;
      const float rbob = 0.06f * std::sin(state.runTime * 12.0f + phase);
      tint(0.5f, 0.42f, 0.33f, R2, G2, B2); // body
      L(0.0f, 0.2f + rbob, -0.15f, ox, oy, oz);
      push(ox, oy, oz, 0.4f * sc, 0.3f * sc, 0.7f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.4f * sc, 0.3f * sc, 0.7f * sc, R2, G2, B2, yaw);
      tint(0.55f, 0.47f, 0.38f, R2, G2, B2); // head
      L(0.0f, 0.22f + rbob, 0.45f, ox, oy, oz);
      push(ox, oy, oz, 0.26f * sc, 0.22f * sc, 0.3f * sc, R2, G2, B2, yaw);
      tint(1.0f, 0.4f, 0.5f, R2, G2, B2); // eyes (tiny, emissive)
      L(0.1f * sc, 0.26f + rbob, 0.58f, ox, oy, oz); push(ox, oy, oz, 0.05f, 0.05f, 0.05f, R2, G2, B2, yaw);
      L(-0.1f * sc, 0.26f + rbob, 0.58f, ox, oy, oz); push(ox, oy, oz, 0.05f, 0.05f, 0.05f, R2, G2, B2, yaw);
      tint(0.45f, 0.38f, 0.3f, R2, G2, B2); // tail (trailing)
      L(0.0f, 0.15f + rbob, -0.6f, ox, oy, oz);
      push(ox, oy, oz, 0.08f * sc, 0.08f * sc, 0.5f * sc, R2, G2, B2, yaw);
    } else if (e.type == "BRUTE") {
      // massive: huge shoulders, two club arms, glowing core
      sx = 1.5f; sy = 2.2f; sz = 1.5f;
      float ox, oy, oz;
      tint(0.55f, 0.22f, 0.22f, R2, G2, B2); // torso
      L(-lunge * 0.3f, 1.1f, 0.0f, ox, oy, oz);
      push(ox, oy, oz, sx * sc, 1.4f * sc, sz * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, sx * sc, 1.4f * sc, sz * sc, R2, G2, B2, yaw);
      tint(0.65f, 0.28f, 0.28f, R2, G2, B2); // head (small, buried in muscle)
      L(-lunge * 0.45f, 2.15f + bob, 0.15f, ox, oy, oz);
      push(ox, oy, oz, 0.45f * sc, 0.4f * sc, 0.45f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.45f * sc, 0.4f * sc, 0.45f * sc, R2, G2, B2, yaw);
      tint(1.0f, 0.5f, 0.2f, R2, G2, B2); // eyes
      L(0.14f * sc, 2.2f + bob, 0.5f, ox, oy, oz); push(ox, oy, oz, 0.09f, 0.09f, 0.09f, R2, G2, B2, yaw);
      L(-0.14f * sc, 2.2f + bob, 0.5f, ox, oy, oz); push(ox, oy, oz, 0.09f, 0.09f, 0.09f, R2, G2, B2, yaw);
      tint(0.6f, 0.25f, 0.25f, R2, G2, B2); // club arms (raised during windup)
      const float armLift = (e.attackPhase == 1) ? 0.5f : 0.0f;
      L(0.85f * sc, 1.4f + armLift, 0.2f, ox, oy, oz); push(ox, oy, oz, 0.35f * sc, 1.1f * sc, 0.4f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.35f * sc, 1.1f * sc, 0.4f * sc, R2, G2, B2, yaw);
      L(-0.85f * sc, 1.4f + armLift, 0.2f, ox, oy, oz); push(ox, oy, oz, 0.35f * sc, 1.1f * sc, 0.4f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.35f * sc, 1.1f * sc, 0.4f * sc, R2, G2, B2, yaw);
      tint(0.5f, 0.2f, 0.2f, R2, G2, B2); // legs (thick)
      L(-0.4f * sc, 0.45f, -0.1f, ox, oy, oz); push(ox, oy, oz, 0.4f * sc, 0.9f * sc, 0.45f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.4f * sc, 0.9f * sc, 0.45f * sc, R2, G2, B2, yaw);
      L(0.4f * sc, 0.45f, -0.1f, ox, oy, oz); push(ox, oy, oz, 0.4f * sc, 0.9f * sc, 0.45f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.4f * sc, 0.9f * sc, 0.45f * sc, R2, G2, B2, yaw);
    } else if (e.type == "WRAITH") {
      // spectral: no legs — a tapering wisp that hovers and sways
      sx = 0.7f; sy = 1.8f; sz = 0.7f;
      const float wy = 1.2f + 0.15f * (float)std::sin(state.runTime * 3.0 + e.pos.x);
      float ox, oy, oz;
      tint(0.65f, 0.75f, 0.9f, R2, G2, B2); // lower wisp (taper)
      L(0.0f, wy - 0.5f, 0.0f, ox, oy, oz);
      push(ox, oy, oz, 0.5f * sc, 0.9f * sc, 0.5f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.5f * sc, 0.9f * sc, 0.5f * sc, R2, G2, B2, yaw);
      tint(0.75f, 0.85f, 1.0f, R2, G2, B2); // upper body
      L(0.0f, wy + 0.2f, 0.05f, ox, oy, oz);
      push(ox, oy, oz, 0.55f * sc, 0.8f * sc, 0.55f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.55f * sc, 0.8f * sc, 0.55f * sc, R2, G2, B2, yaw);
      tint(0.9f, 0.95f, 1.0f, R2, G2, B2); // head
      L(0.0f, wy + 0.85f, 0.1f, ox, oy, oz);
      push(ox, oy, oz, 0.3f * sc, 0.3f * sc, 0.3f * sc, R2, G2, B2, yaw);
      tint(1.0f, 1.0f, 1.0f, R2, G2, B2); // eyes (cold white)
      L(0.1f * sc, wy + 0.88f, 0.32f, ox, oy, oz); push(ox, oy, oz, 0.06f, 0.06f, 0.06f, R2, G2, B2, yaw);
      L(-0.1f * sc, wy + 0.88f, 0.32f, ox, oy, oz); push(ox, oy, oz, 0.06f, 0.06f, 0.06f, R2, G2, B2, yaw);
    } else if (e.isBURN) {
      // BURN: a flame-wreathed husk — body + flickering flame crown
      sx = 1.2f; sy = 1.4f; sz = 1.2f;
      float ox, oy, oz;
      tint(0.7f, 0.28f, 0.12f, R2, G2, B2); // body
      L(0.0f, 0.7f, 0.0f, ox, oy, oz);
      push(ox, oy, oz, sx * sc, sy * sc, sz * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, sx * sc, sy * sc, sz * sc, R2, G2, B2, yaw);
      tint(1.0f, 0.6f, 0.15f, R2, G2, B2); // flame crown (flickers)
      const float fl = 0.1f * std::sin(state.runTime * 9.0f + phase);
      L(0.0f, 1.6f + fl, 0.0f, ox, oy, oz);
      push(ox, oy, oz, 0.5f * sc, 0.5f * sc, 0.5f * sc, R2, G2, B2, yaw);
    } else {
      // SKELETON (default): skull + ribcage + spine + arms + legs — the classic
      float ox, oy, oz;
      tint(0.85f, 0.85f, 0.8f, R2, G2, B2); // ribcage/torso
      L(-lunge * 0.4f, 0.85f, 0.0f, ox, oy, oz);
      push(ox, oy, oz, 0.5f * sc, 0.75f * sc, 0.4f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.5f * sc, 0.75f * sc, 0.4f * sc, R2, G2, B2, yaw);
      tint(0.9f, 0.9f, 0.85f, R2, G2, B2); // skull
      L(-lunge * 0.55f, 1.55f + bob, 0.05f, ox, oy, oz);
      push(ox, oy, oz, 0.3f * sc, 0.32f * sc, 0.3f * sc, R2, G2, B2, yaw);
      epush(ox, oy, oz, 0.3f * sc, 0.32f * sc, 0.3f * sc, R2, G2, B2, yaw);
      tint(0.3f, 0.7f, 1.0f, R2, G2, B2); // eye sockets (spectral blue)
      L(0.1f * sc, 1.58f + bob, 0.3f, ox, oy, oz); push(ox, oy, oz, 0.07f, 0.07f, 0.07f, R2, G2, B2, yaw);
      L(-0.1f * sc, 1.58f + bob, 0.3f, ox, oy, oz); push(ox, oy, oz, 0.07f, 0.07f, 0.07f, R2, G2, B2, yaw);
      tint(0.8f, 0.8f, 0.75f, R2, G2, B2); // arms (raised when attacking)
      const float armRaise = (e.attackPhase == 1) ? 0.35f : 0.0f;
      L(0.35f * sc, 1.15f + armRaise, 0.1f, ox, oy, oz); push(ox, oy, oz, 0.12f * sc, 0.65f * sc, 0.15f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.12f * sc, 0.65f * sc, 0.15f * sc, R2, G2, B2, yaw);
      L(-0.35f * sc, 1.15f + armRaise, 0.1f, ox, oy, oz); push(ox, oy, oz, 0.12f * sc, 0.65f * sc, 0.15f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.12f * sc, 0.65f * sc, 0.15f * sc, R2, G2, B2, yaw);
      tint(0.78f, 0.78f, 0.73f, R2, G2, B2); // legs (alternating stride)
      const float stride = 0.12f * std::sin(state.runTime * 8.0f + phase) *
                           (e.state == dc::EnemyState::kChase ? 1.0f : 0.0f);
      L(-0.15f * sc, 0.35f, -0.1f + stride, ox, oy, oz); push(ox, oy, oz, 0.16f * sc, 0.7f * sc, 0.2f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.16f * sc, 0.7f * sc, 0.2f * sc, R2, G2, B2, yaw);
      L(0.15f * sc, 0.35f, -0.1f - stride, ox, oy, oz); push(ox, oy, oz, 0.16f * sc, 0.7f * sc, 0.2f * sc, R2, G2, B2, yaw); epush(ox, oy, oz, 0.16f * sc, 0.7f * sc, 0.2f * sc, R2, G2, B2, yaw);
    }
  }
  // enemy projectiles — arrows amber, fireball orbs violet
  for (const auto& p : skelsys.arrows())
    if (p.active) push((float)p.pos.x, 1.2f, (float)p.pos.z, 0.25f, 0.25f, 0.25f, 1.0f, 0.7f, 0.3f);
  for (const auto& p : skelsys.orbs())
    if (p.active) push((float)p.pos.x, 1.2f, (float)p.pos.z, 0.3f, 0.3f, 0.3f, 0.7f, 0.5f, 1.0f);
  // ---- HUNTER buff companion (effect 5) — a small cold-wraith that parks to
  //      the player's left and beams its target. The beam is a run of thin
  //      emissive segments along hunter→beamTarget (the visible effect).
  // ---- HUNTER buff companion (effect 5) — a small cold-wraith that follows
  //      the player and beams its target. The beam is a run of thin
  //      emissive segments along hunter→beamTarget (the visible effect).
  if (hunter.active) {
    // Render from pos (the sim tracks behind the player, no fixed side offset).
    const float hx = (float)hunter.pos.x, hz = (float)hunter.pos.z;
    const float hy = 1.0f + 0.12f * std::sin(state.runTime * 3.0);
    const float hyaw = std::atan2((float)state.player.x - hx, (float)state.player.z - hz);
    const float hcy = std::cos(hyaw), hsy = std::sin(hyaw);
    auto HL = [&](float px, float py, float pz, float& ox, float& oy, float& oz) {
      ox = hx + px * hcy + pz * hsy; oy = hy + py; oz = hz - px * hsy + pz * hcy;
    };
    float ox, oy, oz;
    // lower wisp
    HL(0, -0.35f, 0, ox, oy, oz);
    push(ox, oy, oz, 0.35f, 0.7f, 0.35f, 0.55f, 0.62f, 0.85f, hyaw);
    // torso
    HL(0, 0.15f, 0, ox, oy, oz);
    push(ox, oy, oz, 0.4f, 0.55f, 0.4f, 0.65f, 0.75f, 1.0f, hyaw);
    // head
    HL(0, 0.62f, 0, ox, oy, oz);
    push(ox, oy, oz, 0.22f, 0.22f, 0.22f, 0.8f, 0.9f, 1.0f, hyaw);
    // eyes (cold white)
    HL(0.07f, 0.64f, 0.12f, ox, oy, oz); push(ox, oy, oz, 0.05f, 0.05f, 0.05f, 1.0f, 1.0f, 1.0f, hyaw);
    HL(-0.07f, 0.64f, 0.12f, ox, oy, oz); push(ox, oy, oz, 0.05f, 0.05f, 0.05f, 1.0f, 1.0f, 1.0f, hyaw);
    // BEAM: hunter→target, chest height, segmented thin emissive bar. The beam
    // is a box whose LONG AXIS IS LOCAL X (scales = segLen, 0.05, 0.05), so its
    // yaw must ALIGN local X with the beam direction. Local X axis in world =
    // (cos, 0, sin) [column 0 of the yaw matrix, pitch 0], so the alignment
    // yaw is atan2(dz, dx). The old facing yaw atan2(dx, dz) pointed the box
    // 90° off — perpendicular to the beam direction (the reported bug).
    auto drawBeam = [&](float tx, float tz) {
      const float dx = tx - hx, dz = tz - hz;
      const float len = std::hypot(dx, dz);
      if (len < 0.3f) return;
      const float by = 1.2f;
      const int segs = 8;
      const float segLen = len / segs;
      const float pulse = 0.6f + 0.4f * (hunter.beamFlash / dc::hunter::kBeamFlash);
      // Each dash is a box whose LONG AXIS IS LOCAL X; align local X with the
      // beam direction. Local X axis in world = (cos,0,-sin) ⇒ yaw = atan2(-dz,dx).
      // (atan2(dz,dx) tilts each dash off the beam line — the "rays not facing
      // the beam" bug.)
      const float byaw = std::atan2(-dz, dx);
      for (int i = 0; i < segs; i++) {
        const float f0 = (i + 0.5f) / segs;
        const float mx = hx + dx * f0, mz = hz + dz * f0;
        push(mx, by, mz, segLen * 0.9f, 0.05f, 0.05f, 0.7f * pulse, 0.9f * pulse, 1.0f * pulse, byaw);
      }
    };
    if (hunter.hasBeam && hunter.beamFlash > 0)
      for (const auto& bt : hunter.beamTargets) drawBeam((float)bt.x, (float)bt.z);
  }
  // soul-fire orbs (blue-white)
  for (const auto& o : orbs)
    if (o.alive) push((float)o.x, (float)o.y, (float)o.z, 0.3f, 0.3f, 0.3f, 0.6f, 0.8f, 1.0f);
  // ---- floating sword (no hands, tier-colored) — ALWAYS follows the view ----
  // Local frame: blade along +Y (the blade axis), guard across X, grip at
  // origin. The per-instance 3x3 = camera basis * base tilt * swing, so the
  // sword is rigidly attached to the player's direction (fixes "keeps its
  // original orientation").
  // Swing: eased HORIZONTAL arc (local-Z rotation) with per-step flavor +
  // motion-blur trail ghosts + an impact flash at the swing apex.
  if (screen != Screen::Dead) {
    const float yaw = state.player.yaw, pitch = state.player.pitch;
    // tier blade colors (JS PlayerSword._buildForm)
    float br, bg, bb;
    switch (state.weaponTier) {
      case 0:  br=0.467f; bg=0.439f; bb=0.408f; break; // 0x777068
      case 1:  br=0.667f; bg=0.698f; bb=0.737f; break; // 0xaab2bc
      case 2:  br=0.533f; bg=0.675f; bb=0.800f; break; // 0x88aacc
      case 3:  br=0.690f; bg=0.549f; bb=1.000f; break; // 0xb08cff
      case 5:  br=0.0f; bg=0.706f; bb=1.0f; break; // #00b3ff (lightsaber blue)
    default: br=0.0f; bg=0.706f; bb=1.0f; break; // #00b3ff (T5+ lightsaber blue)
    }
    br = std::min(1.0f, br*1.5f+0.15f); bg = std::min(1.0f, bg*1.5f+0.15f); bb = std::min(1.0f, bb*1.5f+0.15f);
    const float bladeLen = 0.76f + state.weaponTier * 0.06f * 4.0f;
    // camera-space rest offset: x right, y up, -z forward (JS 0.38,-0.42,-0.75)
    const float bob = std::sin((float)state.runTime * 1.7f) * 0.008f;
    const float ox = 0.38f, oy = -0.42f + bob, oz = -0.75f;
    // ---- swing timing (mirrors the §9 state machine; def = this step) ----
    float phi = -0.5f;               // rest pose: blade angled low-right
    float thrust = 0.0f;            // extra −Z lunge during the swing
    float trailA = 0.0f;            // trail alpha
    float flashA = 0.0f;            // impact-flash alpha
    if (swordPhase && std::strcmp(swordPhase, "cooldown") != 0) {
      const auto& def = dc::kSwordCombo[std::max(0, swordStep - 1)];
      const double speedMult = dc::attackSpeedFromSouls(state.collectedOrbs) * buffAttackMult();
      const double wu = def.windup / speedMult, sw = def.swing / speedMult, rc = def.recover / speedMult;
      // per-step flavor in the HORIZONTAL (Z-rotation) domain: positive = blade
      // to the LEFT, negative = RIGHT (verified: tip → (−L·sinφ, L·cosφ)).
      // 1 = wide LEFT→RIGHT chop, 2 = wide RIGHT→LEFT chop, 3 = short arc + thrust.
      const float a0 = swordStep == 1 ? 1.30f : swordStep == 2 ? -1.50f : 0.50f;
      const float a1 = swordStep == 1 ? -1.50f : swordStep == 2 ? 1.50f : -0.50f;
      const float thA = swordStep == 3 ? 0.42f : swordStep == 1 ? 0.28f : 0.22f;
      auto easeIO = [](double t) { return t * t * (3.0 - 2.0 * t); }; // smoothstep
      if (std::strcmp(swordPhase, "windup") == 0) {
        const float t = std::min(1.0f, (float)(swordPhaseT / wu));
        phi = -0.5f + (a0 + 0.5f) * t * t;                 // wind back (accelerating)
        thrust = -0.06f * t;                                // dip back
      } else if (std::strcmp(swordPhase, "swing") == 0) {
        const float t = std::min(1.0f, (float)(swordPhaseT / sw));
        const float e = (float)easeIO(t);
        phi = a0 + (a1 - a0) * e;                          // the strike
        thrust = thA * std::sin((float)M_PI * t);         // lunge out then back
        trailA = 0.55f * std::sin((float)M_PI * t);       // strongest mid-swing
        if (t > 0.82f) flashA = (t - 0.82f) / 0.18f;       // impact flash at apex
      } else { // recover
        const float t = std::min(1.0f, (float)(swordPhaseT / rc));
        phi = a1 + (-0.5f - a1) * t * t * (3.0f - 2.0f * t); // eased settle
        thrust = -0.05f * t;
      }
    }
    // local→world with swing rotation about the blade axis (local X)
    const float cy_ = std::cos(yaw), sy_ = std::sin(yaw), cp_ = std::cos(pitch), sp_ = std::sin(pitch);
    const float right[3] = { cy_, 0.0f, -sy_ };
    const float upv[3] = { -sy_*sp_, cp_, -cy_*sp_ };
    const float fwd[3] = { -sy_*cp_, -sp_, -cy_*cp_ };
    // base tilt (three.js Euler(-0.35,-0.25, 0.18) → M=Rx·Ry·Rz) angles the
    // blade forward/down into the lower-right instead of straight up, so the sword
    // clearly follows the view (fixes "keeps its original orientation").
    // ang = swing angle this point is rotated through (phi for the live sword,
    // gp for a trail ghost). Every part is transformed through THIS one rigid
    // rotation, so grip/guard/blade stay welded into a single piece.
    auto swordW = [&](float lx, float ly, float lz, float& wx, float& wy, float& wz,
                      float ang) {
      // 1) swing rotation about local Z — a HORIZONTAL sweep (left<->right) of
      //    the +Y blade in the X-Y plane (JS PlayerSword animates rotation.z).
      //    A rotation about Y would be the blade's OWN axis (tip a fixed
      //    point) — the old draft bug; X was the vertical arc.
      const float ca = std::cos(ang), sa = std::sin(ang);
      const float lx2 = lx * ca - ly * sa;
      const float ly2 = lx * sa + ly * ca;
      const float lz2 = lz;
      // 2) base tilt (three.js group rotation) → three.js camera-space
      const float t1x = 0.953f * lx2 - 0.173f * ly2 - 0.247f * lz2;
      const float t1y = 0.252f * lx2 + 0.909f * ly2 + 0.332f * lz2;
      const float t1z = 0.167f * lx2 - 0.379f * ly2 + 0.910f * lz2;
      // 3) camera-space → world. three.js camera space: x=right, y=up, z=BACKWARD,
      //    so world = cam + right*px + up*py - fwd*pz (fwd = look dir).
      //    +thrust moves the sword forward (more -z) during the swing.
      const float px = ox + t1x, py = oy + t1y, pz = oz + t1z - thrust;
      wx = camX + right[0]*px + upv[0]*py - fwd[0]*pz;
      wy = camY + right[1]*px + upv[1]*py - fwd[1]*pz;
      wz = camZ + right[2]*px + upv[2]*py - fwd[2]*pz;
    };
    // Full rigid WORLD rotation of the sword group for swing angle ang:
    //   R = Ccam * BaseTilt * SwingX(ang)   (column-major 3x3)
    // Every part (grip / guard / blade, the live sword AND each trail ghost) is
    // oriented by this SAME matrix, so the handle, guard and blade stay welded
    // into ONE piece and the whole sword swings as a single rigid group — exactly
    // the JS formGroup (position + rotation set once; the swing only rotates it).
    auto swordRot = [&](float ang) -> std::array<float, 9> {
      const float ca = std::cos(ang), sa = std::sin(ang);
      // SwingZ(ang) — MUST match swordW's (lx2,ly2,lz2)=(lx*ca-ly*sa, lx*sa+ly*ca, lz),
      // i.e. column-major {ca,sa,0 | -sa,ca,0 | 0,0,1} (a horizontal sweep; the
      // original SwingX {1,0,0 | 0,ca,sa | 0,-sa,ca} rotated the +Y blade up/down
      // in the Y-Z plane = the vertical swing; a Y-axis rotation would be the
      // blade's own length — tip a fixed point, no motion at all).
      float Sw[9] = {ca,sa,0,  -sa,ca,0,  0,0,1};    // SwingZ(ang), col-major
      float BT[9] = {0.953f,0.252f,0.167f,  -0.173f,0.909f,-0.379f,  -0.247f,0.332f,0.910f}; // BaseTilt
      float CC[9] = { right[0],right[1],right[2],  upv[0],upv[1],upv[2],  -fwd[0],-fwd[1],-fwd[2] }; // Ccam
      auto mul = [](const float A[9], const float B[9], float O[9]) {
        for (int c = 0; c < 3; c++)
          for (int i = 0; i < 3; i++) {
            float s = 0; for (int k = 0; k < 3; k++) s += A[k*3+i] * B[c*3+k];
            O[c*3+i] = s;
          }
      };
      float M[9], R[9];
      mul(BT, Sw, M);   // BaseTilt * SwingZ
      mul(CC, M, R);    // Ccam * (BaseTilt * SwingZ)
      return std::array<float,9>{R[0],R[1],R[2],R[3],R[4],R[5],R[6],R[7],R[8]};
    };
    float hx, hy, hz;
    swordW(0.0f, 0.0f, 0.0f, hx, hy, hz, phi);
    // motion-blur trail: ghost blades swept back along the swing arc (pre-swing).
    // A ghost is the blade drawn at an earlier swing angle gp (NOT the current
    // phi): the SAME rigid swordW transform with ang=gp, so the ghost blade is
    // exactly where the blade WAS along the arc.
    if (trailA > 0.02f) {
      for (int g = 1; g <= 3; g++) {
        const float gp = phi - 0.30f * g;
        swordW(0.0f, 0.14f + 0.5f * bladeLen, 0.0f, hx, hy, hz, gp);
        const float ga = trailA * (1.0f - g * 0.28f) * 0.5f;
        pushM(hx, hy, hz, 0.055f, bladeLen * (1.0f - 0.08f * g), 0.014f,
              br * ga, bg * ga, bb * ga, swordRot(gp).data());
      }
    }
    // impact flash: a bright plane blooming across the swing path (at the blade tip)
    if (flashA > 0.02f) {
      swordW(0.0f, 0.95f * bladeLen, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.42f, 0.42f, 0.03f, 1.0f * flashA, 1.0f * flashA, 1.0f * flashA, swordRot(phi).data());
    }
    // grip (origin) — a short handle along local Y (the blade axis)
    swordW(0.0f, 0.0f, 0.0f, hx, hy, hz, phi);
    pushM(hx, hy, hz, 0.05f, 0.26f, 0.05f, 0.173f, 0.125f, 0.094f, swordRot(phi).data()); // 0x2c2018 grip
    // ---- guard (tier-specific detail) ----
    const int tier = state.weaponTier;
    swordW(0.0f, 0.13f, 0.0f, hx, hy, hz, phi);
    if (tier == 0) {
      // T0: plain leather wrap
      pushM(hx, hy, hz, 0.07f, 0.06f, 0.05f, 0.173f, 0.125f, 0.094f, swordRot(phi).data());
    } else if (tier == 1) {
      // T1: simple iron bar guard
      pushM(hx, hy, hz, 0.28f, 0.05f, 0.05f, 0.416f, 0.353f, 0.204f, swordRot(phi).data()); // 0x6a5a34
    } else if (tier == 2) {
      // T2: reinforced guard + 2 small studs
      pushM(hx, hy, hz, 0.32f, 0.06f, 0.06f, 0.500f, 0.420f, 0.250f, swordRot(phi).data()); // 0x806c40
      // left stud
      swordW(-0.14f, 0.13f, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.035f, 0.035f, 0.035f, 0.550f, 0.470f, 0.280f, swordRot(phi).data());
      // right stud
      swordW(0.14f, 0.13f, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.035f, 0.035f, 0.035f, 0.550f, 0.470f, 0.280f, swordRot(phi).data());
    } else if (tier == 3) {
      // T3: crossguard with ornamental center piece
      pushM(hx, hy, hz, 0.36f, 0.07f, 0.07f, 0.600f, 0.500f, 0.300f, swordRot(phi).data()); // 0x99804d
      // center ornament
      swordW(0.0f, 0.13f, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.06f, 0.06f, 0.06f, 0.700f, 0.580f, 0.350f, swordRot(phi).data());
    } else if (tier == 4) {
      // T4: elaborate guard with 4 corner studs
      pushM(hx, hy, hz, 0.40f, 0.08f, 0.08f, 0.700f, 0.600f, 0.400f, swordRot(phi).data()); // 0xb39966
      // 4 corner studs
      swordW(-0.15f, 0.13f, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.04f, 0.04f, 0.04f, 0.750f, 0.650f, 0.450f, swordRot(phi).data());
      swordW(0.15f, 0.13f, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.04f, 0.04f, 0.04f, 0.750f, 0.650f, 0.450f, swordRot(phi).data());
      swordW(0.0f, 0.13f, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.05f, 0.05f, 0.05f, 0.800f, 0.700f, 0.500f, swordRot(phi).data());
    } else {
      // T5+: guardless emitter — no crossguard, just a glowing blue ring
      swordW(0.0f, 0.13f, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.12f, 0.025f, 0.025f, 0.0f, 0.45f, 0.85f, swordRot(phi).data()); // small blue ring
    }
    // ---- blade glow (emissive at higher tiers) ----
    const float glowIntensity = std::max(0.0f, (tier - 1) * 0.18f); // T0=0, T1=0.18, ... T5+=0.90
    const float glowR = br * glowIntensity, glowG = bg * glowIntensity, glowB = bb * glowIntensity;
    // Blade core (base)
    swordW(0.0f, 0.14f + 0.5f * bladeLen, 0.0f, hx, hy, hz, phi);
    pushM(hx, hy, hz, 0.055f, bladeLen, 0.012f, br, bg, bb, swordRot(phi).data());
    // Blade glow (additive, thicker at higher tiers)
    if (glowIntensity > 0.02f) {
      // glow outer
      swordW(0.0f, 0.14f + 0.5f * bladeLen, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.080f, bladeLen * 1.1f, 0.020f, glowR, glowG, glowB, swordRot(phi).data());
    }
    // T5+ lightsaber: bright inner plasma core + wider outer halo
    if (tier >= 5) {
      const float plasmaR = 0.0f * 3.0f, plasmaG = 0.706f * 3.0f, plasmaB = 1.0f * 3.0f;
      // inner plasma core — bright white-blue center
      swordW(0.0f, 0.14f + 0.5f * bladeLen, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.030f, bladeLen * 0.95f, 0.006f,
            std::min(1.0f, plasmaR + 0.5f), std::min(1.0f, plasmaG + 0.5f), std::min(1.0f, plasmaB + 0.5f),
            swordRot(phi).data());
      // outer plasma halo — wide blue glow
      swordW(0.0f, 0.14f + 0.5f * bladeLen, 0.0f, hx, hy, hz, phi);
      pushM(hx, hy, hz, 0.14f, bladeLen * 1.3f, 0.035f,
            0.0f * 2.0f, 0.50f * 2.0f, 0.80f * 2.0f,
            swordRot(phi).data());
    }
  }
  // ---- start/exit markers (§12.1/§22): make the spawn + the exit portal findable ----
  // start = green ring at the entrance; exit = golden ring + a tall beam at the exit
  // cell. The beam is the long-range landmark (reads across the whole room); the ring
  // is the on-ground marker. The exit pulses while the portal is OPEN (E to descend),
  // and dims to a dim gold while SEALEd (boss level, until the lord falls) so a sealed
  // portal is still findable but clearly distinct.
  {
    const double cs = world.dungeon.cellSize;
    const float t = (float)state.runTime;
    // START (entrance) — green ring + a short pulsing pillar. The ring sits at the
    // player's feet at spawn (under the camera), so the pillar is the visible
    // landmark: a short green column reads as "you started here" even from
    // eye level, and it pulses so it catches the eye.
    if (world.dungeon.entranceCell) {
      const float ex_ = (float)(world.dungeon.entranceCell->x * cs);
      const float ez_ = (float)(world.dungeon.entranceCell->z * cs);
      const float sp = 0.6f + 0.4f * (0.5f + 0.5f * std::sin(t * 2.5f));
      push(ex_, 0.10f, ez_, 2.0f, 0.05f, 2.0f, 0.22f * sp, 1.0f * sp, 0.40f * sp); // ring (flat)
      push(ex_, 0.20f, ez_, 1.2f, 0.10f, 1.2f, 0.15f * sp, 0.7f * sp, 0.28f * sp);   // inner glow
      push(ex_, 0.8f, ez_, 0.22f, 1.6f, 0.22f, 0.25f * sp, 1.0f * sp, 0.45f * sp);   // short pillar
    }
    // EXIT (portal) — golden ring + vertical beam. Pulse while open, dim when sealed.
    if (world.dungeon.exitCell) {
      const float ex_ = (float)(world.dungeon.exitCell->x * cs);
      const float ez_ = (float)(world.dungeon.exitCell->z * cs);
      const float open = bossPortalOpen ? 1.0f : 0.25f;
      const float pulse = 0.6f + 0.4f * (0.5f + 0.5f * std::sin(t * 3.0f)) * open;
      const float gr = 1.0f * pulse * open + 0.15f; // golden
      push(ex_, 0.10f, ez_, 2.2f, 0.06f, 2.2f, gr, 0.85f * pulse, 0.1f * pulse); // ring
      push(ex_, 0.5f, ez_, 0.28f, 0.6f, 0.28f, gr, 0.85f * pulse, 0.1f * pulse);  // hub
      // tall beam: the landmark visible from across the room
      push(ex_, 6.0f, ez_, 0.30f, 10.0f, 0.30f, gr * 0.9f, 0.80f * pulse, 0.12f * pulse);
    }
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
  // ---- ELECTRIC CHAIN lightning arcs (bright blue-white, additive, thick lines) ----
  if (arcCount > 0 && flashT > 0.1f) {
    // Flash intensity: full at flashT=0.25, fades out by flashT=0.05
    const float flashAlpha = (float)(flashT / 0.25);
    const float alpha = std::max(0.0f, std::min(1.0f, flashAlpha * 2.0f));
    if (alpha > 0.01f) {
      // Use GL_LINES to draw bright lightning arcs
      // Each arc segment is a line from (arcX[i],arcY[i],arcZ[i]) to (arcEx[i],arcEy[i],arcEz[i])
      // We'll use a simple approach: draw thin bright lines via GL_LINES
      // Since we don't have a dedicated line shader, we'll use the lit shader with emissive
      // For simplicity: draw as small glowing cylinders (thin capsules) using push()
      for (int i = 0; i < arcCount; i++) {
        const float sx = (float)arcX[i], sy = (float)arcY[i], sz = (float)arcZ[i];
        const float ex = (float)arcEx[i], ey = (float)arcEy[i], ez = (float)arcEz[i];
        const float dx = ex - sx, dz = ez - sz;
        const float len = std::sqrt(dx * dx + dz * dz);
        if (len > 0.01f) {
          // Draw a line of small glowing segments
          const int segs = 6; // 6 segments per arc for dramatic effect
          for (int s = 0; s < segs; s++) {
            const float t = (float)s / (float)(segs - 1);
            const float px = sx + dx * t;
            const float pz = sz + dz * t;
            const float py = sy + (ey - sy) * t + 0.15f * std::sin(t * 3.14159f);
            // Zigzag offset
            const float zig = 0.08f * std::sin(t * 12.0f + i * 5.0f);
            const float nx = -dz / len * zig;
            const float nz = dx / len * zig;
            // Small glowing sphere at segment
            const float sz2 = 0.08f * alpha;
            push(px + nx, py, pz + nz, sz2, sz2 * 2.0f, sz2, 0.6f, 0.8f, 1.0f);
          }
        }
      }
    }
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

// ---- window-sized render targets: (re)allocated on resize / fullscreen ----
// The window framebuffer itself is managed by GLFW; everything we render into
// (scene + bright ping-pong + half-res enemy-glow RTs) must match it. The
// shadow map is fixed-size (kShadowSize) and lives outside this set.
void App::recreateWindowTargets() {
  auto makeColorTex = [&](int tw, int th) {
    GLuint t = 0;
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
    GLuint f = 0;
    glGenFramebuffers(1, &f);
    glBindFramebuffer(GL_FRAMEBUFFER, f);
    if (depth) glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, tex, 0);
    else glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    return f;
  };
  const int w = std::max(2, width), h = std::max(2, height);

  // dispose previous window-sized targets (first call: all zero)
  for (GLuint t : {sceneTex, brightTexA, brightTexB, glowSharpTex, glowBlurATex, glowBlurBTex})
    if (t) glDeleteTextures(1, &t);
  for (GLuint f : {sceneFbo, brightFboA, brightFboB, glowSharpFbo, glowBlurAFbo, glowBlurBFbo})
    if (f) glDeleteFramebuffers(1, &f);
  if (sceneDepthRb) glDeleteRenderbuffers(1, &sceneDepthRb);

  sceneTex = makeColorTex(w, h);
  sceneFbo = makeFbo(sceneTex, false);
  glGenRenderbuffers(1, &sceneDepthRb);
  glBindRenderbuffer(GL_RENDERBUFFER, sceneDepthRb);
  glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, w, h);
  glBindFramebuffer(GL_FRAMEBUFFER, sceneFbo);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, sceneDepthRb);
  glDrawBuffer(GL_COLOR_ATTACHMENT0);
  glReadBuffer(GL_COLOR_ATTACHMENT0);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);

  brightTexA = makeColorTex(w, h);
  brightFboA = makeFbo(brightTexA, false);
  brightTexB = makeColorTex(w, h);
  brightFboB = makeFbo(brightTexB, false);

  glowW = std::max(2, w / 2);
  glowH = std::max(2, h / 2);
  glowSharpTex = makeColorTex(glowW, glowH);
  glowSharpFbo = makeFbo(glowSharpTex, false);
  glowBlurATex = makeColorTex(glowW, glowH);
  glowBlurAFbo = makeFbo(glowBlurATex, false);
  glowBlurBTex = makeColorTex(glowW, glowH);
  glowBlurBFbo = makeFbo(glowBlurBTex, false);
}

// F11: windowed <-> native fullscreen on the primary monitor.
void App::toggleFullscreen() {
  if (!window) return;
  int w = 0, h = 0;
  glfwGetWindowSize(window, &w, &h);
  if (!fullscreen) {
    monitor = glfwGetPrimaryMonitor();
    if (!monitor) return;
    const GLFWvidmode* vm = glfwGetVideoMode(monitor);
    if (!vm) return;
    glfwSetWindowMonitor(window, monitor, 0, 0, vm->width, vm->height, vm->refreshRate);
    fullscreen = true;
  } else {
    glfwSetWindowMonitor(window, nullptr, 0, 0, w, h, 0);
    fullscreen = false;
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
  glfwWindowHint(GLFW_RESIZABLE, GLFW_TRUE); // resizable to full screen (item 1)
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

  // ---- FBOs (window-sized RTs live in recreateWindowTargets so resize/fullscreen
  //      can reallocate them; shadowTex is fixed-size and created here) ----
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
  shadowFbo = 0;
  glGenFramebuffers(1, &shadowFbo);
  glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, shadowTex, 0);
  {
    // depth-only FBO: GL_NONE drawbuffer (a color attach would make it incomplete)
    glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo);
    glDrawBuffer(GL_NONE);
    glReadBuffer(GL_NONE);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
  }
  recreateWindowTargets();

  // ---- dynamic entity VBO (boss + full roster + projectiles + props), streamed
  //      each frame. Capacity: ~120 combat (30 mobs + 24 arrows + 16 orbs +
  //      48 soul orbs + boss + sword) + 400 props (breakables/sarcophagi hard
  //      cap) + headroom = 560 instances worst case. ----
  constexpr int kDynCap = 1400;
  glGenBuffers(1, &dynVbo);
  glBindBuffer(GL_ARRAY_BUFFER, dynVbo);
  { std::vector<float> tmp(kDynCap * 11, 0.0f);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(tmp.size() * sizeof(float)), tmp.data(), GL_DYNAMIC_DRAW); }
  glBindBuffer(GL_ARRAY_BUFFER, 0);

  // §12.2 enemy-only VBO (multi-part bodies, 11 floats/inst) for the flat glow mask
  glGenBuffers(1, &enemVbo);
  glBindBuffer(GL_ARRAY_BUFFER, enemVbo);
  { std::vector<float> tmp(320 * 11, 0.0f); // ~30 live mobs × ~10 parts + boss
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
  // §13 Atmospheric particles (embers, snow, spores, crystal dust): shared quad system.
  progAtmo = linkProgram(compileShader(GL_VERTEX_SHADER, kAtmoVert),
                         compileShader(GL_FRAGMENT_SHADER, kAtmoFrag));

  // Smoke: 9 pooled camera-facing billboards (corner2 + pos3 + alpha1 = 6f/inst).
  {
    static const float kQuad[8] = {-0.5f, -0.5f, 0.5f, -0.5f, 0.5f, 0.5f, -0.5f, 0.5f};
    glGenVertexArrays(1, &smokeVao);
    glGenBuffers(1, &smokeQuad);
    glGenBuffers(1, &smokeVbo);
    glBindVertexArray(smokeVao);
    glBindBuffer(GL_ARRAY_BUFFER, smokeQuad);
    glBufferData(GL_ARRAY_BUFFER, sizeof(kQuad), kQuad, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, (void*)0);
    glBindBuffer(GL_ARRAY_BUFFER, smokeVbo);
    std::vector<float> tmp(dc::kSmokeParticles * 4, 0.0f);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(tmp.size() * sizeof(float)), tmp.data(), GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, 16, (void*)0);
    glVertexAttribDivisor(1, 1);
    glBindVertexArray(0);
  }

  // Ambient dust: 30 tiny camera-facing billboards (corner2 + pos3 = 5f/inst).
  {
    static const float kQuad[8] = {-0.5f, -0.5f, 0.5f, -0.5f, 0.5f, 0.5f, -0.5f, 0.5f};
    glGenVertexArrays(1, &dustVao);
    glGenBuffers(1, &dustQuad);
    glGenBuffers(1, &dustVbo);
    glBindVertexArray(dustVao);
    glBindBuffer(GL_ARRAY_BUFFER, dustQuad);
    glBufferData(GL_ARRAY_BUFFER, sizeof(kQuad), kQuad, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, (void*)0);
    glBindBuffer(GL_ARRAY_BUFFER, dustVbo);
    std::vector<float> tmp(dc::kAmbientDustParticles * 3, 0.0f);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(tmp.size() * sizeof(float)), tmp.data(), GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 12, (void*)0);
    glVertexAttribDivisor(1, 1);
    glBindVertexArray(0);
  }

  // §13 Atmospheric particles (embers/snow/spores/crystal): shared billboard quad + 50 instances.
  // pos3 + particleType1 = 16B/inst. One draw, per-biome color/type set at runtime.
  {
    static const float kQuad[8] = {-0.5f, -0.5f, 0.5f, -0.5f, 0.5f, 0.5f, -0.5f, 0.5f};
    glGenVertexArrays(1, &atmoVao);
    glGenBuffers(1, &atmoQuad);
    glGenBuffers(1, &atmoVbo);
    glBindVertexArray(atmoVao);
    glBindBuffer(GL_ARRAY_BUFFER, atmoQuad);
    glBufferData(GL_ARRAY_BUFFER, sizeof(kQuad), kQuad, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, (void*)0);
    glBindBuffer(GL_ARRAY_BUFFER, atmoVbo);
    // 50 atmospheric particles: pos3 + type1 = 16B each
    std::vector<float> tmp(50 * 4, 0.0f);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(tmp.size() * sizeof(float)), tmp.data(), GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 16, (void*)0);
    glVertexAttribDivisor(1, 1);
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 1, GL_FLOAT, GL_FALSE, 16, (void*)12);
    glVertexAttribDivisor(2, 1);
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
  // Menu font: URW Bookman (old-style serif, Dark Souls vibe)
  const char* menuFontPath = "/usr/share/fonts/opentype/urw-base35/URWBookman-Demi.otf";
  FILE* mf = fopen(menuFontPath, "rb");
  if (mf) {
    std::vector<unsigned char> mbuf;
    fseek(mf, 0, SEEK_END); long mlen = ftell(mf); fseek(mf, 0, SEEK_SET);
    mbuf.resize((size_t)mlen);
    fread(mbuf.data(), 1, (size_t)mlen, mf);
    fclose(mf);
    stbtt_fontinfo mfi;
    stbtt_InitFont(&mfi, mbuf.data(), stbtt_GetFontOffsetForIndex(mbuf.data(), 0));
    const int mP = 36, mAW = 1024, mAH = 512;
    std::vector<unsigned char> matlas((size_t)mAW * mAH * 4, 0);
    int mx = 2, my = 2, mrowH = 0;
    const float mscale = stbtt_ScaleForPixelHeight(&mfi, mP);
    for (int mc = 32; mc < 128; mc++) {
      int mx0, my0, mx1, my1;
      stbtt_GetCodepointBitmapBox(&mfi, mc, mscale, mscale, &mx0, &my0, &mx1, &my1);
      int mw = mx1 - mx0, mh = my1 - my0;
      int madvW = 0, mlsb = 0;
      stbtt_GetCodepointHMetrics(&mfi, mc, &madvW, &mlsb);
      menuFont.adv[mc] = madvW * mscale;
      if (mw <= 0 || mh <= 0) { menuFont.w[mc] = 0; continue; }
      if (mx + mw >= mAW - 2) { mx = 2; my += mrowH + 2; mrowH = 0; }
      std::vector<unsigned char> mbmp((size_t)mw * mh, 0);
      stbtt_MakeCodepointBitmap(&mfi, mbmp.data(), mw, mh, mw, mscale, mscale, mc);
      for (int j = 0; j < mh; j++)
        for (int i = 0; i < mw; i++) {
          unsigned char ma = mbmp[(size_t)j * mw + i];
          unsigned char* md = &matlas[((size_t)(my + j) * mAW + (mx + i)) * 4];
          md[3] = ma;
        }
      menuFont.uv[mc][0] = mx / (float)mAW;      menuFont.uv[mc][1] = my / (float)mAH;
      menuFont.uv[mc][2] = (mx + mw) / (float)mAW; menuFont.uv[mc][3] = (my + mh) / (float)mAH;
      menuFont.w[mc] = mw; menuFont.h[mc] = mh;
      mx += mw + 1; mrowH = std::max(mrowH, mh);
    }
    glGenTextures(1, &menuFont.tex);
    glBindTexture(GL_TEXTURE_2D, menuFont.tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, mAW, mAH, 0, GL_RGBA, GL_UNSIGNED_BYTE, matlas.data());
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    menuFont.ok = true;
    menuFont.pixel = mP;
    std::fprintf(stderr, "[dc_app] menu font baked %s (%dpx) — %s\n", menuFontPath, mP, menuFont.ok ? "OK" : "FAIL");
  } else {
    std::fprintf(stderr, "[dc_app] menu font: cannot open %s, falling back to pixel font\n", menuFontPath);
  }
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

  // ---- menu font VAO (same layout as text VAO) ----
  if (menuFont.ok) {
    progTextMenu = progText;  // same shaders; we swap texture at draw time
    glGenVertexArrays(1, &textMenuVao);
    glGenBuffers(1, &textMenuVbo);
    glBindVertexArray(textMenuVao);
    glBindBuffer(GL_ARRAY_BUFFER, textMenuVbo);
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

void App::drawGroup(GLuint instVbo, int count, float emissive, int strideBytes) {
  if (count <= 0 || instVbo == 0) return;
  glUseProgram(progScene);
  glUniform1f(glGetUniformLocation(progScene, "uEmissive"), emissive);
  glBindVertexArray(vao);
  glBindBuffer(GL_ARRAY_BUFFER, instVbo);
  const GLsizei stride = (GLsizei)strideBytes;
  // offset(3) scale(3) color(3) rot(3x3) [regionData(4)]
  glEnableVertexAttribArray(2);
  glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, stride, (void*)0);   // offset
  glVertexAttribDivisor(2, 1);
  glEnableVertexAttribArray(3);
  glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, stride, (void*)12);  // scale
  glVertexAttribDivisor(3, 1);
  glEnableVertexAttribArray(4);
  glVertexAttribPointer(4, 3, GL_FLOAT, GL_FALSE, stride, (void*)24);  // color
  glVertexAttribDivisor(4, 1);
  // rot 3x3, column-major: cols at offsets 36/48/60 (locations 5/6/7)
  glEnableVertexAttribArray(5);
  glVertexAttribPointer(5, 3, GL_FLOAT, GL_FALSE, stride, (void*)36);  // rot col0
  glVertexAttribDivisor(5, 1);
  glEnableVertexAttribArray(6);
  glVertexAttribPointer(6, 3, GL_FLOAT, GL_FALSE, stride, (void*)48);  // rot col1
  glVertexAttribDivisor(6, 1);
  glEnableVertexAttribArray(7);
  glVertexAttribPointer(7, 3, GL_FLOAT, GL_FALSE, stride, (void*)60);  // rot col2
  glVertexAttribDivisor(7, 1);
  if (strideBytes >= 88) {
    // 22-float dungeon instances: regionData(4) at offset 72
    glEnableVertexAttribArray(8);
    glVertexAttribPointer(8, 4, GL_FLOAT, GL_FALSE, stride, (void*)72);
    glVertexAttribDivisor(8, 1);
  } else {
    // 18-float dynamic instances (boss/enemies/sword): no region data —
    // feed a clean default so the shader's floor branch uses neutral values.
    glDisableVertexAttribArray(8);
    glVertexAttrib4f(8, 0.0f, 0.0f, 0.0f, 1.0f);
  }
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
  // ---- pointer lock: capture the cursor in gameplay, show it on menus ----
  // (was the dead 'mouse input' bug: pointerLocked stayed false, so look never
  //  engaged; now it tracks the screen so mouse-look works and the title/menu
  //  screens show a real cursor.)
  {
    const bool wantLock = (screen == Screen::Play);
    if (wantLock != pointerLocked) {
      pointerLocked = wantLock;
      if (window)
        glfwSetInputMode(window, GLFW_CURSOR,
                         wantLock ? GLFW_CURSOR_DISABLED : GLFW_CURSOR_NORMAL);
    }
  }
  // ---- title / death bookends (sim frozen, screen keys only) ----
  if (screen == Screen::Title) {
    if (keyN && !prevN) startRun(seed);
    if (keyL && !prevL) loadRun();
    if (screen == Screen::Title && keyLMB && !prevTitleLMB) startRun(seed); // "New Game" button (mouse)
    prevTitleLMB = keyLMB;
    prevN = keyN; prevY = keyY; prevL = keyL; prevS = keyS;
  }
  if (screen == Screen::Dead) {
    if (keyN && !prevN) startRun((int)(rng.next() * 2147483647));
    else if (keyY && !prevY) _ngPlus();
    else if (keyL && !prevL) loadRun();
    else if (keyS && !prevS) { _writeSave(); toast("Run saved — continue with [L]"); }
    prevN = keyN; prevY = keyY; prevL = keyL; prevS = keyS;
  }
  prevN = keyN; prevY = keyY; prevL = keyL; prevS = keyS;

  // hit-stop: freeze the whole sim (movement + entities + combat) for kHitStop
  if (hitStop > 0) { hitStop -= rawDt; mouseDX = mouseDY = 0; return; }
  // Electric chain visuals: advance flash + arcs
  if (flashT > 0) flashT -= rawDt;
  // Arcs: arch up slightly for visual effect (already baked in at spawn)
  const float sens = (float)player::kSensitivity;
  // ---- look (pointer-locked) ----
  if (pointerLocked) {
    state.player.yaw -= mouseDX * sens;
    // Mouse-up = look UP: GLFW y grows downward, so mouseDY<0 on upward moves;
    // camera forward Y = -sin(pitch), so pitch must DECREASE to look up.
    state.player.pitch += mouseDY * sens;
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
  // The safeSpawn grace period no longer freezes the PLAYER — they can move
  // (and fight) immediately at level start. It still keeps enemies passive
  // (see ctx.safeSpawn / drainQueue) so the opening seconds aren't a brawl.
  const bool moving = (mx != 0 || mz != 0);
  const bool sprintHeld = keyShift;
  const bool sprinting = sprintHeld && moving;
  // JS: updateSprint(rawDt, sprintHeld, moving && sprintHeld, safeSpawn>0)
  state.updateSprint(rawDt, sprintHeld, moving && sprintHeld, false);
  const double sprintMult = state.sprintSpeedMult();
  if (moving) {
    dc::Mover pos{state.player.x, state.player.z};
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
  // 180 s per level: run out → the run ends (reason "time"; §2/§24 "The
  // darkness consumes you"). Fires once, even on the title/first frames.
  if (state.levelTime >= dc::kLevelTimeLimit && screen == Screen::Play) {
    screen = Screen::Dead;
    deathReason = "time";
    _endRun("time");
  }

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
  // ---- window resize / fullscreen: track the real framebuffer and realloc the
  //      window-sized render targets (scene/bright/glow) when it changes ----
  {
    int fw = 0, fh = 0;
    glfwGetFramebufferSize(window, &fw, &fh);
    if (fw > 0 && fh > 0 && (fw != width || fh != height)) {
      width = fw; height = fh;
      recreateWindowTargets();
    }
  }
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
  Mat4 vpMat = proj * view; // GL order: project *after* view
  // Store viewProj for health bars in drawHud()
  std::memcpy(viewProjM, vpMat.m, sizeof(viewProjM));

  // torch shadow VP (single 256² pass, static)
  Mat4 torchView = Mat4::lookAt(torchPos, at, up);
  Mat4 torchProj = Mat4::perspective(90.0f, 1.0f, 0.2f, 80.0f);
  Mat4 torchVP = torchProj * torchView;

  // ---- dynamic entities (boss + skeletons) → streamed VBO, drawn in both passes ----
  {
    std::vector<float> dyn;
    std::vector<float> enem;
    uploadDynamic(dyn, enem);
    dynCount = (int)(dyn.size() / 18);
    if (dynCount > 0) {
      glBindBuffer(GL_ARRAY_BUFFER, dynVbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(dyn.size() * sizeof(float)), dyn.data());
      glBindBuffer(GL_ARRAY_BUFFER, 0);
    }
    enemCount = (int)(enem.size() / 18);
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
  drawGroup(world.instWallProps, world.nWallProps);  // §13 wall props (sconces, pillars)

  // ---- 2) scene pass ----
  glBindFramebuffer(GL_FRAMEBUFFER, sceneFbo);
  glViewport(0, 0, width, height);
  glClearColor(0.02, 0.02, 0.03, 1.0);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glEnable(GL_DEPTH_TEST);
  glUseProgram(progScene);
  glUniformMatrix4fv(glGetUniformLocation(progScene, "uViewProj"), 1, GL_FALSE, vpMat.m);
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

  // Wall props: instanced against walls, lit by torch + headlight.
  drawGroup(world.instWallProps, world.nWallProps);

  // ---- §13 decorative passes (JS SmokeSystem / ParticleSystem / RuneSystem
  //      + water puddles): transparent, depth-tested, no depth write. Degraded
  //      mode sheds the tail: draw count halved (spec §22 rule 1). ----
  glDepthMask(GL_FALSE);
  {
    const float tDec = (float)state.runTime;
  // NOTE: uTime is set below in each decorative sub-pass where tDec is in scope.
    // (a) water: VAULT-room puddles (0x3a6a8a, opacity 0.75, sine wave).
    if (!waterData.empty()) {
      glDisable(GL_CULL_FACE);
      glEnable(GL_DEPTH_TEST);
      int wn = (int)(waterData.size() / 6);
      if (degraded) wn /= 2;
      if (wn > 0) {
        glBindBuffer(GL_ARRAY_BUFFER, waterInst);
        glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(wn * 6 * sizeof(float)), waterData.data());
        glUseProgram(progWater);
        glUniformMatrix4fv(glGetUniformLocation(progWater, "uViewProj"), 1, GL_FALSE, vpMat.m);
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
      {
        std::vector<float> dd(dc::kAmbientDustParticles * 3);
        for (int i = 0; i < dc::kAmbientDustParticles; i++) {
          dd[i * 3 + 0] = dust[i * 3 + 0];
          dd[i * 3 + 1] = dust[i * 3 + 1];
          dd[i * 3 + 2] = dust[i * 3 + 2];
        }
        glBindBuffer(GL_ARRAY_BUFFER, dustVbo);
        glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(dd.size() * sizeof(float)), dd.data());
      }
      glUseProgram(progDust);
      glUniformMatrix4fv(glGetUniformLocation(progDust, "uViewProj"), 1, GL_FALSE, vpMat.m);
      glUniformMatrix4fv(glGetUniformLocation(progDust, "uView"), 1, GL_FALSE, view.m);
      // JS PointsMaterial size 0.045 world units => quad radius 0.045 (matches old 8px clamp)
      glUniform1f(glGetUniformLocation(progDust, "uDustRad"), 0.045f);
      glUniform3f(glGetUniformLocation(progDust, "uColor"), 0.784f, 0.722f, 0.533f); // 0xc8b888
      glUniform1f(glGetUniformLocation(progDust, "uOpacity"), 0.45f);
      glUniform1f(glGetUniformLocation(progDust, "uTime"), tDec);
      glBlendFunc(GL_SRC_ALPHA, GL_ONE); // additive (JS blending: AdditiveBlending)
      glBindVertexArray(dustVao);
      glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, dn);
      glBindVertexArray(0);
    }
    // §13 Atmospheric particles (embers/snow/spores/crystal): 50 instances, additive glow.
    {
      float atmoData[50 * 4];
      for (int i = 0; i < 50; i++) {
        atmoData[i * 4 + 0] = atmoPos[i][0];
        atmoData[i * 4 + 1] = atmoPos[i][1];
        atmoData[i * 4 + 2] = atmoPos[i][2];
        atmoData[i * 4 + 3] = atmoType[i];
      }
      glBindBuffer(GL_ARRAY_BUFFER, atmoVbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(50 * 4 * sizeof(float)), atmoData);
      glUseProgram(progAtmo);
      glUniformMatrix4fv(glGetUniformLocation(progAtmo, "uViewProj"), 1, GL_FALSE, vpMat.m);
      glUniformMatrix4fv(glGetUniformLocation(progAtmo, "uView"), 1, GL_FALSE, view.m);
      glUniform1f(glGetUniformLocation(progAtmo, "uAtmoRad"), 0.06f);
      glUniform3f(glGetUniformLocation(progAtmo, "uColor"), atmoColor[0], atmoColor[1], atmoColor[2]);
      glUniform1f(glGetUniformLocation(progAtmo, "uOpacity"), 0.35f);
      glUniform1f(glGetUniformLocation(progAtmo, "uTime"), tDec);
      glBlendFunc(GL_SRC_ALPHA, GL_ONE); // additive
      glBindVertexArray(atmoVao);
      glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, 50);
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
        glUniformMatrix4fv(glGetUniformLocation(progRune, "uViewProj"), 1, GL_FALSE, vpMat.m);
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
      {
        std::vector<float> sp(dc::kSmokeParticles * 4);
        for (int i = 0; i < dc::kSmokeParticles; i++) {
          sp[i * 4 + 0] = smoke[i].x;
          sp[i * 4 + 1] = smoke[i].y;
          sp[i * 4 + 2] = smoke[i].z;
          sp[i * 4 + 3] = smoke[i].active ? smoke[i].alpha : 0.0f;
        }
        glBindBuffer(GL_ARRAY_BUFFER, smokeVbo);
        glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(sp.size() * sizeof(float)), sp.data());
      }
      glUseProgram(progSmoke);
      glUniformMatrix4fv(glGetUniformLocation(progSmoke, "uViewProj"), 1, GL_FALSE, vpMat.m);
      glUniformMatrix4fv(glGetUniformLocation(progSmoke, "uView"), 1, GL_FALSE, view.m);
      glUniform3f(glGetUniformLocation(progSmoke, "uColor"), 0.2f, 0.2f, 0.251f); // 0x333340
      // JS gl_PointSize = 90.0/-mv.z => world radius = 90 * tan(fov/2) / height
      glUniform1f(glGetUniformLocation(progSmoke, "uSmokeRad"),
                  90.0f * std::tan(fov * (float)M_PI / 360.0f) / (float)height);
      glUniform1f(glGetUniformLocation(progSmoke, "uTime"), tDec);
      glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); // JS: transparent (normal blend)
      glBindVertexArray(smokeVao);
      glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, sn);
      glBindVertexArray(0);
    }
  }
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glDepthMask(GL_TRUE);

  drawGroup(dynVbo, dynCount, 1.0f, 72); // boss/skeletons: 18-float instances, emissive

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
    glUniformMatrix4fv(glGetUniformLocation(progMask, "uViewProj"), 1, GL_FALSE, vpMat.m);
    glBindVertexArray(vao);
    glBindBuffer(GL_ARRAY_BUFFER, enemVbo);
    { void* z = nullptr; const int st = 72; // 18-float instance = 72 bytes
      glEnableVertexAttribArray(2); glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, st, z); glVertexAttribDivisor(2, 1);
      glEnableVertexAttribArray(3); glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, st, (void*)12); glVertexAttribDivisor(3, 1);
      glEnableVertexAttribArray(4); glVertexAttribPointer(4, 3, GL_FLOAT, GL_FALSE, st, (void*)24); glVertexAttribDivisor(4, 1);
      // kLitVert also reads aRot0/1/2 + aRegion: bind from the 18-float stream
      glEnableVertexAttribArray(5); glVertexAttribPointer(5, 3, GL_FLOAT, GL_FALSE, st, (void*)36); glVertexAttribDivisor(5, 1);
      glEnableVertexAttribArray(6); glVertexAttribPointer(6, 3, GL_FLOAT, GL_FALSE, st, (void*)48); glVertexAttribDivisor(6, 1);
      glEnableVertexAttribArray(7); glVertexAttribPointer(7, 3, GL_FLOAT, GL_FALSE, st, (void*)60); glVertexAttribDivisor(7, 1);
      glDisableVertexAttribArray(8); glVertexAttrib4f(8, 0.0f, 0.0f, 0.0f, 1.0f); }
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
  // enhanced composite: vignette pulse + near-miss border
  // (uTime set in the decorative passes block where tDec is in scope)
  // NOTE: composite shader receives tDec via the uTime uniform set below
  // Actually we need to set it here - let's use a local variable
  float _tDec = (float)state.runTime;
  glUniform1f(glGetUniformLocation(progComposite, "uTime"), _tDec);
  glUniform1f(glGetUniformLocation(progComposite, "uNearMiss"), 0.0f); // placeholder: set on near-miss
  glUniform1f(glGetUniformLocation(progComposite, "uGlowPulse"), (float)glowPulse);
  glBindVertexArray(quadVao);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glBindVertexArray(0);

  // ---- ELECTRIC CHAIN screen flash (bright blue-white, additive) ----
  if (flashT > 0.01f && arcCount > 0) {
    const float flashAlpha = (float)(flashT / 0.25);
    const float a = std::max(0.0f, std::min(1.0f, flashAlpha * 2.0f));
    drawOverlay(0.55f * a, 0.70f * a, 1.0f * a, a * 0.45f);
  }

  // ---- 4) title / death text overlay (screen-space, blended) ----
  if (screen == Screen::Title || screen == Screen::Dead) {
    // dim / tint the scene behind the bookend text (Dark Souls "YOU DIED" red)
    if (screen == Screen::Dead) drawOverlay(0.10f, 0.02f, 0.02f, 0.72f);
    else drawOverlay(0.01f, 0.01f, 0.03f, 0.55f);
    std::vector<float> v;
    std::vector<float> vMenu; // separate buffer for menu font (URW Bookman)
    const float gold[3] = {0.91f, 0.78f, 0.35f};
    const float sub[3] = {0.60f, 0.54f, 0.38f};
    const float hint[3] = {0.55f, 0.55f, 0.55f};
    const float red[3] = {0.69f, 0.19f, 0.19f};
    const float stat[3] = {0.85f, 0.79f, 0.63f};
    const float cx = width / 2.0f, cy = height * 0.30f;
    if (screen == Screen::Title) {
      const char* t = "THE DEPTHS";
      drawTextOutline(v, cx - lineW(t, 3.0f) / 2, cy, 3.0f, gold, t);
      const char* s = "A SOULS DESCENT";
      drawTextOutline(v, cx - lineW(s, 0.9f) / 2, cy + 110, 0.9f, sub, s);
      // Top-5 leaderboard (renders with menu font into vMenu).
      if (leaderboard)
        drawLeaderboard(cy + 170, 5, hint, v, vMenu, cx);
      const char* n = "New Game  [N]";
      drawTextOutline(v, cx - lineW(n, 1.2f) / 2, cy + 290, 1.2f, hint, n);
      if (savedRun) {
        const char* l = "Continue  [L]";
        drawTextOutline(v, cx - lineW(l, 1.2f) / 2, cy + 340, 1.2f, hint, l);
      }
    } else {
      // §24 death titles: killed vs time-out.
      const char* t = (std::strcmp(deathReason, "time") == 0)
                         ? "The darkness consumes you" : "The dead claim you";
      drawTextOutline(v, cx - lineW(t, 2.4f) / 2, cy, 2.4f, red, t);
      char buf[160];
      std::snprintf(buf, sizeof(buf), "Level %d   Souls %d   Time %ds",
                    state.level, state.collectedOrbs, (int)state.runTime);
      drawTextOutline(v, cx - lineW(buf, 1.0f) / 2, cy + 90, 1.0f, stat, buf);
      // Top-5 leaderboard below stats (renders with menu font into vMenu).
      if (leaderboard) {
        drawLeaderboard(cy + 130, 5, stat, v, vMenu, cx);
        // Player rank: use the submission date from _endRun for proper lookup.
        char rankBuf[160];
        int rank = -1;
        if (lastRunDate.has_value()) {
          dc::ScoreEntry lookup{state.ngPlus, state.level, state.runTime, state.collectedOrbs, *lastRunDate};
          rank = leaderboard->rankOf(lookup);
        }
        std::snprintf(rankBuf, sizeof(rankBuf), "Your rank: #%d", rank > 0 ? rank : -1);
        drawTextOutline(v, cx - lineW(rankBuf, 0.9f) / 2, cy + 270, 0.9f, hint, rankBuf);
      }
      const char* n = "[N] Restart   [Y] New Game+";
      drawTextOutline(v, cx - lineW(n, 1.2f) / 2, cy + 180, 1.2f, hint, n);
      // Live NG+ preview: keeps all souls, ×2 damage per tier. §NG+.
      {
        const int ngTier = state.ngPlus;
        const float ngDmg = std::pow(2.0, ngTier);
        char tol[160];
        std::snprintf(tol, sizeof(tol),
                      "New Game+ keeps ALL souls → DMG ×%.0f",
                      ngDmg);
        const float tolC[3] = {0.62f, 0.80f, 0.88f}; // #9ecbe0 buff-blue
        drawTextOutline(v, cx - lineW(tol, 0.9f) / 2, cy + 215, 0.9f, tolC, tol);
      }
      // Save-for-later [S]: persist this run so it can be continued later.
      const char* sv = "Save for later   [S]";
      drawTextOutline(v, cx - lineW(sv, 1.2f) / 2, cy + 300, 1.2f, hint, sv);
      if (savedRun) {
        const char* l = "Continue  [L]";
        drawTextOutline(v, cx - lineW(l, 1.2f) / 2, cy + 350, 1.2f, hint, l);
      }
    }
    drawText(v);
    drawTextMenu(vMenu);
  }

  // ---- 4.5) compute health bar positions (boss + enemies) ----
  _computeHpBars();

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
  // 48px bake — HUD sizes draw glyphs at ~24-48 screen px; bump atlas to
  // 1024×512 so GL_LINEAR stays crisp at size 1.0f+ (was 512×256 → mushy).
  const int P = 48, AW = 1024, AH = 512;
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

void App::drawTextOutline(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s) {
  // Outline width follows the DOUBLED glyph size (drawTextLine applies the 2x
  // internally) — a 2px ring at HUD scale reads as a tight dark edge.
  const float o = std::max(2.0f, size * 2.0f * 0.18f);
  const float dark[3] = {0.02f, 0.01f, 0.0f};
  // 4-way dark outline (drawn first, behind the fill).
  drawTextLine(v, x + o, y, size, dark, s);
  drawTextLine(v, x - o, y, size, dark, s);
  drawTextLine(v, x, y + o, size, dark, s);
  drawTextLine(v, x, y - o, size, dark, s);
  // Soft drop shadow (down-right, low alpha) for lift off bright backgrounds.
  const float sh[3] = {0.0f, 0.0f, 0.0f};
  drawTextLine(v, x + o * 0.7f, y + o * 0.7f, size, sh, s);
  // Fill on top.
  drawTextLine(v, x, y, size, col, s);
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

// ---- menu text helpers (use menuFont — URW Bookman Blackletter) ----
float App::menuLineW(const char* s, float size) {
  float w = 0;
  for (const char* p = s; *p; p++) {
    int c = (unsigned char)*p;
    if (c < 32 || c >= 128) continue;
    w += menuFont.adv[c] * size;
  }
  return w;
}

void App::drawTextLineMenu(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s) {
  for (const char* p = s; *p; p++) {
    int c = (unsigned char)*p;
    if (c < 32 || c >= 128) continue;
    float gw = (float)menuFont.w[c] * size, gh = (float)menuFont.h[c] * size;
    float u0 = menuFont.uv[c][0], v0 = menuFont.uv[c][1], u1 = menuFont.uv[c][2], v1 = menuFont.uv[c][3];
    float x1 = x + gw, y1 = y + gh;
    auto P = [&](float px, float py, float u, float vv) {
      v.insert(v.end(), {px, py, u, vv, col[0], col[1], col[2], 1.0f});
    };
    P(x, y, u0, v0); P(x1, y, u1, v0); P(x1, y1, u1, v1); // tri 1
    P(x, y, u0, v0); P(x1, y1, u1, v1); P(x, y1, u0, v1); // tri 2
    x += menuFont.adv[c] * size;
  }
}

void App::drawTextOutlineMenu(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s) {
  const float o = std::max(3.0f, size * 2.0f * 0.2f);
  const float dark[3] = {0.02f, 0.01f, 0.0f};
  drawTextLineMenu(v, x + o, y, size, dark, s);
  drawTextLineMenu(v, x - o, y, size, dark, s);
  drawTextLineMenu(v, x, y + o, size, dark, s);
  drawTextLineMenu(v, x, y - o, size, dark, s);
  const float sh[3] = {0.0f, 0.0f, 0.0f};
  drawTextLineMenu(v, x + o * 0.7f, y + o * 0.7f, size, sh, s);
  drawTextLineMenu(v, x, y, size, col, s);
}

void App::drawTextMenu(const std::vector<float>& v) {
  if (v.empty() || !menuFont.ok) return;
  glUseProgram(progTextMenu);
  glUniform2f(glGetUniformLocation(progTextMenu, "uRes"), (float)width, (float)height);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, menuFont.tex);
  glBindBuffer(GL_ARRAY_BUFFER, textMenuVbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * 4), v.data(), GL_DYNAMIC_DRAW);
  glBindVertexArray(textMenuVao);
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
    drawTextOutline(t, m + 10, m + 8, 0.45f, label, "VITALITY");
    const float bw = 178.0f, bh = 12.0f, bx = m + 10, by = m + 26;
    rect(bx, by, bw, bh, hpBg[0], hpBg[1], hpBg[2], hpBg[3]);
    const double frac = std::max(0.0, std::min(1.0, simHealth / std::max(1.0, (double)state.maxHealth)));
    rect(bx, by, (float)(bw * frac), bh, hpFill[0], hpFill[1], hpFill[2], hpFill[3]);
    char num[32];
    std::snprintf(num, sizeof(num), "%d / %d", state.health, state.maxHealth);
    drawTextOutline(t, m + 10, by + bh + 5, 0.45f, hpNum, num);
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
      drawTextOutline(t, xR - 12 - lineW(s, size), y, size, c, s);
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
    const double dmgMult = dc::damageMult(scale, state.weaponTier, state.level, state.collectedOrbs);
    std::snprintf(lines[0], sizeof(lines[0]), "DMG \xc3\x97%.2f", dmgMult);
    std::snprintf(lines[1], sizeof(lines[1]), "Orb DMG %.2f", 1.0 + 0.02 * state.collectedOrbs);
    std::snprintf(lines[2], sizeof(lines[2]), "Reach %.1f", 2.2 * scale * (1.0 + 0.04 * state.weaponTier));
    std::snprintf(lines[3], sizeof(lines[3]), "Enemy HP \xc3\x97%.1f", 1.0 + 1.0 * state.ngPlus);
    std::snprintf(lines[4], sizeof(lines[4]), "Mob speed \xc3\x97%.2f",
                   (1.0 + 0.02 * (state.level - 1)) * (1.0 + 0.1 * state.bossKills));
    std::snprintf(lines[5], sizeof(lines[5]), "Spawns \xc3\x97%.2f",
                   std::min(1.0 + (state.level + state.collectedOrbs) / 10.0, 100.0));
    std::snprintf(lines[6], sizeof(lines[6]), "Regen +1/%ds", (int)dc::player::kRegenInterval);
    const float lineH = 14.0f;
    const float ph = 24.0f + 7 * lineH + 6.0f;
    rect(xR - pw, y0, pw, ph, panel[0], panel[1], panel[2], panel[3]);
    drawTextOutline(t, xR - pw / 2 - lineW("COMBAT", 0.4f) / 2, y0 + 8, 0.4f, label, "COMBAT");
    const float statC[3] = {0.85f, 0.79f, 0.63f}; // #d8c9a0
    for (int i = 0; i < 7; i++) drawTextOutline(t, xR - pw + 12, y0 + 24 + i * lineH, 0.42f, statC, lines[i]);
  }

  // ---- top-center: LEVEL · BIOME + timer + NG+ badge ----
  {
    const float cx = W / 2.0f;
    char lvl[64];
    const auto& bd = dc::kBiomes.at(state.biome);
    std::snprintf(lvl, sizeof(lvl), "LEVEL %d · %s", state.level, bd.label.c_str());
    drawTextOutline(t, cx - lineW(lvl, 0.55f) / 2, m + 6, 0.55f, biome, lvl);

    // NG+ badge — bold, bright gold, only when active
    if (state.ngPlus > 0) {
      char ngText[16];
      std::snprintf(ngText, sizeof(ngText), "NG+%d", state.ngPlus);
      const float ngBadge[3] = {1.0f, 0.85f, 0.1f}; // bright gold #ffdb1a
      const float badgeW = lineW(ngText, 0.75f);
      // background panel
      const float pad = 6.0f;
      rect(cx - badgeW / 2 - pad, m + 22, badgeW + 2 * pad, 22, 0.15f, 0.1f, 0.02f, 0.9f);
      drawTextOutline(t, cx - lineW(ngText, 0.75f) / 2, m + 26, 0.75f, ngBadge, ngText);
    }

    const double remain = std::max(0.0, dc::kLevelTimeLimit - state.levelTime);
    const int mm = (int)(remain / 60.0), ss = (int)(remain - 60.0 * mm);
    char tm[24];
    std::snprintf(tm, sizeof(tm), "%d:%02d", mm, ss);
    const float* tc = (remain < 30.0) ? timerLow : timerC;
    drawTextOutline(t, cx - lineW(tm, 0.85f) / 2, m + 50, 0.85f, tc, tm);
  }

  // ---- bottom-center: boss bar (only when a boss is live) ----
  if (bossReady && !boss.dead) {
    const float cx = W / 2.0f, bw = 420.0f, bh = 10.0f;
    const float by = H - 64.0f;
    const std::string lbl = dc::kBossLabels.count(boss.variant) ? dc::kBossLabels.at(boss.variant) : std::string("BOSS");
    drawTextOutline(t, cx - lineW(lbl.c_str(), 0.5f) / 2, by - 20, 0.5f, bossLbl, lbl.c_str());
    rect(cx - bw / 2, by, bw, bh, bossBg[0], bossBg[1], bossBg[2], bossBg[3]);
    const double frac = std::max(0.0, std::min(1.0, boss.hp / std::max(1.0, boss.maxHp)));
    rect(cx - bw / 2, by, (float)(bw * frac), bh, bossFill[0], bossFill[1], bossFill[2], bossFill[3]);
  }

  // ---- 4.5) floating health bars above enemies and boss ----
  {
    const float barW = 60.0f, barH = 6.0f;
    const float bg[4] = {0.15f, 0.05f, 0.05f, 1.0f};
    const float fill[4] = {0.20f, 0.65f, 0.15f, 1.0f};
    const float fillLow[4] = {0.70f, 0.20f, 0.15f, 1.0f};
    for (size_t i = 0; i < bossHpBar.size(); i++) {
      const HpBarPos& b = bossHpBar[i];
      const float x0 = b.sx - barW / 2, y0 = b.sy;
      const float w = barW * b.frac;
      const float* col = b.frac < 0.3f ? fillLow : fill;
      rect(x0, y0, barW, barH, bg[0], bg[1], bg[2], bg[3]);
      rect(x0, y0, w, barH, col[0], col[1], col[2], col[3]);
    }
    for (size_t i = 0; i < enemyHpBars.size(); i++) {
      const HpBarPos& b = enemyHpBars[i];
      const float x0 = b.sx - barW / 2, y0 = b.sy;
      const float w = barW * b.frac;
      const float* col = b.frac < 0.3f ? fillLow : fill;
      rect(x0, y0, barW, barH, bg[0], bg[1], bg[2], bg[3]);
      rect(x0, y0, w, barH, col[0], col[1], col[2], col[3]);
    }
  }

  // degraded-mode perf warning (bottom-right, gold) — mirrors JS #perf-warning.
  // Sticky state (bloom stays off), but the LABEL hides on fps recovery (JS does the same).
  if (degraded && (curFps < 30.0 || forcedDegraded)) {
    const char* w = "DEGRADED MODE — bloom off for performance";
    const float perfWarn[4] = {0.85f, 0.63f, 0.23f, 1.0f};
    drawTextOutline(t, W - m - lineW(w, 0.4f), H - 24, 0.4f, perfWarn, w);
  }

  // ---- toasts (#messages): bottom-center stack, oldest on top, newest at
  //      bottom:170 — JS _message() 3.3 s life, max 4, color #efe0ac ----
  {
    const float toastC[3] = {0.937f, 0.878f, 0.675f}; // #efe0ac
    const float baseY = H - 170.0f, lineH = 24.0f;
    for (size_t i = toasts.size(); i-- > 0; ) {
      const float y = baseY - (int)(toasts.size() - 1 - i) * lineH;
      drawTextOutline(t, W / 2.0f - lineW(toasts[i].text.c_str(), 0.6f) / 2, y, 0.6f, toastC, toasts[i].text.c_str());
    }
  }

  drawRects(v);
  drawText(t);
}

void App::drawLeaderboard(double cyOffset, int topN, const float col[3],
                          std::vector<float>& v, std::vector<float>& vMenu, float cx) {
  if (!leaderboard || leaderboard->top().empty()) return;

  const float cy = (float)height * 0.30f + (float)cyOffset;
  const float rowH = 22.0f;

  const auto entries = leaderboard->top();
  const int n = std::min(topN, static_cast<int>(entries.size()));

  // Header
  const float hdrCol[3] = {0.55f, 0.50f, 0.38f};
  const char* hdr = "#    NG+   Level    Souls    Time";
  float hdrW = menuLineW(hdr, 0.85f);
  drawTextOutlineMenu(vMenu, cx - hdrW / 2, cy - 18, 0.85f, hdrCol, hdr);

  for (int i = 0; i < n; i++) {
    const auto& e = entries[i];
    char entryStr[128];
    std::snprintf(entryStr, sizeof(entryStr), "%d    NG+%d    L%d    %d    %ds",
                  i + 1, e.ngPlus, e.level, e.orbs, (int)e.time);

    const float y = cy + i * rowH;
    float rowCol[3];
    for (int k = 0; k < 3; k++) rowCol[k] = col[k];
    drawTextOutlineMenu(vMenu, cx - menuLineW(entryStr, 0.8f) / 2, y, 0.8f, rowCol, entryStr);
  }
}

void App::_writeSave() {
  const auto sv = state.toSave();
  savedRun = sv; // available for Continue [L]
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
}

void App::_endRun(const char* reason) {
  deathReason = reason ? reason : "dead";
  // save-for-later (JS writes this at death; Load restores a full-health level)
  _writeSave();
  if (!leaderboard) return;
  dc::ScoreEntry e;
  e.level = state.level;
  e.time = state.runTime;
  e.orbs = state.collectedOrbs;
  e.ngPlus = state.ngPlus;
  e.date = (std::int64_t)(std::time(nullptr) * 1000);
  lastRunDate = e.date;
  leaderboard->submit(e);
  std::fprintf(stderr, "[dc_app] run ended (%s) — leaderboard rank #%d, save written (%s)\n",
               deathReason, leaderboard->rankOf(e), saveFile.c_str());
}

bool App::_readSaveFile() {
  // Minimal JSON read of the fields _endRun writes (the schema is fixed).
  FILE* f = fopen(saveFile.c_str(), "r");
  if (!f) { savedRun.reset(); return false; }
  char buf[512] = {0};
  const size_t n = std::fread(buf, 1, sizeof(buf) - 1, f);
  std::fclose(f);
  if (n == 0) { savedRun.reset(); return false; }
  auto grab = [&](const char* key, long& out) -> bool {
    const char* p = std::strstr(buf, key);
    if (!p) return false;
    p = std::strchr(p, ':');
    if (!p) return false;
    out = std::atol(p + 1);
    return true;
  };
  long level = 1, runTime = 0, orbs = 0, tier = 0, maxH = 0, ng = 0, kills = 0, hp = 0;
  grab("\"level\"", level);
  grab("\"runTime\"", runTime);
  grab("\"collectedOrbs\"", orbs);
  grab("\"weaponTier\"", tier);
  grab("\"maxHealth\"", maxH);
  grab("\"ngPlus\"", ng);
  grab("\"bossKills\"", kills);
  grab("\"health\"", hp);
  savedRun = dc::GameState::Save{
      (int)level, (double)runTime, (int)orbs, (int)tier,
      (int)maxH, (int)ng, (int)kills, (int)hp};
  return true;
}

void App::loadRun() {
  if (!savedRun) return;
  auto gs = dc::GameState::fromSave(*savedRun);
  if (!gs) return;
  state = *gs;
  state.buffEffect = 0; state.buffTime = 0; // a carried buff never survives a load
  state.levelTime = 0;                      // the 180 s clock restarts with the level
  state.inExitRoom = false;
  state.dungeonSeed = (int)(rng.next() * 2147483647);
  state.biome = dc::biomeForLevel(state.level);
  state.biomeIndex = [&] {
    auto it = std::find(dc::kBiomeSequence.begin(), dc::kBiomeSequence.end(), state.biome);
    return (int)(it != dc::kBiomeSequence.end() ? (it - dc::kBiomeSequence.begin()) : 0);
  }();
  buildWorldFromState();
  placePlayerAtEntrance();
  spawnEntities();
  simHealth = state.health;                 // fromSave: full-health restart of the level
  playerDead = false;
  bossKillCounted = false;
  screen = Screen::Play;
  std::fprintf(stderr, "[dc_app] loaded run (level %d, souls %d)\n",
               state.level, state.collectedOrbs);
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

void App::_computeHpBars() {
  // §4.5: project boss + enemy positions onto screen space; populate bossHpBar / enemyHpBars.
  bossHpBar.clear(); enemyHpBars.clear();
  if (screen != Screen::Play) return;
  const float W2 = (float)width, H2 = (float)height;
  struct ScreenPos { float x, y; };
  auto project3D = [&](float wx, float wy, float wz) -> ScreenPos {
    float cx = viewProjM[0]*wx + viewProjM[4]*wy + viewProjM[8]*wz + viewProjM[12];
    float cy = viewProjM[1]*wx + viewProjM[5]*wy + viewProjM[9]*wz + viewProjM[13];
    float cw = viewProjM[3]*wx + viewProjM[7]*wy + viewProjM[11]*wz + viewProjM[15];
    if (cw <= 0.01f) return {-9999,-9999};
    float sx = (cx/cw)*0.5f+0.5f, sy = (cy/cw)*0.5f+0.5f;
    return {sx*W2, (1.0f-sy)*H2};
  };
  if (bossReady && !boss.dead) {
    auto sp = project3D((float)boss.pos.x, 1.5f, (float)boss.pos.z);
    float frac = boss.maxHp > 0 ? (float)boss.hp/boss.maxHp : 1.0f;
    if (frac < 1.0f) { HpBarPos eb; eb.sx=sp.x; eb.sy=sp.y; eb.frac=frac; bossHpBar.push_back(eb); }
  }
  for (dc::Enemy& e : skelsys.enemies()) {
    if (!e.alive() || e.hp >= e.maxHp) continue;
    float eY = e.floats ? 1.5f : 1.2f;
    auto sp = project3D((float)e.pos.x, eY, (float)e.pos.z);
    float frac = e.maxHp > 0 ? (float)e.hp/e.maxHp : 1.0f;
    if (frac < 1.0f) { HpBarPos eb; eb.sx=sp.x; eb.sy=sp.y; eb.frac=frac; enemyHpBars.push_back(eb); }
  }
  std::sort(bossHpBar.begin(), bossHpBar.end(), [](const HpBarPos& a, const HpBarPos& b){ return a.sy < b.sy; });
  std::sort(enemyHpBars.begin(), enemyHpBars.end(), [](const HpBarPos& a, const HpBarPos& b){ return a.sy < b.sy; });
}

void App::_ngPlus() {
  // New Game+: keeps all souls (no toll), permanent ×2 damage per NG+ tier. §NG+.
  const int prevOrbs = state.collectedOrbs;
  const int ng = state.ngPlus + 1;
  state.ngPlus = ng;
  state.health = state.maxHealth; // full-heal the new NG+ run
  state.biome = dc::biomeForLevel(state.level);
  state.biomeIndex = [&] {
    auto it = std::find(dc::kBiomeSequence.begin(), dc::kBiomeSequence.end(), state.biome);
    return (int)(it != dc::kBiomeSequence.end() ? (it - dc::kBiomeSequence.begin()) : 0);
  }();
  state.dungeonSeed = (int)(rng.next() * 2147483647);
  dc::DungeonGenerator gen(state.dungeonSeed, state.biome);
  world.dungeon = gen.generate();
  buildWorldFromState();
  placePlayerAtEntrance();
  spawnEntities();
  simHealth = state.maxHealth;
  playerDead = false;
  screen = Screen::Play;
  std::fprintf(stderr, "[dc_app] NG+%d started (level %d, %d souls, DMG ×%.0f)\n",
               ng, state.level, prevOrbs, dc::ngPlusDamageMult(ng));
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
  else if (key == GLFW_KEY_L) g_app->keyL = down;
  else if (key == GLFW_KEY_LEFT_SHIFT || key == GLFW_KEY_RIGHT_SHIFT) g_app->keyShift = down;
  else if (key == GLFW_KEY_F11 && action == GLFW_PRESS) g_app->toggleFullscreen();
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
  int width = 1024, height = 720, frames = 0, seed = 1000, saveFrame = -1, level = 1;
  const char* savePath = nullptr;
  bool showFps = false, bossView = false, combatView = false, descendView = false;
  bool titleView = false, deathView = false, hudView = false, degradedView = false;
  bool playView = false;
  bool enemyView = false, dropView = false, burnView = false;
  bool swordView = false;
  bool hunterView = false;
  bool vaultView = false, timeoutView = false, startView = false, loadView = false;
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
    else if (!std::strcmp(argv[i], "--play")) playView = true;
    else if (!std::strcmp(argv[i], "--death-view")) deathView = true;
    else if (!std::strcmp(argv[i], "--hud-view")) hudView = true;
    else if (!std::strcmp(argv[i], "--degraded")) degradedView = true;
    else if (!std::strcmp(argv[i], "--enemy-view")) enemyView = true;
    else if (!std::strcmp(argv[i], "--drop-view")) dropView = true;
    else if (!std::strcmp(argv[i], "--sword-view")) swordView = true;
    else if (!std::strcmp(argv[i], "--hunter-view")) hunterView = true;
    else if (!std::strcmp(argv[i], "--vault-view")) vaultView = true;
    else if (!std::strcmp(argv[i], "--burn-view")) burnView = true;
    else if (!std::strcmp(argv[i], "--timeout-view")) timeoutView = true;
    else if (!std::strcmp(argv[i], "--start-view")) startView = true;
    else if (!std::strcmp(argv[i], "--load-view")) loadView = true;
  }

  App app;
  const char* fontPath = "assets/kenpixel.ttf";
  if (!app.init(width, height, "dc_app — Phase 2 playable spine (STONE)", fontPath)) return 1;
  g_app = &app;
  app.seed = seed;
  app._readSaveFile(); // a save-for-later from a prior session → Continue [L]
  // Title screen is the default boot state (JS Game._titleMode = true). Any
  // explicit scene view flag (probe/harness) keeps the old Play behavior so
  // harnesses are unaffected.
  {
    const bool sceneView = bossView || combatView || descendView || vaultView ||
                            enemyView || dropView || burnView || hudView || deathView ||
                            timeoutView || startView || loadView || swordView || hunterView;
    app.screen = playView ? App::Screen::Play
                          : ((titleView || !sceneView) ? App::Screen::Title : App::Screen::Play);
  }
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
      // Deterministic death: 0 HP → the first updateEntities() trips the
      // death check (simHealth <= 0) regardless of boss/skeleton aggro.
      app.simHealth = 0.0;
      std::fprintf(stderr, "[dc_app] death-view: player at throne, no weapons (boss %s)\n",
                   app.boss.state.c_str());
    }
    // --timeout-view: prove the 180 s timer ENDS the run. Make the probe
    // invulnerable (so only the clock can kill it), put the timer ~1 s under the
    // limit, and arm a tier-1 sword so the death screen is the ONLY thing that
    // can appear — it must be the time-out death ("The darkness consumes you").
    if (timeoutView) {
      app.state.safeSpawn = 0;
      app.state.collectedOrbs = 10;
      app.state.weaponTier = dc::weaponTier(app.state.collectedOrbs);
      app.probeInvuln = true;                 // only the timer may end this run
      app.state.levelTime = dc::kLevelTimeLimit - 1.0; // expires in ~60 frames
      std::fprintf(stderr, "[dc_app] timeout-view: timer at %.1f s (limit %.0f s), invulnerable\n",
                   app.state.levelTime, dc::kLevelTimeLimit);
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
    // --start-view: showcase the START marker (green ring + pillar) and the EXIT
    // beam together — stand ~4 cells from the entrance, facing it.
    if (startView) {
      if (const auto& eo = app.world.dungeon.entranceCell) {
        const double cs = app.world.dungeon.cellSize;
        const double wx0 = eo->x * cs, wz0 = eo->z * cs;
        static const double dirs[8][2] = {{1,0},{-1,0},{0,1},{0,-1},{0.7,0.7},{-0.7,0.7},{0.7,-0.7},{-0.7,-0.7}};
        bool found = false;
        for (double dist = 6.0; dist <= 16.0 && !found; dist += 2.0) {
          for (const auto& d : dirs) {
            const double wx = wx0 + d[0] * dist, wz = wz0 + d[1] * dist;
            if (dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) continue;
            if (!dc::hasLineOfSight(app.world.collision.boxes, wx0, wz0, wx, wz)) continue;
            app.camX = wx; app.camZ = wz;
            app.state.player.x = wx; app.state.player.z = wz;
            app.state.player.yaw = (float)std::atan2(-(wx0 - wx), -(wz0 - wz));
            found = true; break;
          }
        }
        std::fprintf(stderr, "[dc_app] start-view: at (%.1f,%.1f) facing entrance (%.1f,%.1f) %s\n",
                     app.camX, app.camZ, wx0, wz0, found ? "" : "(FALLBACK: no LOS spot)");
      }
    }
    // --sword-view: showcase the floating sword's HORIZONTAL swing — stand at
    // the entrance, drive a fixed step/phase (update() ticks it forward).
    if (swordView) {
      if (const auto& eo = app.world.dungeon.entranceCell) {
        const double cs = app.world.dungeon.cellSize;
        const double wx0 = eo->x * cs, wz0 = eo->z * cs;
        static const double dirs[8][2] = {{1,0},{-1,0},{0,1},{0,-1},{0.7,0.7},{-0.7,0.7},{0.7,-0.7},{-0.7,-0.7}};
        bool found = false;
        for (double dist = 6.0; dist <= 14.0 && !found; dist += 2.0) {
          for (const auto& d : dirs) {
            const double wx = wx0 + d[0] * dist, wz = wz0 + d[1] * dist;
            if (dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) continue;
            if (!dc::hasLineOfSight(app.world.collision.boxes, wx0, wz0, wx, wz)) continue;
            app.camX = wx; app.camZ = wz;
            app.state.player.x = wx; app.state.player.z = wz;
            app.state.player.yaw = (float)std::atan2(-(wx0 - wx), -(wz0 - wz));
            found = true; break;
          }
        }
      }
      app.swordStep = 2;
      app.swordPhase = "swing";
      app.swordPhaseT = 0.06;
    }
    // --hunter-view: showcase the HUNTER buff companion — activate the HUNTER
    // buff, stand a few units in front of a live mob facing it, and let the
    // wraith (parked to the player's left) beam it.
    if (hunterView) {
      // Find up to kMaxBeamTargets live mobs (spawn if needed) so the probe
      // showcases the multi-target beam. Freeze every OTHER mob so none
      // chases onto the probe camera; the beam targets stay attackable
      // (unfrozen) but with speed 0 so they can be targeted without moving
      // (hunter.update skips frozen enemies).
      auto& es = app.skelsys.enemies();
      es.reserve(es.size() + 8); // headroom so the pointer captures below stay valid
      std::vector<dc::Enemy*> mobs;
      for (auto& e : es)
        if (e.alive()) { mobs.push_back(&e); if (mobs.size() >= 5) break; }
      while (mobs.size() < 5) { // no mob yet — spawn one a few units ahead
        const float yw = app.state.player.yaw + (mobs.size() - 2) * 0.7f; // fan out
        const float fx = -std::sin(yw), fz = -std::cos(yw);
        dc::Enemy sk;
        sk.type = "BRUTE"; sk.def = &dc::kEnemyTypes.at("BRUTE");
        sk.state = dc::EnemyState::kDormant;
        sk.pos = {app.state.player.x + fx * 7.0, app.state.player.z + fz * 7.0};
        sk.facing = (float)std::atan2(-fx, -fz);
        sk.hp = sk.maxHp = sk.def->hp;
        sk.frozen = false;
        es.push_back(std::move(sk));
        mobs.push_back(&es.back());
      }
      for (auto& e : es)
        if (std::find(mobs.begin(), mobs.end(), &e) == mobs.end()) e.frozen = true; // park the rest
      for (auto* m : mobs) { m->frozen = false; m->speed = 0.0; } // attackable, stationary
      // stand 4u in front of the NEAREST mob, facing it (clear LOS for the beam;
      // the hunter follows ~2.5u behind so hunter→mob ≈ 6.5 < kAttackRange 7)
      {
        dc::Enemy* near = mobs.front();
        for (auto* m : mobs)
          if (std::hypot(m->pos.x - app.state.player.x, m->pos.z - app.state.player.z) <
              std::hypot(near->pos.x - app.state.player.x, near->pos.z - app.state.player.z))
            near = m;
        const double mdx = app.state.player.x - near->pos.x;
        const double mdz = app.state.player.z - near->pos.z;
        const double mdist = std::hypot(mdx, mdz);
        if (mdist > 0.01) {
          const double ux = mdx / mdist, uz = mdz / mdist;
          const double wx = near->pos.x + ux * 4.0;
          const double wz = near->pos.z + uz * 4.0;
          if (!dc::circleHitsBox(app.world.collision.boxes, wx, wz, player::kRadius)) {
            app.camX = wx; app.camZ = wz;
            app.state.player.x = wx; app.state.player.z = wz;
          }
        }
        app.state.player.yaw = (float)std::atan2(-(near->pos.x - app.state.player.x),
                                                  -(near->pos.z - app.state.player.z));
      }
      app.state.buffEffect = 5; // HUNTER — keeps hunter.active=true every frame
      app.state.buffTime = dc::buff::kMaxDuration;
      app.hunter.active = true;
      app.hunter.attackTimer = 0.0; // fire the beam immediately
      // seed the follow pos so the first frame is already near the player
      {
        const float yw = app.state.player.yaw;
        app.hunter.pos = {app.state.player.x + std::sin(yw) * 2.5,
                          app.state.player.z + std::cos(yw) * 2.5};
      }
      std::fprintf(stderr, "[dc_app] hunter-view: HUNTER buff active, facing %s (%zu targets)\n",
                   mobs.front()->type.c_str(), mobs.size());
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
      } else {
        std::fprintf(stderr, "[dc_app] vault-view: no VAULT room this level\n");
      }
    }
    // --load-view: exercise the save-for-later → Load [L] path. A save.json must
    // already exist (from a prior death / _endRun); Load must restore that level
    // at full health with souls/tier/NG+ intact.
    if (loadView) {
      const bool had = app.savedRun.has_value();
      app.loadRun(); // title-screen "Continue [L]"
      const int lv = app.state.level, souls = app.state.collectedOrbs;
      const int tier = app.state.weaponTier, hp = app.state.health;
      std::fprintf(stderr,
                   "[dc_app] load-view: save present=%d → restored level %d, souls %d, tier %d, hp %d/%d\n",
                   (int)had, lv, souls, tier, hp, app.state.maxHealth);
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
      if (!bossView && !descendView && !deathView && !hudView && !enemyView && !dropView && !burnView && !vaultView && !startView && !loadView && !swordView && !hunterView) app.keyW = true; // interior-walk shot: drive forward
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
      else if (hunterView) { /* stand still; wraith parks left, beams the mob */ }
      else if (vaultView) { /* stand still, face room center (yaw set at placement) */ }
      else if (startView) { /* stand still, face the entrance (yaw set at placement) */ }
      else if (loadView) { /* stand still — we just loaded, show the restored level */ }
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
      if (timeoutView && !deathSeen && app.screen == App::Screen::Dead) {
        deathSeen = true; deathAt = i;
        std::fprintf(stderr, "[dc_app] timeout-view: RUN ENDED at frame %d reason='%s' → death screen\n",
                     i, app.deathReason);
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
