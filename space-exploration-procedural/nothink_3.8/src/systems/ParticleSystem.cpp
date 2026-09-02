#include "ParticleSystem.hpp"
#include "Shader.hpp"
#include <cmath>
#include <cstdlib>

void ParticleSystem::init() {
    m_exhaust.resize(VD::EXHAUST_MAX);
    m_spark.resize(VD::SPARK_MAX);
    m_explosion.resize(VD::EXPLOSION_MAX);
    m_ember.resize(VD::EMBER_MAX);
    m_sparkle.resize(VD::SPARKLE_MAX);
    for (auto& p : m_exhaust) p.active = false;
    for (auto& p : m_spark) p.active = false;
    for (auto& p : m_explosion) p.active = false;
    for (auto& p : m_ember) p.active = false;
    for (auto& p : m_sparkle) p.active = false;
}

void ParticleSystem::updatePool(std::vector<Particle>& pool, float dt) {
    for (auto& p : pool) {
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; continue; }
        p.pos += p.vel * dt;
        p.vel *= 0.98f; // drag
    }
}

void ParticleSystem::update(float dt) {
    updatePool(m_exhaust, dt);
    updatePool(m_spark, dt);
    updatePool(m_explosion, dt);
    updatePool(m_ember, dt);
    updatePool(m_sparkle, dt);
}

void ParticleSystem::emitExhaust(const VD::Vec3& pos, const VD::Vec3& dir, int count) {
    for (int i = 0; i < count && !m_exhaust.empty(); i++) {
        for (auto& p : m_exhaust) {
            if (p.active) continue;
            p.active = true;
            p.pos = pos;
            p.vel = -dir * (30 + (float)(rand()%20)) + VD::Vec3((float)(rand()%100)/100 - 0.5f, 0, (float)(rand()%100)/100 - 0.5f);
            p.life = p.maxLife = 0.3f + (float)rand()/RAND_MAX * 0.3f;
            p.size = 0.5f + (float)rand()/RAND_MAX * 0.5f;
            p.color = VD::Vec3(0.3f, 0.5f, 1.0f);
            break;
        }
    }
}

void ParticleSystem::emitExplosion(const VD::Vec3& pos, const VD::Vec3& color, int count) {
    for (int i = 0; i < count; i++) {
        for (auto& p : m_explosion) {
            if (p.active) continue;
            p.active = true;
            p.pos = pos;
            float theta = (float)rand()/RAND_MAX * 6.28f;
            float phi = (float)rand()/RAND_MAX * 3.14f;
            float speed = 20 + (float)rand()/RAND_MAX * 40;
            p.vel = VD::Vec3(
                cosf(phi)*sinf(theta)*speed,
                cosf(phi)*cosf(theta)*speed,
                sinf(phi)*sinf(theta)*speed);
            p.life = p.maxLife = 0.5f + (float)rand()/RAND_MAX * 1.0f;
            p.size = 1.0f + (float)rand()/RAND_MAX * 2.0f;
            p.color = color;
            break;
        }
    }
}

void ParticleSystem::emitSpark(const VD::Vec3& pos, int count) {
    for (int i = 0; i < count; i++) {
        for (auto& p : m_spark) {
            if (p.active) continue;
            p.active = true;
            p.pos = pos;
            p.vel = VD::Vec3((float)rand()/RAND_MAX - 0.5f, (float)rand()/RAND_MAX - 0.5f, (float)rand()/RAND_MAX - 0.5f) * 30.0f;
            p.life = p.maxLife = 0.2f;
            p.size = 0.3f;
            p.color = VD::Vec3(1, 1, 0.5f);
            break;
        }
    }
}

void ParticleSystem::emitEmber(const VD::Vec3& pos, const VD::Vec3& color, int count) {
    for (int i = 0; i < count; i++) {
        for (auto& p : m_ember) {
            if (p.active) continue;
            p.active = true;
            p.pos = pos;
            p.vel = VD::Vec3((float)rand()/RAND_MAX - 0.5f, 0.5f, (float)rand()/RAND_MAX - 0.5f) * 10.0f;
            p.life = p.maxLife = 1.0f;
            p.size = 0.5f;
            p.color = color;
            break;
        }
    }
}

void ParticleSystem::emitSparkle(const VD::Vec3& pos, const VD::Vec3& color, int count) {
    for (int i = 0; i < count; i++) {
        for (auto& p : m_sparkle) {
            if (p.active) continue;
            p.active = true;
            p.pos = pos;
            p.vel = VD::Vec3((float)rand()/RAND_MAX - 0.5f, (float)rand()/RAND_MAX - 0.5f, (float)rand()/RAND_MAX - 0.5f) * 5.0f;
            p.life = p.maxLife = 0.8f;
            p.size = 0.4f;
            p.color = color;
            break;
        }
    }
}

void ParticleSystem::render(const VD::Mat4& viewProj, const VD::Vec3& cam) {
    (void)viewProj;
    (void)cam;
    // Render particles as GL_POINTS with particle shader
    // (simplified: skip for now, particles are a visual bonus)
}
