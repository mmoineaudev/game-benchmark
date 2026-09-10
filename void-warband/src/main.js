/**
 * main.js — P2/P4 entry point: flight + camera + starfield + weapons + FX
 * + enemies (drone / interceptor / rammer) + player damage.
 *
 * Systems are pushed to Game.systems in update order; InputSystem.update
 * runs LAST (it clears one-frame just-pressed flags, so it must come
 * after every system that reads them). FX.update runs right after
 * cameraRig.update so screen shake is applied post-CameraRig.
 *
 * P4 scope: EnemyManager (3 enemy types, steering, contact/shot/AoE
 * damage), DamageSystem (shield→hull, regen, death→DEATH), and a generic
 * targets list (dummies + live enemies) for projectile collision. Enemy→
 * player contact and enemy-projectile→player are routed into DamageSystem;
 * player-projectile→enemy hits route into Enemy.kill().
 *
 * Death restart (KeyR in DEATH) resets everything (SPEC §11).
 */
import * as THREE from 'three';
import Game from './core/Game.js';
import GameState, { GamePhase } from './core/GameState.js';
import { InputSystem } from './systems/InputSystem.js';
import { PerfProbe } from './utils/PerfProbe.js';
import { EventBus } from './core/EventBus.js';
import { PlayerShip } from './entities/PlayerShip.js';
import { Starfield } from './visuals/Starfield.js';
import { Sun } from './visuals/Sun.js';
import { BiomeVisuals } from './visuals/BiomeVisuals.js';
import { CameraRig } from './visuals/CameraRig.js';
import { WeaponSystem } from './systems/WeaponSystem.js';
import { FX } from './visuals/FX.js';
import { DummyTarget } from './entities/DummyTarget.js';
import { SECTORS } from './core/Constants.js';
import { ChunkManager } from './world/ChunkManager.js';
import { asteroidMat } from './world/SectorGenerator.js';
import { BREAKABLE_TYPES, buildBreakable } from './world/Breakables.js';
import { HazardSystem } from './world/HazardSystem.js';
import { EnemyManager } from './entities/EnemyManager.js';
import { DamageSystem } from './systems/DamageSystem.js';
import { LootSystem } from './systems/LootSystem.js';
import { HUD } from './ui/HUD.js';
import { TargetReticle } from './ui/TargetReticle.js';
import { Station } from './entities/Station.js';
import { BankingSystem } from './systems/BankingSystem.js';
import { HangarUI } from './ui/HangarUI.js';
import { DeathScreen } from './ui/DeathScreen.js';
import { CollectionLog } from './ui/CollectionLog.js';
import { TradeUI } from './ui/TradeUI.js';
import { PLAYER, FEEDBACK, ENEMIES, WARDEN_ARENA, HAZARDS } from './core/Constants.js';
import { saveMeta } from './core/Save.js';
import { isDestroyed, markDestroyed, flush as flushChunkDiffs } from './world/ChunkDiffs.js';

// Chunk-diff persistence: flush debounced writes when the tab is hidden or
// closed so destruction survives a crash/quit.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushChunkDiffs();
});
window.addEventListener('beforeunload', () => flushChunkDiffs());

// P8: Derelict Graveyard hulk (destructible wreck) stats, u / HP / dmg.
/** Hulk collision radius, u (big composite wreck). */
const _HULK_RADIUS = 30;
/** Hulk max HP (destructible, SPEC §5 sector 5). */
const _HULK_HP = 250;
/** Hulk contact damage to the player, points. */
const _HULK_CONTACT_DAMAGE = 15;
/** Hulk scrap drops on death, count (crate table, SPEC §6). */
const _HULK_DROP_COUNT = 3;

// Breakables (user feedback): 4 distinct destructible prop models — cargo
// container, pod cluster, satellite wreck, defense buoy — each with its own
// HP and loot bias (Breakables.js). Spawned from chunk 'breakable' descriptors.
const _BREAKABLE_LOOT_CHANCE = 0.65;
/** Breakable props registry (main-local). */
const _breakables = [];

// P3: deterministic world seed (same seed → same world, SPEC §5).
const WORLD_SEED = 1337;

// -- Instantiate ------------------------------------------------------------
const ship = new PlayerShip(Game.scene);
const chunkManager = new ChunkManager(Game.scene, WORLD_SEED);
// PERF (FIX #3): chunk unload → drop that chunk's hazards (crystals, storms,
// mines, death stars, black holes, worms) AND main-local chunk records
// (hulks / breakables / forge structures) materialized from its descriptors.
chunkManager._onChunkUnload = (chunkKey) => {
  hazardSystem.unloadChunk(chunkKey);
  for (let i = _hulks.length - 1; i >= 0; i--) {
    const h = _hulks[i];
    if (h.chunkKey !== chunkKey) continue;
    if (h.group && h.group.parent) h.group.parent.remove(h.group);
    _hulks.splice(i, 1);
  }
  for (let i = _breakables.length - 1; i >= 0; i--) {
    const b = _breakables[i];
    if (b.chunkKey !== chunkKey) continue;
    if (b.object && b.object.parent) b.object.parent.remove(b.object);
    _breakables.splice(i, 1);
  }
  for (let i = _forge.length - 1; i >= 0; i--) {
    const f = _forge[i];
    if (f.chunkKey !== chunkKey) continue;
    if (f.group && f.group.parent) f.group.parent.remove(f.group);
    _forge.splice(i, 1);
  }
};
const starfield = new Starfield(Game.scene);
// Sun at the world origin: distance reference + always-visible landmark.
const sun = new Sun(Game.scene);
// Per-sector atmosphere: bg/fog/star/rock/light blend on sector transitions.
const biomeVisuals = new BiomeVisuals(Game.scene, {
  starfield,
  asteroidMat,
  keyLight: Game.keyLight,
});
const cameraRig = new CameraRig(Game.camera);
const weapon = new WeaponSystem(Game.scene);
const fx = new FX(Game.camera);

// P2 test targets (SPEC P2: shoot/damage/destroy dummy).
const dummies = [
  new DummyTarget(Game.scene, new THREE.Vector3(120, 0, -300)),
  new DummyTarget(Game.scene, new THREE.Vector3(-200, 50, -500)),
  new DummyTarget(Game.scene, new THREE.Vector3(300, -30, -700)),
];

/** Collision radius bonus over the target radius, u (basic sphere check). */
const PROJECTILE_HIT_BONUS = 1;

// -- P5: loot + HUD --------------------------------------------------------
const lootSystem = new LootSystem(Game.scene);
const hud = new HUD();

// P8: Derelict Graveyard hulks — shared composite wreck (module-level shared
// geometry, SPEC §8: no unique materials on repeated classes).
const _hulkHullGeo = new THREE.IcosahedronGeometry(1, 1);
const _hulkSpireGeo = new THREE.CylinderGeometry(0.35, 0.55, 1, 6);
const _hulkMat = new THREE.MeshStandardMaterial({
  color: 0x2a2622,
  emissive: new THREE.Color(0x663300),
  emissiveIntensity: 0.25,
  flatShading: true,
  metalness: 0.6,
  roughness: 0.8,
});

