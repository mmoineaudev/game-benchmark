#pragma once
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <cstdint>
#include <cmath>

namespace VD {
using Vec3 = glm::vec3;
using Quat = glm::quat;
using Mat4 = glm::mat4;

inline float lerp(float a, float b, float t) { return a + (b - a) * t; }
inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline float damp(float a, float b, float lambda, float dt) {
    return a + (b - a) * (1.0f - std::exp(-lambda * dt));
}

struct Scratch {
    Vec3 v1, v2, v3;
    Quat q1, q2;
    Mat4 m1;
};
extern Scratch scratch;
} // namespace VD
