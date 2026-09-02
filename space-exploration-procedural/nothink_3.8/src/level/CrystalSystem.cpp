#include "EventBus.hpp"
#include "CrystalSystem.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void CrystalSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3&) {
    if (cfg.crystal <= 0) return;
    float r = VD::CHUNK_SIZE;
    int n = cfg.crystal;
    for (int i = 0; i < n; i++) {
        // clusters of 4-8
        int cx = (int)(c.cx + 0.2f + 0.6f * c.rng.next());
        int cy = (int)c.rng.range(-3, 3);
        int cz = (int)(c.cz + 0.2f + 0.6f * c.rng.next());
        VD::Vec3 center = {(cx + 0.5f) * r, (cy * 20.0f), (cz + 0.5f) * r};
        int clusterN = c.rng.rangeInt(4, 8);
        for (int j = 0; j < clusterN; j++) {
            Crystal cr;
            cr.pos = center + VD::Vec3(
                c.rng.range(-8, 8), c.rng.range(-6, 6), c.rng.range(-8, 8));
            cr.radius = c.rng.range(1.5f, 3.0f);
            cr.hp = VD::CRYSTAL::HP;
            cr.rotPhase = c.rng.range(0, 6.28f);
            cr.chunkKey = c.key;
            crystals.push_back(cr);
        }
    }
}
void CrystalSystem::update(float dt, const VD::Vec3&) {
    for (auto& c : crystals) { if (c.active) c.rotPhase += dt * 0.5f; }
}
void CrystalSystem::cleanupChunk(const Chunk& c) {
    crystals.erase(std::remove_if(crystals.begin(), crystals.end(),
        [&](const Crystal& x){return x.chunkKey==c.key;}), crystals.end());
}
void CrystalSystem::reset() { crystals.clear(); }
void CrystalSystem::damage(Crystal& c, int dmg) {
    if (!c.active) return;
    c.hp -= dmg;
    if (c.hp <= 0) {
        c.active = false;
        EventBus::instance().emit(Events::ENV_CRYSTAL_DESTROYED);
        EventBus::instance().emit(Events::PLAYER_KILLED_ENTITY);
    }
}
void CrystalSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    auto& m = PW::Cache::instance().crystal;
    if (m.vao==0) return;
    int n=0; scratch.resize(crystals.size()*9);
    for (auto& c : crystals) {
        if (!c.active) continue;
        if (glm::length(c.pos-cam) > VD::INSTANCE_CULL_RADIUS) continue;
        float* o=&scratch[n*9];
        o[0]=c.pos.x;o[1]=c.pos.y;o[2]=c.pos.z;
        o[3]=c.radius;o[4]=c.radius*1.4f;o[5]=c.radius;
        o[6]=0.3f;o[7]=0.9f;o[8]=0.7f;
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
        glUniform3f(uC,1,1,1); glUniform1f(uE,1.2f);
        glUniform3f(uFC,VD::FOG_COLOR.x,VD::FOG_COLOR.y,VD::FOG_COLOR.z);
        glUniform1f(uFD,VD::FOG_DENSITY);
        glUniform3f(uCam,cam.x,cam.y,cam.z);
        glUniform1i(uLC,0);
    }
    glDrawElementsInstanced(GL_TRIANGLES,m.indices,GL_FLOAT,0,n);
    glBindVertexArray(0);
}
