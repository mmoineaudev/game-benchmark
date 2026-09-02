#version 460 core
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;
layout(location=2) in float aSize;
layout(location=3) in float aPhase;
layout(location=4) in float aType;
layout(location=5) in vec4 aColor;
layout(location=6) in float aAlive;

uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTime;

out vec4 vColor;
out vec2 vC;
out float vType;
out float vPhase;
out float vAlive;

void main() {
    gl_Position = uViewProj * vec4(aPos + (uCamRight * aCorner.x + uCamUp * aCorner.y) * aSize, 1.0);
    vColor = aColor;
    vC = aCorner * 2.0;
    vType = aType;
    vPhase = aPhase;
    vAlive = aAlive;
}
