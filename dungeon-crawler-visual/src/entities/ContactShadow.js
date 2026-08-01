import * as THREE from 'three';
import { generateGlowTexture } from '../world/Textures.js';

// Cheap "grounding" contact shadow blob under every entity. A single dark
// radial-gradient sprite (or circle) that always points down, moves with the
// entity, and scales/fades with its bobbing. Zero shadow-map cost and it makes
// entities read as sitting *in* the world rather than floating.
//
// Cost: one Sprite per entity, depthWrite false, additive off (normal black
// sprite with high transparency). No per-frame allocation — update() only
// writes transform/scale/opacity.
export class ContactShadow {
  // entity: object with a `.group` (THREE.Group). radius: base footprint.
  constructor(entity, radius = 0.5, opts = {}) {
    this.entity = entity;
    this.baseRadius = radius;
    this.offsetY = opts.offsetY !== undefined ? opts.offsetY : 0.015; // just above floor
    this.maxOpacity = opts.maxOpacity !== undefined ? opts.maxOpacity : 0.28;
    this.tex = opts.tex || generateGlowTexture();
    this.mat = new THREE.SpriteMaterial({
      map: this.tex,
      color: 0x000000,
      transparent: true,
      depthWrite: false,
      opacity: this.maxOpacity,
      rotation: Math.PI / 2, // round blob regardless of camera
    });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.scale.set(this.baseRadius * 2, this.baseRadius * 2, 1);
    this.sprite.position.y = this.offsetY;
    // Put it on the entity's group so it inherits world position/yaw.
    (opts.parent || entity.group).add(this.sprite);
  }

  // bob: current vertical offset of the entity above its rest y (0 = grounded).
  // Scales the blob down + fades out as the entity lifts off / dies.
  update(bobWorldY = 0) {
    const lift = Math.max(0, bobWorldY - this.offsetY);
    // Fade & shrink as it lifts: fully grounded (lift=0) = full blob.
    const k = Math.max(0, 1 - lift * 2.2);
    this.mat.opacity = this.maxOpacity * k;
    this.sprite.scale.set(
      this.baseRadius * 2 * (0.7 + 0.3 * k),
      this.baseRadius * 2 * (0.7 + 0.3 * k),
      1,
    );
  }

  dispose() {
    const parent = this.sprite.parent;
    if (parent) parent.remove(this.sprite);
    this.mat.dispose();
    if (this.tex) this.tex.dispose();
  }
}
