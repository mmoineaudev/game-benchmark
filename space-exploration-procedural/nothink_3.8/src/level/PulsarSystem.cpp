#include "EventBus.hpp"
#include "PulsarSystem.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void PulsarSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) {
    if (cfg.pulsar <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < cfg.pulsar; i++) {
        // min spacing check
        VD::Vec3 pos = VD::Vec3((c.cx+0.3f+0.4f*c.rng.next())*r,
            c.rng.range(-20, 20), (c.cz+0.3f+0.4f*c.rng.next())*r);
        if (glm::length(pos - shipPos) < VD::PULSAR::MIN_DIST_SHIP) continue;
        bool tooClose = false;
        for (auto& p : pulsars) {
            if (p.active && glm::length(p.pos - pos) < VD::PULSAR::MIN_SPACING) { tooClose = true; break; }
        }
        if (tooClose) continue;
        Pulsar p;
        p.pos = pos;
        p.radius = c.rng.range(VD::PULSAR::RADIUS_MIN, VD::PULSAR::RADIUS_MAX);
        p.beamAngle1 = c.rng.range(0, 6.28f);
        p.beamAngle2 = c.rng.range(0, 6.28f);
        p.pulsePhase = c.rng.range(0, 6.28f);
        p.chunkKey = c.key;
        pulsars.push_back(p);
        EventBus::instance().emit(Events::ENV_PULSAR_SPAWNED);
    }
}
void PulsarSystem::update(float dt, const VD::Vec3&) {
    for (auto& p : pulsars) {
        if (!p.active) continue;
        p.beamAngle1 += dt * 0.8f;
        p.beamAngle2 -= dt * 0.6f;
        p.pulsePhase += dt * 2.0f * (float)VD::PULSAR::PULSE_HZ;
    }
}
void PulsarSystem::cleanupChunk(const Chunk& c) {
    pulsars.erase(std::remove_if(pulsars.begin(), pulsars.end(),
        [&](const Pulsar& p){return p.chunkKey==c.key;}), pulsars.end());
}
void PulsarSystem::reset() { pulsars.clear(); }

int PulsarSystem::beamDamage(const VD::Vec3& shipPos, const VD::Vec3&) const {
    (void)shipPos;
    // Simplified: beam is a thin cone; check distance from ship to beam axis
    int dmg = 0;
    for (auto& p : pulsars) {
        if (!p.active) continue;
        // Pulse gate: only damages when pulse is "on" (50% duty)
        float pulse = sinf(p.pulsePhase);
        if (pulse < 0) continue;
        // Two beam axes
        for (int b = 0; b < 2; b++) {
            float ang = b == 0 ? p.beamAngle1 : p.beamAngle2;
            VD::Vec3 dir = {sinf(ang), 0, cosf(ang)};
            VD::Vec3 toShip = shipPos - p.pos;
            float proj = glm::dot(toShip, dir);
            if (proj < 0 || proj > VD::PULSAR::BEAM_LENGTH) continue;
            VD::Vec3 closest = p.pos + dir * proj;
            float dist = glm::length(shipPos - closest);
            if (dist < VD::PULSAR::BEAM_TOUCH_RADIUS) {
                dmg += VD::PULSAR::DAMAGE;
            }
        }
    }
    return dmg;
}

void PulsarSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    // Core
    auto& m = PW::Cache::instance().pulsarCore;
    if (m.vao==0) return;
    int n=0; scratch.resize(pulsars.size()*9);
    for (auto& p : pulsars) {
        if (!p.active) continue;
        if (glm::length(p.pos-cam) > VD::INSTANCE_CULL_RADIUS) continue;
        float* o=&scratch[n*9];
        o[0]=p.pos.x;o[1]=p.pos.y;o[2]=p.pos.z;
        o[3]=p.radius;o[4]=p.radius*1.3f;o[5]=p.radius;
        o[6]=1.0f;o[7]=0.9f;o[8]=0.3f;
        n++;
    }
    if (n==0) return;
    PW::Cache::instance().writeInstances(m, scratch.data(), n);
    Shader* b=Shader::get("base"); b->use();
    glBindVertexArray(m.vao);
    {
        int uVP=Shader::u(b,"uViewProj"), uC=Shader::u(b,"uColor"), uE=Shader::u(b,"uEmissive");
        int uFC=Shader::u(b,"uFogColor"), uFD=Shader::u(b,"uFogDensity"), uCam=Shader::u(b,"uCamPos"), uLC=Shader::u(b,"uLightCount");
        glUniformMatrix4fv(uVP,1,GL_FALSE,&vp[0][0]);
        glUniform3f(uC,1,1,1); glUniform1f(uE,2.0f);
        glUniform3f(uFC,VD::FOG_COLOR.x,VD::FOG_COLOR.y,VD::FOG_COLOR.z);
        glUniform1f(uFD,VD::FOG_DENSITY);
        glUniform3f(uCam,cam.x,cam.y,cam.z);
        glUniform1i(uLC,0);
    }
    glDrawElementsInstanced(GL_TRIANGLES,m.indices,GL_UNSIGNED_INT,0,n);
    glBindVertexArray(0);
}
