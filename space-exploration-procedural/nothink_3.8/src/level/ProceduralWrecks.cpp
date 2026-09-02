#include "ProceduralWrecks.hpp"
#include <cstdio>
#include <cmath>

namespace PW {

Cache& Cache::instance() { static Cache c; return c; }

static VD::Vec3 normalize(const VD::Vec3& v) { return glm::normalize(v); }

// Build a subdivided icosphere as a rock.
static void buildIcoSphere(std::vector<float>& verts, std::vector<float>& normals,
                           std::vector<float>& idx, float radius, int subdiv, float jitter) {
    float t = (1.0f + std::sqrt(5.0f)) / 2.0f;
    std::vector<VD::Vec3> v = {
        VD::Vec3(-1,t,0),VD::Vec3(1,t,0),VD::Vec3(-1,-t,0),VD::Vec3(1,-t,0),
        VD::Vec3(t,0,-1),VD::Vec3(t,0,1),VD::Vec3(-t,0,-1),VD::Vec3(-t,0,1),
        VD::Vec3(0,-1,t),VD::Vec3(0,1,t),VD::Vec3(0,-1,-t),VD::Vec3(0,1,-t)
    };
    for (auto& x : v) x = glm::normalize(x) * radius;
    struct Face { int a,b,c; };
    std::vector<Face> faces = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,7}
    };
    for (int s = 0; s < subdiv; s++) {
        std::vector<Face> nf;
        for (auto& fc : faces) {
            int m_ab = (int)v.size();
            VD::Vec3 ab = glm::normalize((v[fc.a] + v[fc.b]) * 0.5f) * radius;
            VD::Vec3 bc = glm::normalize((v[fc.b] + v[fc.c]) * 0.5f) * radius;
            VD::Vec3 ca = glm::normalize((v[fc.c] + v[fc.a]) * 0.5f) * radius;
            v.push_back(ab); v.push_back(bc); v.push_back(ca);
            nf.push_back({fc.a, m_ab, m_ab+1});
            nf.push_back({fc.b, m_ab+1, m_ab+2});
            nf.push_back({fc.c, m_ab+2, m_ab});
            nf.push_back({m_ab, m_ab+1, m_ab+2});
        }
        faces = nf;
    }
    verts.reserve(v.size() * 3);
    normals.reserve(v.size() * 3);
    for (auto& p : v) {
        VD::Vec3 n = glm::normalize(p);
        verts.push_back(p.x); verts.push_back(p.y); verts.push_back(p.z);
        normals.push_back(n.x); normals.push_back(n.y); normals.push_back(n.z);
    }
    for (auto& fc : faces) {
        idx.push_back((float)fc.a); idx.push_back((float)fc.b); idx.push_back((float)fc.c);
    }
}

void Cache::allocInst(InstancedMesh& m, int maxInst, int strideFloats) {
    m.maxInstances = maxInst;
    m.stride = strideFloats;
    if (m.instVbo) glDeleteBuffers(1, &m.instVbo);
    glGenBuffers(1, &m.instVbo);
    glBindBuffer(GL_ARRAY_BUFFER, m.instVbo);
    glBufferData(GL_ARRAY_BUFFER, maxInst * strideFloats * sizeof(float), nullptr, GL_DYNAMIC_DRAW);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
}

void Cache::writeInstances(InstancedMesh& m, const float* data, int count) {
    if (count <= 0) return;
    glBindBuffer(GL_ARRAY_BUFFER, m.instVbo);
    glBufferSubData(GL_ARRAY_BUFFER, 0, count * m.stride * sizeof(float), data);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
}

