# Void Warband — Closed Specification v1.0

**Source of truth.** Zero open points. Zero TBDs. Every number final unless a later revision supersedes in writing.
Project: `~/Documents/games-benchmarks/void-warband/` — Vite + Three.js, ES modules, zero external assets.

---

## 1. Concept

First/third-person space combat roguelite. Fly through procedurally generated big chunks, fight escalating enemies, loot a rich item catalog, and **bank loot at stations before dying** — death forfeits everything unbanked. Banked scrap buys permanent ship upgrades in the hangar. Push-pull loop: carry more = risk more.

Design pillars, in priority order:
1. **Interaction density** — something to shoot/dodge/grab within 3 s of active play, always.
2. **Combat-first build order** — movement/camera/hits/AI/feedback before biome beauty.
3. **Performance by design** — budgets below, enforced from day one by `?perf=1` + headless check.
4. **Linear curves only** — no exponential/quadratic scaling of HP, damage, or costs, anywhere.
5. **Ladder + voids** — content sectors separated by empty travel voids; fixed-distance finale boss.

---

## 2. Controls (all `event.code`, AZERTY-safe)

| Action | Bind (code) | Value |
|---|---|---|
| Pitch | cursor vertical aim (gyro-steer) | 2.4 rad/s turn |
| Yaw | cursor horizontal aim | 2.4 rad/s turn |
| Roll | `KeyQ` / `KeyE` | 2.8 rad/s |
| Throttle | Scroll wheel — up accel, down brake | 0.12/notch, ease 3/s |
| Fire | `KeyF` (at cursor) or MMB (camera aim) | hold to fire |
| Free-look | MMB hold — orbit camera, ease-back | 0.0032 rad/px |
| Retro-brake | scroll fully down (target 0) | decel ×1.6/s |
| Boost | `KeyB` | ×2.2 speed, 4 s cooldown, 1.5 s burn |
| Bank/interact | `KeyG` | within station radius 120 u |
| Pause | `Escape` | |
| Restart | `KeyR` | death screen only |
| Perf probe | `?perf=1` URL param | overlay |

Camera: chase, offset (0, 3.2, −9) behind ship, lerp 8/s, no roll inheritance, FOV 72 → 95 by throttle, FOV +4 kick on boost. MMB-held free-look orbit eases back to chase on release.

**Controls rev 3:** the cursor IS the crosshair — no pointer lock; the ship noses toward the cursor ray at 2.4 rad/s. Strafe removed (A/D free).

## 3. Player Ship (base, pre-upgrades)

| Stat | Value |
|---|---|
| Hull HP | 100 (no regen; repair at stations) |
| Shield | 50; regen 10/s after 3 s without hit |
| Max speed | 80 u/s (boost ×2.2 = 176) |
| Accel | 60 u/s², drag 0.5/s |
| Weapon | "Pulse Autocannon": pooled projectiles, dmg 10, rate 6/s, speed 500 u/s, life 1.6 s, splash none |
| Cargo | 50 slots (scrap stacks, items 1 slot each) |
| Collision radius | 2.5 u |

Hit feedback: screen shake 0.15 s on player hit, 0.06 s on landing hits; enemy hit flash white 0.1 s; floating damage numbers (pooled DOM).

## 4. Enemies (7 total; MVP ships first 3)

| Enemy | Sector | HP | Dmg | Speed | Behavior |
|---|---|---|---|---|---|
| Drone | 1+ | 15 | 5 (contact) | 60 | swarm 4–6, seek + contact |
| Interceptor | 1+ | 40 | 12 (shot) | 55 | approach to 250 u, orbit-and-fire 1.5 shots/s |
| Rammer | 2+ | 25 | 25 (explode r=20) | 90 | charge, detonate at 5 u |
| Turret Frigate | 3+ | 150 | 20 (heavy shot) | 8 (drift) | stationary, 0.8 shots/s, radius 8, loot piñata |
| Sniper | 4+ | 35 | 30 (rail) | 45 | cloak (opacity 0.15) at >600 u, telegraph beam 0.8 s, fire every 4 s |
| Mini-Boss "Sentinel" | per sector exit | 400 × sector | 25 | 35 | 2 attacks: spread burst + summon 4 drones; drops guaranteed rare |
| Finale Boss "The Warden" | 6 | 3,000 | 40 | 30 | 3 phases: barrage → minefield + drones → enrage beams |

AI = 3D steering behaviors only (seek/flee/orbit/strafe), no pathfinding. Aggro radius 400 u; enemies spawn dormant, activate on proximity or on being hit.

