#pragma once
#include "GameState.hpp"

class ScoreSystem {
public:
    void init();
    void update(float dt);
    void addKill(int baseScore, const char* type);
    int currentScore() const { return GameState::instance().score; }
private:
    float m_timer = 0;
};
