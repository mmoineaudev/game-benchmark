#pragma once
#include "Constants.hpp"
#include <vector>
#include <string>

struct Light {
    VD::Vec3 pos;
    VD::Vec3 color;
    float intensity;
    float range;
    int priority;
};

class LightManager {
public:
    void init();
    void add(const Light& l);
    void render(const VD::Mat4& viewProj);
    void setProfile(const std::string& profile);
    void clear();
    void update();
    const std::vector<Light>& lights() const { return m_lights; }
private:
    std::vector<Light> m_lights;
    std::string m_profile = "auto";
};
