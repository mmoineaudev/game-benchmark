# Procedural Roguelite Dungeon Crawler — Pixel-Retro 3D (Three.js + Vite)

## Concept

A top-down 3D dungeon crawler with roguelite permadeath and meta-progression. Every run generates a unique multi-floor dungeon — rooms connected by corridors, filled with enemies, traps, treasure, and a guaranteed path to the exit stairs. Think GameCube-era Zelda dungeons meets The Binding of Isaac, rendered in low-poly 3D with pixel-retro shaders and bloom.

The camera is an angled top-down third-person view (like Diablo or Hades), following the player through procedurally-connected rooms. The dungeon is a grid of rooms at each floor level, with corridors between them. Each floor has a fixed number of rooms (5-8 for MVP), the last of which contains the stairs down.

## Visual Style

- **GameCube pixel-retro 3D** — low-poly geometry, flat-shaded or vertex-colored. Think Wind Waker dungeons but darker. Limited color palette per biome (earth tones for crypt, blues/cyan for ice, reds/oranges for lava).
- **Angled top-down camera** — 45-60 degree angle, follows player. Room interiors are visible with walls that lower or become transparent when the player enters (classic dungeon crawler camera trick). Alternatively, use a true 3D camera that clips through near walls.
- **Fog** — distance fog in each room. Close rooms feel moody and atmospheric; distant geometry fades. Fog color matches the biome.
- **Bloom** — subtle bloom on glow elements (torches, magic effects, health pickups, portal to next floor). Keeps the retro glow without washing out the scene.
- **Dynamic lighting** — the player carries a small torch/glow that lights the immediate area. Torches on walls provide ambient light. Dark rooms exist where only the player's light reveals enemies.
- **Enemies** — low-poly geometric creatures (spheres, boxes, cones, octahedra) with fresnel rim shaders. Colored edges pop against dark stone floors.
- **Player** — a simple low-poly knight/character: body, head, shield arm, sword arm, legs. Named children for animation hooks (`_body`, `_head`, `_swordArm`, `_shieldArm`, `_legs`). Idle bob, walk cycle, attack swing, hurt stagger.
- **Dungeon architecture** — floors are tiled with a grid texture (stone/moss/ice/lava pattern). Walls are extruded boxes or merged geometry. Doors are archways with a different colored frame. Corridors are 2-3 tiles wide with wall sconces.

## Tech Stack

- Vite + Three.js (ES modules, no bundler complexity)
- `src/` directory structure following game-architecture patterns
- PostProcessing via three/addons (`EffectComposer`, `UnrealBloomPass`, `RenderPass`)
- No physics engine — simple AABB collision on the 2D grid (player and enemies move in the XZ plane)
- All constants in `Constants.js` — zero magic numbers in game logic
- All cross-module communication via `EventBus.js` (singleton, `domain:action` format)
- Game state in `GameState.js` (singleton, clean `.reset()`, persistent meta-progression in localStorage)
- Systems: `Input.js`, `Player.js`, `Camera.js`, `DungeonGenerator.js`, `RoomManager.js`, `EnemyManager.js`, `LootManager.js`, `MetaProgression.js`, `UIManager.js`
- Orchestrator: `Game.js` — initializes all systems, main loop, state machine (BOOT → HUB → DUNGEON → DEATH → HUB)

## Core Mechanics

### Movement (top-down XZ plane)
- WASD movement in 8 directions, relative to camera angle (so W always moves "up" on screen)
- Dodge roll (Space) — brief invincibility frames, short dash in movement direction, cooldown ~2s
- Attack (left click or E) — melee swing in facing direction, hitbox is an arc in front of player
- Interact (F) — open chests, pick up items, descend stairs
- All input bound by `event.code` for AZERTY/QWERTY compatibility

### Procedural Dungeon Generation

1. **Floor layout** — a grid of rooms (e.g. 5x5 for small, 7x7 for larger). Each floor picks N rooms from a pool and places them with guaranteed connectivity.
2. **Room types**:
   - **Spawn room** — safe, no enemies, has a shopkeeper or starting gear pedestal
   - **Combat room** — 3-8 enemies of 1-2 types, some with environmental hazards (spikes, pits)
   - **Treasure room** — 0-1 enemies, guaranteed chest with weapon/upgrade/gold
   - **Challenge room** — locked until cleared, harder enemies, better reward (e.g. heart container)
   - **Shop room** — NPC vendor, spend gold on upgrades between floors
   - **Boss room** — unique boss enemy, 2 attack patterns, guaranteed ability upgrade or heart container
   - **Exit room** — stairs down to next floor (always placed last in the guaranteed path)
