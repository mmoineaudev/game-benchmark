#include "level/RouteManager.hpp"
#include "core/GameState.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <queue>
#include <unordered_map>
#include "utils/Logging.hpp"

namespace SH {

void RouteManager::setRouteData(const std::vector<GameState::SystemNode>& systems,
                                const std::vector<GameState::RouteEdge>& routes) {
    adjacency_.clear();
    edgeDistances_.clear();
    edgeDangers_.clear();
    buildAdjacencyList(systems, routes);
    LOG_INFO("RouteManager", "Route data loaded: " + std::to_string(adjacency_.size()) +
             " systems, " + std::to_string(edgeDistances_.size()) + " edges");
}

void RouteManager::buildAdjacencyList(const std::vector<GameState::SystemNode>& systems,
                                      const std::vector<GameState::RouteEdge>& routes) {
    // Initialize adjacency for all systems
    for (const auto& sys : systems) {
        adjacency_[sys.id] = {};
    }

    // Build edges
    for (const auto& edge : routes) {
        edgeDistances_[edge.from + "->" + edge.to] = edge.distance;
        edgeDistances_[edge.to + "->" + edge.from] = edge.distance;
        edgeDangers_[edge.from + "->" + edge.to] = edge.danger;
        edgeDangers_[edge.to + "->" + edge.from] = edge.danger;

        adjacency_[edge.from].emplace_back(edge.to, edge.distance);
        adjacency_[edge.to].emplace_back(edge.from, edge.distance);
    }
}

bool RouteManager::findPath(const std::string& from, const std::string& to,
                            std::deque<std::string>& path) {
    if (from == to) {
        path.push_back(from);
        return true;
    }

    // Dijkstra's algorithm
    std::unordered_map<std::string, float> dist;
    std::unordered_map<std::string, std::string> prev;
    std::priority_queue<std::pair<float, std::string>,
                        std::vector<std::pair<float, std::string>>,
                        std::greater<>> pq;

    for (const auto& [sys, _] : adjacency_) {
        dist[sys] = std::numeric_limits<float>::max();
    }
    dist[from] = 0.0f;
    pq.emplace(0.0f, from);

    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();

        if (d > dist[u]) continue;
        if (u == to) break;

        for (const auto& [v, w] : adjacency_[u]) {
            float newDist = dist[u] + w;
            if (newDist < dist[v]) {
                dist[v] = newDist;
                prev[v] = u;
                pq.emplace(newDist, v);
            }
        }
    }

    // Reconstruct path
    if (dist[to] == std::numeric_limits<float>::max()) {
        LOG_WARN("RouteManager", "No path from " + from + " to " + to);
        return false;
    }

    path.clear();
    std::string current = to;
    while (current != from) {
        path.push_front(current);
        current = prev[current];
    }
    path.push_front(from);

    LOG_INFO("RouteManager", "Path found: " + from + " -> " + to +
             " (" + std::to_string(path.size()) + " stops)");
    return true;
}

float RouteManager::getRouteDistance(const std::deque<std::string>& path) const {
    float total = 0.0f;
    for (size_t i = 0; i + 1 < path.size(); i++) {
        std::string edge = path[i] + "->" + path[i + 1];
        auto it = edgeDistances_.find(edge);
        if (it != edgeDistances_.end()) {
            total += it->second;
        }
    }
    return total;
}

int RouteManager::getFuelCost(const std::deque<std::string>& path) const {
    float distance = getRouteDistance(path);
    return static_cast<int>(distance / 10.0f);
}

int RouteManager::getMaxDanger(const std::deque<std::string>& path) const {
    int maxDanger = 0;
    for (size_t i = 0; i + 1 < path.size(); i++) {
        std::string edge = path[i] + "->" + path[i + 1];
        auto it = edgeDangers_.find(edge);
        if (it != edgeDangers_.end() && it->second > maxDanger) {
            maxDanger = it->second;
        }
    }
    return maxDanger;
}

int RouteManager::getEncounterCount(int danger) const {
    return fibonacciEncounters(danger);
}

std::vector<std::string> RouteManager::getAdjacentSystems(const std::string& systemId) const {
    std::vector<std::string> adjacent;
    auto it = adjacency_.find(systemId);
    if (it != adjacency_.end()) {
        for (const auto& [neighbor, _] : it->second) {
            adjacent.push_back(neighbor);
        }
    }
    return adjacent;
}

bool RouteManager::validatePath(const std::deque<std::string>& path) const {
    for (size_t i = 0; i + 1 < path.size(); i++) {
        std::string edge = path[i] + "->" + path[i + 1];
        if (edgeDistances_.find(edge) == edgeDistances_.end()) {
            LOG_WARN("RouteManager", "Invalid path edge: " + edge);
            return false;
        }
    }
    return true;
}

bool RouteManager::getAutoRouteHome(const std::string& current, std::deque<std::string>& path) {
    return findPath(current, "home", path);
}

int RouteManager::fibonacciEncounters(int danger) {
    static const std::vector<int> fib = {0, 1, 1, 2, 3, 5};
    if (danger >= 1 && danger <= 5) return fib[danger];
    return 1;
}

} // namespace SH
