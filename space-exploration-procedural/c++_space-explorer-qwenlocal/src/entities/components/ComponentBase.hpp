#pragma once
#include <string>
#include <memory>

namespace SH {

class Entity;

// Base interface for all components
class ComponentBase {
public:
    virtual ~ComponentBase() = default;
    virtual void update(float dt) = 0;
    virtual void onCollision(Entity* other) = 0;
    virtual void onRemove() = 0;
    virtual std::string type() const = 0;

    // Serialization helpers
    virtual void serialize(void* data) const = 0;
    virtual void deserialize(const void* data) = 0;

    // Get entity pointer (set by Entity when attached)
    Entity* owner() const { return owner_; }
    
    // Set owner (called by Entity)
    void setOwner(Entity* e) { owner_ = e; }

protected:
    Entity* owner_ = nullptr;
};

} // namespace SH