/**
 * Build one hulk wreck: shared icosahedron hull + 3 shared spires, all
 * sharing _hulkMat (SPEC §11: no unique materials). Group origin = hulk
 * center; children carry the composite offsets.
 * @returns {THREE.Group}
 */
function _buildHulkMesh(rng) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(_hulkHullGeo, _hulkMat);
  hull.scale.set(1, 0.8, 1.3);
  hull.scale.multiplyScalar(18 + rng() * 10);
  hull.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
  g.add(hull);
  for (let i = 0; i < 3; i++) {
    const spire = new THREE.Mesh(_hulkSpireGeo, _hulkMat);
    const a = rng() * Math.PI * 2;
    const r = 14 + rng() * 10;
    spire.position.set(Math.cos(a) * r, (rng() - 0.5) * 12, Math.sin(a) * r);
    spire.scale.setScalar(8 + rng() * 10);
    spire.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    g.add(spire);
  }
  return g;
}

/**
 * Spawn a hulk wreck at worldPos (P8, SPEC §5 sector 5): destructible,
 * hp _HULK_HP; contact deals _HULK_CONTACT_DAMAGE to the player (gated by
 * the shared per-frame _playerHitGate); on death: burst + 3 scrap drops
 * via lootSystem.rollDrops('crate').
 * @param {THREE.Vector3} worldPos
 * @param {Function} rng seeded PRNG [0,1).
 */
function _spawnHulk(worldPos, rng, chunkKey, localId) {
  // Chunk-diff persistence (Minecraft-style): a hulk the player destroyed
  // stays destroyed when its chunk regenerates.
  if (isDestroyed(chunkKey, localId)) return null;
  const group = _buildHulkMesh(rng);
  group.position.copy(worldPos);
  Game.scene.add(group);
  const hulk = {
    group,
    position: worldPos.clone(),
    hp: _HULK_HP,
    alive: true,
    isHulk: true,
    chunkKey,
    localId,
  };
  _hulks.push(hulk);
  return hulk;
}

/**
 * Hulk death: burst FX + 3 scrap drops via lootSystem.rollDrops('crate')
 * (SPEC §6), remove the wreck from the scene (shared geo/mat: no dispose,
 * SPEC §11).
 * @param {object} h a hulk record from _hulks.
 */
function _destroyHulk(h) {
  if (!h.alive) return;
  h.alive = false;
  if (h.chunkKey !== undefined) markDestroyed(h.chunkKey, h.localId);
  fx.shake(8, 0.2);
  fx.spawn(h.position, 24, '#663300');
  for (let i = 0; i < _HULK_DROP_COUNT; i++) {
    const drops = lootSystem.rollDrops('crate', h.position, GameState.run.sector);
    for (const d of drops) lootSystem.spawnPickup(d.itemDef, h.position);
  }
  if (h.group && h.group.parent) h.group.parent.remove(h.group);
  const i = _hulks.indexOf(h);
  if (i !== -1) _hulks.splice(i, 1);
}

/**
 * Breakable prop death: burst FX + (65% chance) a crate-table loot drop.
 * Shared geo/mat: detach from the scene, no dispose.
 * @param {object} b a record from _breakables.
 */
function _destroyBreakable(b) {
  if (!b.alive) return;
  b.alive = false;
  if (b.chunkKey !== undefined) markDestroyed(b.chunkKey, b.localId);
  fx.shake(4, 0.15);
  fx.spawn(b.position, 18, '#fbbf24');
  if (Math.random() < _BREAKABLE_LOOT_CHANCE) {
    const drops = lootSystem.rollDrops(b.lootSource, b.position, GameState.run.sector);
    for (const d of drops) lootSystem.spawnPickup(d.itemDef, b.position);
  }
  if (b.object && b.object.parent) b.object.parent.remove(b.object);
  const i = _breakables.indexOf(b);
  if (i !== -1) _breakables.splice(i, 1);
}

/** P8: live hulk wrecks (main-local array, SPEC §5 sector 5). */
const _hulks = [];

// -- P9: THE FORGE (SPEC §5 sector 6): indestructible broken-megastructure
// decorations (big red-gold boxes/arcs). Like hulks they are a main-local
// array, but they have NO hp (indestructible) and bounce the player back
// instead of just dealing contact damage.
const _forgeBoxGeo = new THREE.BoxGeometry(1, 1, 1);
const _forgeArcGeo = new THREE.TorusGeometry(1, 1, 8, 12, Math.PI);
const _forgeMat = new THREE.MeshStandardMaterial({
  color: 0x4a2a08,
  emissive: new THREE.Color(0xff6a00),
  emissiveIntensity: 0.35,
  flatShading: true,
  metalness: 0.5,
  roughness: 0.7,
});
/** P9: live forge structures (main-local array, SPEC §5 sector 6). */
const _forge = [];
/** P9: player bounce impulse on forge structure contact, u/s. */
const _FORGE_BOUNCE_IMPULSE = 80;

/**
 * Build one broken megastructure composite (red-gold boxes + arcs), all
 * sharing _forgeMat (SPEC §11: no unique materials on repeated classes).
 * Group origin = structure center; children carry the composite offsets.
 * @param {Function} rng seeded PRNG [0,1).
 * @returns {THREE.Group}
 */
function _buildForgeStructureMesh(rng) {
  const g = new THREE.Group();
  const boxes = 2 + Math.floor(rng() * 3); // 2–4 big boxes
  for (let i = 0; i < boxes; i++) {
    const box = new THREE.Mesh(_forgeBoxGeo, _forgeMat);
    box.position.set(
      (rng() - 0.5) * 30,
      (rng() - 0.5) * 20,
      (rng() - 0.5) * 30,
    );
    box.scale.set(15 + rng() * 25, 8 + rng() * 22, 15 + rng() * 25);
    box.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    g.add(box);
  }
  const arcs = 1 + Math.floor(rng() * 2); // 1–2 broken arcs
  for (let i = 0; i < arcs; i++) {
    const arc = new THREE.Mesh(_forgeArcGeo, _forgeMat);
    arc.scale.setScalar(25 + rng() * 20);
    arc.position.set(
      (rng() - 0.5) * 25,
      (rng() - 0.5) * 15,
      (rng() - 0.5) * 25,
    );
    arc.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    g.add(arc);
  }
  return g;
}

/**
 * Spawn a forge megastructure at worldPos (P9, SPEC §5 sector 6):
 * INDESTRUCTIBLE; contact deals WARDEN_ARENA.structureCollisionDamage and
 * bounces the player back (impulse away from the structure center).
 * @param {THREE.Vector3} worldPos
 * @param {Function} rng seeded PRNG [0,1).
 */
function _spawnForgeStructure(worldPos, rng, chunkKey) {
  const group = _buildForgeStructureMesh(rng);
  group.position.copy(worldPos);
  Game.scene.add(group);
  _forge.push({
    group,
    position: worldPos.clone(),
    chunkKey,
  });
}

/** P9: warden arena spawn tracking (at most one live warden). */
let _wardenSpawned = false;

/** The live warden enemy (null when none), for the HUD boss HP bar. */
function _liveWarden() {
  for (const e of enemyManager.enemies) {
    if (e.typeKey === 'warden' && e.alive) return e;
  }
  return null;
}

