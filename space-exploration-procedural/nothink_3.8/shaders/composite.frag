#version 460 core
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uCA;           // chromatic aberration strength
uniform float uVignetteDark;
uniform float uVignetteOffset;
uniform float uGrain;
uniform float uTime;
uniform float uSwirl;        // wormhole swirl intensity
uniform vec2 uRes;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p * 39.42 + 11.3);
    return fract(p.x * p.y * (p.x + p.y));
}

void main() {
    vec2 c = vUV - 0.5;
    vec2 d = vUV;
    // wormhole swirl: rotate UVs around center
    float ang = uSwirl * 0.4 * (1.0 - dot(c, c) * 2.0);
    float s = sin(ang), co = cos(ang);
    d = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;

    float ca = uCA * dot(c, c);
    vec3 scene;
    scene.r = texture(uScene, d + vec2(ca, 0.0)).r;
    scene.g = texture(uScene, d).g;
    scene.b = texture(uScene, d - vec2(ca, 0.0)).b;
    vec3 bloom = texture(uBloom, d).rgb * uBloomStrength;

    vec3 col = scene + bloom;

    // vignette
    float vig = 1.0 - dot(c, c) * (1.0 + uVignetteDark);
    vig = clamp(vig, 0.0, 1.0);
    col *= vig;

    // film grain
    float g = hash21(vUV * uRes + vec2(uTime * 61.7, uTime * 83.3));
    col += (g - 0.5) * uGrain;

    fragColor = vec4(col, 1.0);
}
