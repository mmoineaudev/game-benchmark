#pragma once
#include <vector>
#include <memory>
#include "entities/Entity.hpp"
#include "gameplay/PlayerShip.hpp"
#include "systems/InputSystem.hpp"
#include "core/Constants.hpp"
#include "utils/Logging.hpp"

namespace SH {

class Projectile : public Entity {
public:
    Projectile(int id, const Vec3& position, const Vec3& direction, float speed = 100.0f, int damage = 20)
        : Entity("projectile", id), position(position), direction_(direction.norm()),
          speed_(speed), damage_(damage), lifeTime_(2.0f) {
        radius = 0.2f;
        addComponent<PhysicsComponent>(0.1f, 0.2f);
        addComponent<DamageComponent>(damage_, damage_);
    }

    void update(float dt) override {
        position += direction_ * speed_ * dt;
        lifeTime_ -= dt;
        if (lifeTime_ <= 0) {
            setActive(false);
        }
    }

    void onCollision(Entity* other) override {
        if (other && other->hasComponent<DamageComponent>()) {
            other->onCollision(this);
            setActive(false);
        }
    }

    void onRemove() override {}

    Vec3 position;
    Vec3 direction_;
    float speed_;
    int damage_;
    float lifeTime_;
};

class WeaponSystem {
public:
    WeaponSystem() = default;

    void init(PlayerShip& ship, int maxAmmo = 30, float fireRate = 0.2f);

    void update(float dt, const InputSystem& input, std::vector<std::unique_ptr<Entity>>& entities);

    bool canFire() const { return timeSinceLastFire_ >= fireRate_ && currentAmmo_ > 0; }
    void fire(std::vector<std::unique_ptr<Entity>>& entities);

    int getAmmo() const { return currentAmmo_; }
    int getMaxAmmo() const { return maxAmmo_; }
    void addAmmo(int amount) { currentAmmo_ += amount; if (currentAmmo_ > maxAmmo_) currentAmmo_ = maxAmmo_; }
    void removeAmmo(int amount) { currentAmmo_ -= amount; if (currentAmmo_ < 0) currentAmmo_ = 0; }

    float getFireRate() const { return fireRate_; }

    void setShip(PlayerShip* ship) { ship_ = ship; }

private:
    PlayerShip* ship_ = nullptr;
    int maxAmmo_ = 30;
    int currentAmmo_ = 30;
    float fireRate_ = 0.2f;
    float timeSinceLastFire_ = 0.0f;
    int nextProjectileId_ = 100;
};

} // namespace SH
