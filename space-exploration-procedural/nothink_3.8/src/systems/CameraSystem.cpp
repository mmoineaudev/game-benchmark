#include "CameraSystem.hpp"
#include "PlayerShip.hpp"
#include <cmath>

void CameraSystem::init() {
    m_pos = {};
    m_needsSnap = true;
}

void CameraSystem::teleport(const VD::Vec3& pos) {
    m_pos = pos;
    m_needsSnap = true;
}

void CameraSystem::update(float dt, const PlayerShip& ship) {
    VD::Vec3 target = ship.camPos();
    float alpha = 1.0f - expf(-VD::CAMERA_DAMPING * dt);
    if (m_needsSnap) {
        m_pos = target;
        m_needsSnap = false;
    } else {
        m_pos = m_pos * (1.0f - alpha) + target * alpha;
    }
    m_vp = ship.viewProj();
}
