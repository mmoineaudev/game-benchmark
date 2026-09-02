#include "AdaptiveQuality.hpp"
#include "GameState.hpp"
#include <cmath>

void AdaptiveQuality::init() {
    m_level = 0;
    m_scale = 1.0f;
    m_hold = 0;
    m_ca = m_grain = true;
}

void AdaptiveQuality::update(float dt, float fps) {
    if (fps <= 0) return;
    m_hold += dt;
    if (m_hold < 1.0f) return; // 1s window

    if (fps < VD::AQ_HARD_FPS && m_level < 2) {
        m_level = 2;
        m_scale = VD::AQ_SCALE2;
        m_ca = false;
        m_grain = false;
    } else if (fps < VD::AQ_DROP_FPS && m_level < 1) {
        m_level = 1;
        m_scale = VD::AQ_SCALE1;
    } else if (fps > VD::AQ_RECOVER_FPS) {
        if (m_level > 0) {
            m_level--;
            m_scale = m_level == 1 ? VD::AQ_SCALE1 : 1.0f;
            m_ca = m_level < 2;
            m_grain = m_level < 2;
        }
    }
    GameState::instance().adaptiveLevel = m_level;
}
