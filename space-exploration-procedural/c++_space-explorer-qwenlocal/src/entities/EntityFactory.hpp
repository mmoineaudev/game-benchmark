#pragma once
#include <string>
#include <unordered_map>
#include <functional>
#include <memory>

namespace SH {

class Entity;

// Entity factory for creating entities from JSON data
class EntityFactory {
public:
    Entity* createEntity(const std::string& type, int id);
    Entity* createFromJSON(const std::string& jsonStr, int id);

    void registerCreator(std::string type, std::function<Entity*(int)> creator);

    // Cleanup
    void clear();

private:
    std::unordered_map<std::string, std::function<Entity*(int)>> creators_;
    int nextId_ = 1;
};

} // namespace SH
