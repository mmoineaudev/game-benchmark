// ============================================================
// PlayerShip — Ship mesh, movement logic, thrust, steering
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import GameState from '../core/GameState.js';
import { FLAME_VERTEX_SHADER, FLAME_FRAGMENT_SHADER } from '../utils/ShaderHelpers.js';

class PlayerShip {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this._engineFlames = [];
    this._wingtipLights = [];
    this._reactorGlows = [];
    this._tailLights = [];
    this._thrustTrails = [];
    this._headlight = null;
    this._accentLight = null;
    this._idleTime = 0;
    this._yawInput = 0;
  }

  init() {
    this.mesh = this._createShipMesh();
    this.mesh.position.set(0, 0, 0);
    this.mesh.userData.velocity = new THREE.Vector3(0, 0, 0);
    this.mesh.userData.lastCheckpoint = new THREE.Vector3(0, 0, 0);
    this.mesh.userData.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.3), 1.6);
    this.mesh.userData.hitFlash = 0;

    this._headlight = new THREE.SpotLight(0xffffff, 0.8, 22, Math.PI / 6, 0.6, 1.5);
    this._headlight.position.set(0, 0, 2);
    this._headlight.target.position.set(0, 0, -15);
    this.mesh.add(this._headlight);
    this.mesh.add(this._headlight.target);

    this._accentLight = new THREE.PointLight(Constants.SHIP.ACCENT_COLOR, 1.0, 10);
    this._accentLight.position.set(0, -0.8, 1);
    this.mesh.add(this._accentLight);

    this.scene.add(this.mesh);
    this._createEngineFlames();
    this._createTailLights();
    this._createReactorGlows();

    return this.mesh;
  }

  _createShipMesh() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc3311, roughness: 0.25, metalness: 0.7 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.9 });

    // Main low long body like a 1960s muscle car
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.2, 2, 1, 2), bodyMat);
    body.position.set(0, 0.05, 0);
    body.geometry.translate(0, 0, 0.1);
    group.add(body);

    // Hood / front deck
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.15, 1.4), trimMat);
    hood.position.set(0, 0.35, -1.3);
    group.add(hood);

    // Rounded nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0.05, -2.1);
    nose.scale.set(1, 0.7, 1);
    group.add(nose);

    // Rear deck / trunk
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 1.2), trimMat);
    trunk.position.set(0, 0.38, 1.4);
    group.add(trunk);

    // Windshield/cabin
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.35, 1.0),
      new THREE.MeshPhysicalMaterial({ color: 0x88ccff, roughness: 0.1, metalness: 0.0, transmission: 0.7, thickness: 0.1, transparent: true, opacity: 0.7 })
    );
    cabin.position.set(0, 0.52, 0.1);
    group.add(cabin);

    // Small wings
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x881111, roughness: 0.35, metalness: 0.7 });
    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.8), wingMat);
    leftWing.position.set(-1.1, 0.05, 0.4);
    group.add(leftWing);
    const rightWing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.8), wingMat);
    rightWing.position.set(1.1, 0.05, 0.4);
    group.add(rightWing);

    // Reactor/engines on wings
    const nacelleMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.4, metalness: 0.8 });
    const leftNacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.5, 8), nacelleMat);
    leftNacelle.rotation.x = Math.PI / 2;
    leftNacelle.position.set(-1.1, -0.15, 0.4);
    group.add(leftNacelle);

    const rightNacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.5, 8), nacelleMat);
    rightNacelle.rotation.x = Math.PI / 2;
    rightNacelle.position.set(1.1, -0.15, 0.4);
    group.add(rightNacelle);

    // Wing reactor rings
    const ringGeo = new THREE.TorusGeometry(0.2, 0.04, 8, 16);
    const ringMat = new THREE.MeshStandardMaterial({ color: Constants.SHIP.ENGINE_COLOR, emissive: Constants.SHIP.ENGINE_COLOR, emissiveIntensity: 1.2, roughness: 0.2 });
    const leftRing = new THREE.Mesh(ringGeo, ringMat);
    leftRing.position.set(-1.1, -0.15, 1.2);
    group.add(leftRing);
    const rightRing = new THREE.Mesh(ringGeo, ringMat);
    rightRing.position.set(1.1, -0.15, 1.2);
    group.add(rightRing);

    // Tail fins
    const finMat = new THREE.MeshStandardMaterial({ color: 0xaa2222, roughness: 0.35, metalness: 0.5 });
    const leftFin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.7), finMat);
    leftFin.position.set(-0.85, 0.42, 1.7);
    leftFin.rotation.z = 0.35;
    group.add(leftFin);
    const rightFin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.7), finMat);
    rightFin.position.set(0.85, 0.42, 1.7);
    rightFin.rotation.z = -0.35;
    group.add(rightFin);

    // Bumper / skid strip
    const skid = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.25), trimMat);
    skid.position.set(0, -0.25, -1.6);
    group.add(skid);

    group.userData.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.3), 1.8);
    return group;
  }

  _createEngineFlames() {
    const flameGeo = new THREE.ConeGeometry(0.18, 1.0, 8);
    flameGeo.rotateX(Math.PI / 2);

    const flameMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(Constants.SHIP.ENGINE_COLOR) },
        uBrightColor: { value: new THREE.Color(Constants.SHIP.ENGINE_GLOW_COLOR) },
        uTime: { value: 0 },
        uThrust: { value: 0 },
      },
      vertexShader: FLAME_VERTEX_SHADER,
      fragmentShader: FLAME_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const glowSpriteMat = new THREE.SpriteMaterial({
      color: Constants.SHIP.ENGINE_GLOW_COLOR,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowSprite = new THREE.Sprite(glowSpriteMat);
    glowSprite.scale.set(2.4, 2.4, 1);
    glowSprite.position.set(0, -0.2, 2.6);
    glowSprite.visible = false;
    this.mesh.add(glowSprite);
    this._engineGlow = glowSprite;

    for (let x of [-1.1, 1.1]) {
      const flame = new THREE.Mesh(flameGeo, flameMat.clone());
      flame.position.set(x, -0.25, 2.2);
      flame.visible = false;
      this.mesh.add(flame);
      this._engineFlames.push(flame);
    }
  }

  _createTailLights() {
    const lightGeo = new THREE.SphereGeometry(0.07, 6, 6);
    const redMat = new THREE.MeshStandardMaterial({ color: Constants.SHIP.WINGTIP_RED, emissive: Constants.SHIP.WINGTIP_RED, emissiveIntensity: 2.5 });
    for (let x of [-0.7, 0.7]) {
      const tail = new THREE.Mesh(lightGeo, redMat);
      tail.position.set(x, 0.05, 2.0);
      this.mesh.add(tail);
      this._tailLights.push(tail);
    }
  }

  _createReactorGlows() {
    const spriteMat = new THREE.SpriteMaterial({ color: Constants.SHIP.ENGINE_GLOW_COLOR, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let x of [-1.1, 1.1]) {
      const s = new THREE.Sprite(spriteMat.clone());
      s.scale.set(1.6, 1.6, 1);
      s.position.set(x, -0.15, 1.2);
      this.mesh.add(s);
      this._reactorGlows.push(s);
    }
  }

  updateRotation(dt, input) {
    if (!this.mesh) return;

    const speedRatio = Math.min(this.mesh.userData.velocity.length() / Constants.SHIP.MAX_SPEED, 1);
    const speedLerp = 0.6 + 0.4 * speedRatio;
    const rate = Constants.SHIP.ROTATION_SPEED * speedLerp;

    this._yawInput = 0;
    if (input.isPressed('ArrowLeft')) this._yawInput += 1;
    if (input.isPressed('ArrowRight')) this._yawInput -= 1;

    if (input.isPressed('ArrowLeft')) this.mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), rate * dt);
    if (input.isPressed('ArrowRight')) this.mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -rate * dt);
    if (input.isPressed('ArrowDown')) this.mesh.rotateOnAxis(new THREE.Vector3(1, 0, 0), rate * dt);
    if (input.isPressed('ArrowUp')) this.mesh.rotateOnAxis(new THREE.Vector3(1, 0, 0), -rate * dt);

    const q = new THREE.Euler().setFromQuaternion(this.mesh.quaternion, 'YXZ');
    q.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, q.x));
    this.mesh.quaternion.setFromEuler(q);
  }

  updateEngineFlames(thrusting) {
    const speed = this.mesh.userData.velocity.length() || 0;
    const speedRatio = Math.min(speed / Constants.SHIP.MAX_SPEED, 1);
    const targetScale = 0.6 + 0.9 * speedRatio;

    for (let i = 0; i < this._engineFlames.length; i++) {
      const flame = this._engineFlames[i];
      flame.visible = true;
      const isRight = i === 1;
      const boost = 1 + 0.9 * speedRatio;
      if (this._yawInput > 0.01 && isRight) flame.scale.setScalar(targetScale * 1.6 * boost);
      else if (this._yawInput < -0.01 && !isRight) flame.scale.setScalar(targetScale * 1.6 * boost);
      else flame.scale.setScalar(targetScale);

      if (flame.material.uniforms) {
        flame.material.uniforms.uThrust.value = thrusting ? 1 : 0;
        flame.material.uniforms.uTime.value = GameState.time;
        flame.material.uniforms.uColor.value.set(Constants.SHIP.ENGINE_COLOR);
        flame.material.uniforms.uBrightColor.value.set(Constants.SHIP.ENGINE_GLOW_COLOR);
      }
    }

    if (this._engineGlow) {
      this._engineGlow.visible = true;
      this._engineGlow.material.opacity = 0.08 + 0.28 * speedRatio;
      const gs = 1.4 + 2.2 * speedRatio;
      this._engineGlow.scale.set(gs, gs, 1);
    }

    if (this._accentLight) this._accentLight.intensity = 1.2 + 2.0 * speedRatio;

    if (this._reactorGlows.length === 2) {
      this._reactorGlows[0].material.opacity = 0.15 + speedRatio * 0.2 + Math.abs(this._yawInput) * 0.25;
      this._reactorGlows[1].material.opacity = 0.15 + speedRatio * 0.2 + Math.abs(this._yawInput) * 0.25;
      this._reactorGlows.forEach((rg, idx) => {
        const lit = idx === 0 ? this._yawInput > 0.01 : this._yawInput < -0.01;
        rg.material.color.set(lit ? 0xffffff : Constants.SHIP.ENGINE_GLOW_COLOR);
      });
    }
  }

  updateHitFlash(dt) {
    const meshes = [];
    this.mesh.traverse((child) => {
      if (child.isMesh && child.material && child.material.emissiveIntensity !== undefined) {
        meshes.push(child);
      }
    });

    if (this.mesh.userData.hitFlash > 0) {
      this.mesh.userData.hitFlash -= dt;
      for (const c of meshes) {
        if (!c.material.transparent) {
          c.material.emissiveIntensity = 0.8;
          c.material.emissive.setHex(0xff0000);
        }
      }
    } else {
      for (const c of meshes) {
        if (!c.material.transparent) {
          c.material.emissiveIntensity = 0.1;
          c.material.emissive.setHex(Constants.SHIP.MESH_EMISSIVE);
        }
      }
    }
  }

  updateBoundingSphere() {
    if (this.mesh) this.mesh.getWorldPosition(new THREE.Vector3());
  }

  destroy() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}

export default PlayerShip;
