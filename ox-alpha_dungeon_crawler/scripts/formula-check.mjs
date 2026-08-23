// formula-check.mjs — pure-function gates over the data contract (§24 lean v2)
import {
  EVOLUTION, weaponTier, swordHitDamage, swordSizeScale, totalSwordScale,
  attackSpeedFromSouls, orbDamageMultiplier, orbDirectDamage, orbExplodeDamage,
  bossHp, burnHp, enemyHpMultiplier, ENEMY_SPAWN_WEIGHTS, ROOM_TYPES,
  BIOME_ROOM_MODIFIERS, BIOME_SEQUENCE, BOSS, MAX_TOTAL_SCALE, ORB_WEAPON, SWORD
} from '../src/core/Constants.js';

let fails = 0;
function gate(name, cond) {
  if (!cond) { console.log(`FAIL: ${name}`); fails++; }
}

// tier thresholds + ceiling table
gate('thresholds', JSON.stringify(EVOLUTION.TIER_THRESHOLDS) === JSON.stringify([50, 100, 200, 400, 800]));
const soulsTable = [0, 49, 50, 99, 100, 199, 200, 399, 400, 799, 800];
const expectT = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5];
soulsTable.forEach((s, i) => gate(`tier(${s})=${expectT[i]}`, weaponTier(s) === expectT[i]));

// sword damage ladder
for (let t = 0; t <= 5; t++) {
  const exp = [2 + t, 2 + t, 3 + t];
  gate(`damage ladder T${t}`, swordHitDamage(0, t) === exp[0] && swordHitDamage(1, t) === exp[1] && swordHitDamage(2, t) === exp[2]);
}
// brute breakpoint: HP8 dies in exactly 2 hits at T5 raw (7+... base 7? step damage 2+t=7)
gate('brute 2 hits at T5', Math.ceil(8 / swordHitDamage(0, 5)) === 2);
gate('armored 1 hit at T3', Math.ceil(5 / swordHitDamage(0, 3)) === 1);

// size ladder
gate('swordSizeScale T0=1', swordSizeScale(0) === 1);
gate('swordSizeScale T5=5', swordSizeScale(5) === 5);
gate('scale clamp ≥5', totalSwordScale(5) >= 5 && totalSwordScale(5, 10) === MAX_TOTAL_SCALE);

// attack speed
gate('attackSpeedFromSouls(1000)=2', attackSpeedFromSouls(1000) === 2);

// orb economy
gate('orbMult(100)=3', orbDamageMultiplier(100) === 3);
gate('orbMult(1000)=21', orbDamageMultiplier(1000) === 21);
gate('direct 100→6', orbDirectDamage(100) === 6);
gate('direct 1000→42', orbDirectDamage(1000) === 42);
gate('explosion 5@2u', ORB_WEAPON.EXPLODE_DAMAGE === 5 && ORB_WEAPON.EXPLODE_RADIUS === 2);

// electric
gate('electric chance/range/mult', SWORD.ELECTRIC_CHANCE === 0.05 && SWORD.ELECTRIC_RANGE === 20 && SWORD.ELECTRIC_DAMAGE_MULT === 5);

// boss HP gates (§17 examples at level 7 / NG0)
gate('boss base 90', bossHp(7, 0, 0, 3) === 90);
gate('boss 49 souls → 90', bossHp(7, 0, 49, 3) === 90);
gate('boss 100 souls → 113', bossHp(7, 0, 100, 3) === 113);
gate('boss 300 souls → 158', bossHp(7, 0, 300, 3) === 158);
gate('boss 5 hearts (+5 past base → 118)', bossHp(7, 0, 0, 8) === 118);
gate('boss 100 souls + 5 hearts → 154', bossHp(7, 0, 100, 8) === 154);

// BOSS constants
gate('BOSS constants', BOSS.INTERVAL === 7 && BOSS.HP_MULT === 22.5 && BOSS.MAX_MINIONS === 25 && BOSS.CHARGE_DMG === 2);

// BURN — v2 ruling: 30 flat on NG0
gate('burn NG0 = 30', burnHp(0) === 30);
gate('burn NG1 = 120', burnHp(1) === 120);

// spawn weights sum to exactly 100 with 7 entries
for (const [biome, w] of Object.entries(ENEMY_SPAWN_WEIGHTS)) {
  const vals = Object.values(w);
  const sum = vals.reduce((a, b) => a + b, 0);
  gate(`weights ${biome} sum 100`, vals.length === 7 && sum === 100);
}

// per-biome eligible room weight ≥ 100 (design invariant §5.3)
for (const biome of [...BIOME_SEQUENCE, 'SPECTRAL_COURT']) {
  let eligibleSum = 0;
  for (const rt of ROOM_TYPES) {
    if (rt.biomes !== 'all' && !rt.biomes.includes(biome)) continue;
    eligibleSum += rt.weight * ((BIOME_ROOM_MODIFIERS[biome] || {})[rt.id] ?? 1);
  }
  if (biome !== 'SPECTRAL_COURT') gate(`eligible weight ${biome} ≥ 100`, eligibleSum >= 100);
}

// every room type has PROPS_PER_ROOM entry (imported lazily to avoid three.js)
const { PROPS } = await import('../src/core/Constants.js');
for (const rt of ROOM_TYPES) gate(`props ${rt.id}`, Array.isArray(PROPS.PROPS_PER_ROOM[rt.id]));

// overflow term is LINEAR: 1 + 1.5·k grows by exactly 1.5 per 10 excess
const ovf = k => 1 + 1.5 * k;
const t1 = enemyHpMultiplier(0, 1, 989) / (1 + Math.floor(1 / 10));   // isolate: /level-term
gate('overflow linear step', true); // verified below via direct term extraction
function overflowTerm(level, souls) {
  return enemyHpMultiplier(0, level, souls) / (1 + Math.floor(level / 10)); // remove level term
}
const o1 = overflowTerm(1, 990);   // excess 0   → 1
const o2 = overflowTerm(1, 1000);  // excess 10  → 2.5
const o3 = overflowTerm(1, 1010);  // excess 20  → 4
gate('overflow linear (+150%/10)', o1 === 1 && Math.abs(o2 - 2.5) < 1e-9 && Math.abs(o3 - 4) < 1e-9);
gate('NG+ ×4 at cycle 1', enemyHpMultiplier(1, 1, 0) === 4);

console.log(fails === 0 ? 'formula-check: ALL GATES PASS' : `formula-check: ${fails} FAILURES`);
process.exit(fails ? 1 : 0);
