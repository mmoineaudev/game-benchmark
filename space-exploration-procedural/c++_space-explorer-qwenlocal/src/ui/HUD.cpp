#include "ui/HUD.hpp"
#include "core/GameState.hpp"
#include "core/Window.hpp"
#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include <sstream>

namespace SH {

HUD::HUD() {
    panelVisibility_ = {
        {"hud", true},
        {"galaxy_map", false},
        {"encounter", false},
        {"market", false},
        {"death", false},
        {"success", false},
        {"cargo_bar", true},
        {"fuel_bar", true},
        {"hull_bar", true},
        {"shield_bar", true}
    };
}

void HUD::init(Window* window) {
    window_ = window;
    LOG_INFO("HUD", "HUD initialized");
}

void HUD::shutdown() {
    window_ = nullptr;
    LOG_INFO("HUD", "HUD shut down");
}

void HUD::render(const std::string& state, PlayerShip& ship,
                 const std::vector<GameState::SystemNode>& systems,
                 const std::string& currentSystem,
                 int routeDanger, int fuelCost,
                 const std::string& activeEncounter,
                 const std::unordered_map<std::string, int>& cargoManifest) {
    ImGui::Begin("Space Hauler HUD", nullptr, ImGuiWindowFlags_NoScrollbar);
    
    ImVec2 windowSize = ImGui::GetWindowSize();
    
    ImGui::TextColored(ImVec4(0.0f, 1.0f, 1.0f, 1.0f), "Space Hauler");
    ImGui::Separator();
    
    ImGui::Text("State: %s", state.c_str());
    
    std::ostringstream oss;
    oss << "Credits: $" << ship.getCredits();
    ImGui::TextColored(ImVec4(1.0f, 1.0f, 0.0f, 1.0f), oss.str().c_str());
    
    oss.str("");
    oss << "Cargo: " << ship.getCargo() << "/" << ship.getCargoMax();
    ImGui::ProgressBar(static_cast<float>(ship.getCargo()) / ship.getCargoMax(), ImVec2(-1.0f, 0.0f));
    ImGui::Text(oss.str().c_str());
    
    oss.str("");
    oss << "Fuel: " << ship.getFuel() << "/" << ship.getFuelMax();
    ImGui::ProgressBar(static_cast<float>(ship.getFuel()) / ship.getFuelMax(), ImVec2(-1.0f, 0.0f));
    ImGui::Text(oss.str().c_str());
    
    oss.str("");
    oss << "Hull: " << ship.getHull() << "/" << ship.getHullMax();
    ImVec4 hullColor = ImVec4(0.0f, 1.0f, 0.0f, 1.0f);
    if (ship.getHull() < static_cast<int>(ship.getHullMax() * 0.3f)) {
        hullColor = ImVec4(1.0f, 0.0f, 0.0f, 1.0f);
    }
    ImGui::TextColored(hullColor, oss.str().c_str());
    ImGui::ProgressBar(static_cast<float>(ship.getHull()) / ship.getHullMax(), ImVec2(-1.0f, 0.0f));
    
    oss.str("");
    oss << "Shield: " << ship.getShield() << "/" << ship.getShieldMax();
    ImGui::ProgressBar(static_cast<float>(ship.getShield()) / ship.getShieldMax(), ImVec2(-1.0f, 0.0f));
    ImGui::Text(oss.str().c_str());
    
    ImGui::Separator();
    
    if (!currentSystem.empty()) {
        ImGui::Text("Current System: %s", currentSystem.c_str());
    }
    
    if (!activeEncounter.empty()) {
        ImGui::TextColored(ImVec4(1.0f, 0.5f, 0.0f, 1.0f), "Encounter: %s", activeEncounter.c_str());
    }
    
    if (routeDanger > 0) {
        ImGui::Text("Route Danger: %d", routeDanger);
    }
    
    if (fuelCost > 0) {
        ImGui::Text("Fuel Cost: %d", fuelCost);
    }
    
    ImGui::End();
}

void HUD::renderFlightHUD(PlayerShip& ship) {
    ImGui::Begin("Flight HUD", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoNav);
    ImGui::SetWindowPos(ImVec2(10, 10));
    ImGui::SetWindowSize(ImVec2(200, 100));
    
    ImGui::TextColored(ImVec4(0.0f, 1.0f, 0.0f, 1.0f), "Flight Mode");
    ImGui::ProgressBar(static_cast<float>(ship.getHull()) / ship.getHullMax(), ImVec2(-1.0f, 0.0f));
    ImGui::Text("Hull: %d/%d", ship.getHull(), ship.getHullMax());
    ImGui::ProgressBar(static_cast<float>(ship.getShield()) / ship.getShieldMax(), ImVec2(-1.0f, 0.0f));
    ImGui::Text("Shield: %d/%d", ship.getShield(), ship.getShieldMax());
    
    ImGui::End();
}

void HUD::renderGalaxyMap(const std::vector<GameState::SystemNode>& systems,
                          const std::vector<GameState::RouteEdge>& routes,
                          const std::string& selectedSystem,
                          const std::string& routeTo) {
    ImGui::Begin("Galaxy Map", nullptr, ImGuiWindowFlags_NoResize);
    ImGui::Text("Galaxy Map");
    ImGui::Separator();
    
    ImVec2 canvasSize = ImGui::GetContentRegionAvail();
    ImDrawList* drawList = ImGui::GetWindowDrawList();
    
    // Build position map first
    struct SysPos {
        std::string id;
        ImVec2 pos;
    };
    std::vector<SysPos> positions;
    positions.reserve(systems.size());
    
    for (const auto& sys : systems) {
        ImVec2 pos(canvasSize.x * (sys.x + 1000) / 2000 + 50,
                   canvasSize.y * (sys.y + 1000) / 2000 + 50);
        positions.push_back({sys.id, pos});
        
        ImU32 color = 0xFFFFFFFF;
        if (sys.id == "home") color = 0xFF00FF00;
        else if (sys.danger >= 4) color = 0xFFFF0000;
        
        drawList->AddCircle(pos, 8.0f, color, 6);
        
        // System name - draw directly, not via ImGui push/pop
        float nameX = pos.x - 30.0f;
        float nameY = pos.y - 10.0f;
        drawList->AddText(ImVec2(nameX, nameY), 0xFFFFFFFF, sys.name.c_str());
        
        if (sys.id == selectedSystem) {
            drawList->AddCircle(pos, 12.0f, 0xFFFFFF00, 6);
        }
    }
    
    // Build position lookup
    auto findPos = [&](const std::string& id) -> ImVec2 {
        for (const auto& sp : positions) {
            if (sp.id == id) return sp.pos;
        }
        return ImVec2(0, 0);
    };
    
    for (const auto& route : routes) {
        ImVec2 fromPos = findPos(route.from);
        ImVec2 toPos = findPos(route.to);
        
        if (fromPos.x == 0 && fromPos.y == 0) continue;
        if (toPos.x == 0 && toPos.y == 0) continue;
        
        ImU32 lineColor = 0xFF888888;
        if (route.from == selectedSystem || route.from == routeTo ||
            route.to == selectedSystem || route.to == routeTo) {
            lineColor = 0xFFFFFFFF;
        }
        
        drawList->AddLine(fromPos, toPos, lineColor, 2.0f);
    }
    
    ImGui::End();
}

void HUD::renderEncounterUI(const std::string& encounterType, bool resolved) {
    ImGui::Begin("Encounter", nullptr, ImGuiWindowFlags_NoResize);
    ImGui::Text("Encounter");
    ImGui::Separator();
    
    ImGui::TextColored(ImVec4(1.0f, 0.5f, 0.0f, 1.0f), "Type: %s", encounterType.c_str());
    ImGui::ProgressBar(0.5f, ImVec2(-1.0f, 0.0f));
    ImGui::Text("Resolve: %s", resolved ? "Yes" : "No");
    
    if (!resolved) {
        if (ImGui::Button("Fight")) {
        }
        ImGui::SameLine();
        if (ImGui::Button("Dodge")) {
        }
        ImGui::SameLine();
        if (ImGui::Button("Flee")) {
        }
    }
    
    ImGui::End();
}

void HUD::renderMarketUI(const std::unordered_map<std::string, int>& cargoTypes,
                         const std::unordered_map<std::string, int>& systemPrices) {
    ImGui::Begin("Market", nullptr, ImGuiWindowFlags_NoResize);
    ImGui::Text("Market");
    ImGui::Separator();
    
    for (const auto& [type, price] : systemPrices) {
        ImGui::Text("%s: %d credits", type.c_str(), price);
    }
    
    if (ImGui::Button("Buy Cargo")) {
    }
    ImGui::SameLine();
    if (ImGui::Button("Sell Cargo")) {
    }
    
    ImGui::End();
}

void HUD::renderDeathScreen(int profit, int systemsVisited) {
    ImGui::Begin("Death Screen", nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                 ImGuiWindowFlags_Modal);
    ImGui::SetWindowPos(ImVec2(0, 0));
    ImGui::SetWindowSize(ImVec2(600, 400));
    
    ImGui::TextColored(ImVec4(1.0f, 0.0f, 0.0f, 1.0f), "Ship Destroyed!");
    ImGui::Separator();
    
    ImGui::Text("Profit: %d credits", profit);
    ImGui::Text("Systems Visited: %d", systemsVisited);
    ImGui::Text("Run ended in death.");
    
    if (ImGui::Button("Continue")) {
    }
    
    ImGui::End();
}

void HUD::renderSuccessScreen(int profit, int systemsVisited, int persistentCredits) {
    ImGui::Begin("Success Screen", nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove);
    ImGui::SetWindowPos(ImVec2(0, 0));
    ImGui::SetWindowSize(ImVec2(600, 400));
    
    ImGui::TextColored(ImVec4(0.0f, 1.0f, 0.0f, 1.0f), "Mission Complete!");
    ImGui::Separator();
    
    ImGui::Text("Profit: %d credits", profit);
    ImGui::Text("Systems Visited: %d", systemsVisited);
    ImGui::Text("Persistent Credits Earned: %d", persistentCredits);
    
    if (ImGui::Button("Continue")) {
    }
    
    ImGui::End();
}

void HUD::renderCargoBar(int current, int max) {
    ImGui::ProgressBar(static_cast<float>(current) / max, ImVec2(-1.0f, 0.0f));
    ImGui::Text("Cargo: %d/%d", current, max);
}

void HUD::renderFuelBar(int current, int max) {
    ImGui::ProgressBar(static_cast<float>(current) / max, ImVec2(-1.0f, 0.0f));
    ImGui::Text("Fuel: %d/%d", current, max);
}

void HUD::renderHullBar(int current, int max) {
    ImVec4 color = ImVec4(0.0f, 1.0f, 0.0f, 1.0f);
    if (current < max * 0.3f) {
        color = ImVec4(1.0f, 0.0f, 0.0f, 1.0f);
    }
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, ImVec4(color.x, color.y, color.z, color.w));
    ImGui::ProgressBar(static_cast<float>(current) / max, ImVec2(-1.0f, 0.0f));
    ImGui::PopStyleColor(1);
    ImGui::Text("Hull: %d/%d", current, max);
}

void HUD::renderShieldBar(int current, int max) {
    ImGui::ProgressBar(static_cast<float>(current) / max, ImVec2(-1.0f, 0.0f));
    ImGui::Text("Shield: %d/%d", current, max);
}

void HUD::setPanelVisible(const std::string& panel, bool visible) {
    panelVisibility_[panel] = visible;
}

bool HUD::isPanelVisible(const std::string& panel) const {
    auto it = panelVisibility_.find(panel);
    return it != panelVisibility_.end() && it->second;
}

} // namespace SH
