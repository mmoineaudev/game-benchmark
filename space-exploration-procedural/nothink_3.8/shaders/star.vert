#version 460 core
layout(location=0) in vec3 aPos;
layout(location=1) in float aSize;
layout(location=2) in vec3 aColor;
layout(location=3) in float aPhase;

uniform mat4 uViewProj;
uniform float uTime;

out vec3 vColor;
out float vTwinkle;

void main() {
    gl_Position = uViewProj * vec4(aPos, 1.0);
    gl_PointSize = aSize;
    vColor = aColor;
    vTwinkle = 0.7 + 0.3 * sin(uTime * 2.0 + aPhase);
}
