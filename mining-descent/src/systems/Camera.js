import * as THREE from 'three';

// Angled top-down 3/4 camera following a target
export class CameraSystem {
  constructor() {
    this.distance = 22;
    this.height = 18;
    this.angle = Math.PI / 3.8; // ~47 degrees
    this.lookHeight = 0;
    this.lerpSpeed = 4.0;

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 80);
    this.camera.position.set(0, this.height, this.distance);
    this.camera.lookAt(0, 0, 0);

    this._target = new THREE.Vector3();
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  setDistance(d) {
    this.distance = Math.max(8, Math.min(40, d));
  }

  update(targetPos, dt) {
    // Smooth follow
    this._target.lerp(targetPos, Math.min(1, this.lerpSpeed * dt));

    const idealX = this._target.x + Math.sin(this.angle) * this.distance;
    const idealZ = this._target.z + Math.cos(this.angle) * this.distance;
    const idealY = this._target.y + this.height;

    this.camera.position.lerp(
      new THREE.Vector3(idealX, idealY, idealZ),
      Math.min(1, 4 * dt)
    );
    this.camera.lookAt(this._target.x, this._target.y + this.lookHeight, this._target.z);
  }

  getCamera() { return this.camera; }
}
