#version 460 core
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uScene;
uniform float uThreshold;

void main() {
    vec3 c = texture(uScene, vUV).rgb;
    float l = max(max(c.r, c.g), c.b);
    fragColor = vec4(vec3(l - uThreshold) * (l > uThreshold ? 1.0 : 0.0), 1.0);
}
