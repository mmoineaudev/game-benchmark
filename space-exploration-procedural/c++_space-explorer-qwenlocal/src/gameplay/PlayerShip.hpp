#pragma once
#include <string>
#include <vector>
#include <memory>
#include "entities/Entity.hpp"
#include "entities/components/Physics.hpp"
#include "entities/components/Render.hpp"
#include "entities/components/Damage.hpp"
#include "systems/InputSystem.hpp"
#include "utils/Math.hpp"
#include "core/Constants.hpp"
#include "utils/Logging.hpp"

namespace SH {

class PlayerShip : public Entity {
public:
    PlayerShip(const std::string& shipId = "hauler_mk1");
    ~PlayerShip() override = default;

    void update(float dt) override;
    void onCollision(Entity* other) override;
    void onRemove() override;

    // Ship stats
    int getCredits() const { return credits_; }
    int getCargo() const { return cargo_; }
    int getCargoMax() const { return cargoMax_; }
    int getFuel() const { return fuel_; }
    int getFuelMax() const { return fuelMax_; }
    int getHull() const { return hull_; }
    int getHullMax() const { return hullMax_; }
    int getShield() const { return shield_; }
    int getShieldMax() const { return shieldMax_; }
    float getSpeed() const { return speed_; }

    // Ship modifications
    void setCredits(int val) { credits_ = val; }
    void addCredits(int amount) { credits_ += amount; }
    void deductCredits(int amount) { credits_ -= amount; if (credits_ < 0) credits_ = 0; }
    void setCargo(int val) { cargo_ = std::min(val, cargoMax_); }
    void addCargo(int amount) { cargo_ = std::min(cargo_ + amount, cargoMax_); }
    void removeCargo(int amount) { cargo_ -= amount; if (cargo_ < 0) cargo_ = 0; }
    void setFuel(int val) { fuel_ = val; }
    void addFuel(int amount) { fuel_ = std::min(fuel_ + amount, fuelMax_); }
    void consumeFuel(float amount) { fuel_ -= static_cast<int>(amount); if (fuel_ < 0) fuel_ = 0; }
    void setHull(int val) { hull_ = val; }
    void addHull(int val) { hull_ = std::min(hull_ + val, hullMax_); }
    void damageHull(int amount) { hull_ -= amount; if (hull_ < 0) hull_ = 0; }
    void setShield(int val) { shield_ = val; }
    void addShield(int val) { shield_ = std::min(shield_ + val, shieldMax_); }
    void damageShield(int amount) { shield_ -= amount; if (shield_ < 0) shield_ = 0; }
    void setSpeed(float val) { speed_ = val; }

    // Movement
    void applyInput(const InputSystem& input, float dt);
    void applyThrust(float amount, float dt);
    void applyRoll(float amount, float dt);
    void applyPitch(float amount, float dt);
    void applyYaw(float amount, float dt);

    // Collision
    void checkCollisionWith(Entity* other);
    void onPlayerCollision(Entity* other);

    // State
    bool isAlive() const { return hull_ > 0 && fuel_ > 0; }
    bool isDead() const { return hull_ <= 0 || fuel_ <= 0; }

    void setShipType(const std::string& type) { shipId_ = type; }
    const std::string& getShipType() const { return shipId_; }

    // Weapon
    void setHasWeapon(bool has) { hasWeapon_ = has; }
    bool hasWeapon() const { return hasWeapon_; }
    void setHasECM(bool has) { hasECM_ = has; }
    bool hasECM() const { return hasECM_; }

    // Debug
    void printState() const;

private:
    std::string shipId_;
    int credits_ = 50;
    int cargo_ = 0;
    int cargoMax_ = 20;
    int fuel_ = 600;
    int fuelMax_ = 600;
    int hull_ = 100;
    int hullMax_ = 100;
    int shield_ = 50;
    int shieldMax_ = 50;
    float speed_ = 1.0f;
    bool hasWeapon_ = false;
    bool hasECM_ = false;
    bool thrusting_ = false;
    bool deathLogged_ = false;

    // For collision detection
    std::vector<std::unique_ptr<Entity>> entities_;
};

} // namespace SH
