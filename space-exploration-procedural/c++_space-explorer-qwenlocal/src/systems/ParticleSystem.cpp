#include "systems/ParticleSystem.hpp"
#include "utils/Math.hpp"
#include "utils/Logging.hpp"
#include <random>

namespace SH {

class InternalRNG {
public:
    InternalRNG() : gen_(std::random_device{}()) {}
    float randFloat(float min = 0.0f, float max = 1.0f) {
        std::uniform_real_distribution<float> dist(min, max);
        return dist(gen_);
    }
private:
    std::mt19937 gen_;
};

ParticleSystem::ParticleSystem(int maxParticles)
    : maxParticles_(maxParticles), nextId_(0) {
    particles_.reserve(maxParticles_);
}

void ParticleSystem::init() {
    LOG_INFO("ParticleSystem", "Particle system initialized: maxParticles=" + std::to_string(maxParticles_));
}

void ParticleSystem::shutdown() {
    clear();
    LOG_INFO("ParticleSystem", "Particle system shut down");
}

void ParticleSystem::update(float dt) {
    auto it = particles_.begin();
    while (it != particles_.end()) {
        (*it)->update(dt);
        if ((*it)->isDead()) {
            it = particles_.erase(it);
        } else {
            ++it;
        }
    }

    LOG_DEBUG("ParticleSystem", "Active particles: " + std::to_string(particles_.size()));
}

void ParticleSystem::render() {
    for (auto& p : particles_) {
        // Draw as point sprite in OpenGL
        // Position: p->position, Color: p->color, Size: p->size
    }
}

void ParticleSystem::emitTrail(const Vec3& position, const Vec3& color, int count) {
    static InternalRNG rng;
    for (int i = 0; i < count && static_cast<int>(particles_.size()) < maxParticles_; i++) {
        auto particle = std::make_unique<Particle>();
        particle->position = position + Vec3{
            rng.randFloat(-0.1f, 0.1f),
            rng.randFloat(-0.1f, 0.1f),
            rng.randFloat(-0.1f, 0.1f)
        };
        particle->velocity = Vec3{
            rng.randFloat(-0.5f, 0.0f),
            rng.randFloat(-0.5f, 0.5f),
            rng.randFloat(-0.5f, 0.5f)
        };
        particle->color = color;
        particle->life = rng.randFloat(0.2f, 0.5f);
        particle->maxLife = particle->life;
        particle->size = rng.randFloat(0.1f, 0.3f);

        particles_.push_back(std::move(particle));
    }
}

void ParticleSystem::emitExplosion(const Vec3& position, const Vec3& color, int count) {
    static InternalRNG rng;
    for (int i = 0; i < count && static_cast<int>(particles_.size()) < maxParticles_; i++) {
        auto particle = std::make_unique<Particle>();
        particle->position = position;

        float theta = rng.randFloat(0.0f, 3.14159f * 2.0f);
        float phi = rng.randFloat(0.0f, 3.14159f);
        float speed = rng.randFloat(1.0f, 5.0f);

        particle->velocity = Vec3{
            speed * std::sin(phi) * std::cos(theta),
            speed * std::sin(phi) * std::sin(theta),
            speed * std::cos(phi)
        };

        particle->color = color;
        particle->life = rng.randFloat(0.5f, 1.5f);
        particle->maxLife = particle->life;
        particle->size = rng.randFloat(0.2f, 0.5f);

        particles_.push_back(std::move(particle));
    }
}

void ParticleSystem::emitEngineTrail(const Vec3& position, float speed) {
    static InternalRNG rng;
    if (static_cast<int>(particles_.size()) < maxParticles_) {
        auto particle = std::make_unique<Particle>();
        particle->position = position;
        particle->velocity = Vec3{0.0f, 0.0f, -speed * 0.1f};
        particle->color = Vec3{1.0f, 0.5f, 0.0f};
        particle->life = rng.randFloat(0.3f, 0.8f);
        particle->maxLife = particle->life;
        particle->size = rng.randFloat(0.1f, 0.4f);

        particles_.push_back(std::move(particle));
    }
}

void ParticleSystem::clear() {
    particles_.clear();
}

} // namespace SH
