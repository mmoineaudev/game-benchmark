#include "StationSystem.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void StationSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3&) {
    if (cfg.station <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < cfg.station; i++) {
        Station s;
        s.pos = VD::Vec3((c.cx+0.5f)*r, c.rng.range(-30, 30), (c.cz+0.5f)*r);
        s.scale = c.rng.range(8, 15);
        s.chunkKey = c.key;
        stations.push_back(s);
    }
}
void StationSystem::update(float, const VD::Vec3&) {}
void StationSystem::cleanupChunk(const Chunk& c) {
    stations.erase(std::remove_if(stations.begin(), stations.end(),
        [&](const Station& s){return s.chunkKey==c.key;}), stations.end());
}
void StationSystem::reset() { stations.clear(); }
void StationSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    auto& m = PW::Cache::instance().station;
    if (m.vao==0) return;
    int n=0; scratch.resize(stations.size()*9);
    for (auto& s : stations) {
        if (!s.active) continue;
        if (glm::length(s.pos-cam) > VD::INSTANCE_CULL_RADIUS) continue;
        float* o=&scratch[n*9];
        o[0]=s.pos.x;o[1]=s.pos.y;o[2]=s.pos.z;
        o[3]=s.scale;o[4]=s.scale*0.6f;o[5]=s.scale;
        o[6]=0.5f;o[7]=0.55f;o[8]=0.6f;
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
