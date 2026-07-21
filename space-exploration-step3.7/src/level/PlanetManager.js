// ============================================================
// PlanetManager — large persistent stellar landmarks
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import { mulberry32, chunkSeed } from '../utils/MathHelpers.js';

const PLANET_VERT = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;
  void main(){
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position,1.0)).xyz;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`;

const PLANET_FRAG = `
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uRim;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;

  float band(vec3 p, float freq, float speed){
    return sin(p.y * freq + uTime * speed + sin(p.z * 1.3 + uTime * 0.2) * 1.4);
  }

  void main(){
    vec3 viewDir = normalize(-vPosition);
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 2.6);
    float lat = vUv.y;
    float lon = vUv.x * 6.283185;
    float flow = band(vec3(cos(lon), lat, sin(lon)), 3.5, 0.15)
               + band(vec3(cos(lon*2.1), lat*0.7, sin(lon*2.1)), 6.0, 0.25) * 0.4;
    flow = flow * 0.5 + 0.5;
    vec3 color = mix(uColor1, uColor2, flow);
    color = mix(color, uColor3, smoothstep(0.55, 0.85, flow) * 0.5);
    color += uRim * fresnel * 0.9;
    float alpha = 0.85 + fresnel * 0.15;
    gl_FragColor = vec4(color, alpha);
  }
`;

class PlanetManager {
  constructor(scene) {
    this.scene = scene;
    this._planets = new Map();
    this._spacing = 2800;
    this._viewDistance = 12000;
    this._clock = new THREE.Clock();
  }

  update(shipPos) {
    const cx = Math.round(shipPos.x / this._spacing);
    const cy = Math.round(shipPos.y / this._spacing);
    const cz = Math.round(shipPos.z / this._spacing);
    const needed = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cx+dx},${cy+dy},${cz+dz}`;
          needed.add(key);
          if (!this._planets.has(key)) this._spawnPlanet(cx+dx, cy+dy, cz+dz, key);
        }
      }
    }
    for (const [key, planet] of this._planets) {
      if (!needed.has(key) || !planet?.mesh?.position || planet.mesh.position.distanceToSquared(shipPos) > this._viewDistance * this._viewDistance) {
        this._removePlanet(key);
      }
    }
    const t = this._clock.getElapsedTime();
    for (const [, planet] of this._planets) {
      if (planet.material && planet.material.uniforms) planet.material.uniforms.uTime.value = t;
    }
  }

  _spawnPlanet(gx, gy, gz, key) {
    const seed = chunkSeed(gx * 997, gy * 991, gz * 983);
    const rng = mulberry32(seed);
    const x = gx * this._spacing + (rng() - 0.5) * this._spacing * 0.6;
    const y = gy * this._spacing + (rng() - 0.5) * this._spacing * 0.6;
    const z = gz * this._spacing + (rng() - 0.5) * this._spacing * 0.6;

    const chunkRadius = 3 + Math.floor(rng() * 7);
    const radius = chunkRadius * Constants.CHUNK.WIDTH * 0.5;

    const colorSets = [
      [0x2244aa, 0x7755aa, 0xaaddff, 0x88ddff],
      [0x772200, 0xaa6622, 0xffcc88, 0xff8844],
      [0x005544, 0x22aa66, 0xaaffdd, 0x44ddaa],
      [0x880044, 0xaa3377, 0xffaadd, 0xff88cc],
      [0x003355, 0x2288aa, 0xaaddff, 0x66eeff],
    ];
    const set = colorSets[Math.floor(rng() * colorSets.length)];

    const geo = new THREE.IcosahedronGeometry(radius, 3);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor1: { value: new THREE.Color(set[0]) },
        uColor2: { value: new THREE.Color(set[1]) },
        uColor3: { value: new THREE.Color(set[2]) },
        uRim: { value: new THREE.Color(set[3]) },
      },
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      transparent: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData = { isChunkObject: true, isPlanet: true, radius };
    this.scene.add(mesh);

    const atmoGeo = new THREE.IcosahedronGeometry(radius * 1.12, 2);
    const atmoMat = new THREE.MeshBasicMaterial({ color: set[3], transparent: true, opacity: 0.10, side: THREE.BackSide });
    const atmo = new THREE.Mesh(atmoGeo, atmoMat);
    atmo.position.copy(mesh.position);
    atmo.userData = { isChunkObject: true, isPlanetAtmo: true };
    this.scene.add(atmo);

    this._planets.set(key, { mesh, atmo });
  }

  _removePlanet(key) {
    const planet = this._planets.get(key);
    if (!planet) return;
    [planet.mesh, planet.atmo].forEach(obj => {
      if (!obj) return;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
      this.scene.remove(obj);
    });
    this._planets.delete(key);
  }

  clear() { for (const key of [...this._planets.keys()]) this._removePlanet(key); }
  destroy() { this.clear(); }
}

export default PlanetManager;
