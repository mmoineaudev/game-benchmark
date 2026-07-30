// =============================================================================
// Creature — enemy entity with simple AI (scuttle toward player).
// =============================================================================

import * as THREE from 'three';

export class Creature {
  constructor(scene, config, tileX, tileY, tileZ) {
    this._scene = scene;
    this.config = config;
    this.tileX = tileX;
    this.tileY = tileY;
    this.tileZ = tileZ;
    this.hp = config.hp;
    this.group = new THREE.Group();

    this._targetPos = new THREE.Vector3();
    this._moveTimer = 0;
    this._buildModel();
    this._scene.add(this.group);
    this._setWorldPos();
  }

  _buildModel() {
    // Simple sphere body with legs — Stone Mite
    const bodyGeom = new THREE.SphereGeometry(0.25, 8, 6);
    const bodyMat = new THREE.MeshLambertMaterial({ color: this.config.color, emissive: this.config.color, emissiveIntensity: 0.3 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.1;
    this.group.add(body);

    // Legs (small cylinders)
    const legGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 4);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x553311 });
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const leg = new THREE.Mesh(legGeom, legMat);
      leg.position.set(Math.cos(angle) * 0.2, -0.1, Math.sin(angle) * 0.2);
      this.group.add(leg);
    }
  }

  _setWorldPos() {
    this.group.position.set(this.tileX + 0.5, -(this.tileY), this.tileZ + 0.5);
  }

  update(dt, playerWorldPos, terrainGen) {
    if (this.hp <= 0) return;

    // Simple scuttle AI: move toward player if within aggro range
    const dx = playerWorldPos.x - this.group.position.x;
    const dy = playerWorldPos.y - this.group.position.y;
    const dz = playerWorldPos.z - this.group.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > this.config.aggroRange) return;

    // Move toward player at config speed (tiles/sec)
    this._moveTimer += dt;
    const moveInterval = 1 / this.config.speed;

    if (this._moveTimer >= moveInterval) {
      this._moveTimer = 0;
      const ndx = Math.sign(dx);
      const ndz = Math.sign(dz);

      // Try horizontal movement first
      let nx = this.tileX + ndx;
      let nz = this.tileZ + Math.round(ndz);
      const ny = this.tileY;

      // Check if target tile is walkable (air with solid floor)
      if (terrainGen.get(nx, ny, nz) === 0 && terrainGen.isSolid(nx, ny + 1, nz)) {
        this.tileX = nx;
        this.tileZ = Math.round(nz);
      }
      this._setWorldPos();
    }
  }

  dispose() {
    this._scene.remove(this.group);
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
