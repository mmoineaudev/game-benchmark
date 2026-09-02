#pragma once
#include <vector>
#include <string>
#include <unordered_map>
#include <memory>
#include <mutex>
#include <functional>
#include <sndfile.h>
#include "utils/Logging.hpp"

namespace SH {

// Audio system using libsndfile for WAV/OGG playback
class AudioSystem {
public:
    AudioSystem();
    ~AudioSystem() = default;

    void init();
    void shutdown();

    // Load audio file asynchronously
    void loadAudioAsync(const std::string& name, std::function<void(bool)> callback);

    // Play audio (one-shot)
    void playOnce(const std::string& name, float volume = 1.0f);

    // Play audio (loop)
    void playLoop(const std::string& name, float volume = 0.5f);

    // Stop audio
    void stopAll();
    void stop(const std::string& name);

    // Mute/unmute
    void setMuted(bool muted);
    bool isMuted() const { return muted_; }
    float getVolume() const { return volume_; }
    void setVolume(float vol) { volume_ = vol; }

    // Check if audio file exists
    bool hasAudio(const std::string& name) const;

    // Non-copyable
    AudioSystem(const AudioSystem&) = delete;
    AudioSystem& operator=(const AudioSystem&) = delete;

private:
    struct AudioBuffer {
        std::string path;
        std::vector<float> data;
        bool loaded = false;
        bool playing = false;
        float volume = 1.0f;
    };

    std::unordered_map<std::string, AudioBuffer> audioBuffers_;
    mutable std::mutex mtx_;
    mutable std::mutex playMtx_;
    bool muted_ = false;
    float volume_ = 0.8f;
    int nextId_ = 0;
};

} // namespace SH
