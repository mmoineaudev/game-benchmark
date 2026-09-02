#pragma once
#include <string>
#include "core/GameState.hpp"

namespace SH {

class Window;

class EncounterUI {
public:
    EncounterUI();
    ~EncounterUI() = default;

    void init(Window* window);
    void shutdown();

    void render(const std::string& encounterType, int difficulty,
                bool interactive, bool resolved,
                float progress,
                const GameState& gameState);

    void renderChoiceUI(const std::string& encounterType,
                        bool canInvestigate, bool canSkip);
    void renderCombatUI(int pirateShips, int playerShots, int enemyHull);
    void renderDodgeUI(int asteroidsLeft, int playerHull);
    void renderBraceUI(float timeLeft, bool success);

    void setPanelVisible(const std::string& panel, bool visible);
    bool isPanelVisible(const std::string& panel) const;

private:
    Window* window_ = nullptr;
    std::string activeEncounter_;
    bool resolved_ = false;
    float progress_ = 0.0f;
};

} // namespace SH
