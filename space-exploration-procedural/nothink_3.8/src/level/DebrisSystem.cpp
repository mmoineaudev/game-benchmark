#include "EventBus.hpp"
#include "DebrisSystem.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void DebrisSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3&) {
    if (cfg.debris <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < cfg.debris; i++) {
        Debris d;
        d.pos = VD::Vec3((c.cx+0.1f+0.8f*c.rng.next())*r,
            c.rng.range(-VD::CONTENT_Y_BAND, VD::CONTENT_Y_BAND),
            (c.cz+0.1f+0.8f*c.rng.next())*r);
        d.vel = VD::Vec3(c.rng.range(-0.5,0.5), c.rng.range(-0.2,0.2), c.rng.range(-0.5,0.5));
        d.radius = c.rng.range(VD::DEBRIS::RADIUS_MIN, VD::DEBRIS::RADIUS_MAX);
        d.hp = VD::DEBRIS::HP;
        d.chunkKey = c.key;
        debris.push_back(d);
    }
}
void DebrisSystem::update(float dt, const VD::Vec3&) {
    for (auto& d : debris) { if (d.active) d.pos += d.vel * dt; }
}
void DebrisSystem::cleanupChunk(const Chunk& c) {
    debris.erase(std::remove_if(debris.begin(), debris.end(),
        [&](const Debris& d){return d.chunkKey==c.key;}), debris.end());
}
void DebrisSystem::reset() { debris.clear(); }
void DebrisSystem::damage(Debris& d, int dmg) { if(!d.active)return; d.hp-=dmg; if(d.hp<=0){d.active=false; EventBus::instance().emit(Events::PLAYER_KILLED_ENTITY);} }
void DebrisSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    auto& m = PW::Cache::instance().debris;
    if (m.vao==0) return;
    int n=0; scratch.resize(debris.size()*9);
    for (auto& d : debris) {
        if (!d.active) continue;
        if (glm::length(d.pos-cam) > VD::INSTANCE_CULL_RADIUS) continue;
        float* o=&scratch[n*9];
        o[0]=d.pos.x;o[1]=d.pos.y;o[2]=d.pos.z;
        o[3]=d.radius;o[4]=d.radius;o[5]=d.radius;
        o[6]=0.4f;o[7]=0.35f;o[8]=0.3f;
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
