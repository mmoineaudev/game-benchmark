#include "LightManager.hpp"
#include "Shader.hpp"
#include "PlayerShip.hpp"
#include <algorithm>

void LightManager::init() {
    m_lights.clear();
    m_profile = "auto";
}

void LightManager::add(const Light& l) {
    m_lights.push_back(l);
}

void LightManager::clear() {
    m_lights.clear();
}

void LightManager::setProfile(const std::string& p) {
    m_profile = p;
}

void LightManager::update() {
    // Sort by priority, cap
    int cap = m_profile == "eco" ? VD::LIGHT_CAP_ECO : VD::LIGHT_CAP_AUTO;
    std::sort(m_lights.begin(), m_lights.end(), [](const Light& a, const Light& b) {
        return a.priority < b.priority;
    });
    if ((int)m_lights.size() > cap) m_lights.resize(cap);
}

void LightManager::render(const VD::Mat4& viewProj) {
    (void)viewProj;
    // Lights are applied via uniforms to the base shader
    // (handled by Game::render)
}
