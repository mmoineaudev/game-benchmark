#pragma once
#include <string>
#include <unordered_map>
#include <vector>
#include <functional>
#include <mutex>
#include <future>
#include <nlohmann/json.hpp>
#include "core/Timing.hpp"
#include "utils/Logging.hpp"

namespace SH {

// Resource loader with async worker thread support
class ResourceLoader {
public:
    static ResourceLoader& instance() {
        static ResourceLoader loader;
        return loader;
    }

    // Load file content as string
    std::string loadText(const std::string& path) {
        std::ifstream file(path);
        if (!file.is_open()) {
            LOG_ERROR("ResourceLoader", "Cannot open file: " + path);
            return "";
        }
        return std::string((std::istreambuf_iterator<char>(file)),
                           std::istreambuf_iterator<char>());
    }

    // Async text load
    void loadTextAsync(const std::string& path, std::function<void(const std::string&)> callback,
                       int priority = 5) {
        auto* loader = Timing::instance().getAsyncLoader();
        if (loader) {
            loader->loadAsync([this, path, callback]() {
                std::string content = loadText(path);
                callback(content);
            }, priority);
        } else {
            std::string content = loadText(path);
            callback(content);
        }
    }

    // Load JSON from file path
    nlohmann::json loadJSON(const std::string& path) {
        std::string content = loadText(path);
        if (content.empty()) {
            LOG_ERROR("ResourceLoader", "Empty JSON file: " + path);
            return nlohmann::json::object();
        }
        try {
            return nlohmann::json::parse(content);
        } catch (const nlohmann::json::parse_error& e) {
            LOG_ERROR("ResourceLoader", "JSON parse error: " + std::string(e.what()));
            return nlohmann::json::object();
        }
    }

    // Async JSON load
    void loadJSONAsync(const std::string& path, std::function<void(nlohmann::json)> callback,
                       int priority = 5) {
        auto* loader = Timing::instance().getAsyncLoader();
        if (loader) {
            loader->loadAsync([this, path, callback]() {
                nlohmann::json data = loadJSON(path);
                callback(data);
            }, priority);
        } else {
            nlohmann::json data = loadJSON(path);
            callback(data);
        }
    }

    // Load texture file (returns filename path)
    std::string loadTexture(const std::string& name) {
        std::string path = "assets/textures/" + name + ".png";
        return path;
    }

    // Load model file (OBJ format)
    std::string loadModel(const std::string& name) {
        std::string path = "assets/models/" + name + ".obj";
        if (fileExists(path)) {
            return path;
        }
        LOG_WARN("ResourceLoader", "Model not found: " + path);
        return "";
    }

    // Load audio file
    std::string loadAudio(const std::string& name) {
        std::string path = "assets/audio/" + name + ".ogg";
        if (fileExists(path)) {
            return path;
        }
        path = "assets/audio/" + name + ".wav";
        if (fileExists(path)) {
            return path;
        }
        LOG_WARN("ResourceLoader", "Audio not found: " + name);
        return "";
    }

    // Validate JSON schema (basic)
    bool validateJSON(const nlohmann::json& data, const std::string& type) {
        if (!data.contains(type)) {
            LOG_ERROR("ResourceLoader", "Missing top-level key '" + type + "' in data");
            return false;
        }
        return true;
    }

    // Get async loader pointer
    static Timing::AsyncLoader* getAsyncLoader() {
        return Timing::instance().getAsyncLoader();
    }

private:
    ResourceLoader() = default;

    bool fileExists(const std::string& path) {
        std::ifstream file(path);
        return file.good();
    }
};

} // namespace SH
