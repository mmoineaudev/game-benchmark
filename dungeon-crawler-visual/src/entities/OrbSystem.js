import * as THREE from 'three';

export class OrbSystem {
  constructor(scene, dungeonData, state) {
    this.scene = scene;
    this.data = dungeonData;
    this.state = state;
    this.orbs = [];
    this.rings = []; // pickup feedback rings
  }

  init() {
    const vaultCells = [];
    const otherCells = [];
    const gs = this.data.gridSize;
    const cs = this.data.cellSize;

    for (let cz = 0; cz < gs; cz++) {
      for (let cx = 0; cx < gs; cx++) {
        const meta = this.data.metadata[cz][cx];
        if (meta.type === 'room') {
          if (meta.roomType === 'VAULT') vaultCells.push({ cx, cz });
          else otherCells.push({ cx, cz });
        }
      }
    }

    const orbMat = new THREE.MeshStandardMaterial({
      color: 0x44aaff, emissive: 0x44aaff, emissiveIntensity: 2.5,
      roughness: 0.15, metalness: 0.4,
    });

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.15, depthWrite: false,
    });
    const glowGeo = new THREE.SphereGeometry(0.45, 16, 16);

    const cells = [...vaultCells, ...otherCells].sort(() => Math.random() - 0.5);
    const chosen = cells.slice(0, Math.min(5, cells.length));

    for (const { cx, cz } of chosen) {
      const x = cx * cs + cs / 2 + (Math.random() - 0.5) * (cs * 0.4);
      const z = cz * cs + cs / 2 + (Math.random() - 0.5) * (cs * 0.4);
      const y = 1.2;

      const orbGeo = new THREE.SphereGeometry(0.25, 32, 32);
      const mesh = new THREE.Mesh(orbGeo, orbMat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(x, y, z);
      this.scene.add(glow);

      // Point light on orb for visibility
      const orbLight = new THREE.PointLight(0x44aaff, 2, 8, 1.5);
      orbLight.position.set(x, y, z);
      this.scene.add(orbLight);

      const particles = this._createOrbParticles(x, y, z);

      this.orbs.push({ mesh, glow, light: orbLight, particles, x, y, z, collected: false, baseY: y });
    }

    this.state.totalOrbs = this.orbs.length;
  }

  _createOrbParticles(x, y, z) {
    const count = 12;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x + (Math.random() - 0.5) * 0.6;
      positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.6;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x88ccff, size: 0.04, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.7,
    });
    const points = new THREE.Points(geo, mat);
    points.userData = { basePositions: new Float32Array(positions) };
    this.scene.add(points);
    return points;
  }

  update(time, playerPos, isPressedE, wasPressedE) {
    const p = playerPos;

    for (const orb of this.orbs) {
      if (orb.collected) continue;

      orb.mesh.position.y = orb.baseY + Math.sin(time * 2.5) * 0.12;
      orb.mesh.rotation.y += 0.015;
      orb.mesh.rotation.x += 0.008;
      orb.glow.position.copy(orb.mesh.position);
      orb.glow.scale.setScalar(1 + Math.sin(time * 3) * 0.1);

      // Orbit particles around orb
      if (orb.particles && orb.particles.userData.basePositions) {
        orb.particles.position.copy(orb.mesh.position);
        orb.particles.rotation.y += 0.02;
        orb.particles.rotation.x += 0.01;
      }

      const dx = p.x - orb.x;
      const dz = p.z - orb.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1.5 && isPressedE && !wasPressedE) {
        orb.collected = true;
        this.state.collectedOrbs++;
        this._spawnPickupRing(orb.x, orb.y, orb.z);
        orb.mesh.scale.set(0, 0, 0);
        orb.glow.scale.set(0, 0, 0);
        orb.light.intensity = 0;
        this.scene.remove(orb.mesh);
        this.scene.remove(orb.glow);
        this.scene.remove(orb.light);
        if (orb.particles) {
          orb.particles.geometry.dispose();
          orb.particles.material.dispose();
          this.scene.remove(orb.particles);
        }
        orb.mesh.geometry.dispose();
        orb.glow.geometry.dispose();
      }
    }

    // Animate pickup rings: expand + fade
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.life += 1 / 60;
      const t = ring.life / ring.ttl;
      ring.mesh.scale.setScalar(0.3 + t * 2.5);
      ring.mesh.material.opacity = ring.baseOpacity * (1 - t);
      ring.mesh.rotation.x += 0.02;
      if (t >= 1) {
        ring.mesh.geometry.dispose();
        ring.mesh.material.dispose();
        this.scene.remove(ring.mesh);
        this.rings.splice(i, 1);
      }
    }
  }

  _spawnPickupRing(x, y, z) {
    const geo = new THREE.TorusGeometry(0.5, 0.04, 8, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x66ccff, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0, ttl: 0.45, baseOpacity: 0.8 });
  }

  nearestOrbDist(playerPos) {
    let min = Infinity;
    for (const orb of this.orbs) {
      if (orb.collected) continue;
      const dx = playerPos.x - orb.x;
      const dz = playerPos.z - orb.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < min) min = d;
    }
    return min;
  }

  dispose() {
    for (const orb of this.orbs) {
      if (!orb.collected) {
        orb.mesh.geometry.dispose();
        orb.glow.geometry.dispose();
        orb.light.dispose?.();
        this.scene.remove(orb.mesh);
        this.scene.remove(orb.glow);
        this.scene.remove(orb.light);
        if (orb.particles) {
          orb.particles.geometry.dispose();
          orb.particles.material.dispose();
          this.scene.remove(orb.particles);
        }
      }
    }
    // Dispose shared materials
    if (this.orbs.length > 0) {
      const m0 = this.orbs[0].mesh.material;
      if (m0 && !m0._disposed) { m0.dispose(); m0._disposed = true; }
      const g0 = this.orbs[0].glow.material;
      if (g0 && !g0._disposed) { g0.dispose(); g0._disposed = true; }
    }
    for (const ring of this.rings) {
      ring.mesh.geometry.dispose();
      ring.mesh.material.dispose();
      this.scene.remove(ring.mesh);
    }
    this.rings = [];
    this.orbs = [];
  }
}
