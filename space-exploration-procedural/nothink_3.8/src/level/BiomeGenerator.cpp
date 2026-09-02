#include "BiomeGenerator.hpp"
#include "EventBus.hpp"
#include <cstdio>

namespace {
const RungConfig* table() {
    static RungConfig t[] = {
        {"OPEN_SPACE",       0,      1000, 1.0f, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        {"ASTEROID_BELT",   1000,   3000, 1.0f, 8, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        {"NEBULA_CORRIDOR", 3000,   5000, 1.2f, 3, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0},
        {"WORMHOLE",        5000,   7000, 1.5f, 2, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0},
        {"DEEP_VOID",       7000,   8000, 1.5f, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        {"CRYSTAL_FIELDS",  8000,   11000,2.0f, 2, 0, 0, 0, 1, 0, 0, 5, 0, 0, 0, 0, 0},
        {"DEEP_VOID",       11000,  12500,2.0f, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        {"PULSAR_REGION",   12500,  16000,2.5f, 2, 0, 1, 0, 1, 0, 0, 0, 4, 0, 0, 0, 0},
        {"DEEP_VOID",       16000,  18000,2.5f, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        {"PLASMA_STORM",    18000,  22000,3.0f, 3, 1, 1, 0, 1, 1, 0, 0, 0, 5, 0, 0, 0},
        {"DEEP_VOID",       22000,  25000,3.0f, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        {"DERELICT_GRAVEYARD",25000,29000,3.5f, 4, 2, 0, 1, 1, 2, 3, 0, 0, 0, 4, 0, 0},
        {"DEEP_VOID",       29000,  35000,3.5f, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0},
        {"SPATIAL_GRAVEYARD",35000, 999999,4.0f, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 5},
    };
    return t;
}
} // namespace

BiomeGenerator& BiomeGenerator::instance() {
    static BiomeGenerator g;
    return g;
}

const RungConfig* BiomeGenerator::getRungConfig(float distance) {
    const RungConfig* t = table();
    for (int i = 0; i < 14; i++) {
        if (distance >= t[i].rangeMin && distance < t[i].rangeMax)
            return &t[i];
    }
    return &t[13];
}

const RungConfig* BiomeGenerator::getRungConfig(int rungIndex) {
    const RungConfig* t = table();
    if (rungIndex < 0) rungIndex = 0;
    if (rungIndex > 13) rungIndex = 13;
    return &t[rungIndex];
}

int BiomeGenerator::getRungIndex(float distance) {
    const RungConfig* t = table();
    for (int i = 0; i < 14; i++) {
        if (distance >= t[i].rangeMin && distance < t[i].rangeMax)
            return i;
    }
    return 13;
}

void BiomeGenerator::checkRungChange(float distance, int rungIndex) {
    if (rungIndex == m_prevRung) return;
    m_prevRung = rungIndex;
    EventBus::instance().emit(Events::LADDER_RUNG_CHANGED);
    if (rungIndex == 13)
        EventBus::instance().emit(Events::LADDER_FINALE_REACHED);
}
