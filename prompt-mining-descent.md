# Mining Descent Roguelite — Procedural Planet Dig (Three.js + Vite)

## Concept

You pilot a drilling vehicle into a procedurally-generated planet. Each run: descend through layered underground biomes, mine rare minerals, manage fuel/oxygen/hull integrity, fight cave creatures. Die in the depths → surface base → spend minerals on permanent vehicle upgrades.

Think SteamWorld Dig meets Deep Rock Galactic, rendered in low-poly 3D with a tight vertical scope. The procedural generation is the star — terrain layers, ore veins, cave networks, and creature spawns are all algorithmically placed for a fresh descent every run.

The entire gameplay is **vertical** — you dig down, find treasures, and desperately try to get back up before your resources run out.

## Visual Style

- **Low-poly pixel-retro 3D** — flat-shaded terrain layers with vertex-colored gradients. Think a cross-section of the earth in GameCube-era polygons.
- **Top-down 3/4 view** — camera angled at 45-60 degrees, follows the vehicle. The terrain is exposed like a cutaway — walls on all sides reveal the dirt/stone/crystal layers you're digging through.
- **Layered biomes** — distinct color bands as you go deeper:
  - Topsoil (0-50m): brown/green, roots, small stones
  - Rock layer (50-150m): gray/blue, compact stone, coal veins
  - Crystal caverns (150-300m): cyan/purple, glowing crystal formations, open voids
  - Magma core (300-500m): red/orange, lava pools, obsidian pillars, heat damage
  - Alien remains (500m+): organic purple/green, bioluminescent, unknown structures
- **Vehicle headlights** — cone-shaped spotlights that cut through fog. Essential for seeing at depth. Upgradable range and width.
- **Drill effect** — particles and brief screen shake when digging. The terrain chunk pops away with a small dust burst.
- **Ore glow** — rare ore veins emit a colored glow (blue for crystals, gold for rare minerals, green for alien artifacts).
- **Bloom** — on glowing ores, lava, alien bioluminescence, and the player's headlights at max range.
- **Fog** — heavy at depth. You can only see ~10 tiles in any direction. Headlights extend this to ~15 tiles.

## Tech Stack

- Vite + Three.js (ES modules, `src/` directory)
- No physics engine — simple grid-based movement and AABB collision
- Terrain is a 3D grid of voxel-like cubes rendered as instanced meshes per layer
- PostProcessing: bloom, optionally tone mapping for darkness adaptation
- Constants.js, EventBus.js, GameState.js pattern (from game-architecture skill)
- localStorage for meta-progression

## Core Mechanics

### Movement & Digging

- **Grid-based movement** — the vehicle occupies a 1x1 tile on a 3D grid. Move in 4 directions (up/down/left/right relative to camera) or dig downward.
- **Digging** — press down while on a diggable tile. The vehicle drills through the tile below, consuming fuel and creating an open space.
- **Vertical shaft** — you can also dig sideways (into the wall) to create horizontal tunnels. The terrain is fully destructible within reason.
- **Falling** — if you dig under yourself or walk off an edge, you fall. Fall damage based on distance. Grapple (upgrade) stops fall damage.
- **Ladder/climb** — you can climb back up through your own tunnels. Walking against a wall with no floor above = climb mode (consumes oxygen, slower).
- **Jump jets** (upgrade) — brief vertical boost to reach higher ledges or escape pits.

### Terrain Generation

The world is a vertical column of chunks, each chunk being a 16x16x(terrain height) grid of tiles. Generate top-down:

1. **Surface terrain** — gentle hills, resource outpost at center, cave entrance somewhere on the surface
2. **Layer boundaries** — depth thresholds where biome transitions happen. Each layer has its own tile palette.
3. **Ore vein placement** — Poisson disk sampling for ore clusters. Rarer ores spawn deeper. Veins are blob-shaped (cellular automata growth from a seed tile).
4. **Cave networks** — carve open spaces using a cellular automata or drunkard's walk. Caves create shortcuts between depth layers.
5. **Pocket rooms** — larger open chambers at key depths. These contain special content: a crashed probe (loot), a creature nest, an alien artifact, a geothermal vent (free energy).
6. **Enemy spawns** — per-biome creature tables. Spawn distance from player and density based on depth and danger level.
7. **Exit guarantee** — the descent shaft must be survivable. There's always a path back up (you dig it yourself, mostly).
8. **Vertical connectivity** — cave networks that cross biome boundaries create natural routes for ambitious runs.

