import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { scratch } from '../utils/MathHelpers.js';

// Collision detection + black hole gravity + wormhole blur state (spec §6.5, §6.7).
export class PhysicsSystem {
  constructor(game) {
    this.game = game;
    this.wormholeBlurIntensity = 0;
  }

  /** Gather all colliders from world systems into a scratch array. */
  _colliders() {
    const list = [];
    const systems = this.game.worldSystems;
    if (systems.asteroidField) list.push(...systems.asteroidField.getColliders());
    if (systems.debrisSystem) list.push(...systems.debrisSystem.getColliders());
    if (systems.cometSystem) list.push(...systems.cometSystem.getColliders());
    if (systems.stationSystem) list.push(...systems.stationSystem.getColliders());
    if (systems.deadStarSystem) list.push(...systems.deadStarSystem.getColliders());
    if (systems.blackHoleSystem) list.push(...systems.blackHoleSystem.getColliders());
    return list;
  }

  /** Return colliders within radius of center (laser hits). */
  querySphere(center, radius) {
    const out = [];
    for (const c of this._colliders()) {
      if (!c.active && c.type !== 'station' && c.type !== 'deadStar' && c.type !== 'blackHole') continue;
      const dx = c.x - center.x, dy = c.y - center.y, dz = c.z - center.z;
      if (dx * dx + dy * dy + dz * dz < (radius + c.radius) * (radius + c.radius)) out.push(c);
    }
    return out;
  }

  update(dt, ship, gameState) {
    if (!ship || !ship.alive) return;
    const colliders = this._colliders();
    const invuln = gameState.invulnerable;

    // ---- Ship vs world ----------------------------------------------------
    for (const c of colliders) {
      if (c.type === 'blackHole' || c.type === 'deadStar') {
        // instant-death zones bypass invulnerability (spec §6.5)
        const d2 = this._d2(ship.position, c);
        const r = c.type === 'deadStar' ? c.radius : c.radius;
        if (d2 < (r + ship.radius) * (r + ship.radius)) {
          this._kill(ship, gameState, c.type === 'deadStar' ? 'dead_star' : 'black_hole', c);
          return;
        }
        continue;
      }
      const d2 = this._d2(ship.position, c);
      const rr = c.radius + ship.radius;
      if (d2 >= rr * rr) continue;

      if (invuln) {
        // Still deflect physically, but no damage during the window
        if (c.type === 'comet') this._deflectBody(c, ship.position);
        this._bounce(ship, c, dt);
        continue;
      }

      // Resolve per type
      if (c.type === 'asteroid') {
        if (ship.shieldActive) {
          this._shieldDeflect(c, ship.position);
          continue;
        }
        const dmg = c.scale > Constants.COLLISION_THRESHOLD_LARGE ? Constants.COLLISION_DAMAGE_LARGE : Constants.COLLISION_DAMAGE_SMALL;
        const res = gameState.takeDamage(dmg, 'collision');
        this._bounce(ship, c, dt);
        if (c.owner) c.owner.remove(c); // rock is destroyed by the impact
        this.game.onShipCollision(c, dmg);
        if (res === 'dead') { this._kill(ship, gameState, 'collision', c); return; }
      } else if (c.type === 'debris') {
        if (ship.shieldActive) {
          this._shieldDeflect(c, ship.position);
          continue;
        }
        const res = gameState.takeDamage(Constants.COLLISION_DAMAGE_SMALL, 'collision');
        this._bounce(ship, c, dt);
        if (c.owner) c.owner.remove(c);
        this.game.onShipCollision(c, Constants.COLLISION_DAMAGE_SMALL);
        if (res === 'dead') { this._kill(ship, gameState, 'collision', c); return; }
      } else if (c.type === 'comet') {
        if (ship.shieldActive) {
          this._shieldDeflect(c, ship.position);
          continue;
        }
        const res = gameState.takeDamage(Constants.COMET_DAMAGE, 'collision');
        // deflect comet, don't destroy it (spec open point: ship takes 25, comet survives)
        this._deflectBody(c, ship.position);
        this._bounce(ship, c, dt);
        this.game.onShipCollision(c, Constants.COMET_DAMAGE);
        if (res === 'dead') { this._kill(ship, gameState, 'collision', c); return; }
      } else if (c.type === 'station') {
        const res = gameState.takeDamage(Constants.COLLISION_DAMAGE_LARGE, 'collision');
        this._bounce(ship, c, dt);
        this.game.onShipCollision(c, Constants.COLLISION_DAMAGE_LARGE);
        if (res === 'dead') { this._kill(ship, gameState, 'collision', c); return; }
      }
    }

    // ---- Black hole gravity + consumption ---------------------------------
    const systems = this.game.worldSystems;
    if (systems.blackHoleSystem) {
      const holes = systems.blackHoleSystem.holes;
      for (const hole of holes) {
        const cx = hole.x, cy = hole.y, cz = hole.z;
        const R = Constants.BLACK_HOLE_GRAVITY_RADIUS;
        const strength = Constants.BLACK_HOLE_GRAVITY_STRENGTH * hole.pullMult;
        const maxPull = Constants.BLACK_HOLE_MAX_PULL;
        for (const sys of [systems.asteroidField, systems.debrisSystem, systems.cometSystem]) {
          if (!sys || !sys.applyGravity) continue;
          sys.applyGravity({ x: cx, y: cy, z: cz }, strength, maxPull, dt);
          // consumption check
          for (const b of sys.getGravityBodies()) {
            if (!b.active) continue;
            const dx = b.x - cx, dy = b.y - cy, dz = b.z - cz;
            if (dx * dx + dy * dy + dz * dz < Constants.BLACK_HOLE_RADIUS * Constants.BLACK_HOLE_RADIUS) {
              sys.remove(b, { silent: true });
              systems.blackHoleSystem.onConsume(b.type, b.x, b.y, b.z);
            }
          }
        }
        // Ship pull (0.5×)
        const dx = ship.position.x - cx, dy = ship.position.y - cy, dz = ship.position.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < R * R && d2 > 1) {
          const a = Math.min((strength * Constants.BLACK_HOLE_SHIP_PULL_FACTOR) / d2, maxPull);
          const inv = a / Math.sqrt(d2);
          ship.applyAcceleration({ x: dx * inv, y: dy * inv, z: dz * inv }, dt);
        }
        // Ship consumed
        if (d2 < Constants.BLACK_HOLE_RADIUS * Constants.BLACK_HOLE_RADIUS) {
          this._kill(ship, gameState, 'black_hole', hole);
          return;
        }
      }
    }

