#version 460 core
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aOffset;
layout(location=3) in vec3 aScale;
layout(location=4) in vec3 aColor;

uniform mat4 uViewProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vColor;

void main() {
    // object-space rotate normal by scale (approx; scale is uniform-ish)
    vec3 wp = aPos * aScale + aOffset;
    vec3 n = normalize(aNormal * aScale);
    vWorldPos = wp;
    vNormal = n;
    vColor = aColor;
    gl_Position = uViewProj * vec4(wp, 1.0);
}
