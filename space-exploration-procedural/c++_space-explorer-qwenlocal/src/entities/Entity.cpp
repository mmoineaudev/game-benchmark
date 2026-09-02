#include "entities/Entity.hpp"
#include "utils/Math.hpp"
#include "utils/Logging.hpp"
#include <cstring>
#include <iostream>

namespace SH {

void Entity::serialize(void* data) const {
    // Serialize entity state to buffer
    // Format: type(string), id(int), position(Vec3), orientation(Vec3), velocity(Vec3), radius(float), active(bool)
    int offset = 0;
    
    // Type (fixed size)
    char typeBuf[64] = {0};
    size_t copyLen = std::min(type_.size(), size_t(63));
    std::memcpy(typeBuf, type_.c_str(), copyLen);
    std::memcpy(static_cast<char*>(data) + offset, typeBuf, 64);
    offset += 64;
    
    // ID
    std::memcpy(static_cast<char*>(data) + offset, &id_, sizeof(int));
    offset += sizeof(int);
    
    // Position
    std::memcpy(static_cast<char*>(data) + offset, &position, sizeof(Vec3));
    offset += sizeof(Vec3);
    
    // Orientation
    std::memcpy(static_cast<char*>(data) + offset, &orientation, sizeof(Vec3));
    offset += sizeof(Vec3);
    
    // Velocity
    std::memcpy(static_cast<char*>(data) + offset, &velocity, sizeof(Vec3));
    offset += sizeof(Vec3);
    
    // Radius
    std::memcpy(static_cast<char*>(data) + offset, &radius, sizeof(float));
    offset += sizeof(float);
    
    // Active
    std::memcpy(static_cast<char*>(data) + offset, &active, sizeof(bool));
    offset += sizeof(bool);
    
    // Components (serialize each one)
    for (const auto& comp : components_) {
        comp->serialize(static_cast<char*>(data) + offset);
        offset += 256; // Each component gets 256 bytes
    }
    
    LOG_DEBUG("Entity", "Serialized entity " + type_ + " (id=" + std::to_string(id_) + ")");
}

void Entity::deserialize(const void* data) {
    // Deserialize entity state from buffer
    int offset = 0;
    
    // Type
    char typeBuf[64] = {0};
    std::memcpy(typeBuf, static_cast<const char*>(data) + offset, 64);
    type_ = std::string(typeBuf);
    offset += 64;
    
    // ID
    std::memcpy(&id_, static_cast<const char*>(data) + offset, sizeof(int));
    offset += sizeof(int);
    
    // Position
    std::memcpy(&position, static_cast<const char*>(data) + offset, sizeof(Vec3));
    offset += sizeof(Vec3);
    
    // Orientation
    std::memcpy(&orientation, static_cast<const char*>(data) + offset, sizeof(Vec3));
    offset += sizeof(Vec3);
    
    // Velocity
    std::memcpy(&velocity, static_cast<const char*>(data) + offset, sizeof(Vec3));
    offset += sizeof(Vec3);
    
    // Radius
    std::memcpy(&radius, static_cast<const char*>(data) + offset, sizeof(float));
    offset += sizeof(float);
    
    // Active
    std::memcpy(&active, static_cast<const char*>(data) + offset, sizeof(bool));
    offset += sizeof(bool);
    
    // Components
    for (auto& comp : components_) {
        comp->deserialize(static_cast<const char*>(data) + offset);
        offset += 256;
    }
    
    LOG_DEBUG("Entity", "Deserialized entity " + type_ + " (id=" + std::to_string(id_) + ")");
}

} // namespace SH
