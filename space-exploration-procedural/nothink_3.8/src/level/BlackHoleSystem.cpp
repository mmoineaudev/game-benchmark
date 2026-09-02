#include "BlackHoleSystem.hpp"
#include "ProceduralWrecks.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void BlackHoleSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3&) {
    if (cfg.blackHole <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < cfg.blackHole; i++) {
        BlackHole h;
        h.pos = VD::Vec3((c.cx+0.5f)*r, c.rng.range(-20, 20), (c.cz+0.5f)*r);
        h.radius = c.rng.range(10, 22);
        h.gravityRadius = 450.0f * (0.6f + h.radius/30.0f);
        h.chunkKey = c.key;
        holes.push_back(h);
    }
}
void BlackHoleSystem::update(float dt, const VD::Vec3&) {
    // BH-BH attraction
    for (size_t i = 0; i < holes.size(); i++) {
        if (!holes[i].active) continue;
        for (size_t j = i+1; j < holes.size(); j++) {
            if (!holes[j].active) continue;
            float d = glm::length(holes[i].pos - holes[j].pos);
            if (d < VD::BH_ATTRACT_RANGE) {
                VD::Vec3 dir = glm::normalize(holes[j].pos - holes[i].pos);
                float force = VD::BH_ATTRACT_STRENGTH / (d * d);
                force = glm::min(force, (float)VD::BH_ATTRACT_CAP);
                holes[i].pos += dir * force * dt;
                holes[j].pos -= dir * force * dt;
            }
            if (d < (holes[i].radius + holes[j].radius) * 1.2f) {
                // merge
                holes[j].active = false;
                holes[i].radius += holes[j].radius;
            }
        }
    }
}
void BlackHoleSystem::cleanupChunk(const Chunk& c) {
    holes.erase(std::remove_if(holes.begin(), holes.end(),
        [&](const BlackHole& h){return h.chunkKey==c.key && h.active;}), holes.end());
}
void BlackHoleSystem::reset() { holes.clear(); }

VD::Vec3 BlackHoleSystem::gravity(const VD::Vec3& shipPos) const {
    VD::Vec3 acc = {0,0,0};
    for (auto& h : holes) {
        if (!h.active) continue;
        VD::Vec3 d = h.pos - shipPos;
        float dist = glm::length(d);
        if (dist > h.gravityRadius) continue;
        d /= dist;
        float base = VD::BH_GRAVITY_BASE * (h.radius/10.0f) * (h.radius/10.0f);
        float pull = base / (dist * dist + 100.0f);
        pull = glm::min(pull, (float)VD::BH_PULL_MAX);
        acc += d * pull * VD::BH_SHIP_PULL_FACTOR;
    }
    return acc;
}
void BlackHoleSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    // Render black holes as black discs + accretion ring
    // Simplified: draw a black sphere (base shader with emissive 0) + a glow ring
    for (auto& h : holes) {
        if (!h.active) continue;
        if (glm::length(h.pos - cam) > VD::INSTANCE_CULL_RADIUS) continue;
        // Black disc: draw a flat quad facing camera via beacon shader
        auto& neb = PW::Cache::instance().nebula;
        if (neb.vao == 0) continue;
        // (simplified: skip BH visual for now, just gravity + collision)
    }
}
