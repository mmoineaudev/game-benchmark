import * as THREE from 'three';
import { ENEMY } from '../core/Constants.js';

// Simple low-poly creature (Stone Mite): sphere with leg nubs
export class Creature {
  constructor(typeDef, x, y, z) {
    this.def = typeDef;
    this.hp = typeDef.hp;
    this.maxHp = typeDef.hp;
    this.damage = typeDef.damage;
    this.speed = typeDef.speed;
    this.alive = true;
    this._wanderAngle = Math.random() * Math.PI * 2;
    this._changeTimer = 0;

    this.group = new THREE.Group();
    this._build();
    this.group.position.set(x + 0.5, y + 0.5, z + 0.5);
  }

  _build() {
    const col = new THREE.Color(this.def.color);
    const rimCol = new THREE.Color(this.def.rimColor);

    // Body (sphere)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: col, roughness: 0.8, metalness: 0.1,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), bodyMat);
    body.name = '_body';
    this.group.add(body);

    // 6 little legs (small spheres)
    const legMat = new THREE.MeshStandardMaterial({ color: 0x554433, roughness: 0.9 });
    const legOffsets = [
      [-0.2, -0.15, -0.2], [0.2, -0.15, -0.2],
      [-0.25, -0.2, 0], [0.25, -0.2, 0],
      [-0.2, -0.15, 0.2], [0.2, -0.15, 0.2],
    ];
    for (const lo of legOffsets) {
      const leg = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4), legMat);
      leg.position.set(lo[0], lo[1], lo[2]);
      this.group.add(leg);
    }

    // 2 eyes (small glow dots)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff6644 });
    for (const ex of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeMat);
      eye.position.set(ex, 0.1, -0.22);
      this.group.add(eye);
    }

    // Hit flash material (stored for animation)
    this._bodyMat = bodyMat;
    this._origColor = col.clone();
    this._flashTimer = 0;
  }

  takeDamage(amount) {
    this.hp -= amount;
    this._flashTimer = 0.2;
    if (this.hp <= 0) {
      this.alive = false;
    }
  }

  update(dt, playerPos) {
    if (!this.alive) return;

    // Hit flash decay
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      const t = this._flashTimer / 0.2;
      this._bodyMat.color.setHSL(0, 0, 0.3 + t * 0.7);
      if (this._flashTimer <= 0) {
        this._bodyMat.color.copy(this._origColor);
      }
    }

    // Simple AI: wander randomly, move toward player when close
    const dx = playerPos.x - this.group.position.x;
    const dz = playerPos.z - this.group.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    this._changeTimer -= dt;
    if (this._changeTimer <= 0) {
      this._changeTimer = 1.5 + Math.random() * 2;
      this._wanderAngle += (Math.random() - 0.5) * Math.PI;
    }

    let moveX, moveZ;
    if (dist < 5 && dist > 0.5) {
      // Move toward player
      const angle = Math.atan2(dx, dz);
      moveX = Math.sin(angle);
      moveZ = Math.cos(angle);
    } else if (dist > 0.1) {
      moveX = Math.sin(this._wanderAngle);
      moveZ = Math.cos(this._wanderAngle);
    } else {
      moveX = 0; moveZ = 0;
    }

    // Clamp to terrain bounds
    const newX = this.group.position.x + moveX * this.speed * dt;
    const newZ = this.group.position.z + moveZ * this.speed * dt;

    // Keep within world
    if (newX > 0.5 && newX < 19.5) this.group.position.x = newX;
    if (newZ > 0.5 && newZ < 19.5) this.group.position.z = newZ;

    // Gentle bob
    const bob = Math.sin(performance.now() * 0.005) * 0.02;
    this.group.position.y = 0.5 + bob;

    // Rotate to face movement direction
    if (moveX !== 0 || moveZ !== 0) {
      const targetAngle = Math.atan2(moveX, moveZ);
      let diff = targetAngle - this.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.group.rotation.y += diff * 5 * dt;
    }
  }

  getWorldPos() {
    return this.group.position.clone();
  }
}
