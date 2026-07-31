import * as THREE from 'three';

// Procedural wreck/city builders (spec v2.0 §3.4.4 / §3.4.5).
// Shared by HulkSystem (derelicts) and CitySystem (finale wrecks + fragments).

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a wrecked ship group (variant 0..2). `palette` = { hull, glow } hex colors.
 * Returns { group, light, strobeMats } — strobeMats drive the blinking beacons.
 */
export function buildHulk(seed, palette) {
  const rng = mulberry(seed);
  const variant = Math.floor(rng() * 3);
  const g = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color: palette.hull,
    metalness: 0.6,
    roughness: 0.85,
  });
  // main hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 7), hullMat);
  hull.position.y = 0.2;
  g.add(hull);
  // broken wings
  const wingMat = hullMat.clone();
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.18, 1.6), wingMat);
  wingL.position.set(-3.2, 0.1, 0.2);
  wingL.rotation.set(0, 0.35, 0.18);
  g.add(wingL);
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 1.4), wingMat);
  wingR.position.set(2.6, 0.15, -0.4);
  wingR.rotation.set(0.2, -0.4, -0.25);
  g.add(wingR);
  // snapped engine cone
  const engineMat = new THREE.MeshStandardMaterial({ color: palette.hull, metalness: 0.7, roughness: 0.6 });
  const engine = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2, 8), engineMat);
  engine.position.set(1.1, -0.4, 4.0);
  engine.rotation.x = Math.PI / 2 + 0.5;
  g.add(engine);
  // scorch decal (dark box)
  const scorch = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 2.2), new THREE.MeshBasicMaterial({ color: 0x1a140e }));
  scorch.position.set(0, 0.95, 1.5);
  g.add(scorch);

  // flickering emergency light (red) + strobe materials
  const strobeMat = new THREE.MeshBasicMaterial({ color: palette.glow, transparent: true, opacity: 0.1, fog: false });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), strobeMat);
  beacon.position.set(0, 1.5, -1.2);
  g.add(beacon);
  const light = new THREE.PointLight(palette.glow, 0.6, 20, 2);
  light.name = 'sig:hulkEmergency';
  light.position.set(0, 1.6, -1.2);
  g.add(light);

  if (variant === 0) hull.scale.set(1, 1, 1);
  else if (variant === 1) { hull.scale.set(0.9, 1.1, 0.8); hull.rotation.z = 0.12; }
  else { hull.scale.set(1.1, 0.8, 1); hull.rotation.y = 0.2; }

  return { group: g, light, strobeMats: [strobeMat], phase: rng() * Math.PI * 2 };
}

/**
 * Build a broken space-city fragment (100–400 u). `windowTex` is the shared
 * canvas texture with emissive windows. Returns { group, light, windowMats }.
 */
export function buildCityFragment(seed, windowTex, palette) {
  const rng = mulberry(seed + 7);
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: palette.hull, metalness: 0.7, roughness: 0.6 });
  const windowMat = new THREE.MeshBasicMaterial({
    map: windowTex,
    transparent: true,
    opacity: 0.9,
    color: palette.window,
    fog: false,
  });

  const variant = Math.floor(rng() * 3);
  const scale = 100 + rng() * 300; // 100..400 u overall
  if (variant === 0) {
    // shattered ring segment (torus arc)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(scale * 0.55, scale * 0.08, 8, 24, Math.PI * 1.4), hullMat);
    ring.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    g.add(ring);
    const win = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.07, scale * 0.07, scale * 0.5, 8, 1, true), windowMat);
    win.position.set(scale * 0.5, scale * 0.1, 0);
    g.add(win);
  } else if (variant === 1) {
    // ruined station superstructure
    const core = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.14, scale * 0.2, scale * 0.5, 12), hullMat);
    core.rotation.z = 0.1;
    g.add(core);
    const win = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.16, scale * 0.22, scale * 0.4, 12, 1, true), windowMat);
    win.rotation.z = 0.1;
    g.add(win);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(scale * 0.5, scale * 0.06, scale * 0.06), hullMat);
      spoke.position.set(Math.cos(i * 1.57) * scale * 0.3, 0, Math.sin(i * 1.57) * scale * 0.3);
      spoke.rotation.y = i * 1.57;
      g.add(spoke);
    }
  } else {
    // broken tower cluster
    for (let i = 0; i < 4; i++) {
      const w = scale * (0.08 + rng() * 0.06);
      const h = scale * (0.4 + rng() * 0.5);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), hullMat);
      tower.position.set((rng() - 0.5) * scale * 0.4, h / 2 - scale * 0.1, (rng() - 0.5) * scale * 0.4);
      tower.rotation.set(rng() * 0.2, rng() * 0.4, rng() * 0.2);
      g.add(tower);
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.9, w * 1.02), windowMat);
      win.position.copy(tower.position);
      win.rotation.copy(tower.rotation);
      g.add(win);
    }
  }
  // one window light (budgeted)
  const light = new THREE.PointLight(palette.window, 1.2, 150, 2);
  light.name = 'sig:cityWindow';
  light.position.set(0, scale * 0.1, 0);
  g.add(light);

  return { group: g, light, windowMats: [windowMat], phase: rng() * Math.PI * 2 };
}
