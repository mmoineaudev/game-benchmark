#include <GL/glew.h>
#include "systems/RenderSystem.hpp"
#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include "core/Window.hpp"
#include "entities/Entity.hpp"
#include "entities/components/Render.hpp"
#include <fstream>
#include <sstream>
#include <iostream>

namespace SH {

static GLuint createShaderProgram(const std::string& vertSrc, const std::string& fragSrc) {
    GLuint vert = glCreateShader(GL_VERTEX_SHADER);
    const char* v = vertSrc.c_str();
    glShaderSource(vert, 1, &v, nullptr);
    glCompileShader(vert);
    GLint ok;
    glGetShaderiv(vert, GL_COMPILE_STATUS, &ok);
    if (ok != GL_TRUE) {
        char buf[1024];
        glGetShaderInfoLog(vert, 1024, nullptr, buf);
        LOG_ERROR("RenderSystem", std::string("Vertex shader: ") + buf);
        return 0;
    }

    GLuint frag = glCreateShader(GL_FRAGMENT_SHADER);
    const char* f = fragSrc.c_str();
    glShaderSource(frag, 1, &f, nullptr);
    glCompileShader(frag);
    glGetShaderiv(frag, GL_COMPILE_STATUS, &ok);
    if (ok != GL_TRUE) {
        char buf[1024];
        glGetShaderInfoLog(frag, 1024, nullptr, buf);
        LOG_ERROR("RenderSystem", std::string("Fragment shader: ") + buf);
        glDeleteShader(vert);
        return 0;
    }

    GLuint prog = glCreateProgram();
    glAttachShader(prog, vert);
    glAttachShader(prog, frag);
    glLinkProgram(prog);
    glGetProgramiv(prog, GL_LINK_STATUS, &ok);
    if (ok != GL_TRUE) {
        char buf[1024];
        glGetProgramInfoLog(prog, 1024, nullptr, buf);
        LOG_ERROR("RenderSystem", std::string("Program link: ") + buf);
        glDeleteShader(vert);
        glDeleteShader(frag);
        glDeleteProgram(prog);
        return 0;
    }
    glDetachShader(prog, vert);
    glDetachShader(prog, frag);
    glDeleteShader(vert);
    glDeleteShader(frag);
    return prog;
}

RenderSystem::RenderSystem()
    : window_(nullptr),
      shaderProgram_(0), bloomProgram_(0), particleProgram_(0), lightProgram_(0),
      shaderUModel_(-1), shaderUView_(-1), shaderUProj_(-1), shaderUColor_(-1),
      fbo_(0), fboTexture_(0), fboDepth_(0),
      bloomFBO_(0), bloomTexH_(0), quadVAO_(0),
      vao_(0), vbo_(0), ibo_(0) {}

RenderSystem::~RenderSystem() { shutdown(); }

void RenderSystem::init(Window* window) {
    window_ = window;
    if (!initShaders()) {
        LOG_ERROR("RenderSystem", "Failed to initialize shaders");
        return;
    }
    if (!initBuffers()) {
        LOG_ERROR("RenderSystem", "Failed to initialize buffers");
        return;
    }
    if (!initPostProcessing()) {
        LOG_ERROR("RenderSystem", "Failed to initialize post-processing");
        return;
    }
    LOG_INFO("RenderSystem", "Render system initialized");
}

void RenderSystem::shutdown() {
    if (shaderProgram_) { glDeleteProgram(shaderProgram_); shaderProgram_ = 0; }
    if (bloomProgram_) { glDeleteProgram(bloomProgram_); bloomProgram_ = 0; }
    if (particleProgram_) { glDeleteProgram(particleProgram_); particleProgram_ = 0; }
    if (lightProgram_) { glDeleteProgram(lightProgram_); lightProgram_ = 0; }
    if (fbo_) { glDeleteFramebuffers(1, &fbo_); fbo_ = 0; }
    if (fboTexture_) { glDeleteTextures(1, &fboTexture_); fboTexture_ = 0; }
    if (fboDepth_) { glDeleteRenderbuffers(1, &fboDepth_); fboDepth_ = 0; }
    if (bloomFBO_) { glDeleteFramebuffers(1, &bloomFBO_); bloomFBO_ = 0; }
    if (bloomTexH_) { glDeleteTextures(1, &bloomTexH_); bloomTexH_ = 0; }
    if (quadVAO_) { glDeleteVertexArrays(1, &quadVAO_); quadVAO_ = 0; }
    if (vao_) { glDeleteVertexArrays(1, &vao_); vao_ = 0; }
    if (vbo_) { glDeleteBuffers(1, &vbo_); vbo_ = 0; }
    if (ibo_) { glDeleteBuffers(1, &ibo_); ibo_ = 0; }
    if (quadVBO_) { glDeleteBuffers(1, &quadVBO_); quadVBO_ = 0; }
    LOG_INFO("RenderSystem", "Render system shut down");
}

bool RenderSystem::initShaders() {
    const std::string vs = R"(
#version 330 core
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
out vec3 vColor;
void main() {
    gl_Position = uProjection * uView * uModel * vec4(aPos, 1.0);
    vColor = aColor;
}
)";
    const std::string fs = R"(
#version 330 core
in vec3 vColor;
out vec4 FragColor;
void main() {
    FragColor = vec4(vColor, 1.0);
}
)";
    shaderProgram_ = createShaderProgram(vs, fs);
    if (!shaderProgram_) { LOG_ERROR("RenderSystem", "Main shader failed"); return false; }
    shaderUModel_ = glGetUniformLocation(shaderProgram_, "uModel");
    shaderUView_ = glGetUniformLocation(shaderProgram_, "uView");
    shaderUProj_ = glGetUniformLocation(shaderProgram_, "uProjection");
    shaderUColor_ = glGetUniformLocation(shaderProgram_, "uColor");

    const std::string bv = R"(
