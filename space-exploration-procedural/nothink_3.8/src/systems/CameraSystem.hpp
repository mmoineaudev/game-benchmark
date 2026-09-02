#pragma once
#include "Constants.hpp"

class PlayerShip;

class CameraSystem {
public:
    void init();
    void teleport(const VD::Vec3& pos);
    void update(float dt, const PlayerShip& ship);
    VD::Mat4 viewProj() const { return m_vp; }
    VD::Vec3 position() const { return m_pos; }
private:
    VD::Vec3 m_pos = {};
    bool m_needsSnap = true;
    VD::Mat4 m_vp;
};
