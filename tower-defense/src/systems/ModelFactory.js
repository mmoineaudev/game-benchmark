import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════════════════
// Shared geometries (reused across instances)
// ═══════════════════════════════════════════════════════════════════════════
const _sharedBase = new THREE.CylinderGeometry(0.22, 0.28, 0.35, 8);
const _sharedSphere = new THREE.SphereGeometry(1, 8, 8);
const _sharedGlowRing = new THREE.TorusGeometry(1, 0.15, 8, 16);

// ═══════════════════════════════════════════════════════════════════════════
// Enemy fresnel rim-shader material
// ═══════════════════════════════════════════════════════════════════════════
const _rimVert = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}`;

const _rimFrag = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uHitFlash;
uniform float uTime;

void main() {
  // Fresnel rim factor
  float rim = 1.0 - abs(dot(vNormal, vViewDir));
  rim = pow(rim, uRimPower);

  // Base color with subtle noise variation
  float noise = sin(vWorldPos.x * 30.0 + uTime) * sin(vWorldPos.z * 30.0 + uTime * 0.7) * 0.05;
  vec3 baseColor = uColor * (1.0 + noise);

  // Mix: dark center, bright rim
  vec3 col = mix(baseColor * 0.2, baseColor, rim * 0.7 + 0.3);
  // Add emissive rim glow
  col += uEmissive * rim * 0.6;
  // Add colored rim highlight
  col += uRimColor * rim * 0.35;
  // Hit flash (white overlay)
  col = mix(col, vec3(1.0), uHitFlash * 0.7);

  gl_FragColor = vec4(col, 1.0);
}`;

// ── material presets per enemy type ────────────────────────────────────────
const ENEMY_MATERIAL_PRESETS = [
  // 0: Drone — sharp rim, cyan-white edge
  { rimPower: 3.5, rimColor: '#88ccff' },
  // 1: Grunt — softer rim, warm
  { rimPower: 2.8, rimColor: '#ffcc88' },
  // 2: Shield Bearer — medium, blue-white
  { rimPower: 3.0, rimColor: '#aaddff' },
  // 3: Sprinter — sharp, hot edge
  { rimPower: 4.0, rimColor: '#ff8866' },
  // 4: Splitter — soft, green tint
  { rimPower: 2.5, rimColor: '#aaff88' },
  // 5: Tank — dull rim, metallic
  { rimPower: 2.0, rimColor: '#cccccc' },
  // 6: Teleporter — very soft, ghostly
  { rimPower: 1.5, rimColor: '#ddaaff' },
  // 7: Warlord — intense, fiery
  { rimPower: 3.8, rimColor: '#ff6644' },
  // 8: Mothership — broad, pink
  { rimPower: 2.2, rimColor: '#ffaacc' },
  // 9: Core — extreme rim, white-hot
  { rimPower: 5.0, rimColor: '#ffffff' },
];

function _makeRimMaterial(hex, defIdx) {
  const preset = ENEMY_MATERIAL_PRESETS[defIdx] || ENEMY_MATERIAL_PRESETS[0];
  return new THREE.ShaderMaterial({
    vertexShader: _rimVert,
    fragmentShader: _rimFrag,
    uniforms: {
      uColor: { value: new THREE.Color(hex) },
      uEmissive: { value: new THREE.Color(hex).multiplyScalar(0.6) },
      uRimColor: { value: new THREE.Color(preset.rimColor) },
      uRimPower: { value: preset.rimPower },
      uHitFlash: { value: 0 },
      uTime: { value: 0 },
    },
    transparent: false,
    depthWrite: true,
  });
}

// ── tower material (standard, no shader needed) ────────────────────────────
function _towerMat(hex) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    emissive: new THREE.Color(hex),
    emissiveIntensity: 1.4,
    roughness: 0.35,
    metalness: 0.7,
  });
}

// ── glow material (additive, transparent) ──────────────────────────────────
function _glowMat(hex, opacity = 0.5) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(hex),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// ── pedestal with base platform ─────────────────────────────────────────────
function _pedestal(color) {
  const g = new THREE.Group();
  // base platform (wider, flat)
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.08, 12), _towerMat(color));
  plat.position.y = 0.04; g.add(plat);
  // glow ring on platform edge
  const pring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 6, 24), _glowMat(color, 0.35));
  pring.rotation.x = -Math.PI/2; pring.position.y = 0.07; g.add(pring);
  // main pedestal body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.28, 10), _towerMat(color));
  body.position.y = 0.2; g.add(body);
  return g;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOWERS — detailed composite models
