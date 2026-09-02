#version 460 core
in float vAngle;
in float vRadius;
in float vBand;
out vec4 fragColor;

uniform float uTime;

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float noise(float x) {
    float i = floor(x), f = fract(x);
    float a = hash(i), b = hash(i + 1.0);
    return mix(a, b, f * f * (3.0 - 2.0 * f));
}

void main() {
    // Doppler beaming: side facing rotation is blue-shifted (bright), far side red-shifted
    float doppler = sin(vAngle);
    vec3 hot = vec3(1.0, 0.95, 0.8);
    vec3 cool = vec3(0.6, 0.7, 1.0);
    vec3 col = mix(cool, hot, smoothstep(-1.0, 1.0, doppler));

    float swirl = noise(vAngle * 6.0 + vRadius * 9.0 + uTime * 1.5);
    float streaks = 0.5 + 0.5 * noise(vAngle * 24.0 + vRadius * 40.0);
    float intensity = (0.6 + 0.4 * streaks) * (0.5 + 0.5 * swirl);

    // inner edge hot, outer fades
    float inner = smoothstep(0.25, 0.9, vRadius);
    float outer = smoothstep(1.0, 0.55, vRadius);
    float a = intensity * inner * outer;
    a *= 0.9;
    // Doppler brightening
    a *= 1.0 + 0.6 * smoothstep(0.0, 1.0, doppler);

    vec3 c = col * (1.5 + intensity * 2.0) * a;
    fragColor = vec4(c, a);
}
