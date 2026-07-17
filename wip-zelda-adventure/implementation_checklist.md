# Dungeon Delver - Implementation Checklist

A 2D top-down dungeon crawler contained in a single HTML file (zero external dependencies).
All visuals via Canvas API, all audio via WebAudioAPI. Target: 2000-5000 lines of production-quality code.

## Playability Critical Principles (read before starting)

- **Player visibility is non-negotiable**: The player character must always be clearly visible against any background or enemy type. Use a distinctive shape + color that stands out.
- **Color palette discipline**: Every game element needs a unique, high-contrast color. Enemies must not blend with walls or floors. Projectiles must be instantly recognizable as dangerous (red/orange). Healing items must read as safe (green/white).
- **Combat feedback is mandatory**: On every hit -- both player and enemy -- there must be visual feedback (screen shake, damage numbers, flash, knockback) AND audio feedback. Without it, the player cannot perceive that combat is working.
- **Camera follows the player smoothly**: Player should never walk off-screen or lose sight of their character. Camera lag should be subtle, not jarring.
- **HUD must be readable during action**: HP and XP bars must have high contrast against all backgrounds. Colors must communicate state clearly (red = low HP).
- **Minimap is essential navigation aid**: It must show explored rooms, current room detail, player position, and enemy indicators so the player can make decisions.

---

## Phase 1 -- Foundation & Core Architecture

### [ ] 1.0 Define game-wide constants / configuration object
Create a central configuration object (or constant module) that stores all tunable numeric values: tile size, room count ranges, max entities, particle pool sizes, base HP/damage/defense stats for each character type, XP thresholds per level, projectile speeds, audio volumes, camera lerp rate, and input acceleration. This makes balancing in Phase 6 straightforward without hunting through hardcoded values scattered across classes.

**Criticality: HIGH** -- Without centralized constants, every balance pass requires searching and replacing dozens of magic numbers deep inside method bodies. Having them all in one place turns balancing into editing a small configuration table.

**Verification**: Changing a single constant (e.g., player starting HP) propagates correctly through every system that references it. No hardcoded numeric literals remain for game-balance values.

---

### [ ] 1.1 Set up the HTML shell and Canvas element
Create a single `index.html` file with a full-screen canvas centered in the viewport. Include CSS to eliminate scrollbars, margin, and overflow. Prepare for all-Canvas rendering (no DOM UI elements for gameplay). Handle window resize events by updating canvas dimensions and adjusting the camera viewport accordingly.

**Verification**: Opening the file in a browser shows a blank full-screen canvas with no errors in the console. Resizing the window does not break the canvas or leave empty borders.

---

### [ ] 1.2 Implement the Entity base class
Create an `Entity` base class that all game objects inherit from (player, enemies, projectiles, items, particles). Provide shared properties and methods: position (x, y), velocity (vx, vy), width/height for hitbox, active/dead flag, update(deltaTime) method with a no-op default, render(renderer) method with a no-op default, markDead() method, and isColliding(otherEntity) helper using AABB overlap. This eliminates duplicate code across every entity type.

**Verification**: A test entity extending the base class inherits position, update(), and render() without any additional code; marking it dead sets a flag; collision detection works correctly against another entity's hitbox.

---

### [ ] 1.3 Implement the game loop with delta-time handling
Create a `Game` class that drives the main loop using `requestAnimationFrame`. Compute delta time between frames and use it for frame-rate-independent movement, animations, and physics. Support a fixed-step accumulator pattern for deterministic physics/collision (e.g., run collision logic at exactly 60Hz regardless of display refresh rate). The accumulator should catch up on lag by running multiple fixed steps in one frame, but cap the maximum number to prevent spiral-of-death.

**Criticality: HIGH** -- Without delta-time, game speed varies across devices. Without a fixed-step accumulator, physics behaves differently at 30fps vs 60fps, causing subtle bugs where enemy projectiles are dodgable at low frame rates but not high ones.

**Verification**: The loop runs without error; logging delta time shows consistent values regardless of frame rate; reducing browser tab visibility (which throttles rAF) does not cause the game to "freeze and then accelerate" -- it catches up smoothly.

---

### [ ] 1.4 Implement the Input system
Create an `Input` class that tracks key states (pressed this frame, released this frame, held) for both Arrow keys and ZQSD layout. Also track Enter/Escape/space for menu and action inputs. Support smooth movement by checking held state each frame, not just on key-down events. Debounce rapid consecutive presses where appropriate (e.g., attack spam prevention at the input level).

**Verification**: Pressing any movement key registers in the held state; releasing sets it to released then inactive; both Arrow and ZQSD work simultaneously without one overriding the other; attack key can be pressed and immediately re-pressed only after the cooldown expires.

---

### [ ] 1.5 Set up the Camera system
Create a `Camera` class that tracks a target position and smoothly follows it using configurable lerp interpolation. Implement viewport boundaries so the camera does not show areas outside the dungeon map edges. Provide methods for screen shake (add a temporary offset to the camera transform), hit-stop (pause camera updates for a few frames), and current viewport rect query (used by the renderer for culling).

