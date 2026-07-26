# Procedural Metroidvania — 2D-in-3D (Three.js + Vite)

## Concept

A sidescrolling metroidvania where every playthrough generates a unique interconnected world. The player explores procedurally-connected rooms, gains abilities (double jump, dash, wall jump, etc.), and uses them to reach new areas. Rendered in 3D space using Three.js — think Paper Mario / Trine / Little Big Planet aesthetic: flat gameplay on a 2D plane, but with real 3D depth layers, parallax, volumetric lighting, and particle effects in the background.

The world is a grid of rooms (1-2 screens wide). Rooms connect via left/right doors, vertical shafts, and hidden passages. Abilities unlock new path types (double jump reaches high ledges, dash crosses gaps, missiles break cracked walls, grapple hooks across chasms).

## Visual Style

- **GameCube era pixel-retro** — low-poly geometry with flat/vertex coloring or a toon-shaded look. Think Wind Waker / Luigi's Mansion meets a pixel-art game.
- **2D gameplay plane** — the player, enemies, and platforms exist on a single Z-plane (z=0). Background/foreground layers at z=-5, -10, -15, +5 create depth.
- **Parallax background layers** — 3-4 distant layers (mountains, cavern walls, starfields, machinery) at increasing z-depths, each darker/foggier. Use `THREE.MeshBasicMaterial` with vertex colors or custom shaders for a painterly retro look.
- **Pixel-perfect bloom** — subtle bloom post-processing tuned for a nostalgic glow, not modern realism. Keep it low-key so sprites don't blow out.
- **Dynamic lighting** — player emits a small point light; certain room elements (save points, ability pickups, glowing mushrooms) emit ambient light. Dark rooms exist where only the player's light cone reveals the terrain.
- **Enemies** — simple low-poly geometry (spheres, boxes, cones, octahedra) with fresnel rim shaders (from the tower defense playbook) so they pop against dark caves.
- **Player character** — a simple low-poly humanoid or geometric creature with a few named mesh children (`_body`, `_head`, `_armL`, `_armR`, `_legs`). Idle bob, run cycle (scale oscillations), double-jump spin, dash stretch.

## Tech Stack

- Vite + Three.js (importmap or npm, no bundler complexity)
- Single `src/` directory with ES modules
- PostProcessing via three/addons (`EffectComposer`, `UnrealBloomPass`, `RenderPass`)
- No physics engine — simple AABB collision on the 2D plane
- All constants in `Constants.js` — zero magic numbers in game logic
- All cross-module communication via `EventBus.js` (singleton, `domain:action` format)
- Game state in `GameState.js` (singleton, clean `.reset()`)
- Systems: `Input.js`, `Player.js`, `Camera.js`, `RoomManager.js`, `EnemyManager.js`, `AbilityManager.js`, `UIManager.js`, `ProceduralGenerator.js`
- Orchestrator: `Game.js` — initializes all systems, runs the main loop (`requestAnimationFrame`), handles state transitions

## Core Mechanics

### Movement (2D plane)
- Left/Right walk, Jump, Double Jump (after ability), Dash (after ability), Wall Slide/Wall Jump (after ability)
- Momentum-based movement (acceleration + friction, not instant velocity)
- Coyote time (~4 frames after leaving a ledge) and jump buffering (~6 frames before landing)
- All input bound by `event.code` for AZERTY/QWERTY compatibility

### Procedural Room Generation
1. Start with a required set of rooms: spawn, 3-4 exploration rooms, 1 ability room, 1 boss room
2. Connect them in a tree that guarantees the player can reach the boss after getting the key ability
3. Fill remaining slots with optional rooms (treasure, challenge, shortcut, lore)
4. Each room type has a set of templates (platform layouts, enemy spawns, secrets)
5. Room content is assembled from prefab chunks: floor segments, wall segments, platform blocks, pit blocks, door blocks
6. Doors are marked: `{ direction: 'left'|'right'|'up'|'down', dest: roomId, requiresAbility: 'doubleJump'|null }`

### Ability Gating
- Abilities are physical pickups placed in ability rooms
- Abilities unlock new movement options AND new path types:
  - Double Jump → reach high ledges (2+ tile high platforms)
  - Dash → cross gaps > 1 tile wide
  - Missile → destroy cracked wall blocks (visually distinct)
  - Wall Jump → ascend vertical shafts with wall-grab surfaces
  - Grapple → cross large chasms with grapple-point decorations
- The generation algorithm guarantees: spawn → ability A → path requiring A → ability B → path requiring B → boss
- Optional sequence breaks: a skilled player can skip some abilities (harder paths, higher skill requirement)

### Combat
- Simple directional attack (melee swing or short-range projectile)
- Enemies have 1-3 HP, player has 3-5 HP
- Healing: rare health pickups from enemies or hidden in breakable blocks
- Boss: unique enemy with 2 attack patterns, 5-8 HP, rewards new ability or permanent HP upgrade
- Knockback on hit (enemy bounces away, player recoils with brief invincibility)

### Map System
- Discovered rooms appear on a map overlay (press Tab/M)
- Map shows room shapes, connections, ability gated doors (red markers), unexplored exits (grey)
- Minimap in corner showing current room and immediate neighbors

## Architecture (from game-architecture skill)

