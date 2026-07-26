# Space Hauler Roguelite — Procedural Galaxy Trading (Three.js + Vite)

## Concept

You're a space trucker in a procedurally-generated galaxy. Each run: buy cargo at Station A, navigate a route through connected star systems, survive pirates, asteroids, and cosmic hazards, then sell at Station B for profit. Die in transit → back to home port → spend credits on permanent ship upgrades, new vessels, and faction unlocks.

Think FTL's galaxy map meets a streamlined 3D space flight sim with cargo management. The procedural generation is a node graph — every run generates a fresh cluster of systems with varying economies, danger levels, and secrets. The 3D flight segments are short, cinematic, and focused on encounters rather than open exploration (keeping scope tight).

## Visual Style

- **Low-poly pixel-retro 3D** — flat-shaded ships and stations with vertex coloring. Think Star Fox 64 / Freelancer meets a retro palette.
- **Galaxy map** — a 2D top-down node graph rendered as a Three.js scene. Systems are glowing dots connected by trade route lines. The ship icon hops between nodes. Nebula gradients in the background.
- **3D flight segments** — your ship flies through a themed corridor (asteroid field, nebula, empty space, pirate territory) with parallax star layers, nebulae, and distant celestial bodies. The flight path is essentially an interactive skybox with spawn triggers along a Z-axis.
- **Bloom** — on engine trails, station beacons, jump gates, and rare cargo.
- **Ship models** — composite geometry (body + wings + cockpit + engine pods), named children for animation. Low-poly cargo containers attach to the hull.
- **Stations** — torus/dome geometries with glowing docking bays. Rotating antenna arrays.
- **Faction color palettes** — each faction has a signature color scheme (blue/gray for Federation, red/black for Pirates, green/gold for Merchants Guild, purple/cyan for Scientists).

## Tech Stack

- Vite + Three.js (ES modules, `src/` directory)
- PostProcessing via three/addons (bloom, optionally film grain for retro feel)
- No physics engine — simple AABB collision for flight encounter obstacles
- All constants in `Constants.js` — ship stats, cargo values, encounter tables, faction data
- EventBus.js + GameState.js pattern (from game-architecture skill)
- localStorage for meta-progression

## Core Systems

### Galaxy Generation (Node Graph)

The galaxy is a weighted graph of 8-15 **systems** connected by **routes** of varying length and danger level.

Each system has:
- **Name** — procedurally generated (syllable combination: "Keplar-3", "Vorath Prime", "Nexus Station")
- **Type** — Trade Hub, Mining Outpost, Pirate Den, Research Station, Refugee Colony, Black Market
- **Economy** — import goods (high buy price), export goods (low sell price), supply/demand quantities
- **Danger level** — 1-5, determines encounter frequency and severity on connected routes
- **Faction** — Federation, Pirates, Merchants Guild, Scientists, Neutral
- **Services** — refuel, repair, cargo expansion (as paid services)
- **Nodes** — 1-3 "points of interest" per system (shop, quest giver, upgrade vendor, info broker)

Generation algorithm:
1. Place a "home" system (safe, Federation, always starting point)
2. Place 1-2 "endpoint" systems (high-value trade destinations, harder danger)
3. Fill remaining nodes with random types
4. Connect via Delaunay triangulation + prune to create a interesting graph (no boring straight lines)
5. Assign route distances and danger levels based on endpoint danger values
6. Tag some routes as "unknown" — require scanner upgrade to reveal

### Flight Encounters

When traveling a route, the game enters a short 3D flight segment. The ship flies forward on Z-axis for 15-30 seconds while encounters trigger:

| Encounter | Trigger | Outcome |
|-----------|---------|---------|
| **Asteroid field** | Dodge asteroids (collision = hull damage) or use shield | Lose 0-15% hull, or pass safely |
| **Pirate ambush** | Fight (simple turret minigame) or flee (lose cargo) | Lose cargo or fight for survival |
| **Distress signal** | Investigate or ignore | Rescue crew → reputation + credits, or ignore → nothing |
| **Solar flare** | Shield check | Lose 0-30% shield, cargo may heat-damage (lose perishables) |
| **Mining claim** | Scan and extract | Free ore cargo, costs time (fuel) |
| **Black market rendezvous** | Meet covert trader | Sell contraband at high price, risk pirate attack |
| **Jump gate anomaly** | Navigate anomaly or reroute | Shortcut to another system, or damage |
| **Empty transit** | Nothing happens | Peaceful leg of the journey |

Each encounter is a short (3-8 second) interactive sequence. No extended combat — keep it snappy.

### Cargo & Economy

