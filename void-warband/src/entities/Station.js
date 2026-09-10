/**
 * Station.js — bank/repair station entity (SPEC §5 extraction rule, §7 hangar).
 *
 * Large low-poly station: torus ring + central cylinder + 4 antenna boxes,
 * grey-blue flat shaded, plus 2 green emissive docking-light sprites.
 * Slow rotation. Banking only happens here (SPEC §5: no mid-run banking
 * elsewhere).
 */
import * as THREE from 'three';
import { CONTROLS } from '../core/Constants.js';

/**
 * STATION interaction radius, u. Reuses CONTROLS.bankRadius (120) — the same
 * §2 "Bank/interact range at stations" value — as the station proximity
 * radius for banking / HUD prompt AND the energy-shield bubble radius.
 */
export const STATION_RADIUS = CONTROLS.bankRadius;

/** Shield visual tuning. */
const SHIELD = {
  /** Wireframe sphere segments (low-poly). */
  segments: 24,
  /** Base opacity (idle). */
  opacity: 0.16,
  /** Shell color (cyan-green). */
  color: 0x38f8d4,
};

/** Station geometry + material tuning (low-poly, flat shaded). */
const STATION = {
  /** Torus ring radius, u. */
  ringRadius: 26,
  /** Torus tube radius, u. */
  ringTube: 4,
  /** Torus radial segments (low-poly). */
  ringSegments: 8,
  /** Torus tubular segments (low-poly). */
  ringTubularSegments: 24,
  /** Central cylinder radius, u. */
  cylRadius: 7,
  /** Central cylinder height, u. */
  cylHeight: 46,
  /** Central cylinder radial segments (low-poly). */
  cylSegments: 8,
  /** Antenna box size, u. */
  antennaSize: 2,
  /** Antenna box height, u. */
  antennaHeight: 14,
  /** Antenna placement radius (on the ring), u. */
  antennaRadius: 26,
  /** Grey-blue hull color. */
  hullColor: 0x5b6b7d,
  /** Slow rotation speed, rad/s. */
  rotationSpeed: 0.08,
  /** Docking light sprite color (green emissive). */
  dockLightColor: 0x4ade80,
  /** Docking light sprite scale, u. */
  dockLightScale: 8,
};

class _Station {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position world position.
   */
  constructor(scene, position) {
    /** @type {THREE.Group} station root (ring + cylinder + antennas + lights). */
    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    /** @type {THREE.Vector3} world position (public, for banking checks). */
    this.position = position.clone();

    // Shared flat-shaded grey-blue hull material (one per station is fine —
    // stations are not instanced; ≤ a few live at once).
    const hullMat = new THREE.MeshStandardMaterial({
      color: STATION.hullColor,
      flatShading: true,
      metalness: 0.4,
      roughness: 0.7,
    });

    // -- Torus ring ----------------------------------------------------------
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(
        STATION.ringRadius,
        STATION.ringTube,
        STATION.ringSegments,
        STATION.ringTubularSegments,
      ),
      hullMat,
    );
    // Lay the ring flat (in XZ) so ships bank around it.
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    // -- Central cylinder ------------------------------------------------------
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(
        STATION.cylRadius,
        STATION.cylRadius,
        STATION.cylHeight,
        STATION.cylSegments,
      ),
      hullMat,
    );
    this.group.add(cyl);

    // -- 4 antenna boxes (on the ring, pointing up) ----------------------------
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const antenna = new THREE.Mesh(
        new THREE.BoxGeometry(
          STATION.antennaSize,
          STATION.antennaHeight,
          STATION.antennaSize,
        ),
        hullMat,
      );
      antenna.position.set(
        Math.cos(angle) * STATION.antennaRadius,
        STATION.cylHeight / 2,
        Math.sin(angle) * STATION.antennaRadius,
      );
      this.group.add(antenna);
    }

    // -- 2 green emissive docking-light sprites ---------------------------------
    // Sprites use a generated quad with a basic additive material.
    const lightMat = new THREE.SpriteMaterial({
      color: STATION.dockLightColor,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < 2; i++) {
      const angle = (i / 2) * Math.PI * 2;
      const light = new THREE.Sprite(lightMat);
      light.position.set(
        Math.cos(angle) * STATION.ringRadius,
        0,
        Math.sin(angle) * STATION.ringRadius,
      );
      light.scale.setScalar(STATION.dockLightScale);
      this.group.add(light);
    }

    // -- Local point light: makes the station hull readable up close -----------
    // Global lights alone leave the station a silhouette at spawn. PERF §8:
    // the light is DISABLED at spawn and enabled only for the few stations
    // nearest the player (main.js _updateStationLights each frame) — every
    // enabled point light is inlined into ALL MeshStandardMaterial shaders,
    // so an uncapped count multiplies fragment cost scene-wide.
    const dock = new THREE.PointLight(STATION.dockLightColor, 2.2, STATION.ringRadius * 6, 1.4);
    dock.position.set(0, STATION.ringRadius * 0.4, 0);
    dock.visible = false; // culled in by main.js proximity pass
    this.group.add(dock);
    this.dockLight = dock;

    // -- Defense shield: additive wireframe bubble, radius = STATION_RADIUS --
    // Enemies keep out of this bubble (EnemyManager gates steering + fire).
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
   * Per-frame: slow rotation.
   * @param {number} dt seconds.
   */
  update(dt) {
    this.group.rotation.y += STATION.rotationSpeed * dt;
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