    // ---- Wormhole wall blur -----------------------------------------------
    this._updateWormholeBlur(dt, ship, systems);
  }

  _updateWormholeBlur(dt, ship, systems) {
    let target = 0;
    if (systems.chunkManager) {
      const tunnels = systems.chunkManager.tunnels;
      for (const t of tunnels) {
        const tPos = t.curve.getPointAt(t.closestT ?? 0, scratch.v1);
        // closest point approximation: sample the curve
        let bestD2 = Infinity;
        let bestT = 0;
        const samples = 12;
        for (let i = 0; i <= samples; i++) {
          const tt = i / samples;
          const p = t.curve.getPointAt(tt, scratch.v2);
          const d = p.distanceToSquared(ship.position);
          if (d < bestD2) { bestD2 = d; bestT = tt; }
        }
        t.closestT = bestT;
        const dist = Math.sqrt(bestD2);
        const inner = Constants.WORMHOLE_TUNNEL_RADIUS;
        const outer = inner + Constants.WORMHOLE_WALL_THICKNESS;
        if (dist > inner && dist < outer) {
          const depth = (dist - inner) / (outer - inner);
          target = Math.max(target, depth * Constants.WORMHOLE_BLUR_MAX_INTENSITY);
        }
      }
    }
    // Fade in/out (fade-out after exit per spec)
    const fade = Constants.WORMHOLE_BLUR_FADE;
    if (target > this.wormholeBlurIntensity) {
      this.wormholeBlurIntensity = target;
    } else {
      this.wormholeBlurIntensity = Math.max(target, this.wormholeBlurIntensity - dt / fade * Constants.WORMHOLE_BLUR_MAX_INTENSITY);
    }
  }

  _d2(pos, c) {
    const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Push ship out of a body and reflect velocity (prevents re-collision). */
  _bounce(ship, c, dt) {
    const nx = ship.position.x - c.x;
    const ny = ship.position.y - c.y;
    const nz = ship.position.z - c.z;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const pen = c.radius + ship.radius - len;
    if (pen > 0) {
      ship.position.x += (nx / len) * pen;
      ship.position.y += (ny / len) * pen;
      ship.position.z += (nz / len) * pen;
    }
    const vn = ship.velocity.x * (nx / len) + ship.velocity.y * (ny / len) + ship.velocity.z * (nz / len);
    if (vn < 0) {
      ship.velocity.x -= 2 * vn * (nx / len);
      ship.velocity.y -= 2 * vn * (ny / len);
      ship.velocity.z -= 2 * vn * (nz / len);
      // minimum outbound speed
      const sp = ship.velocity.length();
      if (sp < 6) {
        ship.velocity.x += (nx / len) * (6 - sp);
        ship.velocity.y += (ny / len) * (6 - sp);
        ship.velocity.z += (nz / len) * (6 - sp);
      }
    }
  }

  /** Deflect a moving body (comet) away from the ship. */
  _deflectBody(c, shipPos) {
    const nx = c.x - shipPos.x, ny = c.y - shipPos.y, nz = c.z - shipPos.z;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const vn = c.vx * (nx / len) + c.vy * (ny / len) + c.vz * (nz / len);
    if (vn < 0) {
      c.vx -= 2 * vn * (nx / len);
      c.vy -= 2 * vn * (ny / len);
      c.vz -= 2 * vn * (nz / len);
    }
  }

  /** Shield: strongly push the body away, no damage, no destruction. */
  _shieldDeflect(c, shipPos) {
    const nx = c.x - shipPos.x, ny = c.y - shipPos.y, nz = c.z - shipPos.z;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const push = Constants.SHIELD.deflectPower;
    c.vx += (nx / len) * push;
    c.vy += (ny / len) * push;
    c.vz += (nz / len) * push;
    this.game.onShieldDeflect(c.x, c.y, c.z);
  }

  _kill(ship, gameState, reason, source) {
    ship.alive = false;
    gameState.player.health = 0;
    gameState.deathReason = reason;
    this.game.onPlayerDeath(reason, source);
  }

  reset() {
    this.wormholeBlurIntensity = 0;
  }
}
