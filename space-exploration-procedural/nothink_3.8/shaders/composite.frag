#version 460 core
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uCA;
uniform float uGrain;
uniform float uWormhole;
uniform float uTime;
void main() {
    // Chromatic aberration: sample scene with slight UV offset per channel
    float ca = uCA * 0.003;
    vec2 dir = vUV - 0.5;
    vec3 scene;
    scene.r = texture(uScene, vUV + dir * ca).r;
    scene.g = texture(uScene, vUV).g;
    scene.b = texture(uScene, vUV - dir * ca).b;
    
    // Bloom
    vec3 bloom = texture(uBloom, vUV).rgb;
    
    // Combine
    vec3 color = scene + bloom * uBloomStrength;
    
    // Vignette
    float d = length(dir);
    color *= 1.0 - uVignette * smoothstep(0.3, 0.9, d);
    
    // Film grain
    float grain = fract(sin(dot(vUV * uTime, vec2(12.9898, 78.233))) * 43758.5453);
    color += (grain - 0.5) * uGrain;
    
    // Wormhole tint (subtle)
    color *= vec3(1.0, 1.0, 1.0 + uWormhole * 0.1);
    
    // Gamma-ish tone map
    color = pow(color, vec3(0.95));
    
    fragColor = vec4(color, 1.0);
}
