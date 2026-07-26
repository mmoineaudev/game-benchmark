import * as THREE from 'three';
import { GRID_COLS, GRID_ROWS, TILE_SIZE, START_TILE, END_TILE, COLORS } from '../core/Constants.js';

export default class PathSystem {
  constructor(scene) {
    this.scene = scene;
    this.pathTiles = new Set();
    this._orderedPath = [];
    this._centerline = [];
    this._mesh = null;
    this._smoke = null;
    this._tilesMesh = null;
    this._groundGrid = null;
    this._edgeGlows = null;
    this._flowDots = null;
    this._dust = null;
  }
  rebuild() {
    this.pathTiles = this._generatePath();
    this._orderedPath = this._orderPath();
    this._centerline = this._buildCenterline();
    this._buildMeshes();
    this._buildFlowDots();
    this._buildDust();
  }
  _inBounds(qx, qy) { return qx >= 0 && qx < GRID_COLS && qy >= 0 && qy < GRID_ROWS; }
  _idx(qx, qy) { return qy * GRID_COLS + qx; }
  _neighbors(qx, qy) {
    return [
      { qx: qx + 1, qy }, { qx: qx - 1, qy },
      { qx, qy: qy + 1 }, { qx, qy: qy - 1 }
    ].filter(n => this._inBounds(n.qx, n.qy) && this.pathTiles.has(this._idx(n.qx, n.qy)));
  }
  _generatePath() {
    const start = { qx: START_TILE.qx, qy: START_TILE.qy };
    const end = { qx: END_TILE.qx, qy: END_TILE.qy };
    const path = new Set();
    const idx = (qx, qy) => this._idx(qx, qy);

    const walkBetween = (ax, ay, bx, by) => {
      let cx = ax, cy = ay;
      path.add(idx(cx, cy));
      let guard = 0;
      while ((cx !== bx || cy !== by) && guard++ < GRID_COLS * GRID_ROWS * 2) {
        // Alternate between horizontal and vertical for zigzag
        if (guard % 2 === 0 || Math.abs(cx - bx) >= Math.abs(cy - by)) {
          if (cx !== bx) cx += Math.sign(bx - cx);
          else if (cy !== by) cy += Math.sign(by - cy);
        } else {
          if (cy !== by) cy += Math.sign(by - cy);
          else if (cx !== bx) cx += Math.sign(bx - cx);
        }
        path.add(idx(cx, cy));
      }
    };

    const numWaypoints = 8 + Math.floor(Math.random() * 5);  // 8-12 waypoints
    const step = (end.qx - start.qx) / (numWaypoints + 1);
    let prevX = start.qx, prevY = start.qy;
    walkBetween(prevX, prevY, start.qx, start.qy);

    for (let i = 1; i <= numWaypoints; i++) {
      const tx = Math.round(start.qx + step * i);
      const direction = (i % 2 === 1) ? -1 : 1;
      // Wider vertical swing for longer path
      const maxSwing = Math.floor(GRID_ROWS * 0.42);
      const minSwing = Math.floor(GRID_ROWS * 0.15);
      const offset = (minSwing + Math.floor(Math.random() * (maxSwing - minSwing))) * direction;
      const ty = Math.max(1, Math.min(GRID_ROWS - 2, Math.floor(GRID_ROWS / 2) + offset));
      walkBetween(prevX, prevY, tx, ty);
      prevX = tx; prevY = ty;
    }
    walkBetween(prevX, prevY, end.qx, end.qy);
    return path;
  }
  _neighborsFor(end) {
    const self = this;
    return function(qx, qy) {
      return [
        { qx: qx + 1, qy: qy }, { qx: qx - 1, qy: qy },
        { qx, qy: qy + 1 }, { qx, qy: qy - 1 }
      ].filter(n => self._inBounds(n.qx, n.qy));
    };
  }
  _reconnect(path, start, end) {
    const queue = [start];
    const seen = new Set([this._idx(start.qx, start.qy)]);
    while (queue.length) {
      const cur = queue.shift();
      if (cur.qx === end.qx && cur.qy === end.qy) return;
      for (const n of this._neighbors(cur.qx, cur.qy)) {
        const k = this._idx(n.qx, n.qy);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(n);
      }
    }
    let cx = start.qx, cy = start.qy;
    path.add(this._idx(cx, cy));
    while (!(cx === end.qx && cy === end.qy)) {
      if (Math.abs(cx - end.qx) > Math.abs(cy - end.qy)) cx += Math.sign(end.qx - cx);
      else cy += Math.sign(end.qy - cy);
      path.add(this._idx(cx, cy));
    }
  }
  _orderPath() {
    const start = { ...START_TILE };
    const end = { ...END_TILE };
    if (!this.pathTiles.has(this._idx(start.qx, start.qy))) {
      const arr = Array.from(this.pathTiles);
      if (arr.length === 0) return [];
      start.qx = arr[0] % GRID_COLS; start.qy = Math.floor(arr[0] / GRID_COLS);
    }
    const parent = new Map();
    const queue = [start];
    const seen = new Set([this._idx(start.qx, start.qy)]);
    let foundEnd = false;
    while (queue.length) {
      const cur = queue.shift();
      if (cur.qx === end.qx && cur.qy === end.qy) { foundEnd = true; break; }
      for (const n of this._neighbors(cur.qx, cur.qy)) {
        const k = this._idx(n.qx, n.qy);
        if (seen.has(k)) continue;
        seen.add(k);
        parent.set(k, cur);
        queue.push(n);
      }
    }
    if (!foundEnd) {
      return Array.from(this.pathTiles).map(idx => ({
        qx: idx % GRID_COLS, qy: Math.floor(idx / GRID_COLS)
      }));
    }
    const steps = [];
    let cur = end;
    let guard = 0;
    while (cur && guard++ < GRID_COLS * GRID_ROWS) {
      steps.push(cur);
      if (cur.qx === start.qx && cur.qy === start.qy) break;
      cur = parent.get(this._idx(cur.qx, cur.qy)) || null;
    }
    steps.reverse();
    return steps;
  }
  _buildCenterline() {
    const pts = this._orderedPath.map(s => new THREE.Vector3(s.qx * TILE_SIZE + TILE_SIZE/2, 0.05, s.qy * TILE_SIZE + TILE_SIZE/2));
    if (pts.length < 2) return pts;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const n = Math.max(4, Math.floor(a.distanceTo(b) * 8));
      for (let j = 0; j < n; j++) { out.push(a.clone().lerp(b, j / n)); }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  _buildMeshes() {
    if (this._mesh) { this.scene.remove(this._mesh); this._mesh.geometry.dispose(); this._mesh.material.dispose(); this._mesh = null; }
    if (this._tilesMesh) { this.scene.remove(this._tilesMesh); this._tilesMesh.geometry.dispose(); this._tilesMesh.material.dispose(); this._tilesMesh = null; }
    if (this._groundGrid) { this.scene.remove(this._groundGrid); this._groundGrid.geometry.dispose(); this._groundGrid.material.dispose(); this._groundGrid = null; }
    if (this._smoke) { this.scene.remove(this._smoke); this._smoke.geometry.dispose(); this._smoke.material.dispose(); this._smoke = null; }
    if (this._edgeGlows) { this.scene.remove(this._edgeGlows); this._edgeGlows.geometry.dispose(); this._edgeGlows.material.dispose(); this._edgeGlows = null; }

    const pathIndices = new Set(this.pathTiles);
    const dimPathColor = new THREE.Color(COLORS.pathGlow).multiplyScalar(0.5);
    const buildColor = new THREE.Color(0x1d2740);

    const allVerts = [], allColors = [];
    for (let qy = 0; qy < GRID_ROWS; qy++) {
      for (let qx = 0; qx < GRID_COLS; qx++) {
        const idx = this._idx(qx, qy);
        const c = pathIndices.has(idx) ? dimPathColor : buildColor;
        const r = c.r, g = c.g, b = c.b;
        const x = qx * TILE_SIZE, z = qy * TILE_SIZE, h = TILE_SIZE;
        allVerts.push(x, 0.005, z, x + h, 0.005, z, x, 0.005, z + h,
                      x + h, 0.005, z, x + h, 0.005, z + h, x, 0.005, z + h);
        allColors.push(r, g, b, r, g, b, r, g, b, r, g, b, r, g, b, r, g, b);
      }
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(allVerts, 3));
    gridGeo.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3));
    // Store original colors for dynamic updates
    this._groundOrigColors = new Float32Array(allColors);
    const gridMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    this._groundGrid = new THREE.Mesh(gridGeo, gridMat);
    this._groundGrid.visible = true; // invisible but still hit by raycaster
    this.scene.add(this._groundGrid);

