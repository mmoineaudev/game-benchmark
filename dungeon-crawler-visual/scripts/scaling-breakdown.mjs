// Compute every scaling axis for the balance-pass breakdown tables.
// Run: node scripts/scaling-breakdown.mjs
import { PLAYER, ENEMY, BOSS, EVOLUTION, SWORD, ORB_WEAPON, DROP,
  orbDamageMultiplier, orbDamage, weaponTier, swordHitDamage, swordSizeScale,
  attackSpeedFromSouls, enemyHpMultiplier } from '../src/core/Constants.js';

const souls = [0, 100, 200, 300, 500, 1000];
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, ''));

// Sword damageMult = size part × tier part × level part
const dmgMult = (tier, level, scale) =>
  (1 + (scale - 1) * 0.5) * Math.pow(1.1, tier) * Math.pow(1.1, Math.floor(level / 5));

// Boss HP: base 90 × NG+ × level × wealth/hearts stack (excess halved)
const bossHp = (ng, level, s, hearts) => {
  const base = 4 * BOSS.HP_MULT * (1 + ENEMY.HP_PER_NG * ng) * (1 + Math.floor(level / 10));
  const soulsBonus = BOSS.SOULS_HP_BONUS * Math.floor(s / BOSS.SOULS_HP_PER);
  const stack = (1 + soulsBonus) * Math.pow(1 + BOSS.HEARTS_HP_BONUS, hearts);
  return Math.ceil(base * (1 + (stack - 1) / 2));
};

console.log('== SOULS AXIS (level 1, NG+0, 0 boss kills -> 0 hearts) ==');
console.log('souls | tier | size | dmgMult | hit1 | hit3 | orbDmg | spawnMult | slots | mobHP x | bossHP');
for (const s of souls) {
  const t = weaponTier(s);
  const scale = swordSizeScale(t);
  const dm = dmgMult(t, 1, scale);
  const h1 = (2 + t) * dm, h3 = (3 + t) * dm;
  const spawnMult = Math.min(1 + (1 + s) / 10, ENEMY.SPAWN_CAP);
  const slots = Math.min(Math.round((ENEMY.BASE_SLOTS + 0) * spawnMult), ENEMY.MAX_ALIVE);
  const hp = enemyHpMultiplier(0, 1, s);
  console.log(`${s} | T${t} | x${fmt(scale)} | x${fmt(dm)} | ${fmt(h1)} | ${fmt(h3)} | ${fmt(orbDamage(s))} | x${fmt(spawnMult)} | ${slots} | x${fmt(hp)} | ${bossHp(0, 1, s, 0)}`);
}

console.log('\n== LEVEL AXIS (0 souls, NG+0, 0 boss kills) ==');
console.log('lvl | mobHP x | moveSpeed x | atkSpeed x | dmgMult(T0) | spawnMult | slots');
for (const L of [1, 5, 10, 15, 20, 30, 40, 50]) {
  const hp = enemyHpMultiplier(0, L, 0);
  const mv = 1 + ENEMY.SPEED_PER_LEVEL * (L - 1);
  const atk = 1 + 0.05 * Math.floor((L - 1) / 3);
  const dm = dmgMult(0, L, 1);
  const spawnMult = Math.min(1 + L / 10, ENEMY.SPAWN_CAP);
  const slots = Math.min(Math.round((ENEMY.BASE_SLOTS + (L - 1) * ENEMY.SLOTS_PER_LEVEL) * spawnMult), ENEMY.MAX_ALIVE);
  console.log(`${L} | x${fmt(hp)} | x${fmt(mv)} | x${fmt(atk)} | x${fmt(dm)} | x${fmt(spawnMult)} | ${slots}`);
}

console.log('\n== NG+ AXIS (level 1, 0 souls, 0 hearts) ==');
for (const n of [0, 1, 2, 3]) {
  const hp = enemyHpMultiplier(n, 1, 0);
  const boss = bossHp(n, 1, 0, 0);
  console.log(`NG+${n}: mobHP x${fmt(hp)} | bossHP ${boss}`);
}

console.log('\n== BOSS HP vs souls/hearts (NG+0, level 1) ==');
console.log('hearts\\souls | 0 | 100 | 300 | 1000');
for (const h of [0, 3, 5, 10]) {
  const row = [0, 100, 300, 1000].map((s) => bossHp(0, 1, s, h));
  console.log(`  ${h} hearts | ${row.join(' | ')}`);
}

console.log('\n== Sword attack speed (souls × buff) ==');
console.log('souls | base | ×EMPOWERED(1.2) | ×GODSPEED(1.5)');
for (const s of [0, 100, 250, 500, 1000]) {
  const b = attackSpeedFromSouls(s);
  console.log(`${s} | x${fmt(b)} | x${fmt(b * 1.2)} | x${fmt(b * 1.5)}`);
}

console.log('\n== T5 @ level 40, 1000 souls (endgame reference) ==');
const t5 = weaponTier(1000);
const dm5 = dmgMult(t5, 40, swordSizeScale(t5));
console.log(`hit1 = ${fmt((2 + t5) * dm5)} | arc bolt = ${fmt(orbDamage(1000))} | blast = ${fmt(5 * orbDamage(1000))} @20u | atkSpeed x${fmt(attackSpeedFromSouls(1000))}`);

console.log('\n== Max hearts / heal (unchanged, flat) ==');
console.log(`max hearts ${PLAYER.MAX_HEALTH}+bossKills | regen +${PLAYER.REGEN_AMOUNT}/every ${PLAYER.REGEN_INTERVAL}s | pickup +${DROP.HEALTH_RESTORE} (${DROP.HEALTH_CHANCE * 100}%/kill)`);
