#version 460 core
layout(location=0) in float aAngle;
layout(location=1) in float aRadius;
layout(location=2) in float aBand;

uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform vec3 uUp;
uniform float uTilt;
uniform float uScale;
uniform float uTime;

out float vAngle;
out float vRadius;
out float vBand;

void main() {
    float r = aRadius * uScale;
    float ang = aAngle + uTime * 0.35 / max(aRadius, 0.2);
    float x = cos(ang) * r;
    float z = sin(ang) * r;
    // tilt plane: rotate XZ around Z axis by uTilt (pitch)
    float y = -x * sin(uTilt);
    vec3 off = vec3(x * cos(uTilt), y, z);
    gl_Position = uViewProj * vec4(uCenter + off, 1.0);
    vAngle = ang;
    vRadius = aRadius;
    vBand = aBand;
}
