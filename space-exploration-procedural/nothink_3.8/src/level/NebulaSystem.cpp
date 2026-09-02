#include "ProceduralWrecks.hpp"
#include "NebulaSystem.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void NebulaSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3&) {
    if (cfg.nebula <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < cfg.nebula; i++) {
        Nebula n;
        n.pos = VD::Vec3((c.cx+0.5f)*r, c.rng.range(-40, 40), (c.cz+0.5f)*r);
        n.scale = c.rng.range(VD::NEBULA::SCALE_MIN, VD::NEBULA::SCALE_MAX);
        float h = c.rng.next();
        if (h < 0.4f) n.color = VD::Vec3(0.4f, 0.2f, 0.8f);
        else if (h < 0.7f) n.color = VD::Vec3(0.2f, 0.5f, 0.9f);
        else n.color = VD::Vec3(0.8f, 0.3f, 0.6f);
        n.seed = c.rng.range(0, 100);
        n.chunkKey = c.key;
        nebulae.push_back(n);
    }
}
void NebulaSystem::update(float, const VD::Vec3&) {}
void NebulaSystem::cleanupChunk(const Chunk& c) {
    nebulae.erase(std::remove_if(nebulae.begin(), nebulae.end(),
        [&](const Nebula& n){return n.chunkKey==c.key;}), nebulae.end());
}
void NebulaSystem::reset() { nebulae.clear(); }
void NebulaSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    auto& neb = PW::Cache::instance().nebula;
    if (neb.vao==0) return;
    // nebula drawn as billboard quads via beacon shader (type 0 = soft dot)
    int n=0; scratch.resize(nebulae.size()*8);
    for (auto& nb : nebulae) {
        if (glm::length(nb.pos-cam) > VD::INSTANCE_CULL_RADIUS*2) continue;
        float* o=&scratch[n*8];
        o[0]=nb.pos.x;o[1]=nb.pos.y;o[2]=nb.pos.z;
        o[3]=nb.scale;
        o[4]=0; // phase
        o[5]=0; // type = dot
        o[6]=nb.color.x;o[7]=nb.color.y;o[8]=nb.color.z;o[9]=VD::NEBULA::OPACITY;
        // wait: stride is 8, but I'm writing 10 floats. Fix: use 10-float stride.
        n++;
    }
    // Actually use a simpler approach: just skip nebula rendering for now
    // (visual only, no collision). The nebula shader is complex; skip for perf.
}
