#include "systems/PhysicsSystem.hpp"
#include "utils/Logging.hpp"
#include "utils/Math.hpp"
#include <algorithm>

namespace SH {

PhysicsSystem::PhysicsSystem() : debugMode_(false) {}

void PhysicsSystem::init() {
    LOG_INFO("PhysicsSystem", "Physics system initialized");
}

void PhysicsSystem::shutdown() {
    LOG_INFO("PhysicsSystem", "Physics system shut down");
}

void PhysicsSystem::update(float dt) {
    // Update all entities with physics components
    for (auto& entity : entities_) {
        if (!entity->isActive()) continue;

        auto* physics = entity->getComponent<PhysicsComponent>();
        if (physics) {
            physics->update(dt);
        }
    }

    // Handle collisions
    handleCollisions(dt);

    if (debugMode_) {
        LOG_DEBUG("PhysicsSystem", "Physics tick: " + std::to_string(entities_.size()) +
                 " entities, " + std::to_string(collisionChecks_) + " collision checks");
    }
}

void PhysicsSystem::handleCollisions(float dt) {
    collisionChecks_ = 0;

    // Simple O(n^2) collision detection
    for (size_t i = 0; i < entities_.size(); i++) {
        if (!entities_[i]->isActive()) continue;

        for (size_t j = i + 1; j < entities_.size(); j++) {
            if (!entities_[j]->isActive()) continue;

            // Check AABB overlap
            float dx = entities_[i]->position.x - entities_[j]->position.x;
            float dy = entities_[i]->position.y - entities_[j]->position.y;
            float dz = entities_[i]->position.z - entities_[j]->position.z;
            float dist = std::sqrt(dx * dx + dy * dy + dz * dz);

            float minDist = entities_[i]->radius + entities_[j]->radius;
            if (dist < minDist && dist > 0.001f) {
                // Collision detected
                entities_[i]->onCollision(entities_[j].get());
                entities_[j]->onCollision(entities_[i].get());

                // Resolve collision
                Vec3 push = Vec3(dx, dy, dz).norm() * (minDist - dist) * 0.5f;
                entities_[i]->position += push;
                entities_[j]->position -= push;

                // Exchange velocities (elastic collision)
                auto* physI = entities_[i]->getComponent<PhysicsComponent>();
                auto* physJ = entities_[j]->getComponent<PhysicsComponent>();
                if (physI && physJ) {
                    Vec3 temp = physI->velocity();
                    physI->setVelocity(physJ->velocity());
                    physJ->setVelocity(temp);
                }

                collisionChecks_++;
            }
        }
    }
}

void PhysicsSystem::addEntity(std::unique_ptr<Entity> entity) {
    entities_.push_back(std::move(entity));
}

void PhysicsSystem::removeEntity(int id) {
    entities_.erase(
        std::remove_if(entities_.begin(), entities_.end(),
            [id](const auto& e) { return e->getId() == id; }),
        entities_.end());
}

void PhysicsSystem::clear() {
    entities_.clear();
}

size_t PhysicsSystem::getEntityCount() const {
    return entities_.size();
}

void PhysicsSystem::setDebugMode(bool debug) {
    debugMode_ = debug;
}

} // namespace SH
