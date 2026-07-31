import * as THREE from 'three';
import { LIGHTING } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

export class LightingSystem {
  constructor(scene) {
    this.scene = scene;
    this.torches = [];
    this.godRays = [];
    this._glowTex = null;
    this._glowMat = null;

    this.bracketMaterial = new THREE.MeshStandardMaterial({
      color: LIGHTING.BRACKET_COLOR, roughness: 0.5, metalness: 0.9,
    });
  }

  init(dungeonData) {
    this.ambient = new THREE.AmbientLight(LIGHTING.AMBIENT_COLOR, LIGHTING.AMBIENT_INTENSITY);
    this.scene.add(this.ambient);
    this.scene.fog = new THREE.FogExp2(LIGHTING.FOG_COLOR, LIGHTING.FOG_DENSITY);

    this._glowTex = generateGlowTexture();
    this._glowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.6,
    });

    this._flameGeo = new THREE.ConeGeometry(0.1, 0.5, 6, 1);

    this._placeAllTorches(dungeonData);
    this._placeGodRays(dungeonData);
    this._placeStartEndMarkers(dungeonData);
    this._updateShadowCasting(null);
  }

  _placeAllTorches(dungeonData) {
    const cs = dungeonData.cellSize;
    const gs = dungeonData.gridSize;
    const spacing = 8;
    const torchY = 2.5;

    for (let cz = 0; cz < gs; cz++) {
      for (let cx = 0; cx < gs; cx++) {
        if (dungeonData.grid[cz][cx] === 'empty') continue;
        const wx = cx * cs;
        const wz = cz * cs;

        if (cz === 0 || dungeonData.grid[cz - 1][cx] === 'empty')
          this._placeTorchesOnEdge(wx, wz, wx + cs, wz, torchY, 'north', spacing, cs);
        if (cx === gs - 1 || dungeonData.grid[cz][cx + 1] === 'empty')
          this._placeTorchesOnEdge(wx + cs, wz, wx + cs, wz + cs, torchY, 'east', spacing, cs);
        if (cz === gs - 1 || dungeonData.grid[cz + 1][cx] === 'empty')
          this._placeTorchesOnEdge(wx + cs, wz + cs, wx, wz + cs, torchY, 'south', spacing, cs);
        if (cx === 0 || dungeonData.grid[cz][cx - 1] === 'empty')
          this._placeTorchesOnEdge(wx, wz + cs, wx, wz, torchY, 'west', spacing, cs);
      }
    }
  }

  _placeTorchesOnEdge(x1, z1, x2, z2, y, dir, spacing) {
    const dist = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
    if (dist < spacing) {
      this._addTorch((x1 + x2) / 2, y, (z1 + z2) / 2, dir);
    } else {
      const count = Math.floor(dist / spacing);
      const off = (dist - (count - 1) * spacing) / 2;
      for (let i = 0; i < count; i++) {
        const t = (off + i * spacing) / dist;
        this._addTorch(x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t, dir);
      }
    }
  }

  _addTorch(x, y, z, dir) {
    const offset = 0.3;
    if (dir === 'north') z += offset;
    else if (dir === 'east') x -= offset;
    else if (dir === 'south') z -= offset;
    else if (dir === 'west') x += offset;

    // Wall sconce — two-part bracket
    const sconceGroup = new THREE.Group();

    // Backplate
    const plateGeo = new THREE.BoxGeometry(0.25, 0.5, 0.06);
    const plate = new THREE.Mesh(plateGeo, this.bracketMaterial);
    plate.position.y = -0.2;
    sconceGroup.add(plate);

    // Arm extending from wall
    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 0.3);
    const arm = new THREE.Mesh(armGeo, this.bracketMaterial);
    arm.position.set(0, -0.1, 0.18);
    sconceGroup.add(arm);

    // Cup holding the flame
    const cupGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.15, 8);
    const cup = new THREE.Mesh(cupGeo, this.bracketMaterial);
    cup.position.set(0, 0.02, 0.32);
    sconceGroup.add(cup);

    sconceGroup.position.set(x, y - 0.3, z);
    // Rotate sconce to face into the room
    if (dir === 'north') sconceGroup.rotation.y = 0;
    else if (dir === 'east') sconceGroup.rotation.y = -Math.PI / 2;
    else if (dir === 'south') sconceGroup.rotation.y = Math.PI;
    else if (dir === 'west') sconceGroup.rotation.y = Math.PI / 2;

    sconceGroup.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    this.scene.add(sconceGroup);

    // Flame — cone geometry, animated via scale in update()
    const flameMat = new THREE.MeshBasicMaterial({ color: LIGHTING.FLAME_COLOR });
    const flame = new THREE.Mesh(this._flameGeo, flameMat);
    flame.position.set(x, y, z);
    flame.rotation.z = Math.PI; // point up
    this.scene.add(flame);

    // Glow sprite around flame
    const glowSprite = new THREE.Sprite(this._glowMat);
    glowSprite.position.set(x, y, z);
    glowSprite.scale.set(1.2, 1.2, 1);
    this.scene.add(glowSprite);

    // PointLight
    const light = new THREE.PointLight(
      LIGHTING.TORCH_COLOR, LIGHTING.TORCH_INTENSITY,
      LIGHTING.TORCH_DISTANCE, LIGHTING.TORCH_DECAY,
    );
    light.position.set(x, y, z);
    light.castShadow = false;
    this.scene.add(light);

    this.torches.push({
      light, flame, glow: glowSprite, bracket: sconceGroup, x, y, z,
      baseIntensity: LIGHTING.TORCH_INTENSITY,
      shadowEnabled: false,
    });
  }

  update(time, playerPos) {
    for (const t of this.torches) {
      const flicker = Math.sin(time * 9 + t.x * 3.7) * 0.1 + Math.sin(time * 14 + t.z * 5.2) * 0.08;
      t.light.intensity = t.baseIntensity * (1 + flicker);

      // Flame scale — stretches and contracts
      const scaleY = 0.8 + flicker * 0.6;
      const scaleXZ = 1 + flicker * 0.3;
      t.flame.scale.set(scaleXZ, scaleY, scaleXZ);

      // Glow sprite pulse
      const glowScale = 1.1 + flicker * 0.4;
      t.glow.scale.setScalar(glowScale);
      t.glow.material.opacity = 0.5 + flicker * 0.3;
    }

    if (!this._lastShadowUpdate || time - this._lastShadowUpdate > 0.5) {
      this._updateShadowCasting(playerPos);
      this._lastShadowUpdate = time;
    }
  }

  _updateShadowCasting(playerPos) {
    if (!playerPos) return;
    const sorted = [...this.torches].sort((a, b) => {
      const da = (a.x - playerPos.x) ** 2 + (a.z - playerPos.z) ** 2;
      const db = (b.x - playerPos.x) ** 2 + (b.z - playerPos.z) ** 2;
      return da - db;
    });
    const maxShadows = LIGHTING.TORCH_SHADOW_COUNT;
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const shouldCast = i < maxShadows;
      if (t.shadowEnabled !== shouldCast) {
        t.shadowEnabled = shouldCast;
        t.light.castShadow = shouldCast;
        if (shouldCast) {
          t.light.shadow.mapSize.set(LIGHTING.TORCH_SHADOW_MAP, LIGHTING.TORCH_SHADOW_MAP);
          t.light.shadow.camera.near = LIGHTING.TORCH_SHADOW_NEAR;
          t.light.shadow.camera.far = LIGHTING.TORCH_SHADOW_FAR;
          t.light.shadow.bias = -0.005;
          t.light.shadow.normalBias = 0.02;
        }
      }
    }
  }

  _placeGodRays(dungeonData) {
    for (const t of this.torches) {
      const cx = Math.floor(t.x / dungeonData.cellSize);
      const cz = Math.floor(t.z / dungeonData.cellSize);
      if (cz < 0 || cz >= dungeonData.gridSize || cx < 0 || cx >= dungeonData.gridSize) continue;
      const meta = dungeonData.metadata[cz][cx];
      if (meta && meta.type === 'room' && meta.roomType === 'VAULT') {
        const geo = new THREE.CylinderGeometry(0.3, 1.5, 4, 8, 1, true);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffaa44, transparent: true, opacity: 0.05,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const ray = new THREE.Mesh(geo, mat);
        ray.position.set(t.x, t.y - 2, t.z);
        this.scene.add(ray);
        this.godRays.push(ray);
      }
    }
  }

  _placeStartEndMarkers(dungeonData) {
    const entrance = dungeonData.entranceCell;
    const exit = dungeonData.exitCell;
    const cs = dungeonData.cellSize;

    // --- START marker: green ring + soft light ---
    const sx = entrance.x * cs + cs / 2;
    const sz = entrance.z * cs + cs / 2;
    const startRingGeo = new THREE.RingGeometry(1.2, 1.5, 32);
    const startRingMat = new THREE.MeshBasicMaterial({
      color: 0x44ffaa, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false,
    });
    this.startMarker = new THREE.Mesh(startRingGeo, startRingMat);
    this.startMarker.rotation.x = -Math.PI / 2;
    this.startMarker.position.set(sx, 0.03, sz);
    this.scene.add(this.startMarker);

    const startInnerGeo = new THREE.CircleGeometry(0.8, 32);
    const startInnerMat = new THREE.MeshBasicMaterial({
      color: 0x66ffcc, side: THREE.DoubleSide, transparent: true, opacity: 0.3, depthWrite: false,
    });
    this.startInner = new THREE.Mesh(startInnerGeo, startInnerMat);
    this.startInner.rotation.x = -Math.PI / 2;
    this.startInner.position.set(sx, 0.04, sz);
    this.scene.add(this.startInner);

    this._startLight = new THREE.PointLight(0x44ffaa, 1.5, 8, 1.5);
    this._startLight.position.set(sx, 1.5, sz);
    this.scene.add(this._startLight);

    // --- EXIT marker: golden ring + beam ---
    const x = exit.x * cs + cs / 2;
    const z = exit.z * cs + cs / 2;

    // Outer ring
    const ringGeo = new THREE.RingGeometry(1.2, 1.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false,
    });
    this.exitMarker = new THREE.Mesh(ringGeo, ringMat);
    this.exitMarker.rotation.x = -Math.PI / 2;
    this.exitMarker.position.set(x, 0.03, z);
    this.scene.add(this.exitMarker);

    // Inner glow circle
    const innerGeo = new THREE.CircleGeometry(0.8, 32);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffcc44, side: THREE.DoubleSide, transparent: true, opacity: 0.3, depthWrite: false,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(x, 0.04, z);
    this.scene.add(inner);
    this._exitInner = inner;

    // Vertical light beam — tall transparent cylinder
    const beamGeo = new THREE.CylinderGeometry(0.3, 0.3, 6, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffcc44, transparent: true, opacity: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._exitBeam = new THREE.Mesh(beamGeo, beamMat);
    this._exitBeam.position.set(x, 3, z);
    this.scene.add(this._exitBeam);

    // Point light at exit for visibility
    this._exitLight = new THREE.PointLight(0xffaa00, 2, 10, 1.5);
    this._exitLight.position.set(x, 1.5, z);
    this.scene.add(this._exitLight);
  }

  dispose() {
    for (const t of this.torches) {
      if (t.light.shadow) t.light.shadow.dispose?.();
      t.light.dispose?.();
      t.glow.material.dispose?.();
      if (t.flame.material) t.flame.material.dispose();
      t.bracket.traverse(c => { if (c.geometry) c.geometry.dispose(); });
      this.scene.remove(t.bracket);
      this.scene.remove(t.flame);
      this.scene.remove(t.glow);
    }
    for (const gr of this.godRays) {
      gr.geometry.dispose(); gr.material.dispose(); this.scene.remove(gr);
    }
    if (this.startMarker) {
      this.startMarker.geometry.dispose(); this.startMarker.material.dispose();
      this.scene.remove(this.startMarker);
    }
    if (this.startInner) {
      this.startInner.geometry.dispose(); this.startInner.material.dispose();
      this.scene.remove(this.startInner);
    }
    if (this._startLight) {
      this._startLight.dispose?.();
      this.scene.remove(this._startLight);
    }
    if (this.exitMarker) {
      this.exitMarker.geometry.dispose(); this.exitMarker.material.dispose();
      this.scene.remove(this.exitMarker);
    }
    if (this._exitInner) {
      this._exitInner.geometry.dispose(); this._exitInner.material.dispose();
      this.scene.remove(this._exitInner);
    }
    if (this._exitBeam) {
      this._exitBeam.geometry.dispose(); this._exitBeam.material.dispose();
      this.scene.remove(this._exitBeam);
    }
    if (this._exitLight) {
      this._exitLight.dispose?.();
      this.scene.remove(this._exitLight);
    }
    if (this._glowTex) this._glowTex.dispose();
    if (this._glowMat) this._glowMat.dispose();
    if (this._flameGeo) this._flameGeo.dispose();
    this.bracketMaterial.dispose();
    this.torches = [];
    this.godRays = [];
  }
}
