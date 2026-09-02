#pragma once

class Timing {
public:
    static float deltaTime();
    static float fps();
private:
    static double lastTime;
    static float fpsSmooth;
};
