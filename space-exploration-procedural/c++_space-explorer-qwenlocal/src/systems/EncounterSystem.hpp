#pragma once
#include <vector>
#include <string>
#include <memory>
#include <unordered_map>
#include "entities/Entity.hpp"
#include "entities/components/AI.hpp"
#include "gameplay/PlayerShip.hpp"
#include "core/GameState.hpp"
#include "utils/Math.hpp"
#include "core/Constants.hpp"
#include "utils/Logging.hpp"

namespace SH {

// Encounter system — spawns and manages encounters during flight
class EncounterSystem {
public:
    EncounterSystem();
    ~EncounterSystem() = default;

    void init();
    void loadEncounterDefinitions();
    void shutdown();

    // Generate encounters for a route
    void generateForRoute(const std::string& routeId, int dangerLevel);

    // Update encounter state
    void update(float dt, PlayerShip& ship, std::vector<std::unique_ptr<Entity>>& entities);

    // Get active encounter
    const std::string& getActiveEncounter() const { return activeEncounter_; }
    bool isActive() const { return activeEncounter_ != "none"; }

    // Resolve encounter (player choice)
    void resolveEncounter(const std::string& outcome);

    // Check if encounter should trigger based on distance
    void checkEncounterTrigger(float distanceTraveled, float maxDistance);

    // Get encounter duration
    float getEncounterDuration() const { return encounterDuration_; }
    void setEncounterDuration(float d) { encounterDuration_ = d; }

    // Get encounter difficulty
    int getEncounterDifficulty() const { return encounterDifficulty_; }
    void setEncounterDifficulty(int d) { encounterDifficulty_ = d; }

    // Check if player can dodge (asteroid field)
    bool canDodge() const { return canDodge_; }
    void setCanDodge(bool can) { canDodge_ = can; }

    // Check if player can fight (pirate ambush)
    bool canFight() const { return canFight_; }
    void setCanFight(bool can) { canFight_ = can; }

    // Check if player can brace (solar flare)
    bool canBrace() const { return canBrace_; }
    void setCanBrace(bool can) { canBrace_ = can; }

    // Get timer for encounter
    float getTimer() const { return encounterTimer_; }
    void setTimer(float t) { encounterTimer_ = t; }

private:
    std::string activeEncounter_;
    int encounterDifficulty_ = 0;
    float encounterDuration_ = 10.0f;
    float encounterTimer_ = 0.0f;
    bool canDodge_ = false;
    bool canFight_ = false;
    bool canBrace_ = false;

    // Encounter definitions from JSON
    struct EncounterDef {
        std::string id;
        std::string name;
        std::string type; // dodge, combat, choice, brace
        bool interactive;
        std::vector<std::string> entities; // What to spawn
        float durationMin;
        float durationMax;
        int damageMin;
        int damageMax;
    };

    std::vector<EncounterDef> encounterDefs_;
    std::vector<std::string> encounterQueue_;
    size_t currentEncounter_ = 0;

    void spawnEncounterEntities(const std::string& type, std::vector<std::unique_ptr<Entity>>& entities);
    void spawnAsteroids(int count, Vec3 spawnPos, float spread, std::vector<std::unique_ptr<Entity>>& entities);
    void spawnPirates(int count, Vec3 spawnPos, float spread, std::vector<std::unique_ptr<Entity>>& entities);
    void spawnStation(Vec3 spawnPos, std::vector<std::unique_ptr<Entity>>& entities);

    RNG rng_;
};

} // namespace SH
