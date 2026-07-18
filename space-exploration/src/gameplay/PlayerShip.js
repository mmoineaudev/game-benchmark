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
    this._headlight = null;
    this._accentLight = null;
  }

  init() {
    this.mesh = this._createShipMesh();
    this.mesh.position.set(0, 0, 0);
    
    // Initialize velocity vector in userData
    this.mesh.userData.velocity = new THREE.Vector3(0, 0, 0);
    this.mesh.userData.lastCheckpoint = new THREE.Vector3(0, 0, 0);
    this.mesh.userData.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
    this.mesh.userData.hitFlash = 0;
    
    // Lighting
    this._headlight = new THREE.SpotLight(0xffffff, 2, 80, Math.PI / 5, 0.5, 1.5);
    this._headlight.position.set(0, 0, 2);
    this._headlight.target.position.set(0, 0, -20);
    this.mesh.add(this._headlight);
    this.mesh.add(this._headlight.target);

    this._accentLight = new THREE.PointLight(0x4466ff, 1.5, 15);
    this._accentLight.position.set(0, -0.8, 1);
    this.mesh.add(this._accentLight);

    this.scene.add(this.mesh);

    // Create engine flames
    this._createEngineFlames();
    // Create wingtip lights
    this._createWingtipLights();

    return this.mesh;
  }

  _createShipMesh() {
    const group = new THREE.Group();

    // Fuselage — elongated body
    const fuselageGeo = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
    fuselageGeo.rotateX(Math.PI / 2);
    const fuselageMat = new THREE.MeshStandardMaterial({
      color: Constants.SHIP.MESH_COLOR,
      roughness: 0.4,
      metalness: 0.6,
      emissive: Constants.SHIP.MESH_EMISSIVE,
      emissiveIntensity: 0.1,
    });
    const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
    group.add(fuselage);

    // Nose cone
    const noseGeo = new THREE.ConeGeometry(0.3, 1, 8);
    noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, fuselageMat.clone());
    nose.position.z = -2;
    group.add(nose);

    // Cockpit — glass canopy
    const cockpitGeo = new THREE.SphereGeometry(0.28, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cockpitGeo.rotateX(-Math.PI / 2);
    cockpitGeo.translate(0, 0.15, -0.3);
    const cockpitMat = new THREE.MeshPhysicalMaterial({
      color: 0x88ccff,
      roughness: 0.1,
      metalness: 0.0,
      transmission: 0.8,
      thickness: 0.1,
      transparent: true,
      opacity: 0.7,
    });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    group.add(cockpit);

    // Swept wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(2.5, 0.5);
    wingShape.lineTo(2.5, 0.1);
    wingShape.lineTo(0, -0.3);
    wingShape.closePath();

    const wingExtrudeSettings = { depth: 0.08, bevelEnabled: false };
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, wingExtrudeSettings);

    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x5577aa,
      roughness: 0.5,
      metalness: 0.5,
      side: THREE.DoubleSide,
    });

    // Left wing
    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.rotation.x = -Math.PI / 2;
    leftWing.position.set(0, -0.1, 0.2);
    group.add(leftWing);

    // Right wing
    const rightWing = new THREE.Mesh(wingGeo, wingMat);
    rightWing.rotation.x = Math.PI / 2;
    rightWing.rotation.z = Math.PI;
    rightWing.position.set(0, -0.1, 0.2);
    group.add(rightWing);

    // Tail fins
    const tailGeo = new THREE.BoxGeometry(0.08, 0.6, 0.8);
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x4466aa,
      roughness: 0.5,
      metalness: 0.5,
    });

    const leftTail = new THREE.Mesh(tailGeo, tailMat);
    leftTail.position.set(-0.8, 0.3, 1.2);
    leftTail.rotation.z = 0.3;
    group.add(leftTail);

    const rightTail = new THREE.Mesh(tailGeo, tailMat);
    rightTail.position.set(0.8, 0.3, 1.2);
    rightTail.rotation.z = -0.3;
    group.add(rightTail);

    // Vertical stabilizer
    const vertStabGeo = new THREE.BoxGeometry(0.6, 0.5, 0.08);
    const vertStab = new THREE.Mesh(vertStabGeo, tailMat);
    vertStab.position.set(0, 0.5, 1.2);
    group.add(vertStab);

    // Engine nacelles
    const nacelleGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.2, 8);
    nacelleGeo.rotateX(Math.PI / 2);
    const nacelleMat = new THREE.MeshStandardMaterial({
      color: 0x445566,
      roughness: 0.6,
      metalness: 0.4,
    });

    const leftNacelle = new THREE.Mesh(nacelleGeo, nacelleMat);
    leftNacelle.position.set(-0.8, -0.2, 1);
    group.add(leftNacelle);

    const rightNacelle = new THREE.Mesh(nacelleGeo, nacelleMat);
    rightNacelle.position.set(0.8, -0.2, 1);
    group.add(rightNacelle);

    // Engine exhaust rings (emissive)
    const ringGeo = new THREE.TorusGeometry(0.18, 0.03, 8, 16);
    const ringMat = new THREE.MeshStandardMaterial({
      color: Constants.SHIP.ENGINE_COLOR,
      emissive: Constants.SHIP.ENGINE_COLOR,
      emissiveIntensity: 2,
      roughness: 0.2,
    });

    const leftRing = new THREE.Mesh(ringGeo, ringMat);
    leftRing.position.set(-0.8, -0.2, 1.65);
    group.add(leftRing);

    const rightRing = new THREE.Mesh(ringGeo, ringMat);
    rightRing.position.set(0.8, -0.2, 1.65);
    group.add(rightRing);

    // Bounding sphere approximation
    group.userData.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.3), 1.8);

    return group;
  }

  _createEngineFlames() {
    const flameGeo = new THREE.ConeGeometry(0.15, 0.8, 8);
    flameGeo.rotateX(Math.PI / 2);
    
    const flameMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(Constants.SHIP.ENGINE_COLOR) },
        uBrightColor: { value: new THREE.Color(0xffeedd) },
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

    for (let x of [-0.8, 0.8]) {
      const flame = new THREE.Mesh(flameGeo, flameMat.clone());
      flame.position.set(x, -0.2, 2.1);
      flame.visible = false;
      this.mesh.add(flame);
      this._engineFlames.push(flame);
    }
  }

  _createWingtipLights() {
    const lightGeo = new THREE.SphereGeometry(0.05, 6, 6);

    // Red left wingtip
    const redMat = new THREE.MeshStandardMaterial({
      color: Constants.SHIP.WINGTIP_RED,
      emissive: Constants.SHIP.WINGTIP_RED,
      emissiveIntensity: 3,
    });
    const leftLight = new THREE.Mesh(lightGeo, redMat);
    leftLight.position.set(-1.8, 0.1, 0.5);
    this.mesh.add(leftLight);
    this._wingtipLights.push(leftLight);

    // Green right wingtip
    const greenMat = new THREE.MeshStandardMaterial({
      color: Constants.SHIP.WINGTIP_GREEN,
      emissive: Constants.SHIP.WINGTIP_GREEN,
      emissiveIntensity: 3,
    });
    const rightLight = new THREE.Mesh(lightGeo, greenMat);
    rightLight.position.set(1.8, 0.1, 0.5);
    this.mesh.add(rightLight);
    this._wingtipLights.push(rightLight);
  }

  /**
   * Update ship rotation (yaw + roll)
   */
  updateRotation(dt, rollInput) {
    if (!this.mesh) return;

    // Roll from mouse input
    const targetRoll = -rollInput * 0.6;
    this.mesh.rotation.z += (targetRoll - this.mesh.rotation.z) * Constants.SHIP.ROLL_SPEED * dt;

    // Yaw from velocity direction (subtle)
    const vel = this.mesh.userData.velocity;
    if (vel.length() > 1) {
      const targetYaw = Math.atan2(vel.x, vel.z);
      // Smoothly rotate toward velocity direction
      let diff = targetYaw - this.mesh.rotation.y;
      // Normalize to [-PI, PI]
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.mesh.rotation.y += diff * Constants.SHIP.ROTATION_SPEED * dt;
    }
  }

  /**
   * Update engine flames based on thrust
   */
  updateEngineFlames(thrusting) {
    const targetOpacity = thrusting ? 0.8 : 0.2;
    const targetScale = thrusting ? 1.2 : 0.5;

    for (const flame of this._engineFlames) {
      flame.visible = true;
      // Update shader uniforms for flickering flame
      if (flame.material.uniforms) {
        flame.material.uniforms.uThrust.value = thrusting ? 1 : 0;
        flame.material.uniforms.uTime.value = GameState.time;
        flame.material.uniforms.uColor.value = new THREE.Color(Constants.SHIP.ENGINE_COLOR);
      }
      // Fallback scale animation
      const s = flame.scale.x + (targetScale - flame.scale.x) * 5;
      flame.scale.set(s, s, s);
    }

    // Update accent light intensity
    if (this._accentLight) {
      this._accentLight.intensity = thrusting ? 3 : 1;
    }
  }

  /**
   * Handle hit flash effect
   */
  updateHitFlash(dt) {
    if (this.mesh.userData.hitFlash > 0) {
      this.mesh.userData.hitFlash -= dt;
      
      // Flash red on ship meshes
      this.mesh.children.forEach(child => {
        if (child.isMesh && child.material && child.material.emissiveIntensity !== undefined) {
          if (!child.material.transparent) {
            child.material.emissiveIntensity = 0.8;
            child.material.emissive.setHex(0xff0000);
          }
        }
      });
    } else {
      // Reset emissive
      this.mesh.children.forEach(child => {
        if (child.isMesh && child.material && child.material.emissiveIntensity !== undefined) {
          if (!child.material.transparent) {
            child.material.emissiveIntensity = 0.1;
            child.material.emissive.setHex(Constants.SHIP.MESH_EMISSIVE);
          }
        }
      });
    }
  }

  /**
   * Update bounding sphere
   */
  updateBoundingSphere() {
    if (this.mesh) {
      this.mesh.getWorldPosition(new THREE.Vector3());
    }
  }

  /**
   * Destroy the ship mesh
   */
  destroy() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    
    // Dispose geometries and materials
    this.mesh.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}

export default PlayerShip;
