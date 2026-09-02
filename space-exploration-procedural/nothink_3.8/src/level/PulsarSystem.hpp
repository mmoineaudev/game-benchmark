#pragma once
#include "ChunkManager.hpp"
#include <string>
#include "ProceduralWrecks.hpp"
#include <vector>

struct Pulsar {
    VD::Vec3 pos;
    float radius;
    float beamAngle1, beamAngle2;
    float pulsePhase;
    bool active = true;
    std::string chunkKey;
};

class PulsarSystem : public ChunkManager::System {
public:
    void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) override;
    void update(float dt, const VD::Vec3& shipPos) override;
    void cleanupChunk(const Chunk& c) override;
    void reset() override;
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) override;
    // Beam damage check: returns damage to ship this frame
    int beamDamage(const VD::Vec3& shipPos, const VD::Vec3& shipFwd) const;
    std::vector<Pulsar>& all() { return pulsars; }
    void damage(Pulsar& p, int dmg) { if(!p.active)return; p.active=false; }
private:
    std::vector<Pulsar> pulsars;
    std::vector<float> scratch;
};
