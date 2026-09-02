#version 460 core
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec3 aColor;
layout(location=3) in float aSeed;

uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uScale;
uniform vec3 uCamPos;

out vec2 vUV;
out vec3 vColor;
out float vSeed;
out vec3 vWorld;

void main() {
    vWorld = aPos;
    vec3 wp = aPos + (uCamRight * aUV.x + uCamUp * aUV.y) * uScale;
    vUV = aUV;
    vColor = aColor;
    vSeed = aSeed;
    gl_Position = uViewProj * vec4(wp, 1.0);
}
