#include "Timing.hpp"
#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#include <cmath>

double Timing::lastTime = 0;
float Timing::fpsSmooth = 60;

float Timing::deltaTime() {
    double now = glfwGetTime();
    if (lastTime == 0) lastTime = now;
    double dt = now - lastTime;
    lastTime = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    if (dt > 0) fpsSmooth = fpsSmooth * 0.9f + (1.0f / dt) * 0.1f;
    return (float)dt;
}

float Timing::fps() {
    return fpsSmooth;
}
