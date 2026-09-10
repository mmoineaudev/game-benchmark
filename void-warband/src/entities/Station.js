/**
 * Station.js — bank/repair station entity (SPEC §5 extraction rule, §7 hangar).
 *
 * Composite low-poly station, hand-built for silhouette readability:
 *   - central spindle (stacked cylinders, reactor core glow mid-spindle)
 *   - 4 spokes connecting the spindle to a hab ring of box habitats
 *   - solar panel arrays on two spokes (dark blue emissive-trimmed)
 *   - 2 blinking beacon masts (red/green nav lights)
 *   - window light strips on the hab ring (emissive)
 *   - docking-light sprites + proximity-culled point light (main.js)
 *   - additive shield bubble (faint — the station must read through it)
 *
 * Slow ring rotation (the hab ring spins around the spindle, classic
 * rotating-habitat look) while the spindle keeps its own orientation.
 */
import * as THREE from 'three';
import { CONTROLS } from '../core/Constants.js';

/**
 * STATION interaction radius, u. Reuses CONTROLS.bankRadius (120) — the same
 * §2 "Bank/interact range at stations" value — as the station proximity
 * radius for banking / HUD prompt AND the energy-shield bubble radius.
 */
export const STATION_RADIUS = CONTROLS.bankRadius;

/** Shield visual tuning — faint, so the station reads through it. */
const SHIELD = {
  /** Wireframe sphere segments. */
  segments: 24,
  /** Base opacity (idle) — LOW: the hull must read through the bubble. */
  opacity: 0.07,
  /** Shell color (cyan-green). */
  color: 0x38f8d4,
};

/** Station geometry + material tuning (low-poly, flat shaded). */
const STATION = {
  /** Hab ring radius, u (main silhouette element). */
  ringRadius: 30,
  /** Hab ring tube (habitat box depth), u. */
  ringTube: 5,
  /** Habitat boxes around the ring. */
  habCount: 8,
  habSize: [9, 5, 6], // x, y, z per habitat box
  /** Spoke dimensions. */
  spokeCount: 4,
  spokeLen: 26,
  spokeSize: [1.6, 1.6, 26],
  /** Central spindle. */
  spindleTopR: 3.2,
  spindleMidR: 4.6,
  spindleBotR: 2.4,
  spindleSegH: 12,
  /** Reactor core (mid-spindle glow). */
  reactorR: 5.2,
  reactorColor: 0x38bdf8,
  /** Solar panel arrays (on 2 spokes). */
  panelSize: [22, 0.6, 8],
  panelColor: 0x1e3a5f,
  /** Beacon masts. */
  beaconHeight: 16,
  beaconColors: [0xff3b30, 0x4ade80], // port red / starboard green
  /** Window strip color (warm hab lighting). */
  windowColor: 0xffd88a,
  /** Two-tone hull. */
  hullColor: 0x8a99ab,   // light blue-grey primary
  hullDarkColor: 0x3c4654, // dark trim / spindle
  /** Slow rotation speed, rad/s (hab ring). */
  rotationSpeed: 0.12,
  /** Docking light sprite color (green emissive). */
  dockLightColor: 0x4ade80,
  /** Docking light sprite scale, u. */
  dockLightScale: 8,
};

// -- Shared module-level geometry/material singletons (PERF: many stations) --
const _habGeo = new THREE.BoxGeometry(1, 1, 1);
const _panelGeo = new THREE.BoxGeometry(1, 1, 1);
const _spokeGeo = new THREE.BoxGeometry(1, 1, 1);
const _mastGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 6);
const _beaconGeo = new THREE.SphereGeometry(1.1, 8, 6);
const _reactorGeo = new THREE.IcosahedronGeometry(1, 1);

