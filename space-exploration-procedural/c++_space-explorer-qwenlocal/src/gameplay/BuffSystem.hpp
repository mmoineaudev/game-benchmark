#pragma once
#include <vector>
#include <unordered_map>
#include <string>
#include <functional>
#include "gameplay/PlayerShip.hpp"
#include "utils/Logging.hpp"

namespace SH {

class Buff {
public:
    Buff(std::string type, float duration, float value)
        : type_(type), duration_(duration), remaining_(duration), value_(value) {}

    void update(float dt) {
        remaining_ -= dt;
    }

    void apply(PlayerShip& ship) {
        if (type_ == "speed_boost") {
            ship.setSpeed(ship.getSpeed() * (1.0f + value_));
        } else if (type_ == "shield_regen") {
            // Handled in update
        } else if (type_ == "invulnerability") {
            // Handled via damage check
        }
    }

    bool isActive() const { return remaining_ > 0; }
    bool isExpired() const { return remaining_ <= 0; }

    std::string type_;
    float duration_;
    float remaining_;
    float value_;
};

class BuffSystem {
public:
    BuffSystem() = default;

    void addBuff(std::string type, float duration, float value = 1.0f) {
        buffs_.push_back(std::make_unique<Buff>(type, duration, value));
        LOG_INFO("BuffSystem", "Buff added: " + type + " duration=" + std::to_string(duration) +
                 " value=" + std::to_string(value));
    }

    void update(float dt, PlayerShip& ship) {
        // Remove expired buffs
        buffs_.erase(
            std::remove_if(buffs_.begin(), buffs_.end(),
                [](const std::unique_ptr<Buff>& b) { return b->isExpired(); }),
            buffs_.end());

        // Apply active buffs
        for (auto& buff : buffs_) {
            buff->update(dt);
            buff->apply(ship);
        }
    }

    bool hasBuff(const std::string& type) const {
        for (auto& buff : buffs_) {
            if (buff->type_ == type && buff->isActive()) return true;
        }
        return false;
    }

    void clear() { buffs_.clear(); }
    size_t activeBuffs() const { return buffs_.size(); }

private:
    std::vector<std::unique_ptr<Buff>> buffs_;
};

} // namespace SH