- **Cargo types**: Food (perishable, short routes), Ore (bulky, low value), Tech (high value, attracts pirates), Medicine (medium value, stable), Weapons (contraband in Federation systems), Artifacts (rare, high value, one-per-run)
- **Cargo hold**: ship has a capacity (tonnage). Each cargo has weight. Player chooses what to carry.
- **Buy/Sell prices**: computed per system type. Trade Hub buys Tech for 150%, sells Ore for 80%. Mining Outpost buys Ore for 50%, sells Tech for 200%.
- **Supply/Demand**: each system has a limited quantity of each good. Buying/selling shifts the balance. A system that just sold 50 units of Ore has lower supply for the next hauler.
- **Perishable**: Food spoils after 3 route traversals. Check on arrival.

Goal per run: buy low, survive the route, sell high. Profit margin = credits earned. Die = lose all cargo and unspent run credits (meta-progression credits are separate).

### Ship & Upgrades

**Starting ship** — "Hauler Mk I": cargo 20t, fuel 100, hull 100, shield 50, speed 1.0x, weapon slot (none), scanner range 1.

**Upgrade slots** (buy in home port meta-progression):
- **Cargo Bay** — +10t capacity per level (max 5 levels)
- **Engine** — +20% speed, reduces encounter duration (faster transit)
- **Fuel Tank** — +50 fuel per level (max 3)
- **Hull Plating** — +20 hull per level (max 5)
- **Shield Generator** — +30 shield per level (max 3)
- **Scanner** — reveals hidden routes and encounter types before committing
- **Weapon Mount** — adds a turret for pirate encounters (single small gun, auto-fire)
- **ECM Jammer** — 40% chance to avoid pirate encounters entirely

**Unlockable ships** (buy with meta-progression credits):
- "Fast Courier" — cargo 10t, fuel 80, speed 1.8x, no weapon slot. For speed-run trade routes.
- "Bulk Transporter" — cargo 50t, fuel 150, speed 0.6x, hull 200. High risk tolerance.
- "Armed Escort" — cargo 15t, fuel 100, speed 1.2x, hull 150, weapon slot (twin guns). Combat capable.
- "Smuggler's Run" — cargo 20t, fuel 100, speed 1.3x, ECM, hidden cargo compartments (contraband detection immunity).

### Meta-Progression

Two currencies:
- **Run credits** — earned during a run, lost on death. Used to buy cargo, pay for services.
- **Persistent credits** — 10% of run credits earned at death/success are added to persistent pool. Used for ship upgrades and new ships.

Unlock tree:
- Ship upgrades (cargo, engine, fuel, hull, shield, scanner, weapon, jammer) — each 1-5 levels, escalating cost
- New ships — flat credit cost, one-time unlock
- Faction reputation — every profitable trade with a faction increases reputation. Higher reputation → better prices, exclusive cargo, safer passage in their space.
- Starting capital — unlock the ability to start each run with X credits (reduces early grind)
- Crew hire — permanent crew members that give passive bonuses (reduced fuel consumption, better trade prices, pirate intimidation)

## Architecture

```
src/
  core/
    Game.js              — orchestrator, state machine (HUB/MAP/FLIGHT/ENCOUNTER/RESULT/DEATH)
    EventBus.js          — singleton
    GameState.js         — singleton, per-run state (credits, cargo, ship, position, faction standings)
    Constants.js         — ALL ship stats, cargo defs, encounter tables, faction data, upgrade costs
  systems/
    Input.js             — event.code, mouse/touch for map interaction
    GalaxyGenerator.js   — procedural node graph: system placement, route connections, economy assignment
    RouteManager.js      — pathfinding on galaxy graph, encounter sequence generation per route
    FlightController.js  — 3D flight segment, spawns obstacles/encounters along Z-axis
    EncounterSystem.js   — encounter logic (asteroid dodge, pirate fight, distress signal, etc.)
    EconomySystem.js     — buy/sell pricing, supply/demand simulation, faction price modifiers
    ShipManager.js       — ship stats, cargo inventory, fuel consumption, damage, upgrades
    MetaProgression.js   — localStorage persistence, upgrade unlocks, ship unlocks, faction rep
    ParticleSystem.js    — engine trails, explosion sparks, jump gate glow, cargo container effects
  entities/
    PlayerShip.js        — ship model, movement during flight segments, weapons, damage
    CargoContainer.js    — visual cargo boxes on ship hull, changes with cargo load
    EncounterObject.js   — asteroids, pirate ships, jump gates, stations (simple visual + trigger zone)
  visuals/
    ModelFactory.js      — ship models (Hauler, Courier, Transporter, Escort, Smuggler), station types, encounter objects
    GalaxyRenderer.js    — node graph rendering, system dots, route lines, ship icon, nebula background
    FlightScene.js       — builds the 3D flight corridor with star layers, parallax, distant bodies
    Shaders.js           — fresnel rim, glow pulse (on stations and jump gates), engine flame
  ui/
    HUD.js               — DOM overlay: credits, cargo manifest (scrollable), fuel/shield/hull bars, current system
    GalaxyMapUI.js       — DOM overlay over the Three.js galaxy scene: system tooltips on hover, route danger indicators
    EncounterUI.js       — encounter-specific UI (dodge prompt, turret crosshair, choice buttons)
    CargoMarket.js       — DOM overlay: buy/sell panel with prices, quantities, cargo hold view
    DeathScreen.js       — DOM overlay: run summary (systems visited, credits earned, cargo lost), persistent credits earned
    Tutorial.js          — first-run tooltips explaining trade mechanics
```

