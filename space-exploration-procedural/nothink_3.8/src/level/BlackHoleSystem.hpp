#pragma once
#include "ChunkManager.hpp"
#include <string>
#include <vector>

struct BlackHole {
    VD::Vec3 pos;
    float radius;
    float gravityRadius;
    bool active = true;
    std::string chunkKey;
};

class BlackHoleSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    // Gravity: returns total acceleration on ship
    VD::Vec3 gravity(const VD::Vec3& shipPos) const;
    std::vector<BlackHole>& all() { return holes; }
    void merge(BlackHole& a, BlackHole& b);
private:
    std::vector<BlackHole> holes;
    std::vector<float> scratch;
};
