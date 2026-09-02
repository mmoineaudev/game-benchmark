#pragma once
#include "entities/components/ComponentBase.hpp"
#include "utils/Math.hpp"
#include <string>

namespace SH {

// Physics component: velocity, mass, acceleration, collision radius
class PhysicsComponent : public ComponentBase {
public:
    PhysicsComponent(float mass = 1.0f, float radius = 1.0f)
        : mass_(mass), radius_(radius), velocity_(0,0,0), acceleration_(0,0,0) {}

    void update(float dt) override {
        velocity_ += acceleration_ * dt;
        // Clamp velocity
        float speed = velocity_.len();
        if (speed > MAX_SPEED) {
            velocity_ = velocity_.norm() * MAX_SPEED;
        }
        if (speed < MIN_SPEED && velocity_.lenSq() > 0.001f) {
            velocity_ = velocity_.norm() * MIN_SPEED;
        }
    }

    void setVelocity(const Vec3& v) { velocity_ = v; }
    void setAcceleration(const Vec3& a) { acceleration_ = a; }
    void setMass(float m) { mass_ = m; }
    void setRadius(float r) { radius_ = r; }

    const Vec3& velocity() const { return velocity_; }
    const Vec3& acceleration() const { return acceleration_; }
    float mass() const { return mass_; }
    float radius() const { return radius_; }

    std::string type() const override { return "physics"; }

    void onCollision(Entity* other) override {
        // Simple impulse resolution
        if (!owner_) return;
        Vec3 delta = other->position - owner_->position;
        float dist = delta.len();
        float minDist = radius_ + other->radius;
        if (dist < minDist && dist > 0.001f) {
            // Push apart
            Vec3 push = delta.norm() * (minDist - dist) * 0.5f;
            owner_->position += push;
            other->position -= push;

            // Exchange velocities (elastic collision)
            Vec3 v1 = owner_->velocity;
            Vec3 v2 = other->velocity;
            owner_->velocity = v2;
            other->velocity = v1;
        }
    }

    void onRemove() override {}
    void serialize(void* data) const override {}
    void deserialize(const void* data) override {}

private:
    float mass_;
    float radius_;
    Vec3 velocity_;
    Vec3 acceleration_;
    constexpr static float MAX_SPEED = 50.0f;
    constexpr static float MIN_SPEED = 5.0f;
};

} // namespace SH