### Resources

Spend resources to descend further. Manage all three:

| Resource | Use | Starts with | Replenish |
|----------|-----|-------------|-----------|
| **Fuel** | Digging each tile costs 1 fuel. Moving on open tiles costs 0. | 50 | Buy at surface outpost, find fuel caches in caves, drill into fuel deposits |
| **Oxygen** | Passive drain per second (0.5/sec sitting, 1/sec moving, 2/sec climbing). | 120 (2 min) | Buy at surface, find emergency tanks in caves, extract from alien flora |
| **Hull** | Your HP. Creature attacks, rockfalls, lava contact, fall damage. | 100 | Buy repairs at surface, rare hull repair kits in deep caves |

Run ends when any reaches 0 (fuel = stranded, oxygen = suffocate, hull = destroy).

### Ore Types & Value

| Ore | Depth Range | Color | Per-unit value | Use |
|-----|-------------|-------|----------------|-----|
| Coal | 0-100m | Dark brown/black | 1 | Fuel (can burn 1 coal = +5 fuel) |
| Copper | 50-200m | Orange | 5 | Meta-progression currency (common upgrades) |
| Silver | 100-300m | Grey/white metallic | 15 | Meta-progression (mid-level upgrades) |
| Gold | 200-400m | Yellow glow | 30 | Meta-progression (high-level upgrades) |
| Crystal | 150-350m | Cyan glow | 20 | Meta-progression + crafted into headlight upgrades |
| Alien Artifact | 400m+ | Green/purple glow | 100 | Meta-progression (rare, unlocks special upgrades) |

Each ore vein yields 3-8 units. Carried in cargo hold (max 20 units base, upgradable).

### Enemies

| Creature | Biomes | Shape | Behavior | HP | Damage |
|----------|--------|-------|----------|----|--------|
| Stone Mite | Rock, Crystal | Sphere with legs | Scuttles toward player, small, fast | 1 | 5 |
| Crystal Shard | Crystal | Sharp tetrahedron | Stationary turret, fires crystal shards when player is near | 2 | 10 |
| Lava Leech | Magma | Elongated snake-like | Burrows through lava, emerges to attack | 3 | 20 |
| Alien Spore | Alien Remains | Floating orb with tendrils | Drifts toward player, explodes on death (AoE) | 1 | 15 |
| Guardian Golem | Cross-biome (deep) | Large box + pillar legs | Slow, charges when hit. Boss-tier. | 8 | 30 |

Enemies are simple low-poly models with fresnel rim shaders and biome-tinted rim colors.

### Meta-Progression (Surface Base)

The **Surface Outpost** is the hub — a small collection of domes and equipment bays on the planet surface. Purchase permanent upgrades with ore brought back from successful descents.

**Workshop** — vehicle upgrades:
- Drill power (faster dig, -1 fuel per tile → -2 at max)
- Fuel tank (+25 per level, 3 levels)
- Oxygen tank (+60 per level, 3 levels)  
- Hull plating (+25 per level, 4 levels)
- Cargo hold (+5 slots per level, 3 levels)
- Headlights (range +3 tiles, width +2 tiles per level, 3 levels)
- Jump jets (unlock, then +1 height per level, 2 levels)
- Grapple (unlock — stop fall damage, traverse gaps)

**Crafting station** — crafted tools from rare ores:
- Emergency beacon (survive one death-per-run, teleport to surface with current cargo)
- Sonic repeller (enemies flee for 30s)
- Deep drill (dig 2 tiles simultaneously for 3x fuel cost)
- Scanner pod (reveals all ores within 15 tiles for 60s)

**Hangar** — alternate vehicles (unlock with rare ore):
- "Mole" — +20 hull, +40 fuel, slower movement, cargo 15
- "Scarab" — +30 fuel, +60 oxygen, faster movement, cargo 10, built-in headlight upgrade
- "Reaper" — +40 hull, built-in ram attack (damages enemies on contact), cargo 8

**Data terminal** — run history records: deepest depth reached, most ore hauled, creatures killed, total runs. Achievements unlock cosmetic upgrades (vehicle colors, trail colors, hub decorations).

## Architecture

