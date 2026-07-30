import * as THREE from 'three';
import { PLAYER, PHYSICS, COLORS, LAYERS, LOG, LOG_ERR } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';
import ModelFactory from '../visuals/ModelFactory.js';

/**
 * Player entity — all movement, collision, combat on the 2D gameplay plane (z=0).
 *
 * State machine: idle → running → jumping → doubleJumping → dashing → wallSliding → hurt
 * All constants from Constants.PLAYER — zero magic numbers.
 */
export default class Player {
  constructor(scene) {
    this._scene = scene;

    // ── position / velocity ───────────────────────────────────────────
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facingDir = 1;   // 1=right, -1=left
    this.onGround = false;
    this.onWall = null;   // 'left' | 'right' | null

    // ── state ─────────────────────────────────────────────────────────
    this.isAlive = true;
    this.hp = PLAYER.HP;
    this.maxHp = PLAYER.HP;
    this.hitInvincible = 0;
    this._knockbackTime = 0;
    this._knockbackVx = 0;
    this._knockbackVy = 0;

    // ── movement state ────────────────────────────────────────────────
    this.jumpsRemaining = 2;      // reset to maxJumps on ground
    this.maxJumps = 1;            // 1 = single jump, 2 = double jump (after ability)
    this._coyoteTimer = 0;
    this._jumpBufferTimer = 0;
    this._jumpHeld = false;
    this._jumpCut = false;

    // dash
    this._dashTimer = 0;
    this._dashCooldown = 0;
    this._dashDir = 0;
    this._hasDash = false;

    // wall slide / jump
    this._wallSlideTimer = 0;
    this._wallJumpCooldown = 0;
    this._hasWallJump = false;

    // ── visual timing ─────────────────────────────────────────────────
    this._animTime = 0;
    this._state = 'idle';       // idle, run, jump, doublejump, dash, wallslide, hurt
    this._stateTime = 0;

    // ── 3D mesh ──────────────────────────────────────────────────────
    this.mesh = ModelFactory.buildPlayer();
    this.mesh.position.set(0, 0, LAYERS.PLAYER);
    this._scene.add(this.mesh);

    // Player light is built into the model now
    this._playerLight = this.mesh.getObjectByName('_playerLight');

    // ── cached mesh parts for animation ──────────────────────────────
    this._parts = {
      torso: this.mesh.getObjectByName('_torso'),
      head: this.mesh.getObjectByName('_head'),
      upperArmL: this.mesh.getObjectByName('_upperArm_L'),
      upperArmR: this.mesh.getObjectByName('_upperArm_R'),
      lowerArmL: this.mesh.getObjectByName('_lowerArm_L'),
      lowerArmR: this.mesh.getObjectByName('_lowerArm_R'),
      upperLegL: this.mesh.getObjectByName('_upperLeg_L'),
      upperLegR: this.mesh.getObjectByName('_upperLeg_R'),
      lowerLegL: this.mesh.getObjectByName('_lowerLeg_L'),
      lowerLegR: this.mesh.getObjectByName('_lowerLeg_R'),
      weapon: this.mesh.getObjectByName('_weapon'),
      backpack: this.mesh.getObjectByName('_backpack'),
      visor: this.mesh.getObjectByName('_visor'),
      antennaTip: this.mesh.getObjectByName('_antennaTip'),
      bladeGlow: this.mesh.getObjectByName('_bladeGlow'),
    };

    // ── scratch quaternion for smooth lerp ───────────────────────────
    this._tmpQuat = new THREE.Quaternion();

    // ── attack ───────────────────────────────────────────────────────
    this._attackCooldown = 0;
    this.isAttacking = false;
    this._attackTime = 0;
    this._hitEnemiesThisSwing = new Set();
    this._hitBossThisSwing = false;

    // ── scratch vectors ──────────────────────────────────────────────
    this._v3 = new THREE.Vector3();

    LOG('Player', 'Initialized');
  }

