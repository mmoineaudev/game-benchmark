#include "level/GalaxyGenerator.hpp"
#include <algorithm>
#include <cmath>
#include "utils/Logging.hpp"

namespace SH {

GalaxyGenerator::GalaxyGenerator() : rng_(42) {}

void GalaxyGenerator::generate() {
    systems_.clear();
    routes_.clear();

    // Generate 8-15 systems
    int count = rng_.randInt(8, 15);
    generateNodePositions(count);
    assignSystemTypes();
    doConnectSystems();
    assignRouteDanger();

    if (!validateConnectivity()) {
        LOG_WARN("GalaxyGenerator", "Galaxy disconnected, regenerating...");
        generate(); // Recursive retry
        return;
    }

    LOG_INFO("GalaxyGenerator", "Galaxy generated: " + std::to_string(systems_.size()) +
             " systems, " + std::to_string(routes_.size()) + " routes");
}

void GalaxyGenerator::generateNodePositions(int count) {
    // Place home system at center
    GameState::SystemNode home;
    home.id = "home";
    home.name = "Home Port";
    home.type = "trade_hub";
    home.danger = 1;
    home.faction = "federation";
    home.services = {"refuel", "repair"};
    home.x = 0.0f;
    home.y = 0.0f;
    systems_.push_back(home);

    // Generate spiral positions for other systems
    for (int i = 1; i < count; i++) {
        GameState::SystemNode node;
        node.id = "system_" + std::to_string(i);
        node.name = generateSystemName(i);
        node.x = 0.0f;
        node.y = 0.0f;

        // Spiral pattern with random offset
        float angle = static_cast<float>(i) * 2.399f; // Golden angle
        float radius = 100.0f + static_cast<float>(i) * 30.0f;
        node.x = radius * std::cos(angle) + rng_.randFloat(-20.0f, 20.0f);
        node.y = radius * std::sin(angle) + rng_.randFloat(-20.0f, 20.0f);

        systems_.push_back(node);
    }
}

void GalaxyGenerator::assignSystemTypes() {
    std::vector<std::string> types = {"trade_hub", "mining_outpost", "pirate_den",
                                      "research_station", "refugee_colony", "black_market"};

    for (size_t i = 1; i < systems_.size(); i++) {
        systems_[i].type = types[rng_.randInt(0, static_cast<int>(types.size()) - 1)];

        if (systems_[i].type == "trade_hub") systems_[i].danger = 1;
        else if (systems_[i].type == "mining_outpost") systems_[i].danger = 2;
        else if (systems_[i].type == "pirate_den") systems_[i].danger = 4;
        else if (systems_[i].type == "research_station") systems_[i].danger = 2;
        else if (systems_[i].type == "refugee_colony") systems_[i].danger = 3;
        else if (systems_[i].type == "black_market") systems_[i].danger = 5;

        if (systems_[i].type == "trade_hub") systems_[i].faction = "federation";
        else if (systems_[i].type == "pirate_den") systems_[i].faction = "pirates";
        else if (systems_[i].type == "research_station") systems_[i].faction = "scientists";
        else if (systems_[i].type == "black_market") systems_[i].faction = "neutral";
        else systems_[i].faction = "merchants";

        systems_[i].services = {"refuel", "repair"};
    }
}

std::string GalaxyGenerator::generateSystemName(int index) {
    std::vector<std::string> syllables = {"Ke", "pa", "Vor", "ath", "Nex", "us", "Or",
                                          "ion", "Ly", "ra", "Zen", "ith", "A", "nax",
                                          "Pro", "xi", "Tau", "Vel"};

    std::string name;
    int numSyllables = rng_.randInt(2, 3);
    for (int i = 0; i < numSyllables; i++) {
        name += syllables[rng_.randInt(0, static_cast<int>(syllables.size()) - 1)];
    }
    return name;
}

void GalaxyGenerator::doConnectSystems() {
    std::vector<bool> connected(systems_.size(), false);
    connected[0] = true;

    for (size_t i = 1; i < systems_.size(); i++) {
        if (connected[i]) continue;

        float minDist = 1e9f;
        int nearest = 0;
        for (size_t j = 0; j < systems_.size(); j++) {
            if (connected[j]) {
                float dx = systems_[i].x - systems_[j].x;
                float dy = systems_[i].y - systems_[j].y;
                float dist = std::sqrt(dx * dx + dy * dy);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = static_cast<int>(j);
                }
            }
        }

        GameState::RouteEdge edge;
        edge.from = systems_[i].id;
        edge.to = systems_[nearest].id;
        edge.distance = static_cast<float>(minDist);
        edge.danger = std::max(systems_[i].danger, systems_[nearest].danger);
        routes_.push_back(edge);

        GameState::RouteEdge reverseEdge = edge;
        std::swap(reverseEdge.from, reverseEdge.to);
        routes_.push_back(reverseEdge);

        systems_[i].connections.push_back(systems_[nearest].id);
        systems_[nearest].connections.push_back(systems_[i].id);
        connected[i] = true;
    }

