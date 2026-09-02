#pragma once
#include <GL/glew.h>
#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>


#include "WeaponSystem.hpp"
#include "PlayerShip.hpp"
#include "Shader.hpp"
#include <cmath>

void WeaponSystem::init() {
    m_beams.resize(VD::LASER_POOL);
    m_crystalBeams.resize(VD::CRYSTAL_CHILD_BEAM_MAX);
    for (auto& b : m_beams) b.active = false;
    for (auto& b : m_crystalBeams) b.active = false;
    m_nextBeam = 0;
}

void WeaponSystem::update(float dt, const PlayerShip& ship) {
    // Update player beams
    for (auto& b : m_beams) {
        if (!b.active) continue;
        b.life -= dt;
        if (b.life <= 0) { b.active = false; continue; }
        b.origin += b.dir * VD::PROJECTILE_SPEED * dt;
    }

    // Crystal beams
    for (auto& b : m_crystalBeams) {
        if (!b.active) continue;
        b.life -= dt;
        if (b.life <= 0) { b.active = false; continue; }
    }
}

void WeaponSystem::firePlayerBeams(const PlayerShip& ship) {
    if (!ship.isFiring()) return;
    // 4 muzzles
    VD::Vec3 m0, m1, m2, m3;
    ship.muzzlePositions(m0, m1, m2, m3);
    VD::Vec3 f = ship.forward();
    // Spread: ±3°
    float spread = 0.052f;
    VD::Vec3 d0 = glm::normalize(f + ship.right() * spread);
    VD::Vec3 d1 = glm::normalize(f - ship.right() * spread);
    VD::Vec3 d2 = f;
    VD::Vec3 d3 = f;

    LaserBeam& b0 = m_beams[m_nextBeam]; m_nextBeam = (m_nextBeam+1) % VD::LASER_POOL;
    LaserBeam& b1 = m_beams[m_nextBeam]; m_nextBeam = (m_nextBeam+1) % VD::LASER_POOL;
    LaserBeam& b2 = m_beams[m_nextBeam]; m_nextBeam = (m_nextBeam+1) % VD::LASER_POOL;
    LaserBeam& b3 = m_beams[m_nextBeam]; m_nextBeam = (m_nextBeam+1) % VD::LASER_POOL;

    b0.origin = m0; b0.dir = d0; b0.life = VD::PROJECTILE_LIFETIME; b0.length = VD::PROJECTILE_RANGE; b0.active = true; b0.childIndex = -1;
    b1.origin = m1; b1.dir = d1; b1.life = VD::PROJECTILE_LIFETIME; b1.length = VD::PROJECTILE_RANGE; b1.active = true; b1.childIndex = -1;
    b2.origin = m2; b2.dir = d2; b2.life = VD::PROJECTILE_LIFETIME; b2.length = VD::PROJECTILE_RANGE; b2.active = true; b2.childIndex = -1;
    b3.origin = m3; b3.dir = d3; b3.life = VD::PROJECTILE_LIFETIME; b3.length = VD::PROJECTILE_RANGE; b3.active = true; b3.childIndex = -1;
}

void WeaponSystem::fireCrystalChild(const VD::Vec3& pos, const VD::Vec3& baseDir) {
    // Split into 2 children at ±18°
    const VD::Vec3 up(0,1,0);
    VD::Vec3 perp = glm::normalize(glm::cross(baseDir, up));
    float a = VD::CRYSTAL_SPLIT_ANGLE;
    VD::Vec3 d0 = glm::normalize(baseDir + perp * sinf(a));
    VD::Vec3 d1 = glm::normalize(baseDir - perp * sinf(a));

    int idx = -1;
    for (int i = 0; i < (int)m_crystalBeams.size(); i++) {
        if (!m_crystalBeams[i].active) { idx = i; break; }
    }
    if (idx < 0) return;
    m_crystalBeams[idx].origin = pos;
    m_crystalBeams[idx].dir = d0;
    m_crystalBeams[idx].life = VD::PROJECTILE_LIFETIME * 0.7f;
    m_crystalBeams[idx].length = VD::PROJECTILE_RANGE * 0.5f;
    m_crystalBeams[idx].active = true;
    m_crystalBeams[idx].parentIdx = -1;

    for (int i = 0; i < (int)m_crystalBeams.size(); i++) {
        if (!m_crystalBeams[i].active) {
            m_crystalBeams[i].origin = pos;
            m_crystalBeams[i].dir = d1;
            m_crystalBeams[i].life = VD::PROJECTILE_LIFETIME * 0.7f;
            m_crystalBeams[i].length = VD::PROJECTILE_RANGE * 0.5f;
            m_crystalBeams[i].active = true;
            m_crystalBeams[i].parentIdx = -1;
            break;
        }
    }
}

