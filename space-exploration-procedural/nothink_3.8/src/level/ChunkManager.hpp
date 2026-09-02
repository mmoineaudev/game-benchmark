#pragma once
#include "Rng.hpp"
#include "Constants.hpp"
#include "BiomeGenerator.hpp"
#include <vector>
#include <unordered_map>
#include <string>

struct Chunk {
    int cx = 0, cy = 0, cz = 0;
    VD::Mulberry32 rng{0};
    std::string key;
    bool active = false;
};

class ChunkManager {
public:
    class System {
    public:
        virtual ~System() = default;
        virtual void spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) = 0;
        virtual void update(float dt, const VD::Vec3& shipPos) = 0;
        virtual void cleanupChunk(const Chunk& c) = 0;
        virtual void reset() = 0;
        virtual void render(const VD::Mat4& viewProj, const VD::Vec3& camPos) {}
    };

    void init(std::vector<System*>& systems);
    void update(float dt, const VD::Vec3& shipPos, float distance);
    void render(const VD::Mat4& viewProj, const VD::Vec3& camPos);
    void reset();

    const RungConfig* currentCfg() const { return &curCfg; }

    float densityFactor(float distance) const {
        return (1.0f - distance / 100000.0f) * VD::DENSITY_REDUCTION + 0.45f;
    }

private:
    static std::string chunkKey(int x, int y, int z) {
        return std::to_string(x) + "," + std::to_string(y) + "," + std::to_string(z);
    }
    void spawnActive(Chunk& c, const RungConfig& cfg);
    void cleanupChunkData(const Chunk& c);

    std::unordered_map<std::string, Chunk> chunks;
    std::vector<System*> sysList;
    RungConfig curCfg;
    int prevRung = 0;
    std::vector<std::string> spawnQueue;
};