const _hullMat = new THREE.MeshStandardMaterial({
  color: STATION.hullColor, flatShading: true, metalness: 0.35, roughness: 0.6,
});
const _darkMat = new THREE.MeshStandardMaterial({
  color: STATION.hullDarkColor, flatShading: true, metalness: 0.5, roughness: 0.7,
});
const _panelMat = new THREE.MeshStandardMaterial({
  color: STATION.panelColor, flatShading: true, metalness: 0.7, roughness: 0.35,
  emissive: 0x0a1a33, emissiveIntensity: 0.5,
});
const _reactorMat = new THREE.MeshStandardMaterial({
  color: 0x0b2540, emissive: STATION.reactorColor, emissiveIntensity: 1.6,
  flatShading: true, roughness: 0.3,
});
const _windowMat = new THREE.MeshBasicMaterial({ color: STATION.windowColor });
const _beaconRedMat = new THREE.MeshBasicMaterial({ color: STATION.beaconColors[0] });
const _beaconGreenMat = new THREE.MeshBasicMaterial({ color: STATION.beaconColors[1] });
const _dockSpriteMat = new THREE.SpriteMaterial({
  color: STATION.dockLightColor,
  transparent: true,
  opacity: 1,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

class _Station {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position world position.
   */
  constructor(scene, position) {
    /** @type {THREE.Group} station root. */
    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    /** @type {THREE.Vector3} world position (public, for banking checks). */
    this.position = position.clone();

    // -- Central spindle (station "spine") ------------------------------------
    // Three stacked segments: top (docking), mid (core), bottom (engineering).
    const spindle = new THREE.Group();
    const segs = [
      { r: STATION.spindleTopR, y: STATION.spindleSegH },
      { r: STATION.spindleMidR, y: 0 },
      { r: STATION.spindleBotR, y: -STATION.spindleSegH },
    ];
    for (const s of segs) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(s.r, s.r, STATION.spindleSegH * 0.92, 8),
        _darkMat,
      );
      seg.position.y = s.y;
      spindle.add(seg);
    }
    this.group.add(spindle);

    // -- Reactor core: glowing icosahedron between mid and bottom segments ----
    this._reactor = new THREE.Mesh(_reactorGeo, _reactorMat);
    this._reactor.scale.setScalar(STATION.reactorR);
    this._reactor.position.y = -STATION.spindleSegH * 0.5;
    this.group.add(this._reactor);

    // -- Hab ring: 8 habitat boxes around the ring + connecting ring band -----
    // The ring group rotates (rotating-habitat look); the spindle does not.
    this._ring = new THREE.Group();
    const R = STATION.ringRadius;
    for (let i = 0; i < STATION.habCount; i++) {
      const a = (i / STATION.habCount) * Math.PI * 2;
      const hab = new THREE.Mesh(_habGeo, _hullMat);
      hab.scale.set(...STATION.habSize);
      hab.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
      hab.rotation.y = -a; // face tangent to the ring
      this._ring.add(hab);

      // Window strip: thin bright box on the hab's inner face.
      const win = new THREE.Mesh(_habGeo, _windowMat);
      win.scale.set(STATION.habSize[0] * 0.7, 0.5, 0.3);
      win.position.set(Math.cos(a) * (R - STATION.habSize[2] * 0.5), 1.2, Math.sin(a) * (R - STATION.habSize[2] * 0.5));
      win.rotation.y = -a;
      this._ring.add(win);

      // Spoke every other habitat (4 spokes total).
      if (i % (STATION.habCount / STATION.spokeCount) === 0) {
        const spoke = new THREE.Mesh(_spokeGeo, _darkMat);
        spoke.scale.set(...STATION.spokeSize);
        spoke.position.set(Math.cos(a) * R * 0.5, 0, Math.sin(a) * R * 0.5);
        spoke.rotation.y = -a + Math.PI / 2;
        this._ring.add(spoke);
      }
    }
    this.group.add(this._ring);

    // -- Solar panel arrays on two free axes (perpendicular to a spoke pair) --
    for (const side of [1, -1]) {
      const mast = new THREE.Mesh(_mastGeo, _darkMat);
      mast.scale.set(1, 8, 1);
      mast.position.set(side * 9, 0, 0);
      this.group.add(mast);
      const panel = new THREE.Mesh(_panelGeo, _panelMat);
      panel.scale.set(...STATION.panelSize);
      panel.position.set(side * (9 + STATION.panelSize[0] * 0.42), 0, 0);
      this.group.add(panel);
    }

    // -- Nav beacon masts (top spindle): port red + starboard green -----------
    this._beacons = [];
    const beaconSides = [
      { x: -1, mat: _beaconRedMat },
      { x: 1, mat: _beaconGreenMat },
    ];
    for (const b of beaconSides) {
      const mast = new THREE.Mesh(_mastGeo, _darkMat);
      mast.scale.set(1, STATION.beaconHeight, 1);
      mast.position.set(b.x * 2.5, STATION.spindleSegH + STATION.beaconHeight * 0.45, 0);
      this.group.add(mast);
      const lamp = new THREE.Mesh(_beaconGeo, b.mat);
      lamp.position.set(b.x * 2.5, STATION.spindleSegH + STATION.beaconHeight, 0);
      this.group.add(lamp);
      this._beacons.push(lamp);
    }

    // -- 2 green emissive docking-light sprites (on the ring) ------------------
    for (let i = 0; i < 2; i++) {
      const angle = (i / 2) * Math.PI * 2;
      const light = new THREE.Sprite(_dockSpriteMat);
      light.position.set(
        Math.cos(angle) * STATION.ringRadius,
        -3,
        Math.sin(angle) * STATION.ringRadius,
      );
      light.scale.setScalar(STATION.dockLightScale);
      this.group.add(light);
    }

    // -- Local point light: makes the station hull readable up close -----------
    // PERF §8: DISABLED at spawn; main.js enables only for the nearest
    // stations (every enabled PointLight is inlined into ALL standard
    // material shaders — light COUNT is the cost, not distance).
    const dock = new THREE.PointLight(STATION.dockLightColor, 2.2, STATION.ringRadius * 6, 1.4);
    dock.position.set(0, STATION.ringRadius * 0.4, 0);
    dock.visible = false;
    this.group.add(dock);
    this.dockLight = dock;

    // -- Defense shield: additive wireframe bubble, radius = STATION_RADIUS --
    // Kept FAINT (opacity 0.07 + additive): the station silhouette must read
    // through it from every angle; it should be a hint, not a cage.
    const shieldGeo = new THREE.SphereGeometry(
      STATION_RADIUS, SHIELD.segments, SHIELD.segments / 2,
    );
    this._shieldMat = new THREE.MeshBasicMaterial({
      color: SHIELD.color,
      wireframe: true,
      transparent: true,
      opacity: SHIELD.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._shield = new THREE.Mesh(shieldGeo, this._shieldMat);
    this.group.add(this._shield);
  }

  /** True if the point is inside the station's shield bubble. */
  contains(point) {
    return this.position.distanceTo(point) <= STATION_RADIUS;
  }

  /**
   * Is any station's shield bubble protecting this point?
   * @param {import('three').Vector3} point
   * @param {Array<{position: import('three').Vector3}>} stations
   * @returns {boolean}
   */
  static isShielded(point, stations) {
    for (const st of stations) {
      if (st.position.distanceTo(point) <= STATION_RADIUS) return true;
    }
    return false;
  }

  /**
   * Per-frame: hab ring rotation + reactor pulse + beacon blink.
   * @param {number} dt seconds.
   * @param {number} [time] absolute time, s (blink phase reference).
   */
  update(dt, time = 0) {
    this._ring.rotation.y += STATION.rotationSpeed * dt;
    // Reactor: slow breathing glow.
    this._reactor.material === _reactorMat; // shared mat — pulse via scale only
    const pulse = 1 + Math.sin(time * 2.2) * 0.08;
    this._reactor.scale.setScalar(STATION.reactorR * pulse);
    // Beacons: alternating blink (1 s period).
    const on = Math.sin(time * Math.PI) > 0;
    for (let i = 0; i < this._beacons.length; i++) {
      this._beacons[i].visible = i % 2 === 0 ? on : !on;
    }
  }

  /**
   * Static banking check: is the player within interaction radius of the
   * station?
   * @param {import('three').Vector3} playerPos
   * @param {import('three').Vector3} stationPos
   * @param {number} [radius] interaction radius, u.
   * @returns {boolean}
   */
  static distanceCheck(playerPos, stationPos, radius = STATION_RADIUS) {
    return playerPos.distanceTo(stationPos) <= radius;
  }

  /** Detach from the scene (chunk unload / restart cleanup, SPEC §11). */
  dispose() {
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
  }
}

export { _Station as Station };
export default _Station;