3. **Connectivity guarantee** — A* path from spawn to exit via a spanning tree algorithm. Fill remaining cells with optional rooms. Corridors connect adjacent rooms.
4. **Room templates** — each room type has 3-5 layout templates (wall positions, pillar positions, door positions, enemy spawn points, chest positions). Template choice is random per generation.
5. **Difficulty scaling** — each floor increases enemy count, enemy HP, enemy speed, trap density. Every 5 floors is a "boss floor" with a major challenge.

### Room Templates (data-driven)

```javascript
const ROOM_TEMPLATES = {
  combat: [
    { width: 7, height: 7, walls: [[1,1,1,5], [5,1,1,5]], pillars: [[3,3]], enemies: [{ type: 'grunt', x: 2, y: 2 }, { type: 'grunt', x: 4, y: 4 }], doors: { north: [3,0], south: [3,6] } },
    { width: 9, height: 7, walls: [[2,2,1,3], [6,2,1,3]], pillars: [[4,3], [4,5]], enemies: [{ type: 'grunt', x: 1, y: 3 }, { type: 'ranged', x: 7, y: 3 }], doors: { west: [0,3], east: [8,3] } },
    // more templates...
  ],
  treasure: [
    { width: 5, height: 5, walls: [], pillars: [], enemies: [], chests: [{ x: 2, y: 2, loot: 'gold_50' }], doors: { south: [2,4] } },
    // more templates...
  ],
  // ... spawn, shop, challenge, boss, exit
};
```

Each template defines wall segments (x, z, width, depth), pillar positions, enemy spawns, chests, door positions. Walls and pillars are extruded boxes. Floor is a plane with a grid texture.

### Combat & Loot

- Player has 3 base hearts (HP), can upgrade to 5 via heart containers from bosses
- Player has a starting weapon (short sword, slow but wide arc)
- **Weapon drops**: broadsword (wide arc, slow), dagger (narrow arc, fast, 3-hit combo), spear (long reach, narrow), hammer (slow, wide, stuns)
- **Passive items**: speed boots (faster move), thornmail (reflect damage), lifesteal ring (heal on kill), magnet (wider pickup range)
- **Consumables**: health potion (heal 1 heart, max 3 carried), bomb (breaks cracked walls, damages enemies), key (opens locked doors/chests)
- **Gold**: dropped by enemies, found in chests. Persists across runs (meta-progression currency)
- Enemies drop loot on death with probability: 50% gold, 20% consumable, 5% equipment, 25% nothing
- Rarity tiers: common → rare → legendary. Legendary items have a unique glow effect (golden rim shader).
- Equipment found mid-run is lost on death. Only gold persists.

### Meta-Progression (Roguelite Hub)

Between runs, the player is in a **Hub** (a single safe room with NPCs):
- **Blacksmith** — spend gold to unlock better starting weapons for future runs (daggers at 100g, broadsword 150g, spear 200g, hammer 300g)
- **Merchant** — spend gold to unlock starting consumables (always start with 1 health potion for 50g, start with 2 bombs for 75g)
- **Trainer** — spend gold to upgrade base stats (start with +1 heart for 200g, start with speed bonus for 150g)
- **Shrine** — spend gold to raise / lower difficulty modifiers (enemy HP multiplier, gold drop multiplier)
- The Hub is rendered in 3D with the same visual style — a cozy dungeon chamber with NPC stands and ambient torches

Meta-progression is stored in `localStorage`. On first run, the player starts with nothing (short sword, 3 hearts, no items).

### Enemy Types

| Type | Shape | Behavior | HP | Damage |
|------|-------|----------|----|--------|
| Grunt | Box + 4 cone spikes | Patrols a path, charges when player is in range | 2 | 1 |
| Ranged | Octahedron + eye | Keeps distance, fires slow projectile | 1 | 1 |
| Shield | Sphere + torus shield | Blocks frontal attacks, flank to damage | 3 | 1 |
| Sprinter | Cone (forward) | Dashes toward player, pauses after miss | 2 | 1 |
| Exploder | Spiky sphere | Rushes player, explodes (damages nearby enemies too) | 1 | 2 |
| Boss (Floor 5) | Large dodecahedron + horns + eye | Phase 1: charge + AoE slam. Phase 2: spawns grunts. | 8 | 2 |
| Boss (Floor 10) | Large sphere + rotating spike ring | Phase 1: spinning spike attack + projectile burst. Phase 2: faster spin + more projectiles | 12 | 2 |

