#include "ChunkManager.hpp"
#include "BiomeGenerator.hpp"
#include <cstdio>

void ChunkManager::init(std::vector<System*>& sys) {
    sysList = sys;
    curCfg = *BiomeGenerator::getRungConfig(0);
}

void ChunkManager::spawnActive(Chunk& c, const RungConfig& cfg) {
    for (auto* s : sysList)
        s->spawnChunk(c, cfg, VD::Vec3(0, 2, 0));
}

void ChunkManager::cleanupChunkData(const Chunk& c) {
    for (auto* s : sysList)
        s->cleanupChunk(c);
}

void ChunkManager::update(float dt, const VD::Vec3& shipPos, float distance) {
    (void)dt;
    int ri = BiomeGenerator::getRungIndex(distance);
    if (ri != prevRung) {
        prevRung = ri;
        curCfg = *BiomeGenerator::getRungConfig(distance);
    }

    int cx0 = (int)std::floor(shipPos.x / VD::CHUNK_SIZE);
    int cz0 = (int)std::floor(shipPos.z / VD::CHUNK_SIZE);
    int cy0 = 0;

    std::vector<std::string> activeKeys;
    activeKeys.reserve(9);
    for (int dx = -VD::CHUNKS_RADIUS; dx <= VD::CHUNKS_RADIUS; dx++)
        for (int dz = -VD::CHUNKS_RADIUS; dz <= VD::CHUNKS_RADIUS; dz++)
            activeKeys.push_back(chunkKey(cx0 + dx, cy0, cz0 + dz));

    for (auto& k : activeKeys) {
        if (chunks.find(k) == chunks.end()) spawnQueue.push_back(k);
    }
    int budget = VD::CHUNKS_SPAWN_PER_FRAME;
    for (auto it = spawnQueue.begin(); it != spawnQueue.end() && budget > 0;) {
        const std::string& k = *it;
        int x, y, z;
        sscanf(k.c_str(), "%d,%d,%d", &x, &y, &z);
        Chunk& c = chunks[k];
        c.cx = x; c.cy = y; c.cz = z;
        c.key = k;
        c.rng = VD::Mulberry32(VD::hash3(x, y, z));
        c.active = true;
        spawnActive(c, curCfg);
        it = spawnQueue.erase(it);
        budget--;
    }

    float cleanupR = VD::CHUNK_SIZE * (VD::CHUNKS_RADIUS + VD::CHUNKS_CLEANUP_RADIUS);
    for (auto it = chunks.begin(); it != chunks.end();) {
        float dx = (it->second.cx + 0.5f) * VD::CHUNK_SIZE - shipPos.x;
        float dz = (it->second.cz + 0.5f) * VD::CHUNK_SIZE - shipPos.z;
        if (dx * dx + dz * dz > cleanupR * cleanupR) {
            cleanupChunkData(it->second);
            it = chunks.erase(it);
        } else {
            ++it;
        }
    }

    for (auto* s : sysList)
        s->update(dt, shipPos);
}

void ChunkManager::render(const VD::Mat4& viewProj, const VD::Vec3& camPos) {
    for (auto* s : sysList)
        s->render(viewProj, camPos);
}

void ChunkManager::reset() {
    for (auto* s : sysList) s->reset();
    chunks.clear();
    spawnQueue.clear();
    prevRung = 0;
    curCfg = *BiomeGenerator::getRungConfig(0);
}
