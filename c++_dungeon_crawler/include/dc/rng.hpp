// dc/rng.hpp — mulberry32, BIT-EXACT port of the JS generator.
// Same seed → same sequence as ox-alpha_dungeon_crawler (JS `>>> 0`/`| 0`/Math.imul
// are 32-bit ops; we mirror them with uint32_t + int32_t arithmetic).
#pragma once
#include <cstdint>
#include <type_traits>

namespace dc {

class Rng {
public:
  explicit Rng(std::uint32_t seed) : a_(seed) {}

  // One sample in [0,1) — exactly JS mulberry32() return value.
  double next() {
    // a |= 0; a = (a + 0x6D2B79F5) | 0;
    a_ += 0x6D2B79F5u; // unsigned add == signed wraparound mod 2^32
    std::int32_t ai = static_cast<std::int32_t>(a_);
    // t = Math.imul(a ^ (a >>> 15), 1 | a)
    std::int32_t x = ai ^ static_cast<std::int32_t>(a_ >> 15);
    std::int32_t t = imul(x, 1 | ai);
    // t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    std::int32_t y = t ^ static_cast<std::int32_t>(static_cast<std::uint32_t>(t) >> 7);
    t = static_cast<std::int32_t>(
           static_cast<std::uint32_t>(t + imul(y, 61 | t)) ^ static_cast<std::uint32_t>(t));
    // return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    std::uint32_t z = static_cast<std::uint32_t>(t) ^ (static_cast<std::uint32_t>(t) >> 14);
    return static_cast<double>(z) / 4294967296.0;
  }

  // [0, n) integer — JS Math.floor(this.rnd() * n)
  int nextInt(int n) { return static_cast<int>(next() * static_cast<double>(n)); }

private:
  // Math.imul: low 32 bits of the signed product, as int32.
  static int imul(std::int32_t x, std::int32_t y) {
    return static_cast<std::int32_t>(static_cast<std::int64_t>(x) * y);
  }

  std::uint32_t a_;
};

} // namespace dc
