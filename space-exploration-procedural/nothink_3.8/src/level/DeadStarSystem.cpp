#include "DeadStarSystem.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void DeadStarSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3&) {
    if (cfg.deadStar <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < cfg.deadStar; i++) {
        DeadStar s;
        s.pos = VD::Vec3((c.cx+0.1f+0.8f*c.rng.next())*r,
            c.rng.range(-VD::CONTENT_Y_BAND, VD::CONTENT_Y_BAND),
            (c.cz+0.1f+0.8f*c.rng.next())*r);
        s.radius = c.rng.range(VD::DEADSTAR::RADIUS_MIN, VD::DEADSTAR::RADIUS_MAX);
        s.phase = c.rng.range(0, 6.28f);
        s.chunkKey = c.key;
        stars.push_back(s);
    }
}
void DeadStarSystem::update(float, const VD::Vec3&) {}
void DeadStarSystem::cleanupChunk(const Chunk& c) {
    stars.erase(std::remove_if(stars.begin(), stars.end(),
        [&](const DeadStar& s){return s.chunkKey==c.key;}), stars.end());
}
void DeadStarSystem::reset() { stars.clear(); }
void DeadStarSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    auto& m = PW::Cache::instance().deadStar;
    if (m.vao==0) return;
    int n=0; scratch.resize(stars.size()*9);
    for (auto& s : stars) {
        if (!s.active) continue;
        if (glm::length(s.pos-cam) > VD::INSTANCE_CULL_RADIUS) continue;
        float* o=&scratch[n*9];
        o[0]=s.pos.x;o[1]=s.pos.y;o[2]=s.pos.z;
        o[3]=s.radius;o[4]=s.radius;o[5]=s.radius;
        o[6]=0.6f;o[7]=0.2f;o[8]=0.1f;
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
        glUniform3f(uC,1,1,1); glUniform1f(uE,1.5f);
        glUniform3f(uFC,VD::FOG_COLOR.x,VD::FOG_COLOR.y,VD::FOG_COLOR.z);
        glUniform1f(uFD,VD::FOG_DENSITY);
        glUniform3f(uCam,cam.x,cam.y,cam.z);
        glUniform1i(uLC,0);
    }
    glDrawElementsInstanced(GL_TRIANGLES,m.indices,GL_UNSIGNED_INT,0,n);
    glBindVertexArray(0);
}
