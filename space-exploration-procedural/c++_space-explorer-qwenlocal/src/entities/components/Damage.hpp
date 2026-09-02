#pragma once
#include "entities/components/ComponentBase.hpp"
#include "utils/Logging.hpp"
#include <string>
#include <sstream>

namespace SH {

// Damage component: health, damage source, invulnerability
class DamageComponent : public ComponentBase {
public:
    DamageComponent(int health = 100, int maxHealth = 100)
        : health_(health), maxHealth_(maxHealth), invulnerable_(false) {}

    void update(float dt) override {}

    bool takeDamage(int amount, const std::string& source = "unknown") {
        if (invulnerable_) {
            LOG_DEBUG("Damage", "Entity took damage but was invulnerable: " + source);
            return false;
        }
        health_ = std::max(0, health_ - amount);
        LOG_INFO("Damage", "Entity took " + std::to_string(amount) + " damage from " + source + " (health=" + std::to_string(health_) + "/" + std::to_string(maxHealth_) + ")");
        if (health_ <= 0) {
            LOG_WARN("Damage", "Entity destroyed: " + source);
            return true;
        }
        return false;
    }

    void heal(int amount) {
        health_ = std::min(maxHealth_, health_ + amount);
    }

    void setInvulnerable(bool inv) { invulnerable_ = inv; }

    int health() const { return health_; }
    int maxHealth() const { return maxHealth_; }
    bool isDead() const { return health_ <= 0; }

    std::string type() const override { return "damage"; }

    void onCollision(Entity* other) override {}
    void onRemove() override {}
    void serialize(void* data) const override {}
    void deserialize(const void* data) override {}

private:
    int health_;
    int maxHealth_;
    bool invulnerable_;
};

} // namespace SH
