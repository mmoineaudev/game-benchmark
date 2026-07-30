import * as THREE from 'three';
import { BOSS, COLORS, LAYERS, LOG } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';
import ModelFactory from '../visuals/ModelFactory.js';

/**
 * Boss entity — 2-phase fight.
 * Phase 1: charge attack (telegraph → dash toward player horizontally)
 * Phase 2: charge + jump slam (at 50% HP), faster movement
 */
export default class Boss {
  constructor() {
    this.isAlive = false;
    this.x = 0;
    this.y = 5;
    this.hp = BOSS.HP;
    this.maxHp = BOSS.HP;
    this.phase = 1;
    this.hitInvincible = 0;
    this._speed = BOSS.SPEED;
    this.facingDir = -1;  // faces player

    // Attack state machine
    this._state = 'idle';     // idle | telegraph | charging | jumping | recovering
    this._stateTimer = 0;
    this._attackTargetX = 0;
    this._attackVx = 0;
    this._attackVy = 0;
    this._chargeCooldown = BOSS.CHARGE_COOLDOWN * 0.5;

    // Visual
    this.mesh = null;
    this._animTime = 0;
    this._flashTime = 0;

    // Knockback
    this._knockbackTime = 0;
    this._knockbackVx = 0;
    this._knockbackVy = 0;

    LOG('Boss', 'Initialized (inactive)');
  }

  init(scene, roomData) {
    this._scene = scene;
    this.isAlive = true;
    this.hp = BOSS.HP;
    this.maxHp = BOSS.HP;
    this.phase = 1;
    this._state = 'idle';
    this._stateTimer = Math.random() * 1.5;

    if (roomData.bossSpawn) {
      this.x = roomData.bossSpawn.x;
      this.y = roomData.bossSpawn.y;
    }

    this.mesh = ModelFactory.buildBoss();
    this.mesh.position.set(this.x, this.y, LAYERS.ENEMIES);
    scene.add(this.mesh);

    LOG('Boss', `Spawned at (${this.x.toFixed(1)}, ${this.y.toFixed(1)}) HP: ${this.hp}`);
  }

  update(dt, player) {
    if (!this.isAlive || !this.mesh) return;

    this._animTime += dt;
    if (this.hitInvincible > 0) this.hitInvincible -= dt;
    if (this._flashTime > 0) this._flashTime -= dt;
    if (this._chargeCooldown > 0) this._chargeCooldown -= dt;

    const pSpeed = this.phase === 2 ? BOSS.SPEED * BOSS.PHASE2_SPEED_MULT : BOSS.SPEED;

    // Face player
    this.facingDir = player.x > this.x ? 1 : -1;

    // Knockback
    if (this._knockbackTime > 0) {
      this.x += this._knockbackVx * dt;
      this.y += this._knockbackVy * dt;
      this._knockbackTime -= dt;
      if (this._knockbackTime <= 0) {
        this._state = 'idle';
      }
      this._syncMesh();
      return;
    }

    switch (this._state) {
      case 'idle':
        // Slowly drift toward player
        this.x += this.facingDir * pSpeed * 0.4 * dt;
        this._stateTimer -= dt;
        if (this._stateTimer <= 0 && this._chargeCooldown <= 0) {
          this._startCharge(player);
        }
        break;

      case 'telegraph':
        this._stateTimer -= dt;
        // Flash color to telegraph
        if (this.mesh && Math.floor(this._animTime * 10) % 2 === 0) {
          ModelFactory.flashEnemy(this.mesh);
        }
        if (this._stateTimer <= 0) {
          this._state = 'charging';
          this._attackVx = this.facingDir * BOSS.CHARGE_SPEED;
          this._stateTimer = 0.5;
        }
        this._syncMesh();
        break;

      case 'charging':
        this.x += this._attackVx * dt;
        this._stateTimer -= dt;

        // Hit player?
        if (Math.abs(this.x - player.x) < 0.8 && Math.abs(this.y - player.y) < 1.0) {
          if (!player.hitInvincible) {
            player.takeDamage(BOSS.DAMAGE, this.facingDir > 0 ? 1 : -1);
          }
        }

        if (this._stateTimer <= 0) {
          this._state = 'recovering';
          this._stateTimer = 0.6;
          this._chargeCooldown = BOSS.CHARGE_COOLDOWN;
        }
        this._syncMesh();
        break;

      case 'recovering':
        this._stateTimer -= dt;
        if (this._stateTimer <= 0) {
          this._state = 'idle';
          this._stateTimer = 1 + Math.random();
        }
        this._syncMesh();
        break;
    }

    // Passive contact damage
    if (!player.hitInvincible && this._state !== 'telegraph') {
      if (Math.abs(this.x - player.x) < 0.7 && Math.abs(this.y - player.y) < 1.0) {
        player.takeDamage(BOSS.DAMAGE, this.facingDir > 0 ? 1 : -1);
      }
    }
  }

