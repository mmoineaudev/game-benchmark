// Headless verification: temporary buff system — 15s random effects from
// breakables. Tests the GameState buff timer lifecycle (pure logic).
// Run: node scripts/buff-system-check.mjs
import { GameState } from '../src/core/GameState.js';
import { BUFF, enemyHpMultiplier } from '../src/core/Constants.js';

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL: ${msg}`); };
const ok = (cond, msg) => { if (!cond) fail(msg); };
const dt = 1 / 60;

console.log('== Buff system (GameState timer) ==');

// --- Applying a buff sets effect + full duration ---
{
  const s = new GameState();
  ok(!s.buffActive, 'fresh state: no buff');
  s.applyBuff(2);
  ok(s.buffEffect === 2 && Math.abs(s.buffTime - BUFF.DURATION) < 1e-9,
    `applyBuff(2): effect=2, time=${s.buffTime.toFixed(1)}s (expected ${BUFF.DURATION})`);
  ok(s.buffActive, 'buffActive true after apply');
}

// --- Timer counts down and expires after 15s ---
{
  const s = new GameState();
  s.applyBuff(1);
  let expired = false;
  for (let i = 0; i < Math.ceil(14.9 / dt); i++) {
    if (s.updateBuff(dt)) expired = true;
  }
  ok(!expired && s.buffEffect === 1, 'buff still active at 14.9s');
  let expiryFired = false;
  for (let i = 0; i < Math.ceil(0.3 / dt); i++) {
    if (s.updateBuff(dt)) expiryFired = true;
  }
  ok(expiryFired, 'updateBuff reports expiry');
  ok(s.buffEffect === 0 && s.buffTime === 0 && !s.buffActive,
    'buff cleared after expiry');
  // post-expiry ticks are silent
  ok(!s.updateBuff(dt), 'no further expiry events after clearing');
}

// --- A new buff replaces an active one with a fresh timer ---
{
  const s = new GameState();
  s.applyBuff(3);
  for (let i = 0; i < Math.ceil(5 / dt); i++) s.updateBuff(dt); // 5s in
  ok(Math.abs(s.buffTime - (BUFF.DURATION - 5)) < 0.05, `5s elapsed (time=${s.buffTime.toFixed(1)})`);
  s.applyBuff(1); // replace mid-flight
  ok(s.buffEffect === 1 && Math.abs(s.buffTime - BUFF.DURATION) < 1e-9,
    'replacement resets effect + full duration');
}

// --- Constants sanity ---
{
  ok(BUFF.DURATION === 15 && BUFF.CHANCE === 0.05,
    `constants: duration=${BUFF.DURATION}s, chance=${BUFF.CHANCE}`);
  ok(BUFF.EMPOWER_LENGTH === 1.5 && BUFF.EMPOWER_SPEED === 1.2 && BUFF.EMPOWER_ATTACK === 1.2,
    'empowered constants (length 1.5, move 1.2, attack 1.2)');
}

// ===========================================================================
// NEW GAME+ — half-level restart with orbs kept, +10% enemy HP per cycle
// ===========================================================================
console.log('== New Game+ ==');
{
  const fresh = new GameState();
  ok(fresh.ngPlus === 0, 'fresh run starts at ngPlus 0');

  // NG+ from a level 7 death: floor(7/2) = 3, ngPlus 1, orbs carried
  const ng1 = new GameState({ level: Math.max(1, Math.floor(7 / 2)), collectedOrbs: 42, ngPlus: 1 });
  ok(ng1.level === 3 && ng1.collectedOrbs === 42 && ng1.ngPlus === 1,
    'NG+1 starts at level 3 with orbs carried');

  // Second NG+ cycle: +10% HP each
  ok(enemyHpMultiplier(0) === 1, 'no NG+ -> 100% enemy HP');
  ok(Math.abs(enemyHpMultiplier(1) - 1.1) < 1e-9, 'NG+1 -> 110% enemy HP');
  ok(Math.abs(enemyHpMultiplier(2) - 1.2) < 1e-9, 'NG+2 -> 120% enemy HP');
  ok(Math.abs(enemyHpMultiplier(5) - 1.5) < 1e-9, 'NG+5 -> 150% enemy HP');

  // Fresh restart resets everything
  const fresh2 = new GameState({ level: 1, collectedOrbs: 0, ngPlus: 0 });
  ok(fresh2.ngPlus === 0 && fresh2.collectedOrbs === 0 && fresh2.level === 1,
    'fresh restart: level 1, no orbs, ngPlus 0');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