void WeaponSystem::clearAll() {
    for (auto& b : m_beams) b.active = false;
    for (auto& b : m_crystalBeams) b.active = false;
}

void WeaponSystem::killBeam(int idx) {
    if (idx >= 0 && idx < (int)m_beams.size()) m_beams[idx].active = false;
}

void WeaponSystem::render(const VD::Mat4& viewProj, const VD::Vec3& cam) {
    // Player beams: instanced billboards
    Shader* s = Shader::get("beam");
    if (!s) return;
    s->use();

    int uVP = Shader::u(s, "uViewProj");
    int uTime = Shader::u(s, "uTime");
    glUniformMatrix4fv(uVP, 1, GL_FALSE, &viewProj[0][0]);
    glUniform1f(uTime, (float)glfwGetTime());

    static GLuint vao = 0, vbo = 0, ibo = 0;
    if (!vao) {
        glGenVertexArrays(1, &vao);
        glGenBuffers(1, &vbo);
        glGenBuffers(1, &ibo);
        // Quad: 4 corners + 2 indices
        float corners[8] = {-1,-1, 1,-1, 1,1, -1,1};
        glBindVertexArray(vao);
        glBindBuffer(GL_ARRAY_BUFFER, vbo);
        glBufferData(GL_ARRAY_BUFFER, sizeof(corners), corners, GL_STATIC_DRAW);
        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, 0);
        glEnableVertexAttribArray(0);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo);
        static unsigned short idx[6] = {0,1,2, 0,2,3};
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(idx), idx, GL_STATIC_DRAW);
    }

    // Write instance data
    static std::vector<float> inst;
    inst.clear();
    for (auto& b : m_beams) {
        if (!b.active) continue;
        // origin, size(1,1,1), dir, alive
        inst.push_back(b.origin.x); inst.push_back(b.origin.y); inst.push_back(b.origin.z);
        inst.push_back(1); inst.push_back(1); inst.push_back(1);
        inst.push_back(b.dir.x); inst.push_back(b.dir.y); inst.push_back(b.dir.z);
        inst.push_back(1.0f);
    }
    int n = inst.size() / 12;
    if (n == 0) return;

    static GLuint instVbo = 0;
    if (!instVbo) glGenBuffers(1, &instVbo);
    glBindBuffer(GL_ARRAY_BUFFER, instVbo);
    glBufferData(GL_ARRAY_BUFFER, inst.size()*4, inst.data(), GL_DYNAMIC_DRAW);

    glBindVertexArray(vao);
    // Attribute locations: 0=corner(2), 1=pos(3), 2=size(1), 3=dir(3), 4=alive(1)
    for (int i = 0; i < 5; i++) {
        if (i == 0) { glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, 0); continue; }
        int comp = (i==1) ? 3 : (i==2 ? 1 : (i==3 ? 3 : 1));
        float off = i == 1 ? 0 : 8; // pos starts at offset 8 (after 2 corners)
        if (i == 1) { glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 48, (void*)(8)); }
        else if (i == 2) { glVertexAttribPointer(2, 1, GL_FLOAT, GL_FALSE, 48, (void*)(20)); }
        else if (i == 3) { glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, 48, (void*)(24)); }
        else if (i == 4) { glVertexAttribPointer(4, 1, GL_FLOAT, GL_FALSE, 48, (void*)(36)); }
        glEnableVertexAttribArray(i);
    }
    glDrawElementsInstanced(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, 0, n);
    glBindVertexArray(0);
}
