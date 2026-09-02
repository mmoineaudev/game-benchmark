#version 460 core
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uDir;      // (dx, dy) in texels * spread

void main() {
    vec3 sum = texture(uTex, vUV).rgb * 0.227027;
    vec2 o1 = uDir * 1.3846153846;
    vec2 o2 = uDir * 3.2307692308;
    sum += texture(uTex, vUV + o1).rgb * 0.3162162162;
    sum += texture(uTex, vUV - o1).rgb * 0.3162162162;
    sum += texture(uTex, vUV + o2).rgb * 0.0702702703;
    sum += texture(uTex, vUV - o2).rgb * 0.0702702703;
    fragColor = vec4(sum, 1.0);
}
