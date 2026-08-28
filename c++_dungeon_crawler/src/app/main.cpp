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

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "dc/collision.hpp"
#include "dc/constants.hpp"
#include "dc/crashdiag.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/boss.hpp"
#include "dc/movement.hpp"
#include "dc/state.hpp"
#include "dc/world.hpp"

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
uniform float uAmbient;
uniform float uEmissive;
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
  if (uEmissive > 0.5) lit = vColor * 1.4; // unlit emissive (boss / skeletons)
  fragColor = vec4(min(lit, vec3(1.5)), 1.0);
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
out vec4 fragColor;
void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  fragColor = vec4(scene + bloom * uStrength, 1.0);
}
)";

// ---------- instanced world (floors / ceilings / walls) ----------
struct World {
  dc::Dungeon dungeon;
  dc::WorldCollision collision;
  // GL instance VBOs: 9 floats/instance = offset(3) + scale(3) + color(3).
  GLuint instFloor = 0, instCeil = 0, instWallH = 0, instWallE = 0;
  int nFloor = 0, nCeil = 0, nWallH = 0, nWallE = 0;

  void upload(const dc::Dungeon& d, const float cellCol[3], const float wallCol[3],
              const float ceilCol[3]);
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
                   const float ceilCol[3]) {
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
  auto mkVbo = [&](const std::vector<float>& v) -> GLuint {
    GLuint b = 0;
    glGenBuffers(1, &b);
    glBindBuffer(GL_ARRAY_BUFFER, b);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * sizeof(float)), v.data(), GL_STATIC_DRAW);
    return b;
  };
  instFloor = mkVbo(floorInst); instCeil = mkVbo(ceilInst);
  instWallH = mkVbo(wallH); instWallE = mkVbo(wallE);
}

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
  GLuint sceneFbo = 0, sceneTex = 0;
  GLuint shadowFbo = 0, shadowTex = 0;
  GLuint brightFboA = 0, brightTexA = 0, brightFboB = 0, brightTexB = 0;

  // the single shadow-casting torch (static-assigned at level build)
  float torchPos[3] = {0, 6, 0};
  float torchColor[3] = {1.0f, 0.6f, 0.24f};
  float torchIntensity = 0.9f; // JS LIGHT_SOURCES.TORCH.intensity

  // player transform (yaw/pitch are in state.player; camera pos mirrors it)
  double camX = 0, camY = kEyeHeight, camZ = 0;
  float fov = (float)camera::kFov;

  // input (GLFW physical key codes — AZERTY-safe: bind by position)
  bool keyW = false, keyS = false, keyA = false, keyD = false, keyShift = false;
  double mouseDX = 0, mouseDY = 0;
  bool pointerLocked = false;

  // ---- entities (Phase 2 slice) ----
  // The Spectral Lord, aggro-on-sight, 25 HP at level 7, SPECTRAL_COURT.
  dc::Boss boss;
  bool bossReady = false;
  // App-local skeleton chasers (dc_core movement: moveToward + pathStep).
  struct Skel { dc::Vec2 pos{0, 0}; double hitCd = 0; bool alive = true; };
  std::vector<Skel> skels;
  dc::Rng rng{12345u};
  double simHealth = 3.0;   // boss/skeleton damage mutates this; mirrors JS
  GLuint dynVbo = 0;        // dynamic instance VBO (boss + skeletons, 9 floats)
  int dynCount = 0;
  bool playerDead = false;
  bool bossKillCounted = false;

  bool init(int w, int h, const char* title);
  void buildWorldFromState();
  void placePlayerAtEntrance();
  void spawnEntities();
  void updateEntities(double dt);
  void uploadDynamic(std::vector<float>& dyn);
  void update(double dt, double rawDt);
  void frame();
  void drawGroup(GLuint instVbo, int count, float emissive = 0.0f);
  void savePPM(const char* path);
  ~App();
};

App::~App() {
  if (window) glfwDestroyWindow(window);
  if (window) glfwTerminate();
}

