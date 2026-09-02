#pragma once
#include <cmath>
#include <random>
#include <algorithm>
#include <array>
#include <numeric>

namespace SH {

// ==================== Vec2 ====================

struct Vec2 {
    float x = 0.0f, y = 0.0f;
    Vec2() = default;
    constexpr Vec2(float x, float y) : x(x), y(y) {}
    Vec2 operator+(const Vec2& o) const { return {x + o.x, y + o.y}; }
    Vec2 operator-(const Vec2& o) const { return {x - o.x, y - o.y}; }
    Vec2 operator*(float s) const { return {x * s, y * s}; }
    float len() const { return std::sqrt(x * x + y * y); }
};

// ==================== Vec3 ====================

struct Vec3 {
    float x = 0.0f, y = 0.0f, z = 0.0f;

    Vec3() = default;
    constexpr Vec3(float x, float y, float z) : x(x), y(y), z(z) {}
    Vec3(int ix, int iy, int iz) : x(static_cast<float>(ix)), y(static_cast<float>(iy)), z(static_cast<float>(iz)) {}
    Vec3(std::initializer_list<float> init) : x(0), y(0), z(0) {
        auto it = init.begin();
        if (it != init.end()) x = *it++;
        if (it != init.end()) y = *it++;
        if (it != init.end()) z = *it++;
    }

    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
    Vec3 operator/(float s) const { float inv = 1.0f / s; return {x * inv, y * inv, z * inv}; }
    Vec3 operator-() const { return {-x, -y, -z}; }

    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
    Vec3& operator*=(float s) { x *= s; y *= s; z *= s; return *this; }

    float len() const { return std::sqrt(x * x + y * y + z * z); }
    float lenSq() const { return x * x + y * y + z * z; }
    Vec3 norm() const { float l = len(); return l > 0.0f ? *this / l : Vec3{}; }
    float dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }
    Vec3 cross(const Vec3& o) const {
        return {y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x};
    }

    float& operator[](size_t i) { return (&x)[i]; }
    const float& operator[](size_t i) const { return (&x)[i]; }
};

inline Vec3 lerp(const Vec3& a, const Vec3& b, float t) {
    t = std::clamp(t, 0.0f, 1.0f);
    return {a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t};
}

inline Vec3 operator*(float s, const Vec3& v) { return v * s; }

inline bool operator==(const Vec3& a, const Vec3& b) {
    return std::abs(a.x - b.x) < 1e-5f && std::abs(a.y - b.y) < 1e-5f && std::abs(a.z - b.z) < 1e-5f;
}

inline bool operator!=(const Vec3& a, const Vec3& b) {
    return !(a.x == b.x && a.y == b.y && a.z == b.z);
}

// ==================== Quat ====================

struct Quat {
    float x = 0.0f, y = 0.0f, z = 0.0f, w = 1.0f;

    Quat() = default;
    constexpr Quat(float x, float y, float z, float w) : x(x), y(y), z(z), w(w) {}

    Quat operator*(const Quat& o) const {
        return {
            w * o.x + x * o.w + y * o.z - z * o.y,
            w * o.y - x * o.z + y * o.w + z * o.x,
            w * o.z + x * o.y - y * o.x + z * o.w,
            w * o.w - x * o.x - y * o.y - z * o.z
        };
    }

    Quat& operator*=(const Quat& o) { *this = *this * o; return *this; }

    Vec3 apply(const Vec3& v) const {
        float cx = 2.0f * (y * v.z - z * v.y);
        float cy = 2.0f * (z * v.x - x * v.z);
        float cz = 2.0f * (x * v.y - y * v.x);
        return {
            v.x + w * cx + (y * cz - z * cy),
            v.y + w * cy + (z * cx - x * cz),
            v.z + w * cz + (x * cy - y * cx)
        };
    }

    static Quat fromEuler(float pitch, float yaw, float roll) {
        float cp2 = std::cos(pitch * 0.5f), sp2 = std::sin(pitch * 0.5f);
        float cy2 = std::cos(yaw * 0.5f), sy2 = std::sin(yaw * 0.5f);
        float cr2 = std::cos(roll * 0.5f), sr2 = std::sin(roll * 0.5f);
        return {
            sp2 * cy2 * cr2 + cp2 * sy2 * sr2,
            cp2 * sy2 * cr2 - sp2 * cy2 * sr2,
            cp2 * cy2 * sr2 + sp2 * sy2 * cr2,
            cp2 * cy2 * cr2 - sp2 * sy2 * sr2
        };
    }

    static Quat identity() { return Quat{0, 0, 0, 1}; }
};

// ==================== Mat4 ====================

struct Mat4 {
    float m[16]{};

    Mat4() = default;

    static Mat4 identity() {
        Mat4 m;
        m.m[0] = m.m[5] = m.m[10] = m.m[15] = 1.0f;
        return m;
    }

    static Mat4 translation(const Vec3& t) {
        Mat4 m = identity();
        m.m[12] = t.x; m.m[13] = t.y; m.m[14] = t.z;
        return m;
    }

    static Mat4 scaling(const Vec3& s) {
        Mat4 m = identity();
        m.m[0] = s.x; m.m[5] = s.y; m.m[10] = s.z;
        return m;
    }

