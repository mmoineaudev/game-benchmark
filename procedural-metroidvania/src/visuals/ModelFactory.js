import * as THREE from 'three';
import { COLORS } from '../core/Constants.js';
import {
  createToonMaterial,
  createRimMaterial,
  createPlatformMaterial,
} from './Shaders.js';

/**
 * ModelFactory — builds detailed low-poly meshes for all game entities.
 *
 * Visual style: GameCube-era low-poly with toon shading, neon rim glow.
 * Every entity uses composite geometry (multiple parts) with articulation points
 * so animations can move individual limbs/rings/spikes.
 */

export default class ModelFactory {
  constructor() {}

  // ═══════════════════════════════════════════════════════════════════════
  // PLAYER — articulated low-poly humanoid in power armor
  // ═══════════════════════════════════════════════════════════════════════
  static buildPlayer() {
    const group = new THREE.Group();
    group.name = '_player';

    // Materials
    const armorMat = createToonMaterial(COLORS.PLAYER, COLORS.PLAYER_EMISSIVE, 3.0);
    armorMat.name = '_armorMat';
    const darkMat = createToonMaterial(0x1a2a3a, 0x334455, 4.0);
    const visorMat = new THREE.MeshBasicMaterial({ color: 0xaaddff });

    // ── Torso ──────────────────────────────────────────────────────────
    const torsoGroup = new THREE.Group();
    torsoGroup.name = '_torso';
    torsoGroup.position.y = 0.5;

    // Chest plate (main body)
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.55, 6), armorMat);
    chest.name = '_chest';
    torsoGroup.add(chest);

    // Chest detail plate
    const chestDetail = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.28, 0.08),
      createToonMaterial(COLORS.PLAYER_EMISSIVE, 0x88bbff, 2.5)
    );
    chestDetail.position.set(0, 0.05, 0.25);
    chestDetail.name = '_chestDetail';
    torsoGroup.add(chestDetail);

    // Shoulder pads
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 5, 4),
        armorMat
      );
      shoulder.position.set(side * 0.32, 0.2, 0);
      shoulder.scale.set(1, 0.7, 0.8);
      shoulder.name = `_shoulder${side > 0 ? 'R' : 'L'}`;
      torsoGroup.add(shoulder);
    }

    // Backpack / thruster
    const backpack = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.3, 0.15),
      createToonMaterial(0x224466, 0x4488cc, 2.5)
    );
    backpack.position.set(0, 0.0, -0.25);
    backpack.name = '_backpack';
    torsoGroup.add(backpack);

    // Thruster nozzles
    for (const side of [-1, 1]) {
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.06, 0.1, 5),
        new THREE.MeshBasicMaterial({ color: 0x4488cc })
      );
      nozzle.position.set(side * 0.06, -0.15, -0.3);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.name = `_nozzle${side > 0 ? 'R' : 'L'}`;
      torsoGroup.add(nozzle);
    }

    group.add(torsoGroup);

    // ── Head ───────────────────────────────────────────────────────────
    const headGroup = new THREE.Group();
    headGroup.name = '_head';
    headGroup.position.y = 1.08;

    // Helmet base
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), armorMat);
    helmet.scale.set(1, 1.05, 0.85);
    helmet.name = '_helmet';
    headGroup.add(helmet);

    // Visor
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.08, 0.04),
      visorMat
    );
    visor.position.set(0, 0.03, 0.15);
    visor.name = '_visor';
    headGroup.add(visor);

    // Antenna
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.12, 4),
      new THREE.MeshBasicMaterial({ color: 0x88ccff })
    );
    antenna.position.set(0, 0.22, 0);
    antenna.name = '_antenna';
    headGroup.add(antenna);
    // Antenna tip glow
    const antennaTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xaaddff })
    );
    antennaTip.position.set(0, 0.29, 0);
    antennaTip.name = '_antennaTip';
    headGroup.add(antennaTip);

    group.add(headGroup);

    // ── Arms (upper + lower + hand) ────────────────────────────────────
    for (const side of [-1, 1]) {
      const suffix = side > 0 ? 'R' : 'L';
      const sx = side * 0.4;

      // Upper arm pivot
      const upperArmPivot = new THREE.Group();
      upperArmPivot.name = `_upperArm_${suffix}`;
      upperArmPivot.position.set(sx, 0.65, 0);

      const upperArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.08, 0.35, 5),
        armorMat
      );
      upperArm.position.y = -0.15;
      upperArm.name = `_upperArmGeo_${suffix}`;
      upperArmPivot.add(upperArm);

      // Lower arm pivot (attached to upper arm bottom)
      const lowerArmPivot = new THREE.Group();
      lowerArmPivot.name = `_lowerArm_${suffix}`;
      lowerArmPivot.position.y = -0.32;

      const lowerArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.07, 0.3, 5),
        darkMat
      );
      lowerArm.position.y = -0.13;
      lowerArm.name = `_lowerArmGeo_${suffix}`;
      lowerArmPivot.add(lowerArm);

      // Hand / weapon grip
      const hand = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 4, 4),
        darkMat
      );
      hand.position.y = -0.28;
      hand.name = `_hand_${suffix}`;
      lowerArmPivot.add(hand);

      upperArmPivot.add(lowerArmPivot);
      group.add(upperArmPivot);
    }

    // ── Legs (upper + lower + boot) ────────────────────────────────────
    for (const side of [-1, 1]) {
      const suffix = side > 0 ? 'R' : 'L';
      const sx = side * 0.15;

      // Upper leg pivot
      const upperLegPivot = new THREE.Group();
      upperLegPivot.name = `_upperLeg_${suffix}`;
      upperLegPivot.position.set(sx, 0.15, 0);

      const thigh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.1, 0.3, 5),
        darkMat
      );
      thigh.position.y = -0.12;
      thigh.name = `_thigh_${suffix}`;
      upperLegPivot.add(thigh);

      // Lower leg pivot
      const lowerLegPivot = new THREE.Group();
      lowerLegPivot.name = `_lowerLeg_${suffix}`;
      lowerLegPivot.position.y = -0.28;

      const calf = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.07, 0.3, 5),
        armorMat
      );
      calf.position.y = -0.12;
      calf.name = `_calf_${suffix}`;
      lowerLegPivot.add(calf);

      // Boot
      const boot = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.08, 0.16),
        darkMat
      );
      boot.position.y = -0.27;
      boot.name = `_boot_${suffix}`;
      lowerLegPivot.add(boot);

      upperLegPivot.add(lowerLegPivot);
      group.add(upperLegPivot);
    }

    // ── Weapon (energy blade on right arm) ─────────────────────────────
    const weaponPivot = new THREE.Group();
    weaponPivot.name = '_weapon';
    weaponPivot.position.set(0.4, 0.2, 0);
    // Attach to right hand for now, will be repositioned in animations

    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.45, 0.03),
      new THREE.MeshBasicMaterial({ color: 0x88ddff })
    );
    blade.position.y = -0.3;
    blade.name = '_blade';
    weaponPivot.add(blade);

    // Blade glow
    const bladeGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.5, 0.06),
      new THREE.MeshBasicMaterial({
        color: 0x4488cc,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    bladeGlow.position.y = -0.3;
    bladeGlow.name = '_bladeGlow';
    weaponPivot.add(bladeGlow);

    group.add(weaponPivot);

    // ── Player light ───────────────────────────────────────────────────
    const playerLight = new THREE.PointLight(COLORS.PLAYER, 0.6, 4.5, 1);
    playerLight.position.set(0, 0.6, 0.3);
    playerLight.name = '_playerLight';
    group.add(playerLight);

    return group;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DRONE ENEMY — crystal sentinel with rotating rings
  // ═══════════════════════════════════════════════════════════════════════
  static buildDrone(color, scale) {
    const group = new THREE.Group();
    group.name = '_enemy';

    const rimMat = createRimMaterial(color, COLORS.ENEMY_RIM, 3.5);

    // ── Core ───────────────────────────────────────────────────────────
    const coreGroup = new THREE.Group();
    coreGroup.name = '_core';

    const body = new THREE.Mesh(new THREE.OctahedronGeometry(scale * 0.5, 0), rimMat);
    body.name = '_body';
    coreGroup.add(body);

    // Inner glow sphere
    const innerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(scale * 0.2, 6, 6),
      new THREE.MeshBasicMaterial({
        color: COLORS.ENEMY_RIM,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    innerGlow.name = '_innerGlow';
    coreGroup.add(innerGlow);

    group.add(coreGroup);

    // ── Outer ring (horizontal) ────────────────────────────────────────
    const ringGroup = new THREE.Group();
    ringGroup.name = '_ringH';

    const ringSegments = 6;
    for (let i = 0; i < ringSegments; i++) {
      const angle = (i / ringSegments) * Math.PI * 2;
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(scale * 0.12, 0),
        rimMat
      );
      crystal.position.set(Math.cos(angle) * scale * 0.7, 0, Math.sin(angle) * scale * 0.7);
      crystal.name = `_crystalH_${i}`;
      ringGroup.add(crystal);
    }

    group.add(ringGroup);

    // ── Vertical ring ──────────────────────────────────────────────────
    const ringVGroup = new THREE.Group();
    ringVGroup.name = '_ringV';
    ringVGroup.rotation.x = Math.PI / 2;

    for (let i = 0; i < ringSegments; i++) {
      const angle = (i / ringSegments) * Math.PI * 2 + Math.PI / ringSegments;
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(scale * 0.1, 0),
        rimMat
      );
      crystal.position.set(Math.cos(angle) * scale * 0.65, Math.sin(angle) * scale * 0.65, 0);
      crystal.name = `_crystalV_${i}`;
      ringVGroup.add(crystal);
    }

    group.add(ringVGroup);

    // ── Eye ────────────────────────────────────────────────────────────
    const eyeMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.12, 6, 6), eyeMat);
    eye.position.set(0, 0, scale * 0.25);
    eye.name = '_eye';
    group.add(eye);

    // ── Point light ────────────────────────────────────────────────────
    const light = new THREE.PointLight(color, 0.3, scale * 2.5, 1);
    light.name = '_enemyLight';
    group.add(light);

    return group;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BOSS — Guardian construct with orbiting spike rings
  // ═══════════════════════════════════════════════════════════════════════
  static buildBoss() {
    const group = new THREE.Group();
    group.name = '_boss';

    const bossMat = createRimMaterial(COLORS.BOSS, COLORS.BOSS_RIM, 4.0);

    // ── Core ───────────────────────────────────────────────────────────
    const coreGroup = new THREE.Group();
    coreGroup.name = '_core';

    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), bossMat);
    body.scale.set(1, 1.3, 0.7);
    body.name = '_body';
    coreGroup.add(body);

    // Inner pulsing core
    const innerCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({
        color: COLORS.BOSS,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    innerCore.name = '_innerCore';
    coreGroup.add(innerCore);

    group.add(coreGroup);

    // ── Inner spike ring (8 spikes, fast rotation) ─────────────────────
    const innerRing = new THREE.Group();
    innerRing.name = '_spikeRingInner';
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 5), bossMat);
      spike.position.set(Math.cos(angle) * 0.85, 0, Math.sin(angle) * 0.85);
      spike.lookAt(new THREE.Vector3(Math.cos(angle) * 2, 0, Math.sin(angle) * 2));
      spike.name = `_spikeInner_${i}`;
      innerRing.add(spike);
    }
    group.add(innerRing);

    // ── Middle ring (6 spikes, medium rotation, tilted) ────────────────
    const midRing = new THREE.Group();
    midRing.name = '_spikeRingMid';
    midRing.rotation.x = Math.PI / 3;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 5), bossMat);
      spike.position.set(Math.cos(angle) * 1.05, 0, Math.sin(angle) * 1.05);
      spike.lookAt(new THREE.Vector3(Math.cos(angle) * 3, 0, Math.sin(angle) * 3));
      spike.name = `_spikeMid_${i}`;
      midRing.add(spike);
    }
    group.add(midRing);

    // ── Outer ring (4 large spikes, slow rotation) ─────────────────────
    const outerRing = new THREE.Group();
    outerRing.name = '_spikeRingOuter';
    outerRing.rotation.z = Math.PI / 4;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 5), bossMat);
      spike.position.set(Math.cos(angle) * 1.3, 0, Math.sin(angle) * 1.3);
      spike.lookAt(new THREE.Vector3(Math.cos(angle) * 3, 0, Math.sin(angle) * 3));
      spike.name = `_spikeOuter_${i}`;
      outerRing.add(spike);
    }
    group.add(outerRing);

    // ── Eye ────────────────────────────────────────────────────────────
    const eyeOuter = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.04, 6, 8),
      new THREE.MeshBasicMaterial({ color: 0x440000 })
    );
    eyeOuter.position.set(0, 0.05, 0.5);
    eyeOuter.name = '_eyeRing';
    group.add(eyeOuter);

    const eyeMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), eyeMat);
    eye.position.set(0, 0.05, 0.5);
    eye.name = '_eye';
    group.add(eye);

    // ── Boss light ─────────────────────────────────────────────────────
    const light = new THREE.PointLight(COLORS.BOSS, 0.5, 6, 1);
    light.name = '_bossLight';
    group.add(light);

    return group;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ABILITY PICKUP — floating crystal with orbiting motes
  // ═══════════════════════════════════════════════════════════════════════
  static buildPickup(color) {
    const group = new THREE.Group();
    group.name = '_pickup';

    // Center gem
    const gemGeo = new THREE.OctahedronGeometry(0.2, 0);
    const gemMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.5,
    });
    const gem = new THREE.Mesh(gemGeo, gemMat);
    gem.name = '_gem';
    group.add(gem);

    // Outer glow shell
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), glowMat);
    glow.name = '_glowShell';
    group.add(glow);

    // Orbiting motes (3 small spheres)
    for (let i = 0; i < 3; i++) {
      const mote = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 4, 4),
        new THREE.MeshBasicMaterial({
          color,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mote.userData._orbitAngle = (i / 3) * Math.PI * 2;
      mote.userData._orbitRadius = 0.35;
      mote.userData._orbitSpeed = 1.5 + i * 0.3;
      mote.name = `_mote_${i}`;
      group.add(mote);
    }

    // Point light
    const light = new THREE.PointLight(color, 0.4, 2, 1);
    light.name = '_pickupLight';
    group.add(light);

    return group;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════════

  /** Flash enemy mesh white on hit */
  static flashEnemy(mesh) {
    if (!mesh) return;
    const body = mesh.getObjectByName('_body');
    if (body?.material?.uniforms?.uHitFlash) {
      body.material.uniforms.uHitFlash.value = 1;
      const fade = () => {
        if (body.material.uniforms.uHitFlash.value > 0.01) {
          body.material.uniforms.uHitFlash.value *= 0.85;
          requestAnimationFrame(fade);
        } else {
          body.material.uniforms.uHitFlash.value = 0;
        }
      };
      fade();
    }
  }

  /** Set boss to phase 2 visuals */
  static setBossPhase2(mesh) {
    if (!mesh) return;

    // Change body color
    const body = mesh.getObjectByName('_body');
    if (body?.material?.uniforms) {
      body.material.uniforms.uColor.value.set(COLORS.BOSS_PHASE2);
      body.material.uniforms.uRimColor.value.set(0xff88ff);
      body.material.uniforms.uRimPower.value = 3.0;
    }

    // Eye turns brighter
    const eye = mesh.getObjectByName('_eye');
    if (eye?.material) {
      eye.material.color.set(0xff44ff);
      eye.material.opacity = 1.0;
    }

    // Eye ring
    const eyeRing = mesh.getObjectByName('_eyeRing');
    if (eyeRing?.material) {
      eyeRing.material.color.set(0xff00ff);
    }

    // Boss light color shift
    const light = mesh.getObjectByName('_bossLight');
    if (light) light.color.set(COLORS.BOSS_PHASE2);
  }

  /** Reset boss to phase 1 visuals */
  static setBossPhase1(mesh) {
    if (!mesh) return;
    const body = mesh.getObjectByName('_body');
    if (body?.material?.uniforms) {
      body.material.uniforms.uColor.value.set(COLORS.BOSS);
      body.material.uniforms.uRimColor.value.set(COLORS.BOSS_RIM);
      body.material.uniforms.uRimPower.value = 4.0;
    }
    const light = mesh.getObjectByName('_bossLight');
    if (light) light.color.set(COLORS.BOSS);
  }
}