void Cache::build(const std::string&) {    // Common quad corners (billboard, per-vertex)
    float quad[8] = { -0.5f,-0.5f, 0.5f,-0.5f, 0.5f,0.5f, -0.5f,0.5f };    glGenBuffers(1, &quadVbo);        glBindBuffer(GL_ARRAY_BUFFER, quadVbo);
        glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);
    
    // Fullscreen quad
    float fsq[8] = { -1,-1, 1,-1, 1,1, -1,1 };
    glGenBuffers(1, &fsQuadVbo);
    glBindBuffer(GL_ARRAY_BUFFER, fsQuadVbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(fsq), fsq, GL_STATIC_DRAW);
    glGenVertexArrays(1, &fsQuadVao);
    glBindVertexArray(fsQuadVao);
    glBindBuffer(GL_ARRAY_BUFFER, fsQuadVbo);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, (void*)0);
    glBindVertexArray(0);

    // ---- Asteroid: subdivided icosphere rock ----
    {
        std::vector<float> verts, normals, idx;
        buildIcoSphere(verts, normals, idx, 1.0f, 1, 0.3f);
        asteroid.indices = (int)idx.size();
        asteroid.maxInstances = 4096;
        asteroid.stride = 9; // offset3 + scale3 + color3 (yaw/pitch folded into scale-free)
        // add normals
        // rebuild verts with normals interleaved: pos(3)+norm(3)
        std::vector<float> interleaved;
        for (size_t i = 0; i < verts.size() / 3; i++) {
            interleaved.insert(interleaved.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            interleaved.insert(interleaved.end(), normals.begin()+i*3, normals.begin()+i*3+3);
        }
        asteroid.vbo = 0; asteroid.ibo = 0; asteroid.instVbo = 0;
        glGenBuffers(1, &asteroid.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, asteroid.vbo);
        glBufferData(GL_ARRAY_BUFFER, interleaved.size()*sizeof(float), interleaved.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &asteroid.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, asteroid.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, idx.size()*sizeof(float), idx.data(), GL_STATIC_DRAW);
        glGenVertexArrays(1, &asteroid.vao);
        glBindVertexArray(asteroid.vao);
        glBindBuffer(GL_ARRAY_BUFFER, asteroid.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, asteroid.ibo);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1);
        glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        // instance attrs
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(asteroid, asteroid.maxInstances, asteroid.stride);
        glBindVertexArray(0);
    }

    // ---- Comet: elongated rock (scale via instance) ----
    {
        std::vector<float> verts, normals, idx;
        buildIcoSphere(verts, normals, idx, 1.0f, 1, 0.15f);
        std::vector<float> inter;
        for (size_t i = 0; i < verts.size()/3; i++) {
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), normals.begin()+i*3, normals.begin()+i*3+3);
        }
        comet.indices = (int)idx.size();
        comet.maxInstances = 256;
        comet.stride = 9;
        glGenBuffers(1, &comet.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, comet.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &comet.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, comet.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, idx.size()*sizeof(float), idx.data(), GL_STATIC_DRAW);
        glGenVertexArrays(1, &comet.vao);
        glBindVertexArray(comet.vao);
        glBindBuffer(GL_ARRAY_BUFFER, comet.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, comet.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(comet, comet.maxInstances, comet.stride);
        glBindVertexArray(0);
    }

    // ---- Debris: small tetra-ish rock ----
    {
        std::vector<float> verts, normals, idx;
        buildIcoSphere(verts, normals, idx, 1.0f, 0, 0.4f);
        std::vector<float> inter;
        for (size_t i = 0; i < verts.size()/3; i++) {
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), normals.begin()+i*3, normals.begin()+i*3+3);
        }
        debris.indices = (int)idx.size();
        debris.maxInstances = 2048;
        debris.stride = 9;
        glGenBuffers(1, &debris.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, debris.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &debris.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, debris.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, idx.size()*sizeof(float), idx.data(), GL_STATIC_DRAW);
        glGenVertexArrays(1, &debris.vao);
        glBindVertexArray(debris.vao);
        glBindBuffer(GL_ARRAY_BUFFER, debris.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, debris.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(debris, debris.maxInstances, debris.stride);
        glBindVertexArray(0);
    }

    // ---- Crystal: octahedron ----
    {
        VD::Vec3 v[6] = {{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
        int idx[8][3] = {{0,2,4},{2,1,4},{1,3,4},{3,0,4},{2,0,5},{0,1,5},{1,3,5},{3,2,5}};
        std::vector<float> verts, normals;
        for (auto& p : v) {
            VD::Vec3 n = normalize(p);
            verts.push_back(p.x); verts.push_back(p.y); verts.push_back(p.z);
            normals.push_back(n.x); normals.push_back(n.y); normals.push_back(n.z);
        }
        std::vector<float> inter;
        for (int i = 0; i < 6; i++) {
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), normals.begin()+i*3, normals.begin()+i*3+3);
        }
        std::vector<float> idxf(idx[0], idx[0]+24);
        crystal.indices = 24;
        crystal.maxInstances = 1024;
        crystal.stride = 9;
        glGenBuffers(1, &crystal.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, crystal.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &crystal.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, crystal.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, 24*sizeof(float), idxf.data(), GL_STATIC_DRAW);
        glGenVertexArrays(1, &crystal.vao);
        glBindVertexArray(crystal.vao);
        glBindBuffer(GL_ARRAY_BUFFER, crystal.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, crystal.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(crystal, crystal.maxInstances, crystal.stride);
        glBindVertexArray(0);
    }

    // ---- Dead star: small icosphere ----
    {
        std::vector<float> verts, normals, idx;
        buildIcoSphere(verts, normals, idx, 1.0f, 1, 0.05f);
        std::vector<float> inter;
        for (size_t i = 0; i < verts.size()/3; i++) {
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), normals.begin()+i*3, normals.begin()+i*3+3);
        }
        deadStar.indices = (int)idx.size();
        deadStar.maxInstances = 512;
        deadStar.stride = 9;
        glGenBuffers(1, &deadStar.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, deadStar.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &deadStar.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, deadStar.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, idx.size()*sizeof(float), idx.data(), GL_STATIC_DRAW);
        glGenVertexArrays(1, &deadStar.vao);
        glBindVertexArray(deadStar.vao);
        glBindBuffer(GL_ARRAY_BUFFER, deadStar.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, deadStar.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(deadStar, deadStar.maxInstances, deadStar.stride);
        glBindVertexArray(0);
    }

    // ---- Station: box ----
    {
        float bv[49] = {
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5,
            -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,0.5,-0.5, -0.5,0.5,-0.5
        };
        int bi[36] = {0,2,1, 1,2,3, 0,4,6, 6,2,0, 7,5,3, 3,2,7, 0,1,5, 4,0,5, 7,3,6, 2,7,6, 4,6,2, 1,4,2};
        (void)bi;
        std::vector<float> verts(bv, bv+24);
        std::vector<float> normals;
        float nn[8][3] = {{0,0,-1},{0,0,-1},{0,0,-1},{0,0,-1},{0,0,1},{0,0,1},{0,0,1},{0,0,1}};
        for (int i = 0; i < 8; i++) for (int j = 0; j < 3; j++) normals.push_back(nn[i][j]);
        (void)normals;
        // Simple: use per-vertex normal from position sign
        std::vector<float> inter;
        for (int i = 0; i < 8; i++) {
            VD::Vec3 p = {bv[i*3], bv[i*3+1], bv[i*3+2]};
            VD::Vec3 n = normalize(p);
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), {n.x, n.y, n.z});
        }
        int boxIdx[36] = {
            0,1,2, 0,2,3, 4,5,6, 4,6,7,
            0,4,5, 5,1,0, 2,6,7, 7,3,2,
            0,3,7, 7,4,0, 1,5,6, 6,2,1
        };
        station.indices = 36;
        station.maxInstances = 256;
        station.stride = 9;
        glGenBuffers(1, &station.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, station.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &station.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, station.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, 36*sizeof(float), boxIdx, GL_STATIC_DRAW);
        glGenVertexArrays(1, &station.vao);
        glBindVertexArray(station.vao);
        glBindBuffer(GL_ARRAY_BUFFER, station.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, station.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(station, station.maxInstances, station.stride);
        glBindVertexArray(0);
    }

    // ---- Pulsar core: tall icosphere ----
    {
        std::vector<float> verts, normals, idx;
        buildIcoSphere(verts, normals, idx, 1.0f, 1, 0.02f);
        std::vector<float> inter;
        for (size_t i = 0; i < verts.size()/3; i++) {
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), normals.begin()+i*3, normals.begin()+i*3+3);
        }
        pulsarCore.indices = (int)idx.size();
        pulsarCore.maxInstances = 128;
        pulsarCore.stride = 9;
        glGenBuffers(1, &pulsarCore.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, pulsarCore.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &pulsarCore.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, pulsarCore.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, idx.size()*sizeof(float), idx.data(), GL_STATIC_DRAW);
        glGenVertexArrays(1, &pulsarCore.vao);
        glBindVertexArray(pulsarCore.vao);
        glBindBuffer(GL_ARRAY_BUFFER, pulsarCore.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, pulsarCore.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(pulsarCore, pulsarCore.maxInstances, pulsarCore.stride);
        glBindVertexArray(0);
    }

    // ---- Hulk: box (wreck hull) ----
    {
        float bv[49] = {
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5,
            -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,0.5,-0.5, -0.5,0.5,-0.5
        };
        std::vector<float> verts(bv, bv+24);
        std::vector<float> inter;
        for (int i = 0; i < 8; i++) {
            VD::Vec3 p = {bv[i*3], bv[i*3+1], bv[i*3+2]};
            VD::Vec3 n = normalize(p);
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), {n.x, n.y, n.z});
        }
        int boxIdx[36] = {
            0,1,2, 0,2,3, 4,5,6, 4,6,7,
            0,4,5, 5,1,0, 2,6,7, 7,3,2,
            0,3,7, 7,4,0, 1,5,6, 6,2,1
        };
        hulk.indices = 36;
        hulk.maxInstances = 512;
        hulk.stride = 9;
        glGenBuffers(1, &hulk.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, hulk.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &hulk.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, hulk.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, 36*sizeof(float), boxIdx, GL_STATIC_DRAW);
        glGenVertexArrays(1, &hulk.vao);
        glBindVertexArray(hulk.vao);
        glBindBuffer(GL_ARRAY_BUFFER, hulk.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, hulk.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(hulk, hulk.maxInstances, hulk.stride);
        glBindVertexArray(0);
    }

    // ---- City ring: torus segment (approx: box ring) ----
    // Use a box for simplicity, scaled into a ring segment
    {
        float bv[49] = {
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5,
            -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,0.5,-0.5, -0.5,0.5,-0.5
        };
        std::vector<float> verts(bv, bv+24);
        std::vector<float> inter;
        for (int i = 0; i < 8; i++) {
            VD::Vec3 p = {bv[i*3], bv[i*3+1], bv[i*3+2]};
            VD::Vec3 n = normalize(p);
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), {n.x, n.y, n.z});
        }
        int boxIdx[36] = {
            0,1,2, 0,2,3, 4,5,6, 4,6,7,
            0,4,5, 5,1,0, 2,6,7, 7,3,2,
            0,3,7, 7,4,0, 1,5,6, 6,2,1
        };
        cityRing.indices = 36;
        cityRing.maxInstances = 256;
        cityRing.stride = 9;
        glGenBuffers(1, &cityRing.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, cityRing.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &cityRing.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, cityRing.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, 36*sizeof(float), boxIdx, GL_STATIC_DRAW);
        glGenVertexArrays(1, &cityRing.vao);
        glBindVertexArray(cityRing.vao);
        glBindBuffer(GL_ARRAY_BUFFER, cityRing.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, cityRing.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(cityRing, cityRing.maxInstances, cityRing.stride);
        glBindVertexArray(0);
    }

    // ---- City tower: tall box ----
    {
        float bv[49] = {
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5,
            -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,0.5,-0.5, -0.5,0.5,-0.5
        };
        std::vector<float> verts(bv, bv+24);
        std::vector<float> inter;
        for (int i = 0; i < 8; i++) {
            VD::Vec3 p = {bv[i*3], bv[i*3+1], bv[i*3+2]};
            VD::Vec3 n = normalize(p);
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), {n.x, n.y, n.z});
        }
        int boxIdx[36] = {
            0,1,2, 0,2,3, 4,5,6, 4,6,7,
            0,4,5, 5,1,0, 2,6,7, 7,3,2,
            0,3,7, 7,4,0, 1,5,6, 6,2,1
        };
        cityTower.indices = 36;
        cityTower.maxInstances = 512;
        cityTower.stride = 9;
        glGenBuffers(1, &cityTower.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, cityTower.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &cityTower.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, cityTower.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, 36*sizeof(float), boxIdx, GL_STATIC_DRAW);
        glGenVertexArrays(1, &cityTower.vao);
        glBindVertexArray(cityTower.vao);
        glBindBuffer(GL_ARRAY_BUFFER, cityTower.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, cityTower.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(cityTower, cityTower.maxInstances, cityTower.stride);
        glBindVertexArray(0);
    }

    // ---- City station: box ----
    {
        float bv[49] = {
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5,
            -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,0.5,-0.5, -0.5,0.5,-0.5
        };
        std::vector<float> verts(bv, bv+24);
        std::vector<float> inter;
        for (int i = 0; i < 8; i++) {
            VD::Vec3 p = {bv[i*3], bv[i*3+1], bv[i*3+2]};
            VD::Vec3 n = normalize(p);
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), {n.x, n.y, n.z});
        }
        int boxIdx[36] = {
            0,1,2, 0,2,3, 4,5,6, 4,6,7,
            0,4,5, 5,1,0, 2,6,7, 7,3,2,
            0,3,7, 7,4,0, 1,5,6, 6,2,1
        };
        cityStation.indices = 36;
        cityStation.maxInstances = 256;
        cityStation.stride = 9;
        glGenBuffers(1, &cityStation.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, cityStation.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &cityStation.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, cityStation.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, 36*sizeof(float), boxIdx, GL_STATIC_DRAW);
        glGenVertexArrays(1, &cityStation.vao);
        glBindVertexArray(cityStation.vao);
        glBindBuffer(GL_ARRAY_BUFFER, cityStation.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, cityStation.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(cityStation, cityStation.maxInstances, cityStation.stride);
        glBindVertexArray(0);
    }

    // ---- Wreck: box ----
    {
        float bv[49] = {
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5,
            -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,0.5,-0.5, -0.5,0.5,-0.5
        };
        std::vector<float> verts(bv, bv+24);
        std::vector<float> inter;
        for (int i = 0; i < 8; i++) {
            VD::Vec3 p = {bv[i*3], bv[i*3+1], bv[i*3+2]};
            VD::Vec3 n = normalize(p);
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), {n.x, n.y, n.z});
        }
        int boxIdx[36] = {
            0,1,2, 0,2,3, 4,5,6, 4,6,7,
            0,4,5, 5,1,0, 2,6,7, 7,3,2,
            0,3,7, 7,4,0, 1,5,6, 6,2,1
        };
        wreck.indices = 36;
        wreck.maxInstances = 256;
        wreck.stride = 9;
        glGenBuffers(1, &wreck.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, wreck.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &wreck.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, wreck.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, 36*sizeof(float), boxIdx, GL_STATIC_DRAW);
        glGenVertexArrays(1, &wreck.vao);
        glBindVertexArray(wreck.vao);
        glBindBuffer(GL_ARRAY_BUFFER, wreck.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, wreck.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(wreck, wreck.maxInstances, wreck.stride);
        glBindVertexArray(0);
    }

    // ---- Ring: billboard ring mesh ----
    {
        ring.maxInstances = 64;
        ring.stride = 8; // pos3 + size + phase + type + alive + color(2)
        // Use quad corners from shared quadVbo; ring is drawn via beacon shader
        ring.vao = 0; ring.vbo = 0; ring.ibo = 0; ring.indices = 0;
        // (drawn via beacon shader, no per-vertex geometry needed)
        allocInst(ring, ring.maxInstances, ring.stride);
    }

    // ---- Shard: small tetra ----
    {
        std::vector<float> verts, normals, idx;
        buildIcoSphere(verts, normals, idx, 1.0f, 0, 0.2f);
        std::vector<float> inter;
        for (size_t i = 0; i < verts.size()/3; i++) {
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), normals.begin()+i*3, normals.begin()+i*3+3);
        }
        shard.indices = (int)idx.size();
        shard.maxInstances = 64;
        shard.stride = 9;
        glGenBuffers(1, &shard.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, shard.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &shard.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, shard.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, idx.size()*sizeof(float), idx.data(), GL_STATIC_DRAW);
        glGenVertexArrays(1, &shard.vao);
        glBindVertexArray(shard.vao);
        glBindBuffer(GL_ARRAY_BUFFER, shard.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, shard.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(shard, shard.maxInstances, shard.stride);
        glBindVertexArray(0);
    }

    // ---- Ship: box (simplified) ----
    {
        float bv[49] = {
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5,
            -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
            -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,0.5,-0.5, -0.5,0.5,-0.5
        };
        std::vector<float> verts(bv, bv+24);
        std::vector<float> inter;
        for (int i = 0; i < 8; i++) {
            VD::Vec3 p = {bv[i*3], bv[i*3+1], bv[i*3+2]};
            VD::Vec3 n = normalize(p);
            inter.insert(inter.end(), verts.begin()+i*3, verts.begin()+i*3+3);
            inter.insert(inter.end(), {n.x, n.y, n.z});
        }
        int boxIdx[36] = {
            0,1,2, 0,2,3, 4,5,6, 4,6,7,
            0,4,5, 5,1,0, 2,6,7, 7,3,2,
            0,3,7, 7,4,0, 1,5,6, 6,2,1
        };
        ship.indices = 36;
        ship.maxInstances = 1;
        ship.stride = 9;
        glGenBuffers(1, &ship.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, ship.vbo);
        glBufferData(GL_ARRAY_BUFFER, inter.size()*sizeof(float), inter.data(), GL_STATIC_DRAW);
        glGenBuffers(1, &ship.ibo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ship.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, 36*sizeof(float), boxIdx, GL_STATIC_DRAW);
        glGenVertexArrays(1, &ship.vao);
        glBindVertexArray(ship.vao);
        glBindBuffer(GL_ARRAY_BUFFER, ship.vbo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ship.ibo);
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void*)0);
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void*)12);
        for (int i = 0; i < 9; i++) {
            glEnableVertexAttribArray(2+i);
            glVertexAttribPointer(2+i, 3, GL_FLOAT, GL_FALSE, 36, (void*)(i*12));
            glVertexAttribDivisor(2+i, 1);
        }
        allocInst(ship, ship.maxInstances, ship.stride);
        glBindVertexArray(0);
    }

    // ---- Beam glow: billboard ----
    {
        beamGlow.maxInstances = 256;
        beamGlow.stride = 8;
        beamGlow.vao = 0; beamGlow.vbo = 0; beamGlow.ibo = 0; beamGlow.indices = 0;
        allocInst(beamGlow, beamGlow.maxInstances, beamGlow.stride);
    }

    // ---- Nebula: billboard quad ----
    {
        nebula.maxInstances = 256;
        nebula.stride = 8;
        nebula.vao = 0; nebula.vbo = 0; nebula.ibo = 0; nebula.indices = 0;
        allocInst(nebula, nebula.maxInstances, nebula.stride);
    }

    // ---- Disk: billboard ring (drawn via disk shader) ----
    {
        disk.maxInstances = 64;
        disk.stride = 8;
        disk.vao = 0; disk.vbo = 0; disk.ibo = 0; disk.indices = 0;
        allocInst(disk, disk.maxInstances, disk.stride);
    }}

void Cache::dispose() {
    auto del = [](InstancedMesh& m) {
        if (m.vao) glDeleteVertexArrays(1, &m.vao);
        if (m.vbo) glDeleteBuffers(1, &m.vbo);
        if (m.ibo) glDeleteBuffers(1, &m.ibo);
        if (m.instVbo) glDeleteBuffers(1, &m.instVbo);
    };
    del(asteroid); del(comet); del(deadStar); del(station); del(debris);
    del(crystal); del(pulsarCore); del(hulk); del(cityRing); del(cityTower);
    del(cityStation); del(wreck); del(ring); del(shard); del(ship);
    del(beamGlow); del(nebula); del(disk);
    if (quadVbo) glDeleteBuffers(1, &quadVbo);
    if (fsQuadVbo) glDeleteBuffers(1, &fsQuadVbo);
    if (fsQuadVao) glDeleteVertexArrays(1, &fsQuadVao);
}

} // namespace PW
