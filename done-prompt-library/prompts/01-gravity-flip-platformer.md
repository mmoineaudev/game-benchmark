# Prompt 01: Gravity Flip Platformer — "Neon Descent"

## Role
You are an expert HTML5 game developer. Create a single-file, self-contained web-based platformer game prototype called "Neon Descent".

## Core Concept
A side-scrolling platformer with a **gravity inversion mechanic**: the player can flip gravity at any time, causing them to fall toward the ceiling instead of the floor (and vice versa). Platforms exist on both the top and bottom boundaries, plus scattered mid-screen platforms. The challenge is navigating by flipping between ceiling-walking and floor-walking to avoid obstacles and collect items.

## Technical Requirements
- Single HTML file with embedded CSS and JavaScript (no external dependencies, no image assets)
- Use HTML5 Canvas for rendering
- All visuals must be procedural: draw shapes, lines, and colored rectangles using Canvas API
- Keyboard controls: Arrow keys or WASD for movement, Space or Shift for gravity flip
- Game loop using requestAnimationFrame with delta-time physics
- Touch support: tap screen to flip gravity (mobile-friendly)

## Gameplay Mechanics

### Player Character
- A neon-styled square/circle (glowing effect achievable via Canvas shadowBlur)
- Horizontal movement: accelerate/decaccelerate for smooth feel
- Gravity flip: instant inversion of gravity direction (no jumping needed — flipping IS the primary mechanic)
- Cooldown: 0.2 second cooldown between gravity flips to prevent spam

### Level Design
- Procedurally generated level that scrolls horizontally as the player moves right
- Platforms on ceiling, floor, and scattered in the middle (drawn as colored rectangles with neon glow)
- Each "segment" of the level is ~800px wide; generate new segments as player advances
- At least 5 distinct segment types that can be combined:
  - Narrow corridor (forces a flip)
  - Wide open space (optional flips for collecting items)
  - Obstacle gauntlet (spikes on one surface, must flip to avoid)
  - Collectible clusters (items floating between surfaces)

### Obstacles
- Spikes/traps on ceiling or floor that deal damage
- Moving platforms on ceiling/floor
- "Dead zones" — gaps in the floor or ceiling with no platform to stand on

### Items and Scoring
- Collectibles: small glowing orbs scattered throughout (10 points each)
- Speed boost pads: give a burst of horizontal speed for 2 seconds
- Health system: player starts with 3 health; touching a spike costs 1 health
- Game ends when health reaches 0 or the player falls off the bottom without any platform to flip to

### Difficulty Scaling
- As distance increases, spike density increases and corridors narrow
- Every 5000 pixels of travel, introduce a new obstacle type that wasn't present before
- Track max distance traveled as the primary score metric

## UI/UX
- Start screen: title "NEON DESCENT" with instructions
- HUD during gameplay: score, health (hearts or bars), distance traveled
- Game over screen: final score, distance, and a "Play Again" button
- Use a dark background (#0a0a1a) with neon-colored elements (cyan, magenta, yellow, green)
- Simple sound feedback using Web Audio API oscillator beeps (optional but preferred)

## Scope Constraints
- Do NOT implement: multiplayer, levels with vertical-only rooms, complex character animations
- DO keep the level generation coherent and challenging
- Physics should feel responsive — no floating or drifting
- The game must be immediately playable on load — no loading screens, no external files

## Acceptance Criteria
- [ ] Single HTML file runs in any modern browser without setup
- [ ] Gravity flip mechanic works smoothly with immediate response
- [ ] Procedural level generation creates a coherent, challenging experience
- [ ] At least 5 distinct segment types appear in the level pool
- [ ] Scoring system (collectibles + distance) is visible and functional
- [ ] Game over condition triggers cleanly with restart option
- [ ] All visuals are procedurally drawn — no external assets required
