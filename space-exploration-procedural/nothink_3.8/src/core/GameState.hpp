#pragma once
#include "Constants.hpp"
#include <string>

class GameState {
public:
    static GameState& instance();
    void reset(float teleportDistance = 0.0f);
    void loadConfig();
    void saveConfig();

    int score = 0;
    float distance = 0.0f;
    int health = VD::MAX_HEALTH;
    int maxHealth = VD::MAX_HEALTH;
    float shieldCooldown = 0.0f;
    float throttle = 0.0f;
    int rungIndex = 0;
    std::string lightProfile = "auto";
    bool muted = false;
    bool paused = false;
    bool dead = false;
    std::string deathReason = "";
    int highScore = 0;
    int adaptiveLevel = 0;
    float wormholeIntensity = 0.0f;
    bool finaleAnnounced = false;
};
