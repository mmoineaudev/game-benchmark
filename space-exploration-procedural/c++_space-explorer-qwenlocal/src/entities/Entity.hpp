#pragma once
#include <vector>
#include <string>
#include <memory>
#include <unordered_map>
#include <functional>
#include "utils/Math.hpp"
#include "entities/components/ComponentBase.hpp"
#include "utils/Logging.hpp"

namespace SH {

class Entity {
public:
    friend class EntityFactory;
    using ComponentList = std::vector<std::unique_ptr<ComponentBase>>;

    Entity() = default;
    Entity(const std::string& type, int id) : type_(type), id_(id) {}
    virtual ~Entity() = default;

    // Update all components
    virtual void update(float dt) {
        for (auto& comp : components_) {
            comp->update(dt);
        }
    }

    // Collision handling
    virtual void onCollision(Entity* other) {
        for (auto& comp : components_) {
            comp->onCollision(other);
        }
    }

    // Remove all components and self
    virtual void onRemove() {
        for (auto& comp : components_) {
            comp->onRemove();
        }
    }

    // Component management
    template <typename T>
    T* getComponent() {
        for (auto& comp : components_) {
            if (auto* typed = dynamic_cast<T*>(comp.get())) {
                return typed;
            }
        }
        return nullptr;
    }

    template <typename T>
    const T* getComponent() const {
        for (auto& comp : components_) {
            if (auto* typed = dynamic_cast<const T*>(comp.get())) {
                return typed;
            }
        }
        return nullptr;
    }

    template <typename T>
    bool hasComponent() const {
        return getComponent<T>() != nullptr;
    }

    template <typename T, typename... Args>
    T* addComponent(Args&&... args) {
        auto comp = std::make_unique<T>(std::forward<Args>(args)...);
        T* ptr = comp.get();
        comp->setOwner(this);
        components_.push_back(std::move(comp));
        return ptr;
    }

    void removeComponent(std::string type) {
        components_.erase(
            std::remove_if(components_.begin(), components_.end(),
                [&type](const auto& comp) { return comp->type() == type; }),
            components_.end());
    }

    // State
    Vec3 position = Vec3{0, 0, 0};
    Vec3 orientation = Vec3{0, 0, 0}; // Euler: pitch, yaw, roll
    Vec3 velocity = Vec3{0, 0, 0};
    float radius = 1.0f; // Collision radius
    std::string type_ = "entity";
    int id_ = 0;
    bool active = true;

    // Accessors
    const std::string& getType() const { return type_; }
    int getId() const { return id_; }
    bool isActive() const { return active; }
    void setActive(bool val) { active = val; }

    // Serialization helpers
    virtual void serialize(void* data) const;
    virtual void deserialize(const void* data);

private:
    ComponentList components_;
};

} // namespace SH