```
src/
  core/
    Game.js          — orchestrator, main loop, state machine
    EventBus.js      — singleton, domain:action events
    GameState.js     — singleton, clean .reset(), persistent map data
    Constants.js     — ALL magic numbers, balance values, timings
  systems/
    Input.js         — event.code based, key state map, rebindable
    Camera.js        — follows player on X,Y with deadzone, zoom on map
    RoomManager.js   — loads room geometry, manages active/dead rooms, transitions
    EnemyManager.js  — spawns/updates/despawns enemies per room
    AbilityManager.js — tracks unlocked abilities, applies movement modifiers
    ProceduralGenerator.js — generates the world graph and room layouts
    MapSystem.js     — minimap + full-screen map overlay
  entities/
    Player.js        — player movement, states (idle/run/jump/doublejump/dash/hurt/dead)
    Enemy.js         — generic enemy with configurable behavior (patrol/chase/shooter/boss)
    AbilityPickup.js — floating collectible with glow shader
  visuals/
    ModelFactory.js  — procedural geometry builders (player, enemies, pickups)
    VisualFX.js      — particles, screen shake, hit flash, death dissolve
    BackgroundLayers.js — parallax scenery at varying z-depths
    Shaders.js       — custom GLSL: fresnel rim, toon shading, glow pulse
  ui/
    HUD.js           — DOM overlay: health bar, ability icons, minimap
    MapOverlay.js    — DOM overlay: full map, tab to toggle
    DamageNumbers.js — floating DOM text on hits
```

## Game Flow

```
Boot → Title screen (optional, skip if you want direct start)
     → Spawn room rendered, player idle
     → Explore: move left/right, jump, discover doors
     → Enter room transition (fade/slide)
     → Combat / platforming / secrets
     → Find ability upgrade → "NEW ABILITY!" UI popup
     → Revisit old rooms → access new paths
     → Reach boss room → defeat boss → VICTORY screen
     → Credits / score / play again prompt
```

### Room transitions
- Cross left/right edge → slide to adjacent room in that direction
- Enter door at z-depth → small loading overlay, spawn at connected door
- 0.3s transition animation (slide in direction of travel for room-to-room, fade for vertical/teleport)

## Scope-Limited MVP (first iteration)

Do NOT attempt a full metroidvania. Build this scope first:

1. **3 rooms** connected: spawn → ability room (double jump) → boss room
2. **1 enemy type**: patrolling drone (simple left-right across platform)
3. **1 ability**: double jump (reach high ledge in spawn room that leads to boss)
4. **1 boss**: simple 2-phase fight (charge + jump attack)
5. **Visual**: 2 parallax background layers, bloom, player glow, enemy rim shader
6. **HUD**: health bar (hearts), double jump indicator (flicker when used), minimap
7. **Restart**: death → game over → press R → clean restart, reset everything
8. **No map system yet** — just the minimap
9. **No save/load** — every run is fresh

## Visual Polish Checklist (from tower defense work)

- [ ] Enemy fresnel rim shader (dark center, colored edge glow, hit flash on damage)
- [ ] Player hit flash (white overlay on damage, decays over 200ms)
- [ ] Death dissolve (scale→0 + fade over 0.35s, then remove)
- [ ] Spawn effect (expanding additive ring + player ease-in from scale 0.01)
- [ ] Ability pickup glow (rotating mesh with pulsating emissive)
- [ ] Screen shake on hit (translate jitter from countdown timer)
- [ ] Damage numbers (floating DOM text that rises and fades)
- [ ] Parallax background layers (3 depths, slow drift)
- [ ] Ambient particles (dust motes in foreground, fireflies in dark areas)
- [ ] Bloom post-processing (subtle, retro glow)
- [ ] Room transition (slide or fade, 0.3s)
- [ ] Player trail / afterimage on dash (brief ghost sprite at previous position)

## Pitfalls to Avoid

- **Polish before gameplay** — get input→movement→collision→damage→death→restart working first. Everything else is garnish.
- **Scope creep** — the MVP is 3 rooms and 1 ability. Do NOT build the full procedural engine yet. Hand-place the MVP rooms, then proceduralize.
- **Physics overengineering** — AABB collision is enough. No need for a physics engine on a 2D plane. Player has `velocityX, velocityY`, position += velocity * dt, resolve overlaps.
- **event.key breaks AZERTY** — use `event.code`. Always.
- **Room transition bugs** — ensure player position resets cleanly, enemies in inactive rooms are paused/removed, camera snaps to new room bounds.
- **Restart cleanup** — all event listeners removed, all meshes disposed, timers cleared. Test restart 3x in a row.
- **Double jump state machine** — track `jumpsRemaining` (0, 1, 2) and reset on ground contact. Easy to miss the reset on wall jump.
- **Wall jump direction** — when sliding down a wall, the jump should push away from the wall, not up. Apply horizontal impulse opposite to wall normal.

## Delivery

- Vite + Three.js project in `~/Documents/games-benchmarks/procedural-metroidvania/`
- Verify in browser: player moves, jumps, takes damage, dies, restarts cleanly
- MVP rooms are hand-built in a room data JSON, not procedurally generated yet
- After MVP works, add procedural generation in a second pass
- Every commit message describes the working feature