  _startCharge(player) {
    this._state = 'telegraph';
    this._stateTimer = BOSS.CHARGE_TELEGRAPH;
    LOG('Boss', `${this.phase === 2 ? 'Phase 2 ' : ''}Charge attack!`);
    EventBus.emit('boss:chargeTelegraph', { x: this.x, y: this.y });
  }

  takeDamage(amount, fromDir) {
    if (!this.isAlive || this.hitInvincible > 0) return;

    this.hp -= amount;
    this.hitInvincible = BOSS.HIT_INVINCIBILITY;
    this._flashTime = 0.15;
    this._knockbackTime = 0.2;
    this._knockbackVx = fromDir * 4;
    this._knockbackVy = 1.5;
    this._state = 'recovering';
    this._stateTimer = 0.3;

    EventBus.emit('boss:damaged', { hp: this.hp, maxHp: this.maxHp });
    LOG('Boss', `Took ${amount} damage! HP: ${this.hp}/${this.maxHp}`);

    // Phase transition
    if (this.hp <= this.maxHp * BOSS.PHASE2_THRESHOLD && this.phase === 1) {
      this.phase = 2;
      this._chargeCooldown = 0;
      LOG('Boss', 'Phase 2! Speed increased.');
      EventBus.emit('boss:phaseChange', { phase: 2 });
      // Visual phase change
      if (this.mesh) ModelFactory.setBossPhase2(this.mesh);
    }

    if (this.hp <= 0) {
      this.die();
    }
  }

  die() {
    this.isAlive = false;
    LOG('Boss', 'Defeated!');
    EventBus.emit('boss:defeated');

    // Death dissolve
    if (this.mesh) {
      const dissolve = () => {
        const s = Math.max(0, this.mesh.scale.x - 0.05);
        this.mesh.scale.setScalar(s);
        if (s <= 0) {
          this.mesh.parent?.remove(this.mesh);
          this.mesh.traverse(c => {
            if (c.geometry) c.geometry.dispose();
            if (c.material) {
              if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
              else c.material.dispose();
            }
          });
        } else {
          requestAnimationFrame(dissolve);
        }
      };
      dissolve();
    }
  }

  pause() {
    // Boss is in inactive room — stop movement but keep alive
    // No-op for now; boss only updates when room is active
  }

  _syncMesh() {
    if (!this.mesh) return;
    this.mesh.position.set(this.x, this.y, LAYERS.ENEMIES);
    this.mesh.rotation.y = this.facingDir === 1 ? 0 : Math.PI;

    // ── Spike ring animations ──────────────────────────────────────
    const t = this._animTime;

    // Inner ring: fast spin
    const innerRing = this.mesh.getObjectByName('_spikeRingInner');
    if (innerRing) innerRing.rotation.y += 0.025;  // ~1.5 rad/s at 60fps

    // Middle ring: medium spin, counter-direction
    const midRing = this.mesh.getObjectByName('_spikeRingMid');
    if (midRing) midRing.rotation.y -= 0.018;

    // Outer ring: slow spin
    const outerRing = this.mesh.getObjectByName('_spikeRingOuter');
    if (outerRing) outerRing.rotation.z += 0.012;

    // Core bob
    const core = this.mesh.getObjectByName('_core');
    if (core) core.position.y = Math.sin(t * 2) * 0.15;

    // Inner core pulse
    const innerCore = this.mesh.getObjectByName('_innerCore');
    if (innerCore?.material) innerCore.material.opacity = 0.3 + Math.sin(t * 3) * 0.15;

    // Eye glow pulse (stronger in phase 2)
    const eye = this.mesh.getObjectByName('_eye');
    if (eye?.material) {
      const base = this.phase === 2 ? 0.6 : 0.4;
      eye.material.opacity = base + Math.sin(t * 6) * 0.3;
    }

    // Boss light pulse
    const light = this.mesh.getObjectByName('_bossLight');
    if (light) light.intensity = 0.4 + Math.sin(t * 2.5) * 0.2;

    // Telegraph glow during charge
    if (this._state === 'telegraph') {
      if (eye?.material) eye.material.opacity = 1.0;
      if (light) light.intensity = 1.2;
      if (innerCore?.material) innerCore.material.opacity = 0.7;
    }

    // Update shader time uniforms
    this.mesh.traverse(c => {
      if (c.material?.uniforms?.uTime) c.material.uniforms.uTime.value = t;
    });
  }

  dispose() {
    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
      this.mesh.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
    }
    this.mesh = null;
    this.isAlive = false;
  }
}