// Single-target towers have a `_turret` group (rotates toward the focused
// enemy). Area-effect towers (splash / aura / gravity) have no turret and
// keep their orientation-free idle animation.
// ═══════════════════════════════════════════════════════════════════════════
const _buildTower = {};

function _makeTurret(g) {
  const tg = new THREE.Group();
  tg.name = '_turret';
  g.add(tg);
  return tg;
}

/** Horizontal barrel pointing local +Z (towers aim via turret.rotation.y). */
function _barrel(color, opts = {}) {
  const {
    len = 0.3, r = 0.05, y = 0.5, z = 0.15, x = 0,
    tip = false, tipColor = null, mat = null,
  } = opts;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.2, len, 8),
    mat || _towerMat(color)
  );
  m.rotation.x = Math.PI / 2;           // cylinder Y axis -> +Z
  m.position.set(x, y, z + len / 2);
  const out = [m];
  if (tip) {
    const t = new THREE.Mesh(new THREE.SphereGeometry(r * 1.6, 8, 8), _glowMat(tipColor || color, 0.9));
    t.position.set(x, y, z + len + 0.03);
    t.name = '_muzzle';
    out.push(t);
  }
  return out;
}

// 0 ─ Pulse Emitter ─ dish + directional pulse barrel ──────────────────────
_buildTower[0] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  g.add(_pedestal(color));
  const turret = _makeTurret(g);
  // dish ring
  const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.1, 0.18, 20), _towerMat(color));
  d.position.y = 0.44; turret.add(d);
  const ir = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 20), _glowMat(color, 0.4));
  ir.rotation.x = -Math.PI/2; ir.position.y = 0.52; turret.add(ir);
  // forward pulse barrel + muzzle
  _barrel(color, { len: 0.3, r: 0.07, y: 0.52, z: 0.12, tip: true }).forEach(m => turret.add(m));
  // emitter tip (glow core)
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), _glowMat(color, 0.85));
  tip.position.y = 0.68; tip.name = '_glowCore'; turret.add(tip);
  return g;
};

// 1 ─ Arc Spool ─ energy coil with arc node ─────────────────────────────────
_buildTower[1] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  g.add(_pedestal(color));
  const turret = _makeTurret(g);
  // core cylinder
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 10), _towerMat(color));
  core.position.y = 0.44; turret.add(core);
  // coil rings (stacked toruses)
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 20), _towerMat(color));
    ring.position.y = 0.36 + i * 0.08;
    ring.name = '_ring';
    turret.add(ring);
  }
  // energy orb top
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), _glowMat(color, 0.75));
  orb.position.y = 0.56; orb.name = '_glowCore'; turret.add(orb);
  // directional arc node
  const node = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 6), _glowMat(color, 0.8));
  node.rotation.x = Math.PI / 2; node.position.set(0, 0.56, 0.22); node.name = '_muzzle';
  turret.add(node);
  return g;
};

// 2 ─ Rail Sentry ─ tall precision turret with horizontal rail ──────────────
_buildTower[2] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  // heavy base (static)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.2, 10), _towerMat(color));
  base.position.y = 0.12; g.add(base);
  const turret = _makeTurret(g);
  // pillar
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.55, 10), _towerMat(color));
  p.position.y = 0.42; turret.add(p);
  // rail casing
  const casing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.4), _towerMat(color));
  casing.position.y = 0.7; turret.add(casing);
  // twin vertical rails (decorative)
  for (let sx = -1; sx <= 1; sx += 2) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.28, 0.06), _towerMat(color));
    rail.position.set(sx * 0.08, 0.82, 0); turret.add(rail);
  }
  // horizontal rail barrel + muzzle
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), _towerMat(color));
  rail.position.set(0, 0.72, 0.3); turret.add(rail);
  const mz = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), _glowMat(color, 0.95));
  mz.position.set(0, 0.72, 0.56); mz.name = '_muzzle'; turret.add(mz);
  // glow focus
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), _glowMat(color, 0.9));
  tip.position.y = 0.94; tip.name = '_glowCore'; turret.add(tip);
  return g;
};

