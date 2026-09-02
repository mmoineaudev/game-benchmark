#pragma once
#include "ChunkManager.hpp"
#include <string>
#include "ProceduralWrecks.hpp"
#include <vector>

struct Hulk {
    VD::Vec3 pos, vel;
    VD::Vec3 rotAxis;
    float rotSpeed, scale, hp;
    bool active = true;
    std::string chunkKey;
    float strobePhase;
};

class HulkSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    void damage(Hulk& h, int dmg);
    std::vector<Hulk>& all() { return hulks; }
private:
    std::vector<Hulk> hulks;
    std::vector<float> scratch;
};