#version 330 core
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
    vUV = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
)";
    const std::string bf = R"(
#version 330 core
in vec2 vUV;
out vec4 FragColor;
uniform sampler2D uTexture;
void main() {
    FragColor = texture(uTexture, vUV);
}
)";
    bloomProgram_ = createShaderProgram(bv, bf);

    const std::string pv = R"(
#version 330 core
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
out vec4 vColor;
void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
    vColor = aColor;
}
)";
    const std::string pf = R"(
#version 330 core
in vec4 aColor;
out vec4 FragColor;
void main() {
    FragColor = aColor;
}
)";
    particleProgram_ = createShaderProgram(pv, pf);

    const std::string lv = R"(
#version 330 core
layout(location = 0) in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
out vec3 vPosition;
void main() {
    gl_Position = uProjection * uView * uModel * vec4(aPos, 1.0);
    vPosition = aPos;
}
)";
    const std::string lf = R"(
#version 330 core
in vec3 vPosition;
out vec4 FragColor;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform vec3 uLightPos;
uniform vec3 uMaterialColor;
void main() {
    float dist = length(vPosition - uLightPos);
    float atten = uLightIntensity / (1.0 + 0.1 * dist + 0.01 * dist * dist);
    FragColor = vec4(uMaterialColor * atten, 1.0);
}
)";
    lightProgram_ = createShaderProgram(lv, lf);

    LOG_INFO("RenderSystem", "All shaders compiled successfully");
    return true;
}

bool RenderSystem::initBuffers() {
    glGenVertexArrays(1, &vao_);
    glGenBuffers(1, &vbo_);
    glGenBuffers(1, &ibo_);

    float cube[] = {
        -0.5f,-0.5f,-0.5f, 1.0f,1.0f,1.0f,
         0.5f,-0.5f,-0.5f, 1.0f,1.0f,1.0f,
         0.5f, 0.5f,-0.5f, 1.0f,1.0f,1.0f,
        -0.5f, 0.5f,-0.5f, 1.0f,1.0f,1.0f,
        -0.5f,-0.5f, 0.5f, 1.0f,1.0f,1.0f,
         0.5f,-0.5f, 0.5f, 1.0f,1.0f,1.0f,
         0.5f, 0.5f, 0.5f, 1.0f,1.0f,1.0f,
        -0.5f, 0.5f, 0.5f, 1.0f,1.0f,1.0f,
    };
    GLuint indices[] = {
        0,1,2, 2,3,0,
        4,5,6, 6,7,4,
        0,4,7, 7,3,0,
        1,5,6, 6,2,1,
        3,7,6, 6,2,3,
        0,1,5, 5,4,0,
    };

    glBindVertexArray(vao_);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    glBufferData(GL_ARRAY_BUFFER, sizeof(cube), cube, GL_STATIC_DRAW);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 6 * sizeof(float), (void*)0);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 6 * sizeof(float), (void*)(3 * sizeof(float)));
    glEnableVertexAttribArray(1);
    glBindVertexArray(0);

    // Separate VBO for the quad (bloom/composite fullscreen pass) — must not
    // reuse vbo_ which holds the cube mesh.
    glGenVertexArrays(1, &quadVAO_);
    glGenBuffers(1, &quadVBO_);
    float quad[] = {
        -1.0f,-1.0f, 0.0f,
         1.0f,-1.0f, 0.0f,
         1.0f, 1.0f, 0.0f,
        -1.0f, 1.0f, 0.0f,
    };
    glBindVertexArray(quadVAO_);
    glBindBuffer(GL_ARRAY_BUFFER, quadVBO_);
    glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 3 * sizeof(float), (void*)0);
    glEnableVertexAttribArray(0);
    glBindVertexArray(0);

    LOG_INFO("RenderSystem", "Buffers initialized");
    return true;
}