Each enemy has a fresnel rim shader with a unique rim color matching their type.

## Architecture

```
src/
  core/
    Game.js              — orchestrator, main loop, state machine (BOOT/HUB/DUNGEON/DEATH)
    EventBus.js          — singleton, domain:action events
    GameState.js         — singleton, clean .reset(), per-run state (health, items, floor, gold)
    Constants.js         — ALL magic numbers, balance values, timings, enemy defs, item defs
  systems/
    Input.js             — event.code based, camera-relative WASD direction calculation
    Camera.js            — angled top-down follow, smooth lerp, zoom on hub vs dungeon
    DungeonGenerator.js  — procedural floor generation: room graph → template placement → connectivity
    RoomManager.js       — loads/unloads room geometry, manages active room, room transitions
    EnemyManager.js      — spawns enemies per room template, updates AI, handles death/loot
    LootManager.js       — manages item drops, pickups, equipment system, rarity rolls
    ParticleSystem.js    — particle effects (hit sparks, death burst, pickup glow, heal)
    MetaProgression.js   — localStorage persistence, hub upgrade unlocks, gold tracking
  entities/
    Player.js            — movement, dodge roll, attack, damage, death, states (idle/run/dodge/attack/hurt/dead)
    Enemy.js             — generic enemy AI with configurable behavior (patrol/charge/ranged/explode)
    Item.js              — pickups (gold, hearts, keys, bombs, potions, equipment)
    Projectile.js        — enemy ranged attack projectiles
  visuals/
    ModelFactory.js      — procedural geometry builders (player, every enemy type, items, hub NPCs, chests)
    Shaders.js           — custom GLSL: fresnel rim, toon shading, glow pulse, dissolve
    DungeonArchitecture.js — builds room geometry from templates (walls, floor, pillars, doors, torches)
  ui/
    HUD.js               — DOM overlay: hearts, gold counter, current equipment icon, floor number, minimap
    HubUI.js             — DOM overlay: hub NPC interaction panels, upgrade shop, stat display
    DeathScreen.js       — DOM overlay: run summary (floor reached, enemies killed, gold earned), return to hub button
    DamageNumbers.js     — floating DOM text on hits
    ItemTooltip.js       — floating DOM tooltip on hover/loot pickup
    Minimap.js           — DOM canvas: discovered rooms, player position, exit marker, unvisited rooms
```

## Game Flow

```
BOOT → HUB (upgrade shop, equip starting items)
      → ENTER DUNGEON (Floor 1 spawn room)
      → Explore rooms: clear enemies → loot chests → find exit
      → Descend stairs to next floor
      → Repeat until death or final boss
      → DEATH SCREEN (run summary, gold earned)
      → Return to HUB (spend gold on permanent upgrades)
      → Repeat
```

### Room transitions
- Player reaches room edge (north/south/east/west door) → camera slides to next room → enemies in new room activate
- Corridors render as narrow rooms between main rooms
- Stairs: player approaches stair tile → fade to black → spawn on next floor's spawn room
- Hub to dungeon: player approaches dungeon entrance → fade + load Floor 1

## Room transition trick (seamless)

Instead of loading/unloading rooms with visible seams, keep all generated rooms in the scene but only render the current room + adjacent rooms with distance fog hiding the rest. This gives a seamless dungeon feel without loading screens.

Alternatively (simpler MVP): unload the previous room and load the new room with a 0.2s fade. No visible geometry loading stutter if pre-built.

## Scope-Limited MVP

Build this first, nothing more:

