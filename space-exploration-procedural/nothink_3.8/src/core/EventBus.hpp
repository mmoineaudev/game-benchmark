#pragma once
#include <string>
#include <vector>
#include <functional>
#include <unordered_map>

namespace Events {
    constexpr const char* SCORE_CHANGED = "SCORE_CHANGED";
    constexpr const char* BIOME_CHANGED = "BIOME_CHANGED";
    constexpr const char* PLAYER_HEALTH_CHANGED = "PLAYER_HEALTH_CHANGED";
    constexpr const char* PLAYER_HEALTH_REGEN = "PLAYER_HEALTH_REGEN";
    constexpr const char* PLAYER_DIED = "PLAYER_DIED";
    constexpr const char* PLAYER_KILLED_ENTITY = "PLAYER_KILLED_ENTITY";
    constexpr const char* LADDER_RUNG_CHANGED = "LADDER_RUNG_CHANGED";
    constexpr const char* LADDER_FINALE_REACHED = "LADDER_FINALE_REACHED";
    constexpr const char* ENV_CRYSTAL_DESTROYED = "ENVIRONMENT_CRYSTAL_DESTROYED";
    constexpr const char* ENV_PULSAR_SPAWNED = "ENVIRONMENT_PULSAR_SPAWNED";
    constexpr const char* ENV_STORM_STRIKE = "ENVIRONMENT_STORM_STRIKE";
    constexpr const char* ENV_HULK_DESTROYED = "ENVIRONMENT_HULK_DESTROYED";
    constexpr const char* ENV_CITY_FRAGMENT_SPAWNED = "ENVIRONMENT_CITY_FRAGMENT_SPAWNED";
    constexpr const char* ENV_WRECK_DESTROYED = "ENVIRONMENT_WRECK_DESTROYED";
    constexpr const char* ENV_BLACK_HOLE_COLLAPSE = "ENVIRONMENT_BLACK_HOLE_COLLAPSE";
    constexpr const char* STORM_STATIC_CHANGED = "STORM_STATIC_CHANGED";
    constexpr const char* AUDIO_MUTED = "AUDIO_MUTED";
    constexpr const char* INPUT_SHIELD = "INPUT_SHIELD";
    constexpr const char* INPUT_THROTTLE_SET = "INPUT_THROTTLE_SET";
    constexpr const char* GAME_PAUSED = "GAME_PAUSED";
}

class EventBus {
public:
    using Handler = std::function<void()>;
    static EventBus& instance();
    unsigned long on(const char* event, Handler h);
    void emit(const char* event);
    void off(const char* event, unsigned long token);
private:
    struct Slot { unsigned long id; Handler h; };
    std::unordered_map<std::string, std::vector<Slot>> m;
    unsigned long nextId = 1;
};
