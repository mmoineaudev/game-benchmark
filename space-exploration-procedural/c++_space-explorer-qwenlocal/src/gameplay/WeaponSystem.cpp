#include "gameplay/WeaponSystem.hpp"
#include "utils/Math.hpp"
#include "utils/Logging.hpp"
#include <cmath>

namespace SH {

void WeaponSystem::init(PlayerShip& ship, int maxAmmo, float fireRate) {
    ship_ = &ship;
    maxAmmo_ = maxAmmo;
    currentAmmo_ = maxAmmo;
    fireRate_ = fireRate;
    timeSinceLastFire_ = fireRate_;
    LOG_INFO("WeaponSystem", "Weapon system initialized: ammo=" + std::to_string(maxAmmo_) +
             " fireRate=" + std::to_string(fireRate_));
}

void WeaponSystem::update(float dt, const InputSystem& input, std::vector<std::unique_ptr<Entity>>& entities) {
    timeSinceLastFire_ += dt;

    if (input.isPressed(InputSystem::Action::FIRE_TURRET) && canFire()) {
        fire(entities);
    }
}

void WeaponSystem::fire(std::vector<std::unique_ptr<Entity>>& entities) {
    if (!ship_ || !canFire()) return;

    Vec3 direction(0, 0, -1);
    Quat rotation = Quat::fromEuler(ship_->orientation.x, ship_->orientation.y, ship_->orientation.z);
    direction = rotation.apply(direction);

    Vec3 spawnPos = ship_->position + direction * 2.0f;

    auto projectile = std::make_unique<Projectile>(
        nextProjectileId_++,
        spawnPos,
        direction,
        100.0f,
        20
    );

    entities.push_back(std::move(projectile));
    removeAmmo(1);
    timeSinceLastFire_ = 0.0f;

    LOG_DEBUG("WeaponSystem", "Projectile fired: id=" + std::to_string(projectile->getId()));
}

} // namespace SH
