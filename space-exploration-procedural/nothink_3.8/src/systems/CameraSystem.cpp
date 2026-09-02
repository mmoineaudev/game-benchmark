#include "CameraSystem.hpp"
#include "PlayerShip.hpp"
#include <cmath>

void CameraSystem::init() {
    m_pos = {};
}

void CameraSystem::update(float dt, const PlayerShip& ship) {
    VD::Vec3 target = ship.camPos();
    float alpha = 1.0f - expf(-VD::CAMERA_DAMPING * dt);
    m_pos = m_pos * (1.0f - alpha) + target * alpha;
    m_vp = ship.viewProj();
}