// -- P6: stations + banking + hangar/death UI (SPEC §5, §7) ----------------
// One station near spawn (SPEC §5: stations enable bank/repair/extraction).
// Placed off the flight axis and further out so the launch view isn't filled
// by the station hull (player feedback: station dominated the spawn camera).
const stations = [new Station(Game.scene, new THREE.Vector3(90, 25, 3600))];
const banking = new BankingSystem();
const hangar = new HangarUI(GameState);
const deathScreen = new DeathScreen();
const collectionLog = new CollectionLog();
// Station trade menu (H near station): install ≤3 items / sell; pauses sim.
const tradeUI = new TradeUI();
// Close the trade menu with H / Escape / P. The flight loop is paused while
// the menu is open, so the per-frame justPressed checks never run — this
// direct listener is the only way back to the game.
// _tradeGuardT blocks an instant reopen: press flags accumulate while the
// sim is paused, and this listener runs BEFORE InputSystem's (it registers
// earlier), so consuming the flag here is undone by InputSystem re-adding
// it. The guard timestamp makes the flight loop ignore any press that
// arrived within 150 ms of a close.
let _tradeGuardT = 0;
window.addEventListener('keydown', (e) => {
  if (!tradeUI.visible) return;
  if (e.code === 'KeyH' || e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    tradeUI.hide();
    Game.paused = false;
    _tradeGuardT = performance.now() + 150;
  }
});

// P10: give Game a HUD reference so the pause/help menu (P / F1 / Escape)
// actually becomes visible — Game._hud was never assigned, so setPaused()
// was a silent no-op and the help panel never opened.
Game._hud = hud;
// Game consults this so the pause menu doesn't render under the trade menu.
Game._tradeOpen = () => tradeUI.visible;

// -- P4: player damage + enemies -------------------------------------------
// DamageSystem resolves hitPlayer (shield→hull) + shield regen; it owns the
// 0.75 s player-invuln window (SPEC §4 contact damage gating).
const damage = new DamageSystem(fx);
// Reflect-shield needs the live enemy list (DamageSystem is decoupled).
GameState.enemiesRef = () => enemyManager.enemies;
// Ship buy/switch: re-skin the hull + refill charge pool immediately
// (scale, reactor color, charges) without needing a restart.
EventBus.on('ship:switched', () => ship.reset());

// P7: hazards (crystals / pulsars / mines / storms). Player damage routes
// into DamageSystem (which owns the 0.75 s invuln window, SPEC §4).
const hazardSystem = new HazardSystem(Game.scene, (amount, pos) => {
  if (!_playerHitGate) {
    _playerHitGate = true;
    damage.hitPlayer(amount, GameState);
  }
  void pos;
});

// EnemyManager: owns live enemies + their death FX / 'enemy:killed'.
// onPlayerHit routes drone contact + rammer AoE into DamageSystem (invuln is
// gated here so a single touch is not double-counted).
let _playerHitGate = false; // reset each frame below
const enemyManager = new EnemyManager(Game.scene, weapon, fx, {
  onPlayerHit: (amount) => {
    if (_playerHitGate) return;
    _playerHitGate = true;
    damage.hitPlayer(amount, GameState);
  },
  camera: Game.camera,
  stations, // station shields: enemies keep out + hold fire when player inside
});

// Dummy spawn points for the enemy groups — placed OUTSIDE the spawn safe
// zone (station at (90,25,420), WORLD_SAFE_RADIUS around it), ~2.5k u out,
// so the start area is threat-free but a short flight reaches the fight.
const _droneGroupA = new THREE.Vector3(600, 0, -2200);
const _droneGroupB = new THREE.Vector3(-900, 200, -2600);
const _interceptorGroup = new THREE.Vector3(1500, -300, -2400);

/** Spawn the P4 demo groups: 2 drone groups + 1 interceptor group. */
function _spawnEnemyGroups() {
  enemyManager.clear();
  enemyManager.spawnGroup('drone', _droneGroupA, 3, 1);
  enemyManager.spawnGroup('drone', _droneGroupB, 3, 1);
  enemyManager.spawnGroup('interceptor', _interceptorGroup, 2, 1);
}
_spawnEnemyGroups();

// Kill counter (SPEC §4): increment run.kills on every enemy death.
EventBus.on('enemy:killed', () => {
  if (GameState.run) GameState.run.kills += 1;
});

// P8: Sentinel summon attack (SPEC §4): main spawns 4 drones at the
// sentinel's position (the sentinel itself keeps firing from range).
EventBus.on('sentinel:summon', ({ position }) => {
  enemyManager.spawnGroup('drone', position, 4, GameState.run.sector);
});

// P9: Warden minefield-drones phase: main spawns drones/mine-like enemies
// (rammers) at the warden's position, every 8 s while in that phase.
EventBus.on('warden:summon', ({ position }) => {
  if (!GameState.run) return;
  const s = GameState.run.sector;
  enemyManager.spawnGroup('drone', position, 3, s);
  enemyManager.spawnGroup('rammer', position, 2, s);
});

// P9: The Warden killed → victory state (SPEC §4/§5 sector 6, P9 AC).
EventBus.on('boss:killed', ({ position }) => {
  if (!GameState.run) return;
  hud.showToast('THE WARDEN IS DESTROYED — THE FORGE FALLS');
  // 3× guaranteed-rare boss loot at the corpse.
  for (let i = 0; i < 3; i++) {
    const drops = lootSystem.rollDrops('boss', position, GameState.run.sector);
    for (const d of drops) lootSystem.spawnPickup(d.itemDef, position);
  }
  // Victory state: persist lifetime warden kills in meta (Save validated on
  // save; unknown keys are stripped, so this count persists across runs).
  GameState.meta.wardenKills = (GameState.meta.wardenKills || 0) + 1;
  saveMeta(GameState.meta);
});

// P5: accumulated flight time, s (absolute time for pickup bob/rotate).
let _flightTime = 0;

// -- P5: enemy deaths → loot drops (SPEC §6) ------------------------------
// Map enemy typeKey → loot source. Bosses (sentinel/warden) guarantee rare+.
// Golden Drone bounty: paid straight to the persistent wallet (the run
// wallet is dead since the auto-sell economy — bountyScrap must not vanish).
EventBus.on('enemy:killed', (payload) => {
  if (!GameState.run) return;
  const sourceType = _lootSourceFor(payload.typeKey);
  const drops = lootSystem.rollDrops(sourceType, payload.position, GameState.run.sector);
  // Ship loot multiplier (fighter ×2): duplicate drops from ENEMIES.
  const lootMult = GameState.currentShip().lootMult;
  for (let m = 0; m < lootMult; m++) {
    for (const d of drops) lootSystem.spawnPickup(d.itemDef, payload.position);
  }
  // Golden Drone bounty: straight to the persistent wallet.
  if (payload.typeKey === 'golden') {
    GameState.meta.scrap += ENEMIES.golden.bountyScrap;
    saveMeta(GameState.meta);
    hud.showToast(`GOLDEN DRONE +${ENEMIES.golden.bountyScrap} SCRAP`);
  }
  // P8: sentinel death with guaranteedRare → extra drops from the rare-only
  // 'boss' table (LootSystem: 'boss' sourceType = rare-only + guaranteed rare).
  if (payload.guaranteedRare) {
    const extra = lootSystem.rollDrops('boss', payload.position, GameState.run.sector);
    for (const d of extra) lootSystem.spawnPickup(d.itemDef, payload.position);
  }
});