```
src/
  core/
    Game.js              — orchestrator, state machine (HUB/DESCENT/SURFACE/DEATH)
    EventBus.js          — singleton
    GameState.js         — singleton, per-run state (depth, fuel, O2, hull, inventory, position, discovered tiles)
    Constants.js         — ALL tile types, ore defs, enemy stats, upgrade costs, biome colors
  systems/
    Input.js             — event.code, camera-relative 4-direction movement
    Camera.js            — angled top-down follow, smooth lerp, zoom on hub
    TerrainGenerator.js  — procedural world: chunk generation, biome layers, ore veins, cave networks, pocket rooms
    DigSystem.js         — tile removal, chunk updates, falling, climbing, drill animation triggers
    ResourceSystem.js    — fuel/O2/hull tracking, passive drain, resource pickup processing
    OreManager.js        — ore vein state, mining yield, inventory management, cargo limit
    EnemyManager.js      — spawn per biome, AI (scuttle/turret/burrow/drift/charge), death drops, respawn avoidance
    CaveGenerator.js     — cellular automata for cave voids, drunkard's walk for tunnels, room pocket carving
    MetaProgression.js   — localStorage persistence, upgrade levels, unlocked vehicles, run history
    ParticleSystem.js    — drill dust, ore pickup sparkle, creature death burst, lava bubble, engine particle
  entities/
    Vehicle.js           — player vehicle model, movement, states (idle/dig/climb/fall/jump/hurt/dead)
    Creature.js          — enemy base class with configurable AI patterns
    OreDeposit.js        — visual ore cluster with glow, collision trigger for mining
    Pickup.js            — fuel cans, O2 tanks, repair kits, ore chunks (for display-only)
  visuals/
    ModelFactory.js      — vehicle models (3 types), creature models (5 types), hub buildings, drill attachment
    TerrainRenderer.js   — instanced mesh chunk rendering, tile type color mapping, dynamic updates on dig
    CaveRenderer.js      — open space rendering (darker fog, ambient light from bioluminescence)
    HeadlightEffect.js   — spotlight cone from vehicle, upgradable range/width, fog intensity reduction in cone
    Shaders.js           — fresnel rim (enemies), ore glow pulse, lava emissive, crystal refraction effect
  ui/
    HUD.js               — DOM overlay: depth meter, fuel/O2/hull bars, ore inventory (clickable to view types), minimap
    Minimap.js           — DOM canvas: revealed tiles, ore markers, enemy blips, player position, depth layer color
    WorkshopUI.js        — DOM overlay: upgrade tree with costs, current level, visual icons per upgrade
    DeathScreen.js       — DOM overlay: depth reached, ores lost, meta-progression ore conversion, upgrade options
    ReturnScreen.js      — DOM overlay: successful return summary, ore count per type, meta-progression earned
    EncounterPopup.js    — DOM overlay: brief text popup for discoveries ("Ancient alien structure... +1 Artifact!")
```

## Game Flow

```
SURFACE OUTPOST (hub)
  → buy upgrades with brought-up ore from previous runs
  → enter vehicle, approach cave entrance
  → DESCENT PHASE:
    → dig down through layers
    → manage fuel/O2/hull
    → mine ore veins
    → fight or avoid creatures
    → discover cave pockets, shortcuts, secrets
    → decide: go deeper for richer ore, or head back up with current haul
  → RETURN PHASE (reversing the descent):
    → climb back through your tunnel network
    → if you die at depth, lose everything carried
    → if you reach surface, convert ore to meta-progression credits
  → SURFACE OUTPOST: spend credits, upgrade, launch next run
```

### The Return Tension

The core roguelite tension: **go deeper for bigger rewards, but the return trip consumes resources too.** Climbing back up costs oxygen (slower than digging down) and leaves you vulnerable to enemies you didn't kill. The deeper you go, the harder the return. This creates natural decision points — "I'm at 30% O2 and 150m deep. The gold vein is 50m below but I might not make it back."

Cave shortcuts and discovered tunnels reduce return costs. Jump jets and grapple mitigate fall damage. The smart player plans an efficient descent path.

## Scope-Limited MVP

