// dc_app — Phase 0 exit: GLFW window + OpenGL 3.3 CORE context with
//   • one instanced lit mesh (unit cube × N instances, glDrawElementsInstanced)
//   • ONE shadow pass (256² FBO depth, single light, static assignment)
//   • ONE bloom post pass (bright-pass threshold → ping-pong gaussian → composite)
//
// Headless probe:  dc_app --frames N --save out.ppm [--width W --height H]
//   renders N frames then dumps a PPM screenshot (needs a display/GLX).
// FPS gate:        dc_app --fps  (prints live fps; Phase-0 gate: 60 fps on the 4080)
//
// Note: this spike is deliberately self-contained. The renderer-agnostic
// `Renderer` interface (include/dc/renderer.hpp) is where this logic moves
// in Phase 2 so the sim can be driven by a NullRenderer in headless tests.
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

namespace {

constexpr int kShadowSize = 256; // spec §12.1: 256² shadow map
constexpr int kInstances = 24;   // 6×4 grid of lit cubes

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
  static Mat4 ortho(float l, float r, float b, float t, float n, float f) {
    Mat4 m{};
    m.m[0] = 2 / (r - l);
    m.m[5] = 2 / (t - b);
    m.m[10] = -2 / (f - n);
    m.m[12] = -(r + l) / (r - l);
    m.m[13] = -(t + b) / (t - b);
    m.m[14] = -(f + n) / (f - n);
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

const char* kLitVert = R"(
#version 330 core
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aOffset;
layout(location=3) in vec3 aColor;
uniform mat4 uViewProj;
uniform mat4 uLightVP;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
out vec4 vLightPos;
void main() {
  vec3 wp = aPos + aOffset;
  vWorld = wp;
  vNormal = aNormal;
  vColor = aColor;
  vLightPos = uLightVP * vec4(wp, 1.0);
  gl_Position = uViewProj * vec4(wp, 1.0);
}
)";

const char* kLitFrag = R"(
#version 330 core
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
in vec4 vLightPos;
uniform vec3 uLightPos;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uUseShadow;
uniform sampler2D uShadowMap;
out vec4 fragColor;
float shadowFactor(vec4 lpos) {
  if (uUseShadow < 0.5) return 1.0;
  if (lpos.w <= 0.0) return 1.0;
  vec3 p = lpos.xyz / lpos.w;
  p = p * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float bias = 0.0015;
  float s = 0.0;
  float texel = 1.0 / 256.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      s += step(p.z - bias, texture(uShadowMap, p.xy + vec2(i, j) * texel).x);
  return s / 9.0;
}
void main() {
  vec3 n = normalize(vNormal);
  vec3 ldir = uLightPos - vWorld;
  float dist = length(ldir);
  float diff = max(dot(n, ldir / dist), 0.0);
  float atten = uLightIntensity / (1.0 + 0.02 * dist + 0.02 * dist * dist);
  vec3 lit = vColor * uLightColor * (0.25 + diff * atten * shadowFactor(vLightPos));
  lit += vColor * 0.18; // ambient floor
  fragColor = vec4(lit, 1.0);
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

struct App {
  GLFWwindow* window = nullptr;
  GLuint vao = 0, vbo = 0, ebo = 0, instVbo = 0;
  int vertCount = 0;
  GLuint progScene = 0, progBright = 0, progBlur = 0, progComposite = 0;
  GLuint quadVao = 0, quadVbo = 0;
  GLuint sceneFbo = 0, sceneTex = 0;
  GLuint shadowFbo = 0, shadowTex = 0;
  GLuint brightFboA = 0, brightTexA = 0;
  GLuint brightFboB = 0, brightTexB = 0;
  int width = 0, height = 0;
  // the single shadow-casting light (static assignment at build)
  float lightPos[3] = {0, 6, 0};
  float lightColor[3] = {1.0f, 0.6f, 0.24f};
  float lightIntensity = 2.2f;

  bool init(int w, int h, const char* title);
  void frame(int frameIdx);
  void savePPM(const char* path);
  ~App();
};

App::~App() {
  if (window) glfwDestroyWindow(window);
  if (window) glfwTerminate();
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
  width = w;
  height = h;

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
      {{-1, 0, 0}, {{-1, -1, -1}, {-1, -1, 1}, {-1, 1, 1}, {-1, 1, -1}}},
      {{0, 1, 0}, {{-1, 1, 1}, {1, 1, 1}, {1, 1, -1}, {-1, 1, -1}}},
      {{0, -1, 0}, {{-1, -1, -1}, {1, -1, -1}, {1, -1, 1}, {-1, -1, 1}}},
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

  // instance data: offset(3) + color(3), 6×4 grid
  std::vector<float> insts;
  const float cols[24][3] = {
      {0.85, 0.5, 0.24}, {0.24, 0.6, 0.85}, {0.5, 0.85, 0.24}, {0.85, 0.24, 0.5},
      {0.6, 0.3, 0.85}, {0.85, 0.85, 0.3}, {0.5, 0.85, 0.24}, {0.24, 0.6, 0.85},
      {0.6, 0.3, 0.85}, {0.85, 0.85, 0.3}, {0.5, 0.85, 0.24}, {0.85, 0.24, 0.5},
      {0.85, 0.5, 0.24}, {0.24, 0.6, 0.85}, {0.5, 0.85, 0.24}, {0.85, 0.24, 0.5},
      {0.6, 0.3, 0.85}, {0.85, 0.85, 0.3}, {0.5, 0.85, 0.24}, {0.85, 0.24, 0.5},
      {0.6, 0.3, 0.85}, {0.85, 0.85, 0.3}, {0.5, 0.85, 0.24}, {0.85, 0.24, 0.5},
  };
  for (int i = 0; i < kInstances; i++) {
    int gx = i % 6, gz = i / 6;
    insts.push_back(gx * 2.0f - 5.0f);
    insts.push_back(0.5f);
    insts.push_back(gz * 2.0f - 4.0f);
    insts.push_back(cols[i][0]);
    insts.push_back(cols[i][1]);
    insts.push_back(cols[i][2]);
  }

  glGenBuffers(1, &vbo);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizei)(verts.size() * sizeof(float)), verts.data(), GL_STATIC_DRAW);
  glGenBuffers(1, &ebo);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
  glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizei)(idx.size() * sizeof(GLuint)), idx.data(), GL_STATIC_DRAW);
  glGenBuffers(1, &instVbo);
  glBindBuffer(GL_ARRAY_BUFFER, instVbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizei)(insts.size() * sizeof(float)), insts.data(), GL_STATIC_DRAW);

  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
  glEnableVertexAttribArray(1);
  glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
  glBindBuffer(GL_ARRAY_BUFFER, instVbo);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
  glEnableVertexAttribArray(2);
  glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
  glVertexAttribDivisor(2, 1);
  glEnableVertexAttribArray(3);
  glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
  glVertexAttribDivisor(3, 1);
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
    if (depth) {
      glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, tex, 0);
    } else {
      glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    }
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    return f;
  };

  sceneTex = makeColorTex(width, height);
  sceneFbo = makeFbo(sceneTex, false);
  // scene pass uses GL_DEPTH_TEST → needs a depth attachment (renderbuffer)
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
  // depth-only shadow FBO
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
    // Depth-only FBO: no color attachment. glDrawBuffers({COLOR_ATTACHMENT0})
    // would make it incomplete and every draw a silent no-op — use GL_NONE.
    glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo);
    glDrawBuffer(GL_NONE);
    glReadBuffer(GL_NONE);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
  }
  brightTexA = makeColorTex(width, height);
  brightFboA = makeFbo(brightTexA, false);
  brightTexB = makeColorTex(width, height);
  brightFboB = makeFbo(brightTexB, false);

  return true;
}

