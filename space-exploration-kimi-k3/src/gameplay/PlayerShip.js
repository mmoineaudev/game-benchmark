// VOID DRIFT — PlayerShip.js
// Muscle-car silhouette: box fuselage + hemisphere nose, wings, nacelles,
// reactor rings, fins, glass canopy, restrained lights, shader engine flames.
// Mouse steering (unbounded accumulator), cosmetic banking, idle self-level
// (pitch/roll only — never yaw).

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { ENGINE_FLAME_VERTEX, ENGINE_FLAME_FRAGMENT } from '../utils/ShaderHelpers.js';

export class PlayerShip {
  constructor(scene, preset) {
    this._scene = scene;
    this.mesh = null;
    this._flames = [];
    this._glowSprites = [];
    this._hitFlashTime = 0;
    this._idleTime = 0;
    this._bank = 0;
    this._prevYawRate = 0;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._materials = [];
    this._geometries = [];
    this._preset = preset || Constants.SHIP.PRESETS[0];
  }

  init() {
    const S = Constants.SHIP;
    const p = this._preset || S.PRESETS[0];
    this.mesh = new THREE.Group();
    this.mesh.scale.setScalar(p.scale || 1);   // preset scale for ship silhouette
    this.mesh.userData.velocity = new THREE.Vector3();

    const mat = (opts) => { const m = new THREE.MeshStandardMaterial(opts); this._materials.push(m); return m; };
    const geo = (g) => { this._geometries.push(g); return g; };

    const bodyMat = mat({ color: p.body, metalness: 0.75, roughness: 0.35 });
    const trimMat = mat({ color: p.trim, metalness: 0.6, roughness: 0.5 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: p.glass, metalness: 0.1, roughness: 0.05,
      transmission: 0.7, transparent: true, opacity: 0.85,
    });
    this._materials.push(glassMat);
    const engineMat = mat({
      color: 0x222831, metalness: 0.8, roughness: 0.3,
      emissive: p.engine, emissiveIntensity: 1.4,
    });
    const tailMat = mat({
      color: 0x330000, emissive: p.tail, emissiveIntensity: 2.0,
    });
    const wingtipEmissive = S.WINGTIP_EMISSIVE == null ? 2.0 : S.WINGTIP_EMISSIVE;
    const wingtipMat = mat({
      color: 0x111111, emissive: p.accent, emissiveIntensity: wingtipEmissive,
    });

    const shape = (p.shape || 'interceptor');

    // Shared nacelle/light utility
    const placeNacellePackage = (side, x, y, z, isLarge) => {
      const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.18, 0.14, 0.5)), wingtipMat);
      tip.position.set(side * x, y, z);
      this.mesh.add(tip);

      const radius = isLarge ? 0.45 : 0.32;
      const height = isLarge ? 2.3 : 1.8;
      const nacelle = new THREE.Mesh(geo(new THREE.CylinderGeometry(radius, radius + 0.06, height, 12)), trimMat);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(side * x, y, z);
      this.mesh.add(nacelle);

      const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(radius + 0.02, 0.07, 8, 20)), engineMat);
      ring.position.set(side * x, y, z - height * 0.35);
      this.mesh.add(ring);

      const flameMat = new THREE.ShaderMaterial({
        vertexShader: ENGINE_FLAME_VERTEX,
        fragmentShader: ENGINE_FLAME_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0.6 },
          uColor: { value: new THREE.Color(S.ENGINE_COLOR) },
        },
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this._materials.push(flameMat);
      const flame = new THREE.Mesh(geo(new THREE.ConeGeometry(0.16, 1.0, 6)), flameMat);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(side * x, y, z + height * 0.55);
      this.mesh.add(flame);
      this._flames.push({ mesh: flame, mat: flameMat, side });

      const glowMat = new THREE.SpriteMaterial({
        color: S.ENGINE_COLOR || 0x44aaff, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._materials.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(1.5, 1.5, 1);
      glow.position.set(side * x, y, z + height * 0.45);
      this.mesh.add(glow);
      this._glowSprites.push(glow);
    };

    if (shape === 'claymore') {
      // Wide heavy bomber.
      const fuselage = new THREE.Mesh(geo(new THREE.BoxGeometry(2.2, 1.2, 5.2)), bodyMat);
      fuselage.position.set(0, 0.1, 0);
      this.mesh.add(fuselage);

      const nose = new THREE.Mesh(geo(new THREE.SphereGeometry(1.05, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat);
      nose.rotation.x = -Math.PI / 2;
      nose.scale.set(1.05, 1.05, 0.95);
      nose.position.set(0, 0.1, -2.7);
      this.mesh.add(nose);

      const hood = new THREE.Mesh(geo(new THREE.BoxGeometry(1.8, 0.18, 1.9)), trimMat);
      hood.position.set(0, 0.85, -1.5);
      this.mesh.add(hood);
      const trunk = new THREE.Mesh(geo(new THREE.BoxGeometry(1.8, 0.18, 1.2)), trimMat);
      trunk.position.set(0, 0.85, 1.9);
      this.mesh.add(trunk);

      const canopy = new THREE.Mesh(geo(new THREE.BoxGeometry(1.4, 0.65, 1.6)), glassMat);
      canopy.position.set(0, 0.95, 0.2);
      this.mesh.add(canopy);

      const wingGeo = geo(new THREE.BoxGeometry(4.2, 0.18, 1.6));
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(wingGeo, bodyMat);
        wing.position.set(side * 2.7, -0.15, 0.7);
        wing.rotation.z = side * -0.08;
        this.mesh.add(wing);

        const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.9, 0.2, 0.7)), wingtipMat);
        tip.position.set(side * 5.1, -0.15, 0.7);
        this.mesh.add(tip);

        placeNacellePackage(side, 4.5, -0.15, 0.7, true);

        const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.12, 1.05, 1.15)), bodyMat);
        fin.position.set(side * 0.85, 0.72, 2.25);
        fin.rotation.x = -0.25;
        this.mesh.add(fin);
        const tailLight = new THREE.Mesh(geo(new THREE.SphereGeometry(0.11, 8, 6)), tailMat);
        tailLight.position.set(side * 0.95, -0.05, 2.55);
        this.mesh.add(tailLight);
      }

      // Vertical stabilizers.
      for (const side of [-1, 1]) {
        const v = new THREE.Mesh(geo(new THREE.BoxGeometry(0.12, 1.2, 1.4)), trimMat);
        v.position.set(side * 0.7, 1.25, 2.1);
        v.rotation.x = -0.2;
        this.mesh.add(v);
      }
    } else if (shape === 'vanguard') {
      // Long cruiser with side pods.
      const fuselage = new THREE.Mesh(geo(new THREE.BoxGeometry(1.1, 0.55, 5.8)), bodyMat);
      fuselage.position.set(0, 0, 0);
      this.mesh.add(fuselage);

      const nose = new THREE.Mesh(geo(new THREE.SphereGeometry(0.65, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat);
      nose.rotation.x = -Math.PI / 2;
      nose.scale.set(1.0, 1.0, 1.05);
      nose.position.set(0, 0, -2.95);
      this.mesh.add(nose);

      const hood = new THREE.Mesh(geo(new THREE.BoxGeometry(0.9, 0.1, 2.0)), trimMat);
      hood.position.set(0, 0.38, -1.7);
      this.mesh.add(hood);
      const trunk = new THREE.Mesh(geo(new THREE.BoxGeometry(0.9, 0.1, 1.4)), trimMat);
      trunk.position.set(0, 0.38, 2.0);
      this.mesh.add(trunk);

      const canopy = new THREE.Mesh(geo(new THREE.BoxGeometry(0.85, 0.42, 1.7)), glassMat);
      canopy.position.set(0, 0.52, 0.1);
      this.mesh.add(canopy);

      const chin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.55, 0.28, 1.05)), trimMat);
      chin.position.set(0, -0.52, -1.55);
      this.mesh.add(chin);

      const podGeo = geo(new THREE.BoxGeometry(0.95, 0.95, 2.9));
      const podWingGeo = geo(new THREE.BoxGeometry(2.9, 0.12, 1.4));
      for (const side of [-1, 1]) {
        const pod = new THREE.Mesh(podGeo, bodyMat);
        pod.position.set(side * 1.85, -0.05, 0.1);
        this.mesh.add(pod);

        const podWing = new THREE.Mesh(podWingGeo, trimMat);
        podWing.position.set(side * 1.85, -0.45, 0.6);
        podWing.rotation.z = side * 0.08;
        this.mesh.add(podWing);

        const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.6, 0.14, 0.5)), wingtipMat);
        tip.position.set(side * 3.35, -0.45, 0.6);
        this.mesh.add(tip);

        placeNacellePackage(side, 1.85, -0.05, 1.65, false);

        const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.1, 0.65, 0.85)), bodyMat);
        fin.position.set(side * 0.9, 0.5, 2.35);
        fin.rotation.x = -0.25;
        this.mesh.add(fin);
        const tailLight = new THREE.Mesh(geo(new THREE.SphereGeometry(0.09, 8, 6)), tailMat);
        tailLight.position.set(side * 1.0, 0.05, 2.7);
        this.mesh.add(tailLight);
      }
    } else if (shape === 'sprinter') {
      // Small dart.
      const fuselage = new THREE.Mesh(geo(new THREE.BoxGeometry(0.8, 0.52, 3.35)), bodyMat);
      fuselage.position.set(0, 0, 0);
      this.mesh.add(fuselage);

      const nose = new THREE.Mesh(geo(new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat);
      nose.rotation.x = -Math.PI / 2;
      nose.scale.set(1.0, 1.0, 1.05);
      nose.position.set(0, 0, -1.8);
      this.mesh.add(nose);

      const hood = new THREE.Mesh(geo(new THREE.BoxGeometry(0.65, 0.1, 1.45)), trimMat);
      hood.position.set(0, 0.36, -1.2);
      this.mesh.add(hood);
      const trunk = new THREE.Mesh(geo(new THREE.BoxGeometry(0.65, 0.1, 0.9)), trimMat);
      trunk.position.set(0, 0.36, 1.25);
      this.mesh.add(trunk);

      const canopy = new THREE.Mesh(geo(new THREE.BoxGeometry(0.72, 0.38, 1.15)), glassMat);
      canopy.position.set(0, 0.46, 0.05);
      this.mesh.add(canopy);

      const canardGeo = geo(new THREE.BoxGeometry(1.35, 0.09, 0.72));
      for (const side of [-1, 1]) {
        const canard = new THREE.Mesh(canardGeo, trimMat);
        canard.position.set(side * 1.05, 0.05, -0.55);
        canard.rotation.z = side * -0.22;
        this.mesh.add(canard);

        placeNacellePackage(side, 1.25, 0.05, 0.15, false);

        const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.26, 0.11, 0.55)), wingtipMat);
        tip.position.set(side * 2.05, 0.05, 0.15);
        this.mesh.add(tip);

        const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.09, 0.55, 0.72)), bodyMat);
        fin.position.set(side * 0.65, 0.45, 1.7);
        fin.rotation.x = -0.22;
        this.mesh.add(fin);
        const tailLight = new THREE.Mesh(geo(new THREE.SphereGeometry(0.07, 8, 6)), tailMat);
        tailLight.position.set(side * 0.75, 0.0, 2.05);
        this.mesh.add(tailLight);
      }
    } else {
      // Original interceptor shape.
      const fuselage = new THREE.Mesh(geo(new THREE.BoxGeometry(1.6, 0.7, 4.2)), bodyMat);
      fuselage.position.set(0, 0, 0);
      this.mesh.add(fuselage);

      const nose = new THREE.Mesh(geo(new THREE.SphereGeometry(0.8, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat);
      nose.rotation.x = -Math.PI / 2;
      nose.scale.set(1.0, 1.0, 0.9);
      nose.position.set(0, 0, -2.1);
      this.mesh.add(nose);

      const hood = new THREE.Mesh(geo(new THREE.BoxGeometry(1.3, 0.12, 1.6)), trimMat);
      hood.position.set(0, 0.4, -1.3);
      this.mesh.add(hood);
      const trunk = new THREE.Mesh(geo(new THREE.BoxGeometry(1.3, 0.12, 1.0)), trimMat);
      trunk.position.set(0, 0.4, 1.6);
      this.mesh.add(trunk);

      const canopy = new THREE.Mesh(geo(new THREE.BoxGeometry(1.1, 0.5, 1.4)), glassMat);
      canopy.position.set(0, 0.55, 0.1);
      this.mesh.add(canopy);

      const wingGeo = geo(new THREE.BoxGeometry(2.6, 0.1, 1.1));
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(wingGeo, bodyMat);
        wing.position.set(side * 1.9, -0.05, 0.9);
        wing.rotation.z = side * -0.06;
        this.mesh.add(wing);

        const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.18, 0.14, 0.5)), wingtipMat);
        tip.position.set(side * 3.2, -0.05, 0.9);
        this.mesh.add(tip);

        placeNacellePackage(side, 2.9, -0.05, 0.9, false);

        const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.1, 0.7, 0.9)), bodyMat);
        fin.position.set(side * 0.6, 0.55, 1.9);
        fin.rotation.x = -0.2;
        this.mesh.add(fin);
        const tailLight = new THREE.Mesh(geo(new THREE.SphereGeometry(0.09, 8, 6)), tailMat);
        tailLight.position.set(side * 0.7, 0.1, 2.15);
        this.mesh.add(tailLight);
      }
    }

    // Headlight: small, focused, restrained.
    const headlightIntensity = S.HEADLIGHT_INTENSITY == null ? 1.4 : S.HEADLIGHT_INTENSITY;
    const headlightDistance = S.HEADLIGHT_DISTANCE == null ? 80 : S.HEADLIGHT_DISTANCE;
    this._headlight = new THREE.SpotLight(
      0xffffff, headlightIntensity, headlightDistance, Math.PI / 6, 0.6, 1.5);
    this._headlight.position.set(0, 0, -1.5);
    this._headlight.target.position.set(0, 0, -15);
    this.mesh.add(this._headlight);
    this.mesh.add(this._headlight.target);

    const accentColor = S.ACCENT_COLOR || 0x4488ff;
    const accentIntensity = S.ACCENT_INTENSITY == null ? 0.9 : S.ACCENT_INTENSITY;
    const accentDistance = S.ACCENT_DISTANCE == null ? 35 : S.ACCENT_DISTANCE;
    this._accentLight = new THREE.PointLight(accentColor, accentIntensity, accentDistance);
    this._accentLight.position.set(0, 0.8, 0);
    this.mesh.add(this._accentLight);

    // Collect flashable materials for hit feedback.
    this._flashables = [bodyMat, trimMat];

    this._scene.add(this.mesh);
  }

  get position() { return this.mesh.position; }
  get quaternion() { return this.mesh.quaternion; }

  /**
   * Mouse steering: input.mouseX/Y are tanh-bounded per-frame rates.
   * Unbounded yaw; pitch clamped; cosmetic roll banking; idle self-level
   * affects pitch/roll only — never yaw.
   */
  updateRotation(dt, input) {
    if (!this.mesh) return;
    const vel = this.mesh.userData.velocity;
    const speedRatio = Math.min((vel ? vel.length() : 0) / Constants.SHIP.MAX_SPEED, 1);
    const rate = Constants.SHIP.ROTATION_SPEED * (0.6 + 0.4 * speedRatio);

    const yawRate   = -(input.mouseX + (input.keyboardRoll ? 0 : 0)) * rate;
    const pitchRate =  input.mouseY * rate;
    const rollInput = input.keyboardRoll || 0;

    this._euler.setFromQuaternion(this.mesh.quaternion, 'YXZ');
    this._euler.y += yawRate * dt;
    this._euler.x += pitchRate * dt;
    this._euler.x = Math.max(-Constants.INPUT.PITCH_CLAMP, Math.min(Constants.INPUT.PITCH_CLAMP, this._euler.x));
    if (rollInput) this._euler.z += rollInput * dt;

    // Cosmetic banking from yaw rate + strafe input.
    const strafe = input.getStrafeInput ? input.getStrafeInput() : 0;
    const targetBank = Math.max(-Constants.SHIP.MAX_BANK, Math.min(Constants.SHIP.MAX_BANK,
      yawRate * Constants.SHIP.BANK_RATE - strafe * 0.35));
    this._bank += (targetBank - this._bank) * Math.min(6 * dt, 1);
    this._euler.z = this._bank;

    this.mesh.quaternion.setFromEuler(this._euler);
  }

  /** Flame length/intensity track thrust + speed; yaw brightens opposite flame. */
  updateEngineFlames(dt, input, time) {
    if (!this.mesh) return;
    const vel = this.mesh.userData.velocity;
    const speedRatio = Math.min((vel ? vel.length() : 0) / Constants.SHIP.MAX_SPEED, 1);
    const thrusting = input && input.thrust ? 1 : 0;
    const yawSide = input ? Math.sign(input.mouseX) : 0;

    for (const f of this._flames) {
      // Opposite-side flare on yaw, capped at 2× base.
      const yawBoost = (f.side === yawSide && yawSide !== 0) ? 0.5 : 0;
      const intensity = Math.min(0.25 + speedRatio * 0.6 + thrusting * 0.35 + yawBoost, 2.0);
      f.mat.uniforms.uTime.value = time;
      f.mat.uniforms.uIntensity.value = intensity;
      const scale = 0.5 + speedRatio * 0.9 + thrusting * 0.4 + yawBoost;
      f.mesh.scale.set(1, Math.min(scale, 2.0), 1);
    }
    for (const g of this._glowSprites) {
      g.material.opacity = 0.08 + speedRatio * 0.1 + thrusting * 0.06;
    }

    // Hit flash decay.
    if (this._hitFlashTime > 0) {
      this._hitFlashTime -= dt;
      const k = Math.max(this._hitFlashTime / 0.25, 0);
      for (const m of this._flashables) {
        m.emissive.setRGB(0.8 * k, 0.05 * k, 0.05 * k);
        m.emissiveIntensity = 1;
      }
      if (this._hitFlashTime <= 0) {
        for (const m of this._flashables) { m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 1; }
      }
    }
  }

  hitFlash() {
    this._hitFlashTime = 0.25;
  }

  reset() {
    this.mesh.position.set(0, 0, 0);
    const p = this._preset || Constants.SHIP.PRESETS[0];
    this.mesh.scale.setScalar(p.scale || 1);
    this.mesh.quaternion.identity();
    this.mesh.userData.velocity.set(0, 0, 0);
    this._bank = 0;
    this._euler.set(0, 0, 0, 'YXZ');
    this._hitFlashTime = 0;
  }

  setPreset(preset) {
    this._preset = preset;
    if (!this.mesh) return;
    this.destroy();
    this.init();
  }

  destroy() {
    if (this.mesh) {
      this._scene.remove(this.mesh);
      this.mesh = null;
    }
    for (const m of this._materials) m.dispose();
    for (const g of this._geometries) g.dispose();
    this._materials = [];
    this._geometries = [];
    this._flames = [];
    this._glowSprites = [];
  }
}
