#include "HUD.hpp"
#include "GameState.hpp"
#include "EventBus.hpp"
#include "BiomeGenerator.hpp"
#include <imgui.h>
#include <cstdio>

void HUD::init() {
    m_showLadder = false;
    auto& eb = EventBus::instance();
    eb.on(Events::LADDER_RUNG_CHANGED, [this]() {
        // Flash biome name
    });
}

void HUD::render() {
    auto& g = GameState::instance();
    if (g.dead) return;

    ImGui::Begin("##HUD", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize);

    // Health bar
    float hp = (float)g.health / VD::MAX_HEALTH;
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1,1,1,0.8f));
    ImGui::Text("HP %d", g.health);
    ImGui::PopStyleColor();
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0,0,0,0.3f));
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, hp > 0.5f ? ImVec4(0,1,0,0.8f) : (hp > 0.25f ? ImVec4(1,1,0,0.8f) : ImVec4(1,0,0,0.8f)));
    ImGui::PushItemWidth(200);
    ImGui::ProgressBar(hp, ImVec2(200, 12));
    ImGui::PopItemWidth();
    ImGui::PopStyleColor(2);

    // Score
    ImGui::Text("SCORE: %d", g.score);

    // Distance
    ImGui::Text("DIST: %.0f u", g.distance);

    // Biome
    const RungConfig* cfg = BiomeGenerator::getRungConfig(g.rungIndex);
    ImGui::Text("BIOME: %s (%.1fx)", cfg->key.c_str(), cfg->scoreMult);

    // Shield
    if (g.shieldCooldown > 0)
        ImGui::Text("SHIELD: %.1fs", g.shieldCooldown);
    else
        ImGui::Text("SHIELD: READY");

    // Throttle
    ImGui::Text("THR: %.0f%%", g.throttle * 100);

    ImGui::End();
}
