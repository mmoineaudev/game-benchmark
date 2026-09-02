#pragma once
#include <string>
#include <glm/glm.hpp>

namespace SH {

// Runtime constants — non-configuration (camera, rendering, game feel)
namespace Constants {

    // Window
    constexpr int WINDOW_WIDTH = 1280;
    constexpr int WINDOW_HEIGHT = 720;
    constexpr const char* WINDOW_TITLE = "Space Hauler";

    // FPS cap
    constexpr int TARGET_FPS = 60;
    constexpr float TARGET_DT = 1.0f / TARGET_FPS;

    // Camera (flight view)
    constexpr float CAMERA_FOV = 60.0f;
    constexpr float CAMERA_NEAR = 0.1f;
    constexpr float CAMERA_FAR = 1000.0f;

    // Ship movement
    constexpr float PITCH_SPEED = 1.5f;       // rad/s
    constexpr float YAW_SPEED = 2.0f;         // rad/s (mouse)
    constexpr float ROLL_SPEED = 3.0f;        // rad/s
    constexpr float THRUST_RATE = 0.1f;       // % per second
    constexpr float MOUSE_SENSITIVITY = 0.0025f; // rad/px

    // Ship bounds (collision)
    constexpr float SHIP_RADIUS = 1.5f;
    constexpr float MAX_SPEED = 50.0f;
    constexpr float MIN_SPEED = 5.0f;

    // Entity budget (performance)
    constexpr int ENTITY_BUDGET = 200;

    // Light budget
    constexpr int MAX_DYNAMIC_LIGHTS = 16;

    // Post-processing
    constexpr int BLOOM_ITERATIONS = 3;
    constexpr float BLOOM_THRESHOLD = 0.3f;
    constexpr int MOTION_BLUR_PASSES = 2;  // 1=off, 2=low, 3=high

    // Flight
    constexpr float FLIGHT_CORRIDOR_HALF = 2.0f; // 2x screen width
    constexpr float ENCOUNTER_MIN_INTERVAL = 120.0f; // 2 minutes min between encounters
    constexpr float ENCOUNTER_DUR_MIN = 5.0f;
    constexpr float ENCOUNTER_DUR_MAX = 15.0f;
    constexpr float ENCOUNTER_DISTANCE_THRESHOLD = 1250.0f;

    // Fuel
    constexpr int FUEL_MAX = 600;
    constexpr float FUEL_CONSUMPTION = 0.1f; // 1 per 10 distance units
    constexpr int FUEL_EMPTY = 0;

    // HUD
    constexpr int HUD_BAR_WIDTH = 200;
    constexpr int HUD_BAR_HEIGHT = 16;

    // Galaxy map
    constexpr float GALAXY_NODE_RADIUS = 40.0f;

    // Audio
    constexpr int AUDIO_BUFFER_SIZE = 1024;
    constexpr float AUDIO_MASTER_VOLUME = 0.8f;

    // Save
    constexpr const char* SAVE_PATH = "data/save.json";
    constexpr const char* LOGS_DIR = "logs";
    constexpr const char* DATA_DIR = "data";
    constexpr const char* SHADERS_DIR = "shaders";
    constexpr const char* ASSETS_DIR = "assets";

    // Quality tiers
    enum class Quality { ECO, AUTO, HIGH };

    // Returns quality-dependent multipliers
    struct QualitySettings {
        int entityBudget;
        int maxLights;
        bool bloom;
        int motionBlurPasses;
        int bloomIterations;
        float bloomThreshold;
        int fogDensity;
        bool vignette;

        static QualitySettings get(Quality q) {
            switch (q) {
                case Quality::ECO:
                    return {150, 8, false, 1, 1, 0.5f, 0, false};
                case Quality::AUTO:
                    return {200, 16, true, 2, 3, 0.3f, 4, true};
                case Quality::HIGH:
                    return {300, 32, true, 3, 5, 0.2f, 2, true};
                default: return get(Quality::AUTO);
            }
        }
    };

    // Collision types (bitmask for AABB resolution)
    enum CollisionType : uint8_t {
        COLL_NONE = 0,
        COLL_SHIP = 1,
        COLL_ASTEROID = 2,
        COLL_PROJECTILE = 4,
        COLL_STATION = 8,
        COLL_BOULDER = 16,
        COLL_ENCOUNTER = 32
    };

} // namespace Constants
} // namespace SH
