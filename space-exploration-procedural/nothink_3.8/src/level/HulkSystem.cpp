#include "EventBus.hpp"
#include "HulkSystem.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void HulkSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3&) {
    if (cfg.hulk <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < cfg.hulk; i++) {
        // min spacing
        bool ok = true;
        VD::Vec3 pos = VD::Vec3((c.cx+0.2f+0.6f*c.rng.next())*r,
            c.rng.range(-30, 30), (c.cz+0.2f+0.6f*c.rng.next())*r);
        for (auto& h : hulks) {
            if (h.active && glm::length(h.pos - pos) < VD::HULK::MIN_SPACING) { ok = false; break; }
        }
        if (!ok) continue;
        Hulk h;
        h.pos = pos;
        h.vel = VD::Vec3(c.rng.range(-1,1), c.rng.range(-0.3,0.3), c.rng.range(-1,1)) * 0.5f;
        h.rotAxis = glm::normalize(VD::Vec3(c.rng.range(-1,1), c.rng.range(-1,1), c.rng.range(-1,1)));
        h.rotSpeed = c.rng.range(-0.3, 0.3);
        h.scale = c.rng.range(6, 12);
        h.hp = VD::HULK::HP;
        h.strobePhase = c.rng.range(0, 6.28f);
        h.chunkKey = c.key;
        hulks.push_back(h);
    }
}
void HulkSystem::update(float dt, const VD::Vec3&) {
    for (auto& h : hulks) {
        if (!h.active) continue;
        h.pos += h.vel * dt;
        h.strobePhase += dt * 2.0f * (float)VD::HULK::STROBE_FREQ;
    }
}
void HulkSystem::cleanupChunk(const Chunk& c) {
    hulks.erase(std::remove_if(hulks.begin(), hulks.end(),
        [&](const Hulk& h){return h.chunkKey==c.key;}), hulks.end());
}
void HulkSystem::reset() { hulks.clear(); }
void HulkSystem::damage(Hulk& h, int dmg) {
    if (!h.active) return;
    h.hp -= dmg;
    if (h.hp <= 0) {
        h.active = false;
        EventBus::instance().emit(Events::ENV_HULK_DESTROYED);
        EventBus::instance().emit(Events::PLAYER_KILLED_ENTITY);
    }
}
void HulkSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    auto& m = PW::Cache::instance().hulk;
    if (m.vao==0) return;
    int n=0; scratch.resize(hulks.size()*9);
    for (auto& h : hulks) {
        if (!h.active) continue;
        if (glm::length(h.pos-cam) > VD::INSTANCE_CULL_RADIUS) continue;
        float* o=&scratch[n*9];
        o[0]=h.pos.x;o[1]=h.pos.y;o[2]=h.pos.z;
        o[3]=h.scale;o[4]=h.scale*0.5f;o[5]=h.scale*1.5f;
        o[6]=0.35f;o[7]=0.3f;o[8]=0.25f;
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
        glUniform3f(uC,1,1,1); glUniform1f(uE,0.0f);
        glUniform3f(uFC,VD::FOG_COLOR.x,VD::FOG_COLOR.y,VD::FOG_COLOR.z);
        glUniform1f(uFD,VD::FOG_DENSITY);
        glUniform3f(uCam,cam.x,cam.y,cam.z);
        glUniform1i(uLC,0);
    }
    glDrawElementsInstanced(GL_TRIANGLES,m.indices,GL_UNSIGNED_INT,0,n);
    glBindVertexArray(0);
}
