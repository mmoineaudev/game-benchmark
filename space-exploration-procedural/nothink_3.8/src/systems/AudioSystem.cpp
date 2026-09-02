#include "AudioSystem.hpp"
#include "GameState.hpp"

#ifdef HAS_OPENAL
#include <AL/al.h>
#include <AL/alc.h>
#endif

void AudioSystem::init() {
#ifdef HAS_OPENAL
    (void)0; // OpenAL init - would create device here
#endif
}

void AudioSystem::shutdown() {
#ifdef HAS_OPENAL
    (void)0;
#endif
}

void AudioSystem::update(float dt, float thrust, bool firing) {
    (void)dt; (void)thrust; (void)firing;
}

void AudioSystem::playLaser() {}
void AudioSystem::playExplosion() {}
void AudioSystem::playShield() {}

void AudioSystem::setMuted(bool m) {
    m_muted = m;
    GameState::instance().muted = m;
}