// Dummy test targets also drop scrap (P2/P4 fixture, SPEC §6).
EventBus.on('combat:dummyDied', (dummy) => {
  if (!GameState.run) return;
  const drops = lootSystem.rollDrops('dummy', dummy.mesh.position, GameState.run.sector);
  for (const d of drops) lootSystem.spawnPickup(d.itemDef, dummy.mesh.position);
});

/**
 * Map an enemy typeKey to a loot source (SPEC §6 per-source drop tables).
 * @param {string} typeKey
 * @returns {string}
 */
function _lootSourceFor(typeKey) {
  switch (typeKey) {
    case 'drone': return 'drone';
    case 'interceptor': return 'interceptor';
    case 'rammer': return 'rammer';
    case 'frigate': return 'frigate';
    case 'golden': return 'crate'; // Golden Drone: crate table + 250 scrap bounty (SPEC §6)
    case 'sniper': return 'interceptor';
    case 'sentinel':
    case 'warden': return 'boss';
    default: return 'drone';
  }
}

// -- Per-frame systems, update order ----------------------------------------
// Input must update LAST: it clears one-frame just-pressed flags.
InputSystem.attach();
PerfProbe.attach();
Game.systems = [
  {
    update(dt, game) {
      // DEATH freezes the world: render-only (SPEC §2 — death screen is a
      // full stop, no chunk streaming / enemy steering / weapon updates).
      // HANGAR also skips flight systems (hangar UI drives its own view).
      if (GameState.phase !== 'FLIGHT') {
        fx.update(dt, Game.camera); // let FX fade out gracefully
        return;
      }
      // Resolve aim: turret mode → cursor ray (crosshair follows the mouse,
      // camera free-aims around the ship); normal mode → cursor ray (ship
      // nose-steers toward it). LMB is the fire trigger (aim unchanged).
      // Scratch vectors reused per frame.
      const lmb = InputSystem.isMouseDown(0); // LMB held = fire
      const turret = ship.turretMode;
      const ndx = isFinite(InputSystem.ndcX) ? InputSystem.ndcX : 0;
      const ndy = isFinite(InputSystem.ndcY) ? InputSystem.ndcY : 0;
      _aimNDC.set(ndx, ndy, 0.5).unproject(Game.camera);
      _aimDir.copy(_aimNDC).sub(Game.camera.position).normalize();

      // Ship noses toward the aim in normal mode (holds heading in turret).
      ship.update(dt, InputSystem, GameState, { dir: _aimDir, steer: !turret });
      starfield.update(dt, ship.group.position);
      // Sun marker follows the camera (always-visible orientation reference).
      sun.update(Game.camera);
      cameraRig.update(dt, ship, GameState);

      // Crosshair tracks the MAIN WEAPON direction: shots converge on the
      // aim-point (camera ray, 400 u out), so the crosshair is drawn at that
      // world point projected to screen — not at the raw cursor (they only
      // coincide when the camera looks straight through the cursor).
      hud.setAimPoint(_aimPoint, Game.camera);

      // P3: stream chunks around the ship (load/unload hysteresis, SPEC §5).
      chunkManager.update(ship.group.position);
      const sectorDef = chunkManager.getSector(ship.group.position);
      GameState.run.sector = SECTORS.indexOf(sectorDef) + 1 || GameState.run.sector;
      // Biome atmosphere blend (bg/fog/stars/rocks/light) toward this sector.
      biomeVisuals.update(dt, sectorDef.key);
      // THE END (user feedback): past the graveyard the universe is dead —
      // nothing spawns and the ship loses hull over time (4 HP/s after an
      // 8 s grace). Pure survival: how far can you go before decay wins?
      if (sectorDef.key === 'the-end' && GameState.run && GameState.run.alive) {
        _endDrainT += dt;
        if (_endDrainT > HAZARDS.endDrainGraceSec) {
          GameState.run.hull = Math.max(0,
            GameState.run.hull - HAZARDS.endDrainPerSec * dt);
          if (GameState.run.hull <= 0) {
            damage.hitPlayer(1, GameState); // finish the run (routes to death)
          }
        }
      } else {
        _endDrainT = 0;
      }

      // P7: materialize hazards for newly loaded chunks (descriptors carry
      // local-space positions; converted to world space against chunkCenter).
      // PERF (FIX #7): consume ChunkManager's world-dirty flag first so the
      // solid-rock/station rebuild runs only on load/unload transitions.
      if (chunkManager._worldDirty) {
        chunkManager._worldDirty = false;
        _solidRocksDirty = true;
      }
      _materializeNewChunkHazards();

      // FX after cameraRig: screen shake nudges camera post-rig, and damage
      // numbers reproject with the final camera transform.
      fx.update(dt, Game.camera);

      // Weapons: LMB free-aim fires along the camera; F fires toward the
      // cursor aim (ship nose). Shots CONVERGE on the cursor: the fire
      // direction is (aimPoint − muzzle), so what's under the crosshair is
      // what gets hit regardless of the camera↔ship offset. Then advance the
      // pool.
      // aimPoint: 400 u along the aim ray from the camera.
      _aimPoint.copy(_aimDir).multiplyScalar(400).add(Game.camera.position);
      _fireDir.copy(_aimPoint).sub(ship.group.position).normalize();
      weapon.update(
        dt, GameState, ship, _fireDir,
        lmb,
      );
      weapon.updateProjectiles(dt);
      weapon.updateMissiles(dt, enemyManager, fx);

      // MMB tap: IEM burst (AoE around the ship, 5 s shutdown after firing).
      if (InputSystem.justPressedMouse(1)) {
        weapon.fireIem(enemyManager, ship, fx);
      }
      // F (tap): 5-missile autoguided volley at the nearest enemies.
      if (InputSystem.justPressed('KeyF')) {
        weapon.fireMissileVolley(enemyManager, ship, _aimDir);
      }

      // P4: player damage (shield regen) + enemies (steer/contact/AoE/shrink).
      _playerHitGate = false;
      damage.update(dt, GameState);
      enemyManager.update(dt, ship.group.position, GameState);

      // P8: hulks — player contact damage (gated by _playerHitGate, so a
      // single hulk touch per frame is not double-counted with other hazards).
      for (const h of _hulks) {
        if (!h.alive) continue;
        if (
          _hulkScratch2.copy(ship.group.position).distanceTo(h.position) <=
          _HULK_RADIUS + PLAYER.radius
        ) {
          if (!_playerHitGate) {
            _playerHitGate = true;
            damage.hitPlayer(_HULK_CONTACT_DAMAGE, GameState);
          }
        }
      }

      // Solid obstacles: asteroids + stations are solid — contact deals
      // collision damage (scaled by impact speed) and bounces the ship back.
      _collideSolidObstacles(dt, ship, GameState);

      // P9: forge structures (THE FORGE) — indestructible; contact deals
      // WARDEN_ARENA.structureCollisionDamage (gated by _playerHitGate) and
      // bounces the player back (impulse away from the structure center).
      for (const f of _forge) {
        if (
          _hulkScratch2.copy(ship.group.position).distanceTo(f.position) <=
          WARDEN_ARENA.structureRadius + PLAYER.radius
        ) {
          if (!_playerHitGate) {
            _playerHitGate = true;
            damage.hitPlayer(WARDEN_ARENA.structureCollisionDamage, GameState);
          }
          // Bounce: push the player back away from the structure center.
          _hulkScratch2.copy(ship.group.position).sub(f.position);
          if (_hulkScratch2.lengthSq() > 1e-6) {
            ship._velocity.addScaledVector(
              _hulkScratch2.normalize(),
              _FORGE_BOUNCE_IMPULSE,
            );
          }
        }
      }

      // PERF (FIX #2): dock lights only on the nearest stations (light count
      // is what costs — it is inlined into every material's shader). Runs at
      // most once per chunk-crossing, not every frame.
      {
        const lx = Math.floor(ship.group.position.x / 2500);
        const ly = Math.floor(ship.group.position.y / 2500);
        const lz = Math.floor(ship.group.position.z / 2500);
        if (lx !== _stationLightLX || ly !== _stationLightLY || lz !== _stationLightLZ) {
          _stationLightLX = lx; _stationLightLY = ly; _stationLightLZ = lz;
          _updateStationLights(ship.group.position);
        }
      }

      // P5: loot (bob/rotate, magnet, pickup) + HUD (bars/status/toasts).
      _flightTime += dt;
      lootSystem.update(dt, _flightTime, ship.group.position, GameState);
      hazardSystem.update(dt, _flightTime, ship.group.position, ship, (pos) => {
        // Death-star hangar wave: spawn an interceptor at the hangar bay.
        const spawned = enemyManager.spawnGroup('interceptor', pos, 1, GameState.run.sector);
        for (const e of spawned) e.state = 'active'; // hatch hot, already aggro
      });
      banking.update(dt, ship.group.position, GameState, stations);
      for (const s of stations) s.update(dt, _flightTime);
      // P9: boss HP bar — set from the live warden (null when none active).
      {
        const w = _liveWarden();
        hud.bossHp =
          w && w.state === 'active' ? { hp: Math.max(0, w.hp), max: w.maxHp } : null;
      }
      hud.update(GameState);
      // Attack cooldown indicators (iem / missiles, seconds remaining).
      hud.setAttacks({
        iemCd: weapon._iemCooldown,
        iemMax: 5,
        volleyCd: weapon._volleyCooldown,
        volleyMax: 6,
      });

      // P10: AR target reticle — brackets around nearby interactables
      // (enemies red, station green, pickups neutral) + nearest label.
      // PERF (FIX #9): squared-distance reject (700²) BEFORE pushing, and a
      // hard candidate cap — with hundreds of live entities the per-frame
      // Vector3.distanceTo + object allocations here showed in profiles.
      _reticleTargets.length = 0;
      const _R2 = 700 * 700;
      for (const e of enemyManager.enemies) {
        if (!e.alive || e.dying) continue;
        if (_reticleScratch.copy(e.mesh.position).sub(ship.group.position).lengthSq() > _R2) continue;
        if (_reticleTargets.length >= 24) break;
        _reticleTargets.push({
          name: _enemyName(e.typeKey),
          hint: 'F — FIRE',
          position: e.mesh.position,
          radius: e.radius || 3,
          color: 'rgba(239,68,68,.95)', // RED — enemy
        });
      }
      for (const b of _breakables) {
        if (!b.alive) continue;
        if (_reticleScratch.copy(b.position).sub(ship.group.position).lengthSq() > _R2) continue;
        if (_reticleTargets.length >= 24) break;
        _reticleTargets.push({
          name: _breakableName(b.type),
          hint: 'SHOOT TO BREAK — CHANCE OF LOOT',
          position: b.position,
          radius: b.radius,
          color: 'rgba(251,146,60,.95)', // ORANGE — breakable
        });
      }
      for (const h of _hulks) {
        if (!h.alive) continue;
        if (_reticleScratch.copy(h.position).sub(ship.group.position).lengthSq() > _R2) continue;
        if (_reticleTargets.length >= 24) break;
        _reticleTargets.push({
          name: 'Hulk Wreck',
          hint: 'F — SHOOT FOR SCRAP',
          position: h.position,
          radius: _HULK_RADIUS,
          color: 'rgba(251,146,60,.95)', // ORANGE — breakable
        });
      }
      for (const pk of lootSystem.pickups) {
        if (pk.taken) continue;
        if (_reticleScratch.copy(pk.position).sub(ship.group.position).lengthSq() > _R2) continue;
        if (_reticleTargets.length >= 24) break;
        _reticleTargets.push({
          name: pk.itemDef?.name || 'Cargo',
          hint: 'FLY CLOSE — AUTO PICKUP',
          position: pk.position,
          radius: 3,
          color: 'rgba(255,255,255,.9)', // WHITE — lootable
        });
      }
      for (const st of stations) {
        _reticleTargets.push({
          name: 'Station',
          hint: 'H — BANK / REPAIR',
          position: st.group.position,
          radius: 26,
          color: 'rgba(74,222,128,.95)',
        });
      }
      TargetReticle.update(Game.camera, _reticleTargets);

      // P6: H within 120 u of a station → bank (SPEC §5 extraction rule).
      // G toggles TURRET MODE: ship holds its heading/trajectory, the camera
      // free-aims with the mouse (can shoot backwards). The pointer lock
      // itself is requested inside InputSystem._onKeyDown (user gesture —
      // a RAF-tick request would be rejected by the browser).
      if (InputSystem.justPressed('KeyG')) {
        ship.turretMode = !ship.turretMode;
        if (ship.turretMode) {
          // Snap the free-aim orbit to the chase position on entry.
          cameraRig.resetOrbit();
        }
        hud.setTurret(ship.turretMode);
      }
      if (InputSystem.justPressed('KeyH')) {
        // Station interaction: bank + open the trade menu (pauses the sim).
        // Guard: ignore the press if it arrived right after a menu close
        // (see _tradeGuardT above — paused-press flag ordering).
        if (banking.nearStation && performance.now() >= _tradeGuardT) {
          banking.tryBank(ship.group.position, GameState, stations);
          if (!tradeUI.visible) {
            tradeUI.show();
            Game.paused = true;
          }
        }
      }
      // Escape / P close handled by the direct keydown listener above (the
      // loop is paused while the trade menu is open).

      // Projectiles vs targets (dummies + live enemies), generic list.
      _collideProjectiles();

      // Dummy death shrinks (shrink + remove + emit).
      for (const d of dummies) d.update(dt);
    },
  },
  {
    update(dt, game) {
      PerfProbe.update(dt, game.renderer, GameState);
    },
  },
  {
    update(dt, game) {
      InputSystem.update();
    },
  },
];

