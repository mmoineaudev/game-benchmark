#include "systems/LightManager.hpp"
#include "utils/Math.hpp"
#include "utils/Logging.hpp"
#include <algorithm>

namespace SH {

LightManager::LightManager() : budget_(Constants::MAX_DYNAMIC_LIGHTS), dirty_(true) {}

void LightManager::init() {
    LOG_INFO("LightManager", "Light manager initialized: budget=" + std::to_string(budget_));
}

void LightManager::shutdown() {
    clear();
    LOG_INFO("LightManager", "Light manager shut down");
}

void LightManager::addLight(const Light& light) {
    lights_.push_back(light);
    dirty_ = true;
}

void LightManager::removeLight(const std::string& id) {
    lights_.erase(
        std::remove_if(lights_.begin(), lights_.end(),
            [&id](const Light& l) { return l.id == id; }),
        lights_.end());
    dirty_ = true;
}

std::vector<const LightManager::Light*> LightManager::getLightsInRange(const Vec3& cameraPos, float range, int maxCount) {
    std::vector<const LightManager::Light*> result;
    for (const auto& light : lights_) {
        float dist = (light.position - cameraPos).len();
        if (dist < range && static_cast<int>(result.size()) < maxCount) {
            result.push_back(&light);
        }
    }
    return result;
}

void LightManager::setBudget(int maxLights) {
    budget_ = std::min(maxLights, Constants::MAX_DYNAMIC_LIGHTS);
}

void LightManager::update(float dt) {
    for (auto& light : lights_) {
        if (light.dynamic) {
            light.intensity = 0.9f + 0.1f * std::sin(dt * 10.0f);
        }
    }
}

void LightManager::clear() {
    lights_.clear();
    dirty_ = true;
}

} // namespace SH
