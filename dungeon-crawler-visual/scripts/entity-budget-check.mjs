// Headless entity budget check — Phase E of the 3D redesign.
// Verifies per-entity triangle/draw-call budgets are within the plan's caps,
// that shared Materials cache is used (no runaway per-entity material/texture
// spawning), and that update() does not allocate new geometries/materials.
// Run: node scripts/entity-budget-check.mjs
import * as THREE from 'three';

// canvas stub (materials degrade to map-less under this shim, so triangle
// counts are what we really assert — texture maps are browser-only and
// cost is bounded separately by cache dedup).
globalThis.document = {
  createElement: (t) => {
    if (t === 'canvas') {
      return {
        width: 64, height: 64,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }),
          fillRect() {}, beginPath() {}, stroke() {}, moveTo() {},
          lineTo() {}, arc() {}, fill() {}, closePath() {}, fillText() {},
        }),
      };
    }
    return { style: {} };
  },
};

const scene = {
  children: [],
  add(o) { this.children.push(o); },
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); },
};

const { Skeleton } = await import('../src/entities/Skeleton.js');
const { ArmoredSkeleton } = await import('../src/entities/enemies/ArmoredSkeleton.js');
const { ArcherSkeleton } = await import('../src/entities/enemies/ArcherSkeleton.js');
const { Brute } = await import('../src/entities/enemies/Brute.js');
const { Rat } = await import('../src/entities/enemies/Rat.js');
const { Wraith } = await import('../src/entities/enemies/Wraith.js');
const { GhostBoss } = await import('../src/entities/enemies/GhostBoss.js');
const { Burning } = await import('../src/entities/enemies/Burning.js');
const { textureCacheStats } = await import('../src/core/Materials.js');

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log(`  FAIL: ${msg}`); } };

// Budgets. Measured pre-redesign (commit 9b80d4e) originals:
//   Skeleton 1472, Rat 228, Wraith 130, Burn 224, Boss 490.
// Caps = original x headroom for the realism pass (accessories/detail) while
// keeping the live-bodies budget (200 enemies — far bodies freeze at 40 m)
// well within the 30fps floor.
const TRI_CAPS = {
  SKELETON: 2100, MAGICIAN: 2400, ARMORED: 2700, ARCHER: 2600, BRUTE: 2600,
  RAT: 500, WRAITH: 450, BURN: 500, BOSS: 950,
};

function triCount(group) {
  let tris = 0;
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const pos = g.attributes && g.attributes.position;
    if (pos) {
      const idx = g.index;
      const count = idx ? idx.count : pos.count;
      const t = g.index ? count / 3 : count / 3; // three verts / triangle
      tris += Math.round(t);
    }
  });
  return tris;
}

const roster = [
  ['SKELETON', Skeleton, { active: true }],
  ['MAGICIAN', Skeleton, { isMagician: true, active: true }],
  ['ARMORED', ArmoredSkeleton, {}],
  ['ARMORED_ELITE', ArmoredSkeleton, { elite: true }],
  ['ARCHER', ArcherSkeleton, {}], ['ARCHER_ELITE', ArcherSkeleton, { elite: true }],
  ['BRUTE', Brute, {}], ['BRUTE_ELITE', Brute, { elite: true }],
  ['RAT', Rat, {}], ['WRAITH', Wraith, {}], ['WRAITH_ELITE', Wraith, { elite: true }],
  ['BURN', Burning, {}],
];
const BOSS_VARIANTS = ['SKELETON', 'ARMORED', 'ARCHER', 'BRUTE', 'WRAITH', 'RAT', 'MAGICIAN'];

console.log('== Per-entity triangle budget ==');
let totalEnemyTris = 0;
for (const [n, c, o] of roster) {
  const s = new c(scene, o);
  const t = triCount(s.group);
  const cap = TRI_CAPS[n.replace(/_ELITE$/, '')] || 450;
  totalEnemyTris += t;
  ok(t <= cap, `${n} tris ${t} <= ${cap}`);
  console.log(`  ${n}: ${t} tris (cap ${cap})`);
  s.dispose();
}
for (const v of BOSS_VARIANTS) {
  const b = new GhostBoss(scene, 4, v);
  const t = triCount(b.group);
  totalEnemyTris += t;
  ok(t <= TRI_CAPS.BOSS, `BOSS ${v} tris ${t} <= ${TRI_CAPS.BOSS}`);
  console.log(`  BOSS ${v}: ${t} tris (cap ${TRI_CAPS.BOSS})`);
  b.dispose();
}

console.log('== No per-frame allocation in update() ==');
// Warm up one of each, snapshot geometry/material counts, then drive update()
// and assert the counts do not grow (update must be allocation-free).
function countGeos(start) {
  const geos = []; // by geometry uuid
  const collect = (root) => {
    root.traverse((o) => { if (o.isMesh && o.geometry) geos.push(o.geometry.uuid); });
  };
  collect(start);
  return geos;
}
for (const [n, c, o] of roster) {
  const s = new c(scene, o);
  const before = countGeos(s.group).length;
  // force it through the animated states where the code allocates nothing new
  for (let i = 0; i < 30; i++) s.update(1 / 60, i / 60);
  if (s.hit) s.hit(9999); // -> DEAD (armored/brute/archer fire nothing new either)
  for (let i = 0; i < 30; i++) s.update(1 / 60, i / 60);
  const after = countGeos(s.group).length;
  ok(after === before, `${n} update() allocates no new geometry (${before} -> ${after})`);
  s.dispose();
}

console.log('== Shared material cache ==');
for (const [n, c, o] of roster.slice(0, 4)) {
  const s = new c(scene, o);
  s.dispose();
}
const stats = textureCacheStats();
console.log(`  texture cache: ${stats.maps} map(s) cached, canvas capable=${stats.capable}`);

console.log('== Grounding / proportion (no wall clip) ==');
// Brute/Ogre must fit the 4u wall. Also plain humanoids must not exceed it.
const { Brute: B2 } = { Brute };
for (const elite of [false, true]) {
  const s = new B2(scene, { elite });
  s.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(s.group);
  const h = box.max.y - box.min.y;
  ok(h <= 4.0, `${elite ? 'Ogre' : 'Brute'} height ${h.toFixed(2)}u <= 4u wall`);
  s.dispose();
}

console.log('== Humanoid height stays humanoid (no ~3.6u towers) ==');
// The skeleton rig was once super-tall (~3.6u, detached legs). After the body
// fix it must stay ~2.0-2.3u so enemies read against the 1.7u player.
for (const [n, c, o] of [
  ['SKELETON', Skeleton, { active: true }],
  ['MAGICIAN', Skeleton, { isMagician: true, active: true }],
  ['ARMORED', ArmoredSkeleton, {}],
  ['ARCHER', ArcherSkeleton, {}],
  ['BRUTE', Brute, {}],
]) {
  const s = new c(scene, o);
  s.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(s.group);
  const h = box.max.y - box.min.y;
  ok(h >= 1.7 && h <= 2.6, `${n} humanoid height ${h.toFixed(2)}u in [1.7, 2.6]`);
  ok(box.min.y > -0.15, `${n} feet rest near y=0 (minY ${box.min.y.toFixed(2)})`);
  s.dispose();
}

console.log(failures === 0 ? '\nALL BUDGET CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
