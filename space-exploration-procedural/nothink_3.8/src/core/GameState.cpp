#include "GameState.hpp"
#include "nlohmann/json.hpp"
#include <filesystem>
#include <fstream>
#include <cstdlib>

namespace fs = std::filesystem;
using json = nlohmann::json;

GameState& GameState::instance() { static GameState s; return s; }

void GameState::reset(float teleportDistance) {
    score = 0;
    distance = teleportDistance;
    health = maxHealth;
    shieldCooldown = 0.0f;
    throttle = 0.0f;
    rungIndex = 0;
    paused = false;
    dead = false;
    deathReason.clear();
    adaptiveLevel = 0;
    wormholeIntensity = 0.0f;
    finaleAnnounced = false;
}

static fs::path configPath() {
    const char* home = std::getenv("HOME");
    fs::path p = home ? fs::path(home) : fs::path(".");
    p /= ".void_drift/config.json";
    return p;
}

void GameState::loadConfig() {
    auto p = configPath();
    std::ifstream f(p);
    if (!f) { saveConfig(); return; }
    json j;
    try { f >> j; } catch (...) { saveConfig(); return; }
    if (j.contains("highscore")) highScore = j["highscore"].get<int>();
    if (j.contains("muted")) muted = j["muted"].get<bool>();
    if (j.contains("lightProfile")) lightProfile = j["lightProfile"].get<std::string>();
}

void GameState::saveConfig() {
    json j;
    j["highscore"] = highScore;
    j["muted"] = muted;
    j["lightProfile"] = lightProfile;
    auto p = configPath();
    fs::create_directories(p.parent_path());
    {
        std::ofstream tmp(p.string() + ".tmp");
        tmp << j.dump(2);
    }
    std::error_code ec;
    fs::rename(p.string() + ".tmp", p, ec);
    if (ec) { // fallback: direct write
        std::ofstream f(p);
        f << j.dump(2);
    }
}
