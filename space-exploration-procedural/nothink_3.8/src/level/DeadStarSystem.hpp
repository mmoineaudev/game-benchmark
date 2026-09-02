#pragma once
#include "ChunkManager.hpp"
#include <string>
#include "ProceduralWrecks.hpp"
#include <vector>

struct DeadStar {
    VD::Vec3 pos;
    float radius, phase;
    bool active = true;
    std::string chunkKey;
};

class DeadStarSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    std::vector<DeadStar>& all() { return stars; }
private:
    std::vector<DeadStar> stars;
    std::vector<float> scratch;
};
