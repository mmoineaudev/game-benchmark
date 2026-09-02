#include "InputSystem.hpp"
#include "Window.hpp"
#include "EventBus.hpp"
#include "Constants.hpp"
#include <cmath>

void InputSystem::init() {
    m_firing = m_shield = m_pause = m_mute = m_restart = m_lightProfile = m_ladderChart = false;
    m_throttle = 0.5f;
}

void InputSystem::update() {
    auto& w = Window::instance();
    m_firing = w.isDown(GLFW_KEY_SPACE);
    m_shield = w.isDown(GLFW_KEY_RIGHT_CONTROL) || w.isDown(GLFW_KEY_LEFT_CONTROL);

    // AZERTY: Z=up, S=down (pitch), Q=left, D=right (yaw), A/E = roll
    float pitchVel = 0, yawVel = 0, rollVel = 0;
    if (w.isDown(GLFW_KEY_Z) || w.isDown(GLFW_KEY_W)) pitchVel += VD::KEYBOARD_PITCH_SPEED;
    if (w.isDown(GLFW_KEY_S)) pitchVel -= VD::KEYBOARD_PITCH_SPEED;
    if (w.isDown(GLFW_KEY_Q) || w.isDown(GLFW_KEY_A)) yawVel -= VD::KEYBOARD_PITCH_SPEED;
    if (w.isDown(GLFW_KEY_D) || w.isDown(GLFW_KEY_E)) yawVel += VD::KEYBOARD_PITCH_SPEED;

    m_pitchVel = pitchVel;
    m_yawVel = yawVel;
    m_rollVel = 0; // roll via mouse

    if (w.keyPressed(GLFW_KEY_ESCAPE)) m_pause = true;
    if (w.keyPressed(GLFW_KEY_M)) m_mute = true;
    if (w.keyPressed(GLFW_KEY_R)) m_restart = true;
    if (w.keyPressed(GLFW_KEY_L)) m_lightProfile = true;
    if (w.keyPressed(GLFW_KEY_C)) m_ladderChart = true;
}

void InputSystem::shutdown() {
    Window::instance().shutdown();
}

float InputSystem::pitchDelta() const { return m_pitchVel; }
float InputSystem::yawDelta() const { return m_yawVel; }
float InputSystem::rollDelta() const { return m_rollVel; }
