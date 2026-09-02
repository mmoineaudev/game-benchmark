#include "EventBus.hpp"
#include "CometSystem.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void CometSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) {
    if (cfg.comet <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < cfg.comet; i++) {
        Comet ct;
        ct.pos = VD::Vec3((c.cx+0.1f+0.8f*c.rng.next())*r,
            c.rng.range(-VD::CONTENT_Y_BAND, VD::CONTENT_Y_BAND),
            (c.cz+0.1f+0.8f*c.rng.next())*r);
        ct.vel = VD::Vec3(c.rng.range(-1,1), 0, c.rng.range(-1,1));
        ct.vel = glm::normalize(ct.vel) * c.rng.range(VD::COMET::SPEED_MIN, VD::COMET::SPEED_MAX);
        ct.radius = c.rng.range(VD::COMET::RADIUS_MIN, VD::COMET::RADIUS_MAX);
        ct.hp = VD::COMET::HP;
        ct.chunkKey = c.key;
        comets.push_back(ct);
    }
}
void CometSystem::update(float dt, const VD::Vec3&) {
    for (auto& c : comets) { if (c.active) c.pos += c.vel * dt; }
}
void CometSystem::cleanupChunk(const Chunk& c) {
    comets.erase(std::remove_if(comets.begin(), comets.end(),
        [&](const Comet& x){return x.chunkKey==c.key;}), comets.end());
}
void CometSystem::reset() { comets.clear(); }
void CometSystem::damage(Comet& c, int d) { if(!c.active)return; c.hp-=d; if(c.hp<=0){c.active=false; EventBus::instance().emit(Events::PLAYER_KILLED_ENTITY);} }
void CometSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    auto& m = PW::Cache::instance().comet;
    if (m.vao==0) return;
    int n=0; scratch.resize(comets.size()*9);
    for (auto& c : comets) {
        if (!c.active) continue;
        if (glm::length(c.pos-cam) > VD::INSTANCE_CULL_RADIUS) continue;
        float* o=&scratch[n*9];
        o[0]=c.pos.x;o[1]=c.pos.y;o[2]=c.pos.z;
        o[3]=c.radius;o[4]=c.radius;o[5]=c.radius*1.6f;
        o[6]=0.7f;o[7]=0.8f;o[8]=1.0f;
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
        glUniform3f(uC,1,1,1); glUniform1f(uE,0.6f);
        glUniform3f(uFC,VD::FOG_COLOR.x,VD::FOG_COLOR.y,VD::FOG_COLOR.z);
        glUniform1f(uFD,VD::FOG_DENSITY);
        glUniform3f(uCam,cam.x,cam.y,cam.z);
        glUniform1i(uLC,0);
    }
    glDrawElementsInstanced(GL_TRIANGLES,m.indices,GL_FLOAT,0,n);
    glBindVertexArray(0);
}