## 5. World, Chunks & Ladder

**Chunks: 2,500 u cubes.** Load radius 2 (5×5×3 chunk region around ship), unload radius 3 (hysteresis). Seeded RNG: seed = `hash(worldSeed, chunkX, chunkY, chunkZ)` — same seed → same world. On unload: dispose geometries not shared, return pooled objects, zero dangling listeners.

Per chunk (content sector): 1 landmark + 2–4 enemy groups + 1–2 loot clusters + hazard set per sector. Every chunk contains ≥1 interactive encounter. Void chunks: starfield only + ≤1 derelict decoration + 5% chance rare loot cache (the "void treasure" hook).

| Sector | Range (u) | Mult | Enemies | Hazard | Palette |
|---|---|---|---|---|---|
| 1 Open Space | 0–3,000 | 1.0 | drone, interceptor | asteroid drift | blue-grey |
| — Void | 3,000–4,000 | 1.0 | — | — | near-black |
| 2 Asteroid Belt | 4,000–8,000 | 1.2 | + rammer | dense asteroids, mines | rust orange |
| — Void | 8,000–9,500 | 1.2 | — | — | |
| 3 Crystal Fields | 9,500–14,000 | 1.5 | + frigate | beam-splitting crystals, pulsar beams | cyan/magenta |
| — Void | 14,000–16,000 | 1.5 | — | — | |
| 4 Plasma Storm | 16,000–21,000 | 2.0 | + sniper | lightning strikes, minefields | teal |
| — Void | 21,000–23,500 | 2.0 | — | — | |
| 5 Derelict Graveyard | 23,500–28,500 | 2.5 | all | destructible hulks, ambush drones | amber |
| — Void | 28,500–31,500 | 2.5 | — | final approach | |
| 6 THE FORGE (finale) | 31,500+ | 3.0 | The Warden | boss arena: broken megastructure ring | red/gold |

Enemy HP/damage scale **linearly** with sector index: `stat × (1 + 0.25 × (sector − 1))`, capped at sector 6 values. Stations (bank/repair/refuel) spawn 1 per content chunk with 25% chance, min 1 per sector span.

**Extraction rule (closed):** banking ONLY at stations (`F` within 120 u) or at run end in hangar. Death forfeits all unbanked cargo. No mid-run banking elsewhere.

## 6. Loot, Items & Magnetism

**22 item types, 4 tiers.** Tier colors fixed: common `#b8c4cc`, uncommon `#4ade80`, rare `#38bdf8`, exotic `#fbbf24`.

| Tier | Items |
|---|---|
| Common (7) | Scrap, Salvage Plate, Coolant, Ammo Cell, Hull Patch, Fuel Skip, Data Fragment |
| Uncommon (7) | Shield Cell, Weapon Mod: Fire Rate, Weapon Mod: Damage, Engine Mod, Magnet Coil (pickup radius +5 u), Trade Chip (scrap ×1.25 60 s), Mystery Crate |
| Rare (5) | Weapon Mod: Split Beam, Weapon Mod: Homing, Core: Overclock, Core: Aegis, Station Voucher |
| Exotic (3) | Warden Shard, Void Relic, Golden Drone (flees, 200 HP, huge bounty) |

- Distinct silhouette + glow pattern per type (pulse/spin/sparkle/trail), pickup sound per tier.
- **Rarity beams:** rare+ emit a vertical light shaft (additive cylinder, visible 800 u). Exotics: beacon + spawn shockwave.
- All glow = shared instanced additive sprites; per-item unique materials forbidden. Item dynamic lights: exotic beacons only, ≤2 active.
- First pickup of a type → discovery popup (name + flavor line). Persistent **Collection Log** (`Tab`): discovered X/22.
- Drop tables per source (drone/interceptor/…/crate/hulk) are explicit arrays in Constants with weights; exotics ≤2% except scripted drops.

## 7. Hangar (meta, localStorage key `void_warband_meta`)

JSON with validation + parse-failure fallback. Upgrades (linear costs, capped):

| Upgrade | Effect | Cost/level (scrap) | Max |
|---|---|---|---|
| Hull Plating | +25 max hull | 100, +100/level | 4 |
| Shield Capacitor | +15 max shield | 120, +120/level | 4 |
| Weapon Tuning | +2 dmg | 150, +150/level | 5 |
| Cargo Pods | +15 slots | 80, +80/level | 3 |
| Engine Mk | +8 u/s max speed | 200, +200/level | 3 |

Banked items persist as inventory; mods can be equipped in hangar (2 mod slots, post-MVP if time).

