#pragma once
#include <vector>
#include <string>
#include <array>
#include <GL/glew.h>
#include "Math.hpp"

namespace PW {

struct InstancedMesh {
    GLuint vao = 0;
    GLuint vbo = 0;
    GLuint ibo = 0;
    int indices = 0;
    int stride = 0;
    GLuint instVbo = 0;
    int maxInstances = 0;
};

class Cache {
public:
    static Cache& instance();
    void build(const std::string& shaderDir);
    void dispose();

    InstancedMesh asteroid;
    InstancedMesh comet;
    InstancedMesh deadStar;
    InstancedMesh station;
    InstancedMesh debris;
    InstancedMesh crystal;
    InstancedMesh pulsarCore;
    InstancedMesh hulk;
    InstancedMesh cityRing;
    InstancedMesh cityTower;
    InstancedMesh cityStation;
    InstancedMesh wreck;
    InstancedMesh ring;
    InstancedMesh shard;
    InstancedMesh ship;
    InstancedMesh beamGlow;
    InstancedMesh nebula;
    InstancedMesh disk;

    GLuint fsQuadVao = 0;
    GLuint fsQuadVbo = 0;
    GLuint quadVbo = 0;

    void allocInst(InstancedMesh& m, int maxInst, int strideFloats);
    void writeInstances(InstancedMesh& m, const float* data, int count);

private:
    Cache() = default;
    InstancedMesh makeRock(int subdiv, float radius, int maxInst, int stride);
    void makeSimple(InstancedMesh& m, int maxInst, int strideFloats,
                    const float* verts, const int* idx, int nIdx,
                    const float* normals);
};

} // namespace PW
