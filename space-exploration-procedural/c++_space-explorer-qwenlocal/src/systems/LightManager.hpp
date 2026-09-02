#pragma once
#include <vector>
#include <memory>
#include "utils/Math.hpp"
#include "core/Constants.hpp"
#include "utils/Logging.hpp"

namespace SH {

class LightManager {
public:
    LightManager();
    ~LightManager() = default;

    void init();
    void shutdown();

    struct Light {
        Vec3 position;
        Vec3 color;
        float intensity;
        float decay; // Exponential decay factor
        bool dynamic;
        std::string id;

        // Get effective intensity at distance
        float getIntensityAt(float distance) const {
            return intensity / (1.0f + decay * distance + decay * decay * distance * distance);
        }
    };

    // Add light
    void addLight(const Light& light);
    void removeLight(const std::string& id);

    // Get lights within range (for frustum culling)
    std::vector<const Light*> getLightsInRange(const Vec3& cameraPos, float range, int maxCount);

    // Set light budget (priority-culled)
    void setBudget(int maxLights);
    int getBudget() const { return budget_; }

    // Get all lights
    const std::vector<Light>& getLights() const { return lights_; }

    // Update light intensities (for flickering)
    void update(float dt);

    // Clear all lights
    void clear();

    // Non-copyable
    LightManager(const LightManager&) = delete;
    LightManager& operator=(const LightManager&) = delete;

private:
    std::vector<Light> lights_;
    int budget_ = Constants::MAX_DYNAMIC_LIGHTS;
    bool dirty_ = true; // Mark if lights changed
};

} // namespace SH
