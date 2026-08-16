// Headless smoke test: OrbSystem + OrbShooter import, construct with mock
// scene (THREE.Group), exercise methods with dummy data, verify dispose and
// fireball-singleton identity.
import * as THREE from 'three';
import { OrbSystem } from '../src/entities/OrbSystem.js';
import { OrbShooter, getFireballShared } from '../src/entities/OrbShooter.js';

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) { failures++; console.error('FAIL:', msg); }
  else console.log('ok  -', msg);
};

// singleton identity (stable across calls)
const s1 = getFireballShared();
const s2 = getFireballShared();
ok(s1 === s2, 'getFireballShared() returns the same object every call');

const scene = new THREE.Group();

// ---- OrbSystem ----
const credits = [];
const heals = [];
const buffs = [];
const bursts = [];
const orbs = new OrbSystem(scene, {
  orbValue: 1,
  onOrbCollected: (x, z, v) => credits.push({ x, z, v }),
  onHealthCollected: (x, z) => heals.push({ x, z }),
  onBuffCollected: (x, z, e) => buffs.push({ x, z, e }),
  onDeathBurst: (x, y, z) => bursts.push({ x, y, z }),
});
ok(Array.isArray(orbs.orbs), 'OrbSystem exposes this.orbs array');

orbs.dropOrb(1, 0, 2, 1);
orbs.dropHealth(3, 0, 4);
orbs.dropBuff(5, 0, 6, 'FIREBALL');
orbs.spawnDeathBurst(9, 0.5, 9);
ok(credits.length === 1 && credits[0].v === 1, 'dropOrb credits INSTANTLY (value 1)');
ok(orbs.orbs.length === 1, 'orb visual pending for VISUAL_LIFE');
ok(orbs.healthPickups.length === 1 && orbs.buffPickups.length === 1, 'health+buff pickups spawned');

// player far away → nothing collected
orbs.update(0.016, { x: -50, y: 0, z: -50 });
ok(heals.length === 0 && buffs.length === 0, 'no auto-collect far away');

// player within 1.4 u → auto-collect
orbs.update(0.016, { x: 3.2, y: 0, z: 4.1 });
orbs.update(0.016, { x: 5.2, y: 0, z: 6.1 });
ok(heals.length === 1, 'health auto-collected within 1.4 u');
ok(buffs.length === 1 && buffs[0].e === 'FIREBALL', 'buff auto-collected within 1.4 u');

// orb visual lifetime elapses
for (let i = 0; i < 100; i++) orbs.update(0.02, { x: 1, y: 0, z: 2 });
ok(orbs.orbs.length === 0, 'orb visual vanishes after VISUAL_LIFE');
ok(bursts.length === 1, 'death burst fired callback');

// ring TTL expiry: spawn a few rings, let them age out
orbs.dropOrb(0, 0, 0, 1);
for (let i = 0; i < 60; i++) orbs.update(0.02, { x: 0, y: 0, z: 0 });
ok(true, 'ring TTL aged without crash');

orbs.dispose();
orbs.dispose(); // idempotent
ok(true, 'OrbSystem dispose (twice) safe');

// ---- OrbShooter ----
let spent = 0;
let projectiles = 0, fireballs = 0, hits = 0, explosions = 0, breaks = 0;
const dir = new THREE.Vector3(0, 0, -1);
const origin = new THREE.Vector3(0, 1.6, 0);
const walls = [{ minX: -40, minZ: -40, maxX: 40, maxZ: 40 }]; // none hit at origin
const shoot = new OrbShooter(scene, {
  orbs: 5,
  getOrbs: () => 5,
  walls: () => [],
  props: () => [],
  spendOrb: () => { spent++; return true; },
  onProjectile: () => projectiles++,
  onFireballProjectile: () => fireballs++,
  onOrbHit: () => hits++,
  onOrbExplode: () => explosions++,
  onBreakableHit: () => breaks++,
});

// 3-step sequence: only FIRST step spends an orb
let r = shoot.fire(dir, origin, 0);
ok(r === 'ok', 'fire step1 ok');
r = shoot.fire(dir, origin, 0.23);
ok(r === 'ok', 'fire step2 ok (STEP_INTERVAL passed)');
ok(shoot.fire(dir, origin, 0.30) === 'cooldown', 'fire too soon → cooldown (hold cadence)');
r = shoot.fire(dir, origin, 0.45);
ok(r === 'ok', 'fire step3 ok');
ok(spent === 1, 'only FIRST step of sequence costs 1 orb (spent=1)');

// next click opens a NEW sequence → spends again
r = shoot.fire(dir, origin, 1.0);
ok(r === 'ok' && spent === 2, 'new sequence spends a second orb');

// sequence window expiry: >1.2 s gap after an open sequence closes it
// (open sequence: 1 step, then wait 2 s → step advances only with a new orb)
const spentBefore = spent;
r = shoot.fire(dir, origin, 3.0);
ok(r === 'ok' && spent === spentBefore + 1, 'expired window re-opens sequence (costs orb)');

// zero orbs → 'no-orbs' signal
const poor = new OrbShooter(scene, { orbs: 0, getOrbs: () => 0, spendOrb: () => false });
ok(poor.fire(dir, origin, 0) === 'no-orbs', '0 orbs → no-orbs signal');

// fireball: only with buff active (index 2 = FIREBALL)
ok(shoot.fireFireball(dir, origin, 0) === false, 'fireball blocked without FIREBALL buff');
shoot.setActiveBuff(2);
ok(shoot.fireFireball(dir, origin, 0) === true, 'fireball fires with FIREBALL buff');
ok(fireballs === 1 && projectiles >= 1, 'fireball + normal projectile callbacks');
ok(shoot.fireFireball(dir, origin, 0.1) === false, 'fireball cooldown (0.35 s) blocks');
ok(shoot.fireFireball(dir, origin, 0.4) === true, 'fireball ready after cooldown');
shoot.setActiveBuff(0);
ok(shoot.fireFireball(dir, origin, 1.0) === false, 'fireball blocked after buff cleared');

// update with collisions → bounces/fizzles/explosions without crash
const shoot2 = new OrbShooter(new THREE.Group(), {
  orbs: 10, getOrbs: () => 10,
  walls: () => [{ minX: 5, minZ: -5, maxX: 5.3, maxZ: 5 }],
  props: () => [{ minX: 10, minZ: -10, maxX: 10.3, maxZ: 10 }],
  spendOrb: () => true,
  onProjectile: () => {}, onFireballProjectile: () => {},
  onOrbHit: () => {}, onOrbExplode: () => {}, onBreakableHit: () => {},
});
shoot2.fire(new THREE.Vector3(0, 0, -1), origin, 0);
shoot2.fire(new THREE.Vector3(0, 0, -1), origin, 0.23);
shoot2.fire(new THREE.Vector3(0, 0, -1), origin, 0.45); // explosive step 3
for (let i = 0; i < 300; i++) shoot2.update(1 / 60, origin, dir); // 5 s: all die
shoot2.dispose();
ok(true, 'projectile flight/bounce/fizzle/explosion update safe');

shoot.dispose();
shoot.dispose();
ok(true, 'OrbShooter dispose (twice) safe');

// singleton still valid after dispose (NOT disposed)
const s3 = getFireballShared();
ok(s1 === s3 && s3.core && s3.glow && s3.ringMat, 'fireball singletons survive dispose');

console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
