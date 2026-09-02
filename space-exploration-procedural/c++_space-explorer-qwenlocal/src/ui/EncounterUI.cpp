#include "ui/EncounterUI.hpp"
#include "core/Window.hpp"
#include "imgui.h"
#include "utils/Logging.hpp"
#include <sstream>

namespace SH {

EncounterUI::EncounterUI() : window_(nullptr), resolved_(false), progress_(0.0f) {}

void EncounterUI::init(Window* window) {
    window_ = window;
    LOG_INFO("EncounterUI", "Encounter UI initialized");
}

void EncounterUI::shutdown() {
    window_ = nullptr;
    LOG_INFO("EncounterUI", "Encounter UI shut down");
}

void EncounterUI::render(const std::string& encounterType, int difficulty,
                         bool interactive, bool resolved,
                         float progress,
                         const GameState& gameState) {
    if (!window_) return;

    ImGui::Begin("Encounter", nullptr, ImGuiWindowFlags_NoResize);
    ImGui::TextColored(ImVec4(1.0f, 0.5f, 0.0f, 1.0f), "Encounter: %s", encounterType.c_str());
    ImGui::Text("Difficulty: %d", difficulty);
    ImGui::Text("Interactive: %s", interactive ? "Yes" : "No");
    ImGui::Text("Resolved: %s", resolved ? "Yes" : "No");

    // Progress bar
    ImGui::ProgressBar(progress, ImVec2(-1.0f, 0.0f));

    // Encounter-specific UI
    if (encounterType == "pirate_ambush") {
        ImGui::Text("Pirate Ships: %d", gameState.encounterCount);
        ImGui::Text("Shots Fired: %d", gameState.turretShotsRemaining);
        if (ImGui::Button("Fire Turret")) {
            // Fire logic
        }
        ImGui::SameLine();
        if (ImGui::Button("Dodge")) {
            // Dodge logic
        }
    } else if (encounterType == "asteroid_field") {
        ImGui::Text("Dodge through asteroid field!");
        if (ImGui::Button("Dodge")) {
            // Dodge logic
        }
        ImGui::SameLine();
        if (ImGui::Button("Cancel")) {
            // Cancel logic
        }
    } else if (encounterType == "distress_signal") {
        ImGui::Text("Distress Signal Detected");
        if (ImGui::Button("Investigate")) {
            // Investigate logic
        }
        ImGui::SameLine();
        if (ImGui::Button("Ignore")) {
            // Ignore logic
        }
    } else if (encounterType == "solar_flare") {
        ImGui::TextColored(ImVec4(1.0f, 1.0f, 0.0f, 1.0f), "SOLAR FLARE INCOMING!");
        ImGui::Text("Time Left: %.1f", progress * 5.0f);
        if (ImGui::Button("Brace (Space)")) {
            // Brace logic
        }
    }

    ImGui::End();
}

void EncounterUI::renderChoiceUI(const std::string& encounterType,
                                 bool canInvestigate, bool canSkip) {
    ImGui::Begin("Choice", nullptr, ImGuiWindowFlags_NoResize);
    ImGui::Text("Choice: %s", encounterType.c_str());

    if (canInvestigate) {
        if (ImGui::Button("Investigate")) {
            // Investigate
        }
        ImGui::SameLine();
    }
    if (canSkip) {
        if (ImGui::Button("Skip/Decline")) {
            // Skip
        }
    }

    ImGui::End();
}

void EncounterUI::renderCombatUI(int pirateShips, int playerShots, int enemyHull) {
    ImGui::Begin("Combat", nullptr, ImGuiWindowFlags_NoResize);
    ImGui::TextColored(ImVec4(1.0f, 0.0f, 0.0f, 1.0f), "Combat");
    ImGui::Text("Pirate Ships: %d", pirateShips);
    ImGui::Text("Shots Fired: %d", playerShots);
    ImGui::Text("Enemy Hull: %d", enemyHull);

    if (ImGui::Button("Fire Turret")) {
        // Fire
    }
    ImGui::SameLine();
    if (ImGui::Button("Evasive Maneuvers")) {
        // Evade
    }

    ImGui::End();
}

void EncounterUI::renderDodgeUI(int asteroidsLeft, int playerHull) {
    ImGui::Begin("Dodge", nullptr, ImGuiWindowFlags_NoResize);
    ImGui::TextColored(ImVec4(0.0f, 1.0f, 0.0f, 1.0f), "Asteroid Field");
    ImGui::Text("Asteroids Remaining: %d", asteroidsLeft);
    ImGui::Text("Your Hull: %d/%d", playerHull, playerHull);

    if (ImGui::Button("Continue Dodging")) {
        // Continue
    }

    ImGui::End();
}

void EncounterUI::renderBraceUI(float timeLeft, bool success) {
    ImGui::Begin("Brace", nullptr, ImGuiWindowFlags_NoResize);
    ImGui::TextColored(ImVec4(1.0f, 1.0f, 0.0f, 1.0f), "SOLAR FLARE");
    ImGui::Text("Time to Brace: %.2f", timeLeft);

    if (success) {
        ImGui::TextColored(ImVec4(0.0f, 1.0f, 0.0f, 1.0f), "Braced Successfully!");
    }

    ImGui::End();
}

void EncounterUI::setPanelVisible(const std::string& panel, bool visible) {
    // Implementation - simple flag
}

bool EncounterUI::isPanelVisible(const std::string& panel) const {
    return true; // Simplified
}

} // namespace SH