void App::buildWorldFromState() {
  const float cellCol[3] = {0.42f, 0.40f, 0.37f};   // STONE flagstone
  const float wallCol[3] = {0.34f, 0.32f, 0.30f};
  const float ceilCol[3] = {0.28f, 0.27f, 0.26f};
  world.upload(world.dungeon, cellCol, wallCol, ceilCol);
  // static-assigned torch: above the entrance room, casting the 1 shadow map
  if (world.dungeon.entranceCell) {
    torchPos[0] = (float)(world.dungeon.entranceCell->x * world.dungeon.cellSize);
    torchPos[2] = (float)(world.dungeon.entranceCell->z * world.dungeon.cellSize);
    torchPos[1] = 6.0f;
  }
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

void App::spawnEntities() {
  const int level = 7; // slice boss: the Spectral Lord at the exit throne
  boss = dc::Boss::spawn(world.dungeon, level, state.ngPlus, state.collectedOrbs,
                        state.maxHealth, "Skeleton");
  bossReady = true;
  bossKillCounted = false;
  simHealth = state.maxHealth > 0 ? (double)state.maxHealth : 3.0;
  playerDead = false;
  skels.clear();
  const double cs = world.dungeon.cellSize;
  const int gs = world.dungeon.gridSize;
  const int ex = world.dungeon.entranceCell ? world.dungeon.entranceCell->x : 0;
  const int ez = world.dungeon.entranceCell ? world.dungeon.entranceCell->z : 0;
  int spawned = 0;
  for (int z = 1; z < gs && spawned < 2; z += 2)
    for (int x = 1; x < gs && spawned < 2; x += 3) {
      if (world.dungeon.grid[z][x] != dc::Cell::kEmpty) continue;
      if (x == ex && z == ez) continue;
      const double wx = x * cs, wz = z * cs;
      if (std::hypot(wx - ex * cs, wz - ez * cs) < 10.0) continue; // room to run
      if (dc::circleHitsBox(world.collision.boxes, wx, wz, player::kRadius)) continue;
      skels.push_back(Skel{dc::Vec2{wx, wz}, 0.0, true});
      spawned++;
    }
}

void App::updateEntities(double dt) {
  if (!bossReady || playerDead) return;
  const dc::Vec2 pp{state.player.x, state.player.z};
  // ---- boss (real state machine) ----
  dc::BossCtx bctx;
  bctx.dungeon = &world.dungeon;
  bctx.boxes = &world.collision.boxes;
  bctx.playerPos = pp;
  bctx.playerMaxHealth = state.maxHealth > 0 ? (double)state.maxHealth : 3.0;
  bctx.level = 7;
  bctx.ngPlus = state.ngPlus;
  bctx.souls = state.collectedOrbs;
  bctx.bossKills = state.bossKills;
  bctx.frozenAll = false;
  bctx.rng = &rng;
  bctx.playerHealth = &simHealth;
  boss.update(dt, bctx);
  if (boss.dead) state.bossKills += 1;
  // ---- skeletons (dc_core chasers) ----
  for (auto& s : skels) {
    if (!s.alive) continue;
    if (s.hitCd > 0) s.hitCd -= dt;
    const double d = std::hypot(pp.x - s.pos.x, pp.z - s.pos.z);
    // chase: pathStep toward the player when a wall blocks, else direct
    dc::Mover m = s.pos;
    double tx = pp.x, tz = pp.z;
    if (d > 1.0 && !dc::hasLineOfSight(world.collision.boxes, s.pos.x, s.pos.z, pp.x, pp.z)) {
      if (auto step = dc::pathStep(world.dungeon, world.collision.boxes, s.pos.x, s.pos.z, pp.x, pp.z)) {
        tx = step->x; tz = step->z;
      }
    }
    const double sp = 3.2; // skeleton speed (slower than player sprint)
    dc::moveToward(m, tx, tz, sp, dt, world.collision.boxes, 0.4);
    s.pos = m;
    // contact damage (1 heart, 1s cooldown per skeleton)
    if (s.hitCd <= 0 && d < 1.0) { simHealth -= 1.0; s.hitCd = 1.0; }
    // death (next step: on 0 hp) — clamp for now
  }
  // ---- sync to GameState + death ----
  simHealth = std::max(0.0, simHealth);
  state.health = (int)std::lround(simHealth);
  if (simHealth <= 0.0 && !playerDead) playerDead = true;
}

void App::uploadDynamic(std::vector<float>& dyn) {
  dyn.clear();
  auto push = [&](float ox, float oy, float oz, float sx, float sy, float sz,
                  float r, float g, float b) {
    dyn.insert(dyn.end(), {ox, oy, oz, sx, sy, sz, r, g, b});
  };
  // boss (glowing SPECTRAL_COURT accent ~0xaa88ff): pulse while awake
  if (bossReady && !boss.dead) {
    const float s = 1.6f + 0.15f * (float)std::sin(state.runTime * 6.0);
    push((float)boss.pos.x, 1.1f, (float)boss.pos.z, s, 2.2f, s, 0.66f, 0.53f, 1.0f);
  } else if (bossReady) {
    push((float)boss.pos.x, 0.4f, (float)boss.pos.z, 1.4f, 0.2f, 1.4f, 0.4f, 0.3f, 0.5f); // corpse
  }
  // skeletons (bone white)
  for (const auto& s : skels)
    if (s.alive) push((float)s.pos.x, 0.9f, (float)s.pos.z, 0.6f, 1.7f, 0.6f, 0.85f, 0.85f, 0.8f);
}

bool App::init(int w, int h, const char* title) {
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

  // ---- dynamic entity VBO (boss + skeletons), streamed each frame ----
  glGenBuffers(1, &dynVbo);
  glBindBuffer(GL_ARRAY_BUFFER, dynVbo);
  { std::vector<float> tmp(64 * 9, 0.0f);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(tmp.size() * sizeof(float)), tmp.data(), GL_DYNAMIC_DRAW); }
  glBindBuffer(GL_ARRAY_BUFFER, 0);

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

void App::update(double dt, double rawDt) {
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

  // ---- FOV kick while sprinting ----
  const float targetFov = (float)(camera::kFov + (sprinting ? camera::kSprintFovKick : 0));
  if (std::abs(fov - targetFov) > 0.1f) fov += (targetFov - fov) * 0.15f;

  // ---- timers ----
  state.levelTime += dt;
  state.runTime += dt;
  if (state.safeSpawn > 0) state.safeSpawn -= rawDt;
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
    uploadDynamic(dyn);
    dynCount = (int)(dyn.size() / 9);
    if (dynCount > 0) {
      glBindBuffer(GL_ARRAY_BUFFER, dynVbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(dyn.size() * sizeof(float)), dyn.data());
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
  glUniform1f(glGetUniformLocation(progScene, "uAmbient"), (float)lighting::kAmbientIntensityStone);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, shadowTex);
  drawGroup(world.instWallH, world.nWallH);
  drawGroup(world.instWallE, world.nWallE);
  drawGroup(world.instFloor, world.nFloor);
  drawGroup(world.instCeil, world.nCeil);
  drawGroup(dynVbo, dynCount, 1.0f); // boss/skeletons: unlit emissive spectral figures

  // ---- 3) bloom ----
  glDisable(GL_DEPTH_TEST);
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
  glUniform1f(glGetUniformLocation(progComposite, "uStrength"), 0.35f);
  glBindVertexArray(quadVao);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glBindVertexArray(0);
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

// ---- GLFW callbacks (file-static because they're C-function pointers) ----
static App* g_app = nullptr;
static void keyCb(GLFWwindow* w, int key, int, int action, int) {
  if (!g_app) return;
  const bool down = action == GLFW_PRESS || action == GLFW_REPEAT;
  if (key == GLFW_KEY_W) g_app->keyW = down;
  else if (key == GLFW_KEY_S) g_app->keyS = down;
  else if (key == GLFW_KEY_A) g_app->keyA = down;
  else if (key == GLFW_KEY_D) g_app->keyD = down;
  else if (key == GLFW_KEY_LEFT_SHIFT || key == GLFW_KEY_RIGHT_SHIFT) g_app->keyShift = down;
  else if (key == GLFW_KEY_ESCAPE && action == GLFW_PRESS) glfwSetWindowShouldClose(w, 1);
}
static void cursorCb(GLFWwindow*, double x, double y) {
  static double lx = 0, ly = 0;
  if (g_app) { g_app->mouseDX += x - lx; g_app->mouseDY += y - ly; }
  lx = x; ly = y;
}

} // namespace

int main(int argc, char** argv) {
  int width = 1280, height = 720, frames = 0, seed = 1000;
  const char* savePath = nullptr;
  bool showFps = false, bossView = false;
  for (int i = 1; i < argc; i++) {
    if (!std::strcmp(argv[i], "--width")) width = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--height")) height = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--frames")) frames = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--save")) savePath = argv[++i];
    else if (!std::strcmp(argv[i], "--fps")) showFps = true;
    else if (!std::strcmp(argv[i], "--seed")) seed = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--boss-view")) bossView = true;
  }

  App app;
  if (!app.init(width, height, "dc_app — Phase 2 playable spine (STONE)")) return 1;
  g_app = &app;
  glfwSetKeyCallback(app.window, keyCb);
  glfwSetCursorPosCallback(app.window, cursorCb);

  // build the world from a generated STONE dungeon
  app.state = dc::GameState::fromOpts();
  app.state.level = 1;
  app.state.biome = "STONE";
  app.state.safeSpawn = player::kSafeSpawnTime;
  {
    dc::DungeonGenerator gen(seed, "STONE");
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
    for (int i = 0; i < frames; i++) {
      ctx.frame = i; ctx.phase = "render"; wd.begin();
      if (!bossView) app.keyW = true; // interior-walk shot: drive forward
      else { // face the live boss each frame so it stays on screen
        const double dx = app.boss.pos.x - app.state.player.x;
        const double dz = app.boss.pos.z - app.state.player.z;
        app.state.player.yaw = (float)std::atan2(-dx, -dz);
      }
      app.update(dt, dt);
      app.frame();
      glfwSwapBuffers(app.window);
      glfwPollEvents();
      wd.end("app.frame");
    }
    double el = glfwGetTime() - t0;
    if (savePath) app.savePPM(savePath);
    std::fprintf(stderr, "[dc_app] %d frames in %.3fs (%.1f fps) seed=%d level=%d biome=%s boss=%s(%.0fhp) skels=%zu\n",
                 frames, el, frames / el, seed, app.state.level, app.state.biome.c_str(),
                 app.boss.state.c_str(), app.boss.hp, app.skels.size());
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
        if (showFps) std::fprintf(stderr, "[dc_app] %.0f fps\n", n / acc);
        acc = 0; n = 0;
      }
    }
  }
  return 0;
}
