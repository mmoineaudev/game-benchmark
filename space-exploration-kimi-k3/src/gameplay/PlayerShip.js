// VOID DRIFT — PlayerShip.js
// Muscle-car silhouette: box fuselage + hemisphere nose, wings, nacelles,
// reactor rings, fins, glass canopy, restrained lights, shader engine flames.
// Mouse steering (unbounded accumulator), cosmetic banking, idle self-level
// (pitch/roll only — never yaw).

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { ENGINE_FLAME_VERTEX, ENGINE_FLAME_FRAGMENT } from '../utils/ShaderHelpers.js';

export class PlayerShip {
  constructor(scene) {
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
  }

  init() {
    const S = Constants.SHIP;
    this.mesh = new THREE.Group();
    this.mesh.userData.velocity = new THREE.Vector3();

    const mat = (opts) => { const m = new THREE.MeshStandardMaterial(opts); this._materials.push(m); return m; };
    const geo = (g) => { this._geometries.push(g); return g; };

    const bodyMat = mat({ color: S.BODY_COLOR, metalness: 0.75, roughness: 0.35 });
    const trimMat = mat({ color: S.TRIM_COLOR, metalness: 0.6, roughness: 0.5 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: S.GLASS_COLOR, metalness: 0.1, roughness: 0.05,
      transmission: 0.7, transparent: true, opacity: 0.85,
    });
    this._materials.push(glassMat);
    const engineMat = mat({
      color: 0x222831, metalness: 0.8, roughness: 0.3,
      emissive: S.ENGINE_COLOR, emissiveIntensity: 1.4,
    });
    const tailMat = mat({
      color: 0x330000, emissive: S.TAIL_COLOR, emissiveIntensity: 2.0,
    });
    const wingtipMat = mat({
      color: 0x111111, emissive: S.ACCENT_COLOR, emissiveIntensity: S.WINGTIP_EMISSIVE,
    });

    // Fuselage: long low box + hemisphere nose.
    const fuselage = new THREE.Mesh(geo(new THREE.BoxGeometry(1.6, 0.7, 4.2)), bodyMat);
    fuselage.position.set(0, 0, 0);
    this.mesh.add(fuselage);

    const nose = new THREE.Mesh(geo(new THREE.SphereGeometry(0.8, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat);
    nose.rotation.x = -Math.PI / 2;
    nose.scale.set(1.0, 1.0, 0.9);
    nose.position.set(0, 0, -2.1);
    this.mesh.add(nose);

    // Hood deck + trunk trim.
    const hood = new THREE.Mesh(geo(new THREE.BoxGeometry(1.3, 0.12, 1.6)), trimMat);
    hood.position.set(0, 0.4, -1.3);
    this.mesh.add(hood);
    const trunk = new THREE.Mesh(geo(new THREE.BoxGeometry(1.3, 0.12, 1.0)), trimMat);
    trunk.position.set(0, 0.4, 1.6);
    this.mesh.add(trunk);

    // Glass canopy.
    const canopy = new THREE.Mesh(geo(new THREE.BoxGeometry(1.1, 0.5, 1.4)), glassMat);
    canopy.position.set(0, 0.55, 0.1);
    this.mesh.add(canopy);

    // Wings (low-aspect, mid-rear).
    const wingGeo = geo(new THREE.BoxGeometry(2.6, 0.1, 1.1));
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeo, bodyMat);
      wing.position.set(side * 1.9, -0.05, 0.9);
      wing.rotation.z = side * -0.06;
      this.mesh.add(wing);

      // Wingtip accent lights.
      const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.18, 0.14, 0.5)), wingtipMat);
      tip.position.set(side * 3.2, -0.05, 0.9);
      this.mesh.add(tip);

      // Nacelles on wingtips.
      const nacelle = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.32, 0.38, 1.8, 12)), trimMat);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(side * 2.9, -0.05, 0.9);
      this.mesh.add(nacelle);

      // Reactor ring at nacelle intake.
      const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(0.34, 0.07, 8, 20)), engineMat);
      ring.position.set(side * 2.9, -0.05, 0.0);
      this.mesh.add(ring);

      // Engine flame cone per nacelle (shader).
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
      flame.rotation.x = Math.PI / 2;   // point backward (+Z)
      flame.position.set(side * 2.9, -0.05, 2.2);
      this.mesh.add(flame);
      this._flames.push({ mesh: flame, mat: flameMat, side });

      // Reactor glow sprite (subtle).
      const glowMat = new THREE.SpriteMaterial({
        color: S.ENGINE_COLOR, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._materials.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(1.5, 1.5, 1);
      glow.position.set(side * 2.9, -0.05, 1.9);
      this.mesh.add(glow);
      this._glowSprites.push(glow);
    }

    // Twin tail fins.
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.1, 0.7, 0.9)), bodyMat);
      fin.position.set(side * 0.6, 0.55, 1.9);
      fin.rotation.x = -0.2;
      this.mesh.add(fin);
      const tailLight = new THREE.Mesh(geo(new THREE.SphereGeometry(0.09, 8, 6)), tailMat);
      tailLight.position.set(side * 0.7, 0.1, 2.15);
      this.mesh.add(tailLight);
    }

    // Headlight: small, focused, restrained.
    this._headlight = new THREE.SpotLight(
      0xffffff, S.HEADLIGHT_INTENSITY, S.HEADLIGHT_DISTANCE, Math.PI / 6, 0.6, 1.5);
    this._headlight.position.set(0, 0, -1.5);
    this._headlight.target.position.set(0, 0, -15);
    this.mesh.add(this._headlight);
    this.mesh.add(this._headlight.target);

    // Accent light near cockpit (subtle blue rim).
    this._accentLight = new THREE.PointLight(S.ACCENT_COLOR, S.ACCENT_INTENSITY, S.ACCENT_DISTANCE);
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

    const yawRate = -input.mouseX * rate;
    const pitchRate = input.mouseY * rate;

    this._euler.setFromQuaternion(this.mesh.quaternion, 'YXZ');
    this._euler.y += yawRate * dt;
    this._euler.x += pitchRate * dt;
    this._euler.x = Math.max(-Constants.INPUT.PITCH_CLAMP, Math.min(Constants.INPUT.PITCH_CLAMP, this._euler.x));

    // Cosmetic banking from yaw rate + strafe input.
    const strafe = input.getStrafeInput ? input.getStrafeInput() : 0;
    const targetBank = Math.max(-Constants.SHIP.MAX_BANK, Math.min(Constants.SHIP.MAX_BANK,
      yawRate * Constants.SHIP.BANK_RATE - strafe * 0.35));
    this._bank += (targetBank - this._bank) * Math.min(6 * dt, 1);
    this._euler.z = this._bank;

    // Idle self-level: pitch + roll only, after IDLE_SELF_LEVEL_DELAY with no input.
    const inputStrength = Math.abs(input.mouseX) + Math.abs(input.mouseY);
    if (inputStrength < 0.001) this._idleTime += dt;
    else this._idleTime = 0;
    if (this._idleTime > Constants.INPUT.IDLE_SELF_LEVEL_DELAY) {
      const t = Math.min((this._idleTime - Constants.INPUT.IDLE_SELF_LEVEL_DELAY) * 0.5, 1);
      const k = Constants.INPUT.SELF_LEVEL_RATE * dt * t;
      this._euler.x += (0 - this._euler.x) * k;
      this._bank += (0 - this._bank) * k;
      this._euler.z = this._bank;
    }

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
    this.mesh.quaternion.identity();
    this.mesh.userData.velocity.set(0, 0, 0);
    this._idleTime = 0;
    this._bank = 0;
    this._euler.set(0, 0, 0, 'YXZ');
    this._hitFlashTime = 0;
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
