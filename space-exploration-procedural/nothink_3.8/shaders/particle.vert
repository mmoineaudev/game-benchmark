#version 460 core
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aData;   // xyz size, w lifeFrac (1=alive)
layout(location=2) in vec4 aColor;  // rgb, a alpha

uniform mat4 uViewProj;
uniform float uGrow;                // explosion: size multiplies (1-lifeFrac)

out vec4 vColor;

void main() {
    gl_Position = uViewProj * vec4(aPos, 1.0);
    float grow = mix(1.0, (1.0 - aData.w), uGrow);
    gl_PointSize = aData.x * grow;
    vColor = aColor;
}
