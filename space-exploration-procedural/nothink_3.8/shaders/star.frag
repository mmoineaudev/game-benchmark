#version 460 core
in vec3 vColor;
in float vTwinkle;
out vec4 fragColor;

void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = smoothstep(1.0, 0.2, d) * vTwinkle;
    if (a < 0.02) discard;
    fragColor = vec4(vColor * a, a);
}