void App::frame(int frameIdx) {
  const float t = frameIdx * 0.01f;
  float eye[3] = {std::sin(t * 0.3f) * 12.f, 5.f + std::sin(t * 0.2f), std::cos(t * 0.3f) * 12.f};
  float at[3] = {0, 0.5f, 0};
  float up[3] = {0, 1, 0};
  Mat4 view = Mat4::lookAt(eye, at, up);
  Mat4 proj = Mat4::perspective(60.f, (float)width / height, 0.1f, 100.f);
  Mat4 viewProj = proj * view; // GL order: project *after* view

  float lsEye[3] = {lightPos[0], lightPos[1], lightPos[2]};
  Mat4 lightView = Mat4::lookAt(lsEye, at, up);
  Mat4 lightProj = Mat4::ortho(-8, 8, -8, 8, 0.5f, 30.f);
  Mat4 lightVP = lightProj * lightView;

  // ---- 1) shadow pass (256² depth FBO) ----
  glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo);
  glViewport(0, 0, kShadowSize, kShadowSize);
  glClear(GL_DEPTH_BUFFER_BIT);
  glUseProgram(progScene);
  glUniformMatrix4fv(glGetUniformLocation(progScene, "uViewProj"), 1, GL_FALSE, lightVP.m);
  glUniformMatrix4fv(glGetUniformLocation(progScene, "uLightVP"), 1, GL_FALSE, lightVP.m);
  glUniform1f(glGetUniformLocation(progScene, "uUseShadow"), 0.0f);
  glBindVertexArray(vao);
  glDrawElementsInstanced(GL_TRIANGLES, vertCount, GL_UNSIGNED_INT, nullptr, kInstances);
  glBindVertexArray(0);

  // ---- 2) scene pass (full-res color FBO) ----
  glBindFramebuffer(GL_FRAMEBUFFER, sceneFbo);
  glViewport(0, 0, width, height);
  glClearColor(0.02, 0.02, 0.03, 1.0);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glEnable(GL_DEPTH_TEST);
  glUseProgram(progScene);
  glUniformMatrix4fv(glGetUniformLocation(progScene, "uViewProj"), 1, GL_FALSE, viewProj.m);
  glUniformMatrix4fv(glGetUniformLocation(progScene, "uLightVP"), 1, GL_FALSE, lightVP.m);
  glUniform3f(glGetUniformLocation(progScene, "uLightPos"), lightPos[0], lightPos[1], lightPos[2]);
  glUniform3f(glGetUniformLocation(progScene, "uLightColor"), lightColor[0], lightColor[1], lightColor[2]);
  glUniform1f(glGetUniformLocation(progScene, "uLightIntensity"), lightIntensity);
  glUniform1f(glGetUniformLocation(progScene, "uUseShadow"), 1.0f);
  glUniform1i(glGetUniformLocation(progScene, "uShadowMap"), 0);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, shadowTex);
  glBindVertexArray(vao);
  glDrawElementsInstanced(GL_TRIANGLES, vertCount, GL_UNSIGNED_INT, nullptr, kInstances);
  glBindVertexArray(0);

  // ---- 3) bloom: bright pass → blur A→B → blur B→A → composite ----
  glDisable(GL_DEPTH_TEST);
  glBindFramebuffer(GL_FRAMEBUFFER, brightFboA);
  glViewport(0, 0, width, height);
  glClear(GL_COLOR_BUFFER_BIT);
  glUseProgram(progBright);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, sceneTex);
  glUniform1i(glGetUniformLocation(progBright, "uScene"), 0);
  glUniform1f(glGetUniformLocation(progBright, "uThreshold"), 0.5f); // RENDERER.BLOOM_THRESHOLD
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
  glUniform1f(glGetUniformLocation(progComposite, "uStrength"), 1.0f);
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

} // namespace

