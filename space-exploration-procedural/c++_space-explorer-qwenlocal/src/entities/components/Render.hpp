#pragma once
#include "entities/components/ComponentBase.hpp"
#include "utils/Math.hpp"
#include <string>

namespace SH {

// Render component: mesh ID, material ID, color, transform
class RenderComponent : public ComponentBase {
public:
    RenderComponent(int mesh = -1, int material = -1, const Vec3& color = {1, 1, 1}, float scale = 1.0f)
        : mesh_(mesh), material_(material), color_(color), scale_(scale), visible_(true),
          emissive_(false), emissiveIntensity_(0.0f), rotation_(0, 0, 0),
          animationSpeed_(0.0f), animationTime_(0.0f) {}

    void update(float dt) override {
        animationTime_ += dt * animationSpeed_;
        if (animationTime_ > 3.14159f * 2.0f) animationTime_ = 0.0f;
    }

    std::string type() const override { return "render"; }

    void onCollision(Entity* other) override {}
    void onRemove() override {}
    void serialize(void* data) const override {}
    void deserialize(const void* data) override {}

    // Accessors
    int mesh() const { return mesh_; }
    int material() const { return material_; }
    const Vec3& color() const { return color_; }
    float scale() const { return scale_; }
    bool visible() const { return visible_; }
    bool isEmissive() const { return emissive_; }
    float emissiveIntensity() const { return emissiveIntensity_; }
    const Vec3& rotation() const { return rotation_; }
    float animationSpeed() const { return animationSpeed_; }
    float animationTime() const { return animationTime_; }

    void setVisible(bool v) { visible_ = v; }
    void setMesh(int m) { mesh_ = m; }
    void setMaterial(int m) { material_ = m; }
    void setColor(const Vec3& c) { color_ = c; }
    void setScale(float s) { scale_ = s; }
    void setEmissive(bool e) { emissive_ = e; }
    void setEmissiveIntensity(float i) { emissiveIntensity_ = i; }
    void setRotation(const Vec3& r) { rotation_ = r; }
    void setAnimationSpeed(float s) { animationSpeed_ = s; }

private:
    int mesh_;
    int material_;
    Vec3 color_;
    float scale_;
    bool visible_;
    bool emissive_;           // Glow/station beacons
    float emissiveIntensity_; // Strength of glow
    Vec3 rotation_;           // Euler rotation
    float animationSpeed_;    // For animated entities
    float animationTime_;     // Current animation time (sine wave for hover)
};

} // namespace SH
