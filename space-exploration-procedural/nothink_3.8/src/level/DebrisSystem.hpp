#pragma once
#include "ChunkManager.hpp"
#include <string>
#include "ProceduralWrecks.hpp"
#include <vector>

struct Debris {
    VD::Vec3 pos, vel;
    float radius, hp;
    bool active = true;
    std::string chunkKey;
};

class DebrisSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    void damage(Debris& d, int dmg);
    std::vector<Debris>& all() { return debris; }
private:
    std::vector<Debris> debris;
    std::vector<float> scratch;
};