// 3 ─ Plasma Mortar ─ heavy artillery (AoE — no turret) ─────────────────────
_buildTower[3] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  // wide armored base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.18, 10), _towerMat(color));
  base.position.y = 0.1; g.add(base);
  // turret housing
  const house = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), _towerMat(color));
  house.position.y = 0.28; g.add(house);
  // barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.35, 10), _towerMat(color));
  barrel.position.y = 0.5; g.add(barrel);
  // muzzle brake
  const mz = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.06, 10), _towerMat(color));
  mz.position.y = 0.68; g.add(mz);
  // muzzle glow
  const gl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), _glowMat(color, 0.7));
  gl.position.y = 0.73; gl.name = '_glowCore'; g.add(gl);
  return g;
};

// 4 ─ Frost Core ─ crystalline shard with frost emitter ─────────────────────
_buildTower[4] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  g.add(_pedestal(color));
  const turret = _makeTurret(g);
  // main crystal (elongated octahedron)
  const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), _towerMat(color));
  c.scale.set(1, 1.4, 1); c.position.y = 0.48; c.name = '_crystal';
  turret.add(c);
  // smaller orbiting shards
  for (let i = 0; i < 3; i++) {
    const a = (i/3)*Math.PI*2;
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), _towerMat(color));
    shard.position.set(Math.cos(a)*0.22, 0.46, Math.sin(a)*0.22);
    shard.name = '_shard'; turret.add(shard);
  }
  // frost aura
  const aura = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), _glowMat(color, 0.25));
  aura.position.y = 0.48; aura.name = '_glowCore'; turret.add(aura);
  // directional frost emitter
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), _glowMat(color, 0.8));
  cone.rotation.x = Math.PI / 2; cone.position.set(0, 0.4, 0.26); cone.name = '_muzzle';
  turret.add(cone);
  return g;
};

// 5 ─ Beam Harvester ─ directional collector dish ───────────────────────────
_buildTower[5] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  g.add(_pedestal(color));
  const turret = _makeTurret(g);
  // collector dish — now points forward (+Z)
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.24, 12), _towerMat(color));
  dish.rotation.x = Math.PI / 2; dish.position.y = 0.5; dish.name = '_dish'; turret.add(dish);
  // support struts
  for (let i = 0; i < 4; i++) {
    const a = (i/4)*Math.PI*2;
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), _towerMat(color));
    strut.position.set(Math.cos(a)*0.14, 0.5, Math.sin(a)*0.14);
    turret.add(strut);
  }
  // focus crystal at dish focal point
  const focus = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), _glowMat(color, 0.85));
  focus.position.set(0, 0.5, 0.28); focus.name = '_glowCore'; turret.add(focus);
  return g;
};

// 6 ─ Tesla Coil ─ high-voltage tower with discharge node ───────────────────
_buildTower[6] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.15, 10), _towerMat(color));
  base.position.y = 0.08; g.add(base);
  const turret = _makeTurret(g);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 0.5, 10), _towerMat(color));
  body.position.y = 0.36; turret.add(body);
  // coil winding (helix approximation with stacked rings)
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 6, 20), _glowMat(color, 0.45));
    ring.position.y = 0.15 + i * 0.1; ring.name = '_ring'; turret.add(ring);
  }
  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.04, 8, 24), _towerMat(color));
  topRing.position.y = 0.63; turret.add(topRing);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), _glowMat(color, 0.9));
  spark.position.y = 0.63; spark.name = '_glowCore'; turret.add(spark);
  // directional discharge node
  const node = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 6), _glowMat(color, 0.8));
  node.rotation.x = Math.PI / 2; node.position.set(0, 0.55, 0.28); node.name = '_muzzle';
  turret.add(node);
  return g;
};

// 7 ─ Railgun Array ─ twin horizontal cannons ───────────────────────────────
_buildTower[7] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.18, 10), _towerMat(color));
  base.position.y = 0.1; g.add(base);
  const turret = _makeTurret(g);
  // turret ring
  const tr = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 20), _towerMat(color));
  tr.rotation.x = -Math.PI/2; tr.position.y = 0.2; turret.add(tr);
  // twin horizontal barrels
  for (let sx = -1; sx <= 1; sx += 2) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.55, 10), _towerMat(color));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(sx * 0.16, 0.42, 0.28); turret.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.05, 8), _towerMat(color));
    brake.rotation.x = Math.PI / 2;
    brake.position.set(sx * 0.16, 0.42, 0.55); turret.add(brake);
  }
  const gl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), _glowMat(color, 0.85));
  gl.position.set(0, 0.62, 0.1); gl.name = '_glowCore'; turret.add(gl);
  const mz = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), _glowMat(color, 0.95));
  mz.position.set(0, 0.42, 0.62); mz.name = '_muzzle'; turret.add(mz);
  return g;
};