**Criticality: HIGH** -- The player must always see their character. Smooth following is essential for playability. Screen shake and hit-stop hooks are needed later for combat feedback but should be built into the camera from day one.

**Verification**: Moving the player moves the camera smoothly; edges of the map clamp appropriately so no off-map darkness appears; screen shake adds a temporary offset that decays back to zero; hit-stop freezes the camera position.

---

### [ ] 1.6 Create the Rendering system / Renderer
Create a `Renderer` class responsible for clearing the canvas with a background color and drawing all visible game objects in proper z-order: background tiles first, then floor decorations, then items on ground, then enemies, then the player (always drawn last so they're always on top of everything), then particles, then HUD overlay. Use the camera's viewport transform to only render what is on screen (frustum culling). Provide helper methods for drawing common shapes: filled rectangles, stroked rectangles, circles, lines, and text with optional outline/stroke for readability against any background.

**Verification**: The renderer can be called each frame without error; a colored rectangle passed through it appears on screen correctly transformed by the camera; z-ordering is correct (player always drawn on top of tiles and items beneath them).

---

### [ ] 1.7 Implement tile rendering for the dungeon
Using the Renderer, implement tile-level rendering that draws only visible tiles within the camera viewport. Support distinct visual representations for each tile type: floor (plain colored or subtly textured), walls (thicker blocks with optional edge highlighting to give depth perception), doors (distinct shape/animation indicating locked or unlocked state), and hazards (pulsing color or subtle animation to communicate danger before the player steps on them). Use tile-size-based coordinate math for precise alignment.

**Verification**: All visible tiles render correctly aligned; walls visually read as solid barriers; hazard tiles have a subtle pulsing or animation that signals danger even from a distance.

---

### [ ] 1.8 Implement the Particle system (pool-based)
Create a `Particle` class extending Entity and a `ParticleSystem` that manages a fixed pool of particles to avoid garbage collection during gameplay. Provide methods: spawn(type, x, y, count), update(deltaTime), render(renderer). Support particle types for: combat sparks (short-lived, fast velocity, bright color fading to transparent), explosions (expanding radius with color fade), pickup trails (small dots trailing toward a collected item), and environmental effects (dust motes, water drops). Each particle tracks position, velocity, lifetime (current/max), color (with alpha fading), size, and a per-frame update lambda or type-specific behavior.

**Criticality: MEDIUM** -- Particles provide crucial combat feedback and polish but the game is playable without them initially. Build the infrastructure early so combat can reference it once implemented.

**Verification**: Spawning 20 particles creates visible animated effects that fade, move, and die within their lifetime; re-spawning after all are dead does not throw errors (pooled reuse); pooling prevents frame drops during burst spawning.

---

### [ ] 1.9 Implement the Audio engine (WebAudioAPI)
Create an `AudioEngine` class that synthesizes all sounds using WebAudioAPI oscillators, gain nodes, and noise generators -- no audio files whatsoever. Provide methods for: playSFX(name), startMusic(), stopMusic(), setMusicIntensity(factor). Include these synthesized sounds:
- Background ambient music loop (two layers: calm layer + combat layer; crossfade between them based on proximity to enemies)
- Combat SFX: sword swing whoosh, hit impact (metal/clay thud depending on target), enemy death crunch, player hit sting
- Pickup SFX: short ascending tone for item pickup, different pitch for potions vs keys
- Menu navigation click and selection chime
- Level-up fanfare (ascending multi-note sequence)

Implement a simple volume mixer with separate master, sfx, and music channels so the player (via config) can balance them.

**Verification**: Triggering any sound effect produces audible synthesized output; background track has two layers that crossfade based on combat state; volume controls adjust output without popping or crackling.

---

## Phase 2 -- Dungeon Generation & Collision

### [ ] 2.1 Define the tile, room, and map data structures
Create data structures for: Tile (properties: type enum: floor/wall/door/hazard/exit, locked boolean for doors), Room (properties: x, y, width, height, connections array of neighbor room references, enemies array, hasExit boolean), and Map (properties: tileGrid 2D array, rooms array, player spawn coordinates). Include a seeded pseudo-random number generator (e.g., mulberry32 or xorshift) for reproducible dungeon generation. Provide a method to generate a new map given a seed and difficulty parameters (room count range, room size range, corridor width).

**Verification**: Creating a map object produces valid tile/room data structures with proper dimensions; the seeded generator produces the same dungeon every time with the same inputs.

---

### [ ] 2.2 Implement procedural dungeon generation (room + corridor algorithm)
Create a `DungeonGenerator` class that:
- Places random rooms within the dungeon bounds, ensuring no overlap and minimum separation distance between room edges
- Connects connected rooms with corridors of floor tiles using either L-shaped or straight-line paths
- Marks one room as the player spawn room (first placed room) and another as the exit/boss room (last placed room, furthest from spawn in graph distance)
- Optionally places hazard tiles in corridors or specific non-critical rooms
- Ensures the dungeon is fully connected (every room reachable from every other room via floor tiles)

**Verification**: Generated dungeons are fully connected with walkable paths between all rooms. Walls form closed room boundaries. No two rooms overlap. The spawn room and boss room are clearly identifiable.

---

### [ ] 2.3 Implement AABB collision detection and resolution
Create a collision utility that performs axis-aligned bounding box overlap checks between entities and tiles, and between pairs of entities. Resolve tile collisions by pushing entities out of wall/hazard tiles along the smallest overlap axis (allowing slide-along behavior). Support both static collision layers (tiles) and dynamic collision layers (entity-to-entity). Provide a helper method for sweep tests (projectile trajectory vs walls).

**Criticality: HIGH** -- Without proper collision, players walk through walls, enemies clip through obstacles, and projectiles pass through walls. This is core playability.

**Verification**: A player cannot move through wall tiles; movement slides along walls smoothly without getting stuck on corners; enemies follow corridors correctly and stop at walls; projectile sweep tests detect walls accurately.

---

### [ ] 2.4 Implement enemy knockback resolution
When enemies are knocked back by player attacks, ensure the knockback displacement respects tile collision -- enemies slide along walls rather than clipping through them. The knockback resolver should apply the full knockback vector and resolve any wall overlap after each frame of knockback (not just on final position).

**Verification**: Knocking an enemy into a wall causes it to stop at the wall, not pass through; multiple back-to-back hits don't stack knockback errors that push enemies out of bounds.

---

## Phase 3 -- Player System & Combat

### [ ] 3.1 Create the Player class (extends Entity) with stats
Create a `Player` entity extending Entity with: HP, Attack, Defense, XP, Level, Speed, current position, facing direction (one of four cardinal directions), animation state, hit-flash timer, invincibility-frame timer, and attack cooldown tracker. Include methods for: takeDamage(amount, sourceDirection), dealDamage(target, amount), gainXP(amount), levelUp(), heal(amount), hasWeapon(type), equip(weapon), consume(potion). Starting HP should be enough to survive at least 2-3 enemy hits so the player can learn combat before dying. On takeDamage, set invincibility frames (~0.3 seconds) and hit-flash timer (~0.15 seconds).

**Playability note**: The invincibility frame window prevents a single enemy from one-shotting the player via overlapping hitboxes (e.g., two enemies standing on top of each other both registering damage simultaneously). This is a critical quality-of-life safeguard.

---

### [ ] 3.2 Implement player movement with camera tracking
Wire up the Player class to the Input system for smooth movement in all four cardinal directions. Movement speed must be consistent across frame rates (use delta-time). Support diagonal input preference: when two keys are held (e.g., Up + Right), prefer the first-pressed direction or use a simple priority scheme so the player always moves predictably, not diagonally at sqrt(2)x speed unless both keys were pressed simultaneously. The player character must have a clear, distinctive visual appearance drawn with Canvas primitives that contrasts strongly against floor and wall colors.

**Criticality: HIGH** -- Player visibility and responsive controls are the single most important playability factors. Directional preference prevents "accidental diagonal movement" which is a common frustration in top-down games where 8-way input feels unintentional.

**Color palette guideline**: Player should use a bright cyan/blue color that does not appear in enemy palettes, wall colors, or floor colors. Draw a simple but recognizable shape (e.g., a knight silhouette with a helmet and sword). Include a subtle idle bob animation so the player is never completely static on screen, which makes them easy to lose visually.

---

### [ ] 3.3 Implement weapon system and variations
Create a `Weapon` data structure (or class) with properties: name, attackBonus (added to base damage), swingSpeed multiplier (affects cooldown), hitboxSize multiplier, visual shape/color for rendering in-hand. Implement at least two distinct weapons: a basic sword (default), and an upgraded weapon found as a rare drop or key reward (e.g., "Longsword" with +50% attack but 10% slower swing). The equipped weapon modifies the player's melee hitbox size, damage output, cooldown duration, and visual appearance.

**Verification**: Switching weapons changes the melee hitbox dimensions, damage numbers, and what is drawn in the player's hand; the HUD displays the current weapon name when focused on inventory.

---

### [ ] 3.4 Implement level-up / stat progression
When the player gains enough XP to fill the XP bar, trigger a level-up sequence: increase all stats (HP max +20%, Attack +15%, Defense +10%, Speed +5%), refill the XP bar to zero, play the level-up fanfare sound, spawn a burst of golden particles around the player, display a "LEVEL UP!" floating text message above the player, and briefly flash the screen with a gold tint.

**Playability note**: The visual and audio celebration on level-up is crucial for the "feel good" factor. Players need to clearly perceive that they've become stronger; otherwise leveling feels like invisible bookkeeping rather than an achievement.

---

### [ ] 3.5 Implement player melee combat
Add a melee attack system to the Player:
- Attack triggered by Space bar key press
- Attack has a directional hitbox in front of the player based on facing direction (a rectangle extending outward from the player's current position)
- Attack has a configurable cooldown between swings and a brief animation window during which the sword is visually drawn swinging
- On hit: apply damage to the first enemy whose hitbox overlaps the swing hitbox, display floating damage numbers, trigger knockback on the enemy (away from player), spawn spark particles at the impact point, play hit SFX, and if the enemy dies, mark it for removal on next update cycle
- Only one entity can be hit per swing (single-target melee)

**Verification**: Swinging at an enemy reduces its HP with a visible damage number; cooldown prevents spamming (attempting to swing during cooldown does nothing); knockback pushes enemies away; swinging in empty space does nothing and plays only the whoosh sound.

---

### [ ] 3.6 Implement item/loot drop and pickup system
Create an `ItemOnGround` class (extends Entity) for items dropped by enemies or found as static pickups. Properties: itemType enum, value (healing amount for potions, XP bonus, weapon reference), visual representation drawn via Canvas primitives. Enemies have a chance to drop items on death (higher chance for rare weapons). Items glow subtly with a pulsing animation to attract player attention. When the player walks adjacent to an item (touching distance of ~1 tile), the item is automatically collected: apply its effect (heal HP, equip weapon, add key to inventory) and play pickup SFX.

**Criticality: HIGH** -- Without this step, items exist nowhere in the game world. The entire economy (potions for healing, keys for doors, weapons for damage) collapses without a working drop-and-pickup loop.

**Color palette guideline**: Dropped items should have a soft golden glow/outline to stand out from floor tiles. Potion pickups = green glow; key pickups = gold glow; weapon pickups = silver glow.

---

### [ ] 3.7 Implement the Inventory system
Create an `Inventory` class that manages:
- A fixed grid of N slots (e.g., 6-8 slots) displaying held items
- Item types: Potions (healing, restore ~40% max HP), Keys (unlock locked doors in dungeons), Weapons (equip for attack bonus)
- Equip/consume actions triggered by pressing a slot number key (1-6)
- Visual display of each item type with distinct icons drawn via Canvas primitives (potion bottle shape, key shape, sword silhouette) and colored accents
- Current equipped weapon displayed prominently in the HUD

**Criticality: HIGH** -- Players need to know what items they have, how many of each, and how to use them. Inventory must be accessible without breaking gameplay flow. Do not require opening a separate menu overlay; slot-based keys should work during normal gameplay.

**Color palette guideline**: Potions = green bottle icon, Keys = yellow/gold key icon, Weapons = silver/steel sword icon. All distinct from enemy and environment colors.

---

## Phase 4 -- Enemy Systems & Projectiles

### [ ] 4.1 Create the base Enemy class (extends Entity) with state machine
Create an `Enemy` base class extending Entity. Implement a finite state machine with states: Idle (patrol between waypoints or stand still), Patrol (move between patrol points at walking speed), Chase (move toward player at running speed when detected), Attack (execute attack action -- melee or ranged), Flee/Stagger (temporary disabled state after taking damage, lasts ~0.5 seconds), Death (animation + removal). Each state has an entry condition (what triggers the transition into it) and exit conditions (what triggers leaving it). Base properties: HP, speed, detectionRadius, attackRange, attackDamage, damageCooldown, dropTable (item chance map).

**Verification**: Enemies switch between states correctly based on distance to player, current HP threshold, and cooldown timers. A wounded enemy enters Flee state when HP drops below 20%.

---

### [ ] 4.2 Implement Projectile system
Create a `Projectile` class (extends Entity) for ranged enemy attacks. Properties: origin (x, y), direction (normalized vector), speed, damage, lifetime, owner (which enemy entity fired it). On update: move along direction by speed * deltaTime; check wall collision using sweep test and stop/collide if hitting a tile; check entity collision with the player and apply damage on hit. Visual representation: small glowing shape in danger color (red/orange) with a trailing particle effect. Remove projectiles when they hit walls, hit the player, or expire past their lifetime.

**Criticality: HIGH** -- This step was missing entirely. Without it, ranged enemies (Skeleton Archers) cannot fire and the game has no ranged combat mechanic. Projectile readability is also critical: they must be visible enough to dodge.

**Playability note**: Projectile speed should be slow enough that a attentive player can react and move out of the way within 1-2 seconds of seeing it fired. This gives the player agency in dealing with ranged threats.

---

### [ ] 4.3 Implement Enemy Type 1: Slime (melee chaser)
Create a `Slime` enemy class extending Enemy with specific behaviors and properties: detection radius ~4 tiles, walk speed (slow), chase speed (moderate), melee attack on contact (damage = base value at 0.8s cooldown between contact ticks), HP scaled to dungeon depth. State transitions: Idle when no player in detection range; Chase toward player when detected; Flee/Stagger when taking damage; Death animation (squish particle burst). Draw as a green blob shape with a simple up/down squish animation that responds to movement direction.

**Playability note**: Slimes are the tutorial enemy -- easy to read, easy to kill, teaches the player basic combat loop. Their color must differ from healing potions (both use green family) -- use a darker or more saturated/muddy green for slimes vs bright emerald green for potions.

---

### [ ] 4.4 Implement Enemy Type 2: Skeleton Archer (ranged attacker)
Create a `SkeletonArcher` enemy class extending Enemy with specific behaviors and properties: detection radius ~6 tiles, walk speed (slow), stationary patrol pattern within the room, fires projectiles toward the player's current position when in range, projectile cooldown between shots (~1.5s), HP scaled to dungeon depth. On death, may drop potions or arrows (no weapons from archers). State transitions: Idle/Patrol when player out of range; Chase if player moves too close (retreat while shooting); Attack fires projectiles; Flee/Stagger when damaged; Death animation (scatter bone particles).

**Playability note**: Skeletons should be drawn as white/bone-colored figures holding a bow. Their color palette must contrast sharply with walls (which could also be dark gray) -- add detail like glowing eyes or a visible weapon. The bow draw animation provides visual warning before the projectile fires, giving the player a reaction window.

---

### [ ] 4.5 Implement Enemy Type 3: Mini-Boss (tough boss enemy)
Create a `MiniBoss` enemy class extending Enemy with specific behaviors and properties: HP is 10-15x normal enemy at same depth, detection radius ~8 tiles, multiple attack patterns that cycle or are triggered by conditions (e.g., Phase 1 = charge attacks when player is far; Phase 2 when HP drops below 50%, switches to area slam + minion summon), unique visual design with aura particles, larger hitbox. On death: massive particle explosion, significant XP drop, guaranteed rare weapon drop.

**Playability note**: The mini-boss must be visually distinct through size (1.5-2x player sprite), color (deep purple/dark red that contrasts with both player cyan and enemy greens/whites), effects (pulsing aura particles, screen shake on each attack). The player must instantly recognize this is a major threat from across the room. Attack patterns should be telegraphed visually (e.g., boss glows before charging, floor marks appear before area slam) so the player learns to read and react.

---

### [ ] 4.6 Implement enemy death animation and removal
When an enemy's HP reaches zero, play its death animation: Slime squishes into a puddle of particles, Skeleton scatters bone fragments, Mini-Boss explodes with a burst of dark particles and screen shake. The death animation lasts 0.5-1.0 seconds during which the entity is still rendered but invulnerable (so damage doesn't register on a "dead" enemy). After the animation duration elapses, mark the entity for removal from its parent room's entity list.

**Verification**: Dead enemies play their unique death animation and are removed from the active entity list; no damage numbers spawn after death; particles from the death animation continue rendering until all die naturally.

---

### [ ] 4.7 Implement enemy spawning and room assignment
Wire enemies into the dungeon generation system so each non-spawn room has a suitable set of enemies based on its depth/level and room role. Corridor rooms (narrow rooms along paths) get 1-2 weak Slimes. Standard rooms get mixed compositions (e.g., 3 Slimes + 1 Skeleton Archer). The boss room gets one Mini-Boss (plus optionally 1-2 minions to prevent the fight being too trivial). Scaling rules: at dungeon depth 1, enemies are weakest; each subsequent depth adds +1 enemy per room and increases HP/damage by a configurable multiplier. Ensure no room is impossible by capping maximum enemy count per room.

**Verification**: Generated dungeons consistently spawn appropriate enemies per room; difficulty increases with dungeon depth; boss rooms always contain exactly one Mini-Boss.

---

## Phase 5 -- Doors, Traps & Item Interactions

### [ ] 5.1 Implement door and exit system
Create a `Door` entity (or tile-level logic) that exists at room exits/connections. Doors have two states: locked (requires a key to open) and unlocked (passable). When the player walks into a locked door's position, check if they possess a key in inventory -- if yes, consume one key, transition door to unlocked state, play an unlock SFX, and allow passage. When the player reaches the exit room's exit door, trigger a room transition: fade to black, generate/load the next dungeon level (or show Victory screen if final room), then fade back in.

**Criticality: HIGH** -- Without this step, keys have no purpose, rooms are not connected, and there is no way to progress through the dungeon or advance to subsequent levels. This is core game flow.

---

### [ ] 5.2 Implement hazard / trap tile mechanics
Create logic for hazard tiles placed in the dungeon during generation:
- Hazard types: spike pits (instant damage on step), fire traps (damage-over-time area), poison zones (slight HP drain over time while standing in it)
- Triggered when the player's hitbox overlaps any part of the hazard tile
- Damage is applied once per entry (not every frame) with a cooldown timer to prevent tick-based one-shotting
- Hazard tiles pulse or animate to visually signal danger before stepping on them
- A small particle effect plays when the hazard triggers

**Verification**: Stepping on a spike tile deals damage and plays a hit SFX; standing in a fire trap causes periodic damage ticks with visible particle effects; hazard animations are visible from multiple tile distances so the player can avoid them.

---

### [ ] 5.3 Implement room transition / level loading
Create a `RoomTransition` system that handles moving between rooms within a dungeon and between dungeon levels:
- Within-dungeon transitions: when the player crosses a door to an adjacent room, trigger a brief fade-to-black (0.3s), load the new room's tile map, spawn room-appropriate enemies, reset camera to the door position, then fade back in
- Between-level transitions: when the player crosses the exit from the boss room, show the Victory screen instead of fading into another room
- The transition animation uses simple alpha interpolation over a full-screen black rectangle

**Verification**: Crossing between connected rooms plays a smooth fade transition; enemies are present and immediately active after arriving at a new room; camera is positioned to not cut off the player.

---

## Phase 6 -- HUD, UI & Game States

### [ ] 6.1 Implement the HUD overlay
Create a `HUD` system that renders on top of the game world, drawn by the Renderer after all entities:
- HP bar in the top-left corner: red fill, with dark background panel for contrast even over bright floor tiles; displays "HP X/Y" text numerically beside or inside the bar; when HP drops below 30%, the bar flashes/pulses to create visual urgency
- XP bar directly below HP bar: blue/gold fill showing progress toward next level; displays "LVL X" text; shows as full with a glow animation when close to leveling up (e.g., 80%+)
- Current weapon name displayed near the bottom-left, updated when weapons change
- Active inventory slot indicators (small dots or numbers) in the top-right showing which slots are filled and which key presses them
- Enemy direction indicators: subtle colored arrows on the screen edges pointing toward the nearest active enemy outside the viewport (helps the player orient when enemies are off-screen)

**Criticality: HIGH** -- The HUD is the player's primary information source during combat. Bars must be readable at a glance, even during fast action. HP bar text should always show current/max values numerically. The HUD panel background must be dark enough to remain legible over any dungeon floor color.

---

### [ ] 6.2 Implement floating damage numbers
Create a `FloatingText` system for spawning floating text above entities when they take damage or gain XP. Each floating text tracks: position (entity's x, y offset), velocity (always upward), lifetime, color (red for damage taken, green for healing, yellow/white flash for critical hits, gold for XP gains), and the text string to display. On update: move upward by a fixed speed, reduce alpha over lifetime, remove when expired. Prevent excessive overlap by spacing new floating texts slightly horizontally from nearby existing texts on screen.

**Verification**: Taking damage shows a number floating up from the entity; numbers are legible against any background; multi-hit scenarios don't create a wall of text that obscures the player.

---

### [ ] 6.3 Implement the Minimap
Create a `Minimap` system rendered in the top-right corner of the screen as a small rectangular overlay:
- Shows a zoomed-out overview of all explored dungeon areas (tiles visited by the player are revealed; unexplored areas show as dark/gray)
- Room shapes and corridor connections drawn with simplified rectangles and lines
- Current room highlighted with a brighter border or fill
- Player position as a small bright dot (cyan, matching the player's visual identity)
- Enemy positions as small red dots (only enemies in the current room are shown; enemies in other rooms are hidden to prevent information overload)
- The minimap background uses a dark panel with high contrast against all dungeon floor colors

**Criticality: HIGH** -- The minimap is the player's primary navigation tool. Without it, getting lost in procedurally generated dungeons becomes frustrating rather than fun. Player dot must be instantly visible on the minimap even next to room outlines.

---

### [ ] 6.4 Implement the Start Screen
Create a full-screen start screen rendered by the Renderer with: game title displayed prominently using large stylized text (drawn via Canvas primitives, no font files), brief instructions listing all keybindings (movement: Arrow keys or ZQSD; attack: Space; inventory slots: 1-N; pause: Escape), and a "Press Enter to Start" prompt with pulsing/opaque alpha animation. Background should be atmospheric -- draw a simple dark dungeon scene using Canvas primitives (floor tiles, walls, a faint torch glow).

**Verification**: Opening the game shows the start screen immediately; pressing Enter transitions to gameplay without errors; keybindings are clearly displayed and match the actual controls.

---

### [ ] 6.5 Implement Pause functionality
Pressing Escape toggles pause state: when entering pause, render a semi-transparent black overlay on top of everything with "PAUSED" text centered in large font; all game updates (entity movement, physics, timers) stop except input handling and the HUD (which should show "PAUSED"). Pressing Escape again resumes exactly where left off -- camera position, entity positions, and internal timers should continue from the exact frame that was paused.

**Verification**: Pressing Escape brings up pause overlay; pressing Escape again resumes exactly where left off with no state discontinuity; pressing other keys during pause does not trigger game actions (only Escape toggles resume).

---

### [ ] 6.6 Implement Game Over screen
When player HP reaches zero, transition to a Game Over screen: fade out gameplay over ~1 second, render a dark overlay with "GAME OVER" text, display final stats (level reached, XP total, dungeon depth reached), and show "Press Enter to Retry" with pulsing animation. When Enter is pressed, completely reset all game state (create new Player instance, generate new dungeon from spawn room, clear all entity lists, reset camera, reset audio) and return to the Start Screen (not directly into gameplay -- this ensures a clean mental break between attempts).

**Verification**: Dying triggers the fade-to-game-over; stats display correctly; pressing Enter returns cleanly to Start Screen; starting a new game has no residual state from the previous run.

---

### [ ] 6.7 Implement Victory screen
When the player defeats a mini-boss (completing a dungeon level's boss room), transition to a Victory screen: fade out gameplay over ~1 second, render overlay with "LEVEL CLEARED" or "VICTORY" text, display stats (level reached, enemies defeated count, items collected count, remaining potions), and show "Press Enter for Next Level" (generates a new deeper dungeon) or "Return to Start" option. The next level's difficulty multiplier should be higher than the previous level.

**Verification**: Defeating the mini-boss triggers the victory screen with accurate stats; pressing Enter generates the next dungeon level with increased enemy count and scaled stats; all systems function correctly after entering a new level.

---

## Phase 7 -- Integration, Polish & Final Audit

### [ ] 7.1 Wire all systems together in the Game class
Integrate every system (game loop, input, rendering, camera, player, enemies, projectiles, dungeon, collision, combat, items/loot, inventory, particles, audio, HUD, minimap, doors, traps, room transitions, game states) into a cohesive `Game` class with proper initialization order and state management. Ensure all state transitions work: Start -> Playing -> Paused -> Resume, Playing -> Game Over -> Retry -> Start, Playing -> Victory -> Next Level -> Playing. No system should have circular dependencies or null-reference crashes at any point during the game lifecycle.

**Verification**: The game launches from start screen, enters gameplay, supports pause/resume, handles death and victory, loads new levels, and restarts cleanly -- all without console errors or frozen states. Play through at least one full level end-to-end without encountering a state-related bug.

---

### [ ] 7.2 Implement entity visual damage feedback
Add visual feedback to entities when they take damage that is distinct from floating numbers: the player flashes white for 0.15 seconds (hit-flash effect) and enemies flash white or their hitbox outline briefly pulses. This provides immediate, unmistakable confirmation that damage was applied -- even if the enemy has high HP and only loses a small amount visually (the flash confirms "something happened" regardless of the number).

**Verification**: When an enemy takes damage, it flashes white; when the player is hit, they flash white for their invincibility frame duration. Both effects are brief enough not to obstruct vision but obvious enough to confirm hits instantly.

---

### [ ] 7.3 Implement screen shake and hit-stop for combat impact
Wire up screen shake and hit-stop effects triggered during combat: heavy hits (player taking more than X damage in a single instance, or boss attacks) trigger screen shake proportional to damage amount (small shake for normal hits, large shake for boss slams). Hit-stop freezes all game logic updates for 2-4 frames on impactful hits to give the feeling of impact resistance. Both effects must be smooth and not cause visible stuttering when multiple occur in rapid succession (queue them or use a single combined effect state).

**Verification**: Hitting an enemy produces a small screen shake; taking a boss attack produces a larger shake; hit-stop briefly freezes action without causing frame glitches; rapid consecutive hits don't stack effects into an unusable blur.

---

### [ ] 7.4 Implement full entity animation system
Add smooth, recognizable animations to all entities using Canvas primitives (no image files):
- Player: walk cycle (subtle body tilt and leg movement alternating per direction), sword swing arc animation during attack, idle bob (gentle vertical oscillation so the player is never static), damage flash overlay
- Enemies: walk wobble (body shifts side-to-side while moving), attack wind-up animation before firing or striking, stagger/shake animation when hit, death dissolve effect (shrinking + particle burst)
- Items: subtle pulsing glow and gentle vertical float/bob so dropped items draw the eye
- Projectiles: spinning or trailing motion that makes their direction and speed readable

Ensure animations are recognizable even at minimap scale (simplified versions drawn in the minimap overlay).

**Verification**: Player has a distinct walk cycle, sword swing, idle bob, and damage flash. Each enemy type has a movement wobble, attack animation, hit stagger, and death effect. Dropped items pulse visibly. Projectiles have clear directional motion trails. All animations loop smoothly without stutter.

---

### [ ] 7.5 Color palette consistency audit
Define the final color palette explicitly in the configuration object:
- Player: cyan (#4fc3f7 or equivalent) -- used ONLY for player, never elsewhere
- Floor: dark warm gray (#2d2d2d or similar)
- Walls: darker than floor with edge highlights (#1a1a1a + #3a3a3a edges)
- Hazard tiles: pulsing red-orange (#e65100) -- communicates "danger" universally
- Slime: muddy green (#4caf50 or darker variant, clearly distinct from potion green)
- Potion: bright emerald green (#66bb6a or brighter than slime)
- Skeleton: white/bone (#eeeeee) with glowing eyes (#ff5722) for contrast against dark walls
- Mini-Boss: deep purple/dark red (#9c27b0 or #b71c1c) -- completely distinct from player, enemy greens, and floor/wall grays
- Projectiles: bright orange/red (#ff6d00 with glow outline)
- Keys: gold/yellow (#ffd54f)
- HP bar panel: dark semi-transparent black for contrast against any background
- XP bar: blue/gold gradient

Review every rendered element to ensure the above colors are applied consistently. No element should share its primary color with a different entity type.

**Criticality: HIGH** -- A failed color audit breaks playability irreparably. If the player cannot tell friend from foe, ally from hazard, or healable item from enemy at a glance, no amount of code quality compensates for that confusion.

---

### [ ] 7.6 Balance game difficulty and progression
Using the centralized constants from step 1.0, tune all numeric values for a satisfying difficulty curve across dungeon depths:
- Enemy HP increases by ~25% per depth level; damage increases by ~15%; speed remains constant or slightly decreases (deeper = tougher but not faster to dodge)
- Player starting stats: HP=10, Attack=5, Defense=2, Speed=3 (example values that yield a 2-3 hit survival window against first-level Slimes)
- Potion healing restores ~40% of max HP
- XP threshold for level 2 = roughly 3x the XP earned from defeating the first room's enemies (rewarding the player on their first successful combat encounter)
- Level-up stat increases feel meaningful but not game-breaking (+15% attack should noticeably shorten fight times against the same enemy)
- Item drop rates: Slimes have a 30% potion drop rate, Skeleton Archers 20%, Mini-Bosses guaranteed weapon or multiple potions
- Keys are plentiful enough that the player rarely misses doors (at least 1 key per room with locked doors)

Target difficulty curve: first level should be completable by an unfamiliar player without excessive death count (aim for 3-5 deaths as a reasonable first-playthrough benchmark). Each subsequent level should feel meaningfully harder but not overwhelmingly so.

**Criticality: HIGH** -- Poor balance makes the game either trivially easy or impossibly hard. Both are unplayable in different ways. The goal is a sweet spot where the player feels challenged but always fair -- death should feel like "I could have done better" not "the game cheated."

---

### [ ] 7.7 Final playtesting pass
Play through the entire game from start to victory, checking every aspect of playability:
- Movement feels responsive and natural (no input lag, no unexpected diagonal acceleration)
- Combat is readable -- you can always see what hits you and what you hit; floating numbers and damage flashes provide clear feedback
- Navigation via minimap works intuitively; the player dot's position maps correctly to on-screen location
- Inventory management doesn't break gameplay flow (equip/consume with single key press during movement)
- All UI text is legible at its display size and spelled correctly
- Audio levels are balanced across all elements (music doesn't drown SFX, hit impacts are audible but not painful)
- Game runs at a smooth frame rate (60fps target) with no stutters even during particle-heavy moments (e.g., multi-enemy boss fight)
- No edge-case bugs: walking diagonally through tight corridor corners, enemies getting stuck in tile corners after knockback, audio context failing on tab-switch, dungeon generation creating impossible room layouts
- Screen shake and hit-stop enhance combat feel without causing disorientation
- The game is fun -- the core loop (explore -> fight -> loot -> level up -> repeat) feels rewarding

**Verification**: A fresh playthrough completes end-to-end within 10-20 minutes of real time without confusion, frustration from poor visibility/readability, or technical errors. On a second playthrough, the player has enough knowledge to improve and should feel progression in their skills and understanding of the game systems.

---

## Implementation Order Summary

Follow the numbered sequence above strictly. Each phase depends on the prior one:

0. Constants (1.0) → 1. Foundation (1.1-1.9) → 2. Dungeon & Collision (2.1-2.4) → 3. Player & Combat (3.1-3.7) → 4. Enemies & Projectiles (4.1-4.7) → 5. Doors, Traps, Transitions (5.1-5.3) → 6. HUD/UI/States (6.1-6.7) → 7. Integration & Polish (7.1-7.7)

**Hard dependencies:**
- Do NOT implement enemy AI (Phase 4) before the player can move and collide with walls (Phases 1-3).
- Do NOT add particles before the combat system exists (particles are tied to hit events in Phase 3+).
- Do NOT add audio until at least one sound trigger is available to test it against (combat SFX in Phase 3.5).
- Do NOT wire everything together (Phase 7.1) before every subsystem is independently verified.
- Do NOT skip the color palette audit (Phase 7.5) -- this single step prevents unplayable visual confusion.

---

## Playability Checklist (final pre-release audit)

Before considering implementation complete, verify every item:

- [ ] Player character is visible and distinguishable from everything else on screen at all times
- [ ] Enemy types are visually distinct from each other AND from walls/floors/projectiles/items
- [ ] Projectiles have a clear "dangerous" color (red/orange) against all possible backgrounds
- [ ] Healing items/potions have a clear "safe" color (green) -- never confused with hostile elements
- [ ] Keys have a distinct color (gold/yellow) that doesn't conflict with any other element
- [ ] HP bar has high contrast, shows numeric values (X/Y), and pulses when low for urgency
- [ ] XP bar clearly shows progress toward next level with visual feedback near fill-up
- [ ] Minimap shows player position, explored rooms, corridors, and current-room enemies
- [ ] Combat provides BOTH visual AND audio feedback on every hit (damage numbers + SFX + flash/knockback)
- [ ] Player can always navigate back to previously explored areas using the minimap
- [ ] Doors communicate state visually (locked vs unlocked); keys function as expected
- [ ] Hazard tiles have visible warning animations before stepping into them
- [ ] All game state transitions are smooth and reversible where appropriate (pause/resume is lossless)
- [ ] No critical information is hidden behind menus during active combat
- [ ] Game runs at a consistent frame rate on target hardware with no stutters
- [ ] Audio does not overwhelm or become painful over repeated playthroughs
- [ ] Single file loads and plays in any modern browser with zero console errors
- [ ] A new player can complete the first dungeon level without excessive difficulty spikes
- [ ] The game is fun -- the core loop feels rewarding, not tedious
