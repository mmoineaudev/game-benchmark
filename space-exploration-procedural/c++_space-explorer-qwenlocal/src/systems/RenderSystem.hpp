#pragma once
#include <vector>
#include <string>
#include <unordered_map>
#include <functional>
#include "entities/Entity.hpp"
#include "core/Window.hpp"
#include "core/GameState.hpp"
#include "utils/Math.hpp"
#include "utils/Logging.hpp"

namespace SH {

class RenderSystem {
public:
    RenderSystem();
    ~RenderSystem();

    void init(Window* window);
    void shutdown();

    bool initShaders();
    bool initBuffers();
    bool initPostProcessing();

    void render(const std::vector<std::unique_ptr<Entity>>& entities,
                const Vec3& cameraPos, const Quat& cameraRot,
                const Mat4& viewMatrix, const Mat4& projMatrix);

    void renderGalaxyMap2D(const std::vector<GameState::SystemNode>& systems,
                           const std::vector<GameState::RouteEdge>& routes);

    void renderStarfield(float timeSec);

    void renderPostProcessing(int width, int height);

    Window* getWindow() const { return window_; }

private:
    Window* window_ = nullptr;
    GLuint shaderProgram_ = 0;
    GLuint bloomProgram_ = 0;
    GLuint particleProgram_ = 0;
    GLuint lightProgram_ = 0;
    GLuint shaderUModel_ = -1;
    GLuint shaderUView_ = -1;
    GLuint shaderUProj_ = -1;
    GLuint shaderUColor_ = -1;

    GLuint fbo_ = 0;
    GLuint fboTexture_ = 0;
    GLuint fboDepth_ = 0;
    GLuint bloomFBO_ = 0;
    GLuint bloomTexH_ = 0;
    GLuint bloomTexV_ = 0;
    GLuint quadVAO_ = 0;
    GLuint vao_ = 0;
    GLuint vbo_ = 0;
    GLuint ibo_ = 0;
    GLuint quadVBO_ = 0;

    GLuint createProgram(const std::string& vertSrc, const std::string& fragSrc);
    void renderBloomPass(int width, int height);
    void renderMotionBlurPass(int width, int height, int passes);
    void renderVignettePass(int width, int height);
};

} // namespace SH
