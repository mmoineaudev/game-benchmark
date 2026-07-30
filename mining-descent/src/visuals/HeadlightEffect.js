// =============================================================================
// HeadlightEffect — spotlight from vehicle that extends visibility.
// For MVP: directional light attached to vehicle + darker scene fog.
// =============================================================================

import * as THREE from 'three';
import { Logger } from '../core/Logger.js';

export class HeadlightEffect {
  constructor(scene) {
    this._scene = scene;
    this._light = null;
  }

  init() {
    // Spot light attached to vehicle
    this._light = new THREE.SpotLight(0xffffcc, 2, 15, Math.PI / 6, 0.3, 0.5);
    this._light.position.set(0, 0.4, -0.5);
    this._light.target.position.set(0, -5, -5);
    // Add to scene — will be reparented to vehicle group by Game.js
    this._scene.add(this._light);
    this._scene.add(this._light.target);

    Logger.info('Headlight', 'spotlight created');
  }

  /** Attach to a vehicle group. */
  attachTo(vehicleGroup) {
    vehicleGroup.add(this._light);
    vehicleGroup.add(this._light.target);
  }

  get light() { return this._light; }

  dispose() {
    if (this._light) {
      this._scene.remove(this._light);
      if (this._light.target) this._scene.remove(this._light.target);
      this._light.dispose();
      this._light = null;
    }
    Logger.info('Headlight', 'disposed');
  }
}
