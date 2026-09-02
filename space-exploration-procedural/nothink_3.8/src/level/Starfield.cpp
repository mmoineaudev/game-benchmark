#pragma once
#include <GL/glew.h>
#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>


#include "Starfield.hpp"
#include "Shader.hpp"
#include "Rng.hpp"

void Starfield::init() {
    VD::Mulberry32 rng(42);
    auto make = [&](int count, float sizeMin, float sizeMax, auto& vec) {
        vec.clear();
        vec.reserve(count);
        for (int i = 0; i < count; i++) {
            Star s;
            s.pos = VD::Vec3(
                rng.range(-VD::STARFIELD_WRAP, VD::STARFIELD_WRAP),
                rng.range(-VD::STARFIELD_WRAP, VD::STARFIELD_WRAP),
                rng.range(-VD::STARFIELD_WRAP, VD::STARFIELD_WRAP));
            s.size = rng.range(sizeMin, sizeMax);
            float t = rng.next();
            if (t < 0.3f) s.color = VD::Vec3(0.7f, 0.8f, 1.0f);
            else if (t < 0.7f) s.color = VD::Vec3(1, 1, 1);
            else if (t < 0.9f) s.color = VD::Vec3(1.0f, 0.85f, 0.7f);
            else s.color = VD::Vec3(1.0f, 0.5f, 0.3f);
            s.phase = rng.range(0, 6.28f);
            vec.push_back(s);
        }
    };
    make(VD::STAR_FAR_COUNT, 1.0f, 2.0f, starsFar);
    make(VD::STAR_MID_COUNT, 2.0f, 3.0f, starsMid);
    make(VD::STAR_NEAR_COUNT, 3.0f, 4.5f, starsNear);
    make(VD::BRIGHT_STAR_COUNT, 5.0f, 8.0f, starsBright);

    shooters.resize(2);
    for (auto& s : shooters) { s.active = false; s.life = 0; }
}

void Starfield::dispose() {
    for (auto& v : {vbo[0],vbo[1],vbo[2],vbo[3]})
        if (v) glDeleteBuffers(1, &v);
}

void Starfield::update(float dt, const VD::Vec3&) {
    spawnTimer += dt;
    if (spawnTimer > VD::SHOOTING_INTERVAL) {
        spawnTimer = 0;
        for (auto& s : shooters) {
            if (!s.active) {
                s.active = true;
                s.life = VD::SHOOTING_LIFE;
                s.pos = VD::Vec3((float)(rand()%1000)-500, 100, -200);
                s.vel = glm::normalize(VD::Vec3(-1, -0.3f, 0)) * VD::SHOOTING_SPEED;
                break;
            }
        }
    }
    for (auto& s : shooters) {
        if (!s.active) continue;
        s.life -= dt;
        s.pos += s.vel * dt;
        if (s.life <= 0) s.active = false;
    }
}

void Starfield::wrap(const VD::Vec3& shipPos) {
    auto wrap1 = [&](auto& vec, float parallax) {
        for (auto& s : vec) {
            s.pos -= shipPos * parallax;
            for (int i = 0; i < 3; i++)
                if (s.pos[i] < -VD::STARFIELD_WRAP) s.pos[i] += 2*VD::STARFIELD_WRAP;
            for (int i = 0; i < 3; i++)
                if (s.pos[i] > VD::STARFIELD_WRAP) s.pos[i] -= 2*VD::STARFIELD_WRAP;
        }
    };
    wrap1(starsFar, VD::PARALLAX_FAR);
    wrap1(starsMid, VD::PARALLAX_MID);
    wrap1(starsNear, VD::PARALLAX_NEAR);
    wrap1(starsBright, VD::PARALLAX_NEAR);
}

static void writeStarVBO(GLuint vbo, const std::vector<Star>& stars) {
    std::vector<float> data;
    data.reserve(stars.size() * 8);
    for (auto& s : stars) {
        data.push_back(s.pos.x); data.push_back(s.pos.y); data.push_back(s.pos.z);
        data.push_back(s.size);
        data.push_back(s.color.x); data.push_back(s.color.y); data.push_back(s.color.z);
        data.push_back(s.phase);
    }
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, data.size()*sizeof(float), data.data(), GL_DYNAMIC_DRAW);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
}

void Starfield::render(const VD::Mat4& viewProj, const VD::Vec3&) {
    Shader* s = Shader::get("star");
    if (!s) return;
    s->use();
    glBindVertexArray(0);
    // Ensure VBOs exist
    static bool inited = false;
    if (!inited) {
        for (int i = 0; i < 4; i++) glGenBuffers(1, &vbo[i]);
        inited = true;
    }
    int uVP = Shader::u(s, "uViewProj");
    int uTime = Shader::u(s, "uTime");
    glUniformMatrix4fv(uVP, 1, GL_FALSE, &viewProj[0][0]);
    glUniform1f(uTime, (float)(glfwGetTime() * 0.1));

    auto draw = [&](const std::vector<Star>& stars, int vboIdx) {
        if (stars.empty()) return;
        writeStarVBO(vbo[vboIdx], stars);
        glBindBuffer(GL_ARRAY_BUFFER, vbo[vboIdx]);
        // Rebuild VAO each frame (simple; could cache)
        static GLuint vaos[4] = {0};
        if (!vaos[vboIdx]) glGenVertexArrays(1, &vaos[vboIdx]);
        glBindVertexArray(vaos[vboIdx]);
        if (vboIdx == 0 && vaos[vboIdx] && !glIsBuffer(vbo[vboIdx])) {}
        // Setup attributes
        for (int i = 0; i < 4; i++) {
            glEnableVertexAttribArray(i);
            glVertexAttribPointer(i, i == 1 ? 1 : (i == 2 ? 3 : 3), GL_FLOAT, GL_FALSE, 32, (void*)(i * 4 * sizeof(float)));
        }
        glDrawArrays(GL_POINTS, 0, (int)stars.size());
        glBindVertexArray(0);
    };
    draw(starsFar, 0);
    draw(starsMid, 1);
    draw(starsNear, 2);
    draw(starsBright, 3);
}
