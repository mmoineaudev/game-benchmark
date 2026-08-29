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
  if (uEmissive > 0.5) lit = vColor * 0.9; // unlit emissive (boss / skeletons) — keep ≤1 to avoid bloom blowout
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
  bool keyLMB = false, keyRMB = false;
  bool keyE = false;
  bool keyN = false, keyY = false; // title / death bookends
  double mouseDX = 0, mouseDY = 0;
  bool pointerLocked = false;

  // ---- entities (Phase 2 slice) ----
  // The Spectral Lord, aggro-on-sight, 25 HP at level 7, SPECTRAL_COURT.
  dc::Boss boss;
  bool bossReady = false;
  // App-local skeleton chasers (dc_core movement: moveToward + pathStep).
  struct Skel { dc::Vec2 pos{0, 0}; double hp = 2, maxHp = 2, hitCd = 0; int drops = 1; bool alive = true; };
  std::vector<Skel> skels;
  dc::Rng rng{12345u};
  double simHealth = 3.0;   // boss/skeleton damage mutates this; mirrors JS
  GLuint dynVbo = 0;        // dynamic instance VBO (boss + skeletons, 9 floats)
  int dynCount = 0;
  bool playerDead = false;
  bool bossKillCounted = false;
  bool bossPortalOpen = false; // open when !bossLevel, or on boss defeat
  bool prevE = false;
  int  dungeonSeed = 0;        // per-level seed (JS Date.now()^rand, re-rolled per level)
  int  seed = 1000;            // CLI --seed (title-run seed)

  // ---- text / screens (title + death) ----
  Font font;
  GLuint progText = 0, textVbo = 0, textVao = 0;
  GLuint progOverlay = 0;
  enum class Screen { Title, Play, Dead };
  Screen screen = Screen::Play;
  bool prevN = false, prevY = false;

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
  void fireOrb(int step);
  void _fireOrbStep(bool isClick);
  void hitBossOrSkel(int idx, double dmg, const char* src); // idx -1 = boss
  void orbExplode(const Orb& o);
  void collectSkelDrops(int idx);
  void uploadDynamic(std::vector<float>& dyn);
  void update(double dt, double rawDt);
  void frame();
  void drawGroup(GLuint instVbo, int count, float emissive = 0.0f);
  void savePPM(const char* path);
  void bakeFont(const char* path);
  float lineW(const char* s, float size);
  void drawTextLine(std::vector<float>& v, float x, float y, float size, const float col[3], const char* s);
  void drawText(const std::vector<float>& v);
  void drawOverlay(float r, float g, float b, float a);
  void startRun(int seedToUse);
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
  const int level = state.level;
  const bool bossLevel = (level % dc::boss::kInterval == 0);
  skels.clear();
  simHealth = state.maxHealth > 0 ? (double)state.maxHealth : 3.0;
  playerDead = false;
  bossReady = false;
  bossKillCounted = false;
  bossPortalOpen = !bossLevel; // non-boss levels: exit portal open from the start
  // reset sword/orb (fresh level)
  swordStep = 0; swordPhase = nullptr; hitStop = 0;
  orbSeqStep = 0; lmbAccum = 0; prevLMB = prevRMB = false;
  orbs.clear();
  if (bossLevel) {
    static const char* kVariants[7] = {"Skeleton", "Armored", "Archer", "Brute", "Rough", "Rat", "Magician"};
    const char* variant = kVariants[(level / dc::boss::kInterval - 1) % 7];
    boss = dc::Boss::spawn(world.dungeon, level, state.ngPlus, state.collectedOrbs,
                          state.maxHealth, variant);
    bossReady = true;
    bossPortalOpen = false; // sealed until the lord falls
  }
  // skeleton chasers (every level): HP = ceil(base * enemyHpMultiplier)
  const double hpMult = dc::enemyHpMultiplier(state.ngPlus, level, state.collectedOrbs);
  const double skelBaseHp = 2.0; // SKELETON.hp
  const int skelDrops = 1;       // SKELETON.drops
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
      Skel s; s.pos = dc::Vec2{wx, wz}; s.alive = true;
      s.maxHp = s.hp = std::ceil(skelBaseHp * hpMult); s.drops = skelDrops; s.hitCd = 0;
      skels.push_back(std::move(s));
      spawned++;
    }
}

