#version 460 core
in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vColor;
out vec4 fragColor;

uniform vec3 uColor;
uniform float uEmissive;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCamPos;
uniform int uLightCount;
uniform vec4 uLightPos[16];
uniform vec3 uLightColor[16];

vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (1.42 * x + 0.22) + 0.02), 0.0, 1.0);
}

void main() {
    vec3 uColor2 = vColor * uColor;
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCamPos - vWorldPos);
    float dist = length(uCamPos - vWorldPos);

    vec3 lit = uColor2;
    if (uEmissive < 0.5) {
        vec3 ambient = uColor2 * (0.8 + 0.4 * N.y);
        vec3 col = ambient;
        for (int i = 0; i < uLightCount; i++) {
            vec3 lp = uLightPos[i].xyz;
            vec3 ld = lp - vWorldPos;
            float ldist = length(ld);
            ld /= max(ldist, 0.001);
            float diff = max(dot(N, ld), 0.0);
            float atten = uLightPos[i].w / (1.0 + 0.01 * ldist + 0.0005 * ldist * ldist);
            col += uColor2 * uLightColor[i] * diff * atten;
            vec3 H = normalize(ld - V);
            col += uLightColor[i] * pow(max(dot(N, H), 0.0), 64.0) * 0.35 * atten;
        }
        lit = col;
    } else {
        lit = uColor2 * uEmissive;
    }

    float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    f = clamp(f, 0.0, 1.0);
    vec3 c = mix(lit, uFogColor, f);
    fragColor = vec4(aces(c), 1.0);
}
