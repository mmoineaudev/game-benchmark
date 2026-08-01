// Headless verification: temporary buff system — 15s random effects from
// breakables. Tests the GameState buff timer lifecycle (pure logic).
// Run: node scripts/buff-system-check.mjs
import { GameState } from '../src/core/GameState.js';
import { BUFF } from '../src/core/Constants.js';

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

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
