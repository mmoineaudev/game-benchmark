// ============================================================
// ShaderHelpers — Common GLSL noise functions, gradient templates
// ============================================================

/**
 * Simplex 3D noise — compact GLSL implementation
 * Used in nebula shaders and vertex displacement
 */
export const SIMPLEX_3D_GLSL = `
  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    // First corner
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    // Other corners
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    // Permutations
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    // Gradients
    // (7*7*6 = 294 vectors + 6 nans = 300 ≈ 289)
    float n_ = 1.0/7.0;
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x  = x_ * ns.x + ns.yyyy;
    vec4 y  = y_ * ns.x + ns.yyyy;
    vec4 h  = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    // Normalise gradients
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    // Mix final noise value
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1),
                                 dot(p2,x2), dot(p3,x3)));
  }

  // Fractional Brownian Motion
  float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      value += amplitude * snoise(p * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }
`;

/**
 * Nebula fragment shader template
 */
export const NEBULA_FRAGMENT_SHADER = `
  ${SIMPLEX_3D_GLSL}

  precision mediump float;

  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform float uDensity;
  uniform float uPulse;

  void main() {
    vec3 p = vUv * 3.0 + uTime * 0.05;
    float n = fbm(p, 4) * 0.5 + 0.5;
    n = smoothstep(0.2, 0.9, n);
    n = pow(n, 1.5);

    vec3 color = mix(uColor1, uColor2, n);
    float n2 = snoise(p * 2.0 + uTime * 0.02) * 0.5 + 0.5;
    color = mix(color, uColor3, n2);

    float alpha = n * uDensity * (0.8 + 0.2 * sin(uTime * uPulse));
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Nebula vertex shader (billboard)
 */
export const NEBULA_VERTEX_SHADER = `
  attribute vec3 offset;
  attribute float scale;
  attribute float rotation;

  uniform float uTime;

  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position * scale + offset;
    pos.x += sin(uTime * 0.1 + offset.x) * 0.3;
    pos.y += cos(uTime * 0.12 + offset.y) * 0.2;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

/**
 * Starfield shader — vertex
 */
export const STAR_VERTEX_SHADER = `
  attribute float size;
  attribute float twinkleSpeed;
  attribute float twinkleOffset;

  uniform float uTime;
  uniform float uSpeed;
  uniform vec3 uCameraOffset;
  uniform float uParallaxFactor;

  varying float vAlpha;

  void main() {
    vec3 pos = position;
    // GPU-based parallax: shift positions based on camera movement
    pos.x -= uCameraOffset.x * uParallaxFactor * 0.01;
    pos.y -= uCameraOffset.y * uParallaxFactor * 0.01;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = size * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;

    float twinkle = sin(uTime * twinkleSpeed + twinkleOffset) * 0.3 + 0.7;
    vAlpha = twinkle * (1.0 + uSpeed * 0.5);
  }
`;

/**
 * Starfield shader — fragment
 */
export const STAR_FRAGMENT_SHADER = `
  uniform vec3 uColor;

  varying float vAlpha;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;

    float glow = exp(-dist * 6.0);
    gl_FragColor = vec4(uColor, glow * vAlpha);
  }
`;

/**
 * Exhaust trail shader — vertex
 */
export const EXHAUST_VERTEX_SHADER = `
  attribute float life;
  attribute float maxLife;
  attribute vec3 aVelocity;

  uniform float uTime;

  varying float vLife;

  void main() {
    vLife = life / maxLife;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = mix(3.0, 1.0, vLife) * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Exhaust trail shader — fragment
 */
export const EXHAUST_FRAGMENT_SHADER = `
  uniform vec3 uColor;

  varying float vLife;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;

    float glow = exp(-dist * 8.0);
    vec3 color = mix(uColor, vec3(0.0), vLife * 0.8);
    gl_FragColor = vec4(color, glow * (1.0 - vLife) * 0.8);
  }
`;

/**
 * Explosion shader — vertex
 */
export const EXPLOSION_VERTEX_SHADER = `
  attribute float life;
  attribute float maxLife;

  varying float vLife;

  void main() {
    vLife = life / maxLife;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = mix(8.0, 1.0, vLife) * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Explosion shader — fragment
 */
export const EXPLOSION_FRAGMENT_SHADER = `
  uniform vec3 uStartColor;
  uniform vec3 uEndColor;

  varying float vLife;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;

    float glow = exp(-dist * 6.0);
    vec3 color = mix(uStartColor, uEndColor, vLife);
    float alpha = glow * (1.0 - vLife * vLife);
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Wormhole tunnel vertex shader
 */
export const WORMHOLE_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uDisplacement;

  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vDisplacement;

  void main() {
    vUv = uv;
    vNormal = normal;

    vec3 pos = position;
    float wave = sin(pos.y * 0.1 + uTime * 2.0) * uDisplacement;
    pos.xz += wave * normal.xz;
    vDisplacement = wave;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

/**
 * Wormhole tunnel fragment shader
 */
export const WORMHOLE_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;

  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vDisplacement;

  void main() {
    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
    vec3 color = mix(uColor1, uColor2, vUv.y + sin(uTime) * 0.2);
    color += fresnel * vec3(0.3, 0.4, 0.8);
    float alpha = 0.4 + fresnel * 0.4;
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Engine flame vertex shader
 */
export const FLAME_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uThrust;

  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vNormal = normal;

    vec3 pos = position;
    float flicker = sin(uTime * 15.0 + position.y * 10.0) * 0.05 * uThrust;
    pos.xz += flicker;
    pos.y += uThrust * 0.1;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

/**
 * Engine flame fragment shader
 */
export const FLAME_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uTime;

  varying vec2 vUv;

  void main() {
    float t = vUv.y;
    float flicker = sin(uTime * 20.0 + vUv.x * 20.0) * 0.1;
    float alpha = (1.0 - t) * (0.6 + flicker);
    vec3 color = mix(uColor, vec3(1.0, 0.6, 0.2), t * 0.5);
    gl_FragColor = vec4(color, alpha * 0.7);
  }
`;

/**
 * Laser beam shader — vertex
 */
export const LASER_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Laser beam shader — fragment
 */
export const LASER_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uTime;

  varying vec3 vNormal;

  void main() {
    float pulse = sin(uTime * 30.0) * 0.1 + 0.9;
    gl_FragColor = vec4(uColor * pulse, 1.0);
  }
`;

/**
 * Create a procedural star texture (canvas-based)
 */
export function createStarTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create a procedural noise texture for nebulae
 */
export function createNoiseTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(size, size);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const x = (i / 4) % size;
    const y = Math.floor((i / 4) / size);
    const v = Math.random() * 255;
    imageData.data[i] = v;
    imageData.data[i + 1] = v;
    imageData.data[i + 2] = v;
    imageData.data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