// 8 ─ Ion Storm ─ energy vortex (AoE — no turret) ───────────────────────────
_buildTower[8] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  g.add(_pedestal(color));
  // inner orb
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 14), _glowMat(color, 0.4));
  orb.position.y = 0.48; orb.name = '_glowCore'; g.add(orb);
  // outer torus
  const t = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 10, 32), _glowMat(color, 0.55));
  t.position.y = 0.48; t.name = '_ring'; g.add(t);
  // diagonal ring
  const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 28), _glowMat(color, 0.4));
  t2.rotation.x = Math.PI/3; t2.position.y = 0.48; t2.name = '_ring'; g.add(t2);
  return g;
};

// 9 ─ Singularity ─ gravitational lens (AoE — no turret) ────────────────────
_buildTower[9] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.28, 10),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.15, metalness: 0.95 }));
  base.position.y = 0.14; g.add(base);
  // accretion disc
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.35, 40), _glowMat(color, 0.4));
  disc.rotation.x = -Math.PI/2; disc.position.y = 0.48; g.add(disc);
  // event horizon sphere
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 14),
    new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.05, metalness: 1.0 }));
  core.position.y = 0.48; g.add(core);
  // outer ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 12, 40), _glowMat(color, 0.6));
  ring.position.y = 0.48; ring.name = '_ring'; g.add(ring);
  // particle halo
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 32), _glowMat(color, 0.25));
  halo.rotation.x = -Math.PI/2; halo.position.y = 0.48; halo.name = '_glowCore'; g.add(halo);
  return g;
};

// 10 ─ Scatter Gun ─ triple fan barrels ────────────────────────────────────
_buildTower[10] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  g.add(_pedestal(color));
  const turret = _makeTurret(g);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.12, 8), _towerMat(color));
  base.position.y = 0.32; turret.add(base);
  // fan of three horizontal barrels (spread around +Z)
  for (let i = -1; i <= 1; i++) {
    const b = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.34, 6), _towerMat(color));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.5, 0.2);
    b.add(barrel);
    const bmz = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), _glowMat(color, 0.8));
    bmz.position.set(0, 0.5, 0.4);
    b.add(bmz);
    b.rotation.y = i * 0.28;
    turret.add(b);
  }
  const gl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), _glowMat(color, 0.8));
  gl.position.y = 0.66; gl.name = '_glowCore'; turret.add(gl);
  return g;
};

// 11 ─ Void Lance ─ sleek horizontal piercing rail ──────────────────────────
_buildTower[11] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.25, 8), _towerMat(color));
  base.position.y = 0.15; g.add(base);
  const turret = _makeTurret(g);
  const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.6, 8), _towerMat(color));
  lance.rotation.x = Math.PI / 2;
  lance.position.set(0, 0.45, 0.3); turret.add(lance);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 6), _towerMat(color));
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0, 0.45, 0.62); turret.add(tip);
  const gl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), _glowMat(color, 0.85));
  gl.position.set(0, 0.62, 0.08); gl.name = '_glowCore'; turret.add(gl);
  const mz = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), _glowMat(color, 0.95));
  mz.position.set(0, 0.45, 0.72); mz.name = '_muzzle'; turret.add(mz);
  return g;
};

// 12 ─ Corrosive Spire ─ green crystal obelisk with spout ───────────────────
_buildTower[12] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  g.add(_pedestal(color));
  const turret = _makeTurret(g);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 6), _towerMat(color));
  spire.position.y = 0.48; turret.add(spire);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), _glowMat(color, 0.7));
  orb.position.y = 0.7; orb.name = '_glowCore'; turret.add(orb);
  const spout = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 6), _glowMat(color, 0.85));
  spout.rotation.x = Math.PI / 2; spout.position.set(0, 0.55, 0.24); spout.name = '_muzzle';
  turret.add(spout);
  return g;
};