// -- Collision: projectiles vs targets (dummies + live enemies) ---------------
/**
 * Generic targets list = dummies + live enemies + hulks (P8). Player
 * projectiles hit enemies (enemy.takeDamage → kill at hp≤0); enemy
 * projectiles hit the player (routed into DamageSystem, invuln-gated per
 * frame). Hulks are destructible wrecks (P8, SPEC §5 sector 5) with their
 * own hp; on death: burst FX + 3 scrap drops (crate table, SPEC §6).
 */
const _targets = [];

/** Refresh the targets list each frame (dummies + live enemies + hulks). */
function _refreshTargets() {
  _targets.length = 0;
  for (const d of dummies) {
    if (d.alive) _targets.push(d);
  }
  for (const e of enemyManager.enemies) {
    if (e.alive && !e.dying) _targets.push(e);
  }
  for (const h of _hulks) {
    if (h.alive) _targets.push(h);
  }
}

/** Scratch vector (no per-frame allocation). */
const _scratch = new THREE.Vector3();

/**
 * Pick an enemy type for a chunk enemy spawn point, by current sector
 * (SPEC §4/§5 ladder: drone+interceptor S1, +rammer S2, +frigate S3,
 * +sniper S4; sectors 5+ mix all).
 * @param {number} sector 1-based sector index.
 * @param {number} i spawn point index (varies composition within a chunk).
 * @returns {string} ENEMIES typeKey.
 */
