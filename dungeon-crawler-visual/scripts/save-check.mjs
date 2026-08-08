// Headless verification: save/load system — GameState serialization must
// preserve every run-meta field (level, orbs, souls, weapon tier, permanent
// hearts, NG+ cycle, boss kills, run time) while level-internal state resets
// so a load restarts the CURRENT level from the beginning.
// Run: node scripts/save-check.mjs
import { GameState } from '../src/core/GameState.js';
import { PLAYER } from '../src/core/Constants.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log(`  FAIL: ${msg}`); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${a}, want ${b})`);

console.log('== Save/load roundtrip ==');
{
  const s = new GameState({
    runTime: 234.5, level: 7, collectedOrbs: 42, ngPlus: 2,
    bossKills: 3, soulsEarned: 187, weaponTier: 4,
  });
  s.maxHealth = 6; // permanent hearts from 3 boss kills
  // level-internal noise that must NOT survive a load
  s.health = 1; s.safeSpawn = 4; s.buffEffect = 2; s.buffTime = 40; s.levelTime = 90;

  const json = s.toJSON();
  const back = GameState.fromJSON(json);

  eq(back.level, 7, 'level preserved');
  eq(back.collectedOrbs, 42, 'orbs preserved (no 10% penalty on load)');
  eq(back.ngPlus, 2, 'NG+ cycle preserved (no change on load)');
  eq(back.bossKills, 3, 'boss kills preserved');
  eq(back.soulsEarned, 187, 'souls preserved (sword ladder intact)');
  eq(back.weaponTier, 4, 'weapon tier preserved');
  eq(back.runTime, 234.5, 'total run time preserved');
  eq(back.maxHealth, 6, 'permanent hearts preserved');
  eq(back.health, 6, 'loaded level starts at FULL health');
  eq(back.levelTime, 0, 'level timer resets (restart of the level)');
  eq(back.buffEffect, 0, 'buff does not carry across a save-load');
  eq(back.safeSpawn, 0, 'spawn protection is re-armed by the level loader');
  ok(back.visitedCells.size === 0, 'level-internal state (visited cells) reset');
}

console.log('== Defaults ==');
{
  const fresh = GameState.fromJSON({});
  eq(fresh.level, 1, 'missing data -> level 1');
  eq(fresh.collectedOrbs, 0, 'missing data -> 0 orbs');
  eq(fresh.maxHealth, PLAYER.MAX_HEALTH, 'missing data -> base hearts');
  eq(fresh.ngPlus, 0, 'missing data -> ngPlus 0');
}

console.log('== Run-meta fields are the ONLY persisted fields ==');
{
  const s = new GameState({ level: 3, collectedOrbs: 9 });
  const keys = Object.keys(s.toJSON()).sort();
  ok(keys.join(',') === 'bossKills,collectedOrbs,level,maxHealth,ngPlus,runTime,soulsEarned,weaponTier',
    `toJSON exposes exactly the 8 run-meta fields (got: ${keys.join(',')})`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
