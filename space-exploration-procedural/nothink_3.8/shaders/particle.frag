#version 460 core
in vec4 vColor;
out vec4 fragColor;

void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = smoothstep(1.0, 0.1, d) * vColor.a;
    if (a < 0.01) discard;
    fragColor = vec4(vColor.rgb * a, a);
}