bool RenderSystem::initPostProcessing() {
    glGenFramebuffers(1, &fbo_);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    glGenTextures(1, &fboTexture_);
    glBindTexture(GL_TEXTURE_2D, fboTexture_);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, 800, 600, 0, GL_RGB, GL_FLOAT, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, fboTexture_, 0);
    glGenRenderbuffers(1, &fboDepth_);
    glBindRenderbuffer(GL_RENDERBUFFER, fboDepth_);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, 800, 600);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, fboDepth_);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

    glGenFramebuffers(1, &bloomFBO_);
    glBindFramebuffer(GL_FRAMEBUFFER, bloomFBO_);
    glGenTextures(1, &bloomTexH_);
    glBindTexture(GL_TEXTURE_2D, bloomTexH_);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, 800, 600, 0, GL_RGB, GL_FLOAT, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, bloomTexH_, 0);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

    LOG_INFO("RenderSystem", "Post-processing initialized");
    return true;
}

void RenderSystem::render(const std::vector<std::unique_ptr<Entity>>& entities,
                          const Vec3& /*cameraPos*/, const Quat& /*cameraRot*/,
                          const Mat4& viewMatrix, const Mat4& projMatrix) {
    if (!window_) return;

    // Render scene directly to the default framebuffer (screen).
    // For MVP, skip the FBO + bloom pipeline — it was never blitting back
    // to screen, which is why the scene was invisible.
    glViewport(0, 0, window_->width(), window_->height());
    glClearColor(0.02f, 0.02f, 0.08f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glEnable(GL_DEPTH_TEST);

    glUseProgram(shaderProgram_);
    if (shaderUView_ >= 0) glUniformMatrix4fv(shaderUView_, 1, GL_FALSE, viewMatrix.m);
    if (shaderUProj_ >= 0) glUniformMatrix4fv(shaderUProj_, 1, GL_FALSE, projMatrix.m);

    for (auto& entity : entities) {
        if (!entity->isActive()) continue;
        Mat4 model = Mat4::translation(entity->position);
        glUseProgram(shaderProgram_);
        if (shaderUModel_ >= 0) glUniformMatrix4fv(shaderUModel_, 1, GL_FALSE, model.m);
        glBindVertexArray(vao_);
        glDrawElements(GL_TRIANGLES, 36, GL_UNSIGNED_INT, nullptr);
        glBindVertexArray(0);
    }

    glDisable(GL_DEPTH_TEST);
}

void RenderSystem::renderGalaxyMap2D(const std::vector<GameState::SystemNode>& systems,
                                     const std::vector<GameState::RouteEdge>& routes) {
    // Full-screen galaxy map overlay — no ImGui window, draw directly to screen.
    ImDrawList* drawList = ImGui::GetForegroundDrawList();
    ImVec2 vp = ImGui::GetIO().DisplaySize;
    float cx = vp.x * 0.5f, cy = vp.y * 0.55f;  // center slightly below middle
    float scale = (vp.x < vp.y ? vp.x : vp.y) * 0.35f;

    // Semi-transparent backdrop
    drawList->AddRect({0, 0}, vp, 0xCC000010, 0.0f, ImDrawFlags_RoundCornersAll, 0.0f);

    // Grid lines (subtle)
    ImU32 gridCol = 0x18FFFFFF;
    for (float gx = cx - scale; gx <= cx + scale; gx += scale / 4.0f) {
        drawList->AddLine({gx, cy - scale}, {gx, cy + scale}, gridCol, 1.0f);
    }
    for (float gy = cy - scale; gy <= cy + scale; gy += scale / 4.0f) {
        drawList->AddLine({cx - scale, gy}, {cx + scale, gy}, gridCol, 1.0f);
    }

    // Helper: world pos (x,y in [-1000,1000]) -> screen pos
    auto toScreen = [&](float wx, float wy) -> ImVec2 {
        return ImVec2(cx + (wx / 1000.0f) * scale, cy - (wy / 1000.0f) * scale);
    };

    // Routes (lines between systems)
    for (const auto& route : routes) {
        ImVec2 fromP(0, 0), toP(0, 0);
        bool hasFrom = false, hasTo = false;
        for (const auto& sys : systems) {
            if (sys.id == route.from) { fromP = toScreen(sys.x, sys.y); hasFrom = true; }
            if (sys.id == route.to) { toP = toScreen(sys.x, sys.y); hasTo = true; }
        }
        if (hasFrom && hasTo) {
            drawList->AddLine(fromP, toP, 0x604488CC, 2.0f);  // dim blue-purple
        }
    }

    // System nodes (glowing dots with labels)
    float t = (float)ImGui::GetTime();
    for (const auto& sys : systems) {
        ImVec2 pos = toScreen(sys.x, sys.y);
        bool isHome = (sys.id == "home");

        // Glow (larger dim circle behind)
        ImU32 glowCol = isHome ? 0x4000FF00 : (sys.danger >= 4 ? 0x40FF4444 : 0x4044AAFF);
        drawList->AddCircleFilled(pos, 14.0f, glowCol);

        // Breathing pulse (spec: "breathing glow on reachable nodes")
        float pulse = 0.5f + 0.5f * sinf(t * 2.0f + sys.x * 0.01f);
        float pulseR = 10.0f + pulse * 6.0f;
        ImU32 pulseCol = isHome ? 0x8000FF00 : (sys.danger >= 4 ? 0x80FF4444 : 0x8044AAFF);
        drawList->AddCircle(pos, pulseR, pulseCol, 16);

        // Core dot
        ImU32 coreCol = isHome ? 0xFF00FF00 : (sys.danger >= 4 ? 0xFFFF6666 : 0xFFAADDFF);
        drawList->AddCircleFilled(pos, 5.0f, coreCol);

        // Label
        char buf[128];
        snprintf(buf, sizeof(buf), "%s  (danger %d)", sys.name.c_str(), sys.danger);
        ImVec2 textSize = ImGui::CalcTextSize(buf);
        drawList->AddText(ImVec2(pos.x - textSize.x * 0.5f, pos.y + 14.0f), 0xDDFFFFFF, buf);
    }

    // Title
    ImVec2 titlePos = ImVec2(vp.x * 0.5f, 20.0f);
    ImVec2 titleSize = ImGui::CalcTextSize("GALAXY MAP");
    drawList->AddText(ImVec2(titlePos.x - titleSize.x * 0.5f, titlePos.y), 0xFF44FFAA, "GALAXY MAP");
}

void RenderSystem::renderStarfield(float timeSec) {
    if (!window_) {
        LOG_ERROR("RenderSystem", "Window is null in renderStarfield");
        return;
    }
    int w = window_->width();
    int h = window_->height();
    
    // Safety check: ensure window dimensions are valid
    if (w <= 0 || h <= 0) {
        LOG_ERROR("RenderSystem", "Invalid window dimensions in renderStarfield: " + std::to_string(w) + "x" + std::to_string(h));
        return;
    }

    static const int NUM_STARS = 400;

    // Build a dedicated star VAO once: interleaved (x, y, r, g, b) points.
    static GLuint starVAO = 0, starVBO = 0;
    if (starVAO == 0) {
        glGenVertexArrays(1, &starVAO);
        glGenBuffers(1, &starVBO);
        struct StarVertex { float x, y; float r, g, b; };
        std::vector<StarVertex> verts;
        verts.reserve(NUM_STARS);
        unsigned int seed = 98765u;
        auto rand01 = [&]() -> float {
            seed = seed * 1103515245u + 12345u;
            return (seed >> 8) / 16581375.0f;
        };
        for (int i = 0; i < NUM_STARS; i++) {
            float x = rand01() * 2.0f - 1.0f;
            float y = rand01() * 2.0f - 1.0f;
            float bright = 0.35f + rand01() * 0.65f;
            float r = bright * (0.9f + rand01() * 0.1f);
            float g = bright * (0.9f + rand01() * 0.1f);
            float b = bright;
            verts.push_back({x, y, r, g, b});
        }
        glBindVertexArray(starVAO);
        glBindBuffer(GL_ARRAY_BUFFER, starVBO);
        glBufferData(GL_ARRAY_BUFFER, verts.size() * sizeof(StarVertex), verts.data(), GL_STATIC_DRAW);
        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(StarVertex), (void*)0);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(StarVertex), (void*)(2 * sizeof(float)));
        glEnableVertexAttribArray(1);
        glBindVertexArray(0);
    }

    glViewport(0, 0, w, h);
    glClearColor(0.01f, 0.01f, 0.04f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    glDisable(GL_DEPTH_TEST);

    glUseProgram(particleProgram_);
    glBindVertexArray(starVAO);
    (void)timeSec; // available for future twinkle/parallax motion
    glDrawArrays(GL_POINTS, 0, NUM_STARS);
    glBindVertexArray(0);
}

void RenderSystem::renderPostProcessing(int width, int height) {
    renderBloomPass(width, height);
    renderMotionBlurPass(width, height, 2);
    renderVignettePass(width, height);
}

void RenderSystem::renderBloomPass(int width, int height) {
    if (!bloomProgram_) return;
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    glViewport(0, 0, width, height);
}

void RenderSystem::renderMotionBlurPass(int width, int height, int /*passes*/) {
    if (!particleProgram_) return;
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
}

void RenderSystem::renderVignettePass(int width, int height) {
    if (!lightProgram_) return;
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
}

} // namespace SH
