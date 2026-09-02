#include "systems/EncounterSystem.hpp"
#include <algorithm>
#include "utils/Logging.hpp"

namespace SH {

EncounterSystem::EncounterSystem() : rng_(42), activeEncounter_("none") {
    loadEncounterDefinitions();
}

void EncounterSystem::loadEncounterDefinitions() {
    encounterDefs_ = {
        {"asteroid_field", "Asteroid Field", "dodge", true, {"asteroid"}, 5.0f, 15.0f, 5, 15},
        {"pirate_ambush", "Pirate Ambush", "combat", true, {"pirate_ship"}, 10.0f, 20.0f, 10, 25},
        {"distress_signal", "Distress Signal", "choice", true, {"distress_ship"}, 3.0f, 8.0f, 0, 0},
        {"solar_flare", "Solar Flare", "brace", true, {}, 3.0f, 5.0f, 10, 30},
        {"mining_claim", "Mining Claim", "choice", true, {"asteroid_belt"}, 5.0f, 10.0f, 0, 0},
        {"jump_gate", "Jump Gate", "choice", true, {"gate"}, 3.0f, 8.0f, 5, 20},
        {"empty_transit", "Empty Transit", "none", false, {}, 0.0f, 0.0f, 0, 0}
    };
}

void EncounterSystem::init() {
    LOG_INFO("EncounterSystem", "Encounter system initialized");
}

void EncounterSystem::shutdown() {
    LOG_INFO("EncounterSystem", "Encounter system shut down");
}

void EncounterSystem::generateForRoute(const std::string& routeId, int dangerLevel) {
    encounterQueue_.clear();
    currentEncounter_ = 0;
    
    static const std::vector<int> fib = {0, 1, 1, 2, 3, 5};
    int count = (dangerLevel >= 1 && dangerLevel <= 5) ? fib[dangerLevel] : 1;
    
    LOG_INFO("EncounterSystem", "Generating " + std::to_string(count) +
             " encounters for route (danger=" + std::to_string(dangerLevel) + ")");
    
    std::vector<std::string> types = {"asteroid_field", "pirate_ambush", "distress_signal",
                                       "solar_flare", "mining_claim", "jump_gate", "empty_transit"};
    std::vector<int> weights = {30, 25, 15, 10, 10, 5, 10};
    
    for (int i = 0; i < count; i++) {
        int totalWeight = 0;
        for (int w : weights) totalWeight += w;
        
        int random = rng_.randInt(0, totalWeight - 1);
        int cumulative = 0;
        for (size_t j = 0; j < types.size(); j++) {
            cumulative += weights[j];
            if (random < cumulative) {
                encounterQueue_.push_back(types[j]);
                break;
            }
        }
    }
}

void EncounterSystem::update(float dt, PlayerShip& ship,
                             std::vector<std::unique_ptr<Entity>>& entities) {
    if (!isActive()) return;
    
    encounterTimer_ += dt;
    
    if (encounterTimer_ >= encounterDuration_) {
        LOG_INFO("EncounterSystem", "Encounter timed out");
        resolveEncounter("timeout");
        return;
    }
    
    if (canBrace_ && rng_.randFloat() < 0.5f) {
        LOG_INFO("EncounterSystem", "Player braced");
        resolveEncounter("braced");
    }
}

void EncounterSystem::resolveEncounter(const std::string& outcome) {
    LOG_INFO("EncounterSystem", "Encounter resolved: " + activeEncounter_ + " -> " + outcome);
    
    if (outcome == "braced" || outcome == "dodged") {
        LOG_INFO("EncounterSystem", "Success - no damage");
    } else if (outcome == "timeout" || outcome == "hit") {
        int damage = rng_.randInt(5, 15);
        LOG_WARN("EncounterSystem", "Failed - taking " + std::to_string(damage) + " damage");
    } else if (outcome == "fought") {
        LOG_INFO("EncounterSystem", "Pirates defeated");
    }
    
    activeEncounter_ = "none";
    canDodge_ = false;
    canFight_ = false;
    canBrace_ = false;
    encounterTimer_ = 0.0f;
    
    currentEncounter_++;
}

void EncounterSystem::checkEncounterTrigger(float distanceTraveled, float maxDistance) {
    if (isActive() || currentEncounter_ >= encounterQueue_.size()) return;
    
    float triggerDistance = maxDistance * 0.5f;
    if (distanceTraveled >= triggerDistance) {
        activeEncounter_ = encounterQueue_[currentEncounter_];
        encounterDuration_ = rng_.randFloat(5.0f, 15.0f);
        encounterDifficulty_ = rng_.randInt(1, 5);
        encounterTimer_ = 0.0f;
        
        if (activeEncounter_ == "asteroid_field") canDodge_ = true;
        else if (activeEncounter_ == "pirate_ambush") canFight_ = true;
        else if (activeEncounter_ == "solar_flare") canBrace_ = true;
    }
}

void EncounterSystem::spawnEncounterEntities(const std::string& type,
                                              std::vector<std::unique_ptr<Entity>>& entities) {
    Vec3 spawnPos(0.0f, 0.0f, -50.0f);
    float spread = 30.0f;
    
    if (type == "asteroid_field") {
        spawnAsteroids(5, spawnPos, spread, entities);
    } else if (type == "pirate_ambush") {
        spawnPirates(2, spawnPos, spread, entities);
    }
}

void EncounterSystem::spawnAsteroids(int count, Vec3 spawnPos, float spread,
                                      std::vector<std::unique_ptr<Entity>>& entities) {
    for (int i = 0; i < count; i++) {
        auto asteroid = std::make_unique<Entity>("asteroid", entities.size());
        asteroid->position = Vec3{
            spawnPos.x + rng_.randFloat(-spread, spread),
            spawnPos.y + rng_.randFloat(-spread, spread),
            spawnPos.z + rng_.randFloat(-10.0f, 10.0f)
        };
        asteroid->radius = rng_.randFloat(1.0f, 3.0f);
        asteroid->addComponent<PhysicsComponent>(rng_.randFloat(10.0f, 50.0f), asteroid->radius);
        asteroid->addComponent<DamageComponent>(0, 0);
        entities.push_back(std::move(asteroid));
    }
}

void EncounterSystem::spawnPirates(int count, Vec3 spawnPos, float spread,
                                    std::vector<std::unique_ptr<Entity>>& entities) {
    for (int i = 0; i < count; i++) {
        auto pirate = std::make_unique<Entity>("pirate_ship", entities.size());
        pirate->position = Vec3{
            spawnPos.x + rng_.randFloat(-spread, spread),
            spawnPos.y + rng_.randFloat(-spread, spread),
            spawnPos.z + rng_.randFloat(-10.0f, 10.0f)
        };
        pirate->radius = 2.0f;
        pirate->addComponent<PhysicsComponent>(20.0f, 2.0f);
        pirate->addComponent<DamageComponent>(50, 50);
        pirate->addComponent<AIComponent>(AIComponent::Behavior::CHASE, 15.0f);
        entities.push_back(std::move(pirate));
    }
}

} // namespace SH