// 13 ─ Chrono Prism ─ floating crystal with orbiting rings (aura — no turret) ──
_buildTower[13] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  g.add(_pedestal(color));
  const prism = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), _towerMat(color));
  prism.position.y = 0.48; prism.name = '_crystal'; g.add(prism);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 8, 24), _glowMat(color, 0.5));
  ring1.position.y = 0.48; ring1.name = '_ring'; g.add(ring1);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.03, 8, 24), _glowMat(color, 0.35));
  ring2.rotation.x = Math.PI/2; ring2.position.y = 0.48; ring2.name = '_ring'; g.add(ring2);
  const gl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), _glowMat(color, 0.25));
  gl.position.y = 0.48; gl.name = '_glowCore'; g.add(gl);
  return g;
};

// 14 ─ Doom Cannon ─ massive horizontal heavy artillery ─────────────────────
_buildTower[14] = (color) => {
  const g = new THREE.Group(); g.name = '_tower';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.22, 10), _towerMat(color));
  base.position.y = 0.13; g.add(base);
  const turret = _makeTurret(g);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.4, 10), _towerMat(color));
  body.position.y = 0.4; turret.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.5, 10), _towerMat(color));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.55, 0.28); turret.add(barrel);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.07, 8), _towerMat(color));
  brake.rotation.x = Math.PI / 2;
  brake.position.set(0, 0.55, 0.55); turret.add(brake);
  const gl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), _glowMat(color, 0.8));
  gl.position.set(0, 0.7, 0.05); gl.name = '_glowCore'; turret.add(gl);
  const mz = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), _glowMat(color, 0.95));
  mz.position.set(0, 0.55, 0.62); mz.name = '_muzzle'; turret.add(mz);
  return g;
};

// ═══════════════════════════════════════════════════════════════════════════
// ENEMIES — distinctive shapes + fresnel rim shader
// ═══════════════════════════════════════════════════════════════════════════
const _buildEnemy = {};

// 0 ─ Drone ─ diamond / octahedron
_buildEnemy[0] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(scale * 0.7, 0), _makeRimMaterial(color, defIdx));
  body.name = '_body'; g.add(body);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.18, 6, 6), _glowMat(color, 0.9));
  eye.position.set(0, 0, scale * 0.35); eye.name = '_eye'; g.add(eye);
  return g;
};

// 1 ─ Grunt ─ boxy with spikes
_buildEnemy[1] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const body = new THREE.Mesh(new THREE.BoxGeometry(scale * 0.65, scale * 0.5, scale * 0.55), _makeRimMaterial(color, defIdx));
  body.name = '_body'; g.add(body);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.ConeGeometry(scale * 0.12, scale * 0.3, 4), _makeRimMaterial(color, defIdx));
    s.position.set(Math.cos(angle) * scale * 0.32, scale * 0.5, Math.sin(angle) * scale * 0.26);
    s.name = '_spike'; g.add(s);
  }
  return g;
};

// 2 ─ Shield Bearer ─ sphere + ring
_buildEnemy[2] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const body = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.5, 12, 12), _makeRimMaterial(color, defIdx));
  body.name = '_body'; g.add(body);
  const shield = new THREE.Mesh(new THREE.TorusGeometry(scale * 0.55, scale * 0.07, 8, 24), _glowMat(color, 0.5));
  shield.rotation.x = Math.PI/2; shield.position.y = scale * 0.05; shield.name = '_shield'; g.add(shield);
  return g;
};

// 3 ─ Sprinter ─ arrow/cone
_buildEnemy[3] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const body = new THREE.Mesh(new THREE.ConeGeometry(scale * 0.42, scale * 1.0, 6), _makeRimMaterial(color, defIdx));
  body.rotation.x = -Math.PI/2; body.name = '_body'; g.add(body);
  const eg = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.2, 6, 6), _glowMat(color, 0.7));
  eg.position.set(0, 0, -scale * 0.45); eg.name = '_engine'; g.add(eg);
  return g;
};

// 4 ─ Splitter ─ dual lobes
_buildEnemy[4] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const s = scale * 0.35;
  const l1 = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 8), _makeRimMaterial(color, defIdx));
  l1.position.set(-s * 0.7, 0, 0); l1.name = '_lobe'; g.add(l1);
  const l2 = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 8), _makeRimMaterial(color, defIdx));
  l2.position.set(s * 0.7, 0, 0); l2.name = '_lobe'; g.add(l2);
  const conn = new THREE.Mesh(new THREE.SphereGeometry(s * 0.6, 6, 6), _glowMat(color, 0.6));
  conn.name = '_body'; g.add(conn);
  return g;
};

