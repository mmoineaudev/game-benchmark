#version 460 core
in vec4 vColor;
in vec2 vC;
out vec4 fragColor;

void main() {
    float d = abs(vC.y);
    float a = smoothstep(1.0, 0.2, d);
    fragColor = vec4(vColor.rgb * a * 2.0, a);
}
