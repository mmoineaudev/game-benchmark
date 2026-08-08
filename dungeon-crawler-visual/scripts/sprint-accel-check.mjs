// Headless verification: sprint acceleration — +5% sprint speed per 1s of
// continuous sprinting, cumulative, reset when sprinting stops.
// Run: node scripts/sprint-accel-check.mjs
import { GameState } from '../src/core/GameState.js';
import { PLAYER } from '../src/core/Constants.js';

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL: ${msg}`); };
const ok = (cond, msg) => { if (!cond) fail(msg); };
const dt = 1 / 60;
const SEC = Math.round(1 / dt); // frames per simulated second (~60)
// A few extra frames per tier so float accumulation can't land just under
// the exact 1s boundary (real gameplay dt never hits exact multiples).
const TIER = (tiers) => (1 * tiers) * SEC + 3;

console.log('== Sprint acceleration ==');

// --- Base: no bonus before 1s ---
{
  const s = new GameState();
  ok(s.sprintSpeedMult === 1, `fresh state: mult 1 (got ${s.sprintSpeedMult})`);
  // 0.9s of continuous sprinting
  for (let i = 0; i < Math.floor(0.9 * SEC); i++) s.updateSprint(dt, true, true);
  ok(s.sprintTier === 0 && s.sprintSpeedMult === 1,
    `0.9s sprint: no tier yet (tier=${s.sprintTier}, mult=${s.sprintSpeedMult})`);
}

// --- +5% per 1s, cumulative ---
{
  const s = new GameState();
  for (let i = 0; i < TIER(1); i++) s.updateSprint(dt, true, true); // ~1s
  ok(s.sprintTier === 1 && Math.abs(s.sprintSpeedMult - 1.05) < 1e-9,
    `1s sprint: tier 1, mult 1.05 (tier=${s.sprintTier}, mult=${s.sprintSpeedMult.toFixed(2)})`);
  for (let i = 0; i < TIER(1); i++) s.updateSprint(dt, true, true); // ~2s
  ok(s.sprintTier === 2 && Math.abs(s.sprintSpeedMult - 1.10) < 1e-9,
    `2s sprint: tier 2, mult 1.10 (tier=${s.sprintTier}, mult=${s.sprintSpeedMult.toFixed(2)})`);
  for (let i = 0; i < TIER(1); i++) s.updateSprint(dt, true, true); // ~3s
  ok(s.sprintTier === 3 && Math.abs(s.sprintSpeedMult - 1.15) < 1e-9,
    `3s sprint: tier 3, mult 1.15 (tier=${s.sprintTier}, mult=${s.sprintSpeedMult.toFixed(2)})`);
}

// --- Reset when sprinting stops (Shift released) ---
{
  const s = new GameState();
  for (let i = 0; i < TIER(1); i++) s.updateSprint(dt, true, true); // tier 1
  s.updateSprint(dt, false, true); // release Shift
  ok(s.sprintTier === 0 && s.sprintHoldTime === 0 && s.sprintSpeedMult === 1,
    `release resets the bonus (tier=${s.sprintTier}, hold=${s.sprintHoldTime})`);
}

// --- No build-up while standing still (Shift held, no movement) ---
{
  const s = new GameState();
  for (let i = 0; i < TIER(1) + SEC; i++) s.updateSprint(dt, true, false);
  ok(s.sprintTier === 0 && s.sprintSpeedMult === 1,
    `standing still does not accumulate (tier=${s.sprintTier})`);
}

// --- Interrupted sprint does not carry time: 3s + release + 3s = 3 (not 6) ---
{
  const s = new GameState();
  for (let i = 0; i < TIER(3); i++) s.updateSprint(dt, true, true);
  s.updateSprint(dt, false, true); // stop
  ok(s.sprintTier === 0, `reset wipes 3 tiers (tier=${s.sprintTier})`);
  for (let i = 0; i < TIER(3); i++) s.updateSprint(dt, true, true);
  ok(s.sprintTier === 3, `fresh 3s sprint rebuilds 3 tiers, no carry (tier=${s.sprintTier})`);
}

// --- Constants sanity ---
{
  ok(PLAYER.SPRINT_ACCEL_WINDOW === 1 && PLAYER.SPRINT_ACCEL_STEP === 0.05,
    `constants: window=${PLAYER.SPRINT_ACCEL_WINDOW}s, step=${PLAYER.SPRINT_ACCEL_STEP}`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