1. **Floor 1 only** — 5 rooms (spawn → 2 combat → treasure → exit). Hand-placed templates, not full procedural yet.
2. **2 enemy types**: Grunt (patrol + charge) and Ranged (keep distance + shoot projectile)
3. **3 items**: gold pickup, health pickup, one weapon upgrade (broadsword)
4. **1 boss**: none for MVP (exit room just has stairs, no boss fight yet)
5. **Simple hub**: rendered in 3D, single NPC (blacksmith) with 2 upgrades (start with broadsword for 100g, +1 heart for 200g)
6. **Visual**: 2 room templates per type, fog, bloom, one wall torch light per room, enemy fresnel rim shader
7. **HUD**: hearts (3), gold counter, floor number, equipment slot
8. **Death**: health hits 0 → fade to death screen → show gold earned → press Space → back to hub
9. **Meta-progression**: gold persisted in localStorage, upgrades unlock on next run
10. **Restart**: clean .reset() on new run, all state wiped except meta-progression

## Visual Polish Checklist

- [ ] Enemy fresnel rim shader (dark center, colored edge glow, hit flash)
- [ ] Player hit flash (white overlay on damage, decays over 200ms)
- [ ] Death dissolve (player scales to 0 + fades over 0.4s, enemies same)
- [ ] Hit particles (small colored sparks on weapon impact, additive blending)
- [ ] Gold pickup effect (brief golden ring burst + float to HUD counter)
- [ ] Health pickup effect (red glow pulse + float to HUD heart)
- [ ] Screen shake on player hit (translate jitter from countdown timer)
- [ ] Damage numbers (floating DOM text on hits, color-coded by damage type)
- [ ] Torch light flicker (point light intensity sine wave + slight position jitter)
- [ ] Distance fog (matches biome color, hides room edges)
- [ ] Bloom post-processing (subtle, retro glow on light sources and items)
- [ ] Room transition (camera slide or 0.2s fade)
- [ ] Dodge roll ghost trail (brief afterimage every 50ms during dodge)
- [ ] Weapon swing trail (arc-shaped mesh or particles during attack)
- [ ] Minimap (DOM canvas showing discovered room shapes, doors, player dot)
- [ ] Ambient dust particles (floating specks visible against dark backgrounds)
- [ ] Biome color shift between floors (crypt=earthy browns → ice=blues/cyan → lava=reds/oranges)
- [ ] Item rarity glow (common=no glow, rare=blue rim, legendary=golden rim with rotating halo)

## Pitfalls to Avoid

- **Camera-relative movement wrong** — WASD must be relative to camera angle, not world axes. Compute: `forward = cameraForward projected on XZ plane, right = cameraRight projected on XZ plane`, then `direction = forward * (W-S) + right * (A-D)`, normalize.
- **Room transition ghosting** — deactivate enemies when leaving a room (set their AI to paused/idle state). Reactivate on re-entry. Don't remove them unless the room is far away.
- **Collision resolution order** — resolve player-vs-wall first, then player-vs-enemy, then enemy-vs-wall. If you do it in the wrong order, enemies clip through walls.
- **Dodge roll through enemies** — check `player.isDodging` in enemy collision handler. Skip damage while dodging. Don't skip wall collision during dodge (players expect to bounce off walls).
- **Meta-progression save corruption** — validate the localStorage JSON on load. If it fails to parse, reset to defaults instead of crashing.
- **Gold earned on death** — save gold earned during the run to meta-progression at the moment of death, not during the run. If the player exits the tab mid-run, they lose the run's gold. This is intentional roguelite design.
- **Floor generation performance** — generate the entire floor's room layout at once when the player descends the stairs, not room-by-room. Room geometry can be built lazily when first entered.
- **Item stacking** — equipment is not stackable (one slot, replace on pickup). Consumables stack to 3. Gold is an unbounded counter. Test that picking up gold when you already have gold doesn't eat the pickup.
- **Bloom over-brightness** — tune bloom threshold so torches glow but white geometry doesn't wash out. Start with `threshold: 0.3, strength: 0.6, radius: 0.5`.
- **event.key breaks AZERTY** — use `event.code`. Always.
- **Restart cleanup** — all event listeners, timers, scene children, interval handles must be cleaned on death. Test restart 3x in a row with no console errors.

## Delivery

- Vite + Three.js project in `~/Documents/games-benchmarks/dungeon-crawler/`
- Verify in browser: player moves camera-relatively, attacks, takes damage, picks up items, dies, returns to hub, gold persists
- MVP rooms are selected from a small pool of hand-authored templates, not fully procedural yet
- After MVP works, add full procedural generation in a second pass (random template selection, connectivity algorithm, difficulty scaling per floor)
- Every commit describes the working feature
