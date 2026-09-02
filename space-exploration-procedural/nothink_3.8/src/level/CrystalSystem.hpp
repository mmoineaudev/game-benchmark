#pragma once
#include "ChunkManager.hpp"
#include <string>
#include "ProceduralWrecks.hpp"
#include <vector>

struct Crystal {
    VD::Vec3 pos;
    float radius, hp;
    bool active = true;
    std::string chunkKey;
    float rotPhase;
};

class CrystalSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    void damage(Crystal& c, int dmg);
    std::vector<Crystal>& all() { return crystals; }
private:
    std::vector<Crystal> crystals;
    std::vector<float> scratch;
};
