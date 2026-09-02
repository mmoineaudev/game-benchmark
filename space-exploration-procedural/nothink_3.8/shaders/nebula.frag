#version 460 core
in vec2 vUV;
in vec3 vColor;
in float vSeed;
in vec3 vWorld;
out vec4 fragColor;

uniform vec3 uCamPos;
uniform float uTime;
uniform float uOpacity;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p * 39.42 + 11.3);
    return fract(p.x * p.y * (p.x + p.y));
}

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1,0)), c = hash21(i + vec2(0,1)), d = hash21(i + vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
}

void main() {
    vec2 p = vUV * 3.0 + vSeed;
    float n = fbm(p + vec2(uTime * 0.01, 0.0));
    float d = length(vUV);
    float falloff = smoothstep(0.5, 0.05, d);
    float density = smoothstep(0.35, 0.85, n) * falloff;
    float dist = length(uCamPos - vWorld);
    float fog = exp(-0.004 * 0.004 * dist * dist);
    float alpha = density * uOpacity * fog;
    if (alpha < 0.005) discard;
    fragColor = vec4(vColor * (0.5 + n * 0.8) * alpha * 1.6, alpha);
}
