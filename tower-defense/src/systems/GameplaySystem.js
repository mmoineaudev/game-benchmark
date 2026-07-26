import * as THREE from 'three';
import { TOWER_DEFS, BUDGET } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

export default class GameplaySystem {
  constructor(gs, pathSystem, towers, enemies, waveManager, context, raycaster, camera, dom) {
    this.state = gs.state;
    this._gs = gs;
    this.pathSystem = pathSystem;
    this.towers = towers;
    this.enemies = enemies;
    this.waveManager = waveManager;
    this.context = context;
    this.raycaster = raycaster;
    this.camera = camera;
    this.dom = dom;
    this._selectedType = 0;
    this._buildPending = false;
    // Hover tracking — highlight tile under cursor
    this._hoverTile = null;
    this._hoverMesh = null;
    // Range ring shown while building
    this._rangeRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.03, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x22ff88, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this._rangeRing.rotation.x = -Math.PI / 2;
    this._rangeRing.visible = false;
    this.towers.scene.add(this._rangeRing);
    EventBus.on('ui:selectTower', (idx) => { this._selectedType = idx; this._buildPending = true; });
    EventBus.on('ui:deselectTower', () => { this._buildPending = false; this._clearHover(); this._rangeRing.visible = false; });
    EventBus.on('ui:startWave', () => this._startNext());
    window.addEventListener('mousemove', (e) => this._handleHover(e));
    window.addEventListener('mousedown', (e) => this._handleClick(e));
    window.addEventListener('contextmenu', (e) => this._handleRightClick(e));
  }
  _startNext() {
    if (this.state.over || this.state.paused) return;
    this.waveManager.startSpawning(this.state);
  }
  _handleHover(e) {
    if (!this._buildPending) { this._clearHover(); this._rangeRing.visible = false; return; }
    const rect = this.dom.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
    this.raycaster.setFromCamera(mouse, this.camera);
    const groundPlane = this.pathSystem.groundPlane;
    if (!groundPlane) { this._clearHover(); this._rangeRing.visible = false; return; }
    const intersects = this.raycaster.intersectObject(groundPlane);
    if (!intersects.length) { this._clearHover(); this._rangeRing.visible = false; return; }
    const p = intersects[0].point;
    const tile = this.pathSystem.tileFromWorld(p.x, p.z);
    if (!tile) { this._clearHover(); this._rangeRing.visible = false; return; }

    // Show range ring at hover position
    const def = TOWER_DEFS[this._selectedType];
    this._rangeRing.visible = true;
    this._rangeRing.scale.setScalar(def.range);
    this._rangeRing.position.set(tile.qx + 0.5, 0.06, tile.qy + 0.5);
    // Only highlight buildable tiles (not on path, not already occupied)
    const buildable = !this.state.path.has(tile.idx) && this.state.grid[tile.idx] === 'empty' && this.state.money >= TOWER_DEFS[this._selectedType].cost;
    if (buildable) {
      if (this._hoverTile && this._hoverTile.idx === tile.idx) return;
      this._clearHover();
      this._hoverTile = tile;
      const geo = new THREE.BoxGeometry(1, 0.08, 1);
      const mat = new THREE.MeshBasicMaterial({ color: 0x22ff88, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
      this._hoverMesh = new THREE.Mesh(geo, mat);
      this._hoverMesh.position.set(tile.qx + 0.5, 0.09, tile.qy + 0.5);
      this.towers.scene.add(this._hoverMesh);
    } else {
      // Show red hover for invalid tiles
      if (this._hoverTile) { this._clearHover(); }
      this._hoverTile = tile;
      const geo = new THREE.BoxGeometry(1, 0.08, 1);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
      this._hoverMesh = new THREE.Mesh(geo, mat);
      this._hoverMesh.position.set(tile.qx + 0.5, 0.09, tile.qy + 0.5);
      this.towers.scene.add(this._hoverMesh);
    }
  }
  _clearHover() {
    if (this._hoverMesh) {
      this.towers.scene.remove(this._hoverMesh);
      this._hoverMesh.geometry.dispose();
      this._hoverMesh.material.dispose();
      this._hoverMesh = null;
    }
    this._hoverTile = null;
  }
  _handleClick(e) {
    if (!this._buildPending) return;
    const rect = this.dom.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
    this.raycaster.setFromCamera(mouse, this.camera);
    const groundPlane = this.pathSystem.groundPlane;
    if (!groundPlane) return;
    const intersects = this.raycaster.intersectObject(groundPlane);
    if (!intersects.length) return;
    const p = intersects[0].point;
    const tile = this.pathSystem.tileFromWorld(p.x, p.z);
    if (!tile) return;
    if (this.towers.place(this.state, tile.idx, tile.qx, tile.qy, this._selectedType, this.state.path)) {
      // Stay in build mode for multi-placement
      this._clearHover();
    }
  }
  _handleRightClick(e) {
    e.preventDefault();
    if (this.state.over) return;
    const rect = this.dom.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
    this.raycaster.setFromCamera(mouse, this.camera);
    const groundPlane = this.pathSystem.groundPlane;
    if (!groundPlane) return;
    const intersects = this.raycaster.intersectObject(groundPlane);
    if (!intersects.length) return;
    const p = intersects[0].point;
    const tile = this.pathSystem.tileFromWorld(p.x, p.z);
    if (!tile) return;
    const towerIdx = this.towers.towers.findIndex(t => t.idx === tile.idx);
    if (towerIdx >= 0) {
      const t = this.towers.towers[towerIdx];
      this.context.open({ x: e.clientX, y: e.clientY }, [
        { label: 'Upgrade -> lvl ' + (t.level+1) + ' ($' + Math.floor(TOWER_DEFS[t.defIdx].cost*(0.9+0.55*(t.level+1))) + ')', action: () => this.towers.upgrade(this.state, t.idx) },
        { label: 'Sell (+$' + Math.floor(t.totalInvested*BUDGET.sellBackRatio) + ')', action: () => this.towers.sell(this.state, t.idx) },
      ]);
    } else {
      // Cancel build mode on right-click
      if (this._buildPending) { this._buildPending = false; this._clearHover(); this._rangeRing.visible = false; }
      else { this.context.open({ x: e.clientX, y: e.clientY }, [{ label: 'Cancel', action: () => {} }]); }
    }
  }
  update() {
    // Update hover mesh position (called each frame)
    if (this._hoverMesh && this._hoverTile) {
      // Pulse effect
      const t = performance.now() / 1000;
      this._hoverMesh.position.y = 0.09 + Math.sin(t * 4) * 0.02;
    }
  }
}
