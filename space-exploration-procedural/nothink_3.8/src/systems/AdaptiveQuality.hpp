#pragma once
#include "Constants.hpp"

class AdaptiveQuality {
public:
    void init();
    void update(float dt, float fps);
    int level() const { return m_level; }
    float resolutionScale() const { return m_scale; }
    bool caEnabled() const { return m_ca; }
    bool grainEnabled() const { return m_grain; }
private:
    int m_level = 0;
    float m_scale = 1.0f;
    float m_hold = 0;
    bool m_ca = true, m_grain = true;
};
