#pragma once
#include "Constants.hpp"
#include <vector>

class PlayerShip;

class PhysicsSystem {
public:
    void init();
    void update(float dt, PlayerShip& ship, const std::vector<const void*>& colliders);
    void shipCollision(PlayerShip& ship);
    void laserCollision(PlayerShip& ship, const std::vector<const void*>& entities);
private:
    float m_invulnTimer = 0;
};
