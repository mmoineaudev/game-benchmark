import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { STAR_VERTEX, STAR_FRAGMENT } from '../utils/ShaderHelpers.js';

// Multi-layer parallax starfield (spec §5.1): 3 Points layers + 30 bright stars.
// All materials render with fog disabled so exponential fog never swallows them.
export class Starfield {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'starfield';
    scene.add(this.group);

    this._layers = [];
    for (const [name, cfg] of Object.entries(Constants.STAR_LAYERS)) {
      this._layers.push(this._buildLayer(name, cfg));
    }
    this._bright = this._buildBright();
  }

  _buildLayer(name, cfg) {
    const count = cfg.count;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const twinkles = new Float32Array(count);

    const rng = mulberry(1234 + count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rng() * 2 - 1) * Constants.STARFIELD_WRAP;
      positions[i * 3 + 1] = (rng() * 2 - 1) * Constants.STARFIELD_WRAP;
      positions[i * 3 + 2] = (rng() * 2 - 1) * Constants.STARFIELD_WRAP;
      sizes[i] = cfg.size * (0.6 + rng() * 0.8);
      colors[i * 3] = cfg.color[0] * (0.8 + rng() * 0.4);
      colors[i * 3 + 1] = cfg.color[1] * (0.8 + rng() * 0.4);
      colors[i * 3 + 2] = cfg.color[2] * (0.8 + rng() * 0.4);
      twinkles[i] = rng();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uSizeScale: { value: cfg.parallaxSpeed * 2.2 + 0.6 },
      },
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    return { points, cfg, positions };
  }

  _buildBright() {
    const count = Constants.BRIGHT_STAR_COUNT;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const rng = mulberry(999);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rng() * 2 - 1) * 2500;
      positions[i * 3 + 1] = (rng() * 2 - 1) * 2500;
      positions[i * 3 + 2] = (rng() * 2 - 1) * 2500;
      sizes[i] = 3.0 + rng() * 2.0;
      colors[i * 3] = 1;
      colors[i * 3 + 1] = 0.98;
      colors[i * 3 + 2] = 0.92;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(new Float32Array(count), 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uSizeScale: { value: 1.6 },
      },
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    return { points, positions };
  }

  /** Parallax offset + wrapping around the ship. */
  update(dt, shipPos) {
    const wrap = Constants.STARFIELD_WRAP;
    for (const layer of this._layers) {
      const p = layer.points.position;
      p.set(
        shipPos.x * (1 - layer.cfg.parallaxSpeed),
        shipPos.y * (1 - layer.cfg.parallaxSpeed),
        shipPos.z * (1 - layer.cfg.parallaxSpeed),
      );
      // Wrap stars that drift out of the box around the ship
      const pos = layer.positions;
      const count = pos.length / 3;
      for (let i = 0; i < count; i++) {
        const wx = pos[i * 3] + p.x;
        const wy = pos[i * 3 + 1] + p.y;
        const wz = pos[i * 3 + 2] + p.z;
        if (wx - shipPos.x > wrap) pos[i * 3] -= wrap * 2;
        else if (wx - shipPos.x < -wrap) pos[i * 3] += wrap * 2;
        if (wy - shipPos.y > wrap) pos[i * 3 + 1] -= wrap * 2;
        else if (wy - shipPos.y < -wrap) pos[i * 3 + 1] += wrap * 2;
        if (wz - shipPos.z > wrap) pos[i * 3 + 2] -= wrap * 2;
        else if (wz - shipPos.z < -wrap) pos[i * 3 + 2] += wrap * 2;
      }
      layer.points.geometry.attributes.position.needsUpdate = true;
      layer.points.material.uniforms.uTime.value += dt;
    }
    // Bright stars: static, no parallax
    this._bright.points.material.uniforms.uTime.value += dt;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
