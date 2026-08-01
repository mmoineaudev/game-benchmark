// Headless verification: sword 3-hit combo (NDC visibility + state machine +
// trail traces) and 2-second corpse despawn for every mob type.
// Run: node scripts/sword-death-check.mjs
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
const { PlayerSword } = await import(`${BASE}/entities/PlayerSword.js`);
const { Skeleton } = await import(`${BASE}/entities/Skeleton.js`);
const { Rat } = await import(`${BASE}/entities/enemies/Rat.js`);
const { Wraith } = await import(`${BASE}/entities/enemies/Wraith.js`);
const { SWORD, SKELETON, RAT, WRAITH } = await import(`${BASE}/core/Constants.js`);

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL: ${msg}`); };
const ok = (cond, msg) => { if (!cond) fail(msg); };

// ===========================================================================
// 1) SWORD — NDC visibility at every frame, state machine, arcs, trails
// ===========================================================================
console.log('== Sword combo ==');
const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 50);
const sword = new PlayerSword(cam);

const TIP = new THREE.Vector3(0, 0.71, 0.03);
const POMMEL = new THREE.Vector3(0, -0.11, 0);
const GUARD = new THREE.Vector3(0, 0.12, 0);

let frames = 0;
function ndcOf(local) {
  cam.updateMatrixWorld(true);
  sword.group.updateMatrixWorld(true);
  return local.clone().applyMatrix4(sword.group.matrixWorld).project(cam);
}
function checkVisible(label) {
  for (const [name, pt] of [['tip', TIP], ['pommel', POMMEL], ['guard', GUARD]]) {
    const ndc = ndcOf(pt);
    const vis = Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z > -1 && ndc.z < 1;
    if (!vis) fail(`${label} ${name} off-screen NDC=(${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)}, ${ndc.z.toFixed(2)})`);
  }
}

// Idle (ready pose "points forward")
checkVisible('idle');
const idleTip = ndcOf(TIP);
ok(idleTip.x < 0.5 && idleTip.y > -0.2 && idleTip.y < 1,
  `idle tip should project upper-center (got ${idleTip.x.toFixed(2)}, ${idleTip.y.toFixed(2)})`);

// Drive the full buffered combo
sword.attack();
const dt = 1 / 60;
const statesSeen = [];
const arcByState = {};
const damageByState = {};
const rangeByState = {};
const trailActive = { slash1: 0, slash2: 0, thrust3: 0 };
const stepByState = {};
const thrustZ = [];
let prevState = sword.state;
for (let i = 0; i < 60 * 4; i++) {
  if (sword.state !== prevState) { statesSeen.push(prevState); prevState = sword.state; }
  // Simulate the player pressing RMB inside each combo window
  if ((sword.state === 'recover1' || sword.state === 'recover2') && sword.time >= 0.15) {
    sword.bufferCombo();
  }
  if (sword.state === 'thrust3') thrustZ.push(ndcOf(TIP).z);
  sword.update(dt, Infinity);
  checkVisible(`state=${sword.state} t=${sword.time.toFixed(3)}`);
  frames++;
  if (sword.isSwinging) {
    arcByState[sword.state] = sword.currentArc;
    damageByState[sword.state] = sword.currentDamage;
    rangeByState[sword.state] = sword.currentRange;
    stepByState[sword.state] = sword.comboStep;
  }
  const poolIdx = sword.state === 'slash1' ? 0 : sword.state === 'slash2' ? 1 : sword.state === 'thrust3' ? 2 : -1;
  if (poolIdx >= 0) {
    const active = sword._trailPools[poolIdx].sprites.filter((s) => s.active).length;
    trailActive[sword.state] = Math.max(trailActive[sword.state], active);
  }
  if (sword.state === 'idle' && i > 5) break;
}
if (prevState !== sword.state) statesSeen.push(prevState); // state still in flight at break
statesSeen.push(sword.state); // current state at break

const expected = ['windup1', 'slash1', 'recover1', 'windup2', 'slash2', 'recover2', 'windup3', 'thrust3', 'recover3', 'cooldown', 'idle'];
ok(JSON.stringify(statesSeen) === JSON.stringify(expected),
  `state sequence ${JSON.stringify(statesSeen)} (expected ${JSON.stringify(expected)})`);
ok(stepByState.slash1 === 1 && stepByState.slash2 === 2 && stepByState.thrust3 === 3,
  `comboStep per strike (got ${JSON.stringify(stepByState)})`);
ok(Math.abs(arcByState.slash1 - SWORD.COMBO.ARC1) < 1e-9 && Math.abs(arcByState.slash2 - SWORD.COMBO.ARC2) < 1e-9
  && Math.abs(arcByState.thrust3 - SWORD.COMBO.ARC3) < 1e-9,
  `currentArc per strike (got ${JSON.stringify(arcByState)})`);
ok(damageByState.slash1 === 2 && damageByState.slash2 === 2 && damageByState.thrust3 === 3,
  `currentDamage per strike (got ${JSON.stringify(damageByState)})`);
ok(Math.abs(rangeByState.thrust3 - sword.range * SWORD.COMBO.RANGE3) < 1e-6
  && Math.abs(rangeByState.slash1 - sword.range) < 1e-6,
  `currentRange: thrust lunges (got ${JSON.stringify(rangeByState)})`);
ok(trailActive.slash1 > 0 && trailActive.slash2 > 0 && trailActive.thrust3 > 0,
  `trail sprites active during strikes (got ${JSON.stringify(trailActive)})`);
ok(frames >= 85 && frames <= 110,
  `full buffered combo ~1.57s ≈ 94 frames (got ${frames})`);
ok(thrustZ.length > 5, `thrust frames sampled (${thrustZ.length})`);
const zRising = thrustZ.every((z, i) => i === 0 || z >= thrustZ[i - 1] - 1e-6);
ok(zRising && thrustZ[thrustZ.length - 1] > 0.78 && thrustZ[0] < thrustZ[thrustZ.length - 1],
  `thrust drives the tip deeper into the screen (NDC z ${thrustZ[0].toFixed(3)} -> ${thrustZ[thrustZ.length - 1].toFixed(3)})`);
const thrustEndTip = (() => {
  cam.updateMatrixWorld(true);
  sword.group.updateMatrixWorld(true);
  return TIP.clone().applyMatrix4(sword.group.matrixWorld).project(cam);
})();
ok(Math.abs(thrustEndTip.x) < 0.15 && thrustEndTip.y > 0.4 && thrustEndTip.y < 0.85,
  `thrust ends with tip near screen center (NDC ${thrustEndTip.x.toFixed(2)}, ${thrustEndTip.y.toFixed(2)})`);
console.log(`  ...${frames} frames checked, strikes=${Object.keys(arcByState).length}, trail peaks ${JSON.stringify(trailActive)}, thrust z ${thrustZ[0]?.toFixed(3) ?? '?'}->${thrustZ[thrustZ.length - 1]?.toFixed(3) ?? '?'}`);

// ===========================================================================
// 2) CORPSES — bodies disappear 2 s after death (all mob types)
// ===========================================================================
console.log('== 2s corpse despawn ==');
function makeScene() {
  return {
    children: [],
    add(o) { this.children.push(o); },
    remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); },
  };
}
function driveDeath(ctor, opts) {
  const scene = makeScene();
  const mob = new ctor(scene, opts);
  const dt = 1 / 60;
  let kills = 0;
  let doneAt = -1;
  let frames = 0;
  let fadeAt15 = null;
  mob.onKill = () => kills++;
  mob.onDeathComplete = () => { if (doneAt < 0) doneAt = frames * dt; }; // first firing only
  const died = mob.hit(9999);
  const startState = mob.state;
  // drive 2.4 s; sample corpse visibility at 1.5 s
  for (let i = 0; i < Math.ceil(2.4 / dt); i++) {
    frames++;
    if (Math.abs(frames * dt - 1.5) < 0.02 && mob.fade !== undefined) fadeAt15 = mob.fade;
    mob.update(dt, 0);
  }
  return { scene, mob, died, startState, kills, doneAt, fadeAt15 };
}

// Skeleton (skeleton-family base; Armored/Archer/Brute inherit)
{
  const r = driveDeath(Skeleton, { active: true });
  ok(r.died && r.startState === 'DEAD' && r.kills === 1, `Skeleton hit -> DEAD + onKill (died=${r.died}, state=${r.startState}, kills=${r.kills})`);
  ok(Math.abs(r.doneAt - 2.0) < 0.05, `Skeleton corpse gone at 2.0s (fired at ${r.doneAt.toFixed(2)}s)`);
  ok(r.fadeAt15 === 1, `Skeleton fully visible at 1.5s (fade=${r.fadeAt15})`);
  r.mob.dispose();
  ok(r.scene.children.length === 0, `Skeleton dispose removes from scene (${r.scene.children.length} left)`);
  r.mob.dispose(); // double-dispose must be safe
  console.log(`  Skeleton: DEAD at 0s, onDeathComplete @${r.doneAt.toFixed(2)}s, scene clean after dispose`);
}

// Rat (previously never despawned)
{
  const r = driveDeath(Rat, {});
  ok(r.died && r.startState === 'DEAD' && r.kills === 1, `Rat hit -> DEAD + onKill (died=${r.died}, state=${r.startState}, kills=${r.kills})`);
  ok(Math.abs(r.doneAt - 2.0) < 0.05, `Rat corpse gone at 2.0s (fired at ${r.doneAt.toFixed(2)}s)`);
  ok(r.mob._mats.every((m) => m.opacity < 1), `Rat faded out by 2.4s (opacities ${r.mob._mats.map((m) => m.opacity.toFixed(2)).join(',')})`);
  r.mob.dispose();
  ok(r.scene.children.length === 0, `Rat dispose removes from scene (${r.scene.children.length} left)`);
  console.log(`  Rat: DEAD at 0s, onDeathComplete @${r.doneAt.toFixed(2)}s, scene clean after dispose`);
}

// Wraith (previously never despawned)
{
  const r = driveDeath(Wraith, {});
  ok(r.died && r.startState === 'DEAD' && r.kills === 1, `Wraith hit -> DEAD + onKill (died=${r.died}, state=${r.startState}, kills=${r.kills})`);
  ok(Math.abs(r.doneAt - 2.0) < 0.05, `Wraith corpse gone at 2.0s (fired at ${r.doneAt.toFixed(2)}s)`);
  ok(r.mob.bodyMat.opacity < 0.35, `Wraith body faded by 2.4s (opacity=${r.mob.bodyMat.opacity.toFixed(2)})`);
  r.mob.dispose();
  ok(r.scene.children.length === 0, `Wraith dispose removes from scene (${r.scene.children.length} left)`);
  console.log(`  Wraith: DEAD at 0s, onDeathComplete @${r.doneAt.toFixed(2)}s, scene clean after dispose`);
}

// Corpse must NOT vanish early (still present at 1.9 s)
for (const [name, ctor, opts] of [['Skeleton', Skeleton, { active: true }], ['Rat', Rat, {}], ['Wraith', Wraith, {}]]) {
  const scene = makeScene();
  const mob = new ctor(scene, opts);
  let done = false;
  mob.onDeathComplete = () => { done = true; };
  mob.hit(9999);
  for (let i = 0; i < Math.ceil(1.9 / (1 / 60)); i++) mob.update(1 / 60, 0);
  ok(!done, `${name} corpse still present at 1.9s`);
  mob.dispose();
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
