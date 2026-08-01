import * as THREE from 'three';
import { TOWER_DEFS, BUDGET, UPGRADE_COST } from '../core/Constants.js';
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
    // Drag placement state
    this._dragPlacing = false;
    this._lastDragIdx = -1;
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
    EventBus.on('ui:deselectTower', () => { this._buildPending = false; this._dragPlacing = false; this._clearHover(); this._rangeRing.visible = false; });
    EventBus.on('ui:startWave', () => this._startNext());
    window.addEventListener('mousemove', (e) => this._handleHover(e));
    window.addEventListener('mousedown', (e) => this._handleMouseDown(e));
    window.addEventListener('mouseup', (e) => this._handleMouseUp(e));
    window.addEventListener('contextmenu', (e) => this._handleRightClick(e));
  }

  /** True when the event originated on HUD / overlay UI (never place there). */
  _isUI(e) {
    const t = e.target;
    return !!(t && t.closest && t.closest('#hud, .overlay, button, .cm-row'));
  }

  _contextMenuOpen() {
    const cm = document.getElementById('contextMenu');
    return !!(cm && !cm.classList.contains('hidden'));
  }

  _startNext() {
    if (this.state.over || this.state.paused) return;
    this.waveManager.startSpawning(this.state);
  }

  _tileFromEvent(e) {
    const rect = this.dom.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
    this.raycaster.setFromCamera(mouse, this.camera);
    const groundPlane = this.pathSystem.groundPlane;
    if (!groundPlane) return null;
    const intersects = this.raycaster.intersectObject(groundPlane);
    if (!intersects.length) return null;
    const p = intersects[0].point;
    return this.pathSystem.tileFromWorld(p.x, p.z);
  }

  /** Attempt placement. Drag mode only builds on empty tiles (no accidental replaces). */
  _placeAt(tile, allowReplace) {
    if (!tile) return false;
    if (!allowReplace && this.state.grid[tile.idx] !== 'empty') return false;
    const ok = this.towers.place(this.state, tile.idx, tile.qx, tile.qy, this._selectedType, this.state.path);
    if (ok) {
      this._lastDragIdx = tile.idx;
      this._clearHover();
      this._rangeRing.visible = false;
    }
    return ok;
  }

  _handleMouseDown(e) {
    if (e.button !== 0) return;
    if (this._isUI(e) || this._contextMenuOpen()) return;
    if (!this._buildPending) return;
    // Begin drag placement session — a plain click places once on mouseup-less mousedown
    this._dragPlacing = true;
    this._lastDragIdx = -1;
    const tile = this._tileFromEvent(e);
    if (tile) this._placeAt(tile, true);
  }

  _handleMouseUp(e) {
    if (e.button !== 0) return;
    this._dragPlacing = false;
  }

  _handleHover(e) {
    if (!this._buildPending) { this._clearHover(); this._rangeRing.visible = false; return; }
    const tile = this._tileFromEvent(e);
    if (!tile) { this._clearHover(); this._rangeRing.visible = false; return; }

    // While dragging, paint towers onto new tiles (empty only)
    if (this._dragPlacing && this._buildPending) {
      if (tile.idx !== this._lastDragIdx) this._placeAt(tile, false);
      return;
    }

    // Show range ring at hover position
    const def = TOWER_DEFS[this._selectedType];
    this._rangeRing.visible = true;
    this._rangeRing.scale.setScalar(def.range);
    this._rangeRing.position.set(tile.qx + 0.5, 0.06, tile.qy + 0.5);

    // Valid targets: empty tiles, or occupied towers (replace). Never path tiles.
    const occupied = this.state.grid[tile.idx] !== 'empty';
    const occupiedTower = occupied ? this.towers.towers.find(t => t.idx === tile.idx) : null;
    let affordable;
    if (occupiedTower) {
      affordable = this.state.money + Math.floor(occupiedTower.totalInvested * BUDGET.sellBackRatio) >= def.cost;
    } else {
      affordable = this.state.money >= def.cost;
    }
    const onPath = this.state.path.has(tile.idx);
    const buildable = !onPath && affordable && (!occupied || !!occupiedTower);

    let color = 0x22ff88;   // green: empty buildable
    if (buildable && occupiedTower) color = 0xffb020; // amber: replace existing tower
    if (!buildable) color = 0xff4444;                  // red: invalid

    if (this._hoverTile && this._hoverTile.idx === tile.idx && this._hoverMesh && this._hoverMesh.material.color.getHex() === color) return;
    this._clearHover();
    this._hoverTile = tile;
    const geo = new THREE.BoxGeometry(1, 0.08, 1);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    this._hoverMesh = new THREE.Mesh(geo, mat);
    this._hoverMesh.position.set(tile.qx + 0.5, 0.09, tile.qy + 0.5);
    this.towers.scene.add(this._hoverMesh);
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

  _handleRightClick(e) {
    e.preventDefault();
    if (this.state.over) return;
    const tile = this._tileFromEvent(e);
    if (!tile) return;
    const towerIdx = this.towers.towers.findIndex(t => t.idx === tile.idx);
    if (towerIdx >= 0) {
      const t = this.towers.towers[towerIdx];
      this.context.open({ x: e.clientX, y: e.clientY }, [
        { label: 'Upgrade -> lvl ' + (t.level+1) + ' ($' + UPGRADE_COST(t.defIdx, t.level) + ')', action: () => this.towers.upgrade(this.state, t.idx) },
        { label: 'Sell (+$' + Math.floor(t.totalInvested*BUDGET.sellBackRatio) + ')', action: () => this.towers.sell(this.state, t.idx) },
      ]);
    } else {
      // Cancel build mode on right-click
      if (this._buildPending) { this._buildPending = false; this._dragPlacing = false; this._clearHover(); this._rangeRing.visible = false; }
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
