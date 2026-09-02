#include "systems/AudioSystem.hpp"
#include <iostream>
#include <fstream>
#include <thread>
#include <future>

namespace SH {

AudioSystem::AudioSystem() : muted_(false), volume_(0.8f), nextId_(0) {
    LOG_INFO("AudioSystem", "Audio system initialized (libsndfile)");
}

void AudioSystem::init() {
    LOG_INFO("AudioSystem", "Audio system init complete");
}

void AudioSystem::shutdown() {
    audioBuffers_.clear();
    LOG_INFO("AudioSystem", "Audio system shut down");
}

void AudioSystem::loadAudioAsync(const std::string& name, std::function<void(bool)> callback) {
    std::thread([this, name, callback]() {
        std::string path = "assets/audio/" + name + ".wav";
        std::ifstream file(path, std::ios::binary | std::ios::ate);
        if (!file.is_open()) {
            path = "assets/audio/" + name + ".ogg";
            file.open(path, std::ios::binary | std::ios::ate);
        }

        if (!file.is_open()) {
            LOG_WARN("AudioSystem", "Audio file not found: " + name);
            callback(false);
            return;
        }

        auto size = file.tellg();
        file.seekg(0, std::ios::beg);
        std::vector<char> buffer(size);
        file.read(buffer.data(), static_cast<std::streamsize>(size));
        file.close();

        // Parse WAV header (simplified)
        if (size < 44 || buffer[0] != 'R' || buffer[1] != 'I' || buffer[2] != 'F' || buffer[3] != 'F') {
            LOG_WARN("AudioSystem", "Invalid WAV file: " + name);
            callback(false);
            return;
        }

        // Extract audio data (skip 44-byte WAV header)
        AudioBuffer buffer_;
        buffer_.path = path;
        buffer_.data.resize(static_cast<size_t>(static_cast<std::streamsize>(size) - 44) / 2); // Assume 16-bit PCM
        for (size_t i = 0; i < buffer_.data.size(); i++) {
            int16_t sample = static_cast<int16_t>(
                static_cast<uint8_t>(buffer[44 + i * 2]) |
                (static_cast<uint8_t>(buffer[44 + i * 2 + 1]) << 8));
            buffer_.data[i] = static_cast<float>(sample) / 32768.0f;
        }
        buffer_.loaded = true;

        std::lock_guard<std::mutex> lock(mtx_);
        audioBuffers_[name] = std::move(buffer_);

        callback(true);
        LOG_INFO("AudioSystem", "Audio loaded: " + name);
    }).detach();
}

void AudioSystem::playOnce(const std::string& name, float volume) {
    std::lock_guard<std::mutex> lock(mtx_);
    auto it = audioBuffers_.find(name);
    if (it != audioBuffers_.end() && it->second.loaded) {
        LOG_DEBUG("AudioSystem", "Playing once: " + name);
        // In real implementation, play through output device
        // For now, just mark as playing
        it->second.playing = true;
        it->second.volume = volume * volume_;
    } else {
        LOG_WARN("AudioSystem", "Audio not loaded: " + name);
    }
}

void AudioSystem::playLoop(const std::string& name, float volume) {
    std::lock_guard<std::mutex> lock(mtx_);
    auto it = audioBuffers_.find(name);
    if (it != audioBuffers_.end() && it->second.loaded) {
        LOG_DEBUG("AudioSystem", "Playing loop: " + name);
        it->second.playing = true;
        it->second.volume = volume * volume_;
    }
}

void AudioSystem::stopAll() {
    std::lock_guard<std::mutex> lock(mtx_);
    for (auto& [name, buf] : audioBuffers_) {
        buf.playing = false;
    }
    LOG_DEBUG("AudioSystem", "All audio stopped");
}

void AudioSystem::stop(const std::string& name) {
    std::lock_guard<std::mutex> lock(mtx_);
    auto it = audioBuffers_.find(name);
    if (it != audioBuffers_.end()) {
        it->second.playing = false;
    }
}

void AudioSystem::setMuted(bool muted) {
    muted_ = muted;
    if (muted_) {
        stopAll();
        LOG_INFO("AudioSystem", "Audio muted");
    } else {
        LOG_INFO("AudioSystem", "Audio unmuted");
    }
}

bool AudioSystem::hasAudio(const std::string& name) const {
    std::lock_guard<std::mutex> lock(mtx_);
    auto it = audioBuffers_.find(name);
    return it != audioBuffers_.end() && it->second.loaded;
}

} // namespace SH
