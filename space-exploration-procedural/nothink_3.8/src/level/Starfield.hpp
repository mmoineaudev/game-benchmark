#pragma once
#include "Constants.hpp"
#include <GL/glew.h>
#include <vector>

struct Star {
    VD::Vec3 pos;
    float size;
    VD::Vec3 color;
    float phase;
};

struct ShootingStar {
    VD::Vec3 pos, vel;
    float life;
    bool active = false;
};

class Starfield {
public:
    void init();
    void dispose();
    void update(float dt, const VD::Vec3& shipPos);
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos);
    void wrap(const VD::Vec3& shipPos);
private:
    std::vector<Star> starsFar, starsMid, starsNear, starsBright;
    std::vector<ShootingStar> shooters;
    float spawnTimer = 0;
    GLuint vbo[4] = {0};
};
