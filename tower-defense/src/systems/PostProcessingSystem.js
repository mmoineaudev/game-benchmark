import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export default class PostProcessingSystem {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this._bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.4, 0.88);
    this.composer.addPass(this._bloom);
    this.composer.addPass(new OutputPass());
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }
  _resize() {
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this._bloom.setSize(window.innerWidth, window.innerHeight);
  }
  update(dt) {
    this.composer.render(dt);
  }
}
