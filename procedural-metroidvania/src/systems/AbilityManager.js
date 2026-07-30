import * as THREE from 'three';
import { ABILITY, COLORS, LAYERS, LOG } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';
import ModelFactory from '../visuals/ModelFactory.js';

/**
 * AbilityManager — handles ability pickups in the world.
 * MVP: only double jump ability.
 */
export default class AbilityManager {
  constructor(scene) {
    this._scene = scene;
    this._pickups = [];
    LOG('AbilityManager', 'Initialized');
  }

  /** Spawn ability pickups according to room data */
  init(state) {
    this._pickups = [];

    // Find ability pickups in rooms
    // We need access to room data — we'll receive it via init argument
    // Actually, we'll scan all rooms for pickups via a method
  }

  /** Add a pickup at world position */
  spawnPickup(x, y, type, abilityName) {
    const group = ModelFactory.buildPickup(COLORS.ABILITY_PICKUP);
    group.position.set(x, y, LAYERS.PICKUPS);
    this._scene.add(group);

    // Find sub-meshes for animation
    const gem = group.getObjectByName('_gem');
    const glowShell = group.getObjectByName('_glowShell');
    const motes = [0, 1, 2].map(i => group.getObjectByName(`_mote_${i}`)).filter(Boolean);

    this._pickups.push({
      group,
      gem,
      glowShell,
      motes,
      x, y,
      type,
      ability: abilityName,
      collected: false,
      _time: Math.random() * Math.PI * 2,
    });

    LOG('AbilityManager', `Spawned pickup "${abilityName}" at (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }

  /** Spawn all pickups from room data */
  initFromRooms(rooms) {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (!room.pickups) continue;
      for (const p of room.pickups) {
        this.spawnPickup(p.worldX, p.worldY, p.type, p.ability);
      }
    }
  }

  /** Initialize from GameState and RoomManager */
  init(state, roomManager) {
    if (roomManager) {
      this.initFromRooms(roomManager._rooms || {});
    }
  }

  update(dt, player) {
    for (const p of this._pickups) {
      if (p.collected) continue;

      // Animate
      p._time += dt;
      if (p.gem) {
        p.gem.rotation.y += dt * ABILITY.PICKUP_GLOW_SPEED;
        p.gem.rotation.x += dt * ABILITY.PICKUP_GLOW_SPEED * 0.5;
      }

      // Orbit motes
      for (const mote of p.motes) {
        mote.userData._orbitAngle += mote.userData._orbitSpeed * dt;
        const angle = mote.userData._orbitAngle;
        const r = mote.userData._orbitRadius;
        mote.position.set(Math.cos(angle) * r, Math.sin(angle * 1.3) * r * 0.6, 0);
      }

      // Bob
      const bob = Math.sin(p._time * ABILITY.PICKUP_BOB_SPEED) * ABILITY.PICKUP_BOB_AMPLITUDE;
      p.group.position.y = p.y + bob;

      // Glow pulse
      if (p.glowShell?.material) {
        p.glowShell.material.opacity = 0.2 + Math.sin(p._time * 2.5) * 0.08;
      }
      if (p.gem?.material) {
        p.gem.material.emissiveIntensity = 0.4 + Math.sin(p._time * 3) * 0.3;
      }

      // Pickup light pulse
      const light = p.group.getObjectByName('_pickupLight');
      if (light) light.intensity = 0.3 + Math.sin(p._time * 3.5) * 0.15;

      // Check pickup
      if (Math.abs(player.x - p.x) < 0.8 && Math.abs(player.y - (p.y + bob)) < 0.8) {
        p.collected = true;
        EventBus.emit('ability:acquired', p.ability);

        // Collect animation: scale up + fade
        const dissolve = () => {
          const s = p.group.scale.x + 0.08;
          p.group.scale.setScalar(s);
          if (p.glowShell?.material) p.glowShell.material.opacity += 0.05;
          if (s < 1.8) {
            requestAnimationFrame(dissolve);
          } else {
            p.group.visible = false;
            this._scene.remove(p.group);
          }
        };
        dissolve();

        LOG('AbilityManager', `Player collected "${p.ability}"`);
      }
    }
  }

  dispose() {
    for (const p of this._pickups) {
      if (p.group.parent) this._scene.remove(p.group);
      p.group.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    }
    this._pickups.length = 0;
  }
}
