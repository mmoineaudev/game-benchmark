#pragma once
#include "ChunkManager.hpp"
#include <string>
#include "ProceduralWrecks.hpp"
#include <vector>

struct Asteroid {
    VD::Vec3 pos;
    VD::Vec3 scale;
    VD::Vec3 color;
    float rotX, rotY, rotZ;
    float rotSpeed;
    int hp;
    int tier; // 0=large 1=med 2=small
    bool active = true;
    std::string chunkKey;
};

class AsteroidField : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;

    // Called by Physics on hit
    void damage(Asteroid& a, int dmg);
    void destroy(Asteroid& a);

    std::vector<Asteroid>& all() { return asteroids; }
    int count() const { return (int)asteroids.size(); }

private:
    std::vector<Asteroid> asteroids;
    std::vector<float> scratch;
    void drawAll(const VD::Mat4& vp, const VD::Vec3& cam);
};