    const tArr = Array.from(this.pathTiles);
    const tVerts = [];
    tArr.forEach((idx) => {
      const tx = (idx % GRID_COLS) * TILE_SIZE + TILE_SIZE / 2;
      const tz = (Math.floor(idx / GRID_COLS)) * TILE_SIZE + TILE_SIZE / 2;
      const x0 = tx - TILE_SIZE / 2, x1 = tx + TILE_SIZE / 2;
      const z0 = tz - TILE_SIZE / 2, z1 = tz + TILE_SIZE / 2;
      tVerts.push(x0, 0.012, z0, x1, 0.012, z0, x0, 0.012, z1,
                  x1, 0.012, z0, x1, 0.012, z1, x0, 0.012, z1);
    });
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.Float32BufferAttribute(tVerts, 3));
    const tMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.pathGlow), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this._tilesMesh = new THREE.Mesh(tGeo, tMat);
    this.scene.add(this._tilesMesh);

    const pts = this._centerline;
    if (pts.length >= 2) {
      const geo = new THREE.BufferGeometry();
      const verts = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = (-dz / len) * TILE_SIZE * 0.46;
        const nz = (dx / len) * TILE_SIZE * 0.46;
        verts.push(a.x - nx, 0.045, a.z - nz, b.x - nx, 0.045, b.z - nz, a.x + nx, 0.045, a.z + nz,
                   b.x - nx, 0.045, b.z - nz, b.x + nx, 0.045, b.z + nz, a.x + nx, 0.045, a.z + nz);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.pathEdge), transparent: true, opacity: 0.85 });
      this._mesh = new THREE.Mesh(geo, mat);
      this.scene.add(this._mesh);
    }

    this._buildPathTileGlows(pathIndices);

    const sGeo = new THREE.PlaneGeometry(GRID_COLS * TILE_SIZE * 1.6, GRID_ROWS * TILE_SIZE * 1.25, 40, 40);
    const sMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(COLORS.smoke) } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `varying vec2 vUv; varying vec3 vWorld; void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.0); vWorld=wp.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vWorld; uniform float uTime; uniform vec3 uColor; float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); } float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1)); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); } void main(){ float q = noise(vWorld.xz*0.12 + uTime*0.07); float r = noise(vWorld.xz*0.16 - uTime*0.05 + 4.3); float c = smoothstep(0.35,0.7,q) * smoothstep(0.55,0.2,r); gl_FragColor = vec4(uColor, c*0.18); }`,
    });
    this._smoke = new THREE.Mesh(sGeo, sMat);
    this._smoke.rotation.x = 3.14159 / 2;
    this._smoke.position.set(GRID_COLS * TILE_SIZE / 2, 0.6, GRID_ROWS * TILE_SIZE / 2);
    this.scene.add(this._smoke);
  }
  _buildPathTileGlows(pathIndices) {
    // Glowing line segments connecting adjacent path tiles
    const segments = [];

    pathIndices.forEach(idx => {
      const qx = idx % GRID_COLS;
      const qy = Math.floor(idx / GRID_COLS);
      const cx = qx * TILE_SIZE + TILE_SIZE / 2;
      const cz = qy * TILE_SIZE + TILE_SIZE / 2;

      // Check right neighbor
      if (qx < GRID_COLS - 1 && pathIndices.has(idx + 1)) {
        const nx = (qx + 1) * TILE_SIZE + TILE_SIZE / 2;
        segments.push(cx, 0.03, cz, nx, 0.03, cz);
      }
      // Check bottom neighbor
      if (qy < GRID_ROWS - 1 && pathIndices.has(idx + GRID_COLS)) {
        const nz = (qy + 1) * TILE_SIZE + TILE_SIZE / 2;
        segments.push(cx, 0.03, cz, cx, 0.03, nz);
      }
    });

    if (segments.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(COLORS.pathEdge),
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
    });
    this._edgeGlows = new THREE.LineSegments(geo, mat);
    this.scene.add(this._edgeGlows);
  }
  _buildFlowDots() {
    if (this._flowDots) { this.scene.remove(this._flowDots.points); this._flowDots.geo.dispose(); this._flowDots.mat.dispose(); }
    if (this._centerline.length < 2) return;
    const count = 24;
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      offsets[i] = Math.random();
      const i3 = i * 3;
      positions[i3] = 0; positions[i3 + 1] = 0.07; positions[i3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.12, color: new THREE.Color(COLORS.pathGlow),
      transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this._flowDots = { points, geo, mat, count, positions, offsets, speed: 0.35 };
  }
  _buildDust() {
    if (this._dust) { this.scene.remove(this._dust); this._dust.geometry.dispose(); this._dust.material.dispose(); }
    const count = 80;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * GRID_COLS * 1.5;
      positions[i3 + 1] = 0.5 + Math.random() * 3;
      positions[i3 + 2] = (Math.random() - 0.5) * GRID_ROWS * 1.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.06, color: 0x8899cc,
      transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._dust = new THREE.Points(geo, mat);
    this.scene.add(this._dust);
  }
  update(dt, enemies, towers, wave) {
    if (this._smoke) this._smoke.material.uniforms.uTime.value += dt;
    // Animate flow dots along the path
    if (this._flowDots) {
      const len = this._centerline.length;
      if (len > 1) {
        const dp = this._flowDots;
        for (let i = 0; i < dp.count; i++) {
          dp.offsets[i] = (dp.offsets[i] + dt * dp.speed) % 1.0;
          const idx = Math.floor(dp.offsets[i] * (len - 1));
          const frac = (dp.offsets[i] * (len - 1)) % 1;
          const a = this._centerline[idx];
          const b = this._centerline[Math.min(idx + 1, len - 1)];
          const i3 = i * 3;
          dp.positions[i3] = a.x + (b.x - a.x) * frac;
          dp.positions[i3 + 1] = 0.07;
          dp.positions[i3 + 2] = a.z + (b.z - a.z) * frac;
        }
        dp.geo.attributes.position.needsUpdate = true;
      }
    }
    // Twinkle ambient dust
    if (this._dust && this._dust.material) {
      this._dust.material.opacity = 0.18 + Math.sin(this._smoke ? this._smoke.material.uniforms.uTime.value * 0.3 : 0) * 0.05;
    }
    // Dynamic ground coloring (disabled — ground is transparent)
    // this._updateDynamicGround(dt, enemies, towers, wave);
  }

  _updateDynamicGround(dt, enemies, towers, wave) {
    if (!this._groundGrid || !this._groundOrigColors) return;
    const colorAttr = this._groundGrid.geometry.attributes.color;
    if (!colorAttr) return;
    const colors = colorAttr.array;
    const orig = this._groundOrigColors;
    const pathSet = this.pathTiles;
    const time = performance.now() / 1000;
    const waveShift = Math.sin(wave * 0.3) * 0.05;

    for (let qy = 0; qy < GRID_ROWS; qy++) {
      for (let qx = 0; qx < GRID_COLS; qx++) {
        const idx = this._idx(qx, qy);
        const isPath = pathSet.has(idx);
        // Find closest enemy influence
        let enemyHeat = 0;
        for (const e of enemies) {
          if (e.dead) continue;
          const dx = (qx + 0.5) - e.mesh.position.x;
          const dz = (qy + 0.5) - e.mesh.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1.5) { enemyHeat = Math.max(enemyHeat, 1 - dist / 1.5); }
        }
        // Find closest tower influence
        let towerGlow = 0;
        for (const t of towers) {
          const dx = (qx + 0.5) - t.pos.x;
          const dz = (qy + 0.5) - t.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1.2) { towerGlow = Math.max(towerGlow, (1 - dist / 1.2) * 0.5); }
        }

        const i6 = idx * 6; // 6 vertices per tile (2 triangles)
        const r = orig[i6], g = orig[i6 + 1], b = orig[i6 + 2];

        let cr = r, cg = g, cb = b;
        if (isPath) {
          // Path tiles: pulse with wave + enemy heat
          const pulse = 0.7 + Math.sin(time * 2 + idx * 0.1) * 0.15 + waveShift;
          cr = Math.min(1, r + 0.3 * enemyHeat);
          cg = Math.min(1, g * pulse + 0.15 * enemyHeat);
          cb = Math.min(1, b * pulse + 0.2 * enemyHeat);
        } else {
          // Buildable tiles: shift toward red near enemies, blue near towers
          cr = r + enemyHeat * 0.4 - towerGlow * 0.1 + waveShift;
          cg = g - enemyHeat * 0.15 + towerGlow * 0.05;
          cb = b - enemyHeat * 0.2 + towerGlow * 0.3;
          cr = Math.max(0, Math.min(1, cr));
          cg = Math.max(0, Math.min(1, cg));
          cb = Math.max(0, Math.min(1, cb));
        }
        // Write to all 6 vertices of this tile
        for (let v = 0; v < 6; v++) {
          const vi = i6 + v * 3;
          colors[vi] = cr; colors[vi + 1] = cg; colors[vi + 2] = cb;
        }
      }
    }
    colorAttr.needsUpdate = true;
  }
  get groundPlane() { return this._groundGrid; }
  worldFromTile(qx, qy) {
    return new THREE.Vector3(qx * TILE_SIZE + TILE_SIZE/2, 0, qy * TILE_SIZE + TILE_SIZE/2);
  }
  tileFromWorld(x, z) {
    const qx = Math.floor((x + TILE_SIZE/2) / TILE_SIZE);
    const qy = Math.floor((z + TILE_SIZE/2) / TILE_SIZE);
    if (qx < 0 || qx >= GRID_COLS || qy < 0 || qy >= GRID_ROWS) return null;
    return { qx, qy, idx: this._idx(qx, qy), world: this.worldFromTile(qx, qy) };
  }
  isWalkable(idx) { return this.pathTiles.has(idx); }
  isBuildable(idx) { return this.pathTiles.has(idx) === false; }
}
