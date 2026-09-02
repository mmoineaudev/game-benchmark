#pragma once
#include "ChunkManager.hpp"
#include <string>
#include <vector>

struct StormCloud {
    VD::Vec3 pos;
    float radius;
    bool active = true;
    std::string chunkKey;
    // Pair state
    int pairIdx = -1;
    float state = 0; // 0=waiting 1=telegraph 2=bolt
    float timer = 0;
    float restrike = 0;
};

class StormSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    int strikeDamage(const VD::Vec3& shipPos) const;
    void setStatic(bool active, float intensity);
    std::vector<StormCloud>& all() { return clouds; }
private:
    std::vector<StormCloud> clouds;
    std::vector<float> scratch;
    bool staticActive = false;
    float staticIntensity = 0;
};
