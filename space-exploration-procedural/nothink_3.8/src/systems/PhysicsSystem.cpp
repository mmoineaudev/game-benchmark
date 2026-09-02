#include "PhysicsSystem.hpp"
#include "PlayerShip.hpp"
#include "EventBus.hpp"

void PhysicsSystem::init() {
    m_invulnTimer = 0;
}

void PhysicsSystem::update(float dt, PlayerShip& ship, const std::vector<const void*>& colliders) {
    (void)colliders;
    m_invulnTimer = std::max(0.0f, m_invulnTimer - dt);
    if (ship.invulnTimer() > 0) return;
    // Collision checks done in Game loop per-entity
}

void PhysicsSystem::shipCollision(PlayerShip& ship) {
    if (ship.invulnTimer() > 0) return;
}

void PhysicsSystem::laserCollision(PlayerShip& ship, const std::vector<const void*>& entities) {
    (void)ship;
    (void)entities;
}
