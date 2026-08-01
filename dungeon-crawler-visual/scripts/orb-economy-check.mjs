// Headless verification: orb economy rework (3-orb volley, 1 bounce, AOE
// explosion), health-reset drops, and fluorescent rats.
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
const { ORB_WEAPON, DROP, PLAYER, RAT } = await import(`${BASE}/core/Constants.js`);

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
const dt = 1 / 60;

// ===========================================================================
// 1) ORB VOLLEY — 1 shot = 3 smaller orbs, last one explosive
// ===========================================================================
console.log('== Orb volley ==');
{
  const scene = makeScene();
  const shooter = new OrbShooter(scene);
  shooter.init();
  const fired = shooter.fire(0, 1, 0, 0, 0); // facing -z
  ok(fired.length === 3, `fire() returns ${fired.length} orbs (expected 3)`);
  ok(fired.filter((p) => !p.explode).length === 2 && fired.filter((p) => p.explode).length === 1,
    'first 2 orbs normal, last orb explosive');
  ok(fired.every((p) => p.active && p.mesh.visible), 'all 3 orbs active on fire');
  ok(fired.every((p) => Math.abs(p.dirZ) > 0.99), 'volley flies along the aim vector');
  // fan spread: orb 0 and orb 2 diverge in x
  ok(Math.abs(fired[0].dirX - fired[2].dirX) > 0.05, `volley has a fan spread (dirX ${fired[0].dirX.toFixed(3)}..${fired[2].dirX.toFixed(3)})`);
  shooter.dispose();
  ok(scene.children.length === 0, 'dispose cleans scene');
}

// ===========================================================================
// 2) BOUNCE — normal orbs bounce once off floor/wall, fizzle on 2nd contact
// ===========================================================================
console.log('== Orb bounce ==');
{
  const scene = makeScene();
  const shooter = new OrbShooter(scene);
  shooter.init();
  const hits = [];
  shooter.hitSkeleton = (s) => hits.push(s);

  // Floor bounce: fire downward, orb must bounce up once and stay active
  const [down] = shooter.fire(0, 3.5, 0, 0, -0.8); // steep downward pitch
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

  // Ceiling bounce: fire upward, must bounce down once
  const [up] = shooter.fire(0, 1, 0, 0, 0.9);
  let upBounced = false;
  for (let i = 0; i < 60 * 2 && up.active; i++) {
    shooter.update(dt, [], []);
    if (up.bounces === 1 && up.dirY < 0) upBounced = true;
  }
  ok(upBounced, 'orb bounced once off the ceiling');

  // Wall double-bounce: corridor -> bounce once, then fizzle on 2nd contact.
  // Use the CENTER orb of the volley (zero fan spread) so dirZ is exactly 0.
  const corridor = [
    { minX: -0.8, maxX: -0.4, minZ: -10, maxZ: 10 },
    { minX: 0.4, maxX: 0.8, minZ: -10, maxZ: 10 },
  ];
  const wallVolley = shooter.fire(0, 1, 0, -Math.PI / 2, 0); // straight +x into the wall
  const wall = wallVolley[1];
  let wallBounced = false;
  for (let i = 0; i < 60 * 4; i++) {
    shooter.update(dt, corridor, []);
    if (wall.bounces === 1 && !wallBounced) {
      wallBounced = true;
      ok(Math.abs(wall.dirZ) < 0.001 && Math.abs(wall.dirX) > 0.9,
        `wall bounce reflects the dominant axis (dirX=${wall.dirX.toFixed(2)}, dirZ=${wall.dirZ.toFixed(2)})`);
    }
    if (!wall.active) break;
  }
  ok(wallBounced, 'orb bounced once off a wall');
  ok(!wall.active, 'orb fizzles on the second wall contact');
  shooter.dispose();
}

// ===========================================================================
// 3) EXPLOSION — the last orb detonates on contact, AOE callback fires
// ===========================================================================
console.log('== Orb explosion ==');
{
  const scene = makeScene();
  const shooter = new OrbShooter(scene);
  shooter.init();
  const blasts = [];
  shooter.onExplode = (x, y, z) => blasts.push({ x, y, z });

  // Explosive orb fired straight down: detonates on the floor
  const volley = shooter.fire(0, 2, 0, 0, -0.9);
  const bomb = volley[2];
  ok(bomb.explode, 'last orb is the explosive one');
  for (let i = 0; i < 60 * 2; i++) {
    shooter.update(dt, [], []);
    if (!bomb.active) break;
  }
  ok(!bomb.active, 'explosive orb deactivated after detonation');
  ok(blasts.length === 1, `onExplode fired once (${blasts.length})`);
  ok(blasts[0] && blasts[0].y < 0.3, `blast at floor level (y=${blasts[0]?.y.toFixed(2)})`);
  const boomActive = shooter._booms.filter((b) => b.active).length;
  ok(boomActive === 1, `explosion ring active (${boomActive})`);

  // Explosive orb against an enemy: detonates, direct victim inside radius
  const volley2 = shooter.fire(0, 1.5, 0, 0, 0);
  const bomb2 = volley2[2];
  const enemy = { x: 0, z: -0.8, skel: { state: 'CHASE' } };
  for (let i = 0; i < 60 * 2 && bomb2.active; i++) {
    shooter.update(dt, [], [enemy]);
  }
  ok(blasts.length === 2, `enemy contact detonates the orb (${blasts.length} blasts)`);
  ok(Math.hypot(blasts[1].x - enemy.x, blasts[1].z - enemy.z) < ORB_WEAPON.EXPLODE_RADIUS,
    'blast point within EXPLODE_RADIUS of the enemy');
  shooter.dispose();
}

// ===========================================================================
// 4) HEALTH RESET DROP — red cross pickup, full heal on collect
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
