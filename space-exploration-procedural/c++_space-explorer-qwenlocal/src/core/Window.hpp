#pragma once
#include <GLFW/glfw3.h>
#include <string>
#include <functional>
#include "core/Constants.hpp"
#include "utils/Math.hpp"

namespace SH {

class Window {
public:
    Window(int width = Constants::WINDOW_WIDTH,
           int height = Constants::WINDOW_HEIGHT,
           const std::string& title = Constants::WINDOW_TITLE);
    ~Window();

    // Non-copyable
    Window(const Window&) = delete;
    Window& operator=(const Window&) = delete;

    bool isOpen() const { return !glfwWindowShouldClose(window_); }
    void pollEvents();
    void swapBuffers();
    void center();

    void setTitle(const std::string& title);
    void setVSync(bool enabled);
    bool isVSync() const { return vsync_; }

    // Getters
    GLFWwindow* raw() const { return window_; }
    Vec2 size() const { return {static_cast<float>(width_), static_cast<float>(height_)}; }
    int width() const { return width_; }
    int height() const { return height_; }

    // Callbacks
    void onMouseCursorPos(std::function<void(double x, double y)> cb);
    void onMouseMove(std::function<void(float dx, float dy)> cb);
    void onMouseButton(std::function<void(int button, int action, int mods)> cb);
    void onKey(std::function<void(int key, int scancode, int action, int mods)> cb);
    void onChar(std::function<void(unsigned int codepoint)> cb);
    void onFramebufferSize(std::function<void(int w, int h)> cb);
    void onCursorPos(std::function<void(double, double)> cb);

    void* nativeHandle() const;

    static Window& instance();

    // Mouse state
    Vec2 cursorPos() const { return cursorPos_; }
    Vec2 cursorDelta() const { return cursorDelta_; }

private:
    GLFWwindow* window_;
    int width_, height_;
    bool vsync_;
    Vec2 cursorPos_;
    Vec2 cursorDelta_;
    Vec2 lastCursorPos_;

    // Callback storage
    std::function<void(float, float)> onMouseMoveCB_;
    std::function<void(int, int, int)> onMouseButtonCB_;
    std::function<void(int, int, int, int)> onKeyCB_;
    std::function<void(unsigned int)> onCharCB_;
    std::function<void(int, int)> onFramebufferSizeCB_;
    std::function<void(double, double)> onCursorPosCB_;

    static GLFWwindow* glfwWindow;
};

} // namespace SH
