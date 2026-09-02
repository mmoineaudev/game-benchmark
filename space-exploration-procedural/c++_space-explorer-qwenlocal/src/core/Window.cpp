#include "core/Window.hpp"
#include <iostream>
#include <GLFW/glfw3.h>
#include "core/Constants.hpp"

namespace SH {

GLFWwindow* Window::glfwWindow = nullptr;

Window::Window(int width, int height, const std::string& title)
    : width_(width), height_(height), vsync_(true), cursorPos_(0, 0), cursorDelta_(0, 0) {
    glfwInit();
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);

    window_ = glfwCreateWindow(width, height, title.c_str(), nullptr, nullptr);
    if (!window_) {
        std::cerr << "[Window] Failed to create GLFW window\n";
        glfwTerminate();
        exit(EXIT_FAILURE);
    }

    glfwMakeContextCurrent(window_);
    glfwSetWindowUserPointer(window_, this);

    // Enable V-Sync
    glfwSwapInterval(vsync_ ? 1 : 0);

    // Set callbacks
    glfwSetWindowSizeCallback(window_, [](GLFWwindow* w, int w2, int h2) {
        Window* win = static_cast<Window*>(glfwGetWindowUserPointer(w));
        if (win && win->onFramebufferSizeCB_) {
            win->onFramebufferSizeCB_(w2, h2);
        }
    });

    glfwSetCursorPosCallback(window_, [](GLFWwindow* w, double x, double y) {
        Window* win = static_cast<Window*>(glfwGetWindowUserPointer(w));
        if (win) {
            Vec2 newPos(static_cast<float>(x), static_cast<float>(y));
            win->cursorDelta_ = newPos - win->cursorPos_;
            win->cursorPos_ = newPos;
            if (win->onCursorPosCB_) {
                win->onCursorPosCB_(x, y);
            }
        }
    });

    glfwSetMouseButtonCallback(window_, [](GLFWwindow* w, int button, int action, int mods) {
        Window* win = static_cast<Window*>(glfwGetWindowUserPointer(w));
        if (win && win->onMouseButtonCB_) {
            win->onMouseButtonCB_(button, action, mods);
        }
    });

    glfwSetKeyCallback(window_, [](GLFWwindow* w, int key, int scancode, int action, int mods) {
        Window* win = static_cast<Window*>(glfwGetWindowUserPointer(w));
        if (win && win->onKeyCB_) {
            win->onKeyCB_(key, scancode, action, mods);
        }
    });

    glfwSetCharCallback(window_, [](GLFWwindow* w, unsigned int codepoint) {
        Window* win = static_cast<Window*>(glfwGetWindowUserPointer(w));
        if (win && win->onCharCB_) {
            win->onCharCB_(codepoint);
        }
    });

    glfwSetInputMode(window_, GLFW_CURSOR, GLFW_CURSOR_NORMAL);

    glfwWindow = window_;

    std::cout << "[Window] Created " << width << "x" << height << " window: " << title << "\n";
}

Window::~Window() {
    if (window_) {
        glfwDestroyWindow(window_);
        glfwWindow = nullptr;
    }
    glfwTerminate();
}

Window& Window::instance() {
    if (glfwWindow) {
        return static_cast<Window*>(glfwGetWindowUserPointer(glfwWindow))[0];
    }
    // Return a static instance to avoid undefined behavior
    static Window staticWin(1, 1, "StaticWindow");
    return staticWin;
}

void Window::pollEvents() {
    glfwPollEvents();
}

void Window::swapBuffers() {
    glfwSwapBuffers(window_);
}

void Window::center() {
    GLFWmonitor* monitor = glfwGetPrimaryMonitor();
    if (monitor) {
        const GLFWvidmode* mode = glfwGetVideoMode(monitor);
        glfwSetWindowPos(window_,
            (mode->width - width_) / 2,
            (mode->height - height_) / 2);
    }
}

void Window::setTitle(const std::string& title) {
    glfwSetWindowTitle(window_, title.c_str());
}

void Window::setVSync(bool enabled) {
    vsync_ = enabled;
    glfwSwapInterval(enabled ? 1 : 0);
}

void Window::onMouseMove(std::function<void(float dx, float dy)> cb) {
    // Store the callback for delta-based mouse movement
    onMouseMoveCB_ = cb;
}

void Window::onMouseButton(std::function<void(int button, int action, int mods)> cb) {
    onMouseButtonCB_ = cb;
}

void Window::onKey(std::function<void(int key, int scancode, int action, int mods)> cb) {
    onKeyCB_ = cb;
}

void Window::onChar(std::function<void(unsigned int codepoint)> cb) {
    onCharCB_ = cb;
}

void Window::onFramebufferSize(std::function<void(int w, int h)> cb) {
    onFramebufferSizeCB_ = cb;
}

void Window::onCursorPos(std::function<void(double, double)> cb) {
    onCursorPosCB_ = cb;
}

} // namespace SH