// 5 ─ Tank ─ heavy hexagonal
_buildEnemy[5] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.45, scale * 0.52, scale * 0.5, 6), _makeRimMaterial(color, defIdx));
  body.name = '_body'; g.add(body);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.BoxGeometry(scale * 0.22, scale * 0.1, scale * 0.18), _makeRimMaterial(color, defIdx));
    p.position.set(Math.cos(a) * scale * 0.38, 0, Math.sin(a) * scale * 0.38);
    p.name = '_plate'; g.add(p);
  }
  return g;
};

// 6 ─ Teleporter ─ ghostly
_buildEnemy[6] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const mat = _makeRimMaterial(color, defIdx);
  mat.transparent = true; mat.opacity = 0.8; mat.depthWrite = true;
  const body = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.45, 8, 8), mat);
  body.name = '_body'; g.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(scale * 0.52, scale * 0.04, 8, 16), _glowMat(color, 0.4));
  ring.rotation.x = Math.PI/4; ring.name = '_ring'; g.add(ring);
  return g;
};

// 7 ─ Warlord ─ boss, dodecahedron + horns
_buildEnemy[7] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(scale * 0.6, 0), _makeRimMaterial(color, defIdx));
  body.name = '_body'; g.add(body);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const h = new THREE.Mesh(new THREE.ConeGeometry(scale * 0.15, scale * 0.55, 4), _makeRimMaterial(color, defIdx));
    h.position.set(Math.cos(a) * scale * 0.5, scale * 0.35, Math.sin(a) * scale * 0.5);
    h.rotation.z = (Math.cos(a) > 0 ? 1 : -1) * 0.4; h.name = '_horn'; g.add(h);
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.18, 6, 6), _glowMat(color, 0.9));
  eye.position.set(0, 0, scale * 0.45); eye.name = '_eye'; g.add(eye);
  return g;
};

// 8 ─ Mothership ─ saucer
_buildEnemy[8] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const bd = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.55, 12, 8, 0, Math.PI*2, 0, Math.PI/2), _makeRimMaterial(color, defIdx));
  bd.name = '_bottom'; g.add(bd);
  const td = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.35, 12, 8, 0, Math.PI*2, 0, Math.PI/2), _makeRimMaterial(color, defIdx));
  td.position.y = scale * 0.02; td.name = '_top'; g.add(td);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(scale * 0.52, scale * 0.06, 8, 24), _glowMat(color, 0.5));
  rim.rotation.x = Math.PI/2; rim.position.y = scale * 0.01; rim.name = '_rim'; g.add(rim);
  return g;
};

// 9 ─ Core ─ sphere + orbiting rings
_buildEnemy[9] = (color, scale, defIdx) => {
  const g = new THREE.Group(); g.name = '_enemy';
  const body = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.5, 16, 16), _makeRimMaterial(color, defIdx));
  body.name = '_body'; g.add(body);
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(scale * 0.6, scale * 0.04, 8, 32), _glowMat(color, 0.5));
  r1.name = '_ringA'; g.add(r1);
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(scale * 0.58, scale * 0.04, 8, 32), _glowMat(color, 0.4));
  r2.rotation.x = Math.PI/3; r2.rotation.z = Math.PI/4; r2.name = '_ringB'; g.add(r2);
  return g;
};

// ═══════════════════════════════════════════════════════════════════════════
// Static smoke aura for area-effect towers (cheap replacement for per-shot FX)
// ═══════════════════════════════════════════════════════════════════════════
const _smokeTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

function _smokeSprite(color, scale, opacity, y) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: _smokeTex,
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  s.scale.setScalar(scale);
  s.position.y = y;
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════
export default class ModelFactory {
  static buildTower(defIdx) {
    const b = _buildTower[defIdx];
    if (!b) { const g = new THREE.Group(); g.add(_pedestal('#888')); return g; }
    return b;
  }

