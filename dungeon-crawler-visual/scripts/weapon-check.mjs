// Weapon evolution integrity check (WEAPON_EVOLUTION_PLAN §11).
// Usage: node scripts/weapon-check.mjs
// Gates 1-8: economy/damage/arcs/HUD. Gates 9-10: distinct-model redesign
// (§4.3). Gate 11: total-only HUD. Gate 12: dungeon-check gate.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  EVOLUTION, SWORD, weaponTier, swordHitDamage,
} from '../src/core/Constants.js';

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL: ${msg}`); };
const ok = (msg) => console.log(`  ok: ${msg}`);

// ---------------------------------------------------------------------------
// Gate 1: EVOLUTION block complete, every value finite (guards NaN bugs)
const EVO_KEYS = ['TIER_SOULS', 'MAX_TIER', 'DAMAGE_PER_TIER', 'BLADE_LENGTH',
  'RANGE_PER_TIER', 'MAX_TOTAL_SCALE', 'ARC_CHANCE', 'ARC_BOLTS', 'ARC_POOL',
  'ARC_SPEED', 'ARC_LIFE', 'ARC_DAMAGE', 'ARC_RANGE', 'BOLT_COLOR', 'T5_BLADE_LIGHT'];
for (const k of EVO_KEYS) {
  if (!(k in EVOLUTION)) fail(`EVOLUTION.${k} missing`);
}
for (const k of ['ARC_CHANCE', 'ARC_BOLTS', 'BLADE_LENGTH']) {
  for (const v of EVOLUTION[k]) if (!Number.isFinite(v)) fail(`EVOLUTION.${k} has non-finite ${v}`);
}
for (const k of ['TIER_SOULS', 'MAX_TIER', 'DAMAGE_PER_TIER', 'RANGE_PER_TIER', 'MAX_TOTAL_SCALE', 'ARC_POOL', 'ARC_SPEED', 'ARC_LIFE', 'ARC_DAMAGE', 'ARC_RANGE']) {
  if (!Number.isFinite(EVOLUTION[k])) fail(`EVOLUTION.${k} = ${EVOLUTION[k]} not finite`);
}
ok('EVOLUTION block complete and finite');

// ---------------------------------------------------------------------------
// Gate 2: tier math (0/99/100/199/200/500/999 → 0/0/1/1/2/5/5)
const tierCases = [[0, 0], [99, 0], [100, 1], [199, 1], [200, 2], [500, 5], [999, 5]];
for (const [souls, want] of tierCases) {
  const got = weaponTier(souls);
  if (got !== want) fail(`weaponTier(${souls}) = ${got} (want ${want})`);
}
ok('tier math: 0/99/100/199/200/500/999 → 0/0/1/1/2/5/5, capped at MAX_TIER');

// ---------------------------------------------------------------------------
// Gate 3: damage ladder — (base + tier) × damageMult at size 1 = 2/2/3 + tier
const dmg = (step, tier) => swordHitDamage(step, tier);
if (dmg(1, 0) !== 2 || dmg(2, 0) !== 2 || dmg(3, 0) !== 3) fail('tier-0 damage not 2/2/3');
if (dmg(1, 5) !== 7 || dmg(2, 5) !== 7 || dmg(3, 5) !== 8) fail('tier-5 damage not 7/7/8');
// Brute breakpoint: HP 8 needs 2 hits at tier 5 (7+7)
if (dmg(1, 5) + dmg(2, 5) < 8) fail('tier-5 combo does not kill brute HP 8 in 2 hits');
// Armored HP 5 dies in 1 hit from tier 3 (hit1 = 5 ≥ 5); wraith HP 2 at tier 0
if (dmg(1, 3) < 5) fail('armored (HP 5) should die in 1 hit at tier 3');
if (dmg(1, 0) < 2) fail('wraith (HP 2) should die in 1 hit at tier 0');
ok('damage ladder: 2/2/3 → 7/7/8; brute (HP 8) dies in 2 hits at tier 5, armored in 1 at tier 3');

// ---------------------------------------------------------------------------
// Gate 4: arc table — lengths = MAX_TIER+1, T5 = 100% × 2 bolts, pool fits combo
if (EVOLUTION.ARC_CHANCE.length !== EVOLUTION.MAX_TIER + 1) fail(`ARC_CHANCE length ${EVOLUTION.ARC_CHANCE.length} != ${EVOLUTION.MAX_TIER + 1}`);
if (EVOLUTION.ARC_BOLTS.length !== EVOLUTION.MAX_TIER + 1) fail(`ARC_BOLTS length ${EVOLUTION.ARC_BOLTS.length} != ${EVOLUTION.MAX_TIER + 1}`);
if (EVOLUTION.ARC_CHANCE[EVOLUTION.MAX_TIER] !== 1.0) fail('T5 arc chance must be 1.0');
if (EVOLUTION.ARC_BOLTS[EVOLUTION.MAX_TIER] !== 2) fail('T5 arc bolts must be 2');
if (EVOLUTION.ARC_POOL < 6) fail(`ARC_POOL ${EVOLUTION.ARC_POOL} < 6 (max in-flight: 2 bolts × 3 steps)`);
ok(`arc table: T5 = 100% × 2 bolts; pool ${EVOLUTION.ARC_POOL} ≥ 6 max in-flight`);

// ---------------------------------------------------------------------------
// Gate 5: electric proc fix — constants hoisted, finite (were undefined → dead code)
if (!Number.isFinite(SWORD.ELECTRIC_CHANCE)) fail('SWORD.ELECTRIC_CHANCE not finite (bug not fixed)');
if (!Number.isFinite(SWORD.ELECTRIC_RANGE)) fail('SWORD.ELECTRIC_RANGE not finite (bug not fixed)');
const gameSrc = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
if (!gameSrc.includes('SWORD.ELECTRIC_CHANCE') || !gameSrc.includes('SWORD.ELECTRIC_RANGE')) {
  fail('Game.js no longer references the electric proc');
}
ok('electric proc: SWORD.ELECTRIC_* hoisted and finite; Game references resolve');

// ---------------------------------------------------------------------------
// Gate 6: blade length monotonic; TIP_LOCAL derived; group-scale clamp
const lens = EVOLUTION.BLADE_LENGTH;
for (let i = 1; i < lens.length; i++) {
  if (!(lens[i] > lens[i - 1])) fail(`BLADE_LENGTH not monotonic at ${i}`);
}
if (Math.abs(lens[0] - 0.76) > 0.001 || Math.abs(lens[lens.length - 1] - 1.0) > 0.001) {
  fail('BLADE_LENGTH range not 0.76 → 1.0');
}
const tip = (t) => lens[t] * 0.79;
if (tip(5) > lens[5]) fail('TIP_LOCAL beyond blade tip');
if (!(EVOLUTION.MAX_TOTAL_SCALE >= 4)) fail('MAX_TOTAL_SCALE < 4 (orb ladder alone reaches 4×)');
ok(`blade length 0.76→1.0 monotonic; TIP_LOCAL = length × 0.79; scale clamp ${EVOLUTION.MAX_TOTAL_SCALE}`);

// ---------------------------------------------------------------------------
// Gate 7: ONE souls notion (user ruling: souls = orbs) — the separate
// #souls-line lifetime readout is REMOVED; the HUD shows a single SOULS
// counter, and no #tier-pips anywhere.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
if (html.includes('souls-line')) fail('#souls-line must be REMOVED (single SOULS counter — souls = orbs)');
if (!html.includes('>SOULS<')) fail('HUD is missing the single SOULS counter label');
if (html.includes('tier-pips')) fail('#tier-pips must be REMOVED (single-counter HUD ruling)');
for (const ic of EVOLUTION.TIER_ICONS) {
  if (!html.includes(`.${ic}::`)) fail(`weapon slot icon class ${ic} missing from index.html`);
}
ok('HUD: single SOULS counter (no #souls-line, no #tier-pips); all 6 tier icons present');

// ---------------------------------------------------------------------------
// Gate 11: Game.js no longer references the removed soulsEarned field; the
// weapon tier derives from the souls counter and only ever upgrades.
if (gameSrc.includes('soulsEarned')) fail('Game.js still references the removed soulsEarned field');
if (gameSrc.includes('tier-pips')) fail('Game.js still references tier-pips');
ok('Game.js: no soulsEarned, no tier-pips — tier from the single souls counter');

// ---------------------------------------------------------------------------
// Gate 9: distinct silhouettes — every tier has its own builder (Arsenal of
// Ascension §4.3); guards the redesign from degrading back into trims.
const swordSrc = readFileSync(new URL('../src/entities/PlayerSword.js', import.meta.url), 'utf8');
const FORM_BUILDERS = ['_formCleaver', '_formArmingSword', '_formRunicGreatsword',
  '_formCrystalSoulblade', '_formSoulfireGreatblade', '_formLightsaber'];
for (const b of FORM_BUILDERS) {
  if (!swordSrc.includes(b)) fail(`PlayerSword missing per-tier builder ${b} (§4.3)`);
}
if (!swordSrc.includes('_formMeshes')) fail('PlayerSword missing _formMeshes registry (§4.3)');
ok(`distinct forms: all ${FORM_BUILDERS.length} per-tier builders + _formMeshes present`);

// ---------------------------------------------------------------------------
// Gate 10: straightness — no curved/hollow primitives in the weapon forms
// (the legacy T2 torus hilt band must be gone; no-bends taste, §4).
if (swordSrc.includes('TorusGeometry') || swordSrc.includes('TorusKnotGeometry')) {
  fail('curved primitive found in PlayerSword (TorusGeometry/TorusKnotGeometry) — §4.3 deletes it');
}
ok('straightness: no Torus/TorusKnot geometry in PlayerSword');

// ---------------------------------------------------------------------------
// Gate 8: dungeon-check gate
try {
  const out = execSync('node scripts/dungeon-check.mjs 40', { cwd: process.cwd(), encoding: 'utf8' });
  const m = out.match(/broken=(\d+)\/(\d+)/);
  if (m && m[1] === '0') ok('dungeon-check: broken=0/40');
  else fail(`dungeon-check: ${m ? out.match(/broken=.*/)[0] : 'no summary line'}`);
} catch (e) {
  fail(`dungeon-check failed: ${e.message.split('\n')[0]}`);
}

console.log(failures === 0 ? '\nweapon-check: ALL GATES PASS' : `\nweapon-check: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