    // Extra random connections
    int extraConnections = rng_.randInt(2, 5);
    for (int i = 0; i < extraConnections; i++) {
        int a = rng_.randInt(1, static_cast<int>(systems_.size()) - 1);
        int b = rng_.randInt(1, static_cast<int>(systems_.size()) - 1);
        if (a != b) {
            bool alreadyConnected = false;
            for (const auto& conn : systems_[a].connections) {
                if (conn == systems_[b].id) {
                    alreadyConnected = true;
                    break;
                }
            }

            if (!alreadyConnected) {
                GameState::RouteEdge edge;
                edge.from = systems_[a].id;
                edge.to = systems_[b].id;
                float dx = systems_[a].x - systems_[b].x;
                float dy = systems_[a].y - systems_[b].y;
                edge.distance = std::sqrt(dx * dx + dy * dy);
                edge.danger = std::max(systems_[a].danger, systems_[b].danger);
                routes_.push_back(edge);

                GameState::RouteEdge reverseEdge = edge;
                std::swap(reverseEdge.from, reverseEdge.to);
                routes_.push_back(reverseEdge);

                systems_[a].connections.push_back(systems_[b].id);
                systems_[b].connections.push_back(systems_[a].id);
            }
        }
    }
}

void GalaxyGenerator::assignRouteDanger() {
    for (auto& route : routes_) {
        int fromDanger = 1, toDanger = 1;
        for (const auto& sys : systems_) {
            if (sys.id == route.from) fromDanger = sys.danger;
            if (sys.id == route.to) toDanger = sys.danger;
        }
        route.danger = std::max(fromDanger, toDanger);
    }
}

bool GalaxyGenerator::validateConnectivity() const {
    std::unordered_map<std::string, bool> visited;
    std::vector<std::string> queue;
    queue.push_back("home");

    while (!queue.empty()) {
        std::string current = queue.front();
        queue.erase(queue.begin());

        if (visited.count(current)) continue;
        visited[current] = true;

        const auto* sys = getSystemById(current);
        if (!sys) continue;

        for (const auto& conn : sys->connections) {
            if (!visited.count(conn)) {
                queue.push_back(conn);
            }
        }
    }

    for (const auto& sys : systems_) {
        if (!visited.count(sys.id)) {
            LOG_WARN("GalaxyGenerator", "System " + sys.id + " not reachable from home");
            return false;
        }
    }

    return true;
}

void GalaxyGenerator::addSystem(const GameState::SystemNode& node) {
    systems_.push_back(node);
}

void GalaxyGenerator::connectSystems() {
    doConnectSystems();
}

GameState::SystemNode* GalaxyGenerator::getSystemById(const std::string& id) {
    for (auto& sys : systems_) {
        if (sys.id == id) return &sys;
    }
    return nullptr;
}

const GameState::SystemNode* GalaxyGenerator::getSystemById(const std::string& id) const {
    for (const auto& sys : systems_) {
        if (sys.id == id) return &sys;
    }
    return nullptr;
}

} // namespace SH
