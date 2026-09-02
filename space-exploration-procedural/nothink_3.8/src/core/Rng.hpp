#pragma once
#include <cstdint>

namespace VD {
struct Mulberry32 {
    uint32_t state;
    explicit Mulberry32(uint32_t seed) : state(seed) {}
    float next() {
        state += 0x6D2B79F5u;
        uint32_t t = state;
        t = (t ^ (t >> 15)) * (t | 1);
        t ^= t + ((t << 15) | 1);
        return ((t ^ (t >> 7)) & 0xFFFFFFFFu) / 4294967296.0f;
    }
    float range(float lo, float hi) { return lo + (hi - lo) * next(); }
    int rangeInt(int lo, int hi) { return (int)(lo + next() * (hi - lo + 1)); }
};

inline uint32_t hash3(int x, int y, int z) {
    uint32_t h = 2166136261u;
    auto mix = [&](uint32_t v) { h ^= v; h *= 16777619u; };
    mix(uint32_t(x) * 73856093u);
    mix(uint32_t(y) * 19349663u);
    mix(uint32_t(z) * 83492791u);
    h ^= h >> 13; h *= 0x5bd1e995u; h ^= h >> 15;
    return h;
}
} // namespace VD
