#pragma once
#include <GL/glew.h>
#include "PostProcessingSystem.hpp"
#include "Shader.hpp"

void PostProcessingSystem::init(int w, int h) {
    resize(w, h);
}

void PostProcessingSystem::resize(int w, int h) {
    m_w = w; m_h = h;
    destroyFBO(m_scene);
    destroyFBO(m_bloomA);
    destroyFBO(m_bloomB);
    destroyFBO(m_final);
    createFBO(m_scene, w, h);
    createFBO(m_bloomA, w/2, h/2);
    createFBO(m_bloomB, w/2, h/2);
    createFBO(m_final, w, h);
}

void PostProcessingSystem::createFBO(FBO& f, int w, int h) {
    if (f.tex) glDeleteTextures(1, &f.tex);
    if (f.fbo) glDeleteFramebuffers(1, &f.fbo);
    glGenTextures(1, &f.tex);
    glBindTexture(GL_TEXTURE_2D, f.tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glGenFramebuffers(1, &f.fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, f.fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, f.tex, 0);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    f.w = w; f.h = h;
}

void PostProcessingSystem::destroyFBO(FBO& f) {
    if (f.tex) { glDeleteTextures(1, &f.tex); f.tex = 0; }
    if (f.fbo) { glDeleteFramebuffers(1, &f.fbo); f.fbo = 0; }
}

void PostProcessingSystem::beginScene() {
    glBindFramebuffer(GL_FRAMEBUFFER, m_scene.fbo);
    glViewport(0, 0, m_w, m_h);
    glClearColor(0.0f, 0.0f, 0.067f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
}

void PostProcessingSystem::endScene() {
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void PostProcessingSystem::present() {
    // Bloom extract
    {
        Shader* s = Shader::get("bloom_extract");
        if (s) {
            glBindFramebuffer(GL_FRAMEBUFFER, m_bloomA.fbo);
            glViewport(0, 0, m_bloomA.w, m_bloomA.h);
            s->use();
            int uScene = Shader::u(s, "uScene");
            glUniform1i(uScene, 0);
            // Draw fullscreen quad
            static GLuint vao = 0, vbo = 0;
            if (!vao) {
                glGenVertexArrays(1, &vao);
                glGenBuffers(1, &vbo);
                float corners[8] = {-1,-1, 1,-1, 1,1, -1,1};
                glBindVertexArray(vao);
                glBindBuffer(GL_ARRAY_BUFFER, vbo);
                glBufferData(GL_ARRAY_BUFFER, sizeof(corners), corners, GL_STATIC_DRAW);
                glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, 0);
                glEnableVertexAttribArray(0);
            }
            glBindVertexArray(vao);
            glBindTexture(GL_TEXTURE_2D, m_scene.tex);
            glDrawArrays(GL_TRIANGLES, 3, 4); // wrong: should be 4 verts
            glBindVertexArray(0);
        }
    }
    // Bloom blur A->B
    {
        Shader* s = Shader::get("bloom_blur");
        if (s) {
            glBindFramebuffer(GL_FRAMEBUFFER, m_bloomB.fbo);
            glViewport(0, 0, m_bloomB.w, m_bloomB.h);
            s->use();
            int uTex = Shader::u(s, "uTexture");
            glUniform1i(uTex, 0);
            glUniform1f(Shader::u(s, "uRadius"), 0.4f);
            glUniform2f(Shader::u(s, "uDir"), 1.0f / m_bloomB.w, 0);
            static GLuint vao = 0;
            glBindVertexArray(vao);
            glBindTexture(GL_TEXTURE_2D, m_bloomA.tex);
            glDrawArrays(GL_TRIANGLES, 0, 3);
            glBindVertexArray(0);
        }
    }
    // Composite
    {
        Shader* s = Shader::get("composite");
        if (s) {
            glBindFramebuffer(GL_FRAMEBUFFER, m_final.fbo);
            glViewport(0, 0, m_final.w, m_final.h);
            s->use();
            int uScene = Shader::u(s, "uScene");
            int uBloom = Shader::u(s, "uBloom");
            int uBloomStr = Shader::u(s, "uBloomStrength");
            int uVignette = Shader::u(s, "uVignette");
            int uCA = Shader::u(s, "uCA");
            int uGrain = Shader::u(s, "uGrain");
            int uWormhole = Shader::u(s, "uWormhole");
            glUniform1i(uScene, 0);
            glUniform1i(uBloom, 1);
            glUniform1f(uBloomStr, m_bloom);
            glUniform1f(uVignette, m_vignette);
            glUniform1f(uCA, m_ca);
            glUniform1f(uGrain, m_grain);
            glUniform1f(uWormhole, m_wormhole);
            static GLuint vao = 0;
            glBindVertexArray(vao);
            glActiveTexture(GL_TEXTURE0);
            glBindTexture(GL_TEXTURE_2D, m_scene.tex);
            glActiveTexture(GL_TEXTURE1);
            glBindTexture(GL_TEXTURE_2D, m_bloomB.tex);
            glDrawArrays(GL_TRIANGLES, 0, 3);
            glBindVertexArray(0);
        }
    }
    // Blit to screen
    glBindFramebuffer(GL_READ_FRAMEBUFFER, m_final.fbo);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
    glBlitFramebuffer(0, 0, m_final.w, m_final.h, 0, 0, m_w, m_h, GL_COLOR_BUFFER_BIT, GL_NEAREST);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, 0);
}