int main(int argc, char** argv) {
  int width = 1280, height = 720, frames = 0;
  const char* savePath = nullptr;
  bool showFps = false;
  for (int i = 1; i < argc; i++) {
    if (!std::strcmp(argv[i], "--width")) width = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--height")) height = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--frames")) frames = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--save")) savePath = argv[++i];
    else if (!std::strcmp(argv[i], "--fps")) showFps = true;
  }

  App app;
  if (!app.init(width, height, "dc_app — GL3.3 core spike")) return 1;

  if (frames > 0) {
    glfwShowWindow(app.window);
    double t0 = glfwGetTime();
    for (int i = 0; i < frames; i++) {
      app.frame(i);
      glfwSwapBuffers(app.window);
      glfwPollEvents();
    }
    double dt = glfwGetTime() - t0;
    if (savePath) app.savePPM(savePath);
    std::fprintf(stderr, "[dc_app] %d frames in %.3fs (%.1f fps)\n", frames, dt, frames / dt);
  } else {
    double last = glfwGetTime(), acc = 0;
    int n = 0;
    while (!glfwWindowShouldClose(app.window)) {
      app.frame(n++);
      glfwSwapBuffers(app.window);
      glfwPollEvents();
      double now = glfwGetTime();
      acc += now - last;
      last = now;
      if (acc >= 0.5) {
        if (showFps) std::fprintf(stderr, "[dc_app] %.0f fps\n", n / acc);
        acc = 0;
        n = 0;
      }
    }
  }
  return 0;
}