  /** Spawn player at world coordinates */
  spawn(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.isAlive = true;
    this.hp = PLAYER.HP;
    this.hitInvincible = 0;
    this.onGround = false;
    this.facingDir = 1;
    this.jumpsRemaining = this.maxJumps;
    this._state = 'idle';
    this._stateTime = 0;
    this.mesh.position.set(x, y, LAYERS.PLAYER);
    this.mesh.visible = true;
    this.mesh.scale.setScalar(1);
    LOG('Player', `Spawned at (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }

  /** Main update — called every tick */
  update(dt, input, platforms, doors) {
    if (!this.isAlive) return;

    this._stateTime += dt;

    // ── timers ─────────────────────────────────────────────────────
    if (this.hitInvincible > 0) this.hitInvincible -= dt;
    if (this._attackCooldown > 0) this._attackCooldown -= dt;
    if (this._dashCooldown > 0) this._dashCooldown -= dt;
    if (this._wallJumpCooldown > 0) this._wallJumpCooldown -= dt;

    // ── dash ───────────────────────────────────────────────────────
    if (this._dashTimer > 0) {
      this._updateDash(dt, platforms, doors);
      return;
    }

    // ── knockback ──────────────────────────────────────────────────
    if (this._knockbackTime > 0) {
      this._updateKnockback(dt, platforms);
      return;
    }

    // ── horizontal movement ────────────────────────────────────────
    const moveDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (moveDir !== 0) {
      this.facingDir = moveDir;
      this.vx += moveDir * PLAYER.WALK_ACCEL * dt;
      this.vx = Math.max(-PLAYER.WALK_MAX, Math.min(PLAYER.WALK_MAX, this.vx));
    } else {
      // Friction
      if (Math.abs(this.vx) < PLAYER.WALK_FRICTION * dt) {
        this.vx = 0;
      } else {
        this.vx -= Math.sign(this.vx) * PLAYER.WALK_FRICTION * dt;
      }
    }

    // ── gravity ────────────────────────────────────────────────────
    const grav = this._jumpHeld && this.vy > 0 ? PHYSICS.GRAVITY * (PLAYER.JUMP_HOLD_GRAVITY / PHYSICS.GRAVITY) : PHYSICS.GRAVITY;
    this.vy -= grav * dt;
    if (this.vy < -PHYSICS.MAX_FALL_SPEED) this.vy = -PHYSICS.MAX_FALL_SPEED;

    // Jump cut (release jump early = less height)
    if (this._jumpCut && this.vy > 0) {
      this.vy *= PLAYER.JUMP_CUT_MULT;
      this._jumpCut = false;
    }

    // ── apply velocity + collision ─────────────────────────────────
    this._moveWithCollision(dt, platforms);

    // ── process doors ──────────────────────────────────────────────
    this._checkDoors(doors);

    // ── state detection ────────────────────────────────────────────
    this._detectState();

    // ── input: jump / dash / attack ────────────────────────────────
    this._processInput(input);

    // ── update 3D mesh ─────────────────────────────────────────────
    this._updateMesh(dt);
  }

  _updateDash(dt, platforms, doors) {
    this._dashTimer -= dt;
    this.vx = this._dashDir * PLAYER.DASH_SPEED;

    // Simple horizontal movement during dash (ignore gravity briefly)
    this.vy *= 0.1;  // slight gravity
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this._dashTimer <= 0) {
      this.vx = this._dashDir * PLAYER.WALK_MAX * 0.5; // keep some momentum
      this._dashTimer = 0;
      this._dashCooldown = PLAYER.DASH_COOLDOWN;
      LOG('Player', '[VERBOSE] Dash ended');
    }
  }

  _updateKnockback(dt, platforms) {
    this._knockbackTime -= dt;
    this.vx = this._knockbackVx * (this._knockbackTime / 0.2);
    this.vy = this._knockbackVy * (this._knockbackTime / 0.2);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Clamp to platforms during knockback
    for (const p of platforms) {
      this._resolvePlatformCollision(p);
    }

    if (this._knockbackTime <= 0) {
      this.vx = 0;
      this.vy = 0;
      this._knockbackTime = 0;
    }
  }

  /** Move with AABB collision resolution — Y first, then X */
  _moveWithCollision(dt, platforms) {
    // Apply velocity
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.onGround = false;
    this.onWall = null;

    const hw = PLAYER.WIDTH / 2;
    const hh = PLAYER.HEIGHT / 2;

    for (const p of platforms) {
      if (p.kind === 'ceiling') {
        // Ceiling: player head hits it
        if (this.x + hw > p.worldX - p.w / 2 && this.x - hw < p.worldX + p.w / 2) {
          if (this.y + hh > p.worldY - p.h / 2 && this.y + hh - this.vy * dt <= p.worldY - p.h / 2) {
            this.y = p.worldY - p.h / 2 - hh;
            this.vy = 0;
          }
        }
        continue;
      }

      if (p.kind === 'wall') {
        // Left wall
        if (p.worldX < this.x) {
          if (this.x - hw < p.worldX + p.w / 2 && this.x - hw >= p.worldX + p.w / 2 - 0.3) {
            if (this.y + hh > p.worldY - p.h / 2 && this.y - hh < p.worldY + p.h / 2) {
              this.x = p.worldX + p.w / 2 + hw;
              this.vx = Math.max(0, this.vx);
              this.onWall = 'left';
            }
          }
        }
        // Right wall
        if (p.worldX > this.x) {
          if (this.x + hw > p.worldX - p.w / 2 && this.x + hw <= p.worldX - p.w / 2 + 0.3) {
            if (this.y + hh > p.worldY - p.h / 2 && this.y - hh < p.worldY + p.h / 2) {
              this.x = p.worldX - p.w / 2 - hw;
              this.vx = Math.min(0, this.vx);
              this.onWall = 'right';
            }
          }
        }
        continue;
      }

      // Platform/floor collision: player feet landing on top
      const pTop = p.worldY + p.h / 2;
      const pLeft = p.worldX - p.w / 2;
      const pRight = p.worldX + p.w / 2;

      if (this.x + hw > pLeft && this.x - hw < pRight) {
        // Landing on top (was above, now at or below)
        if (this.y - hh <= pTop && this.y - hh - this.vy * dt >= pTop) {
          this.y = pTop + hh;
          this.vy = 0;
          this.onGround = true;

          // Reset coyote and jumps
          this._coyoteTimer = PLAYER.COYOTE_FRAMES / 60;
          this.jumpsRemaining = this.maxJumps;
        }
        // Still standing on platform
        else if (Math.abs((this.y - hh) - pTop) < 0.15 && this.vy <= 0) {
          this.y = pTop + hh;
          this.vy = 0;
          this.onGround = true;
          this._coyoteTimer = PLAYER.COYOTE_FRAMES / 60;
          if (this._wallJumpCooldown <= 0) {
            this.jumpsRemaining = this.maxJumps;
          }
        }
        // Defensive: player stuck below floor — push up
        else if (this.y - hh < pTop && this.y > p.worldY - p.h && this.vy <= 0) {
          this.y = pTop + hh;
          this.vy = 0;
          this.onGround = true;
          this._coyoteTimer = PLAYER.COYOTE_FRAMES / 60;
          this.jumpsRemaining = this.maxJumps;
        }
      }
    }

    // If still in air and not on ground, decrement coyote timer
    if (!this.onGround) {
      if (this._coyoteTimer > 0) this._coyoteTimer -= dt;
    }
  }

  /** Check door collisions and trigger room transitions */
  _checkDoors(doors) {
    for (const d of doors) {
      if (d.kind === 'spawn') continue;

      // Check if player overlaps door area
      if (Math.abs(this.x - d.worldX) < 0.5 && Math.abs(this.y - d.worldY) < 1.0) {
        // Check if door is locked by ability requirement
        if (d.requiresAbility && d.locked) {
          // Door is visible as locked — nothing happens unless player has ability
          continue;
        }

        // Trigger transition
        if (d.dest) {
          LOG('Player', `Door transition → ${d.dest} (dir: ${d.direction})`);
          EventBus.emit('room:enter', { roomId: d.dest, direction: d.direction });
          this._teleportToDoor(d.dest, d.direction);
          return;
        }
      }
    }
  }

  _teleportToDoor(destRoomId, fromDirection) {
    // We need the RoomManager to get door positions. For now, use a data-bridge approach:
    // The Game loop will handle this via EventBus 'room:enter'
    // The room manager provides the spawn door position
  }

  _detectState() {
    if (!this.isAlive) { this._state = 'hurt'; return; }
    if (this._dashTimer > 0) { this._state = 'dash'; return; }
    if (this._knockbackTime > 0) { this._state = 'hurt'; return; }

    if (this.onWall && !this.onGround && this.vy < 0) {
      this._state = 'wallslide';
    } else if (!this.onGround) {
      if (this.jumpsRemaining === 1 && this.maxJumps >= 2) {
        this._state = 'doublejump';
      } else {
        this._state = 'jump';
      }
    } else if (Math.abs(this.vx) > 0.3) {
      this._state = 'run';
    } else {
      this._state = 'idle';
    }
  }

  _processInput(input) {
    // Jump
    if (input.jumpPressed) {
      this._jumpBufferTimer = PLAYER.JUMP_BUFFER_FRAMES / 60;
    }
    if (this._jumpBufferTimer > 0) {
      // Can jump if coyote time active (on ground or just left) AND jumps remaining
      if (this._coyoteTimer > 0 && this.jumpsRemaining > 0) {
        this._doJump();
        this._jumpBufferTimer = 0;
      }
      // Wall jump
      else if (this.onWall && !this.onGround && this._wallJumpCooldown <= 0 && this._hasWallJump) {
        this._doWallJump();
        this._jumpBufferTimer = 0;
      }
    }
    if (input.jumpHeld) {
      this._jumpHeld = true;
    } else {
      if (this._jumpHeld && this.vy > 0) {
        this._jumpCut = true;
      }
      this._jumpHeld = false;
    }

    // Dash
    if (input.dashPressed && this._dashCooldown <= 0 && this._dashTimer <= 0 && this._hasDash) {
      this._startDash();
    }

    // Attack
    if (input.attackPressed && this._attackCooldown <= 0) {
      this._startAttack();
    }
  }

  _doJump() {
    this.vy = PLAYER.JUMP_VELOCITY;
    this.jumpsRemaining--;
    this._coyoteTimer = 0;
    this.onGround = false;
    this._jumpHeld = true;
    LOG('Player', `Jump! (${this.jumpsRemaining} remaining)`);
  }

  _doWallJump() {
    const wallDir = this.onWall === 'left' ? 1 : -1;
    this.vx = wallDir * PLAYER.WALL_JUMP_H;
    this.vy = PLAYER.WALL_JUMP_V;
    this._wallJumpCooldown = 0.25;
    this.onWall = null;
    LOG('Player', 'Wall jump!');
  }

  _startDash() {
    this._dashTimer = PLAYER.DASH_DURATION;
    this._dashDir = this.facingDir;
    this._dashCooldown = PLAYER.DASH_COOLDOWN;
    this.onGround = false;
    LOG('Player', 'Dash!');
  }

  _startAttack() {
    this.isAttacking = true;
    this._attackCooldown = PLAYER.ATTACK_COOLDOWN;
    this._attackTime = 0.15;  // swing duration
    this._hitEnemiesThisSwing.clear();
    this._hitBossThisSwing = false;
    LOG('Player', '[VERBOSE] Attack!');
  }

  /** Take damage from enemy/boss */
  takeDamage(amount, fromDir) {
    if (this.hitInvincible > 0 || !this.isAlive) return;
    this.hp -= amount;
    this.hitInvincible = PLAYER.HIT_INVINCIBILITY;
    this._knockbackTime = PLAYER.KNOCKBACK_TIME;
    this._knockbackVx = fromDir * PLAYER.KNOCKBACK_FORCE;
    this._knockbackVy = 3;
    LOG('Player', `Took ${amount} damage! HP: ${this.hp}/${this.maxHp}`);

    EventBus.emit('player:damaged', { hp: this.hp, maxHp: this.maxHp });

    if (this.hp <= 0) {
      this.die();
    }
  }

  die() {
    this.isAlive = false;
    this.hp = 0;
    this._state = 'hurt';
    LOG('Player', 'Died!');
    EventBus.emit('player:died');
  }

  /** Update 3D mesh position, rotation, and articulated animation */
  _updateMesh(dt) {
    this._animTime += dt;

    // Position
    this.mesh.position.set(this.x, this.y, LAYERS.PLAYER);

    // Face direction (smooth)
    const targetRotY = this.facingDir === 1 ? 0 : Math.PI;
    this._tmpQuat.setFromEuler(new THREE.Euler(0, targetRotY, 0));
    this.mesh.quaternion.slerp(this._tmpQuat, 0.25);

    // Hit invincibility flicker — only flicker armor, not light
    const flicker = this.hitInvincible > 0 && Math.floor(this._animTime * 24) % 2 === 0;
    const p = this._parts;

    // Helper: set visible for armor parts only
    const setArmorVisible = (v) => {
      if (p.torso) p.torso.visible = v;
      if (p.head) p.head.visible = v;
      for (const key of ['upperArmL', 'upperArmR', 'upperLegL', 'upperLegR']) {
        if (p[key]) p[key].visible = v;
      }
    };
    setArmorVisible(!flicker);

    // Keep weapon and light visible always
    if (p.weapon) p.weapon.visible = true;
    if (this._playerLight) this._playerLight.visible = true;

    // ── State animations ──────────────────────────────────────────
    this._animWalkCycle(dt, p);
    this._animIdleBreathing(dt, p);
    this._animJumpPose(dt, p);
    this._animDash(dt, p);
    this._animWallSlide(dt, p);
    this._animHurt(dt, p);

    // ── Attack animation ──────────────────────────────────────────
    if (this._attackTime > 0) {
      this._attackTime -= dt;
      this._animAttack(dt, p);
      if (this._attackTime <= 0) {
        this.isAttacking = false;
      }
    } else if (p.weapon) {
      // Hide weapon when not attacking
      p.weapon.visible = false;
    }

    // ── Update shader time uniforms ───────────────────────────────
    const time = this._animTime;
    this.mesh.traverse(c => {
      if (c.material?.uniforms?.uTime) {
        c.material.uniforms.uTime.value = time;
      }
    });

    // Pulse antenna tip glow
    if (p.antennaTip?.material) {
      p.antennaTip.material.opacity = 0.6 + Math.sin(time * 4) * 0.4;
    }

    // Reset limb rotations that aren't driven by active state
    const statesNeedingLegs = ['run'];
    const statesNeedingArms = ['run'];
    if (!statesNeedingLegs.includes(this._state)) {
      this._resetLimb(p.upperLegL, p.lowerLegL, 0);
      this._resetLimb(p.upperLegR, p.lowerLegR, 0);
    }
    if (!statesNeedingArms.includes(this._state)) {
      this._resetArm(p.upperArmL, p.lowerArmL, -0.3, 0);
      this._resetArm(p.upperArmR, p.lowerArmR, -0.3, 0);
    }
  }

  /** Smoothly rotate a limb toward target angles */
  _rotateToward(pivot, childPivot, axis, angle, childAngle, speed) {
    if (!pivot) return;
    const t = Math.min(speed, 1.0);
    pivot.rotation[axis] += (angle - pivot.rotation[axis]) * t;
    if (childPivot) {
      childPivot.rotation[axis] += (childAngle - childPivot.rotation[axis]) * t;
    }
  }

  _resetLimb(upper, lower, tilt) {
    if (!upper) return;
    upper.rotation.x += (tilt - upper.rotation.x) * 0.2;
    upper.rotation.z += (0 - upper.rotation.z) * 0.2;
    if (lower) lower.rotation.x += (0 - lower.rotation.x) * 0.2;
  }

  _resetArm(upper, lower, restX, restZ) {
    if (!upper) return;
    upper.rotation.x += (restX - upper.rotation.x) * 0.2;
    upper.rotation.z += (restZ - upper.rotation.z) * 0.2;
    if (lower) lower.rotation.x += (0 - lower.rotation.x) * 0.2;
  }

  // ── Animation sub-systems ──────────────────────────────────────

  _animWalkCycle(dt, p) {
    if (this._state !== 'run') return;
    const speed = Math.abs(this.vx) / PLAYER.WALK_MAX;
    const cycle = this._animTime * 12 * speed;
    const legSwing = Math.sin(cycle) * 0.55;
    const armSwing = Math.sin(cycle) * 0.35;

    // Legs: alternating forward/back swing
    this._rotateToward(p.upperLegL, p.lowerLegL, 'x', legSwing, Math.abs(legSwing) * 0.5, 0.3);
    this._rotateToward(p.upperLegR, p.lowerLegR, 'x', -legSwing, Math.abs(legSwing) * 0.5, 0.3);

    // Arms: opposite to legs
    this._rotateToward(p.upperArmL, p.lowerArmL, 'x', -armSwing - 0.3, 0, 0.3);
    this._rotateToward(p.upperArmR, p.lowerArmR, 'x', armSwing - 0.3, 0, 0.3);

    // Torso bob
    if (p.torso) p.torso.position.y = 0.5 + Math.abs(Math.sin(cycle * 2)) * 0.04;
  }

  _animIdleBreathing(dt, p) {
    if (this._state !== 'idle') return;
    const breathe = Math.sin(this._animTime * 2.5) * 0.03;
    if (p.torso) p.torso.position.y = 0.5 + breathe;
    if (p.torso) p.torso.scale.y = 1 + breathe * 0.3;
    if (p.head) p.head.position.y = 1.08 + Math.sin(this._animTime * 2) * 0.015;
  }

  _animJumpPose(dt, p) {
    if (this._state !== 'jump' && this._state !== 'doublejump') return;

    // Tuck legs up
    const tuck = 0.6;
    this._rotateToward(p.upperLegL, p.lowerLegL, 'x', -tuck, -tuck * 0.8, 0.25);
    this._rotateToward(p.upperLegR, p.lowerLegR, 'x', -tuck, -tuck * 0.8, 0.25);

    // Arms up slightly
    this._rotateToward(p.upperArmL, p.lowerArmL, 'x', -1.0, -0.5, 0.25);
    this._rotateToward(p.upperArmR, p.lowerArmR, 'x', -1.0, -0.5, 0.25);

    // Squash body slightly
    if (p.torso) p.torso.scale.y += (0.88 - p.torso.scale.y) * 0.2;

    // Double jump: spin
    if (this._state === 'doublejump') {
      this.mesh.rotation.z += dt * 9;
    } else {
      this.mesh.rotation.z *= 0.85;
    }
  }

  _animDash(dt, p) {
    if (this._state !== 'dash') {
      // Reset dash deform
      if (p.torso) p.torso.scale.x += (1 - p.torso.scale.x) * 0.3;
      if (p.torso) p.torso.scale.y += (1 - p.torso.scale.y) * 0.3;
      if (p.torso) p.torso.scale.z += (1 - p.torso.scale.z) * 0.3;
      if (p.backpack) p.backpack.scale.setScalar(1 + (1 - p.backpack.scale.x) * 0.3);
      return;
    }

    // Stretch horizontally
    const stretchX = 1.4;
    const squashY = 0.65;
    if (p.torso) {
      p.torso.scale.x += (stretchX - p.torso.scale.x) * 0.4;
      p.torso.scale.y += (squashY - p.torso.scale.y) * 0.4;
      p.torso.scale.z += (0.85 - p.torso.scale.z) * 0.4;
    }

    // Backpack thruster glow
    if (p.backpack) p.backpack.scale.setScalar(1 + Math.sin(this._animTime * 30) * 0.15);

    // Arms pulled back
    this._rotateToward(p.upperArmL, p.lowerArmL, 'x', 0.5, -1.0, 0.3);
    this._rotateToward(p.upperArmR, p.lowerArmR, 'x', 0.5, -1.0, 0.3);

    // Legs straight back
    this._rotateToward(p.upperLegL, p.lowerLegL, 'x', 0.3, -0.2, 0.3);
    this._rotateToward(p.upperLegR, p.lowerLegR, 'x', 0.3, -0.2, 0.3);
  }

  _animWallSlide(dt, p) {
    if (this._state !== 'wallslide') {
      if (p.torso) p.torso.rotation.z += (0 - p.torso.rotation.z) * 0.25;
      return;
    }
    const tilt = this.onWall === 'left' ? 0.25 : -0.25;
    if (p.torso) p.torso.rotation.z += (tilt - p.torso.rotation.z) * 0.2;

    // One arm reaching toward wall
    const armDir = this.onWall === 'left' ? -1 : 1;
    const wallArm = armDir < 0 ? p.upperArmR : p.upperArmL;
    if (wallArm) wallArm.rotation.z += (armDir * 1.2 - wallArm.rotation.z) * 0.3;
  }

  _animHurt(dt, p) {
    if (this._state !== 'hurt') return;
    // Recoil backward
    if (p.torso) p.torso.rotation.x += (-0.2 - p.torso.rotation.x) * 0.3;
    if (p.head) p.head.rotation.x += (-0.3 - p.head.rotation.x) * 0.3;
    // Arms flail
    this._rotateToward(p.upperArmL, p.lowerArmL, 'x', -1.5, -1.0, 0.3);
    this._rotateToward(p.upperArmR, p.lowerArmR, 'x', -1.5, -1.0, 0.3);
  }

  _animAttack(dt, p) {
    if (!p.weapon) return;
    p.weapon.visible = true;

    // Attach weapon to right hand / shoulder area
    p.weapon.position.set(0.5 * this.facingDir, 0.35, 0);
    p.weapon.rotation.z = 0;

    // Swing arc: fast rotation
    const swingT = 1 - (this._attackTime / 0.15);
    const swingAngle = -1.8 + swingT * 3.6; // -90° to +90°
    p.weapon.rotation.z = swingAngle * this.facingDir;

    // Blade glow intensity pulses
    if (p.bladeGlow?.material) {
      p.bladeGlow.material.opacity = 0.2 + Math.abs(Math.sin(swingT * Math.PI)) * 0.5;
    }

    // Right arm follows weapon
    this._rotateToward(p.upperArmR, p.lowerArmR, 'x', -1.2, -0.8, 0.5);
  }

  /** Grant an ability to the player */
  grantAbility(name) {
    switch (name) {
      case 'doubleJump':
        this.maxJumps = 2;
        this.jumpsRemaining = this.maxJumps;
        break;
      case 'dash':
        this._hasDash = true;
        break;
      case 'wallJump':
        this._hasWallJump = true;
        break;
    }
    LOG('Player', `Ability granted: ${name}`);
  }

  dispose() {
    if (this.mesh.parent) this._scene.remove(this.mesh);
    this.mesh.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    });
    if (this._playerLight) this._playerLight.dispose();
  }
}
