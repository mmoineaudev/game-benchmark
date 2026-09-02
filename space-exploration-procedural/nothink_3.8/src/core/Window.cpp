#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#include "Window.hpp"
#include <cstdio>

static Window* g_self = nullptr;

static void keyCallback(GLFWwindow*, int key, int, int act, int) {
    if (key >= 0 && key < 512)
        g_self->keys[key] = (act == GLFW_PRESS) ? 1 : 0;
}

Window& Window::instance() { static Window w; return w; }

bool Window::init(int width, int height, const std::string& title) {
    w = width; h = height;
    if (!glfwInit()) {        return false;
    }
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
    glfwWindowHint(GLFW_SAMPLES, 4);
    glfwWindowHint(GLFW_DOUBLEBUFFER, GLFW_TRUE);
    win = glfwCreateWindow(w, h, title.c_str(), nullptr, nullptr);
    if (!win) {
        glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
        glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 1);
        win = glfwCreateWindow(w, h, title.c_str(), nullptr, nullptr);
    }
    if (!win) {        glfwTerminate();
        return false;
    }
    glfwMakeContextCurrent(win);
    glewInit();
    glfwSwapInterval(1);
    g_self = &Window::instance();
    glfwSetKeyCallback(win, keyCallback);
    const char* ver = (const char*)glGetString(GL_VERSION);    return true;
}

void Window::shutdown() {
    if (win) { glfwDestroyWindow(win); win = nullptr; }
    glfwTerminate();
}

void Window::setKeyCallback(std::function<void()> cb) {
    keyCb = std::move(cb);
}
