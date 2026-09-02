#include "systems/InputSystem.hpp"
#include "core/Constants.hpp"
#include "utils/Logging.hpp"
#include <iostream>
#include <GLFW/glfw3.h>

namespace SH {

InputSystem::InputSystem() {
    // Initialize action states to false
    for (int i = 0; i < static_cast<int>(Action::COUNT); i++) {
        actions_[i] = false;
        pressed_[i] = false;
        released_[i] = false;
        edgeDown_[i] = false;
        edgeUp_[i] = false;
    }
}

void InputSystem::init(GLFWwindow* window) {
    window_ = window;
    // Note: We do NOT use glfwSetWindowUserPointer here because the Window class
    // already sets it. Instead, we use a static pointer to 'this'.
    // Also note: We intentionally do NOT set up mouse button callbacks here.
    // ImGui (via ImGui_ImplGlfw_InitForOpenGL) sets up its own mouse callbacks,
    // and we let it handle mouse events for UI interaction.
    // We poll the mouse button state directly in poll() instead.
    static InputSystem* s_self = this;
    glfwSetKeyCallback(window, [](GLFWwindow* w, int key, int scancode, int action, int mods) {
        if (s_self) s_self->onKey(key, scancode, action, mods);
    });
    glfwSetCursorPosCallback(window, [](GLFWwindow* w, double x, double y) {
        if (s_self) s_self->onMouseCursor(x, y);
    });
    glfwSetScrollCallback(window, [](GLFWwindow* w, double xoffset, double yoffset) {
        if (s_self) s_self->onScroll(xoffset, yoffset);
    });
}

std::map<int, InputSystem::Action> InputSystem::getKeyMap() {
    std::map<int, Action> map = {
        {GLFW_KEY_Z, Action::PITCH_DOWN},
        {GLFW_KEY_S, Action::PITCH_UP},
        {GLFW_KEY_Q, Action::STRAFE_LEFT},
        {GLFW_KEY_D, Action::STRAFE_RIGHT},
        {GLFW_KEY_A, Action::ROLL_LEFT},
        {GLFW_KEY_E, Action::ROLL_RIGHT},
        {GLFW_KEY_LEFT_SHIFT, Action::THRUST_FORWARD},
        {GLFW_KEY_LEFT_CONTROL, Action::THRUST_BACK},
        {GLFW_KEY_SPACE, Action::BRACE},
        {GLFW_KEY_M, Action::TOGGLE_MAP},
        {GLFW_KEY_SEMICOLON, Action::TOGGLE_MAP},  // AZERTY layout: M key position
        {GLFW_KEY_ESCAPE, Action::PAUSE},
        {GLFW_KEY_R, Action::RESTART},
        {GLFW_KEY_N, Action::MUTE}
    };
    return map;
}

void InputSystem::poll() {
    // Check mouse buttons manually for edge detection
    int state;
    if (window_) {
        state = glfwGetMouseButton(window_, GLFW_MOUSE_BUTTON_LEFT);
        if (state == GLFW_PRESS) {
            actions_[static_cast<int>(Action::FIRE_TURRET)] = true;
        } else {
            actions_[static_cast<int>(Action::FIRE_TURRET)] = false;
        }
    }
}

void InputSystem::resetEdges() {
    for (int i = 0; i < static_cast<int>(Action::COUNT); i++) {
        pressed_[i] = false;
        released_[i] = false;
        edgeDown_[i] = false;
        edgeUp_[i] = false;
    }
}

void InputSystem::onMouseButton(int button, int action, int mods) {
    // Let ImGui consume the mouse event if it's handling UI
    if (imguiMouseHandler_ && imguiMouseHandler_(button, action, mods)) {
        return;
    }
    
    if (button == GLFW_MOUSE_BUTTON_LEFT && action == GLFW_PRESS) {
        actions_[static_cast<int>(Action::FIRE_TURRET)] = true;
        pressed_[static_cast<int>(Action::FIRE_TURRET)] = true;
        edgeDown_[static_cast<int>(Action::FIRE_TURRET)] = true;
    } else if (button == GLFW_MOUSE_BUTTON_LEFT && action == GLFW_RELEASE) {
        actions_[static_cast<int>(Action::FIRE_TURRET)] = false;
        released_[static_cast<int>(Action::FIRE_TURRET)] = true;
        edgeUp_[static_cast<int>(Action::FIRE_TURRET)] = true;
    }
}

void InputSystem::onKey(int key, int scancode, int action, int mods) {
    if (imguiHandler_ && imguiHandler_(key, scancode, action, mods)) {
        return; // ImGui is consuming this key
    }

    auto map = getKeyMap();
    auto it = map.find(static_cast<int>(key));
    if (it == map.end()) return;

    Action actionEnum = it->second;
    bool isDown = (action == GLFW_PRESS || action == GLFW_REPEAT);
    bool wasDown = actions_[static_cast<int>(actionEnum)];

    if (isDown && !wasDown) {
        actions_[static_cast<int>(actionEnum)] = true;
        pressed_[static_cast<int>(actionEnum)] = true;
        edgeDown_[static_cast<int>(actionEnum)] = true;
    } else if (!isDown && wasDown) {
        actions_[static_cast<int>(actionEnum)] = false;
        released_[static_cast<int>(actionEnum)] = true;
        edgeUp_[static_cast<int>(actionEnum)] = true;
    }
}

void InputSystem::onMouseCursor(double x, double y) {
    cursorPos_ = {static_cast<float>(x), static_cast<float>(y)};
}

void InputSystem::onScroll(double xoffset, double yoffset) {
    scroll_ = static_cast<float>(yoffset);
}

void InputSystem::printState() const {
    std::cout << "[Input] Actions:";
    for (int i = 0; i < static_cast<int>(Action::COUNT); i++) {
        if (actions_[i]) {
            std::cout << " " << i;
        }
    }
    std::cout << std::endl;
}

} // namespace SH
