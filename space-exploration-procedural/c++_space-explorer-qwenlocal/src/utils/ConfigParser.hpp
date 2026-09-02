#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <stdexcept>
#include <fstream>
#include <filesystem>
#include <nlohmann/json.hpp>

namespace SH {

namespace ConfigParser {

// Simple JSON config loader using nlohmann/json
// Returns a flat config map from a JSON file
using Config = std::unordered_map<std::string, std::string>;

// Recursively flatten a JSON object into key-value pairs
static void flattenJSON(const nlohmann::json& j, const std::string& prefix, Config& config) {
    if (j.is_object()) {
        for (auto it = j.begin(); it != j.end(); ++it) {
            std::string key = prefix.empty() ? it.key() : prefix + "." + it.key();
            if (it->is_object() || it->is_array()) {
                flattenJSON(*it, key, config);
            } else {
                config[key] = it->dump();
            }
        }
    } else if (j.is_array()) {
        for (size_t i = 0; i < j.size(); ++i) {
            std::string key = prefix.empty() ? std::to_string(i) : prefix + "[" + std::to_string(i) + "]";
            if (j[i].is_object() || j[i].is_array()) {
                flattenJSON(j[i], key, config);
            } else {
                config[key] = j[i].dump();
            }
        }
    } else {
        if (!prefix.empty()) {
            config[prefix] = j.dump();
        }
    }
}

Config load(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("ConfigParser: Cannot open file: " + path);
    }

    nlohmann::json json;
    try {
        json = nlohmann::json::parse(file);
    } catch (const nlohmann::json::parse_error& e) {
        throw std::runtime_error(std::string("ConfigParser: JSON parse error: ") + e.what());
    }

    Config config;
    flattenJSON(json, "", config);
    return config;
}

// Validate that required keys exist in a flat config
void validate(const Config& config, const std::vector<std::string>& requiredKeys,
              const std::string& source = "config") {
    for (const auto& key : requiredKeys) {
        if (config.find(key) == config.end()) {
            throw std::runtime_error("ConfigParser: Missing required key '" + key +
                                     "' in " + source);
        }
    }
}

// Validate required keys in a nested JSON object
void validateNested(const nlohmann::json& data, const std::vector<std::string>& requiredKeys,
                    const std::string& source = "config") {
    for (const auto& key : requiredKeys) {
        if (!data.contains(key)) {
            throw std::runtime_error("ConfigParser: Missing required nested key '" + key +
                                     "' in " + source);
        }
    }
}

// Load a JSON file directly (returns nlohmann::json)
nlohmann::json loadRaw(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("ConfigParser: Cannot open file: " + path);
    }

    nlohmann::json json;
    try {
        json = nlohmann::json::parse(file);
    } catch (const nlohmann::json::parse_error& e) {
        throw std::runtime_error(std::string("ConfigParser: JSON parse error: ") + e.what());
    }

    return json;
}

} // namespace ConfigParser

} // namespace SH
