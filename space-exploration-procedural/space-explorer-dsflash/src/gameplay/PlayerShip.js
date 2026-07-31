import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { clamp, scratch } from '../utils/MathHelpers.js';

// Low-poly fighter: fuselage, swept wings, tail fins, glass cockpit,
// engine nacelles, wingtip lights, flickering flame (spec §5.6).
export class PlayerShip {
  constructor(scene) {
    this.position = new THREE.Vector3(Constants.SHIP_SPAWN.x, Constants.SHIP_SPAWN.y, Constants.SHIP_SPAWN.z);
    this.velocity = new THREE.Vector3();
    this.heading = new THREE.Quaternion(); // forward = local -Z
    this.rollAngle = 0;
    this.thrustFraction = 0; // mirrors throttle (0..1) for FOV/exhaust/audio/HUD
    this.throttle = 0;       // 0..1, set by scroll wheel
    this.alive = true;
    this.radius = 1.4; // collision radius

    this.group = this._buildMesh();
    this.group.position.copy(this.position);
    scene.add(this.group);

    // Headlight + accent light (spec §5.3) — powerful, reveals asteroids ahead
    const HL = Constants.HEADLIGHT;
    this.headlight = new THREE.SpotLight(HL.color, HL.intensity, HL.range, HL.angle, HL.penumbra, 1.5);
    this.headlight.position.set(0, 0.6, -3.0);
    this.group.add(this.headlight);
    this.headlight.target.position.set(0, 0, -20);
    this.group.add(this.headlight.target);

    this.accentLight = new THREE.PointLight(0x6644ff, 0.4, 12, 2);
    this.accentLight.position.set(0, -0.8, 0.5);
    this.group.add(this.accentLight);

    // Electromagnetic shield bubble (right-click)
    this.shieldEnergy = Constants.SHIELD.energyMax;
    this.shieldActive = false;
    this.shieldMat = new THREE.MeshBasicMaterial({
      color: 0x55ccff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(Constants.SHIELD.radius, 24, 18), this.shieldMat);
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);

    // Emissive materials for flicker
    this._flameMeshes = [];
    this._flameMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flameGeo = new THREE.ConeGeometry(0.28, 1.1, 10);
    for (const x of [-0.82, 0.82]) {
      const flame = new THREE.Mesh(flameGeo, this._flameMat);
      flame.position.set(x, 0.05, 2.0);
      flame.rotation.x = -Math.PI / 2;
      this.group.add(flame);
      this._flameMeshes.push(flame);
    }

    this._time = 0;
  }

