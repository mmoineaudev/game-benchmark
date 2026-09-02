#pragma once
#include <vector>
#include <memory>
#include "entities/Entity.hpp"
#include "utils/Math.hpp"
#include "core/Constants.hpp"
#include "utils/Logging.hpp"

namespace SH {

class Particle {
public:
    Vec3 position;
    Vec3 velocity;
    Vec3 color;
    float life;
    float maxLife;
    float size;

    void update(float dt) {
        position += velocity * dt;
        life -= dt;
        size *= 0.98f;
    }

    bool isDead() const { return life <= 0.0f; }
};

class ParticleSystem {
public:
    ParticleSystem(int maxParticles = 1000);
    ~ParticleSystem() = default;

    void init();
    void shutdown();

    void update(float dt);
    void render();

    void emitTrail(const Vec3& position, const Vec3& color, int count = 1);
    void emitExplosion(const Vec3& position, const Vec3& color, int count = 20);
    void emitEngineTrail(const Vec3& position, float speed);

    void clear();
    int getParticleCount() const { return static_cast<int>(particles_.size()); }

private:
    std::vector<std::unique_ptr<Particle>> particles_;
    int maxParticles_;
    int nextId_ = 0;
};

} // namespace SH
