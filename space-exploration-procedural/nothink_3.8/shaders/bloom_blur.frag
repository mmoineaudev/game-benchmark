#version 460 core
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform vec2 uDir;
uniform float uRadius;
void main() {
    // 9-tap Gaussian-like blur
    vec3 sum = texture(uTexture, vUV).rgb;
    for (int i = 1; i <= 4; i++) {
        float t = float(i) * uRadius;
        sum += texture(uTexture, vUV + uDir * t).rgb * 0.25;
        sum += texture(uTexture, vUV - uDir * t).rgb * 0.25;
    }
    fragColor = vec4(sum, 1.0);
}
