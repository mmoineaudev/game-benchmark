#pragma once
#include "utils/Math.hpp"
#include <map>
#include <vector>
#include <functional>
#include <cstdint>
#include <GLFW/glfw3.h>

namespace SH {

// Input system with event.code mapping (AZERTY compatible)
// All binds use physical key positions, not characters
class InputSystem {
public:
    enum class Action : int {
        NONE = 0,
        PITCH_DOWN,      // KeyW (Z on AZERTY)
        PITCH_UP,        // KeyS
        STRAFE_LEFT,     // KeyA (Q on AZERTY)
        STRAFE_RIGHT,    // KeyD
        ROLL_LEFT,       // KeyQ (A on AZERTY)
        ROLL_RIGHT,      // KeyE
        THRUST_FORWARD,  // Shift
        THRUST_BACK,     // Ctrl
        FIRE_TURRET,     // MouseLeft
        BRACE,           // Space
        TOGGLE_MAP,      // KeyM
        PAUSE,           // Escape
        RESTART,         // KeyR
        MUTE,            // KeyN
        COUNT
    };

    InputSystem();
    ~InputSystem() = default;

    // Initialize with GLFW window
    void init(GLFWwindow* window);

    // Poll current input state
    void poll();

    // Action state
    bool isDown(Action action) const { return static_cast<bool>(actions_[static_cast<int>(action)]); }
    bool isPressed(Action action) const { return pressed_[static_cast<int>(action)]; }
    bool isReleased(Action action) const { return released_[static_cast<int>(action)]; }
    bool edgePressed(Action action) const { return edgeDown_[static_cast<int>(action)]; } // edge press (just became true)
    bool edgeReleased(Action action) const { return edgeUp_[static_cast<int>(action)]; }

    // Reset edge-press flags (call at end of frame)
    void resetEdges();

    // Mouse
    Vec2 cursorPos() const { return cursorPos_; }
    Vec2 cursorDelta() const { return cursorDelta_; }
    float mouseScroll() const { return scroll_; }

    // Callbacks (for ImGui integration)
    void setImGuiHandler(std::function<bool(int key, int scancode, int action, int mods)> cb) {
        imguiHandler_ = cb;
    }
    
    // Mouse callback for ImGui integration
    void setImGuiMouseHandler(std::function<bool(int button, int action, int mods)> cb) {
        imguiMouseHandler_ = cb;
    }

    // Key mapping
    static std::map<int, Action> getKeyMap();

    // Print current state (debug)
    void printState() const;

    // Non-copyable
    InputSystem(const InputSystem&) = delete;
    InputSystem& operator=(const InputSystem&) = delete;

private:
    GLFWwindow* window_ = nullptr;
    bool actions_[static_cast<int>(Action::COUNT)] = {};
    bool pressed_[static_cast<int>(Action::COUNT)] = {};
    bool released_[static_cast<int>(Action::COUNT)] = {};
    bool edgeDown_[static_cast<int>(Action::COUNT)] = {};
    bool edgeUp_[static_cast<int>(Action::COUNT)] = {};

    Vec2 cursorPos_ = {0, 0};
    Vec2 cursorDelta_ = {0, 0};
    float scroll_ = 0.0f;

    std::function<bool(int, int, int, int)> imguiHandler_;
    std::function<bool(int, int, int)> imguiMouseHandler_;

    void onMouseButton(int button, int action, int mods);
    void onKey(int key, int scancode, int action, int mods);
    void onMouseCursor(double x, double y);
    void onScroll(double xoffset, double yoffset);
};

} // namespace SH
