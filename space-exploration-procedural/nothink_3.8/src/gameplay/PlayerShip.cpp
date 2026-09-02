#include "PlayerShip.hpp"
#include "EventBus.hpp"
#include <cmath>

void PlayerShip::init() {
    m_pos = VD::SHIP_SPAWN;
    m_vel = {};
    m_pitch = m_yaw = m_roll = 0;
    m_invuln = m_shieldCd = m_shieldTimer = 0;
    m_shieldActive = false;
    m_firing = false;
    m_fireTimer = 0;
    m_thrust = 0;
    m_distance = 0;
}

void PlayerShip::update(float dt, float throttle, bool firing, bool shieldHeld) {
    m_firing = firing;
    m_fireTimer += dt;
    m_invuln = std::max(0.0f, m_invuln - dt);
    m_shieldCd = std::max(0.0f, m_shieldCd - dt);

    if (m_shieldActive) {
        m_shieldTimer -= dt;
        if (m_shieldTimer <= 0) m_shieldActive = false;
    }
    if (shieldHeld && m_shieldCd <= 0) {
        m_shieldActive = true;
        m_shieldTimer = 0.5f;
        m_shieldCd = VD::SHIELD_COOLDOWN;
        EventBus::instance().emit(Events::INPUT_SHIELD);
    }

    // Movement
    float thrust = throttle * VD::SHIP_ACCELERATION;
    m_thrust = throttle;
    m_vel += forward() * thrust * dt;
    m_vel.x *= VD::SHIP_DRAG;
    m_vel.y *= VD::SHIP_DRAG;
    m_vel.z *= VD::SHIP_DRAG;
    float speed = glm::length(m_vel);
    if (speed > VD::MAX_SHIP_SPEED) {
        m_vel *= (VD::MAX_SHIP_SPEED / speed);
    }
    m_pos += m_vel * dt;

    // Distance tracking
    float newDist = m_pos.z * -1.0f; // moving in -Z direction
    if (newDist > m_distance) {
        m_distance = newDist;
        GameState::instance().distance = newDist;
    }
}

void PlayerShip::die(const std::string& reason) {
    if (GameState::instance().dead) return;
    GameState::instance().dead = true;
    GameState::instance().deathReason = reason;
    EventBus::instance().emit(Events::PLAYER_DIED);
}

void PlayerShip::teleport(float dist) {
    m_pos = VD::Vec3(0, 2, -dist);
    m_vel = {};
    m_distance = dist;
    GameState::instance().distance = dist;
}

void PlayerShip::respawn() {
    GameState::instance().health = VD::MAX_HEALTH;
    GameState::instance().dead = false;
    GameState::instance().deathReason = "";
    init();
}

VD::Vec3 PlayerShip::forward() const {
    float cp = cosf(m_pitch);
    return VD::Vec3(-sinf(m_yaw) * cp, -sinf(m_pitch), -cosf(m_yaw) * cp);
}

VD::Vec3 PlayerShip::right() const {
    float cp = cosf(m_pitch);
    return VD::Vec3(cosf(m_yaw) * cp, 0, -sinf(m_yaw) * cp);
}

void PlayerShip::applyGravity(const VD::Vec3& grav) {
    m_vel += grav;
}

void PlayerShip::deflect(const VD::Vec3& impulse) {
    m_vel += impulse;
}

void PlayerShip::addHealth(int delta) {
    int& hp = GameState::instance().health;
    hp = glm::clamp(hp + delta, 0, VD::MAX_HEALTH);
    EventBus::instance().emit(Events::PLAYER_HEALTH_CHANGED);
    if (hp <= 0) die("Hull destroyed");
}

float PlayerShip::shieldCharge() const {
    return m_shieldCd > 0 ? 1.0f - (m_shieldCd / VD::SHIELD_COOLDOWN) : 1.0f;
}

VD::Vec3 PlayerShip::camPos() const {
    return m_pos - forward() * VD::CAMERA_DISTANCE + VD::Vec3(0, VD::CAMERA_HEIGHT, 0);
}

VD::Mat4 PlayerShip::viewProj() const {
    VD::Vec3 eye = camPos();
    VD::Vec3 center = m_pos + forward() * 10.0f;
    VD::Vec3 up(0, 1, 0);
    // FOV based on speed
    float speed = glm::length(m_vel);
    float fov = VD::CAMERA_FOV_REST + (VD::CAMERA_FOV_MAX - VD::CAMERA_FOV_REST) * glm::clamp(speed / VD::MAX_SHIP_SPEED, 0.0f, 1.0f);
    return VD::Mat4(glm::lookAt(eye, center, up)) * VD::Mat4(glm::perspective(fov, 16.0f/9.0f, 0.1f, 2000.0f));
}

void PlayerShip::muzzlePositions(VD::Vec3& m0, VD::Vec3& m1, VD::Vec3& m2, VD::Vec3& m3) const {
    VD::Vec3 f = forward();
    VD::Vec3 r = right();
    // 4 muzzles: 2 wing tips + 2 body
    VD::Vec3 wingOffset = r * 2.5f + VD::Vec3(0, -0.5f, 0);
    VD::Vec3 bodyOffset = VD::Vec3(0, 0.3f, 0);
    m0 = m_pos + f * 3.0f + wingOffset;
    m1 = m_pos + f * 3.0f - wingOffset;
    m2 = m_pos + f * 2.0f + bodyOffset + r * 0.8f;
    m3 = m_pos + f * 2.0f + bodyOffset - r * 0.8f;
}
