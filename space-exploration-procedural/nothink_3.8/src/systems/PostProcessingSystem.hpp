#pragma once
#include "Constants.hpp"
#include <GL/glew.h>
#include <vector>

struct FBO {
    GLuint tex = 0, fbo = 0;
    int w = 0, h = 0;
};

class PostProcessingSystem {
public:
    void init(int width, int height);
    void resize(int width, int height);
    void beginScene();
    void endScene();
    void present();
    void setBloomStrength(float s) { m_bloom = s; }
    void setCA(float c) { m_ca = c; }
    void setGrain(float g) { m_grain = g; }
    void setVignette(float v) { m_vignette = v; }
    void setWormhole(float w) { m_wormhole = w; }
    float resolutionScale() const { return m_resScale; }
    void setResolutionScale(float s) { m_resScale = s; }
private:
    void createFBO(FBO& f, int w, int h);
    void destroyFBO(FBO& f);
    FBO m_scene, m_bloomA, m_bloomB, m_final;
    int m_w = 0, m_h = 0;
    float m_bloom = 1.5f, m_ca = 0.003f, m_grain = 0.03f, m_vignette = 0.5f, m_wormhole = 0;
    float m_resScale = 1.0f;
};
