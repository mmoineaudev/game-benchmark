#include "EventBus.hpp"
#include "AsteroidField.hpp"
#include <algorithm>
#include "Constants.hpp"
#include "Shader.hpp"

void AsteroidField::spawnChunk(Chunk& c, const RungConfig& cfg, const VD::Vec3& shipPos) {
    int n = cfg.asteroid;
    if (n <= 0) return;
    float r = VD::CHUNK_SIZE;
    for (int i = 0; i < n; i++) {
        Asteroid a;
        a.pos = VD::Vec3(
            (c.cx + 0.1f + 0.8f * c.rng.next()) * r,
            (c.cy * 100.0f) + c.rng.range(-VD::CONTENT_Y_BAND, VD::CONTENT_Y_BAND),
            (c.cz + 0.1f + 0.8f * c.rng.next()) * r);
        if (glm::length(a.pos - shipPos) < 30.0f)
            a.pos.x += 50.0f;
        float t = c.rng.next();
        if (t < 0.3f) { a.tier = 0; a.hp = VD::ASTEROID::HP_LARGE; a.scale = VD::Vec3(c.rng.range(VD::ASTEROID::R_LARGE_MIN, VD::ASTEROID::R_LARGE_MAX)); }
        else if (t < 0.7f) { a.tier = 1; a.hp = VD::ASTEROID::HP_MED; a.scale = VD::Vec3(c.rng.range(VD::ASTEROID::R_MED_MIN, VD::ASTEROID::R_MED_MAX)); }
        else { a.tier = 2; a.hp = VD::ASTEROID::HP_SML; a.scale = VD::Vec3(c.rng.range(VD::ASTEROID::R_SML_MIN, VD::ASTEROID::R_SML_MAX)); }
        a.color = VD::Vec3(0.45f + 0.2f * c.rng.next(), 0.4f + 0.15f * c.rng.next(), 0.35f + 0.15f * c.rng.next());
        a.rotX = c.rng.range(0, 6.28f);
        a.rotY = c.rng.range(0, 6.28f);
        a.rotZ = c.rng.range(0, 6.28f);
        a.rotSpeed = c.rng.range(-0.3f, 0.3f);
        a.chunkKey = c.key;
        asteroids.push_back(a);
    }
}

void AsteroidField::update(float dt, const VD::Vec3&) {
    for (auto& a : asteroids) {
        if (!a.active) continue;
        a.rotX += a.rotSpeed * dt;
        a.rotY += a.rotSpeed * 0.7f * dt;
    }
}

void AsteroidField::cleanupChunk(const Chunk& c) {
    asteroids.erase(std::remove_if(asteroids.begin(), asteroids.end(),
        [&](const Asteroid& a) { return a.chunkKey == c.key; }), asteroids.end());
}

void AsteroidField::reset() { asteroids.clear(); }

void AsteroidField::damage(Asteroid& a, int dmg) {
    if (!a.active) return;
    a.hp -= dmg;
    if (a.hp <= 0) destroy(a);
}

void AsteroidField::destroy(Asteroid& a) {
    a.active = false;
    EventBus::instance().emit(Events::PLAYER_KILLED_ENTITY);
}

void AsteroidField::render(const VD::Mat4& viewProj, const VD::Vec3& cam) {
    drawAll(viewProj, cam);
}

void AsteroidField::drawAll(const VD::Mat4& vp, const VD::Vec3& cam) {
    auto& m = PW::Cache::instance().asteroid;
    if (m.vao == 0) return;

    int n = 0;
    scratch.resize(asteroids.size() * 9);
    for (auto& a : asteroids) {
        if (!a.active) continue;
        float d = glm::length(a.pos - cam);
        if (d > VD::INSTANCE_CULL_RADIUS) continue;
        float* o = &scratch[n * 9];
        o[0] = a.pos.x; o[1] = a.pos.y; o[2] = a.pos.z;
        o[3] = a.scale.x; o[4] = a.scale.y; o[5] = a.scale.z;
        o[6] = a.color.x; o[7] = a.color.y; o[8] = a.color.z;
        n++;
    }
    if (n == 0) return;

    PW::Cache::instance().writeInstances(m, scratch.data(), n);

    Shader* base = Shader::get("base");
    if (!base) return;
    base->use();
    glBindVertexArray(m.vao);
    glUseProgram(base->program());
    {
        int uVP = Shader::u(base, "uViewProj");
        int uColor = Shader::u(base, "uColor");
        int uEmiss = Shader::u(base, "uEmissive");
        int uFogC = Shader::u(base, "uFogColor");
        int uFogD = Shader::u(base, "uFogDensity");
        int uCam = Shader::u(base, "uCamPos");
        int uLC = Shader::u(base, "uLightCount");
        glUniformMatrix4fv(uVP, 1, GL_FALSE, &vp[0][0]);
        glUniform3f(uColor, 1, 1, 1);
        glUniform1f(uEmiss, 0.0f);
        glUniform3f(uFogC, VD::FOG_COLOR.x, VD::FOG_COLOR.y, VD::FOG_COLOR.z);
        glUniform1f(uFogD, VD::FOG_DENSITY);
        glUniform3f(uCam, cam.x, cam.y, cam.z);
        glUniform1i(uLC, 0);
    }
    glDrawElementsInstanced(GL_TRIANGLES, m.indices, GL_FLOAT, 0, n);
    glBindVertexArray(0);
}
