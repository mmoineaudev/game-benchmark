#include "ScoreSystem.hpp"
#include "GameState.hpp"
#include "EventBus.hpp"
#include "BiomeGenerator.hpp"
#include <cmath>

void ScoreSystem::init() {
    m_timer = 0;
}

void ScoreSystem::update(float dt) {
    m_timer += dt;
    if (m_timer < 0.25f) return; // emit at 4Hz
    m_timer = 0;

    float dist = GameState::instance().distance;
    int score = (int)(dist / VD::SCORE_DISTANCE_DIVISOR);
    // Apply rung multiplier
    const RungConfig* cfg = BiomeGenerator::getRungConfig(GameState::instance().rungIndex);
    score = (int)(score * cfg->scoreMult);
    GameState::instance().score = score;
    EventBus::instance().emit(Events::SCORE_CHANGED);
}

void ScoreSystem::addKill(int baseScore, const char* type) {
    (void)type;
    GameState::instance().score += baseScore;
    EventBus::instance().emit(Events::SCORE_CHANGED);
}
