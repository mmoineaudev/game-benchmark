#include "entities/EntityFactory.hpp"
#include "entities/Entity.hpp"
#include "entities/components/Physics.hpp"
#include "entities/components/Render.hpp"
#include "entities/components/Damage.hpp"
#include "entities/components/AI.hpp"
#include "utils/Logging.hpp"
#include <iostream>
#include <nlohmann/json.hpp>

namespace SH {

Entity* EntityFactory::createEntity(const std::string& type, int id) {
    auto it = creators_.find(type);
    if (it != creators_.end()) {
        Entity* e = it->second(id);
        LOG_DEBUG("EntityFactory", "Created entity type=" + type + " id=" + std::to_string(id));
        return e;
    }
    LOG_WARN("EntityFactory", "Unknown entity type: " + type + ", returning null");
    return nullptr;
}

Entity* EntityFactory::createFromJSON(const std::string& jsonStr, int id) {
    try {
        auto json = nlohmann::json::parse(jsonStr);
        std::string type = json.value<std::string>("type", "generic");
        
        Entity* entity = createEntity(type, id);
        if (!entity) {
            LOG_ERROR("EntityFactory", "Failed to create entity from JSON: unknown type");
            return nullptr;
        }
        
        // Parse components from JSON
        for (auto& compJson : json["components"]) {
            std::string compType = compJson.value<std::string>("type", "");
            if (compType == "physics") {
                float mass = compJson.value<float>("mass", 1.0f);
                float radius = compJson.value<float>("radius", 1.0f);
                entity->addComponent<PhysicsComponent>(mass, radius);
            } else if (compType == "render") {
                int mesh = compJson.value<int>("mesh", -1);
                int material = compJson.value<int>("material", -1);
                float r = compJson.value<float>("color_r", 1.0f);
                float g = compJson.value<float>("color_g", 1.0f);
                float b = compJson.value<float>("color_b", 1.0f);
                float scale = compJson.value<float>("scale", 1.0f);
                entity->addComponent<RenderComponent>(mesh, material, Vec3(r, g, b), scale);
            } else if (compType == "damage") {
                int health = compJson.value<int>("health", 100);
                int maxHealth = compJson.value<int>("maxHealth", 100);
                entity->addComponent<DamageComponent>(health, maxHealth);
            } else if (compType == "ai") {
                std::string behavior = compJson.value<std::string>("behavior", "none");
                float speed = compJson.value<float>("speed", 0.0f);
                AIComponent::Behavior aiBeh = AIComponent::Behavior::NONE;
                if (behavior == "patrol") aiBeh = AIComponent::Behavior::PATROL;
                else if (behavior == "chase") aiBeh = AIComponent::Behavior::CHASE;
                else if (behavior == "evasive") aiBeh = AIComponent::Behavior::EVASIVE;
                else if (behavior == "docking") aiBeh = AIComponent::Behavior::DOCKING;
                else if (behavior == "attack") aiBeh = AIComponent::Behavior::ATTACK;
                entity->addComponent<AIComponent>(aiBeh, speed);
            }
        }
        
        // Parse position
        if (json.contains("position")) {
            auto& pos = json["position"];
            entity->position = {pos.value<float>("x", 0), pos.value<float>("y", 0), pos.value<float>("z", 0)};
        }
        
        return entity;
    } catch (const nlohmann::json::parse_error& e) {
        LOG_ERROR("EntityFactory", "JSON parse error: " + std::string(e.what()));
        return nullptr;
    } catch (const std::exception& e) {
        LOG_ERROR("EntityFactory", "Error creating entity: " + std::string(e.what()));
        return nullptr;
    }
}

void EntityFactory::registerCreator(std::string type, std::function<Entity*(int)> creator) {
    creators_[type] = creator;
    LOG_DEBUG("EntityFactory", "Registered creator for type: " + type);
}

void EntityFactory::clear() {
    creators_.clear();
    nextId_ = 1;
    LOG_INFO("EntityFactory", "Factory cleared");
}

} // namespace SH
