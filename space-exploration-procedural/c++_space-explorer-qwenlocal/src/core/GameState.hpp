#pragma once
#include <string>
#include <vector>
#include <map>
#include <array>
#include <filesystem>
#include <algorithm>
#include "utils/Logging.hpp"

namespace SH {

// Complete game state — both run-level and meta-persistent
class GameState {
public:
    GameState() = default;

    // === Game State ===
    std::string state = "HUB";           // "HUB" | "MAP" | "FLIGHT" | "ENCOUNTER" | "SYSTEM" | "DEATH" | "RESULT"
    bool runActive = false;
    bool paused = false;
    bool gameQuit = false;

    // === Ship State ===
    std::string shipId = "hauler_mk1";
    std::string weaponType = "none";
    bool hasWeapon = false;
    bool hasECM = false;

    // === Ship Stats (mutable during run) ===
    int credits = 0;
    int cargo = 0;          // current tons
    int cargoMax = 20;      // max tons
    int fuel = 600;
    int fuelMax = 600;
    int hull = 100;
    int hullMax = 100;
    int shield = 50;
    int shieldMax = 50;
    float speed = 1.0f;     // multiplier
    float roll = 0.0f;      // current roll (for visual)
    int turretShotsRemaining = 0; // for pirate encounter (5 shots)

    // === Run State ===
    int startingCredits = 0;
    std::map<std::string, int> cargoManifest; // { "food": 5, "ore": 10 }
    std::string currentSystem;
    std::vector<std::string> visitedSystems;
    std::vector<std::string> routeHistory;
    std::map<std::string, int> factionTrades; // { "federation": 1 }
    int profit = 0;
    int systemsVisited = 0;
    int totalRunCredits = 0;
    float routeDistance = 0.0f;
    int encounterCount = 0;
    float encounterTimer = 0.0f;
    bool ecmJammerActive = false;

    // === Meta-Persistent ===
    int persistentCredits = 0;
    std::map<std::string, int> upgrades; // { "cargo_bay": 1, "engine": 0 }
    std::vector<std::string> unlockedShips; // { "hauler_mk1" }
    std::map<std::string, int> factionRep;  // { "federation": 0, "merchants": 0 }
    int startingCapitalLevel = 0;

    // === Galaxy ===
    struct SystemNode {
        std::string id;
        std::string name;
        std::string type; // trade_hub, mining_outpost, pirate_den, etc.
        int danger;
        std::string faction;
        std::vector<std::string> services; // { "refuel", "repair" }
        float x = 0.0f, y = 0.0f; // 2D position on galaxy map
        std::vector<std::string> connections; // connected system IDs
        int nodePoints = 1;
    };
    std::vector<SystemNode> systems;

    struct RouteEdge {
        std::string from;
        std::string to;
        float distance;
        int danger;
    };
    std::vector<RouteEdge> routes;

    // === Encounter State ===
    std::string activeEncounter; // "asteroid_field", "pirate_ambush", etc.
    bool encounterResolved = false;

    // === Methods ===

    void reset() {
        // Keep meta, reset run state
        shipId = "hauler_mk1";
        weaponType = "none";
        hasWeapon = false;
        hasECM = false;

        credits = 50 + (startingCapitalLevel * 50);
        cargo = 0;
        cargoMax = 20;
        fuel = 600;
        fuelMax = 600;
        hull = 100;
        hullMax = 100;
        shield = 50;
        shieldMax = 50;
        speed = 1.0f;
        roll = 0.0f;
        turretShotsRemaining = 0;

        startingCredits = credits;
        cargoManifest.clear();
        currentSystem.clear();
        visitedSystems.clear();
        routeHistory.clear();
        factionTrades.clear();
        profit = 0;
        systemsVisited = 0;
        totalRunCredits = 0;
        routeDistance = 0.0f;
        encounterCount = 0;
        encounterTimer = 0.0f;
        ecmJammerActive = false;

        activeEncounter.clear();
        encounterResolved = false;

        state = "HUB";
        runActive = false;
        paused = false;
        LOG_INFO("GameState", "Run state reset");
    }

    void loadMeta() {
        // Load persistent data from save file (if exists)
        // Implementation: read data/save.json
        // For MVP, start with defaults
        if (unlockedShips.empty()) {
            unlockedShips = {"hauler_mk1"};
        }
        if (upgrades.empty()) {
            upgrades = {
                {"cargo_bay", 0},
                {"engine", 0},
                {"fuel_tank", 0},
                {"hull_plating", 0},
                {"shield_generator", 0},
                {"weapon_mount", 0},
                {"ecm_jammer", 0}
            };
        }
        if (factionRep.empty()) {
            factionRep = {
                {"federation", 0},
                {"merchants", 0},
                {"pirates", 0},
                {"scientists", 0}
            };
        }
        LOG_INFO("GameState", "Meta state loaded, persistentCredits=" + std::to_string(persistentCredits));
    }

