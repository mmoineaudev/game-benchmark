#pragma once
#include <GL/glew.h>
#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#include <string>
#include <functional>
#include <cstddef>

class Window {
public:
    static Window& instance();
    bool init(int width = 1920, int height = 1080, const std::string& title = "Void Drift");
    void shutdown();
    void setKeyCallback(std::function<void()> cb);

    GLFWwindow* handle() const { return win; }
    int width() const { return w; }
    int height() const { return h; }
    bool isDown(int key) const { return keys[key]; }
    bool keyPressed(int key) const { return keys[key] && !prevKeys[key]; }
    void updateKeys() {
        for (int i = 0; i < 512; i++) prevKeys[i] = keys[i];
    }
    bool shouldClose() const {
        if (shouldQuit) return true;
        return win && glfwWindowShouldClose(win);
    }
    void swapBuffers() { glfwSwapBuffers(win); }
    void pollEvents() { glfwPollEvents(); }
    void setShouldClose(bool c) { shouldQuit = c; }

    unsigned char keys[512] = {0};

private:
    Window() = default;
    GLFWwindow* win = nullptr;
    int w = 1920, h = 1080;
    unsigned char prevKeys[512] = {0};
    bool shouldQuit = false;
    std::function<void()> keyCb;
};
