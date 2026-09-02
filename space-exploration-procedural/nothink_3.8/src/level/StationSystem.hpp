#pragma once
#include "ChunkManager.hpp"
#include <string>
#include "ProceduralWrecks.hpp"
#include <vector>

struct Station {
    VD::Vec3 pos;
    float scale;
    bool active = true;
    std::string chunkKey;
};

class StationSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    void damage(Station& s, int d) { if(!s.active)return; s.active=false; }
    std::vector<Station>& all() { return stations; }
private:
    std::vector<Station> stations;
    std::vector<float> scratch;
};