  /** Static smoke cloud marking an area-effect tower's zone (zero per-frame cost). */
  static buildAuraSmoke(color, radius) {
    const g = new THREE.Group();
    g.name = '_auraSmoke';
    // ground haze marking the effect zone
    g.add(_smokeSprite(color, radius * 2, 0.1, 0.05));
    // a few floating puffs above the tower
    const puffs = 5;
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + 0.6;
      const r = 0.35 + Math.random() * 0.3;
      const puff = _smokeSprite(color, 0.32 + Math.random() * 0.18, 0.16, 0.45 + Math.random() * 0.5);
      puff.position.x = Math.cos(a) * r;
      puff.position.z = Math.sin(a) * r;
      g.add(puff);
    }
    return g;
  }

  static buildEnemy(defIdx, scale, color) {
    const b = _buildEnemy[defIdx];
    if (!b) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(scale * 0.5, 1),
        _makeRimMaterial('#888888', 0)));
      return g;
    }
    return b(color, scale, defIdx);
  }

  // ── hit flash ────────────────────────────────────────────────────────
  static flashEnemy(group) {
    group.traverse(child => {
      if (child.material && child.material.uniforms && child.material.uniforms.uHitFlash) {
        child.material.uniforms.uHitFlash.value = 1.0;
      }
    });
  }

  // ── tower animation ──────────────────────────────────────────────────
  static animateTower(group, defIdx, time) {
    const glow = group.getObjectByName('_glowCore');
    if (glow && glow.material && glow.material.opacity !== undefined) {
      glow.material.opacity = 0.35 + Math.sin(time * 2.5 + defIdx) * 0.25 + 0.40;
    }
    // Pulse muzzle nodes (directional barrel tips)
    const muzzles = group.getObjectsByProperty('name', '_muzzle');
    for (const m of muzzles) {
      if (m.material && m.material.opacity !== undefined) {
        m.material.opacity = 0.55 + Math.sin(time * 6 + defIdx * 1.7) * 0.35;
      }
    }
    // Rotate all rings (recursive — rings may live inside the turret group)
    const rings = group.getObjectsByProperty('name', '_ring');
    for (const c of rings) c.rotation.y += 0.02;
    const dish = group.getObjectByName('_dish');
    if (dish) dish.position.y = 0.46 + Math.sin(time * 3) * 0.03;
    const crystal = group.getObjectByName('_crystal');
    if (crystal) crystal.rotation.y += 0.03;
    // Orbiting shards for frost core (recursive)
    const shards = group.getObjectsByProperty('name', '_shard');
    if (shards.length > 0) {
      const orbitSpeed = 1.2;
      shards.forEach((s, i) => {
        const a = (i / shards.length) * Math.PI * 2 + time * orbitSpeed;
        s.position.x = Math.cos(a) * 0.22;
        s.position.z = Math.sin(a) * 0.22;
        s.position.y = 0.46 + Math.sin(time * 3 + i) * 0.04;
      });
    }
  }

  // ── enemy animation ──────────────────────────────────────────────────
  static animateEnemy(group, defIdx, time, speed) {
    // Update time uniform on all rim shaders
    group.traverse(child => {
      if (child.material && child.material.uniforms && child.material.uniforms.uTime) {
        child.material.uniforms.uTime.value = time;
      }
      // Decay hit flash
      if (child.material && child.material.uniforms && child.material.uniforms.uHitFlash) {
        child.material.uniforms.uHitFlash.value *= 0.85;
      }
    });

    const body = group.getObjectByName('_body');
    if (body) {
      body.position.y = Math.sin(time * 3 + defIdx * 0.7) * 0.06;
      if ([0, 4, 6, 9].includes(defIdx)) body.rotation.y += 0.02;
    }
    const eye = group.getObjectByName('_eye');
    if (eye && eye.material && eye.material.opacity !== undefined) {
      eye.material.opacity = 0.5 + Math.sin(time * 5) * 0.4;
    }
    const engine = group.getObjectByName('_engine');
    if (engine && engine.scale) engine.scale.setScalar(0.8 + Math.sin(time * 8) * 0.2);
    const ring = group.getObjectByName('_ring');
    if (ring) ring.rotation.z += 0.015;
    const ringA = group.getObjectByName('_ringA');
    if (ringA) ringA.rotation.y += 0.01;
    const ringB = group.getObjectByName('_ringB');
    if (ringB) ringB.rotation.x += 0.008;
    const shield = group.getObjectByName('_shield');
    if (shield) shield.rotation.z += 0.02;
    const rim = group.getObjectByName('_rim');
    if (rim) rim.rotation.y += 0.01;
    // Splitter lobes orbit
    const lobes = group.children.filter(c => c.name === '_lobe');
    if (lobes.length >= 2) {
      const orbitAngle = time * 1.5;
      const orbR = 0.12;
      lobes[0].position.set(Math.cos(orbitAngle) * orbR, 0, Math.sin(orbitAngle) * orbR);
      lobes[1].position.set(Math.cos(orbitAngle + Math.PI) * orbR, 0, Math.sin(orbitAngle + Math.PI) * orbR);
    }
  }
}