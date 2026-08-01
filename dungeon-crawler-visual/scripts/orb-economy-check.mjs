// Headless verification: orb economy rework (click-per-step 3-orb sequence,
// 1 bounce, AOE explosion), health-reset drops, and fluorescent rats.
// Run: node scripts/orb-economy-check.mjs
import * as THREE from 'three';

// --- canvas stub for texture generators (runs before any constructor) ---
globalThis.document = {
  createElement: () => {
    const canvas = {
      width: 64, height: 64,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {}, beginPath() {}, stroke() {}, moveTo() {},
        lineTo() {}, arc() {}, fill() {}, closePath() {}, fillText() {},
      }),
    };
    return canvas;
  },
};

const BASE = '../src';
const { OrbShooter } = await import(`${BASE}/entities/OrbShooter.js`);
const { OrbSystem } = await import(`${BASE}/entities/OrbSystem.js`);
const { Rat } = await import(`${BASE}/entities/enemies/Rat.js`);
const { PlayerSword } = await import(`${BASE}/entities/PlayerSword.js`);
const { ORB_WEAPON, DROP, PLAYER, RAT, orbPowerMultiplier } = await import(`${BASE}/core/Constants.js`);

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL: ${msg}`); };
const ok = (cond, msg) => { if (!cond) fail(msg); };

function makeScene() {
  return {
    children: [],
    add(o) { this.children.push(o); },
    remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); },
  };
}
// Fresh shooter per sub-test: the sequence state is per-shooter, so sharing
// one shooter across independent scenarios would leak the step counter.
function newShooter() {
  const scene = makeScene();
  const shooter = new OrbShooter(scene);
  shooter.init();
  return { scene, shooter };
}
const dt = 1 / 60;

// ===========================================================================
// 1) ORB SEQUENCE — 1 click = 1 step; sequence of 3 steps costs 1 orb
// ===========================================================================
console.log('== Orb sequence (1 click = 1 step) ==');
{
  const { scene, shooter } = newShooter();

  const s1 = shooter.fire(0, 1, 0, 0, 0);
  ok(s1.step === 1 && s1.startingNew, 'click 1: step 1 opens a new sequence');
  ok(s1.projectile.active && !s1.projectile.explode, 'step 1 orb active, normal (bouncy)');

  const s2 = shooter.fire(0, 1, 0, 0, 0);
  ok(s2.step === 2 && !s2.startingNew, 'click 2: step 2 continues the sequence (free)');
  ok(!s2.projectile.explode, 'step 2 orb normal (bouncy)');

  const s3 = shooter.fire(0, 1, 0, 0, 0);
  ok(s3.step === 3 && !s3.startingNew, 'click 3: step 3 completes the sequence');
  ok(s3.projectile.explode, 'step 3 orb is the explosive one');

  const s4 = shooter.fire(0, 1, 0, 0, 0);
  ok(s4.step === 1 && s4.startingNew, 'click 4: sequence complete -> a new sequence starts');
  ok(!s4.projectile.explode, 'new sequence starts with a normal orb');

  // Window expiry: a pause longer than SEQUENCE_WINDOW resets the sequence
  for (let i = 0; i < Math.ceil((ORB_WEAPON.SEQUENCE_WINDOW + 0.1) / dt); i++) shooter.update(dt, [], []);
  ok(shooter.step === 0, 'sequence expired after the window');
  const w = shooter.fire(0, 1, 0, 0, 0);
  ok(w.startingNew && w.step === 1, 'post-window click opens a NEW sequence (re-charge)');
  shooter.dispose();
  ok(scene.children.length === 0, 'dispose cleans scene');
}

// ===========================================================================
// 2) BOUNCE — normal orbs bounce once off floor/wall/ceiling, fizzle on 2nd
// ===========================================================================
console.log('== Orb bounce ==');
{
  // Floor bounce: fire downward, orb must bounce up once and stay active
  {
    const { scene, shooter } = newShooter();
    const { projectile: down } = shooter.fire(0, 3.5, 0, 0, -0.8); // steep downward pitch
    let bounced = false;
    let survivedBounce = false;
    for (let i = 0; i < 60 * 2 && down.active; i++) {
      shooter.update(dt, [], []);
      if (down.bounces === 1 && down.dirY > 0 && !bounced) {
        bounced = true;
        survivedBounce = down.active;
        ok(down.mesh.position.y >= 0.14, `floor bounce restores y (${down.mesh.position.y.toFixed(2)})`);
        ok(down.dirY > 0, `floor bounce flips dirY upward (${down.dirY.toFixed(2)})`);
      }
    }
    ok(bounced, 'orb bounced once off the floor');
    ok(survivedBounce, 'orb survives the floor bounce');
    shooter.dispose();
  }

  // Ceiling bounce: fire upward, must bounce down once
  {
    const { scene, shooter } = newShooter();
    const { projectile: up } = shooter.fire(0, 1, 0, 0, 0.9);
    let upBounced = false;
    for (let i = 0; i < 60 * 2 && up.active; i++) {
      shooter.update(dt, [], []);
      if (up.bounces === 1 && up.dirY < 0) upBounced = true;
    }
    ok(upBounced, 'orb bounced once off the ceiling');
    shooter.dispose();
  }

  // Wall double-bounce: corridor -> bounce once, then fizzle on 2nd contact
  {
    const { scene, shooter } = newShooter();
    const corridor = [
      { minX: -0.8, maxX: -0.4, minZ: -10, maxZ: 10 },
      { minX: 0.4, maxX: 0.8, minZ: -10, maxZ: 10 },
    ];
    const { projectile: wall } = shooter.fire(0, 1, 0, -Math.PI / 2, 0); // straight +x into the wall
    let wallBounced = false;
    for (let i = 0; i < 60 * 4; i++) {
      shooter.update(dt, corridor, []);
      if (!wall.active) break;
      if (wall.bounces === 1 && !wallBounced) {
        wallBounced = true;
        ok(Math.abs(wall.dirZ) < 0.001 && Math.abs(wall.dirX) > 0.9,
          `wall bounce reflects the dominant axis (dirX=${wall.dirX.toFixed(2)}, dirZ=${wall.dirZ.toFixed(2)})`);
      }
    }
    ok(wallBounced, 'orb bounced once off a wall');
    ok(!wall.active, 'orb fizzles on the second wall contact');
    shooter.dispose();
  }
}

// ===========================================================================
// 3) EXPLOSION — the 3rd click of a sequence detonates, AOE callback fires
// ===========================================================================
console.log('== Orb explosion ==');
{
  // Steps 1-2 (bouncy) + step 3 (explosive) fired straight down
  {
    const { scene, shooter } = newShooter();
    const blasts = [];
    shooter.onExplode = (x, y, z) => blasts.push({ x, y, z });
    shooter.fire(0, 2, 0, 0, -0.9);
    shooter.fire(0, 2, 0, 0, -0.9);
    const f3 = shooter.fire(0, 2, 0, 0, -0.9);
    const bomb = f3.projectile;
    ok(bomb.explode, '3rd step orb is the explosive one');
    for (let i = 0; i < 60 * 2; i++) {
      shooter.update(dt, [], []);
      if (!bomb.active) break;
    }
    ok(!bomb.active, 'explosive orb deactivated after detonation');
    ok(blasts.length === 1, `onExplode fired once (${blasts.length})`);
    ok(blasts[0] && blasts[0].y < 0.3, `blast at floor level (y=${blasts[0]?.y.toFixed(2)})`);
    const boomActive = shooter._booms.filter((b) => b.active).length;
    ok(boomActive === 1, `explosion ring active (${boomActive})`);
    shooter.dispose();
  }

  // Explosive orb against an enemy: steps 1-2 direct hits, step 3 detonates
  {
    const { scene, shooter } = newShooter();
    const blasts = [];
    const hits = [];
    shooter.onExplode = (x, y, z) => blasts.push({ x, y, z });
    shooter.hitSkeleton = (s) => hits.push(s);
    shooter.fire(0, 1.5, 0, 0, 0);
    shooter.fire(0, 1.5, 0, 0, 0);
    const e3 = shooter.fire(0, 1.5, 0, 0, 0);
    const bomb2 = e3.projectile;
    const enemy = { x: 0, z: -0.8, skel: { state: 'CHASE' } };
    for (let i = 0; i < 60 * 2; i++) {
      shooter.update(dt, [], [enemy]);
      if (!bomb2.active) break;
    }
    ok(hits.length === 2, `steps 1-2 deal direct hits (${hits.length})`);
    ok(blasts.length === 1, `enemy contact detonates the 3rd orb (${blasts.length} blasts)`);
    ok(blasts[0] && Math.hypot(blasts[0].x - enemy.x, blasts[0].z - enemy.z) < ORB_WEAPON.EXPLODE_RADIUS,
      'blast point within EXPLODE_RADIUS of the enemy');
    shooter.dispose();
  }
}

// ===========================================================================
// 4) SHARED POWER MULTIPLIER — sword scale === enemy spawn-rate multiplier
// ===========================================================================
console.log('== Shared power multiplier ==');
{
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 50);
  const sword = new PlayerSword(cam);
  ok(orbPowerMultiplier(0) === 1 && orbPowerMultiplier(10) === 1.2
    && orbPowerMultiplier(100) === 3 && orbPowerMultiplier(999) === 3,
    `multiplier bounds (1 @0, 1.2 @10, 3 @100+, capped)`);
  for (const n of [0, 10, 50, 100, 150]) {
    sword.setOrbCount(n);
    ok(Math.abs(sword.scale - orbPowerMultiplier(n)) < 1e-9,
      `sword scale === orbPowerMultiplier(${n}) (${sword.scale.toFixed(2)})`);
  }
  sword.dispose();
}

// ===========================================================================
// 4b) FIREBALL BUFF — free explosive fireball weapon
// ===========================================================================
console.log('== Fireball (buff weapon) ==');
{
  const { scene, shooter } = newShooter();
  const blasts = [];
  shooter.onExplode = (x, y, z) => blasts.push({ x, y, z });

  const fb = shooter.fireFireball(0, 1, 0, 0, 0); // straight -z
  ok(fb && fb.explode && fb.fireball, 'fireball is explosive and fiery');
  ok(fb.active && fb.mesh.visible, 'fireball active on fire');
  // no sequence side effects: step/window untouched
  ok(shooter.step === 0 && shooter.window === 0, 'fireball does not advance the orb sequence');

  // wall contact -> detonate -> onExplode + orange ring
  const wall = { minX: 1, maxX: 1.4, minZ: -10, maxZ: 10 };
  const fb2 = shooter.fireFireball(0, 1, 0, -Math.PI / 2, 0); // +x into the wall
  for (let i = 0; i < 60 * 2 && fb2.active; i++) shooter.update(dt, [wall], []);
  ok(!fb2.active, 'fireball consumed by detonation');
  ok(blasts.length === 1, `onExplode fired for the fireball (${blasts.length})`);
  const fireRings = shooter._boomFires.filter((b) => b.active).length;
  ok(fireRings === 1, `fiery ring active (${fireRings})`);

  // volley integrity: fire() must never allocate a fireball slot
  const step = shooter.fire(0, 1, 0, 0, 0);
  ok(step.projectile && !step.projectile.fireball,
    'orb volley never uses fireball slots');
  shooter.dispose();
}

// ===========================================================================
// 4c) BUFF PICKUP — golden octahedron, collect -> onBuffCollected
// ===========================================================================
console.log('== Buff pickup ==');
{
  const scene = makeScene();
  const state = { collectedOrbs: 0, totalOrbs: 0, health: 2 };
  const orbs = new OrbSystem(scene, {}, state);
  orbs.init();
  let collected = 0;
  orbs.onBuffCollected = () => collected++;
  orbs.spawnBuff(0, 0);
  ok(orbs.drops.length === 1 && orbs.drops[0].kind === 'buff', 'buff pickup spawned');
  ok(scene.children.some((c) => c.type === 'Group'), 'buff group in scene');
  orbs.update(0, { x: 0.05, z: 0.05 }); // player on top
  ok(collected === 1, 'onBuffCollected fired on collect');
  ok(state.collectedOrbs === 0 && state.health === 2,
    'buff pickup grants no orbs and no heal');
  ok(orbs.drops.length === 0, 'buff drop consumed');
  orbs.dispose();
}

// ===========================================================================
// 5) HEALTH RESET DROP — red cross pickup, full heal on collect
// ===========================================================================
console.log('== Health drop ==');
{
  const scene = makeScene();
  const state = { collectedOrbs: 0, totalOrbs: 0, health: 1 };
  const orbs = new OrbSystem(scene, {}, state);
  orbs.init();
  orbs.spawnHealth(0, 0);
  ok(orbs.drops.length === 1 && orbs.drops[0].kind === 'health', 'health pickup spawned');
  ok(scene.children.some((c) => c.type === 'Group'), 'health cross group in scene');
  orbs.update(0, { x: 0.05, z: 0.05 }); // player on top of the drop
  ok(state.health === PLAYER.MAX_HEALTH, `health reset to max (${state.health}/${PLAYER.MAX_HEALTH})`);
  ok(state.collectedOrbs === 0, 'health pickup does not grant orbs');
  ok(orbs.drops.length === 0, 'drop consumed after collect');
  orbs.dispose();
}

// ===========================================================================
// 5) FLUORESCENT RATS — emissive + glow sprite
// ===========================================================================
console.log('== Fluorescent rats ==');
{
  const scene = makeScene();
  const rat = new Rat(scene, {});
  ok(rat._mats[0].emissiveIntensity > 1, `rat body is emissive (${rat._mats[0].emissiveIntensity})`);
  ok(rat._mats[1].emissiveIntensity > 1, `rat head is emissive (${rat._mats[1].emissiveIntensity})`);
  ok(!!rat._glow && rat._glow.visible !== false, 'rat has a glow sprite');
  ok(rat._glowMat.opacity > 0.3, `glow halo visible (opacity ${rat._glowMat.opacity.toFixed(2)})`);
  // death fade covers the glow material too (corpse still vanishes at 2s)
  rat.hit(99);
  for (let i = 0; i < Math.ceil(2.4 / (1 / 60)); i++) rat.update(1 / 60);
  ok(rat._mats.every((m) => m.opacity < 1), 'death fade applies to glow material too');
  rat.dispose();
  ok(scene.children.length === 0, 'rat dispose cleans scene');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
