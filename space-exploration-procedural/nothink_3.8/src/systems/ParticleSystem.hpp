#pragma once
#include "Constants.hpp"
#include <vector>

struct Particle {
    VD::Vec3 pos, vel;
    float life, maxLife;
    float size;
    VD::Vec3 color;
    bool active = false;
};

class ParticleSystem {
public:
    void init();
    void update(float dt);
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos);
    void emitExhaust(const VD::Vec3& pos, const VD::Vec3& dir, int count);
    void emitExplosion(const VD::Vec3& pos, const VD::Vec3& color, int count);
    void emitSpark(const VD::Vec3& pos, int count);
    void emitEmber(const VD::Vec3& pos, const VD::Vec3& color, int count);
    void emitSparkle(const VD::Vec3& pos, const VD::Vec3& color, int count);
private:
    std::vector<Particle> m_exhaust;
    std::vector<Particle> m_spark;
    std::vector<Particle> m_explosion;
    std::vector<Particle> m_ember;
    std::vector<Particle> m_sparkle;
    void updatePool(std::vector<Particle>& pool, float dt);
};
