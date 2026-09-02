#pragma once
#include <vector>
#include <memory>
#include "entities/Entity.hpp"
#include "utils/Logging.hpp"
#include "entities/components/Physics.hpp"

namespace SH {

class PhysicsSystem {
public:
    PhysicsSystem();
    ~PhysicsSystem() = default;

    void init();
    void shutdown();

    void update(float dt);
    void render();

    void addEntity(std::unique_ptr<Entity> entity);
    void removeEntity(int id);
    void clear();

    size_t getEntityCount() const;
    void setDebugMode(bool debug);

    const std::vector<std::unique_ptr<Entity>>& getEntities() const { return entities_; }

private:
    std::vector<std::unique_ptr<Entity>> entities_;
    bool debugMode_ = false;
    int collisionChecks_ = 0;

    void handleCollisions(float dt);
};

} // namespace SH