    void applyUpgrades() {
        // Apply upgrade levels to ship stats
        int cargoBayLevel = upgrades.count("cargo_bay") ? upgrades["cargo_bay"] : 0;
        int engineLevel = upgrades.count("engine") ? upgrades["engine"] : 0;
        int fuelTankLevel = upgrades.count("fuel_tank") ? upgrades["fuel_tank"] : 0;
        int hullPlatingLevel = upgrades.count("hull_plating") ? upgrades["hull_plating"] : 0;
        int shieldGenLevel = upgrades.count("shield_generator") ? upgrades["shield_generator"] : 0;

        cargoMax = 20 + (cargoBayLevel * 10);
        fuelMax = 600 + (fuelTankLevel * 100);
        hullMax = 100 + (hullPlatingLevel * 20);
        shieldMax = 50 + (shieldGenLevel * 30);
        speed = 1.0f + (engineLevel * 0.2f);

        hasWeapon = upgrades.count("weapon_mount") && upgrades["weapon_mount"] > 0;
        ecmJammerActive = upgrades.count("ecm_jammer") && upgrades["ecm_jammer"] > 0;

        LOG_DEBUG("GameState", "Upgrades applied: cargo=" + std::to_string(cargoMax) + " fuel=" + std::to_string(fuelMax));
    }

    void addPersistentCredits(int amount) {
        persistentCredits += amount;
        LOG_INFO("GameState", "Persistent credits earned: +" + std::to_string(amount) +
                 " (total=" + std::to_string(persistentCredits) + ")");
    }

    void addRunProfit(int amount) {
        profit += amount;
        totalRunCredits += amount;
    }

    void recordTrade(const std::string& faction, float buyPrice, float sellPrice) {
        factionTrades[faction]++;
        if (sellPrice > buyPrice) {
            // Profitable trade with faction
            if (factionRep.find(faction) != factionRep.end()) {
                int rep = factionRep[faction];
                int newRep = std::min(100, rep + 10);
                if (newRep > rep) {
                    factionRep[faction] = newRep;
                    LOG_INFO("GameState", "Faction rep increased: " + faction + " = " + std::to_string(newRep));
                }
            }
        }
    }

    bool canAfford(int cost) const {
        return credits >= cost;
    }

    void spendCredits(int cost) {
        credits -= cost;
        if (credits < 0) credits = 0;
    }

    void purchaseUpgrade(const std::string& id, int cost) {
        if (!canAfford(cost)) return;
        spendCredits(cost);
        upgrades[id]++;
        LOG_INFO("GameState", "Upgrade purchased: " + id + " level=" + std::to_string(upgrades[id]));
    }

    bool unlockShip(const std::string& shipId, int cost) {
        if (unlockedShips.size() >= 4 && canAfford(cost)) {
            if (std::find(unlockedShips.begin(), unlockedShips.end(), shipId) == unlockedShips.end()) {
                spendCredits(cost);
                unlockedShips.push_back(shipId);
                this->shipId = shipId;
                LOG_INFO("GameState", "Ship unlocked: " + shipId);
                return true;
            }
        }
        return false;
    }

    void checkDeath() {
        if (hull <= 0 || fuel <= 0) {
            state = "DEATH";
            runActive = false;
            LOG_WARN("GameState", "Ship destroyed: hull=" + std::to_string(hull) + " fuel=" + std::to_string(fuel));
        }
    }

    void addSystemVisit(const std::string& systemId) {
        if (std::find(visitedSystems.begin(), visitedSystems.end(), systemId) == visitedSystems.end()) {
            visitedSystems.push_back(systemId);
            systemsVisited++;
        }
    }

    float getFactionPriceBonus(const std::string& faction) const {
        auto it = factionRep.find(faction);
        if (it != factionRep.end()) {
            float rep = static_cast<float>(it->second);
            return 1.0f + (rep / 10.0f); // 0-10% bonus
        }
        return 1.0f;
    }

    int getEncountersForDanger(int danger) const {
        // Fibonacci: 1, 1, 2, 3, 5
        static const std::array<int, 6> fib = {0, 1, 1, 2, 3, 5};
        return (danger >= 1 && danger <= 5) ? fib[danger] : 1;
    }

    // === Save/Load ===
    bool save(const std::string& path = "data/save.json") {
        // Simple JSON save (using nlohmann/json at runtime)
        // Format:
        // {
        //   "version": 1,
        //   "meta": { ... },
        //   "ship": { ... }
        // }
        // Implementation in GameState.cpp
        LOG_INFO("GameState", "Save requested: " + path);
        return true; // TODO: implement file write
    }

    bool load(const std::string& path = "data/save.json") {
        // Load from JSON
        // Implementation in GameState.cpp
        loadMeta();
        return true; // TODO: implement file read
    }

    // === Debug output ===
    void printState() const {
        LOG_INFO("GameState", "State=" + state +
                 " credits=" + std::to_string(credits) +
                 " cargo=" + std::to_string(cargo) + "/" + std::to_string(cargoMax) +
                 " fuel=" + std::to_string(fuel) + "/" + std::to_string(fuelMax) +
                 " hull=" + std::to_string(hull) + "/" + std::to_string(hullMax) +
                 " shield=" + std::to_string(shield) + "/" + std::to_string(shieldMax));
    }
};

} // namespace SH