1. **1 biome** (Rock layer, 50-150m depth). No biome transition yet. Surface terrain is a flat green field with a cave hole.
2. **1 enemy**: Stone Mite (scuttles toward player, 1 HP, 5 damage)
3. **2 ores**: Coal (brown, common) and Copper (orange, common). Both worth 5 meta-currency.
4. **Vehicle**: Base model only. Movement + dig + climb. No jump jets, no grapple.
5. **Terrain**: 20x20 tile grid surface, descending 50 tiles deep. Each tile is a colored box (instanced mesh). Simple drill animation (brief shake + dust particles).
6. **Resources**: Fuel (start 50, dig costs 1 per tile), O2 (start 120, drains at 0.5/sec). No hull damage yet (enemies do damage later).
7. **1 upgrade**: Fuel tank +25 (1 level, costs 50 ore)
8. **Visual**: Headlights (basic cone, fixed range), fog, ore glow shader (pulsing emissive on copper), simple starfield on surface
9. **HUD**: fuel bar, O2 bar, ore counter, depth counter
10. **Hub**: Single dome with one upgrade panel. No crafting, no hangar, no achievements.
11. **Death**: Fuel = 0 → message "STARVED" → death screen with ore count → back to hub. O2 = 0 → "SUFFOCATED" → same.
12. **Meta-progression**: ore carried to surface converts to persistent currency (1:1). Spent on fuel tank upgrade.

## Visual Polish Checklist

- [ ] Drill dust burst (small brown sphere particles on each dig, additive blending fast fade)
- [ ] Ore glow pulse (emissive sine wave on ore cluster tiles, color-coded by type)
- [ ] Headlight cone (spotlight following vehicle direction, visible fog cone intersects terrain)
- [ ] Cave darkness (outside headlight cone, very dark fog; inside cone, clear visibility)
- [ ] Enemy fresnel rim shader (colored edge glow, biome-tinted)
- [ ] Enemy death burst (small colored particles + scale-to-zero fade)
- [ ] Fuel pickup can (small metallic cylinder, yellow glow, appears in caves)
- [ ] O2 pickup tank (white cylinder with blue stripe, blue glow)
- [ ] Ore chunk visual (glowing small polyhedron in cargo, visible on vehicle)
- [ ] Engine exhaust (small downward-facing particle stream while vehicle is active)
- [ ] Fall effect (camera dips slightly, brief screen shake on landing, dust ring on impact)
- [ ] Climb animation (vehicle tilts against wall, headlight points along climb direction)
- [ ] Surface transition (light gets brighter as you approach z=0, fog color shifts from dark to sky blue)
- [ ] Layer boundary visual (brief colored band transition when crossing biome depth threshold — for later)
- [ ] Bloom on glowing ores and headlights (threshold 0.5, strength 1.0 to keep it moody, not washed out)
- [ ] Distance fog that matches biome color (brown at rock layer, blue for crystal, red for magma)
- [ ] Visible tunnel from above (surface hole shows darkness, depth visualized as the tunnel recedes)
- [ ] Ore counter animation (on pickup, the UI counter ticks up with a bounce)

## Pitfalls to Avoid

- **Getting lost in your own tunnels** — the minimap is essential from MVP. Without it, the player can't find their way back to the surface. Implement minimap showing dug tiles from day one.
- **Fuel deadlock** — if digging costs fuel and fuel is found underground, there must always be at least one fuel cache within reach of the starting fuel. Guarantee a coal vein within 5 tiles of the entrance.
- **Climbing oxygen tax** — climbing back up costs 2x O2 per second. This is intentional for tension, but make sure the player can see their O2 rate clearly so they can plan their return.
- **Ore-to-credit balance** — a successful MVP run should net ~15-25 ore (5-8 veins, 3 ore each). Fuel tank upgrade costs 50. That means 2-3 successful runs for the first upgrade. Adjust if it feels grindy.
- **Terrain render performance** — 50 deep x 20 wide x 20 deep = 20,000 tiles. Use InstancedMesh (one draw call per material/tile-type combo), not individual Mesh objects. Update instance matrices on dig, don't recreate geometry.
- **Dig through surface** — prevent digging up through the surface (z=0). The exit is the cave entrance, not a hole in the ground.
- **Camera collision** — camera is top-down and can clip through terrain cleverly. Use an orbit angle that's high enough to see into the tunnel but not blocked by overhangs. The cutaway approach (terrain is half-sectioned) avoids this entirely.
- **event.key breaks AZERTY** — use `event.code` for movement (arrow keys or WASD in camera-relative orientation).
- **Restart cleanup** — terrain regenerates, vehicle resets, inventory empties, all event listeners removed. Test 3x restart.
