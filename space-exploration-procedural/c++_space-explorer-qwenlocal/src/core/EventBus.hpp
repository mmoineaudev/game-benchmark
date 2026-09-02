#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <any>
#include <functional>
#include <iostream>
#include <stdexcept>

namespace SH {

// Minimal event data carrier (string -> any map, for runtime events)
struct Event {
    std::string type;
    std::unordered_map<std::string, std::any> data;

    Event() = default;
    Event(std::string type_) : type(std::move(type_)) {}

    template <typename T>
    T get(const std::string& key, T defaultVal = T{}) const {
        auto it = data.find(key);
        if (it != data.end() && it->second.type() == typeid(T)) {
            try { return std::any_cast<T>(it->second); }
            catch (const std::bad_any_cast&) { return defaultVal; }
        }
        return defaultVal;
    }

    template <typename T>
    void set(const std::string& key, T val) { data[key] = std::move(val); }
};

// Typed event (compile-time safe, no any_cast needed)
template <typename T>
class TypedEvent {
public:
    using Callback = std::function<void(const T&)>;

    void subscribe(Callback cb) { listeners.push_back(cb); }

    void emit(const T& event) {
        for (auto& cb : listeners) {
            try { cb(event); }
            catch (const std::exception& e) {
                std::cerr << "[TypedEvent] Handler error in " << typeid(T).name()
                          << ": " << e.what() << std::endl;
            }
        }
    }

    std::vector<Callback> listeners;
};

// Main EventBus — the central nervous system.
// String-based for runtime events (game flow, economy, UI, etc.)
// Each handler runs in a try/catch so one crash doesn't kill the bus.
class EventBus {
public:
    static EventBus& instance() {
        static EventBus bus;
        return bus;
    }

    void subscribe(const std::string& type, std::function<void(const Event&)> handler) {
        handlers[type].push_back(handler);
    }

    void emit(const Event& event) {
        auto it = handlers.find(event.type);
        if (it == handlers.end()) return;
        auto handlers_copy = it->second; // snapshot in case handlers modify subscription
        for (auto& h : handlers_copy) {
            try { h(event); }
            catch (const std::exception& e) {
                std::cerr << "[EventBus] Handler threw: " << e.what() << std::endl;
            }
        }
    }

    // One-shot subscribe: fires once then unsubscribes
    void subscribeOnce(const std::string& type, std::function<void(const Event&)> handler) {
        auto wrapper = [this, handler, type](const Event& e) {
            handler(e);
            // Remove self
            auto it = handlers.find(type);
            if (it != handlers.end()) {
                it->second.erase(
                    std::remove_if(it->second.begin(), it->second.end(),
                        [&](const auto& h) { return &h == &handler; }),
                    it->second.end());
            }
        };
        subscribe(type, wrapper);
    }

    void clear() { handlers.clear(); }
    size_t handlerCount(const std::string& type) const {
        auto it = handlers.find(type);
        return it != handlers.end() ? it->second.size() : 0;
    }

private:
    EventBus() = default;
    std::unordered_map<std::string, std::vector<std::function<void(const Event&)>>> handlers;
};

// Convenient macros (optional convenience)
#define ON_EVENT(type, body) \
    SH::EventBus::instance().subscribe(type, [&body](const SH::Event& e) { body });

#define EMIT_EVENT(type, ...) \
    { SH::Event _e(type); _e.data = {__VA_ARGS__}; SH::EventBus::instance().emit(_e); }

} // namespace SH