function _sectorEnemyType(sector, i) {
  const pool = ['drone', 'drone', 'interceptor'];
  if (sector >= 2) pool.push('rammer');
  if (sector >= 3) pool.push('frigate', 'rammer');
  if (sector >= 4) pool.push('sniper', 'frigate');
  if (sector >= 5) pool.push('sniper', 'rammer', 'frigate');
  return pool[i % pool.length];
}

/** P8: local-space → world-space scratch for chunk descriptor materialization. */
const _hulkScratch = new THREE.Vector3();

/** Chunk key → station count (restart cleanup uses it via _chunkStations). */
const _chunkStations = new Map();

// PERF: station dock-light budget (FIX #2). Every enabled PointLight is
// inlined into all MeshStandardMaterial shaders, so the light COUNT — not
// distance — sets fragment cost scene-wide. Only the nearest stations get
// their dock light enabled; the rest render with global lights only.
const _STATION_LIGHT_MAX = 3;
const _STATION_LIGHT_RANGE = 1500;
const _stationLightScratch = new THREE.Vector3();
/**
 * Enable dock lights only for the _STATION_LIGHT_MAX stations nearest the
 * ship (within _STATION_LIGHT_RANGE); disable all others. Cheap scan even
 * with many stations (squared distance, no allocation).
 * @param {THREE.Vector3} shipPos
 */
function _updateStationLights(shipPos) {
  let lit = 0;
  for (const st of stations) {
    if (lit < _STATION_LIGHT_MAX) {
      const d2 = _stationLightScratch
        .copy(st.group.position).sub(shipPos).lengthSq();
      if (d2 <= _STATION_LIGHT_RANGE * _STATION_LIGHT_RANGE) {
        if (st.dockLight && !st.dockLight.visible) st.dockLight.visible = true;
        lit++;
        continue;
      }
    }
    if (st.dockLight && st.dockLight.visible) st.dockLight.visible = false;
  }
}

/** P8: materialize sentinel/hulk descriptors (positions are local chunk space; convert to world space against chunk center) + ambush flags */
let _solidRocks = []; // {pos, r} per loaded chunk (rebuilt on materialize/unload)
// PERF (FIX #7): _solidRocks + station list only change when the loaded-chunk
// set changes — rebuild on a dirty flag instead of scanning every chunk's
// descriptors every frame.
let _solidRocksDirty = true;
// Last ship chunk coords the light-cull pass ran at (skips redundant scans).
let _stationLightLX = 1e9, _stationLightLY = 1e9, _stationLightLZ = 1e9;

/**
 * Solid-obstacle collision: asteroids + stations. Contact deals damage
 * scaled by impact speed and reflects the ship's velocity off the surface
 * (inelastic bounce, 40% restitution) so the world feels solid.
 */
const _SOLID_CONTACT_COOLDOWN = 0.4;
let _solidCooldown = 0;
function _collideSolidObstacles(dt, ship, gameState) {
  if (_solidCooldown > 0) _solidCooldown -= dt;
  const pos = ship.group.position;
  let hit = null;
  // Asteroids of loaded chunks.
  for (const rock of _solidRocks) {
    const d = _hulkScratch2.copy(pos).distanceTo(rock.pos);
    if (d <= rock.r + PLAYER.radius) {
      hit = rock;
      break;
    }
  }
  // Stations (big, solid). STATION.ringRadius = 26 (Station.js consts).
  if (!hit) {
    for (const st of stations) {
      const d = _hulkScratch2.copy(pos).distanceTo(st.group.position);
      if (d <= 26 * 0.8 + PLAYER.radius) {
        hit = { pos: st.group.position, r: 26 * 0.8 };
        break;
      }
    }
  }
  if (!hit) return;
  // Push out of the surface + reflect velocity (40% restitution).
  const n = _hulkScratch2.copy(pos).sub(hit.pos).normalize();
  pos.addScaledVector(n, hit.r + PLAYER.radius + 0.5 - _hulkScratch2.copy(pos).sub(hit.pos).length());
  const into = ship._velocity.dot(n);
  if (into < 0) {
    ship._velocity.addScaledVector(n, -1.4 * into); // reflect 40%
  }
  // Impact damage only on a real hit (speed > 15 u/s), cooldown-gated.
  const speed = ship._velocity.length();
  if (_solidCooldown <= 0 && speed > 15) {
    _solidCooldown = _SOLID_CONTACT_COOLDOWN;
    damage.hitPlayer(Math.min(30, 6 + speed * 0.15), gameState);
    fx.shake(0.6, 0.25);
  }
}

const _hulkScratch2 = new THREE.Vector3();

// P7: crystal collision scratch.
const _crystalScratch = new THREE.Vector3();

// Mouse-aim scratch vectors (unproject cursor → world aim dir).
const _aimNDC = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _fireDir = new THREE.Vector3();
/** THE END decay: seconds spent in the dead universe this visit. */
let _endDrainT = 0;

// P10: target-reticle scratch + enemy display names.
const _reticleTargets = [];
const _reticleScratch = new THREE.Vector3();
/** @param {string} typeKey @returns {string} display name. */
function _enemyName(typeKey) {
  switch (typeKey) {
    case 'drone': return 'Drone';
    case 'interceptor': return 'Interceptor';
    case 'rammer': return 'Rammer';
    case 'frigate': return 'Frigate';
    case 'sniper': return 'Sniper';
    case 'golden': return 'Golden Drone';
    case 'sentinel': return 'Sentinel';
    case 'warden': return 'THE WARDEN';
    case 'chrome': return 'Chrome Sentinel';
    default: return 'Contact';
  }
}


/**
 * Breakable prop display names (reticle label).
 * @param {string} t BREAKABLE_TYPES key.
 */
function _breakableName(t) {
  switch (t) {
    case 'container': return 'Cargo Container';
    case 'podcluster': return 'Cargo Pods';
    case 'satellite': return 'Satellite Wreck';
    case 'buoy': return 'Defense Buoy';
    default: return 'Debris';
  }
}

/**
 * Materialize hazard descriptors for newly loaded chunks.
 * Called once per frame after chunkManager.update().
 */