void App::_onBossDefeated() {
  // JS _onBossDefeated: bossKills++, +1 max heart + full heal, soul reward,
  // open the portal. (Buff is skipped — the app has no buff visuals yet.)
  state.bossKills += 1;
  state.maxHealth += 1;
  state.health = state.maxHealth;
  simHealth = state.maxHealth;
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
  bctx.playerHealth = &simHealth;
  boss.update(dt, bctx);
  if (boss.dead && !bossKillCounted) { bossKillCounted = true; _onBossDefeated(); }
  } // end if (bossReady)
  // ---- skeletons (dc_core chasers) — run on every level ----
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
  if (simHealth <= 0.0 && !playerDead) { playerDead = true; if (screen == Screen::Play) screen = Screen::Dead; }
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

  // RMB edge → sword press
  if (keyRMB && !prevRMB) pressSword();

  // ---- sword combo advance ----
  if (swordPhase) {
    if (std::strcmp(swordPhase, "cooldown") == 0) {
      swordCooldownT -= dt;
      if (swordCooldownT <= 0) { swordPhase = nullptr; swordStep = 0; swordWindowT = 0; }
    } else {
      const auto& def = dc::kSwordCombo[std::max(0, swordStep - 1)];
      const double speedMult = dc::attackSpeedFromSouls(souls);
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
      if (db < 1.5) { hitBossOrSkel(-1, o.dmg, "orb"); hit = true; }
    }
    if (!hit) {
      for (size_t i = 0; i < skels.size(); i++) {
        if (!skels[i].alive) continue;
        if (std::hypot(o.x - skels[i].pos.x, o.z - skels[i].pos.z) < 0.6) {
          hitBossOrSkel(i, o.dmg, "orb"); hit = true; break;
        }
      }
    }
    if (hit) { if (o.step == 3) orbExplode(o); o.alive = false; }
  }

  prevLMB = keyLMB; prevRMB = keyRMB;
}
void App::applySwordCone(int stepIdx) {
  const double souls = state.collectedOrbs;
  const int tier = dc::weaponTier((int)souls);
  const double scale = dc::totalSwordScale(tier);
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
  if (bossReady && !boss.dead && inCone(boss.pos.x, boss.pos.z)) { hitBossOrSkel(-1, dmg, "sword"); hitCount++; }
  for (size_t i = 0; i < skels.size(); i++)
    if (skels[i].alive && inCone(skels[i].pos.x, skels[i].pos.z)) { hitBossOrSkel(i, dmg, "sword"); hitCount++; }
  if (hitCount > 0) { hitStop = std::max(hitStop, dc::sword::kHitStop); swordHitsLanded += hitCount; }
}
void App::_fireOrbStep(bool /*isClick*/) {
  if (orbSeqStep == 0 || state.runTime - orbSeqLast > dc::orbWeapon::kSequenceWindow) {
    if (state.collectedOrbs <= 0) return;          // no souls → no fire
    state.collectedOrbs -= 1;                      // first step of a new sequence costs 1
    orbSeqStep = 1;
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
void App::hitBossOrSkel(int idx, double dmg, const char* src) {
  if (idx < 0) { if (bossReady && !boss.dead) boss.hitBoss(dmg, src); return; }
  if (idx >= (int)skels.size() || !skels[idx].alive) return;
  skels[idx].hp -= dmg;
  if (skels[idx].hp <= 0) { skels[idx].alive = false; collectSkelDrops(idx); }
}
void App::orbExplode(const Orb& o) {
  if (bossReady && !boss.dead && std::hypot(o.x - boss.pos.x, o.z - boss.pos.z) < 2.0) hitBossOrSkel(-1, o.dmg, "explosion");
  for (size_t i = 0; i < skels.size(); i++)
    if (skels[i].alive && std::hypot(o.x - skels[i].pos.x, o.z - skels[i].pos.z) < 2.0) hitBossOrSkel(i, o.dmg, "explosion");
}
void App::collectSkelDrops(int idx) {
  if (idx < 0 || idx >= (int)skels.size()) return;
  state.collectedOrbs += skels[idx].drops;   // souls = orbs (ammo + wealth)
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

  // ---- pixel font + screen-space text (title / death screens) ----
  if (fontPath) bakeFont(fontPath);
  progText = linkProgram(compileShader(GL_VERTEX_SHADER, kTextVert),
                         compileShader(GL_FRAGMENT_SHADER, kTextFrag));
  progOverlay = linkProgram(compileShader(GL_VERTEX_SHADER, kFullscreenVert),
                            compileShader(GL_FRAGMENT_SHADER, kOverlayFrag));
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

void App::update(double dt, double rawDt) {
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
  bool titleView = false, deathView = false;
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
    if ((bossView || combatView || deathView) && app.state.level % dc::boss::kInterval != 0) {
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
    // watch level transitions (descend-view) so a descent is provable headlessly
    int prevLevel = app.state.level;
    bool deathSeen = false;
    int deathAt = -1;
    bool restartSeen = false;
    for (int i = 0; i < frames; i++) {
      ctx.frame = i; ctx.phase = "render"; wd.begin();
      if (!bossView && !descendView && !deathView) app.keyW = true; // interior-walk shot: drive forward
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
    std::fprintf(stderr, "[dc_app] %d frames in %.3fs (%.1f fps) seed=%d level=%d biome=%s boss=%s(%.0fhp) skels=%zu portalOpen=%d\n",
                 frames, el, frames / el, seed, app.state.level, app.state.biome.c_str(),
                 app.boss.state.c_str(), app.boss.hp, app.skels.size(), (int)app.bossPortalOpen);
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
