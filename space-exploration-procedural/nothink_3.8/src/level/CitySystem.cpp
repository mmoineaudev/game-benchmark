#include "EventBus.hpp"
#include "CitySystem.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void CitySystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) {
    if (cfg.cityChance <= 0 && cfg.wreckDensity <= 0) return;
    float r = VD::CHUNK_SIZE;

    // City fragment
    if (c.rng.next() < VD::CITY::CITY_CHANCE) {
        bool ok = true;
        VD::Vec3 pos = VD::Vec3((c.cx+0.5f)*r, c.rng.range(-10, 10), (c.cz+0.5f)*r);
        if (glm::length(pos - shipPos) < VD::CITY::MIN_DIST_SHIP) ok = false;
        for (auto& f : m_frags) {
            if (f.active && glm::length(f.pos - pos) < VD::CITY::MIN_SPACING) { ok = false; break; }
        }
        if (ok) {
            CityFragment f;
            f.pos = pos;
            f.scale = VD::CITY::FRAGMENT_SCALE;
            f.windowFlicker = c.rng.range(0, 6.28f);
            f.chunkKey = c.key;
            m_frags.push_back(f);
            EventBus::instance().emit(Events::ENV_CITY_FRAGMENT_SPAWNED);
        }
    }

    // Wrecks
    for (int i = 0; i < cfg.wreckDensity; i++) {
        CityWreck w;
        w.pos = VD::Vec3((c.cx+0.1f+0.8f*c.rng.next())*r,
            c.rng.range(-30, 30), (c.cz+0.1f+0.8f*c.rng.next())*r);
        w.scale = c.rng.range(0.5f, 0.9f) * 8.0f;
        w.hp = VD::CITY::WRECK_HP;
        w.strobePhase = c.rng.range(0, 6.28f) + 3.14159f;
        w.chunkKey = c.key;
        m_wrecks.push_back(w);
    }
}
void CitySystem::update(float dt, const VD::Vec3&) {
    for (auto& f : m_frags) { if (f.active) f.windowFlicker += dt * 2.0f * (float)VD::CITY::FLICKER_FREQ; }
    for (auto& w : m_wrecks) { if (w.active) w.strobePhase += dt * 2.0f * (float)VD::CITY::STROBE_FREQ; }
}
void CitySystem::cleanupChunk(const Chunk& c) {
    m_frags.erase(std::remove_if(m_frags.begin(), m_frags.end(),
        [&](const CityFragment& f){return f.chunkKey==c.key;}), m_frags.end());
    m_wrecks.erase(std::remove_if(m_wrecks.begin(), m_wrecks.end(),
        [&](const CityWreck& w){return w.chunkKey==c.key;}), m_wrecks.end());
}
void CitySystem::reset() { m_frags.clear(); m_wrecks.clear(); }
void CitySystem::damageWreck(CityWreck& w, int dmg) {
    if (!w.active) return;
    w.hp -= dmg;
    if (w.hp <= 0) {
        w.active = false;
        EventBus::instance().emit(Events::ENV_WRECK_DESTROYED);
        EventBus::instance().emit(Events::PLAYER_KILLED_ENTITY);
    }
}
void CitySystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    // Fragments as large dark boxes
    auto& m = PW::Cache::instance().cityRing;
    if (m.vao==0) return;
    int n=0; scratchF.resize(m_frags.size()*9);
    for (auto& f : m_frags) {
        if (!f.active) continue;
        if (glm::length(f.pos-cam) > VD::INSTANCE_CULL_RADIUS*2) continue;
        float* o=&scratchF[n*9];
        o[0]=f.pos.x;o[1]=f.pos.y;o[2]=f.pos.z;
        o[3]=f.scale;o[4]=f.scale*0.3f;o[5]=f.scale;
        o[6]=0.15f;o[7]=0.15f;o[8]=0.2f;
        n++;
    }
    if (n>0) {
        PW::Cache::instance().writeInstances(m, scratchF.data(), n);
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
        glDrawElementsInstanced(GL_TRIANGLES,m.indices,GL_FLOAT,0,n);
        glBindVertexArray(0);
    }

    // Wrecks
    auto& mw = PW::Cache::instance().wreck;
    if (mw.vao==0) return;
    n=0; scratchW.resize(m_wrecks.size()*9);
    for (auto& w : m_wrecks) {
        if (!w.active) continue;
        if (glm::length(w.pos-cam) > VD::INSTANCE_CULL_RADIUS) continue;
        float* o=&scratchW[n*9];
        o[0]=w.pos.x;o[1]=w.pos.y;o[2]=w.pos.z;
        o[3]=w.scale;o[4]=w.scale*0.6f;o[5]=w.scale*1.2f;
        o[6]=0.4f;o[7]=0.35f;o[8]=0.3f;
        n++;
    }
    if (n>0) {
        PW::Cache::instance().writeInstances(mw, scratchW.data(), n);
        Shader* b=Shader::get("base"); b->use();
        glBindVertexArray(mw.vao);
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
        glDrawElementsInstanced(GL_TRIANGLES,mw.indices,GL_FLOAT,0,n);
        glBindVertexArray(0);
    }
}
