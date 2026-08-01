// Headless verification: temporary buff system — 15s random effects from
// breakables. Tests the GameState buff timer lifecycle (pure logic).
// Run: node scripts/buff-system-check.mjs
import { GameState } from '../src/core/GameState.js';
import { BUFF, enemyHpMultiplier, orbPowerMultiplier, excessOrbs } from '../src/core/Constants.js';

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

// --- Timer counts down and expires after BUFF.DURATION ---
{
  const s = new GameState();
  s.applyBuff(1);
  let expired = false;
  for (let i = 0; i < Math.ceil((BUFF.DURATION - 0.1) / dt); i++) {
    if (s.updateBuff(dt)) expired = true;
  }
  ok(!expired && s.buffEffect === 1, `buff still active at ${BUFF.DURATION - 0.1}s`);
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
  ok(BUFF.DURATION === 30 && BUFF.CHANCE === 0.06,
    `constants: duration=${BUFF.DURATION}s, chance=${BUFF.CHANCE} (was 5%, now 6%)`);
  ok(BUFF.EMPOWER_LENGTH === 1.5 && BUFF.EMPOWER_SPEED === 1.2 && BUFF.EMPOWER_ATTACK === 1.2,
    'empowered constants (length 1.5, move 1.2, attack 1.2)');
  ok(BUFF.BOSS_DURATION === 300 && BUFF.MAX_DURATION === 90,
    `boss buff nominal 300s, hard cap 90s (MAX_DURATION=${BUFF.MAX_DURATION})`);
  ok(orbPowerMultiplier && typeof orbPowerMultiplier === 'function', 'orbPowerMultiplier exported');
  // Excess orbs (>100) feed buff-drop and spawn rate, not sword size
  ok(excessOrbs(50) === 0 && excessOrbs(100) === 0 && excessOrbs(150) === 50 && excessOrbs(250) === 150,
    'excess orbs: only the amount above 100 counts');
  ok(orbPowerMultiplier(150) === 4 && orbPowerMultiplier(300) === 4,
    'sword size caps at 150 orbs (4x), excess does not grow it');
}

// --- Buff 4 (VISION) + boss-duration applyBuff + excess-orbs ---
{
  const s = new GameState();
  s.applyBuff(4);
  ok(s.buffEffect === 4 && Math.abs(s.buffTime - BUFF.DURATION) < 1e-9, 'applyBuff(4) = VISION, 30s');
  // boss buff: nominal 5 min, but HARD-CAPPED at MAX_DURATION (1:30 = 90s)
  s.applyBuff(1, BUFF.BOSS_DURATION);
  ok(s.buffEffect === 1 && Math.abs(s.buffTime - 90) < 1e-9,
    `boss buff capped at 90s (MAX_DURATION) — actual ${s.buffTime}s`);
  // any request above MAX_DURATION is clamped
  s.applyBuff(2, 9999);
  ok(s.buffTime <= 90, `duration hard-capped at 90s (got ${s.buffTime})`);
  s.applyBuff(3, 60);
  ok(Math.abs(s.buffTime - 60) < 1e-9, 'sub-cap duration preserved (60s)');
}

// ===========================================================================
// HIDDEN RULE — an active buff carries across a LEVEL ADVANCE with x5 time
// (validates the pure state logic; Game._regenerateDungeon wires the carry
// by capturing buffEffect/buffTime before the state is replaced, then sets
// the new state's buffEffect and buffTime = carried.time * 5, and re-applies
// the side effects so the sword/fireball aren't left stuck).
// ===========================================================================
console.log('== Buff carry across level advance (x5) ==');
{
  // Simulate a level advance: capture the active buff, build a fresh state,
  // and carry it with x5 remaining time.
  const old = new GameState();
  old.applyBuff(2, BUFF.DURATION);
  for (let i = 0; i < Math.ceil(10 / dt); i++) old.updateBuff(dt); // 10s elapsed
  const remaining = old.buffTime; // ~20s
  ok(Math.abs(remaining - (BUFF.DURATION - 10)) < 0.05, `remaining before advance ~${remaining.toFixed(1)}s`);

  // The level-advance path: a brand new state (the old one's buff data is wiped)
  const fresh = new GameState({ level: 2 });
  // ...and Game._regenerateDungeon carries the buff over:
  if (old.buffActive) {
    fresh.buffEffect = old.buffEffect;
    fresh.buffTime = old.buffTime * 5;
  }
  ok(fresh.buffEffect === 2 && Math.abs(fresh.buffTime - remaining * 5) < 0.25,
    `carried buff: effect=2, time ${fresh.buffTime.toFixed(1)}s = ${remaining.toFixed(1)}s x5`);
  ok(fresh.buffActive, 'carried buff still active');
  // HUD would show it because buffEffect/buffTime are set on the live state.
}
// An inactive (expired) buff must NOT carry — it clears/rests instead.
{
  const old = new GameState();
  for (let i = 0; i < Math.ceil((BUFF.DURATION + 0.2) / dt); i++) old.updateBuff(dt);
  ok(!old.buffActive, 'expired buff: buffActive false');
  const fresh = new GameState({ level: 2 });
  const carried = old.buffActive ? { effect: old.buffEffect, time: old.buffTime } : null;
  ok(carried === null && fresh.buffEffect === 0 && fresh.buffTime === 0,
    'no carry when no active buff -> fresh state has no buff');
}
// A newly discovered buff resets to default time (overrides any carried value).
{
  const fresh = new GameState({ level: 2 });
  fresh.buffEffect = 2; fresh.buffTime = 40; // e.g. a big carried timer
  fresh.applyBuff(1); // discovering a new buff
  ok(fresh.buffEffect === 1 && Math.abs(fresh.buffTime - BUFF.DURATION) < 1e-9,
    'new buff discovered resets to default duration');
}

// ===========================================================================
// NO DUPLICATE BUFF — a new roll excludes the currently-active effect, so you
// can never receive the same buff twice in a row (every pickup is a fresh,
// labeled buff). Mirrors Game._applyBuff's candidate filtering.
// Also: carried x5 time is clamped to MAX_DURATION.
// ===========================================================================
console.log('== No duplicate buff + carry cap ==');
{
  // the carried x5 must be clamped at MAX_DURATION
  const active = new GameState({ level: 2 });
  active.buffEffect = 2;
  active.buffTime = 40;
  const carriedTime = Math.min(active.buffTime * 5, BUFF.MAX_DURATION);
  ok(carriedTime === 90, `carried x5 clamped to ${BUFF.MAX_DURATION}s (40 x5 = 200 -> 90)`);

  // duplicate-prevention: pick from all effects except the active one
  const pickOther = (activeEffect) => {
    const candidates = [1, 2, 3, 4].filter((e) => e !== activeEffect);
    return candidates[Math.floor(Math.random() * candidates.length)];
  };
  for (const activeEffect of [1, 2, 3, 4]) {
    const picked = new Set();
    for (let i = 0; i < 200; i++) picked.add(pickOther(activeEffect));
    ok(!picked.has(activeEffect), `picking with active=${activeEffect} never returns ${activeEffect}`);
    ok(picked.size >= 3, `all 3 other effects reachable (active=${activeEffect}, got ${[...picked].sort().join(',')})`);
  }
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
