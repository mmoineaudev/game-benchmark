#version 460 core
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uScene;
void main() {
    vec3 c = texture(uScene, vUV).rgb;
    // Soft threshold: only bright areas contribute
    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    float soft = smoothstep(0.6, 1.0, luma);
    fragColor = vec4(c * soft, 1.0);
}
