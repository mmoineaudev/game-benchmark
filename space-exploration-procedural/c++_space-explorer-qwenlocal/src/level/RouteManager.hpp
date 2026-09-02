#pragma once
#include <vector>
#include <string>
#include <deque>
#include <unordered_map>
#include "utils/Math.hpp"
#include "utils/Logging.hpp"
#include "core/GameState.hpp"

namespace SH {

// Route manager — pathfinding (Dijkstra) + fuel cost calculation
class RouteManager {
public:
    RouteManager() = default;

    // Set up with current systems/routes
    void setRouteData(const std::vector<GameState::SystemNode>& systems,
                      const std::vector<GameState::RouteEdge>& routes);

    // Find shortest path (Dijkstra) from 'from' to 'to'
    bool findPath(const std::string& from, const std::string& to,
                  std::deque<std::string>& path);

    // Get total route distance
    float getRouteDistance(const std::deque<std::string>& path) const;

    // Get fuel cost for route
    int getFuelCost(const std::deque<std::string>& path) const;

    // Get danger along route (max danger of all edges)
    int getMaxDanger(const std::deque<std::string>& path) const;

    // Get encounters for danger level
    int getEncounterCount(int danger) const;

    // Get all adjacent systems to a given system
    std::vector<std::string> getAdjacentSystems(const std::string& systemId) const;

    // Validate path (all consecutive edges exist)
    bool validatePath(const std::deque<std::string>& path) const;

    // Get auto-route home
    bool getAutoRouteHome(const std::string& current, std::deque<std::string>& path);

private:
    // Adjacency list: systemId -> list of {neighbor, distance}
    std::unordered_map<std::string, std::vector<std::pair<std::string, float>>> adjacency_;

    // Edge cache: "from->to" -> distance
    std::unordered_map<std::string, float> edgeDistances_;

    // Edge danger cache
    std::unordered_map<std::string, int> edgeDangers_;

    void buildAdjacencyList(const std::vector<GameState::SystemNode>& systems,
                            const std::vector<GameState::RouteEdge>& routes);

    // Fibonacci sequence for encounter counts
    static int fibonacciEncounters(int danger);
};

} // namespace SH
