#include <algorithm>
#include "StormSystem.hpp"
#include "ProceduralWrecks.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void StormSystem::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3&) {
    if (cfg.storm <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < cfg.storm; i++) {
        StormCloud s;
        s.pos = VD::Vec3((c.cx+0.2f+0.6f*c.rng.next())*r,
            c.rng.range(-20, 20), (c.cz+0.2f+0.6f*c.rng.next())*r);
        s.radius = c.rng.range(VD::STORM::CLOUD_RADIUS_MIN, VD::STORM::CLOUD_RADIUS_MAX);
        s.restrike = c.rng.range(VD::STORM::RESTRIKE_MIN, VD::STORM::RESTRIKE_MAX);
        s.chunkKey = c.key;
        clouds.push_back(s);
    }
}
void StormSystem::update(float dt, const VD::Vec3& shipPos) {
    // Pair clouds within boltDistanceMax
    for (size_t i = 0; i < clouds.size(); i++) {
        auto& a = clouds[i];
        if (!a.active) continue;
        for (size_t j = i+1; j < clouds.size(); j++) {
            auto& b = clouds[j];
            if (!b.active) continue;
            float d = glm::length(a.pos - b.pos);
            if (d > VD::STORM::BOLT_DISTANCE_MAX) continue;
            // Pair found - run state machine on a
            a.timer += dt;
            if (a.state == 0 && a.timer > a.restrike) {
                a.state = 1; a.timer = 0;
                a.restrike = 0;
            } else if (a.state == 1 && a.timer > VD::STORM::TELEGRAPH_TIME) {
                a.state = 2; a.timer = 0;
            } else if (a.state == 2 && a.timer > VD::STORM::BOLT_LIFE) {
                a.state = 0;
                a.timer = 0;
                a.restrike = 0;
                float rng = 1.0f; // simplified
                a.restrike = VD::STORM::RESTRIKE_MIN + (VD::STORM::RESTRIKE_MAX - VD::STORM::RESTRIKE_MIN) * (0.5f + 0.5f * sinf(a.pos.x * 0.1f));
            }
        }
    }
    // Static
    float closest = 1e9f;
    for (auto& c : clouds) {
        if (!c.active) continue;
        float d = glm::length(c.pos - shipPos);
        if (d < closest) closest = d;
    }
    if (closest < VD::STORM::STATIC_RANGE) {
        staticActive = true;
        staticIntensity = closest < VD::STORM::STATIC_RANGE_INTENSE ? 0.08f : 0.04f;
    } else {
        staticActive = false;
        staticIntensity = 0;
    }
}
void StormSystem::cleanupChunk(const Chunk& c) {
    clouds.erase(std::remove_if(clouds.begin(), clouds.end(),
        [&](const StormCloud& x){return x.chunkKey==c.key;}), clouds.end());
}
void StormSystem::reset() { clouds.clear(); }

int StormSystem::strikeDamage(const VD::Vec3& shipPos) const {
    int dmg = 0;
    for (auto& a : clouds) {
        if (!a.active || a.state != 2) continue;
        for (auto& b : clouds) {
            if (!b.active || &b == &a) continue;
            float d = glm::length(a.pos - b.pos);
            if (d > VD::STORM::BOLT_DISTANCE_MAX) continue;
            // Ship near bolt segment
            VD::Vec3 ab = b.pos - a.pos;
            VD::Vec3 as = shipPos - a.pos;
            float t = glm::clamp(glm::dot(as, ab) / std::max(glm::dot(ab,ab),0.01f), 0.0f, 1.0f);
            VD::Vec3 closest = a.pos + ab * t;
            if (glm::length(shipPos - closest) < VD::STORM::STRIKE_RADIUS) {
                dmg += VD::STORM::STRIKE_DAMAGE;
            }
        }
    }
    return dmg;
}

void StormSystem::setStatic(bool a, float i) { (void)a; (void)i; }

void StormSystem::render(const VD::Mat4& vp, const VD::Vec3& cam) {    // Storm clouds as dark billboards
    auto& m = PW::Cache::instance().station; // reuse box geometry
    if (m.vao==0) return;
    int n=0; scratch.resize(clouds.size()*9);
    for (auto& c : clouds) {
        if (!c.active) continue;
        if (glm::length(c.pos-cam) > VD::INSTANCE_CULL_RADIUS) continue;
        float* o=&scratch[n*9];
        o[0]=c.pos.x;o[1]=c.pos.y;o[2]=c.pos.z;
        o[3]=c.radius;o[4]=c.radius*0.7f;o[5]=c.radius;
        o[6]=0.1f;o[7]=0.05f;o[8]=0.15f;
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
        glUniform3f(uC,1,1,1); glUniform1f(uE,0.3f);
        glUniform3f(uFC,VD::FOG_COLOR.x,VD::FOG_COLOR.y,VD::FOG_COLOR.z);
        glUniform1f(uFD,VD::FOG_DENSITY);
        glUniform3f(uCam,cam.x,cam.y,cam.z);
        glUniform1i(uLC,0);
    }
    glDrawElementsInstanced(GL_TRIANGLES,m.indices,GL_UNSIGNED_INT,0,n);
    glBindVertexArray(0);
}
