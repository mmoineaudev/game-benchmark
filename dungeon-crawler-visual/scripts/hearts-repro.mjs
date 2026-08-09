// Simulate the real save/load/NG+ flow to pinpoint the hearts bug.
import { GameState } from '../src/core/GameState.js';
import { PLAYER } from '../src/core/Constants.js';

const BASE = PLAYER.MAX_HEALTH; // 3

// --- Scenario: player killed 3 bosses, then died, saved at death screen ---
const state = new GameState({ level: 4, collectedOrbs: 500, ngPlus: 1, bossKills: 3, weaponTier: 2 });
state.maxHealth = BASE + 3; // 6 permanent hearts
state.health = 2;           // mid-fight value; at death it would be 0

console.log('== SAVE (death screen) ==');
const saveJson = JSON.stringify({ v: 1, savedAt: Date.now(), deathEntry: null, state: state.toJSON() });
console.log('  persisted fields:', JSON.stringify(state.toJSON()));

console.log('\n== LOAD (startup [L]) ==');
const loaded = GameState.fromJSON(JSON.parse(saveJson).state);
console.log(`  maxHealth: ${loaded.maxHealth} (want ${BASE + 3})  ->`, loaded.maxHealth === BASE + 3 ? 'OK' : '*** LOST ***');
console.log(`  health:    ${loaded.health} (load always starts full)`);

console.log('\n== NG+ (death screen [Y], fixed code) ==');
// _startNewRun(true) after the fix passes maxHealth explicitly:
const ngState = new GameState({
  level: Math.max(1, Math.floor(state.level / 2)),
  collectedOrbs: Math.floor(state.collectedOrbs * 0.25),
  ngPlus: (state.ngPlus || 0) + 1,
  bossKills: state.bossKills || 0,
  weaponTier: state.weaponTier || 0,
  maxHealth: BASE + 3, // carried from this._maxHealth
});
console.log(`  maxHealth: ${ngState.maxHealth} (want ${BASE + 3}, bossKills kept=${ngState.bossKills}) ->`, ngState.maxHealth === BASE + 3 ? 'OK' : '*** LOST ***');

console.log('\n== Level advance (fixed code) ==');
// _regenerateDungeon level-up path now carries maxHealth into the new state:
const nextLvl = new GameState({
  runTime: state.runTime, level: state.level + 1,
  collectedOrbs: state.collectedOrbs, ngPlus: state.ngPlus,
  bossKills: state.bossKills, weaponTier: state.weaponTier,
  maxHealth: BASE + 3,
});
console.log(`  state.maxHealth: ${nextLvl.maxHealth} (want ${BASE + 3}) ->`, nextLvl.maxHealth === BASE + 3 ? 'OK' : '*** DESYNC ***');

console.log('\n== Fresh run (death screen [N]) ==');
const fresh = new GameState({ level: 1, ngPlus: 0 });
console.log(`  maxHealth: ${fresh.maxHealth} (want ${BASE}) ->`, fresh.maxHealth === BASE ? 'OK' : 'unexpected');
