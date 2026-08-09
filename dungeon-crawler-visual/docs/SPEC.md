# Dungeon Crawler Visual — Extended

Complete implementation specification for a major content extension of the Three.js + Vite first-person dungeon crawler at `~/Documents/games-benchmarks/dungeon-crawler-visual`.

Status: **CLOSED** — zero TBDs, zero vague ranges, every open point resolved. Resolution priority: ease of development, maintainability, internal consistency, fun.

---

## 1. Overview

The stone descent becomes a **biome ladder**: the player descends through 5 themed biomes (Stone, Haunted Crypt, Fungal Cavern, Volcanic Depths, Frozen Halls) on a 2-levels-per-biome cycle, each with its own palette, lighting, props, and enemy mix. The enemy roster grows from 2 to 7 types (Skeleton, Magician, Armored Skeleton, Archer Skeleton, Rat Swarm, Brute, Wraith), all with the 1-in-10 elite pattern where it makes sense. 8 room types (3 existing + 5 new) and 17 new props/decorations reshape the labyrinth. The sword is redesigned: a curved-blade weapon with a **2-hit combo** (horizontal slash → overhead chop), motion trail, impact sparks, and hit-stop — while keeping the orb-growth size/color ladder and the dual danger/growth glow lights. 6 new light sources (candles, chandeliers, lava pools, glowing mushrooms, will-o'-wisps, ice crystal lamps) deepen the atmosphere without breaking the 8-shadow-casting-light budget. All existing systems (timed run, orb ammo+score economy, drop-on-kill loot, leaderboard, bloom toggle, exit regeneration) remain, with numbers rebalanced where the new content demands it.

---

## 2. Controls

All binds use `event.code` (physical key position, AZERTY-safe: `KeyW` is the physical Z key on AZERTY, `KeyA` is Q, `KeyD` is D — no rebinding needed). Verified against `src/systems/InputSystem.js` (stores `e.code`) and `src/core/Game.js` (`_updateInput`).

| Action | Bind (event.code) | Type | Notes |
|---|---|---|---|
| Move forward | `KeyW` (Z on AZERTY) | hold | Speed 4 u/s |
| Move back | `KeyS` | hold | |
| Strafe left | `KeyA` (Q on AZERTY) | hold | |
| Strafe right | `KeyD` | hold | |
| Sprint | `ShiftLeft` / `ShiftRight` | hold | ×1.55 speed, FOV kick +8, +5%/s acceleration tier (SPRINT_ACCEL_WINDOW 1s, capped ×3) |
| Look | Mouse move | — | Pointer-locked; yaw/pitch, ±85° clamp, sens 0.002 |
| Fire orb | Mouse 0 (LMB) | hold | 0.18s cooldown, consumes 1 orb |
| Sword attack | Mouse 2 (RMB) | press | Combo: press again inside 0.35s window → hit 2 |
| Descend at exit | `KeyE` | press (edge) | Only when `inExitRoom` |
| Toggle bloom | `KeyP` | press (edge) | Post-processing on/off |
| Leaderboard | `Tab` | press (edge) | Toggle panel |
| Save for later | `KeyS` | press (edge) | Death screen only; writes the run to localStorage (`dungeonCrawlerSave`) |
| Load last save / New Game | `KeyL` / `KeyN` | press (edge) | Title screen menu (always shown; Load only when a save exists) |
| Pointer lock | Click on canvas | press | Also suppresses context menu (RMB) |

**Save/load** (death → startup): `[S]` at the death screen snapshots the run-meta (level, runTime, souls, weapon tier, permanent hearts, NG+ cycle, boss kills) to localStorage AND mirrors it to a file on disk via `scripts/save-server.mjs` (port 5174, started by `launch.sh`) — the save survives browser storage wipes and origin switches between server runs. At startup a TITLE SCREEN always shows first (spectral showcase scene) with **Load last save [L]** (only when a save exists) / **New Game [N]** (local copy preferred, file-backed copy pulled when local is empty). Loading restarts the SAVED LEVEL from the beginning (fresh level, full health, spawn protection) with all meta-progression intact — no 10% orb penalty, no NG+ change, buff never carries. The save persists after loading (only replaced by saving again at death), so the Load option never disappears; the stale death entry is removed from the ledger.

**New actions this extension adds: zero new keys.** The sword combo reuses RMB (edge-triggered presses, not hold). No conflicts with existing binds. Rat swarm/brute/wraith introduce no player-side input.

---

## 3. World Generation

### 3.1 Grid parameters (unchanged)

| Param | Value | Notes |
|---|---|---|
| Grid size | 12–16 cells | `WORLD.GRID_MIN..GRID_MAX` |
| Cell size | 6 units | `WORLD.CELL_SIZE` |
| Corridor width | 1 cell | |
| Wall height | 4 units | |
| Player eye height | 1.7 | |
| Rooms per level | 8–12 | `DUNGEON.MIN_ROOMS..MAX_ROOMS` |
| Room min distance | 1 cell margin | `DUNGEON.MIN_ROOM_DISTANCE` |
| Dead-end corridors | 0–4 | `DUNGEON.DEAD_END_MAX` |
| Max placement attempts | 200 | |

### 3.2 Generation algorithm (unchanged pipeline, extended weights)

1. `_initGrid()` — all cells `empty`.
2. `_placeRooms()` — weighted pick from **8 room types** (see 3.3); size from type config; rejection-sample with 1-cell margin.
3. `_connectRooms()` — Prim MST over Manhattan distance + up to `floor(n/3)` short loop corridors (L and Z shapes).
4. `_addDeadEnds()` — 0–4 stubs.
5. `_designateEntranceAndExit()` — entrance = room nearest top-left; exit = farthest room cell by BFS over non-empty cells.
6. **NEW — `BiomeSystem.apply(level)`**: biome is fixed per level (see §4.6); palette applied to wall/floor/ceiling materials, fog, ambient, and light colors before content placement.
7. **NEW — `PropSystem.place()`**: instanced props per room type/biome rules (§6), never in corridors, never within 1 cell of a corridor opening.
8. Lighting placement per biome light set (§8), reusing the existing nearest-8 shadow budget.
9. Enemy spawn via biome-weighted table (§5.4), same BFS-distance + exit-room exclusion rules.

### 3.3 Room type catalog

All weights are relative; total pool weight = 144. A room's type is picked with `weight / totalWeight`.

| Room | Weight | Size (cells) | Features | Lighting | Decoration density | Enemy spawn rules | Biome eligibility |
|---|---|---|---|---|---|---|---|
| CHAMBER | 40 | 2–3 × 2–3 | Generic stone room, crystal cluster | 1 crystal light | medium (6 props) | Any (biome weights) | All |
| HALL | 35 | 1–2 × 1 | Connector room, brazier | 1 brazier + 1 chandelier + 2 candles | low (4 props) | Any, lower weight (−20%) | All |
| VAULT | 25 | 3–4 × 3–4 | Treasure room, god rays, water puddle | 2 crystal lights + chandelier | high (10 props) | Any, elite +50% roll | All |
| ARMORY | 10 | 3 × 3 | Weapon racks (4), breakable barrels (2–3) | 2 candles + 1 torch | medium (8 props) | Armored +30%, Archer +20% | Stone, Volcanic |
| LIBRARY | 10 | 3 × 3 | Bookshelves (6–8), candle clusters | 6 candles | very high (12 props) | Skeleton only (others ×0) | Stone, Haunted Crypt |
| CRYPT | 10 | 2–3 × 2–3 | Sarcophagi (2–3), skull piles, webs | 2 will-o'-wisps + 4 candles | high (10 props) | Wraith +40%, Skeleton +20% | Haunted Crypt |
| MUSHROOM_GROVE | 8 | 2–3 × 2–3 | Glowing mushroom clusters (4–6), roots | ~6 mushroom lights | very high (12 props) | Rat +50% | Fungal Cavern |
| ARENA | 6 | 4 × 4 | Pillars (4), banners, blood stains | 4 torches + 1 chandelier | low (6 props) | Elite guaranteed (first spawn forced to an elite-eligible type — Armored/Archer/Brute/Wraith — with elite=true); count +2 | All (combat setpiece) |

Room-type weight modifiers per biome (multiplier applied after base weight, before normalization):

| Biome | Modifiers |
|---|---|
| STONE | none |
| HAUNTED_CRYPT | CRYPT ×3, LIBRARY ×1.5, ARMORY ×0.5 |
| FUNGAL_CAVERN | MUSHROOM_GROVE ×3, VAULT ×0.7 |
| VOLCANIC_DEPTHS | ARMORY ×2, CHAMBER ×0.8 |
| FROZEN_HALLS | VAULT ×1.5, CHAMBER ×1.2, MUSHROOM_GROVE ×0 |

Per-biome total weight stays ≥ 100 after modifiers (base 144; minimum observed: Frozen Halls = 48+35+37.5+10+10+10+0+6 = 156.5).

---

## 4. Biomes

### 4.1 Progression rule

Cyclic, 2 levels per biome: `biomeIndex = floor((level - 1) / 2) % 5`, sequence `[STONE, HAUNTED_CRYPT, FUNGAL_CAVERN, VOLCANIC_DEPTHS, FROZEN_HALLS]`. Level 1–2 = Stone, 3–4 = Haunted Crypt, 5–6 = Fungal Cavern, 7–8 = Volcanic Depths, 9–10 = Frozen Halls, 11–12 = Stone again, and so on. **Difficulty does not reset**: enemy count, speed/attack scaling, and the timed run continue regardless of biome cycle. `LEVEL_TIME_LIMIT` stays 180 s.

Biome applies at `_regenerateDungeon` time, never mid-level.

### 4.2 Palette & atmosphere table

| Biome | Wall | Floor | Ceiling | Fog (Exp2) | Ambient | Fog density | Light temperature |
|---|---|---|---|---|---|---|---|
| STONE | 0x3a3a4a | 0x2a2a35 | 0x1a1a25 | 0x0a0a15 | 0x111122 @ 0.2 | 0.015 | Torch 0xff9944 |
| HAUNTED_CRYPT | 0x2e2e3e | 0x20202c | 0x14141c | 0x060610 | 0x10101e @ 0.22 | 0.016 | Cold torch 0x88ddff |
| FUNGAL_CAVERN | 0x2a3a2e | 0x1e2a22 | 0x141e18 | 0x0a140e | 0x0c1a10 @ 0.25 | 0.014 | Mushroom 0x44ff88 |
| VOLCANIC_DEPTHS | 0x3a2420 | 0x2a1814 | 0x1e100e | 0x1a0a06 | 0x2a0e06 @ 0.25 | 0.018 | Lava 0xff5522 |
| FROZEN_HALLS | 0x3a4654 | 0x28303c | 0x1a2028 | 0x0c1220 | 0x16203a @ 0.28 | 0.013 | Ice 0x66ccff |

Stone keeps its existing procedural textures. Other biomes get **tinted variants of the same procedural textures**: `Textures.js` gains `generateStoneWallTexture(tint)` / `generateFloorTexture(tint)` / `generateCeilingTexture(tint)` where `tint` is the palette hex; the generator multiplies the canvas base colors by the tint. One texture set per biome, cached in `BiomeSystem` (5 sets × 3 textures, 256 px each — negligible memory).

### 4.3 Light source set per biome

| Biome | Light sources |
|---|---|
| STONE | Torches (existing), braziers (HALL), crystals (CHAMBER + VAULT), god rays (VAULT), start/exit markers |
| HAUNTED_CRYPT | Cold torches (color 0x88ddff), candles, will-o'-wisps (1–2 per CRYPT), exit marker |
| FUNGAL_CAVERN | Glowing mushrooms (~6 per MUSHROOM_GROVE, ~2 per other room; each cluster = 1 green point light 3.2/dist 12), 1 torch per VAULT only |
| VOLCANIC_DEPTHS | Lava pools (1–2 per room), torches (0xff5522 tint), exit marker |
| FROZEN_HALLS | Ice crystal lamps (2 per room), 1 chandelier per HALL/VAULT, exit marker |

### 4.4 Decoration set per biome

| Biome | Decorations |
|---|---|
| STONE | Barrels, crates, rubble, chains, banners (existing debris + new) |
| HAUNTED_CRYPT | Skull piles, sarcophagi, spider webs, blood stains, candles |
| FUNGAL_CAVERN | Glowing mushrooms, roots/vines, stalactites, skull piles |
| VOLCANIC_DEPTHS | Lava pools, rubble, stalactites, chains |
| FROZEN_HALLS | Ice crystals, pillars, banners, rubble |

### 4.5 Enemy set with spawn weights per biome

See §5.4 table. Weights are the base selector; room type applies multiplier or exclusion rules per §3.3 (e.g. ARMORY bumps Armored, LIBRARY excludes everything but Skeleton).

### 4.6 Timed-run structure rebalance

Unchanged structure (180 s/level, level timer, run timer, leaderboard by level/time/orbs). The biome cycle is the progression spine; the timer never resets on biome change. At level 11+ the Stone biome re-appears with the same STONE weight column (§5.4 — Wraith weight 0, so wraiths remain crypt-exclusive) and level-scaled stats.

---

## 5. Enemies

### 5.1 Shared mechanics (all enemies)

- **Spawn**: BFS distance ≥ 6 cells from entrance, never in the exit room (existing rule). Count = `2 + (level - 1)` spawn slots, capped at 200 (+2 in ARENA). Type chosen per-slot by biome weights (§5.4). Elites: 1-in-10 roll per non-rat spawn. **Living-body cap: 200 total** (rats count individually); a rat pack clamps to fit the cap. **Spawns only occur more than 30 m from the player** (`SPAWN_PLAYER_DIST`): a queued spawn whose spot is too close rotates to the back of the queue until the player moves away. **Far-frozen bodies**: mobs more than 40 m from the player are IMMOBILE (`FROZEN_DIST`) — idle in place, no AI/tracking/attacks — which is what makes the 200-body cap affordable.
- **Level scaling**: +2% move speed per level (balance pass — was +5%) and +5% attack speed every 3 levels (`speedMult`/`attackMult` pattern), applied to ALL enemy types' speeds and attack-cycle durations/cooldowns; **+100% enemy HP every 10 levels** (×(1 + floor(level/10))). **Spawn multiplier = min(1 + (level + souls)/10, ×100)** — level and banked souls accelerate spawns up to a ×100 cap; past the cap, extra pressure converts to +100% enemy HP per 10 excess points (the overflow rule).
- **Death**: drop orb(s) per §5.5, smoke puff, death animation (existing fade-out pattern), then removal + disposal.
- **Projectile pools**: shared pooled geometry/materials per projectile type (no per-shot allocation).
- **AI**: existing LOS raycast + greedy 4-neighbor grid pathing (re-evaluate 0.3 s). Wraith ignores pathing (§5.3).
- **Roster**: Skeleton, Magician (existing) + Armored Skeleton, Archer Skeleton, Rat Swarm, Brute, Wraith (new).

### 5.2 Enemy triad — full table

| Enemy | HP | Speed (u/s) | Attack type | Damage | Range | Windup / Swing / Recover / Cooldown (s) | Telegraph | Elite? |
|---|---|---|---|---|---|---|---|---|
| Skeleton | 2 | 2.6 | melee | 1 | 1.6 | 0.35 / 0.25 / 0.4 / 1.2 | sword raise | No (existing, unchanged) |
| Magician | 2 | 2.6 | ranged orb | 1 | 9 (cast) | 0.35 / 0.25 / 0.4 / 1.2 (≈2.2 cycle) | staff glow charge | No (existing, unchanged) |
| Armored Skeleton | 5 | 1.8 | melee | 2 | 0.85 | 0.5 / 0.3 / 0.5 / 1.6 | shield raise | Yes |
| Archer Skeleton | 2 | 2.4 | ranged arrow | 1 | 10 (pref. 8) | 0.5 / 0.1 / 0.4 / 1.8 | bow draw | Yes |
| Rat Swarm | 1 | 4.2 | contact | 1 | 0.9 | 0.0 / 0.0 / 0.0 / 0.8 | none (instant) | **No** |
| Brute | 8 | 1.2 | melee slam | 3 | 2.4 | 1.2 / 0.3 / 1.2 / 2.5 | club raise + flash | Yes |
| Wraith | 2 | 2.4 | touch | 1 | 0.9 | 0.0 / 0.0 / 0.0 / 1.0 | shimmer | Yes |

### 5.3 Per-enemy specification

**Skeleton (existing)** — unchanged appearance/behavior numbers from `SKELETON` block; now part of the registry. Drops 1 orb. **No elite** (existing behavior unchanged — Skeleton and Magician keep the game's current elite-less status; the 1-in-10 elite pattern applies only to the five new enemies).

**Magician (existing)** — unchanged (speed 2.6, cast range 9, orb 6.2 u/s); drops 1 orb. **No elite**.

**Armored Skeleton** — tank.
- Appearance: Skeleton rig, bone color 0x9a9282, **dented iron chestplate** (BoxGeometry 0.34×0.3×0.22 over ribcage, color 0x5a5a66, metalness 0.8), **kite shield** on left arm (BoxGeometry 0.26×0.4×0.06 + tapered cone tip, 0x4a4a55), open-faced helm (cylinder 0.17×0.2 + brow plate). Eye glow 0xff5533. Slight forward hunch.
- Behavior: slow, tanky; approaches and swings a heavy axe (right hand, BoxGeometry 0.05×0.4×0.12 blade). No knockback exists in the game (none of the weapons push); armored skeletons simply do not flinch visually.
- Interactions: vulnerable to orb weapon like all; **no armor piercing** — sword damage applies flat (2/3). Drops 2 orbs. Score value 2.
- Elite (1-in-10): **Warlord** — bone 0xb8a888, gold trim (0xd8b44a on chestplate edges), HP 10, speed ×1.3, drops 3 orbs.

**Archer Skeleton** — ranged harasser.
- Appearance: Skeleton rig, bone 0xb8b0a0, **hunter hood** (ConeGeometry 0.2×0.3, 0x2a2a35), **shortbow** in left hand (arc: TorusGeometry 0.18, 0.02, 6, 8, π; string: thin BoxGeometry 0.01×0.34×0.01), quiver on back (CylinderGeometry 0.06×0.25, 0x3a3a2a) with 4 arrow shafts (CylinderGeometry 0.008×0.3).
- Behavior: keeps distance — stops at 8 u, backs away if player closes < 4 u (retreat speed 2.0). Fires a **bone arrow** (pool of 10: CylinderGeometry 0.02×0.5 + cone tip, speed 8 u/s, lifetime 3 s, radius 0.15). Telegraph: bow draw (windup 0.5 s) with arrow glow 0xffcc88.
- Interactions: arrow blocked by walls (existing `circleHitsBox`); 1 damage, respects player i-frames. Drops 1 orb. Score 1.
- Elite (1-in-10): **Sharpshooter** — bone 0xd8d0c0, red hood, fires a **2-arrow fan** (spread ±8°), drops 2 orbs.

**Rat Swarm** — fast chaff, pressure.
- Appearance: no skeleton rig. Group of 4–6 rats per spawn slot: body (SphereGeometry 0.12×0.35 scaled, 0x5a4a3a), head (sphere 0.07, 0x4a3a2a), tail (thin cylinder 0.02×0.25, 0x4a3a2a), eyes (2 tiny red spheres 0.01, emissive 0xff2211). Bob + scuttle animation (body rotation.z ±0.4 at 10 Hz).
- Behavior: spawn as a pack (1 spawn slot = 4–6 rats, rat cap 12 alive per level, living-body cap 16). Straight-line chase (no pathing — they follow LOS, but use greedy step through walls like others when LOS blocked; speed high). Contact damage 1, i-frames respected. No windup (instant nibble).
- Interactions: 1 orb weapon hit kills (HP 1); sword hit 1 kills any number in arc. **Drops 0 orbs** (chaff — economy pressure). Score 0 (they are not scored; the leaderboard counts orbs only).
- Elite: **none** (explicitly excluded — packs are the threat, not individuals).

**Brute** — heavy, telegraphed, high risk.
- Appearance: enlarged skeleton (scale 1.6), bone 0x8a8070, **torn tunic** (CylinderGeometry 0.5×0.6 open, 0x3a2a1a), **massive club** (CylinderGeometry 0.09×1.1 + sphere head 0.22, 0x4a3a2a) in right hand, left hand open (no weapon). Two red eyes 0xff4422.
- Behavior: slow approach; attack = overhead slam. **Telegraph**: club raised overhead for 1.2 s with orange flash on club head (emissive 0xff8830 pulsing) — clearly readable. Slam damage 3: kills a full-health player (3 HP) in one hit — the single biggest threat in the roster. AOE: cone ±50°, range 2.4, plus a **shockwave ring** (pooled TorusGeometry 0.6→2.0 expanding, 0.25 s) that is visual only.
- Interactions: slow enough to kite; sword combo (hit1 2 + hit2 3 = 5) + 2 orb hits (2) = 7 < 8, needs one more hit — deliberately tanky. **Drops 3 orbs** (big payout — reward for the risk). Score 3.
- Elite (1-in-10): **Ogre** — bone 0x7a7060, scale 1.9, HP 16, speed ×1.2, slam damage 3, drops 4 orbs.

**Wraith** — phasing threat.
- Appearance: no skeleton rig. Translucent hooded figure: cone body (ConeGeometry 0.45×1.1, MeshBasicMaterial 0x88ffcc, opacity 0.35, additive, depthWrite false), two bright eyes (spheres 0.03, 0xccffdd, emissive), trailing wisp particles (3 pooled glow sprites following at 0.3 s lag). Sine bob ±0.15 at 2 Hz. No shadow casting.
- Behavior: **phases through walls** — skips wall collision entirely, flies straight at the player at 2.4 u/s (no pathing, no LOS check). Cannot be kited behind corners; counter = kill it fast. Touch damage 1, cooldown 1.0 s between touches, i-frames respected.
- Interactions: 1 sword hit kills (HP 2, sword dmg 2), 2 orb hits. **Phasing is both-way**: it cannot be body-blocked either. Drops 2 orbs (worth chasing down). Score 2.
- Elite (1-in-10): **Banshee** — color 0xff88cc, HP 4, speed 3.4 (2.4 × 1.4), touch damage 1, drops 3 orbs.

### 5.4 Spawn weights per biome (sum = 100 each)

| Enemy | STONE | HAUNTED_CRYPT | FUNGAL_CAVERN | VOLCANIC_DEPTHS | FROZEN_HALLS |
|---|---|---|---|---|---|
| Skeleton | 45 | 25 | 30 | 20 | 25 |
| Magician | 10 | 10 | 10 | 10 | 10 |
| Armored | 15 | 10 | 10 | 25 | 20 |
| Archer | 15 | 15 | 5 | 15 | 25 |
| Rat | 10 | 5 | 40 | 10 | 10 |
| Brute | 5 | 5 | 5 | 20 | 10 |
| Wraith | 0 | 30 | 0 | 0 | 0 |

Rat spawn slot: roll Rat → spawn a pack of `4 + floor(rng*3)` rats (4–6) at one cell, consuming 1 spawn slot, rat cap 12 alive. Elites roll 1-in-10 per non-rat spawn, **only for elite-eligible types** (Armored, Archer, Brute, Wraith — Skeleton, Magician, and Rat have no elite).

### 5.5 Drop & score table (drop-on-kill)

| Enemy | Orbs dropped | Score value |
|---|---|---|
| Skeleton | 1 | 1 |
| Magician | 1 | 1 |
| Armored Skeleton | 2 | 2 |
| Archer Skeleton | 1 | 1 |
| Rat (each) | 0 | 0 |
| Brute | 3 | 3 |
| Wraith | 2 | 2 |

Elites drop `base + 1` (Warlord 3, Sharpshooter 2, Ogre 4, Banshee 3). All drops use the existing pooled `OrbSystem.spawnDrop` (shared geometry/material, auto-collect radius 1.4).

### 5.6 Enemy level scaling recap

`speedMult = (1 + ENEMY.SPEED_PER_LEVEL * (level-1)) * (1 + 0.1 * bossKills)` — move speed +2%/level (balance pass) and +10%/boss kill; `attackMult = (1 + 0.05 * floor((level-1)/3)) * (1 + 0.1 * bossKills)` applied to windup/swing/recover/cooldown of all enemies. Applies to new enemies identically.

---

## 6. Elements & Decoration

### 6.1 Prop catalog (17 new)

Shared rules: props spawn only inside rooms (never corridors), ≥ 1 cell from any corridor opening (checked against the 4-neighbor cell grid), never on the exit-cell center (2-unit radius). Breakables use shared pooled geometry/material. InstancedMesh used for all purely decorative repeated props (see counts).

| # | Prop | Type | Collision | Light | Rooms | Biomes | Density / placement | Spec |
|---|---|---|---|---|---|---|---|---|
| 1 | Barrel | **Breakable** (HP 1) | circle r 0.5 | none | any room | all | 1–3 per CHAMBER/VAULT | Cylinder 0.4×0.9, 0x6a4a2a, 2 metal bands 0x3a3a3a. Any damage (orb/sword) breaks → 6 debris shards + smoke puff. Drop: 6% buff + 20% chance of 1–5 soul orbs. |
| 2 | Crate | **Breakable** (HP 1) | circle r 0.55 | none | any room | all | 1–2 per CHAMBER/HALL | Box 1.0×1.0×1.0, 0x7a5a3a, cross planks 0x5a3a2a. Same break rule, 8 shards. Drop: 6% buff + 20% chance of 1–5 soul orbs. |
| 3 | Hanging chain | Decorative | none | none | HALL, VAULT, ARMORY | stone, crypt, volcanic | 1 per room, from ceiling | Cylinder 0.03×2.5, 0x4a4a52, metalness 0.8, + hook. Static (no physics). |
| 4 | Banner | Decorative | none | none | HALL, VAULT, ARENA | all | 1–2 per room on walls | Plane 1.2×0.8, DoubleSide, biome-tinted color, gentle sine sway in update. |
| 5 | Skull pile | Decorative | none | none | CRYPT, LIBRARY, fungal | crypt, fungal, stone | 1–3 per room, 8 skulls each | InstancedMesh: 8 × (Sphere 0.12 squashed + jaw box), bone 0xcfc6b0. |
| 6 | Stalactite | Decorative | none | none | any room | fungal, volcanic, frozen | 2–4 per room, ceiling | InstancedMesh: Cone 0.15–0.3 × 0.6–1.2, biome tint (0x3a4a3e / 0x4a3a30 / 0x8ac0d8). |
| 7 | Root/vine | Decorative | none | none | any room | fungal, crypt | 1–2 per room, wall corners | 2–3 thin bent cylinders (0.04×1.2) 0x2a3a2a, hang from wall top. |
| 8 | Spider web | Decorative | none | none | CRYPT, LIBRARY | crypt | 1 per room, corner | 2 crossed planes 0.8×0.8, CanvasTexture web (radial lines), opacity 0.3, DoubleSide. |
| 9 | Candle | **Light prop** | none | PointLight (§8) | LIBRARY, CRYPT, HALL | all except fungal | 4–8 per LIBRARY/CRYPT | Group: body Cylinder 0.04×0.18 (0xd8c8a0), flame Cone 0.03×0.08 (0xffaa55, MeshBasic), light 0xffaa55, 0.6, dist 5, decay 1.8, no shadow. Flame flickers (scale 0.9–1.15). |
| 10 | Chandelier | **Light prop** | none | 3 PointLights (§8) | HALL, VAULT, ARENA | all except fungal | 1 per room | Ceiling-hung ring (Torus 0.5, 0.04) + 3 candle arms + 3 flames; 3 lights 0xff9944, 0.5, dist 6, decay 1.8, no shadow. Slow rotate 0.05 rad/s. |
| 11 | Pillar | Structural | AABB 0.8×0.8 | none | VAULT, ARENA, frozen HALL | stone, frozen, crypt | 2–4 per VAULT, 4 per ARENA | Box 0.8×4×0.8, biome tint, 4 corner flutes (thin boxes 0.06). Collision box added to `_collisionBoxes`. |
| 12 | Bookshelf | Decorative + collision | AABB 1.4×2.0 | none | LIBRARY | stone, crypt | 6–8 per LIBRARY | Box 1.4×2.4×0.4, 0x5a3a2a, 5 shelf planes 0x3a2a1a, 12 instanced book boxes (0.1×0.28×0.06, random hues). Collision AABB. |
| 13 | Sarcophagus | **Interactive** | AABB 1.0×1.6 | none | CRYPT | crypt | 2–3 per CRYPT | Box 1.0×0.8×1.6, 0x6a6a5a + lid box 1.1×0.15×1.7. **On first proximity (< 2.5 u)**: lid slides open (0.6 s), emits smoke, and a 30% chance to spawn a Wraith at the sarcophagus (level-scaled); guaranteed 1 orb drop inside. One-time. |
| 14 | Blood stain | Decorative (floor decal) | none | none | ARENA, CRYPT | crypt, volcanic | 2–3 per room | Plane 0.8–1.6 random scale, 0x3a0a0a, opacity 0.5, CanvasTexture splatter, slightly darker than floor, y=0.015. |
| 15 | Ice crystal | **Light prop** | none | PointLight (§8) | any room | frozen | 2 clusters per room, 3–5 crystals | Cluster: Cone 0.1–0.2 × 0.5–1.2, 0x9ad8ff translucent (opacity 0.8), emissive 0x66ccff 1.4. Light 0x66ccff, 1.4, dist 7, decay 1.5, no shadow. |
| 16 | Glowing mushroom | **Light prop** | none | PointLight (§8) | MUSHROOM_GROVE, any fungal room | fungal | ~6 clusters per grove, ~2 per other room | Cluster: stem Cylinder 0.05×0.25 (0x8a7a5a), cap Cone 0.18×0.1 (0x44ff88 emissive 2.6), 4–6 per cluster. Light 0x44ff88, 3.2, dist 12, decay 1.2, no shadow. Cap pulses ±10%. |
| 17 | Lava pool | **Hazard + light** | none (visual only) | PointLight (§8) | any volcanic room | volcanic | 1–2 per room, never on exit cell | Plane 1.5–2.5 random ellipse scale, emissive 0xff5522 2.2, top y=0.02, + glow sprite. **Hazard**: standing within 1.2 u of center deals 1 damage per 0.8 s (respects i-frames). Light 0xff5522, 2.2, dist 9, decay 1.5, no shadow, flickers ±10%. |

(17 entries; the catalog exceeds the required 10.)

### 6.2 Decoration density rules

- Per room type: CHAMBER 6, HALL 4, VAULT 10, ARMORY 8, LIBRARY 12, CRYPT 10, MUSHROOM_GROVE 12, ARENA 6 — **total props per room** (light props + decoratives + breakables).
- Per biome: biome decorations replace generic ones per §4.4 (e.g. fungal rooms swap rubble for roots/stalactites).
- Breakable count per room ≤ 3; interactive props (sarcophagus) ≤ 3; structural (pillar/bookshelf) collision AABBs are pushed into `WorldBuilder._collisionBoxes` BEFORE enemy spawn so pathing respects them.
- All decorative InstancedMesh props: single draw call per prop type per room; per-level instance budget in §12.

---

## 7. Sword

### 7.1 New geometry (curved blade, crossguard, fuller)

Replace `PlayerSword._build()` with a 5-part assembly (all primitives, no assets). Dimensions in units, group origin at the grip hand:

| Part | Geometry | Position | Material |
|---|---|---|---|
| Blade (curved, two-segment) | Lower segment Box 0.045 × 0.35 × 0.1 at y 0.30 (straight); upper segment Box 0.04 × 0.22 × 0.08 at y 0.60, rotated `rotation.x = -0.12` (tips forward = curve silhouette) | — | steel 0xc8ccd8, metalness 0.9, roughness 0.3 |
| Fuller | Box 0.01 × 0.4 × 0.005, inset on blade face (z 0.052) | y 0.35 | darker steel 0x9a9ea8 |
| Crossguard | Box 0.22 × 0.03 × 0.05 + 2 swept tips (Box 0.04 × 0.03 × 0.06 rotated ±0.5) | y 0.12 | dark 0x4a3a28 |
| Grip | Cylinder 0.03 × 0.18, 8 seg | y 0.0 | wrapped leather 0x4a3a28, roughness 0.7 |
| Pommel | Sphere 0.05, 8×6 | y −0.11 | brass 0xd8b44a, metalness 0.8 |

Total silhouette ~1.0 unit tall, blade-up. Casts no shadow (existing rule). Existing blade/grip/guard/pommel replaced; the danger glow sprite, growth glow sprite, dangerLight and growthLight positions updated to the new blade (sprite at y 0.45, lights at y 0.5).

### 7.2 Attack animation — 2-hit combo (replaces pierce)

Full state machine (replaces the current pierce windup/thrust/recover). The combo window opens when RECOVER1 **starts** and stays open 0.35 s (0.18 s of RECOVER1 + 0.17 s grace after it); an RMB press inside the window (or buffered during the grace) chains into WINDUP2.

```
IDLE --RMB--> WINDUP1 (0.10s) --> SLASH1 (0.16s) --> RECOVER1 (0.18s) --> COOLDOWN (0.30s) --> IDLE
                                                       |                                  ^
                                                       +-- combo window (0.35s from      |
                                                           RECOVER1 start; RMB press     |
                                                           or buffered press chains)    |
                                                                                        |
WINDUP2 (0.08s) <-- (combo) <------------------------------------------------------------+
     |
     v
SLASH2 (0.14s) --> RECOVER2 (0.20s) --> COOLDOWN (0.30s) --> IDLE
```

| State | Duration (s) | Easing | Animation |
|---|---|---|---|
| WINDUP1 | 0.10 | ease-out | Blade raised to right-shoulder, slight rotation.x −0.4, z +0.5, grip pulls back |
| SLASH1 | 0.16 | ease-out | **Horizontal slash R→L**: grip sweeps across the screen (x 0.36 → −0.42), blade rotation.z +0.4 → −0.55; hit window p ≥ 0.3 |
| RECOVER1 | 0.18 | ease-in | Returns toward center; combo window open (0.35 s total from RECOVER1 start) |
| WINDUP2 | 0.08 | ease-out | Blade cocks overhead (rotation.x −1.2, z 0) |
| SLASH2 | 0.14 | ease-out | **Overhead chop**: blade drives down-center (rotation.x −1.2 → 0.9, z → 0.15), grip dips to screen center; hit window p ≥ 0.25 |
| RECOVER2 | 0.20 | ease-in | Back to rest pose |
| COOLDOWN | 0.30 | — | Input ignored; then IDLE |

Constants (new `SWORD.COMBO` block in Constants.js):

```js
SWORD.COMBO = {
  WINDUP1: 0.10, SLASH1: 0.16, RECOVER1: 0.18,
  WINDUP2: 0.08, SLASH2: 0.14, RECOVER2: 0.20,
  COMBO_WINDOW: 0.35,   // from RECOVER1 start (0.18s recover + 0.17s input grace)
  COOLDOWN: 0.30,
  HIT1_DAMAGE: 2, HIT2_DAMAGE: 3,
  ARC1: Math.PI * 0.39,  // ±70°
  ARC2: Math.PI * 0.33,  // ±60°
};
```

`SWORD.RANGE` stays 2.2 base; `SWORD.DAMAGE` removed (replaced by per-hit damage). `WINDUP/SWING/RECOVER/COOLDOWN` legacy keys removed from the SWORD block (grep sweep: `Game._handleSwordAttack` and `PlayerSword.update` are the only consumers).

### 7.3 Hit detection

- **Hit 1** (SLASH1, p ≥ 0.3): cone ±70°, range `SWORD.RANGE × sizeScale`, damage 2. Hits ALL enemies in the cone (multi-hit, like the current pierce).
- **Hit 2** (SLASH2, p ≥ 0.25): cone ±60°, same range, damage 3. Multi-hit.
- Each slash can hit an enemy **once per slash** (per-enemy `hitSet` cleared between slashes). Rat swarm: each rat is a separate target.
- Enemies killed by the sword drop orbs per §5.5 (unchanged drop-on-kill).
- The combo **does not scale damage** with growth — only range scales (size ladder stays visual + reach).

### 7.4 Feedback (soundless visual cues)

| Cue | Implementation | Pool/budget |
|---|---|---|
| Motion trail | 6 pooled glow sprites (`generateGlowTexture`), spawned 2/frame during SLASH1/SLASH2 along the blade arc, additive, opacity 0.5→0 over 0.15 s | 6 sprites |
| Impact sparks | 8 pooled small spheres (Sphere 0.03, MeshBasic 0xffcc88) burst radially at hit point, velocity 3 u/s, gravity 4 u/s², life 0.25 s | 8 |
| Hit-stop | On any sword hit: `hitStop = 0.06 s` — Game scales `dt` to 0 for world updates (camera shake still runs) | — |
| Blade flash | On hit, `bladeMat.emissive` set 0xffdd88 @ 1.2 for 0.1 s, decays to danger-glow value | — |
| Combo feedback | HUD combo pips (§11) + hit 2 spawns a second, tighter spark burst | — |

### 7.5 Integration with existing growth & glow systems

- `setOrbCount()` unchanged: scale = `1 + 0.2 × min(floor(orbs/10), 10)` (cap ×3 at 100 orbs), 11-step color palette, growth green light + glow.
- `range` getter unchanged: `SWORD.RANGE × _rangeScale`.
- Danger glow (red emissive + sprite + `dangerLight`) and growth light (`growthLight` + green sprite) unchanged — both re-parented to the new blade geometry.
- Combo state machine lives inside `PlayerSword`; `Game._handleSwordAttack` consumes `sword.attack()` (edge-triggered RMB), `sword.isSwinging` (hit windows), `sword.comboStep` for HUD.

---

## 8. Lighting

### 8.1 New light sources (6)

All new lights **never cast shadows** (shadow budget is reserved for the existing nearest-8 torches). Each has its own shared geometry/material pool per level.

| # | Light | Geometry | Color | Intensity | Distance | Decay | Flicker/animation | Shadow | Biomes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Candle | body Cyl 0.04×0.18 + flame Cone 0.03×0.08 | 0xffaa55 | 0.6 | 5 | 1.8 | flame scale 0.9–1.15 @ 8 Hz | no | all except fungal |
| 2 | Chandelier | ring Torus 0.5×0.04 + 3 arms/flames | 0xff9944 | 0.5 (×3 lights) | 6 | 1.8 | rotate 0.05 rad/s, flame flicker | no | all except fungal |
| 3 | Lava pool | emissive plane + glow sprite | 0xff5522 | 2.2 | 9 | 1.5 | intensity ±10% @ 3 Hz, sprite pulse | no | volcanic |
| 4 | Glowing mushroom | cap Cone 0.18×0.1 emissive | 0x44ff88 | 1.2 | 6 | 1.7 | cap scale ±10% @ 1.5 Hz | no | fungal |
| 5 | Will-o'-wisp | sprite 0.3 + core Sphere 0.05 | 0x88ffcc | 1.0 | 7 | 1.8 | **moving**: patrols a circle radius 2 at 0.5 u/s, y 1.2, sine bob | no | crypt |
| 6 | Ice crystal lamp | cluster of 3–5 Cones 0.1–0.2 × 0.5–1.2 | 0x66ccff | 1.4 | 7 | 1.5 | emissive pulse ±15% @ 0.8 Hz | no | frozen |
| 7 | **Player headlight** | (attached to camera, no geometry) | 0xffdd99 | 2.6 | 9 | 1.6 | constant; moves with the player | no | all |

### 8.2 Integration with the shadow budget

`LightingSystem._updateShadowCasting` keeps exactly the existing logic: only torches enter the nearest-8 sort; new light types have `castShadow = false` at construction and are never re-enabled. Total shadow-casting lights per level: **8 max**. New lights are added to `this.lights` arrays with `dispose()` handling (geometry/material/light disposed on regen).

### 8.3 Placement rules

- Candles: LIBRARY 6, CRYPT 4, HALL 2, ARMORY 2, else 0. Never on exit cell.
- Chandeliers: 1 per HALL/VAULT/ARENA (not fungal).
- Lava pools: 1–2 per volcanic room, ≥ 3 u from exit marker.
- Glowing mushrooms: 3 clusters per MUSHROOM_GROVE, 1 per other fungal room.
- Will-o'-wisps: 1–2 per CRYPT room, patrol center = room center.
- Ice crystal lamps: 2 clusters per frozen room.
- All new lights ≤ 20 total per level (torches ~30 are already present; new lights are additive but no shadows, cheap).

---

## 9. Architecture

### 9.1 Updated file tree

```
src/
  core/
    Constants.js          [CHANGED — new blocks: BIOMES, ENEMIES, SWORD.COMBO, PROPS, LIGHT_SOURCES]
    GameState.js          [CHANGED — biome, combo, hitStop fields]
    Game.js               [CHANGED — combo consumption, hit-stop, biome init, HUD]
    Collision.js          [unchanged]
    Leaderboard.js        [unchanged]
    EventBus.js           [NEW — tiny pub/sub]
  world/
    DungeonGenerator.js   [CHANGED — 8 room types, biome-aware weights]
    WorldBuilder.js       [CHANGED — biome-tinted textures, prop AABBs into collision list]
    Textures.js           [CHANGED — tinted wall/floor/ceiling generators, web + splatter textures]
    BiomeSystem.js        [NEW — palette, progression, texture caching]
    PropSystem.js         [NEW — props/decorations, InstancedMesh, breakables]
  entities/
    OrbSystem.js          [unchanged]
    OrbShooter.js         [unchanged]
    PlayerSword.js        [CHANGED — new geometry, combo state machine, trail, sparks]
    SkeletonSystem.js     [CHANGED — becomes EnemySystem facade over registry]
    enemies/
      BaseEnemy.js        [NEW — shared hp/state/update/hit/death]
      Skeleton.js         [MOVED from entities/ — extends BaseEnemy]
      ArmoredSkeleton.js  [NEW]
      ArcherSkeleton.js   [NEW]
      RatSwarm.js         [NEW]
      Brute.js            [NEW]
      Wraith.js           [NEW]
      EnemyRegistry.js    [NEW — per-biome weight table, spawn factory, elites]
  systems/
    LightingSystem.js     [CHANGED — new light types, wisp movement]
    SmokeSystem.js        [unchanged]
    ParticleSystem.js     [unchanged (dust) + NEW spark pool]
    RuneSystem.js         [unchanged]
    PostProcessing.js     [unchanged]
    InputSystem.js        [unchanged]
index.html                [CHANGED — HUD elements]
docs/SPEC.md              [this document]
scripts/dungeon-check.mjs [unchanged — acceptance criteria depend on it]
```

### 9.2 Module responsibilities

- `EnemyRegistry` owns the per-biome spawn-weight table (§5.4), elite rolls, and constructs enemy instances via `BaseEnemy` subclasses. `SkeletonSystem` is renamed conceptually to the enemy spawner: `Game` calls `enemies.spawnLevel(dungeonData, state)` once per level.
- `PropSystem.place(dungeonData, biome)` returns `{ collisionBoxes }` appended to `WorldBuilder`'s list BEFORE `EnemyRegistry` spawns (pathing respects pillars/bookshelves/sarcophagi).
- `BiomeSystem` is consulted by `WorldBuilder` (textures), `LightingSystem` (light colors), `PropSystem` (prop sets), `EnemyRegistry` (weights).

### 9.3 EventBus events

`EventBus` = 30-line pub/sub (`on`, `off`, `emit`), instance created in `Game` constructor, passed to systems. Events:

| Event | Payload | Emitted by |
|---|---|---|
| `level:start` | `{ level, biome }` | Game |
| `biome:change` | `{ biome, biomeIndex }` | Game (on regen when biome differs) |
| `enemy:spawned` | `{ type, elite, x, z }` | EnemyRegistry |
| `enemy:killed` | `{ type, elite, x, z, orbs }` | BaseEnemy death |
| `player:damaged` | `{ amount, source }` | EnemySystem |
| `player:death` | `{}` | EnemySystem |
| `orb:collected` | `{ count }` | OrbSystem |
| `prop:broken` | `{ type, x, z }` | PropSystem |
| `sword:hit` | `{ step, enemiesHit, damage }` | Game (`_handleSwordAttack`) |
| `sword:combo` | `{ step }` | PlayerSword |

HUD subscribes in `Game`; no other coupling. Existing callback wiring (`onKill`, `onPlayerDamaged`, etc.) migrates to events.

### 9.4 Constants plan

New domain blocks in `Constants.js` (no inline magic numbers):

```js
BIOMES = { SEQUENCE: [...], STONE: {...palette}, HAUNTED_CRYPT: {...}, ... } // palette per §4.2
ENEMY = { SPAWN_MIN_DIST: 6, BASE_SLOTS: 2, SLOTS_PER_LEVEL: 1, MAX_SLOTS: 10, ARENA_EXTRA_SLOTS: 2, MAX_ALIVE: 16, RAT_PACK_MIN: 4, RAT_PACK_MAX: 6, RAT_CAP: 12, ELITE_CHANCE: 0.1, ... }
ARMORED = { HP: 5, SPEED: 1.8, DMG: 2, RANGE: 1.7, WINDUP: 0.5, SWING: 0.3, RECOVER: 0.5, COOLDOWN: 1.6, DROP: 2 }
ARCHER = { HP: 2, SPEED: 2.4, DMG: 1, PREF_DIST: 8, RETREAT_DIST: 4, RETREAT_SPEED: 2.0, RANGE: 10, WINDUP: 0.5, SWING: 0.1, RECOVER: 0.4, COOLDOWN: 1.8, ARROW_SPEED: 8, ARROW_LIFE: 3, ARROW_RADIUS: 0.15, DROP: 1 }
RAT = { HP: 1, SPEED: 4.2, DMG: 1, RANGE: 0.9, COOLDOWN: 0.8, DROP: 0 }
BRUTE = { HP: 8, SPEED: 1.2, DMG: 3, RANGE: 2.4, ARC: 0.87, WINDUP: 1.2, SWING: 0.3, RECOVER: 1.2, COOLDOWN: 2.5, DROP: 3 }
WRAITH = { HP: 2, SPEED: 2.4, DMG: 1, RANGE: 0.9, COOLDOWN: 1.0, DROP: 2, BOB_AMP: 0.15, BOB_FREQ: 2 }
ELITE = { ARMORED: { HP: 10, SPEED_MULT: 1.3, DROP: 3 }, ARCHER: { DROP: 2 }, BRUTE: { HP: 16, SPEED_MULT: 1.2, DROP: 4 }, WRAITH: { HP: 4, SPEED_MULT: 1.4, DROP: 3 } }
PROPS = { BREAKABLE_HP: 1, LAVA_DAMAGE: 1, LAVA_INTERVAL: 0.8, LAVA_RADIUS: 1.2, SARCOPHAGUS_WRAITH_CHANCE: 0.3, ... }
LIGHT_SOURCES = { CANDLE: {...}, CHANDELIER: {...}, LAVA: {...}, MUSHROOM: {...}, WISP: {...}, ICE: {...} } // per §8.1
SWORD.COMBO = { ... } // per §7.2
HIT_STOP = 0.06
```

`SKELETON` and `MAGICIAN` blocks keep their numbers (now duplicated into `ENEMY` tables only where registry needs them — registry references the existing constants, no duplication).

---

## 10. GameState schema

```js
{
  player: { x, y, z, yaw, pitch },   // unchanged
  collectedOrbs, totalOrbs, health, invulnTimer, visitedCells,
  dungeonSeed, effectsEnabled, minimapVisible, pointerLocked,
  inExitRoom, runTime, level, levelTime,
  // NEW:
  biome: 'STONE',        // current biome id (string key of BIOMES)
  biomeIndex: 0,         // floor((level-1)/2) % 5
  swordCombo: 0,         // 0 | 1 | 2 — current combo step for HUD
  hitStop: 0,            // seconds of world-freeze remaining (Game-managed)
}
```

No charges/stamina/keys added. `totalOrbs` remains 0 (drop-only economy, unchanged).

---

## 11. HUD

| Indicator | Position | Content | Update rule |
|---|---|---|---|
| Orbs (existing) | top-left | `Orbs: N` | per-frame; unchanged |
| Hearts (existing) | top-left below orbs | `♥♥♥` | per-frame; unchanged |
| Timer (existing) | top-right | `Lv N · mm:ss · total · best` | per-frame; unchanged |
| **Biome label** | top-center | Biome name (e.g. `FUNGAL CAVERN`) + colored underline matching palette fog | on `level:start` / `biome:change` |
| **Combo pips** | under crosshair | `▮` pips: 1 lit after hit 1, 2 lit after hit 2; dims 0.4 s after window closes | on `sword:combo` + timer |
| **Sword size** | orb line suffix | `Orbs: 12 · ×1.4` | per-frame; scale read from `sword.scale` (new getter exposing `_rangeScale`) |
| Damage flash (existing) | fullscreen | red vignette flash | unchanged |
| Messages (existing) | top-center stack | toasts | unchanged; new toasts: `ARMORY found`, `A sarcophagus stirs…`, `Wraith!` (first sighting per level) |
| Exit prompt (existing) | center | `[E] to descend` | unchanged |
| Leaderboard (existing) | Tab / game over | unchanged | unchanged |

All new elements are static-positioned divs in `index.html`; no new framework, no canvas HUD.

---

## 12. Performance targets

Target: **60 FPS on mid-range hardware** (integrated GPU, e.g. Intel Iris Xe / Vega 8 at 1080p).

| Budget | Limit | Notes |
|---|---|---|
| Shadow-casting lights | **8 max** | nearest-8 torches only; all new lights `castShadow=false` |
| Total point lights (all) | ≤ 140 | base game ~90 (torches ~82 + braziers/crystals ~8 + start/exit 2) + new lights ≤ 20 + player headlight 1. All shadow-free; forward-rendered point lights are cheap |
| Shadow map size | 256 × 256 per torch | existing |
| Draw calls | ≤ 120 | InstancedMesh collapses decorative props |
| Prop instances / level | ≤ 400 | InstancedMesh: skull piles, stalactites, books, ice crystals, mushrooms |
| Smoke pool | 180 | existing |
| Dust particles | 600 | existing |
| Spark pool | 8 | new (sword impact) |
| Sword trail sprites | 6 | new (pooled) |
| Enemy projectiles (arrows) | 10 | pooled |
| Magician orbs | 12 | existing |
| Player orbs | 24 | existing |
| Enemies alive (max) | 16 total bodies | spawn slots ≤ 10 (+2 in ARENA); rats ≤ 12, counted individually |
| Rat cap alive | 12 | |
| Texture memory | ≤ 16 MB | 5 biome sets × 3 × 256 px + web/splatter/glow/runes |
| Per-frame allocation | 0 | all pools pre-allocated (rings, projectiles, sparks, trail, debris shards) |

InstancedMesh rules: every purely decorative repeated prop (skull piles, stalactites, books, ice crystals, mushroom clusters, candles, webs) is one InstancedMesh per prop type per level with per-instance `matrix` set at placement; `instanceMatrix.needsUpdate` only on break/removal. Breakables are individual meshes (max 3/room, ≤ ~36 level) — not instanced.

---

## 13. Edge cases & state handling

| # | Edge case | Resolution |
|---|---|---|
| 1 | Biome changes mid-level | Impossible — biome fixed at regen; `biome:change` fires only on descend |
| 2 | Level 11+ re-enters STONE biome | Full 7-enemy roster available; weights per STONE column; level scaling keeps difficulty |
| 3 | Rat pack exceeds cap 12 | Remaining rats of the pack despawn immediately (no drops) |
| 4 | Brute slam interrupted by death | Death animation plays; slam AOE never resolves (hit only applies at swing p ≥ 0.4, checked alive) |
| 5 | Wraith inside a wall when player is unreachable | Wraith phases — always reaches player; no stuck state possible (no collision) |
| 6 | Sarcophagus opens on a wall-adjacent cell | Wraith spawns 1 u toward room center; orb drops at sarcophagus front; if blocked, spawn at nearest free cell |
| 7 | Lava pool overlaps exit marker | Excluded by placement rule (≥ 3 u) |
| 8 | Combo input during COOLDOWN / hit-stop | Ignored; combo resets after 0.3 s; hit-stop doesn't consume inputs (input read from raw event state) |
| 9 | Combo window expires mid-RMB-hold | `attack()` is edge-triggered on `isMouseDown(2)` transition, not hold — no accidental re-swing |
| 10 | Player descends while combo active | `swordCombo` reset to 0; PlayerSword state reset on `level:start` |
| 11 | Elite spawns in exit room | Excluded — same exit-room exclusion as all spawns (existing rule) |
| 12 | Armored skeleton block (no damage this hit) | No block mechanic — armor is HP only; all hits apply |
| 13 | Orb weapon hits a breakable barrel | Barrel breaks (any damage source), projectile continues (no consume) |
| 14 | Sword hits barrel + enemy same slash | Both damaged; hit-stop triggers once (per slash) |
| 15 | Player stands in lava while invulnerable | i-frame window (0.8 s) prevents damage stacking; lava damage 1 per 0.8 s tick |
| 16 | Will-o'-wisp patrols into a wall | Wisps are light-only, no collision; **bounce** (reverse direction) when the patrol position exits the room bounds |
| 17 | Breakable prop blocks corridor | Props never spawn in corridors (rule §6.1) |
| 18 | dungeon-check.mjs regressions | Prop AABBs excluded from the script's box model (script mirrors walls only); criteria unchanged: broken=0/40 |
| 19 | Rat spawn slot but no valid cell | Slot consumed, pack skipped (counts against spawn budget) |
| 20 | Hit-stop at 0 fps frame (dt spike) | `hitStop` decremented by raw delta; world dt = 0 while > 0; capped 0.06 s so a 0.1 s frame can't freeze twice |
| 21 | Growth color step changes mid-combo | `setOrbCount` runs per-frame in HUD; only `bladeMat.color` changes — safe mid-swing |
| 22 | New light pool on regen | All new light geometries/materials disposed in `LightingSystem.dispose()`; no cross-level leaks. Verified: `dispose()` removes torch lights AND ambient from the scene (both were leaking in the base game — fixed in Phase 8) |

---

## 14. Color palette

All colors introduced (or reused) by this extension:

| Hex | Element | Use |
|---|---|---|
| 0x3a3a4a / 0x2a2a35 / 0x1a1a25 | Stone wall/floor/ceiling | existing (base) |
| 0x0a0a15 | Stone fog | existing |
| 0x2e2e3e / 0x20202c / 0x14141c | Crypt wall/floor/ceiling | §4.2 |
| 0x060610 | Crypt fog | §4.2 |
| 0x88ddff | Crypt torch/cold light | §4.3 |
| 0x88ffcc | Will-o'-wisp light + body | §8.1 |
| 0x2a3a2e / 0x1e2a22 / 0x141e18 | Fungal wall/floor/ceiling | §4.2 |
| 0x0a140e | Fungal fog | §4.2 |
| 0x44ff88 | Glowing mushroom light + cap | §8.1 |
| 0x3a2420 / 0x2a1814 / 0x1e100e | Volcanic wall/floor/ceiling | §4.2 |
| 0x1a0a06 | Volcanic fog | §4.2 |
| 0xff5522 | Lava light + emissive | §8.1 |
| 0x3a4654 / 0x28303c / 0x1a2028 | Frozen wall/floor/ceiling | §4.2 |
| 0x0c1220 | Frozen fog | §4.2 |
| 0x66ccff / 0x9ad8ff | Ice crystal light / crystal body | §8.1 |
| 0xffaa55 | Candle flame + light | §8.1 |
| 0xff9944 | Chandelier light + flame | §8.1 |
| 0xd8c8a0 | Candle body | §6.1 |
| 0xc8ccd8 | Sword steel blade | existing |
| 0x9a9ea8 | Sword fuller | §7.1 |
| 0xd8b44a | Sword pommel brass | §7.1 |
| 0x4a3a28 | Sword grip/crossguard | existing |
| 0x9a9282 / 0x5a5a66 / 0x4a4a55 | Armored skeleton bone/plate/shield | §5.3 |
| 0xff5533 | Armored eye glow | §5.3 |
| 0xb8b0a0 / 0x2a2a35 | Archer bone/hood | §5.3 |
| 0xffcc88 | Arrow tip glow (telegraph) | §5.3 |
| 0x8a8070 / 0x3a2a1a / 0x4a3a2a | Brute bone/tunic/club | §5.3 |
| 0xff8830 | Brute club telegraph flash | §5.3 |
| 0xff4422 | Brute eye glow | §5.3 |
| 0x88ffcc / 0xccffdd | Wraith body/eyes | §5.3 |
| 0xff88cc | Banshee (elite wraith) body | §5.3 |
| 0x5a4a3a / 0x4a3a2a | Rat body/head | §5.3 |
| 0xff2211 | Rat eyes | §5.3 |
| 0x6a4a2a / 0x7a5a3a | Barrel / crate wood | §6.1 |
| 0x4a4a52 | Hanging chain | §6.1 |
| 0x8a7a5a | Mushroom stem | §6.1 |
| 0x3a3a3a | Barrel bands / chain | §6.1 |
| 0xcfc6b0 | Skull pile bone | existing |
| 0x3a4a3e / 0x4a3a30 / 0x8ac0d8 | Stalactite tints (fungal/volcanic/frozen) | §6.1 |
| 0x2a3a2a | Roots/vines | §6.1 |
| 0x5a3a2a / 0x3a2a1a | Bookshelf wood / shelves | §6.1 |
| 0x6a6a5a | Sarcophagus | §6.1 |
| 0x3a0a0a | Blood stain | §6.1 |
| 0xffdd88 | Sword impact flash (blade emissive) | §7.4 |
| 0xffcc88 | Impact sparks | §7.4 |

---

## 15. Acceptance criteria

Ordered by implementation phase. Each is independently testable; **P0 gate: `node scripts/dungeon-check.mjs` still reports `broken=0/40`** after every phase.

### Phase 0 — Architecture scaffolding
- [A0.1] `EventBus` exists with `on/off/emit`; Game emits `level:start` with `{ level, biome }`.
- [A0.2] `GameState` gains `biome`, `biomeIndex`, `swordCombo`, `hitStop`; defaults valid for level 1 (`STONE`, 0, 0, 0).
- [A0.3] `dungeon-check.mjs` still passes 0/40 broken.

### Phase 1 — Biomes
- [A1.1] Levels 1–2 generate STONE palette (existing textures unchanged), 3–4 HAUNTED_CRYPT, 5–6 FUNGAL_CAVERN, 7–8 VOLCANIC_DEPTHS, 9–10 FROZEN_HALLS, 11–12 STONE again.
- [A1.2] Each biome's wall/floor/ceiling tint, fog color/density, and ambient match §4.2 (visual check).
- [A1.3] `BiomeSystem` caches exactly 5 texture sets; regen reuses cache (no leak — verified via `LightingSystem.dispose` path).

### Phase 2 — Room types
- [A2.1] All 8 room types appear across seeds; per-biome weight modifiers applied (§3.3).
- [A2.2] ARMORY spawns with 4 weapon racks + 2–3 barrels; LIBRARY with 6–8 bookshelves + 6 candles.
- [A2.3] CRYPT spawns 2–3 sarcophagi + will-o'-wisps; MUSHROOM_GROVE with 3–4 mushroom clusters.
- [A2.4] ARENA is 4×4, spawns 4 pillars, guarantees an elite in its first spawn roll.

### Phase 3 — Enemies
- [A3.1] Armored Skeleton: HP 5, speed 1.8, damage 2, block-free; Warlord elite 1-in-10 (HP 10, ×1.3 speed, 3 orbs).
- [A3.2] Archer Skeleton: keeps 8 u, retreats under 4 u, arrow speed 8 u/s, 1 dmg, draw telegraph 0.5 s; Sharpshooter fires 2-arrow fan.
- [A3.3] Rat Swarm: packs of 4–6, cap 12, speed 4.2, HP 1, 0 drops; no elite.
- [A3.4] Brute: HP 8, slam windup 1.2 s with club flash, damage 3, shockwave ring visual, drops 3; Ogre elite HP 16.
- [A3.5] Wraith: phases through walls, 2.4 u/s, touch 1 dmg, HP 2, drops 2; Banshee elite HP 4.
- [A3.6] Per-biome spawn weights match §5.4 (100 per biome); elite roll 1-in-10; level scaling (+5% speed/attack per 3 levels) applies to all.
- [A3.7] Skeleton + Magician behavior unchanged (regression).

### Phase 4 — Props & decorations
- [A4.1] Barrels/crates break on any damage (orb or sword), spawn debris + smoke, no drop.
- [A4.2] Sarcophagus: lid opens on first proximity, 30% wraith spawn, guaranteed orb, one-time.
- [A4.3] Lava pool damages 1 per 0.8 s within 1.2 u; i-frames respected; never on exit.
- [A4.4] Pillars/bookshelves block movement (collision AABBs in pathing); props never block corridors.
- [A4.5] InstancedMesh counts ≤ 400 instances/level; single draw call per prop type (verified via `renderer.info`).

### Phase 5 — Lighting
- [A5.1] Candles, chandeliers, lava pools, mushrooms, wisps, ice lamps all emit light per §8.1 params.
- [A5.2] Will-o'-wisps move (patrol circle r 2, 0.5 u/s) and bounce at room bounds.
- [A5.3] Shadow-casting lights ≤ 8 at all times (torches only) — verified by iterating scene lights.
- [A5.4] Total point lights ≤ 140 (verified: ~90 base + ≤ 20 new + 1 headlight); new light resources disposed on regen (no leak).

### Phase 6 — Sword
- [A6.1] Sword geometry matches §7.1 (curved two-segment blade, fuller, crossguard, brass pommel).
- [A6.2] RMB triggers WINDUP1→SLASH1 (dmg 2, ±70°, multi-hit); RMB inside 0.35 s window chains WINDUP2→SLASH2 (dmg 3, ±60°); else cooldown 0.3 s.
- [A6.3] Trail sprites spawn during slashes; impact sparks on hit; hit-stop 0.06 s; blade flash 0.1 s.
- [A6.4] Growth unchanged: +20%/10 orbs, cap ×3 at 100, 11 color steps, range scales, green growth light.
- [A6.5] Combo resets on level regen; no input buffering through hit-stop.

### Phase 7 — HUD & integration
- [A7.1] Biome label shows correct name + fog color per level.
- [A7.2] Combo pips reflect swordCombo (0/1/2) and dim after window.
- [A7.3] Orb line shows `×N.N` sword scale.
- [A7.4] New toasts fire (ARMORY, sarcophagus, wraith first-sighting).
- [A7.5] Full run: descend through all 5 biomes (10 levels) with no console errors, no leaks (memory stable over 3 descends).

### Phase 8 — Performance
- [A8.1] 60 FPS on mid-range (measured with `renderer.info`: draw calls ≤ 120, lights ≤ 60).
- [A8.2] Zero per-frame allocations in hot paths (projectiles, rings, sparks, trail — pools only).
- [A8.3] `dungeon-check.mjs` final gate: broken=0/40.

---

## 16. What's NOT in scope

- **Audio** (no sound system; visual cues only).
- **Save/continue runs** — leaderboard persists, runs are single-session.
- **New frameworks / build tooling** — Vite + raw Three.js only; new deps only if strictly necessary (none required by this spec).
- **File textures** — procedural canvas generation only.
- **Multiplayer / co-op**.
- **Minimap rendering** (`minimapVisible` state flag stays unused, as today).
- **Charged sword attack, parry/block, weapon switching** — combo is the only sword mode.
- **Mimic, cultist, bat swarm, slime enemies** — listed in the pool but not selected; can be added later without breaking this spec.
- **Treasury, shrine, torture chamber, ice gallery, lava fissure room types** — not selected.
- **Arcane library / catacombs biomes** — not selected (5-biome cycle covers progression).
- **Boss fights / end-of-ladder finale** — the biome cycle is endless; difficulty scales with level.
- **Procedural room geometry** (non-rectangular rooms) — stays grid-based.
- **Player progression beyond orb-sword growth** (no XP, no talents, no inventory).
