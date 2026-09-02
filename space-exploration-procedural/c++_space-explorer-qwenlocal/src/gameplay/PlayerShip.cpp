#include "gameplay/PlayerShip.hpp"
#include "systems/InputSystem.hpp"
#include "core/Constants.hpp"
#include "utils/Math.hpp"
#include "utils/Logging.hpp"
#include <iostream>
#include <cmath>

namespace SH {

PlayerShip::PlayerShip(const std::string& shipId)
    : Entity("player_ship", 1), shipId_(shipId) {
    LOG_INFO("PlayerShip", "Creating ship: " + shipId_);
    
    // Apply ship stats based on type
    if (shipId_ == "hauler_mk1") {
        cargoMax_ = 20; fuelMax_ = 600; hullMax_ = 100; shieldMax_ = 50;
    } else if (shipId_ == "fast_courier") {
        cargoMax_ = 10; fuelMax_ = 480; hullMax_ = 70; shieldMax_ = 30;
    } else if (shipId_ == "bulk_transporter") {
        cargoMax_ = 50; fuelMax_ = 900; hullMax_ = 200; shieldMax_ = 80;
    } else if (shipId_ == "armed_escort") {
        cargoMax_ = 15; fuelMax_ = 600; hullMax_ = 150; shieldMax_ = 60;
        hasWeapon_ = true;
    } else if (shipId_ == "smuggler_run") {
        cargoMax_ = 20; fuelMax_ = 600; hullMax_ = 100; shieldMax_ = 50;
        hasWeapon_ = true;
        hasECM_ = true;
    }
    
    fuel_ = fuelMax_;
    hull_ = hullMax_;
    shield_ = shieldMax_;
    
    // Add components
    addComponent<PhysicsComponent>(1.0f, 1.5f);
    addComponent<DamageComponent>(hullMax_, hullMax_);
    
    LOG_DEBUG("PlayerShip", "Ship stats: cargo=" + std::to_string(cargoMax_) + 
              " fuel=" + std::to_string(fuelMax_) + 
              " hull=" + std::to_string(hullMax_) + 
              " shield=" + std::to_string(shieldMax_));
}

void PlayerShip::update(float dt) {
    // Update base class components
    Entity::update(dt);
    
    // Update position based on velocity
    position = position + velocity * dt;
    
    // Fuel drains only while engines are running, time-based (~5 units/sec)
    if (thrusting_ && fuel_ > 0) {
        consumeFuel(5.0f * dt);
    }
    
    if (isDead() && !deathLogged_) {
        deathLogged_ = true;
        LOG_WARN("PlayerShip", "Ship destroyed: hull=" + std::to_string(hull_) + 
                 " fuel=" + std::to_string(fuel_));
    }
}

void PlayerShip::onCollision(Entity* other) {
    // Handle collision with other entities
    if (!other) return;
    
    // Check for damage
    if (other->hasComponent<DamageComponent>()) {
        auto* dmg = other->getComponent<DamageComponent>();
        if (dmg && !dmg->isDead()) {
            // Take damage from collision
            int damage = 5; // Base collision damage
            hull_ -= damage;
            if (hull_ < 0) hull_ = 0;
            LOG_WARN("PlayerShip", "Collision damage: " + std::to_string(damage) + " hull=" + std::to_string(hull_));
        }
    }
    
    // Check for cargo pickup (if it's a cargo container)
    if (other->getType() == "cargo_container") {
        int cargoAmount = 1; // Default cargo amount
        addCargo(cargoAmount);
        LOG_INFO("PlayerShip", "Picked up cargo: " + std::to_string(cargoAmount));
    }
}

void PlayerShip::onRemove() {
    LOG_INFO("PlayerShip", "Ship removed from world");
    Entity::onRemove();
}

void PlayerShip::applyInput(const InputSystem& input, float dt) {
    float dtNorm = dt * 60.0f; // Normalize to 60fps
    
    // Pitch (W/S)
    if (input.isDown(InputSystem::Action::PITCH_DOWN)) {
        applyPitch(-1.5f * dtNorm, dt);
    }
    if (input.isDown(InputSystem::Action::PITCH_UP)) {
        applyPitch(1.5f * dtNorm, dt);
    }
    
    // Strafe (Q/D)
    if (input.isDown(InputSystem::Action::STRAFE_LEFT)) {
        velocity.x -= 10.0f * dtNorm;
    }
    if (input.isDown(InputSystem::Action::STRAFE_RIGHT)) {
        velocity.x += 10.0f * dtNorm;
    }
    
    // Roll (A/E)
    if (input.isDown(InputSystem::Action::ROLL_LEFT)) {
        applyRoll(-3.0f * dtNorm, dt);
    }
    if (input.isDown(InputSystem::Action::ROLL_RIGHT)) {
        applyRoll(3.0f * dtNorm, dt);
    }
    
    // Thrust (Shift/Ctrl)
    thrusting_ = false;
    if (input.isDown(InputSystem::Action::THRUST_FORWARD)) {
        applyThrust(1.0f, dt);
        thrusting_ = true;
    }
    if (input.isDown(InputSystem::Action::THRUST_BACK)) {
        applyThrust(-0.5f, dt);
        thrusting_ = true;
    }
}

void PlayerShip::applyThrust(float amount, float dt) {
    // Forward/backward thrust
    float thrustSpeed = amount * speed_ * 10.0f;
    velocity.z += thrustSpeed * dt;
}

void PlayerShip::applyRoll(float amount, float dt) {
    // Roll rotation
    orientation.z += amount * dt;
}

void PlayerShip::applyPitch(float amount, float dt) {
    // Pitch rotation
    orientation.x += amount * dt;
}

void PlayerShip::applyYaw(float amount, float dt) {
    // Yaw rotation (mouse)
    orientation.y += amount * dt;
}

void PlayerShip::checkCollisionWith(Entity* other) {
    if (!other) return;
    
    // Simple distance-based collision
    float dx = position.x - other->position.x;
    float dy = position.y - other->position.y;
    float dz = position.z - other->position.z;
    float distance = std::sqrt(dx * dx + dy * dy + dz * dz);
    
    float collisionDist = 1.5f + other->radius; // Ship radius + object radius
    if (distance < collisionDist) {
        onCollision(other);
    }
}

void PlayerShip::onPlayerCollision(Entity* other) {
    // Handle collision response
    if (!other) return;
    
    // Push apart
    float dx = position.x - other->position.x;
    float dy = position.y - other->position.y;
    float dz = position.z - other->position.z;
    float distance = std::sqrt(dx * dx + dy * dy + dz * dz);
    
    if (distance > 0.001f) {
        float pushStrength = (1.5f + other->radius - distance) * 0.5f;
        Vec3 push = Vec3(dx, dy, dz).norm() * pushStrength;
        position += push;
        other->position -= push;
    }
}

void PlayerShip::printState() const {
    LOG_INFO("PlayerShip", "Ship state: " + shipId_ + 
             " credits=" + std::to_string(credits_) +
             " cargo=" + std::to_string(cargo_) + "/" + std::to_string(cargoMax_) +
             " fuel=" + std::to_string(fuel_) + "/" + std::to_string(fuelMax_) +
             " hull=" + std::to_string(hull_) + "/" + std::to_string(hullMax_) +
             " shield=" + std::to_string(shield_) + "/" + std::to_string(shieldMax_));
}

} // namespace SH
