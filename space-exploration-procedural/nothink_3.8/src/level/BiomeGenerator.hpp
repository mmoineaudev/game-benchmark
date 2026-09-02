#pragma once
#include <string>
#include "Constants.hpp"
#include "Rng.hpp"

struct RungConfig {
    std::string key;
    float rangeMin, rangeMax;
    float scoreMult;
    int asteroid = 0, comet = 0, blackHole = 0, deadStar = 0;
    int nebula = 0, station = 0, debris = 0, crystal = 0;
    int pulsar = 0, storm = 0, hulk = 0, cityChance = 0;
    int wreckDensity = 0;
};

class BiomeGenerator {
public:
    static BiomeGenerator& instance();
    static const RungConfig* getRungConfig(float distance);
    static const RungConfig* getRungConfig(int rungIndex);
    static int getRungIndex(float distance);
    void checkRungChange(float distance, int rungIndex);

private:
    BiomeGenerator() = default;
    int m_prevRung = -1;
};