  _buildMesh() {
    const g = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({ color: 0x7a8aa0, metalness: 0.35, roughness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a4450, metalness: 0.4, roughness: 0.6 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x66ccff, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.75,
    });
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.6, roughness: 0.4, emissive: 0x113355, emissiveIntensity: 0.6 });
    const redLight = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2222, emissiveIntensity: 2.0 });
    const greenLight = new THREE.MeshStandardMaterial({ color: 0x002200, emissive: 0x22ff44, emissiveIntensity: 2.0 });

    // Fuselage (nose toward -Z)
    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.75, 4.2), hullMat);
    fuselage.position.z = 0.2;
    g.add(fuselage);

    // Nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 8), darkMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0.1, -2.2);
    g.add(nose);

    // Swept wings
    const wingGeo = new THREE.BoxGeometry(3.4, 0.12, 1.5);
    const wingL = new THREE.Mesh(wingGeo, hullMat);
    wingL.position.set(-1.7, -0.05, 0.4);
    wingL.rotation.y = 0.35;
    const wingR = wingL.clone();
    wingR.position.x = 1.7;
    wingR.rotation.y = -0.35;
    g.add(wingL, wingR);

    // Tail fins
    const finGeo = new THREE.BoxGeometry(0.1, 0.9, 0.8);
    const finL = new THREE.Mesh(finGeo, darkMat);
    finL.position.set(-0.55, 0.4, 1.9);
    finL.rotation.z = 0.25;
    const finR = finL.clone();
    finR.position.x = 0.55;
    finR.rotation.z = -0.25;
    g.add(finL, finR);

    // Cockpit canopy
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), glassMat);
    cockpit.scale.set(0.8, 0.7, 1.4);
    cockpit.position.set(0, 0.45, -0.6);
    g.add(cockpit);

    // Engine nacelles (cylinders along Z) + emissive cones
    const nacelleGeo = new THREE.CylinderGeometry(0.34, 0.38, 1.6, 10);
    nacelleGeo.rotateX(Math.PI / 2);
    const exhaustGeo = new THREE.CylinderGeometry(0.3, 0.34, 0.25, 10);
    exhaustGeo.rotateX(Math.PI / 2);
    for (const x of [-0.82, 0.82]) {
      const nacelle = new THREE.Mesh(nacelleGeo, engineMat);
      nacelle.position.set(x, 0.05, 1.2);
      g.add(nacelle);
      const exhaust = new THREE.Mesh(exhaustGeo, new THREE.MeshStandardMaterial({
        color: 0x334455, emissive: 0x88ccff, emissiveIntensity: 1.5,
      }));
      exhaust.position.set(x, 0.05, 2.0);
      g.add(exhaust);
    }

    // Wingtip lights (red port / green starboard)
    const tipL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), redLight);
    tipL.position.set(-3.1, 0.1, 0.5);
    const tipR = tipL.clone();
    tipR.position.x = 3.1;
    tipR.material = greenLight;
    g.add(tipL, tipR);

    return g;
  }

  /**
   * Apply yaw/pitch (mouse + Z/S keys), roll (A/E), throttle (scroll),
   * strafe (Q/D), drag and speed cap.
   */
  update(dt, move) {
    if (!this.alive) return;
    const C = Constants;
    this._time += dt;

    // ---- Throttle (scroll wheel, 0..100%) --------------------------------
    if (move.throttleDelta) {
      this.throttle = clamp(this.throttle + move.throttleDelta * C.THROTTLE_SCROLL_SENSITIVITY, 0, 1);
    }

    // ---- Shield (right-click) --------------------------------------------
    const S = C.SHIELD;
    if (move.shieldHeld && this.shieldEnergy > 0) {
      this.shieldActive = true;
      this.shieldEnergy = Math.max(0, this.shieldEnergy - S.drainPerSec * dt);
    } else {
      this.shieldActive = false;
      this.shieldEnergy = Math.min(S.energyMax, this.shieldEnergy + S.regenPerSec * dt);
    }
    this.shieldMesh.visible = this.shieldActive;
    if (this.shieldActive) {
      const pulse = 0.16 + 0.06 * Math.sin(this._time * 12);
      this.shieldMat.opacity = pulse;
    } else {
      this.shieldMat.opacity = 0;
    }

    // ---- Orientation -------------------------------------------------------
    const yawInput = (move.yawDelta !== undefined ? move.yawDelta : 0) * C.MOUSE_LOOK_SPEED;
    const pitchInput = (move.pitchDelta !== undefined ? move.pitchDelta : 0) * C.MOUSE_LOOK_SPEED;
    const rollInput = (move.rollLeft ? 1 : 0) - (move.rollRight ? 1 : 0);

    // Yaw around world Y, pitch around local X (clamped), roll around local Z
    const qYaw = scratch.q1.setFromAxisAngle(scratch.v1.set(0, 1, 0), -yawInput);
    this.heading.premultiply(qYaw);

    // Keyboard pitch: Z = dive (nose down), S = climb (nose up)
    const keyPitch = ((move.pitchUp ? 1 : 0) - (move.pitchDown ? 1 : 0)) * C.KEYBOARD_PITCH_SPEED * dt
      + (-pitchInput);
    const qPitch = scratch.q2.setFromAxisAngle(scratch.v2.set(1, 0, 0), keyPitch);
    this.heading.multiply(qPitch);

    // Clamp pitch to avoid gimbal flip
    const fwd = scratch.v3.set(0, 0, -1).applyQuaternion(this.heading);
    const pitch = Math.asin(clamp(fwd.y, -1, 1));
    if (Math.abs(pitch) > C.PITCH_LIMIT) {
      const fix = scratch.q1.setFromAxisAngle(scratch.v1.set(1, 0, 0), (pitch > 0 ? 1 : -1) * (Math.abs(pitch) - C.PITCH_LIMIT));
      this.heading.multiply(fix);
    }

    if (rollInput !== 0) {
      const qRoll = scratch.q2.setFromAxisAngle(scratch.v2.set(0, 0, 1), rollInput * C.SHIP_ROLL_SPEED * dt);
      this.heading.multiply(qRoll);
      this.rollAngle += rollInput * C.SHIP_ROLL_SPEED * dt;
    }

    // ---- Translation -------------------------------------------------------
    const f = scratch.v1.set(0, 0, -1).applyQuaternion(this.heading);
    const right = scratch.v2.set(1, 0, 0).applyQuaternion(this.heading);
    const accel = C.SHIP_ACCELERATION * dt;

    // Strafe Q/D
    if (move.left) this.velocity.addScaledVector(right, -accel);
    if (move.right) this.velocity.addScaledVector(right, accel);

    // Lateral drift decay (strafe doesn't persist forever)
    let fwdVel = this.velocity.dot(f);
    const lat = scratch.v3.copy(this.velocity).addScaledVector(f, -fwdVel);
    lat.multiplyScalar(Math.pow(C.SHIP_DRAG, 60 * dt));
    this.velocity.copy(f).multiplyScalar(fwdVel).add(lat);

    // Throttle: accelerate forward component toward throttle × max speed
    fwdVel = this.velocity.dot(f);
    const desired = this.throttle * C.MAX_SHIP_SPEED;
    const change = clamp(desired - fwdVel, -accel, accel);
    this.velocity.addScaledVector(f, change);

    // Speed cap
    const speed = this.velocity.length();
    if (speed > C.MAX_SHIP_SPEED) {
      this.velocity.multiplyScalar(C.MAX_SHIP_SPEED / speed);
    }

    this.position.addScaledVector(this.velocity, dt);
    this.thrustFraction = this.throttle;
    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.heading);

    // Flame flicker (throttle-driven)
    const flick = 0.75 + 0.25 * Math.sin(this._time * 40) + Math.random() * 0.15;
    this._flameMat.opacity = (0.4 + 0.6 * this.throttle) * flick;
    const scale = 0.7 + this.throttle * 0.6;
    for (const flame of this._flameMeshes) {
      flame.scale.set(1, 1, scale);
    }
  }

  get speed() {
    return this.velocity.length();
  }

  get forward() {
    return scratch.v1.set(0, 0, -1).applyQuaternion(this.heading).clone();
  }

  /** Apply external acceleration (black hole pull). */
  applyAcceleration(accel, dt) {
    this.velocity.addScaledVector(accel, dt);
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}
