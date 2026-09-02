#pragma once
#include "Constants.hpp"
#include "GameState.hpp"
#include <vector>

class PlayerShip {
public:
    void init();
    void update(float dt, float throttle, bool firing, bool shieldHeld);
    void die(const std::string& reason);
    void teleport(float distance);
    void respawn();

    const VD::Vec3& pos() const { return m_pos; }
    const VD::Vec3& vel() const { return m_vel; }
    VD::Vec3 forward() const;
    VD::Vec3 right() const;
    float pitch() const { return m_pitch; }
    float yaw() const { return m_yaw; }
    float roll() const { return m_roll; }
    void setPitch(float p) { m_pitch = p; }
    void setYaw(float y) { m_yaw = y; }
    void setRoll(float r) { m_roll = r; }
    float invulnTimer() const { return m_invuln; }
    bool isFiring() const { return m_firing; }
    float shieldCharge() const; // 1 = ready, 0 = just used
    float shieldCooldown() const { return m_shieldCd; }
    bool shieldActive() const { return m_shieldActive; }
    float shieldTimer() const { return m_shieldTimer; }
    float thrustIntensity() const { return m_thrust; }
    void applyGravity(const VD::Vec3& grav);
    void deflect(const VD::Vec3& impulse);
    void addHealth(int delta);
    int health() const { return GameState::instance().health; }
    void setThrust(float t) { m_thrust = t; }

    // Camera helpers
    VD::Vec3 camPos() const;
    VD::Mat4 viewProj() const;

    // Muzzle world positions (for weapon spawn)
    void muzzlePositions(VD::Vec3& m0, VD::Vec3& m1, VD::Vec3& m2, VD::Vec3& m3) const;

private:
    VD::Vec3 m_pos = VD::SHIP_SPAWN;
    VD::Vec3 m_vel = {};
    float m_pitch = 0.0f, m_yaw = 0.0f, m_roll = 0.0f;
    float m_invuln = 0.0f;
    float m_shieldCd = 0.0f;
    bool m_shieldActive = false;
    float m_shieldTimer = 0.0f;
    bool m_firing = false;
    float m_fireTimer = 0.0f;
    float m_thrust = 0.0f;
    float m_distance = 0.0f;
};
