#pragma once
#include "ChunkManager.hpp"
#include <string>
#include <vector>

struct Nebula {
    VD::Vec3 pos;
    float scale;
    VD::Vec3 color;
    float seed;
    std::string chunkKey;
};

class NebulaSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
private:
    std::vector<Nebula> nebulae;
    std::vector<float> scratch;
};