## 8. Performance Budgets (hard)

| Metric | Budget |
|---|---|
| FPS | 60 target, **30 floor** |
| Draw calls | ≤200 (all sectors incl. finale) |
| Dynamic lights | ≤8 (exotic beacons included) |
| Live particles | ≤1,500 (pooled) |
| Projectiles | pool 200 (player 60 / enemies 140) |
| Instancing | every repeated class: asteroids, crystals, drones, pickups, mines — 1–2 draw calls per class |
| DPR cap | 2 |
| Delta cap | 0.1 s |
| Memory growth | <15 MB / 5 min |
| Post | bloom only; per-sector threshold; no CA/grain at MVP |

`?perf=1` overlay from P0: FPS (60-frame avg), draw calls, tris, lights, particles, sector. Headless check `npm run check:perf`: 60 s at finale teleport, fail if avg FPS <30 or calls >220.

## 9. Architecture

```
src/
  core/       Game.js EventBus.js GameState.js Constants.js Save.js
  world/      BiomeLadder.js ChunkManager.js SectorGenerator.js
  entities/   PlayerShip.js Enemy.js EnemyManager.js Projectile.js Pickup.js Station.js
  systems/    InputSystem.js WeaponSystem.js LootSystem.js CargoSystem.js MetaProgression.js
  visuals/    ModelFactory.js ShaderLib.js ParticleSystem.js Starfield.js Pool.js
  ui/         HUD.js HangarUI.js DeathScreen.js CollectionLog.js
  utils/      PerfProbe.js
```

Rules: EventBus `domain:action` for all cross-module comms; every magic number in Constants; zero logic in shaders beyond visuals; `Game.js` owns RAF loop + state machine (HANGAR → FLIGHT → DEATH).

## 10. Implementation Phases (each = 1–3 small Qwen steps, I review+verify+commit each)

- **P0 Core skeleton**: Constants, EventBus, GameState, Save, Game loop, PerfProbe, InputSystem. AC: boots, loop runs, probe shows, R restarts clean.
- **P1 Flight & camera**: PlayerShip, chase cam, throttle/boost/strafe/roll, starfield. AC: fly, boost, FOV kick, 60 fps empty world.
- **P2 Weapon & feedback**: pooled projectiles, crosshair, hit flash, damage numbers, screen shake, test target dummies. AC: shoot/damage/destroy dummy, restart clean.
- **P3 Chunks**: ChunkManager + SectorGenerator (S1+S2+1 void), instanced asteroids, seeded determinism, load/unload hysteresis. AC: fly 3 chunks, same seed same world, no leak over 5 min.
- **P4 Enemies I**: Drone, Interceptor, Rammer + EnemyManager, steering, contact/shot damage, death FX + drops. AC: fight all 3, restart clean, budgets hold.
- **P5 Loot & items I**: scrap + 8 item types, pickups, rarity colors/beams, cargo, collection log. AC: pickup/bank flow, magnet coil works.
- **P6 Stations & extraction**: Station entity, banking, repair/refuel, hangar scene + 5 upgrades, death screen + forfeiture. AC: full loop: fly→loot→bank→die→hangar→upgrade→ stronger.
- **P7 Sectors 3–4**: Crystal Fields + Plasma Storm: crystals/beam-split, pulsar, lightning, mines, frigate, sniper. AC: ladder to 21,000 u, budgets hold.
- **P8 Mini-bosses + sector 5**: Sentinel per sector exit, Derelict Graveyard hulks + ambushes. AC: kill Sentinel, loot rare.
- **P9 Finale**: THE FORGE arena, The Warden 3 phases, victory state, endless after. AC: kill Warden, `check:perf` passes.
- **P10 Items II & polish**: full 22-item catalog, exotic behaviors, remaining mods, HUD polish. AC: collection log 22/22 reachable.

## 11. Pitfalls (checklist per phase)

- Restart cleanup: clear all pools, listeners, chunk registry — test 3× restarts.
- Chunk unload: dispose non-shared geometry/materials, no orphan events.
- `localStorage` corruption → silent reset to defaults.
- Never unique materials on instanced/pooled objects.
- Damage numbers / FX count-capped, pooled, no DOM leaks.
- Delta cap 0.1 s; RAF pause on tab hidden.
- AZERTY: bind `event.code` only, never `event.key`.

## 12. NOT in scope (v1)

Multiplayer, trading NPCs, voice, mobile, gamepad, soundtrack assets (Web Audio synth only), physics engine, quest system, ship selection (single fighter).