function _materializeNewChunkHazards() {
  // PERF (FIX #7): rebuild the solid-asteroid collider list + prune detached
  // stations ONLY when the loaded-chunk set changed (flag set by the chunk
  // load/unload paths below), not every frame.
  if (_solidRocksDirty) {
    _solidRocksDirty = false;
    _solidRocks.length = 0;
    // Drop chunk-spawned stations whose chunk is no longer loaded: their group
    // was detached by the ChunkManager, so the object would linger in the
    // `stations` array forever (iterating dead entries + a duplicate station
    // with a second shield spawning when the chunk reloads). The spawn station
    // (index 0) is world-anchored and never unloaded.
    for (let i = stations.length - 1; i >= 1; i--) {
      if (!stations[i].group.parent) {
        stations.splice(i, 1);
      }
    }
    for (const [, entry] of chunkManager._chunks) {
      for (const d of entry.descriptors) {
        if (d && d.type === 'asteroids' && d.rocks) {
          for (const rock of d.rocks) {
            if (rock && rock.pos && !rock.dead) _solidRocks.push(rock);
          }
        }
      }
    }
  }
  for (const [key, entry] of chunkManager._chunks) {
    if (entry.userDataMaterialized) continue;
    entry.userDataMaterialized = true;
    // PERF (FIX #3): hazards are tagged with their chunk key so unloadChunk()
    // can detach exactly this chunk's hazard set on unload.
    hazardSystem.materialize(entry.descriptors, entry.group.position, key);

    // P8: materialize sentinel/hulk descriptors (positions are local chunk
    // space; convert to world space against the chunk center) + ambush flags
    // on enemy spawn points (extra drone group at that point).
    const center = entry.group.position;
    const sector = GameState.run.sector;
    for (const d of entry.descriptors) {
      if (!d) continue;
      if (d.type === 'sentinel') {
        const worldPos = _hulkScratch.copy(d.position).add(center);
        enemyManager.spawnSentinel(worldPos, sector);
      } else if (d.type === 'warden-arena') {
        // P9: THE FORGE finale arena — spawn The Warden at the fixed arena
        // position (chunk center + descriptor offset, pushed +500 u along
        // the ladder so the arena sits just past the sector start).
        if (!_wardenSpawned) {
          _wardenSpawned = true;
          const worldPos = _hulkScratch.copy(d.position).add(center);
          if (worldPos.lengthSq() > 1e-6) {
            worldPos.addScaledVector(
              worldPos.clone().normalize(),
              500,
            );
          }
          enemyManager.spawnWarden(worldPos, 6);
        }
      } else if (d.type === 'forge-structure') {
        // P9: broken megastructure (indestructible; collision + bounce).
        const worldPos = _hulkScratch.copy(d.position).add(center);
        _spawnForgeStructure(worldPos, d.rng, key);
      } else if (d.type === 'hulk') {
        const worldPos = _hulkScratch.copy(d.position).add(center);
        _spawnHulk(worldPos, d.rng, key, d.localId);
      } else if (d.type === 'enemy-spawn-points') {
        // SPEC §5 interaction density: EVERY spawn point gets an enemy group.
        // Deep sectors (4+) sometimes get a Golden Drone cameo (fleeing
        // bounty target — diversity, SPEC §6).
        for (let i = 0; i < d.positions.length; i++) {
          const worldPos = _hulkScratch.copy(d.positions[i]).add(center).clone();
          if (sector >= 7) {
            // THE ABYSS: endemic chrome fleets (5-ship V-wings) instead of
            // the normal sector mix.
            enemyManager.spawnChromeFleet(worldPos, sector);
            continue;
          }
          const type = _sectorEnemyType(sector, i);
          // Mixed group sizes (2–5): bigger packs deeper in the ladder.
          const size = 2 + ((i + sector) % 4);
          enemyManager.spawnGroup(type, worldPos, size, sector);
          // Ship aggression malus (user feedback): pricier ships anger the
          // sector — extra duplicate groups per spawn point.
          const ship = GameState.currentShip();
          for (let m = 1; m < ship.enemySpawnMult; m++) {
            enemyManager.spawnGroup(
              _sectorEnemyType(sector, i + m), worldPos, size, sector);
          }
          if (sector >= 4 && i % 3 === 0) {
            enemyManager.spawnGroup('golden', worldPos, 1, 1);
          }
          if (d.flags && d.flags[i]) {
            // Ambush (SPEC §5 sector 5): extra drone group at this point.
            enemyManager.spawnGroup('drone', worldPos, 4, sector);
          }
        }
      } else if (d.type === 'breakable') {
        // Breakable prop (user feedback: 4 distinct models w/ loot bias).
        // Chunk-diff persistence: skip props the player already destroyed.
        if (isDestroyed(key, d.localId)) continue;
        const stats = BREAKABLE_TYPES[d.breakableType];
        const worldPos = _hulkScratch.copy(d.position).add(center).clone();
        const obj = buildBreakable(d.breakableType, d.rng);
        obj.position.copy(worldPos);
        obj.rotation.set(d.rng() * Math.PI, d.rng() * Math.PI, d.rng() * Math.PI);
        Game.scene.add(obj);
        _breakables.push({
          object: obj,
          position: worldPos,
          type: d.breakableType,
          radius: stats.radius,
          hp: stats.hp,
          maxHp: stats.hp,
          lootSource: stats.loot,
          alive: true,
          isBreakable: true,
          chunkKey: key,
          localId: d.localId,
        });
      } else if (d.type === 'station') {
        const worldPos = _hulkScratch.copy(d.position).add(center).clone();
        const st = new Station(Game.scene, worldPos);
        stations.push(st);
        _chunkStations.set(key, (_chunkStations.get(key) || 0) + 1);
      } else if (d.type === 'void-treasure') {
        const worldPos = _hulkScratch.copy(d.position).add(center).clone();
        lootSystem.spawnCluster(worldPos, sector);
      }
    }
  }
}

/**
 * Check player projectiles against crystals (destructible, SPEC §5 P7).
 * Runs before the enemy/dummy collision so a shot is consumed by the
 * nearest crystal first.
 */
function _collideProjectilesWithCrystals() {
  const pool = weapon.pool;
  const crystals = hazardSystem.crystals;
  if (!crystals.length) return;
  for (const p of pool) {
    if (!p.active || !p.fromPlayer) continue;
    for (const c of crystals) {
      if (!c.alive) continue;
      // Sphere check: crystal radius ≈ scale (octahedron unit → scale).
      const hitDist = c.scale + PROJECTILE_HIT_BONUS;
      if (
        _crystalScratch.copy(p.mesh.position).distanceTo(c.position) < hitDist
      ) {
        hazardSystem.takeDamageCrystal(c, p.damage);
        p.active = false;
        p.mesh.visible = false;
        break;
      }
    }
  }
}

/**
 * Swept sphere-vs-segment check: did the projectile's move this frame
 * (prev → current) come within `radius + bonus` of `center`? Fast shots
 * (500 u/s ≈ 8 u/frame) otherwise tunnel straight through small targets.
 * @param {THREE.Vector3} prev position at frame start.
 * @param {THREE.Vector3} cur position now.
 * @param {THREE.Vector3} center target center.
 * @param {number} radius target radius, u.
 * @returns {boolean}
 */
