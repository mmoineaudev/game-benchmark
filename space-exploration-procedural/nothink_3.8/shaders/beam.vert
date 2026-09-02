#version 460 core
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;
layout(location=2) in float aSize;
layout(location=3) in vec3 aDir;
layout(location=4) in float aAlive;

uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;

out vec4 vColor;
out vec2 vC;

void main() {
    vec3 side = normalize(cross(aDir, uCamRight + uCamUp));
    vec3 up2 = normalize(cross(aDir, side));
    vec3 wp = aPos + (side * aCorner.x + up2 * aCorner.y) * aSize;
    gl_Position = uViewProj * vec4(wp, 1.0);
    vColor = vec4(0.2, 1.0, 0.4, 1.0);
    vC = aCorner * 2.0;
}
