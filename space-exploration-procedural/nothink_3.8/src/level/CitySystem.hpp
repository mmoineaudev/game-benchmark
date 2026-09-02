#pragma once
#include "ChunkManager.hpp"
#include "ProceduralWrecks.hpp"
#include <vector>
#include <string>
#include <algorithm>

struct CityFragment {
    VD::Vec3 pos;
    float scale;
    bool active = true;
    std::string chunkKey;
    float windowFlicker;
};

struct CityWreck {
    VD::Vec3 pos;
    float scale, hp;
    bool active = true;
    std::string chunkKey;
    float strobePhase;
};

class CitySystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    void damageWreck(CityWreck& w, int dmg);
    std::vector<CityFragment>& fragments() { return m_frags; }
    std::vector<CityWreck>& wreckList() { return m_wrecks; }
private:
    std::vector<CityFragment> m_frags;
    std::vector<CityWreck> m_wrecks;
    std::vector<float> scratchF, scratchW;
};
