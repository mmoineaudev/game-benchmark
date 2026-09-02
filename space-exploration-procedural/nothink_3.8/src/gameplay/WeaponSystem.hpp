#pragma once
#include "Constants.hpp"
#include <vector>

class PlayerShip;

struct LaserBeam {
    VD::Vec3 origin;
    VD::Vec3 dir;
    float life;
    float length;
    bool active = false;
    int childIndex = -1;
};

struct CrystalBeam {
    VD::Vec3 origin, dir;
    float life, length;
    bool active = false;
    int parentIdx;
};

class WeaponSystem {
public:
    void init();
    void update(float dt, const PlayerShip& ship);
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos);
    void fireCrystalChild(const VD::Vec3& pos, const VD::Vec3& baseDir);
    void firePlayerBeams(const PlayerShip& ship);
    void clearAll();

    const std::vector<LaserBeam>& beams() const { return m_beams; }
    const std::vector<CrystalBeam>& crystalBeams() const { return m_crystalBeams; }
    void killBeam(int idx);

private:
    std::vector<LaserBeam> m_beams;
    std::vector<CrystalBeam> m_crystalBeams;
    int m_nextBeam = 0;
};
