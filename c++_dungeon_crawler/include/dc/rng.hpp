// dc/rng.hpp — mulberry32, BIT-EXACT port of the JS generator.
//
// Same seed → same sequence as ox-alpha_dungeon_crawler. The JS uses
// `>>>`/`|0`/`Math.imul`, all of which operate on 32-bit two's-complement
// values and wrap mod 2^32. We mirror that with uint32_t arithmetic, which
// is WELL-DEFINED in C++ (unsigned overflow wraps mod 2^32) — so this is
// bit-identical to JS AND free of signed-overflow UB (UBSan-clean).
//
// Mapping JS → C++:
//   `a = (a + 0x6D2B79F5) | 0`  →  a_ += 0x6D2B79F5u          (uint32 wrap)
//   `a ^ (a >>> 15)`            →  a ^ (a >> 15)             (a is uint32)
//   `Math.imul(x, y)`          →  (uint32_t)(int64_t)(int32_t x)(int32_t y)` low 32 bits
//   `((t ^ (t >>> 14)) >>> 0)`  →  z = t ^ (t >> 14)         (uint32)
//   `... / 4294967296`           →  (double)z / 4294967296.0
#pragma once
#include <cstdint>

namespace dc {

class Rng {
public:
  explicit Rng(std::uint32_t seed) : a_(seed) {}

  // One sample in [0,1) — exactly JS mulberry32() return value.
  double next() {
    // a |= 0; a = (a + 0x6D2B79F5) | 0;   (uint32 add wraps mod 2^32 == |0)
    a_ += 0x6D2B79F5u;
    // t = Math.imul(a ^ (a >>> 15), 1 | a)
    const std::uint32_t x = a_ ^ (a_ >> 15);
    const std::uint32_t t0 = imul(x, 1u | a_);
    // t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    const std::uint32_t y = t0 ^ (t0 >> 7);
    const std::uint32_t t1 = (t0 + imul(y, 61u | t0)) ^ t0;
    // return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    const std::uint32_t z = t1 ^ (t1 >> 14);
    return static_cast<double>(z) / 4294967296.0;
  }

  // [0, n) integer — JS Math.floor(this.rnd() * n)
  int nextInt(int n) { return static_cast<int>(next() * static_cast<double>(n)); }

private:
  // Math.imul(x, y): low 32 bits of the signed 32×32 product.
  // The low 32 bits are the same whether computed signed or unsigned, so we
  // widen to int64 and truncate to uint32 (well-defined, no overflow UB).
  static std::uint32_t imul(std::uint32_t x, std::uint32_t y) {
    const std::int64_t p =
        static_cast<std::int64_t>(static_cast<std::int32_t>(x)) *
        static_cast<std::int64_t>(static_cast<std::int32_t>(y));
    return static_cast<std::uint32_t>(p);
  }

  std::uint32_t a_;
};

} // namespace dc