function _sweptHit(prev, cur, center, radius) {
  _sweptA.copy(cur).sub(prev);
  const len2 = _sweptA.lengthSq();
  if (len2 < 1e-8) return _sweptA.copy(center).sub(cur).lengthSq() <= radius * radius;
  // Project center onto the segment, clamp to [0,1].
  const t = Math.max(0, Math.min(1,
    _sweptB.copy(center).sub(prev).dot(_sweptA) / len2));
  _sweptC.copy(prev).addScaledVector(_sweptA, t);
  return _sweptC.distanceToSquared(center) <= radius * radius;
}
const _sweptA = new THREE.Vector3();
const _sweptB = new THREE.Vector3();
const _sweptC = new THREE.Vector3();

function _collideProjectiles() {
  _refreshTargets();
  const pool = weapon.pool;

  // P7: crystals first (destructible; consume the shot on hit).
  _collideProjectilesWithCrystals();

  // Player projectiles → targets (dummies + enemies + hulks + breakables).
  for (const p of pool) {
    if (!p.active || !p.fromPlayer) continue;
    // Breakable props first (cheap sphere check; consumes the shot).
    for (const b of _breakables) {
      if (!b.alive) continue;
      if (_sweptHit(p.prev, p.mesh.position, b.position, b.radius + PROJECTILE_HIT_BONUS)) {
        b.hp -= p.damage;
        fx.spawn(b.position, p.damage, '#fbbf24');
        if (b.hp <= 0) _destroyBreakable(b);
        p.active = false;
        p.mesh.visible = false;
        break;
      }
    }
    if (!p.active) continue;
    for (const t of _targets) {
      if (t.isHulk) {
        // Hulk wreck: {position, hp, alive, group} — destructible (SPEC §5 P8).
        const hHitDist = _HULK_RADIUS + PROJECTILE_HIT_BONUS;
        if (_sweptHit(p.prev, p.mesh.position, t.position, hHitDist)) {
          t.hp -= p.damage;
          fx.spawn(t.position, p.damage, '#fbbf24');
          if (t.hp <= 0) _destroyHulk(t);
          p.active = false;
          p.mesh.visible = false;
          break;
        }
        continue;
      }
      const hitDist = t.radius + PROJECTILE_HIT_BONUS;
      if (_sweptHit(p.prev, p.mesh.position, t.mesh.position, hitDist)) {
        if (t.alive !== undefined) {
          // DummyTarget: flash + damage number + die.
          t.takeDamage(p.damage, fx);
        } else {
          // Enemy: flash + damage number + damage; kill at hp≤0.
          FX.flashMesh(t.mesh, FEEDBACK.hitFlashDuration);
          fx.spawn(t.mesh.position, p.damage, '#7dd3fc');
          t.takeDamage(p.damage);
          if (t.hp <= 0) enemyManager.kill(t);
        }
        p.active = false;
        p.mesh.visible = false;
        break;
      }
    }
  }

  // Enemy projectiles → player (sphere check; invuln-gated by caller).
  for (const p of pool) {
    if (!p.active || p.fromPlayer) continue;
    if (
      _scratch.copy(p.mesh.position).distanceTo(ship.group.position) <
      PLAYER.radius + PROJECTILE_HIT_BONUS
    ) {
      if (!_playerHitGate) {
        _playerHitGate = true;
        damage.hitPlayer(p.damage, GameState);
      }
      p.active = false;
      p.mesh.visible = false;
    }
  }
}

// Docking feedback (cargo auto-sells now — banking only repairs).
EventBus.on('station:banked', (payload) => {
  hud.showToast('DOCKED · HULL + SHIELD REPAIRED');
});

// P6: death → death screen (forfeit) → RESTART button goes to the hangar
// (SPEC P6 AC: fly→loot→bank→die→hangar→upgrade→launch stronger). KeyR on
// death does the same via Game.restart.
EventBus.on('player:died', (run) => {
  deathScreen.show(run);
});
deathScreen.onRestart = () => {
  deathScreen.hide();
  GameState.phase = GamePhase.HANGAR;
  hangar.show();
};

// P6: hangar LAUNCH → clean new run (full restart path) → FLIGHT.
hangar.onLaunch = () => {
  hangar.hide();
  Game.restart();
};

// -- Death restart wiring (SPEC §2 KeyR) ------------------------------------
// Game.js already restarts on KeyR in DEATH; extend it here to also reset
// the ship, starfield, weapon pool and dummies so a death→restart is fully
// clean (SPEC §11).
EventBus.on('game:restart', () => {
  GameState.resetRun();
  GameState.phase = GamePhase.FLIGHT;
  // P6: hide the death screen on restart (KeyR or RESTART button).
  deathScreen.hide();
  ship.reset();
  starfield.update(0, ship.group.position);
  weapon.reset();
  damage.reset();
  // Dummies: respawn at their original positions with full HP.
  for (const d of dummies) d.reset();
  // P4: clear + respawn enemy groups (SPEC §11 restart cleanup).
  _spawnEnemyGroups();
  // P5: clear all pickups + reset flight time (SPEC §11 restart cleanup).
  lootSystem.clear();
  _flightTime = 0;
  // P7: clear all hazards (crystals/pulsars/mines/storms/bolts).
  hazardSystem.clear();
  // P7/P8: clear materialization flags on still-loaded chunks so their
  // hazards are NOT re-materialized on top of the cleared ones — but their
  // enemies were cleared with enemyManager.clear() below, so re-materialize
  // only the ENEMY spawn points. Simplest correct flow: mark every loaded
  // chunk as needing re-materialization, clear hazards after re-run, and let
  // the next frame respawn everything consistently (clear() calls below run
  // AFTER the flags reset, so the re-materialized enemies are fresh).
  for (const [, entry] of chunkManager._chunks) {
    entry.userDataMaterialized = false;
  }
  // P8: clear all hulk wrecks (shared geo/mat: just detach groups, SPEC §11).
  for (const h of _hulks) {
    if (h.group && h.group.parent) h.group.parent.remove(h.group);
  }
  _hulks.length = 0;
  // Clear breakable props (they get re-materialized from chunk descriptors).
  _breakables.length = 0;
  // P9: clear all forge structures + reset warden spawn tracking (SPEC §11).
  for (const f of _forge) {
    if (f.group && f.group.parent) f.group.parent.remove(f.group);
  }
  _forge.length = 0;
  _wardenSpawned = false;
  hud.bossHp = null;
  // P6: clear chunk-materialized stations (the spawn station at index 0 stays).
  while (stations.length > 1) {
    const st = stations.pop();
    if (st && st.group && st.group.parent) st.group.parent.remove(st.group);
  }
  _chunkStations.clear();
});

// -- Debug handle (SPEC §8: `?perf=1` overlay + console probing) ------------
window.__VW__ = { game: Game, GameState, stations, chunkManager, hazardSystem, _hulks, _forge, ship, enemyManager, lootSystem, weapon, dummies };

// -- Go ---------------------------------------------------------------------
// Boot into the HANGAR (SPEC §9 state machine: HANGAR → FLIGHT → DEATH);
// LAUNCH starts the first run. Run state is created by resetRun() already.
GameState.phase = GamePhase.HANGAR;
hangar.show();

Game.start();
