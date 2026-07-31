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
    this.headlight.name = 'ship:headlight';
    this.headlight.position.set(0, 0.6, -3.0);
    this.group.add(this.headlight);
    this.headlight.target.position.set(0, 0, -20);
    this.group.add(this.headlight.target);

    this.accentLight = new THREE.PointLight(0x6644ff, 0.4, 12, 2);
    this.accentLight.name = 'ship:underglow';
    this.accentLight.position.set(0, -0.8, 0.5);
    this.group.add(this.accentLight);

    // Electromagnetic shield bubble (right-click) — v2.0: fresnel rim + ripple
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
    // outer fresnel rim (BackSide, always on while active)
    this.shieldRimMat = new THREE.MeshBasicMaterial({
      color: 0x88ddff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.shieldRim = new THREE.Mesh(new THREE.SphereGeometry(Constants.SHIELD.radius * 1.03, 24, 18), this.shieldRimMat);
    this.shieldRim.visible = false;
    this.group.add(this.shieldRim);
    // ripple ring pool (on deflection)
    this._ripples = [];
    this._rippleTex = this._makeGlowTexture(0x88ddff);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.SpriteMaterial({ map: this._rippleTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      this.group.add(spr);
      this._ripples.push({ spr, mat, life: 0 });
    }

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
    this._lean = 0;
    this.damageLevel = 0;
  }

  /** Shield v2: expanding ripple ring at a world-space contact point. */
  shieldPulse(x, y, z) {
    const ripple = this._ripples.find((r) => r.life <= 0);
    if (!ripple) return;
    ripple.life = 0.3;
    ripple.spr.position.set(x, y, z);
    ripple.spr.visible = true;
  }

  _buildMesh() {
    const g = new THREE.Group();
    // visual subgroup (bank/turn lean applied here, on top of heading)
    const visual = new THREE.Group();
    visual.name = 'ship-visual';
    g.add(visual);

    // ---- Shared hull material: panel-line canvas texture + wear -------------
    const hullTex = this._makeHullTexture();
    const hullMat = new THREE.MeshStandardMaterial({
      map: hullTex,
      color: 0x8a9aad,
      metalness: 0.35,
      roughness: 0.6,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a4450, metalness: 0.4, roughness: 0.6 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x66ccff,
      metalness: 0.1,
      roughness: 0.05,
      transparent: true,
      opacity: 0.85,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.6, roughness: 0.4, emissive: 0x113355, emissiveIntensity: 0.6 });
    const redLight = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3020, emissiveIntensity: 2.0 });
    const greenLight = new THREE.MeshStandardMaterial({ color: 0x002200, emissive: 0x20ff60, emissiveIntensity: 2.0 });

    // Fuselage (nose toward -Z)
    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 4.6), hullMat);
    fuselage.position.z = 0.2;
    visual.add(fuselage);
    // Dorsal spine + belly plate (layered hull)
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 3.8), hullMat);
    spine.position.set(0, 0.55, 0.3);
    visual.add(spine);
    const belly = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 3.0), darkMat);
    belly.position.set(0, -0.5, 0.5);
    visual.add(belly);
    // Greebles
    for (const [gx, gy, gz, sx, sy, sz] of [[-0.45, 0.6, 0.4, 0.25, 0.18, 0.4], [0.45, 0.6, 0.4, 0.25, 0.18, 0.4], [0, 0.68, -0.8, 0.3, 0.14, 0.6], [0, 0.62, 1.2, 0.2, 0.12, 0.5]]) {
      const greeble = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), darkMat);
      greeble.position.set(gx, gy, gz);
      visual.add(greeble);
    }

    // Nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 8), darkMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0.1, -2.2);
    visual.add(nose);

    // Swept wings (bigger)
    const wingGeo = new THREE.BoxGeometry(4.2, 0.12, 1.4);
    const wingL = new THREE.Mesh(wingGeo, hullMat);
    wingL.position.set(-2.0, -0.05, 0.4);
    wingL.rotation.y = 0.35;
    const wingR = wingL.clone();
    wingR.position.x = 2.0;
    wingR.rotation.y = -0.35;
    visual.add(wingL, wingR);
    // wingtip boxes
    const tipBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), darkMat);
    tipBox.position.set(-3.5, -0.05, 0.5);
    visual.add(tipBox);
    const tipBoxR = tipBox.clone();
    tipBoxR.position.x = 3.5;
    visual.add(tipBoxR);

    // Tail fins + stabilizer
    const finGeo = new THREE.BoxGeometry(0.1, 1.1, 0.9);
    const finL = new THREE.Mesh(finGeo, darkMat);
    finL.position.set(-0.55, 0.5, 1.9);
    finL.rotation.z = 0.25;
    const finR = finL.clone();
    finR.position.x = 0.55;
    finR.rotation.z = -0.25;
    visual.add(finL, finR);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.6), hullMat);
    stab.position.set(0, 0.1, 2.0);
    visual.add(stab);

    // Clearcoat cockpit with interior
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), glassMat);
    cockpit.scale.set(0.8, 0.7, 1.4);
    cockpit.position.set(0, 0.45, -0.6);
    visual.add(cockpit);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.18), darkMat);
    seat.position.set(0, 0.28, -0.55);
    visual.add(seat);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.06), new THREE.MeshBasicMaterial({ color: 0x22ff88 }));
    panel.position.set(0, 0.3, -0.68);
    visual.add(panel);

    // Engine nacelles + emissive cones
    const nacelleGeo = new THREE.CylinderGeometry(0.34, 0.38, 1.6, 10);
    nacelleGeo.rotateX(Math.PI / 2);
    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x334455, emissive: 0x88ccff, emissiveIntensity: 1.5 });
    for (const x of [-0.82, 0.82]) {
      const nacelle = new THREE.Mesh(nacelleGeo, engineMat);
      nacelle.position.set(x, 0.05, 1.2);
      visual.add(nacelle);
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.25, 10).rotateX(Math.PI / 2), exhaustMat);
      exhaust.position.set(x, 0.05, 2.0);
      visual.add(exhaust);
    }

    // Wingtip lights (red port / green starboard)
    const tipL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), redLight);
    tipL.position.set(-3.6, 0.1, 0.5);
    const tipR = tipL.clone();
    tipR.position.x = 3.6;
    tipR.material = greenLight;
    visual.add(tipL, tipR);

    // Spine beacon (red blink) + lights
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff5040, fog: false });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), beaconMat);
    beacon.position.set(0, 0.8, 0.6);
    visual.add(beacon);
    this._beaconLight = new THREE.PointLight(0xff5040, 0.8, 16, 2);
    this._beaconLight.name = 'ship:beacon';
    this._beaconLight.position.set(0, 0.8, 0.6);
    g.add(this._beaconLight);
    this._cockpitLight = new THREE.PointLight(0x88ffcc, 0.3, 5, 2);
    this._cockpitLight.name = 'ship:cockpit';
    this._cockpitLight.position.set(0, 0.45, -0.6);
    g.add(this._cockpitLight);

    // Engine glow lights (throttle-reactive)
    this._engineGlows = [];
    for (const x of [-0.82, 0.82]) {
      const glow = new THREE.PointLight(0x4488ff, 0, 14, 2);
      glow.name = 'ship:engine';
      glow.position.set(x, 0.05, 2.2);
      g.add(glow);
      this._engineGlows.push(glow);
    }

    // Heat shimmer sprites at engine exhausts
    const shimmerTex = this._makeGlowTexture(0x4488ff);
    this._shimmerMats = [];
    this._shimmerSprites = [];
    for (const x of [-0.82, 0.82]) {
      const mat = new THREE.SpriteMaterial({ map: shimmerTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const spr = new THREE.Sprite(mat);
      spr.position.set(x, 0.05, 2.3);
      spr.scale.setScalar(2.2);
      visual.add(spr);
      this._shimmerMats.push(mat);
      this._shimmerSprites.push(spr);
    }
    this._shimmerTex = shimmerTex;

    // Scorch decals (damage states)
    this._scorch = [];
    for (const [sx, sy, sz, scl] of [[0, 0.55, 0.2, 1.0], [-0.5, -0.3, 0.8, 0.8]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.9 * scl, 0.7 * scl), new THREE.MeshBasicMaterial({ color: 0x14100a, transparent: true, opacity: 0 }));
      s.position.set(sx, sy, sz);
      s.rotation.y = Math.PI / 2;
      visual.add(s);
      this._scorch.push(s);
    }

    this._visual = visual;
    this._visualGroup = g;
    return g;
  }

  _makeHullTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8a9aad';
    ctx.fillRect(0, 0, 512, 512);
    // panel lines
    ctx.strokeStyle = 'rgba(30,40,55,0.55)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 512; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
    }
    for (let y = 0; y <= 512; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }
    // wear speckles
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(20,25,35,${0.15 + Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 3 + Math.random() * 6, 2 + Math.random() * 4);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _makeGlowTexture(colorHex) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    const col = new THREE.Color(colorHex);
    g.addColorStop(0, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},1)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Set damage level 0..1 from current health (drives scorch/flicker/smoke). */
  setDamageLevel(health, maxHealth) {
    this.damageLevel = Math.max(0, 1 - health / maxHealth);
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
    this.shieldRim.visible = this.shieldActive;
    if (this.shieldActive) {
      const pulse = 0.16 + 0.06 * Math.sin(this._time * 12);
      this.shieldMat.opacity = pulse;
      this.shieldRimMat.opacity = 0.1 + 0.05 * Math.sin(this._time * 12);
    } else {
      this.shieldMat.opacity = 0;
      this.shieldRimMat.opacity = 0;
    }
    // Ripple rings decay
    for (const r of this._ripples) {
      if (r.life > 0) {
        r.life -= dt;
        r.spr.visible = r.life > 0;
        r.mat.opacity = r.life * 2.5;
        r.spr.scale.setScalar(2 + (0.3 - r.life) * 24);
      }
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

    // Bank/turn lean (v2.0 §4): visual roll bias from yaw rate
    const yawRate = -yawInput / Math.max(dt, 1e-4);
    const targetLean = clamp(yawRate * 0.02, -0.5, 0.5);
    this._lean = this._lean + (targetLean - this._lean) * Math.min(1, dt * 5);
    this._visual.rotation.z = this._lean;

    // Flame flicker (throttle-driven, shortened by damage)
    const flick = 0.75 + 0.25 * Math.sin(this._time * 40) + Math.random() * 0.15;
    const dmg = this.damageLevel || 0;
    this._flameMat.opacity = (0.4 + 0.6 * this.throttle) * flick * (1 - 0.4 * dmg);
    const scale = (0.7 + this.throttle * 0.6) * (1 - 0.5 * dmg);
    for (const flame of this._flameMeshes) {
      flame.scale.set(1, 1, scale);
    }

    // Engine glow lights + heat shimmer (throttle-reactive)
    const glowIntensity = this.throttle * 1.6;
    for (const gl of this._engineGlows) gl.intensity = glowIntensity;
    for (const m of this._shimmerMats) m.opacity = 0.3 + 0.7 * this.throttle;

    // Spine beacon blink (1.2 Hz, 50% duty; 2 Hz when damaged)
    const beaconHz = dmg > 0.7 ? 2.0 : 1.2;
    const beaconOn = Math.sin(this._time * beaconHz * Math.PI * 2) > 0 ? 1 : 0.1;
    this._beaconLight.intensity = 0.8 * beaconOn;

    // Damage states: scorch fades in past 70% damage
    for (const s of this._scorch) {
      s.material.opacity = dmg > 0.7 ? Math.min(1, (dmg - 0.7) / 0.3) : 0;
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
