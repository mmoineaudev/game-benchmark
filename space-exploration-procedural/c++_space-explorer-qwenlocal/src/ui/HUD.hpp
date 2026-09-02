#pragma once
#include <string>
#include "core/GameState.hpp"
#include <vector>
#include <unordered_map>
#include "gameplay/PlayerShip.hpp"
#include "core/Constants.hpp"

namespace SH {

class Window; // Forward declaration

// ImGui-based HUD overlay
class HUD {
public:
    HUD();
    ~HUD() = default;

    void init(Window* window);
    void shutdown();

    // Render HUD overlays based on game state
    void render(const std::string& state, PlayerShip& ship,
                const std::vector<GameState::SystemNode>& systems,
                const std::string& currentSystem,
                int routeDanger, int fuelCost,
                const std::string& activeEncounter = "",
                const std::unordered_map<std::string, int>& cargoManifest = {});

    // Render specific panels
    void renderFlightHUD(PlayerShip& ship);
    void renderGalaxyMap(const std::vector<GameState::SystemNode>& systems,
                         const std::vector<GameState::RouteEdge>& routes,
                         const std::string& selectedSystem = "",
                         const std::string& routeTo = "");
    void renderEncounterUI(const std::string& encounterType, bool resolved);
    void renderMarketUI(const std::unordered_map<std::string, int>& cargoTypes,
                        const std::unordered_map<std::string, int>& systemPrices);
    void renderDeathScreen(int profit, int systemsVisited);
    void renderSuccessScreen(int profit, int systemsVisited, int persistentCredits);

    // Render cargo bar
    void renderCargoBar(int current, int max);
    void renderFuelBar(int current, int max);
    void renderHullBar(int current, int max);
    void renderShieldBar(int current, int max);

    // Set active panels
    void setPanelVisible(const std::string& panel, bool visible);
    bool isPanelVisible(const std::string& panel) const;

    // Non-copyable
    HUD(const HUD&) = delete;
    HUD& operator=(const HUD&) = delete;

private:
    Window* window_ = nullptr;
    std::unordered_map<std::string, bool> panelVisibility_;
};

} // namespace SH