    static Mat4 rotation(const Quat& q) {
        Mat4 m = identity();
        float xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
        float xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
        float wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
        m.m[0] = 1.0f - 2.0f * (yy + zz);
        m.m[1] = 2.0f * (xy + wz);
        m.m[2] = 2.0f * (xz - wy);
        m.m[4] = 2.0f * (xy - wz);
        m.m[5] = 1.0f - 2.0f * (xx + zz);
        m.m[6] = 2.0f * (yz + wx);
        m.m[8] = 2.0f * (xz + wy);
        m.m[9] = 2.0f * (yz - wx);
        m.m[10] = 1.0f - 2.0f * (xx + yy);
        return m;
    }

    static Mat4 perspective(float fovY, float aspect, float nearZ, float farZ) {
        Mat4 m{};
        float f = 1.0f / std::tan(fovY * 0.5f);
        m.m[0] = f / aspect;
        m.m[5] = f;
        m.m[10] = (farZ + nearZ) / (nearZ - farZ);
        m.m[11] = -1.0f;
        m.m[14] = (2.0f * farZ * nearZ) / (nearZ - farZ);
        return m;
    }

    static Mat4 lookAt(const Vec3& eye, const Vec3& target, const Vec3& up) {
        Vec3 zAxis = (target - eye).norm();
        Vec3 xAxis = up.cross(zAxis).norm();
        Vec3 yAxis = zAxis.cross(xAxis).norm();

        Mat4 m;
        m.m[0] = xAxis.x; m.m[1] = xAxis.y; m.m[2] = xAxis.z;
        m.m[4] = yAxis.x; m.m[5] = yAxis.y; m.m[6] = yAxis.z;
        m.m[8] = zAxis.x; m.m[9] = zAxis.y; m.m[10] = zAxis.z;
        m.m[12] = -xAxis.dot(eye);
        m.m[13] = -yAxis.dot(eye);
        m.m[14] = -zAxis.dot(eye);
        m.m[15] = 1.0f;
        return m;
    }

    Vec3 transformPoint(const Vec3& v) const {
        float w = m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15];
        if (w == 0.0f) return v;
        float iw = 1.0f / w;
        return {
            (m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12]) * iw,
            (m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13]) * iw,
            (m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14]) * iw
        };
    }

    Vec3 transformDir(const Vec3& v) const {
        return {
            m[0] * v.x + m[4] * v.y + m[8] * v.z,
            m[1] * v.x + m[5] * v.y + m[9] * v.z,
            m[2] * v.x + m[6] * v.y + m[10] * v.z
        };
    }

    Mat4 operator*(const Mat4& o) const {
        Mat4 r{};
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++)
                for (int k = 0; k < 4; k++)
                    r.m[i * 4 + j] += m[k * 4 + j] * o.m[i * 4 + k];
        return r;
    }
};

// ==================== Math helpers ====================

inline float clamp(float val, float min, float max) { return std::clamp(val, min, max); }
inline float lerp(float a, float b, float t) { return a + (b - a) * std::clamp(t, 0.0f, 1.0f); }
inline float smoothstep(float edge0, float edge1, float x) {
    float t = std::clamp((x - edge0) / (edge1 - edge0), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

inline constexpr float deg2rad(float deg) { return deg * 3.141592653589793f / 180.0f; }
inline constexpr float rad2deg(float rad) { return rad * 180.0f / 3.141592653589793f; }

// ==================== RNG ====================

class RNG {
    std::mt19937 gen;
public:
    explicit RNG(int seed = 42) : gen(seed) {}

    float randFloat(float min = 0.0f, float max = 1.0f) {
        std::uniform_real_distribution<float> dist(min, max);
        return dist(gen);
    }

    int randInt(int min = 0, int max = 100) {
        std::uniform_int_distribution<int> dist(min, max);
        return dist(gen);
    }

    float randRange(float min, float max) { return randFloat(min, max); }

    float noise2D(float x, float y) {
        // Simple hash-based noise (value noise with smoothing)
        long ix = static_cast<long>(std::floor(x));
        long iy = static_cast<long>(std::floor(y));
        float fx = x - static_cast<float>(ix);
        float fy = y - static_cast<float>(iy);

        // Smooth interpolation
        float sx = fx * fx * (3.0f - 2.0f * fx);
        float sy = fy * fy * (3.0f - 2.0f * fy);

        auto hash = [](long x, long y) -> float {
            long h = x * 374761393LL + y * 668265263LL;
            h = (h ^ (h >> 13)) * 1274126177LL;
            h = h ^ (h >> 16);
            return static_cast<float>(h & 0x7fffffff) / 2147483647.0f;
        };

        float a = hash(ix, iy);
        float b = hash(ix + 1, iy);
        float c = hash(ix, iy + 1);
        float d = hash(ix + 1, iy + 1);

        float top = a + (b - a) * sx;
        float bottom = c + (d - c) * sx;
        return top + (bottom - top) * sy;
    }

    // Perlin-like 2D noise (better visual quality)
    float perlin2D(float x, float y) {
        float scale = 1.0f;
        float value = 0.0f;
        float amplitude = 1.0f;
        float frequency = 1.0f;
        const int octaves = 4;

        for (int i = 0; i < octaves; i++) {
            value += amplitude * noise2D(x * frequency * scale, y * frequency * scale);
            amplitude *= 0.5f;
            frequency *= 2.0f;
        }
        return value;
    }
};

} // namespace SH
