#include "EventBus.hpp"

EventBus& EventBus::instance() { static EventBus e; return e; }

unsigned long EventBus::on(const char* event, Handler h) {
    auto& v = m[std::string(event)];
    v.push_back({nextId++, std::move(h)});
    return v.back().id;
}

void EventBus::emit(const char* event) {
    auto it = m.find(std::string(event));
    if (it == m.end()) return;
    auto v = it->second; // copy: handlers may subscribe/unsubscribe
    for (auto& s : v) s.h();
}

void EventBus::off(const char* event, unsigned long token) {
    auto it = m.find(std::string(event));
    if (it == m.end()) return;
    auto& v = it->second;
    v.erase(std::remove_if(v.begin(), v.end(),
        [&](const Slot& s) { return s.id == token; }), v.end());
}
