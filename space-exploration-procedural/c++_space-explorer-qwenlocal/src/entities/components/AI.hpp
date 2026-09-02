#pragma once
#include "entities/components/Damage.hpp"
#include "entities/components/ComponentBase.hpp"
#include "utils/Math.hpp"
#include <string>

namespace SH {

// AI component: behavior states, targets, movement patterns
class AIComponent : public ComponentBase {
public:
    enum class Behavior {
        NONE,
        PATROL,
        CHASE,
        EVASIVE,
        DOCKING,
        ATTACK
    };

    AIComponent(Behavior behavior = Behavior::NONE, float speed = 0.0f)
        : behavior_(behavior), targetSpeed_(speed), target_(Vec3()),
          aggression_(0.0f), aggressionTimer_(0.0f),
          patrolRadius_(0.0f), lastPatrolPoint_(Vec3()) {}

    void update(float dt) override {
        aggressionTimer_ += dt;

        // Check if target is dead
        if (!(target_ == Vec3())) {
            auto* targetEntity = findEntityAtTarget();
            if (targetEntity && targetEntity->hasComponent<DamageComponent>()) {
                auto* dmg = targetEntity->getComponent<DamageComponent>();
                if (dmg && dmg->isDead()) {
                    target_ = Vec3();
                    behavior_ = Behavior::PATROL;
                }
            }
        }

        // Behavior logic
        switch (behavior_) {
            case Behavior::CHASE:
            case Behavior::ATTACK:
                updateAttack(dt);
                break;
            case Behavior::EVASIVE:
                updateEvasion(dt);
                break;
            case Behavior::DOCKING:
                updateDocking(dt);
                break;
            case Behavior::PATROL:
                updatePatrol(dt);
                break;
            default:
                break;
        }
    }

    void setBehavior(Behavior b) { behavior_ = b; }
    void setTarget(const Vec3& target) { target_ = target; }
    void setSpeed(float s) { targetSpeed_ = s; }
    void setAggression(float a) { aggression_ = a; }

    std::string type() const override { return "ai"; }

    void onCollision(Entity* other) override {}
    void onRemove() override {}
    void serialize(void* data) const override {}
    void deserialize(const void* data) override {}

private:
    Behavior behavior_;
    float targetSpeed_;
    Vec3 target_;
    float aggression_;
    float aggressionTimer_;
    float patrolRadius_;
    Vec3 lastPatrolPoint_;

    void updateAttack(float dt) {
        // Simple chase logic
        if (!(target_ == Vec3())) {
            Vec3 dir = (target_ - owner_->position).norm();
            owner_->velocity = dir * targetSpeed_;
            aggression_ += dt * 0.1f; // Increase aggression over time
            if (aggression_ > 1.0f) {
                aggression_ = 1.0f;
            }
        }
    }

    void updateEvasion(float dt) {
        // Run away from nearest threat
        if (!(target_ == Vec3())) {
            Vec3 dir = (owner_->position - target_).norm();
            owner_->velocity = dir * targetSpeed_;
        }
    }

    void updateDocking(float dt) {
        // Slow down and approach dock point
        if (!(target_ == Vec3())) {
            Vec3 dir = (target_ - owner_->position);
            float dist = dir.len();
            if (dist > 1.0f) {
                owner_->velocity = dir.norm() * (targetSpeed_ * 0.5f);
            } else {
                owner_->velocity = Vec3();
            }
        }
    }

    void updatePatrol(float dt) {
        // Random patrol within radius
        if (aggressionTimer_ > 5.0f) {
            aggressionTimer_ = 0.0f;
            lastPatrolPoint_ = Vec3(
                owner_->position.x + RNG().randRange(-patrolRadius_, patrolRadius_),
                owner_->position.y + RNG().randRange(-patrolRadius_, patrolRadius_),
                owner_->position.z);
        }
        if (!(lastPatrolPoint_ == Vec3())) {
            Vec3 dir = (lastPatrolPoint_ - owner_->position).norm();
            owner_->velocity = dir * (targetSpeed_ * 0.5f);
        }
    }

    Entity* findEntityAtTarget() {
        // Placeholder: would iterate through all entities to find one at target position
        return nullptr;
    }
};

} // namespace SH
