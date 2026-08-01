import * as THREE from 'three';

// Generalized articulated bone rig for the humanoid enemy families
// (Skeleton, Armored, Archer, Brute, Magician) AND any future humanoid.
// Extracted from the original Skeleton.js rig so all subclasses share ONE
// 12-joint skeleton, one proportion ladder, and one gait/pedalles vocabulary —
// the single biggest coherence win for the entity redesign.
//
// Standard joint layout (all local offsets relative to parent):
//   root -> pelvis (0, 0.95, 0)
//     pelvis -> spine (0, 0.45, 0)
//       spine -> ribcage (0, 0.55, 0)
//         ribcage -> head (0, 0.35, 0)
//         ribcage -> armL/armR (±0.28, 0.42, 0)
//           arm -> forearm (±0, -0.40, 0)
//     pelvis -> legL/legR (±0.12, -0.95, 0)
//       leg -> shin (±0, -0.45, 0)
export class Rig {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.proportional = opts.proportional !== undefined ? opts.proportional : 1.0;
    this.scale = opts.scale || 1.0;      // whole-rig scale (brute/ogre)
    this.boneWidth = opts.boneWidth || 0.09; // limb box width baseline
    this.tall = opts.tall || false;         // larger vertical proportions

    this.group = new THREE.Group();
    this.bones = {};      // named joints -> THREE.Group
    this.parts = [];      // every mesh, for fade/dispose/raycast
    this.mats = [];       // every material, for fade/dispose
    this._glowTex = opts.glowTex || null; // optional shared glow texture

    if (this.scale !== 1) this.group.scale.setScalar(this.scale);
    if (opts.addToScene !== false) this.scene.add(this.group);
  }

  _bone(name, x, y, z, parent) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    (parent || this.group).add(g);
    this.bones[name] = g;
    return g;
  }

  mesh(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    (parent || this.group).add(m);
    this.parts.push(m);
    return m;
  }

  // Register a material for fade/dispose tracking.
  trackMat(mat) { this.mats.push(mat); return mat; }

  setEye(v, opts = {}) {
    const mats = opts.mats || [];
    for (const m of mats) {
      if (m.opacity !== undefined) m.opacity = v;
      if (m.needsUpdate !== undefined && m.color) m.needsUpdate = true;
    }
  }

  // Shared damp helper (THREE.MathUtils.damp on a numeric target).
  static damp(obj, key, target, lambda, dt) {
    obj[key] = THREE.MathUtils.damp(obj[key], target, lambda, dt);
  }

  // ------------------------------------------------------------- pose setup
  // Zero every joint so pose functions can compose from a clean reference.
  zeroPose() {
    const b = this.bones;
    for (const key of ['armL', 'armR', 'forearmL', 'forearmR', 'legL', 'legR', 'shinL', 'shinR']) {
      if (b[key]) b[key].rotation.set(0, 0, 0);
    }
    if (b.head) b.head.rotation.set(0, 0, 0);
    if (b.ribcage) b.ribcage.rotation.set(0, 0, 0);
    if (b.root) { b.root.rotation.set(0, 0, 0); b.root.position.set(0, 0, 0); }
  }

  // Shared walk cycle (chase gait). Sets per-joint rotations for the given
  // animTime + phase + speed (cycles/sec). Both legs/arms alternate.
  walkPose(animTime, phase, opts = {}) {
    const b = this.bones;
    const amp = opts.amp !== undefined ? opts.amp : 0.55; // leg swing
    const freq = opts.freq !== undefined ? opts.freq : 9; // steps/sec
    const armAmp = opts.armAmp !== undefined ? opts.armAmp : 0.4;
    const bob = opts.bob !== undefined ? opts.bob : 0.06; // body bob
    const t = animTime;
    const s = Math.sin(t * freq + phase);
    const so = Math.sin(t * freq + phase + Math.PI);

    if (b.legL) b.legL.rotation.x = s * amp;
    if (b.legR) b.legR.rotation.x = so * amp;
    if (b.shinL) b.shinL.rotation.x = Math.max(0, s) * amp * 0.9;
    if (b.shinR) b.shinR.rotation.x = Math.max(0, so) * amp * 0.9;
    if (b.armL) b.armL.rotation.x = so * armAmp;
    if (b.armR) b.armR.rotation.x = s * armAmp;
    if (b.forearmL) b.forearmL.rotation.x = 0.15 + so * 0.1;
    if (b.forearmR) b.forearmR.rotation.x = 0.15 + s * 0.1;
    if (b.root) b.root.position.y = Math.abs(s) * bob;
    if (b.ribcage) b.ribcage.rotation.x = s * (opts.rib === undefined ? 0.03 : opts.rib);
    if (b.head) b.head.rotation.y = Math.sin(t * 4 + phase) * 0.08;
  }

  // Shared idle/dormant hunch + breathing. `crouch` (0..1) folds it down.
  dormantPose(animTime, phase, crouch = 1, opts = {}) {
    const b = this.bones;
    this.zeroPose();
    if (b.root) {
      b.root.position.y = -0.35 * crouch;
      b.root.rotation.x = 0.25 * crouch;
    }
    if (b.legL) b.legL.rotation.x = 1.2 * crouch;
    if (b.legR) b.legR.rotation.x = 1.2 * crouch;
    if (b.shinL) b.shinL.rotation.x = -1.0 * crouch;
    if (b.shinR) b.shinR.rotation.x = -1.0 * crouch;
    if (b.armL) b.armL.rotation.x = 0.6 * crouch;
    if (b.armR) b.armR.rotation.x = 0.6 * crouch;
    if (b.head) b.head.rotation.x = 0.5 * crouch;
    // breathing: ribcage scale pulse (shared)
    if (b.ribcage) b.ribcage.scale.y = 1 + Math.sin(animTime * 1.5 + phase) * 0.02;
    return this.bones;
  }

  // Shared DEAD pose: fall forward then lie flat. Returns progress (0..1);
  // caller decides death fade timing (kept in each enemy's own constants).
  deathPose(animTime, phase, dt, opts = {}) {
    const b = this.bones;
    const damp = Rig.damp;
    if (b.root) {
      damp(b.root, 'rotation', 'x', -Math.PI / 2, 8, dt);
      damp(b.root, 'position', 'y', 0.05, 8, dt);
    }
    if (b.armL) damp(b.armL, 'rotation', 'x', 0.9, 8, dt);
    if (b.armR) damp(b.armR, 'rotation', 'x', 0.9, 8, dt);
    if (b.legL) damp(b.legL, 'rotation', 'x', 0.5, 8, dt);
    if (b.legR) damp(b.legR, 'rotation', 'x', 0.5, 8, dt);
    return 1;
  }

  // Dispose every tracked mesh geometry + material and remove from scene.
  dispose(opts = {}) {
    this.group.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
      }
    });
    for (const m of this.mats) if (m && m.dispose) m.dispose();
    if (opts.glowTex && this._glowTex) this._glowTex.dispose();
    this.scene.remove(this.group);
  }
}
