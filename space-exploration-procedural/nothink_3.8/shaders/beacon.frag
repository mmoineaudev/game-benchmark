#version 460 core
in vec4 vColor;
in vec2 vC;
in float vType;
in float vPhase;
in float vAlive;
out vec4 fragColor;

uniform float uTime;

void main() {
    if (vAlive < 0.5) discard;
    float d = length(vC);
    if (vType < 0.5) {
        // soft glow dot
        float a = smoothstep(1.0, 0.0, d);
        a *= a;
        fragColor = vec4(vColor.rgb * a * vColor.a, a * vColor.a);
    } else {
        // expanding ring
        float r = fract(vPhase);
        float ring = smoothstep(0.06, 0.0, abs(d - r));
        float a = ring * (1.0 - r) * vColor.a;
        fragColor = vec4(vColor.rgb * a * 2.0, a);
    }
}
