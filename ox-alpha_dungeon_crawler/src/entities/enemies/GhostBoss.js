// GhostBoss.js — the Spectral Lord: 7 variants, charge/summon/blink/smoke AI (§17)
import * as THREE from 'three';
import { BOSS, BOSS_LABELS } from '../../core/Constants.js';

export default class GhostBoss {
  constructor(opts) {
    // opts: {hp, variant, scale, onSummon, onBlinkHit, smokeClouds, playerRef}
    this.isBoss = true;
    this.variant = opts.variant;
    this.label = BOSS_LABELS[opts.variant] || 'SPECTRAL LORD';
    this.hp = opts.hp; this.maxHp = opts.hp;
    this.state = 'SLEEPING';  // SLEEPING / CHASE / CHARGING / BLINKING / DEAD
    this.awake = false;       // false until the lord first sees the player
    this.pos = new THREE.Vector3();
    this.radius = BOSS.RADIUS;
    this.chargeCooldown = BOSS.CHARGE_COOLDOWN * BOSS.CHARGE_FIRST_MULT;
    this.blinkCooldown = BOSS.BLINK_COOLDOWN * BOSS.BLINK_FIRST_MULT;
    this.smokeCooldown = BOSS.SMOKE_COOLDOWN * BOSS.SMOKE_FIRST_MULT;
    this.summonTimer = BOSS.SUMMON_INTERVAL;
    this.chargeDir = new THREE.Vector3();
    this.chargeT = 0;
    this.chargeHitDone = false;
    this.blinkT = 0;
    this.dead = false;
    this.frozen = false;

    this.group = this._buildRig();
    this._materials = [];
    this.group.traverse(o => { if (o.material) this._materials.push(o.material); });
  }

  _buildRig() {
    const g = new THREE.Group();
    const spectral = new THREE.MeshStandardMaterial({
      color: 0x99aadd, emissive: 0x5566aa, emissiveIntensity: 0.8,
      transparent: true, opacity: 0.9, roughness: 0.5
    });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xaaccff });
    const root = new THREE.Group(); g.add(root);
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 10), spectral);
    cloak.position.y = 1.3; root.add(cloak);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), spectral);
    head.position.y = 3.0; root.add(head);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.06, 6, 12), coreMat);
    crown.rotation.x = Math.PI / 2; crown.position.y = 3.3; root.add(crown);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      eye.position.set(s * 0.16, 3.05, 0.34); root.add(eye);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 1.4), spectral);
      arm.geometry.translate(0, -0.7, 0);
      arm.position.set(s * 1.0, 2.4, 0);
      arm.rotation.z = s * 0.5; arm.name = 'arm' + (s < 0 ? 'L' : 'R');
      root.add(arm);
    }
    g.userData.parts = { root, cloak, head, crown };
    return g;
  }

  faceTo(x, z) {
    this.group.rotation.y = Math.atan2(x - this.pos.x, z - this.pos.z);
  }

  beginDeath() {
    this.state = 'DEAD';
    this.deadTimer = 0;
  }

  updateDeath(dt) {
    this.deadTimer += dt;
    const fade = Math.max(0, 1 - this.deadTimer / 1.4);
    for (const m of this._materials) m.opacity = fade * 0.9;
    return fade <= 0;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
