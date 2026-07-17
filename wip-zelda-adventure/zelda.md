Act as an expert game developer and creative technologist. Your task is to design and implement a fully playable 2D browser game contained entirely within a single HTML file. This project should demonstrate deep code architecture, robust systems integration, and cohesive creative direction.

## Core Constraints
1. **Single File Delivery:** All HTML, CSS, and JavaScript must live in one `index.html` file. Zero external dependencies: no CDNs, no image assets, no sound files, no fonts. All visuals rendered via Canvas API; all audio synthesized via WebAudioAPI.
2. **Line Count & Depth:** The final code should naturally fall between 2,000 and 5,000 lines. Achieve this through comprehensive feature implementation, modular class design, detailed comments, and robust game systems—not filler or repetition.
3. **Immediate Playability:** The game must launch without errors in any modern browser. It requires a Start Screen, fully functional gameplay loop, pause/restart capabilities, and a Game Over / Victory state with seamless replay.

## Technical Architecture Requirements
- Implement proper game loop structure (`requestAnimationFrame`), delta-time handling, fixed-step updates for physics/collision, and smooth camera following.
- Ensure collision detection uses AABB or circle-based hitboxes with reliable overlap resolution.
- All state transitions must be explicit and recoverable.

## Gameplay Features to Implement
- **Procedural Dungeon Generation:** Create a tile-based dungeon with rooms, connected corridors, walls, floors, doors, and hazards. Use a seeded or algorithmic approach (e.g., BSP, cellular automata, or room-plus-corridor).
- **Player Systems:** 
  - ZQSD/Arrow movement with camera tracking
  - Stats: HP, Attack, Defense, XP, Level, Speed
  - Combat: Melee swing with cooldown, hitbox validation, knockback, and floating damage numbers
  - Inventory: Equippable/consumable items (potions, keys, weapons) managed via a grid or list system
- **Enemy AI & Variety:** Implement at least three distinct enemy types (e.g., melee chaser, ranged shooter/turret, and a mini-boss). Each must use a state machine or behavior tree covering: Idle, Patrol, Chase, Attack, Flee/Stagger, and Death.
- **Particle System:** Reusable pool-based particle engine for combat sparks, explosions, pickup trails, and environmental effects.
- **Procedural Audio Engine:** Synthesize retro-style SFX and a dynamic background track that shifts intensity during combat. Include footstep sounds, hit impacts, level-up chimes, and menu navigation tones.
- **HUD & Minimap:** Real-time display of health/XP bars, inventory slots, active effects, enemy indicators, and a zoomed-out minimap showing visited explored areas.

## Creative Direction
You have full creative freedom over the visual theme, narrative tone, and game balance. Choose one cohesive aesthetic (e.g., neon vector, pixel-art canvas drawing, or low-poly 2D) and apply it consistently across sprites, UI, VFX, and audio design. Name your enemies, items, and systems creatively. Ensure the gameplay loop feels rewarding and balanced.

## Output Format
Provide only the complete, ready-to-run code inside a single HTML markdown block. The file must be directly savable as `index.html` and executable without modification. Begin the file with a concise comment block describing the theme, feature set, and architecture choices, followed by the full source code. Do not include explanations outside the code block.