## Game Flow

```
HUB (home port)
  → view galaxy map (procedurally generated cluster, 8-15 systems visible)
  → select destination system (A* path on node graph shows route and danger summary)
  → BUY CARGO at current system's market
  → TRAVEL: flight segment plays with encounters on each route edge
    → each encounter is ~5-15 seconds interactive
    → arrive at next system
  → SELL CARGO, decide: continue trading or return to home port
  → die in transit → DEATH SCREEN → HUB
  → survive and return to home port → SUCCESS SCREEN → HUB
  → HUB: spend persistent credits on upgrades, unlock ships, check faction rep
  → NEXT RUN: galaxy regenerates fresh (or expands — see below)
```

### Run structure

Each run targets a "goal" system (farthest or highest-value destination). The player can make intermediate stops. The run ends when:
- Ship is destroyed (death)
- Player returns to home port with cargo (success)
- Player manually aborts (partial success, keep run credits but no bonus)

### Galaxy persistence option

Easy mode (better for MVP): regenerate the entire galaxy each run. Simple, fresh exploration every time.
Harder mode (better for depth): shrink-wrap the galaxy — reveal new systems as you explore, keep explored systems between runs but shift their economies. This gives a persistent feeling without infinite generation.

MVP should use the easy mode. Add persistence later.

## Scope-Limited MVP

1. **1 ship** (Hauler Mk I), **3 systems** (Home → Trading Post → Mining Outpost, a straight line of 2 routes)
2. **2 cargo types**: Food (perishable), Ore (bulky)
3. **2 encounters**: Asteroid field (dodge or take damage) and Empty transit
4. **1 upgrade**: Cargo Bay +10t (level 1 only)
5. **Visual**: ship model, 2 station models, parallax starfield, engine trail particles, bloom on stations, basic flight corridor
6. **HUD**: credits, cargo hold (2 slots + quantities), fuel bar, hull bar
7. **Galaxy map**: simple line of 3 nodes rendered in Three.js, click to travel
8. **Flight segment**: ship flies forward for 15s, encounter triggers at midpoint, system name appears on arrival
9. **Death**: hull = 0 → death screen with run credits summary → back to home port
10. **Meta-progression**: none yet (no persistent credits) — just validating the loop

## Visual Polish Checklist

- [ ] Engine trail particles (additive blending, tiny cone sprite, ship-color tinted)
- [ ] Station glow pulse (rotating emissive band on station geometry)
- [ ] Jump gate visual (torus ring with animated emissive shader, particle burst on transit)
- [ ] Asteroid break effect (large asteroid → 2-3 smaller fragments on collision)
- [ ] Pirate ship model (dark palette, red rim shader, aggressive geometry)
- [ ] Cargo container model (box with straps, color-coded by cargo type)
- [ ] Ship damage visual (emissive flash on hit, brief scale stagger)
- [ ] Parallax star layers (3 depths at varying speeds, soft-round dot texture, no square PointsMaterial)
- [ ] Nebula backdrop (large transparent plane with noise-based shader at z=-200)
- [ ] Distance fog in flight segments (subtle, hides the end of the corridor)
- [ ] Bloom (threshold 0.4, strength 0.7) — stations and jump gates glow, ship doesn't wash out
- [ ] System dot pulse on galaxy map (breathing glow on reachable nodes, dim on visited)
- [ ] Route line animation (dashed line with moving dots showing active trade flow)
- [ ] Docking approach animation (ship glides into station bay, camera zooms, fade to market screen)
- [ ] Buy/sell sound-like visual feedback (credits counter animates, cargo icon appears/disappears with scale pop)

## Pitfalls to Avoid

- **Flight segment too long** — 15-30 seconds per route is the cap. Longer = boring. Make encounters snappy.
- **Economy too complex for MVP** — start with flat buy/sell prices per system type. Add supply/demand later.
- **Galaxy generation disconnected routes** — every system must be reachable from home. Validate graph connectivity after generation.
- **Fuel as a softlock** — ensure the player can always reach at least one system with their remaining fuel. If fuel = 0 and they're not at a station, they die. This is intentional but must be clear to the player.
- **Cargo not worth the risk** — balance buy/sell margins so a successful run from Home to farthest system nets ~200-300 credits profit. Upgrade costs should be 500-2000 credits.
- **Persistent credits too grindy** — 10% of run credits converts to persistent. A successful run of 300 credits = 30 persistent. Make initial upgrades cheap (50-100 persistent) so the player feels progression immediately.
- **event.key breaks AZERTY** — use `event.code` for flight controls (WASD to dodge asteroids, Space to shoot).
- **Restart cleanup** — clean state on new run. Galaxy regenerates, ship resets to base stats, cargo empty.
