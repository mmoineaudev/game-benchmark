#pragma once
#include <vector>
#include <string>
#include <random>
#include <unordered_map>
#include "utils/Math.hpp"
#include "core/GameState.hpp"
#include "utils/Logging.hpp"

namespace SH {

// Procedural galaxy generator — spiral pattern + nearest-neighbor connections
class GalaxyGenerator {
public:
    GalaxyGenerator();
    ~GalaxyGenerator() = default;

    // Generate galaxy from scratch
    void generate();

    // Get generated data
    const std::vector<GameState::SystemNode>& getSystems() const { return systems_; }
    const std::vector<GameState::RouteEdge>& getRoutes() const { return routes_; }

    // Add system
    void addSystem(const GameState::SystemNode& node);

    // Connect systems
    void connectSystems();

    // Validate: all systems reachable from home
    bool validateConnectivity() const;

    // Get system by ID
    GameState::SystemNode* getSystemById(const std::string& id);
    const GameState::SystemNode* getSystemById(const std::string& id) const;

    // Generate system name from syllables
    std::string generateSystemName(int index);

private:
    std::vector<GameState::SystemNode> systems_;
    std::vector<GameState::RouteEdge> routes_;
    RNG rng_;

    // Spiral pattern with random offset
    void generateNodePositions(int count);

    // Assign system type and danger
    void assignSystemTypes();

    // Internal connect method (nearest-neighbor + extras)
    void doConnectSystems();

    // Assign route dangers
    void assignRouteDanger();
};

} // namespace SH
