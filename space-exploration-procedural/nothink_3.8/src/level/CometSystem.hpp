#pragma once
#include "ChunkManager.hpp"
#include <string>
#include "ProceduralWrecks.hpp"
#include <vector>

struct Comet {
    VD::Vec3 pos, vel;
    float radius, hp;
    bool active = true;
    std::string chunkKey;
};

class CometSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    void damage(Comet& c, int dmg);
    std::vector<Comet>& all() { return comets; }
private:
    std::vector<Comet> comets;
    std::vector<float> scratch;
};
