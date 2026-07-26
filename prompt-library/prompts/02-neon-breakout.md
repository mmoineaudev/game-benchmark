# Prompt 02: Neon Breakout — "Chain Reaction"

## Role
You are an expert HTML5 game developer. Create a single-file, self-contained web-based brick-breaking paddle game prototype called "Chain Reaction".

## Core Concept
A breakout/arkanoid-style brick-breaking game with a **chain reaction mechanic**: when a ball breaks two adjacent bricks of the same color, they both explode and launch a secondary ball that targets remaining bricks of matching colors. Chain reactions cascade, potentially clearing large sections of the board in spectacular fashion. The twist: instead of one ball always destroying everything, you strategically want to create color matches for combos.

## Technical Requirements
- Single HTML file with embedded CSS and JavaScript (no external dependencies, no image assets)
- Use HTML5 Canvas for all rendering
- All visuals must be procedural — shapes, lines, glowing rectangles using Canvas API
- Keyboard controls: Left/Right arrows or A/D for paddle movement, Space to launch ball
- Mouse/touch support: paddle follows cursor/finger position
- Game loop using requestAnimationFrame with delta-time physics

## Gameplay Mechanics

### Paddle and Ball(s)
- Paddle: a glowing horizontal bar at the bottom of the screen (~120px wide), moves left/right
- Ball: starts as 1 ball (neon white/cyan circle) — launched with Space or by clicking
- Ball physics: bounces off walls, paddle, and bricks; angle changes based on where it hits the paddle (left side = bounce left, right side = bounce right)
- Max simultaneous balls: 5 (to prevent performance issues with chain reactions)

### Brick Grid
- Initial grid: 8 columns x 6 rows of bricks (48 bricks total)
- 4 colors used: cyan, magenta, yellow, green (each color has 12 bricks)
- Bricks are arranged in a pattern — not completely random — so players can plan chain reactions
- Each brick has 1 hit point for the first 3 rows, 2 hit points for the 4th row, and 3 hit points for the top 2 rows (visual health shown by color saturation)

### Chain Reaction System
- **Trigger**: When a ball breaks a brick, check all orthogonally adjacent bricks (up, down, left, right). If any share the same color, they are also destroyed.
- **Secondary ball**: Each newly exploded brick launches a small secondary ball toward a random remaining brick of that same color. Max 3 secondary balls per chain to prevent chaos.
- **Cascade limit**: Chains stop after 5 cascade levels to prevent infinite loops.
- **Visual feedback**: Bricks explode with expanding circle animation (ring grows and fades), colored to match the brick.

### Power-ups (dropped by certain bricks)
When a brick is destroyed, it has a 20% chance of dropping a power-up that the paddle can catch:
1. **Wide Paddle** (cyan): Paddle grows 50% wider for 10 seconds
2. **Multi-ball** (magenta): Splits current ball into 3 balls traveling in different directions
3. **Slow Motion** (yellow): All balls slow to 50% speed for 8 seconds
4. **Piercing Shot** (green): Ball passes through bricks instead of bouncing off them, destroying everything it touches for 5 seconds

### Level Progression
- Clear all bricks to advance — each level increases brick rows by 1 (max 12 rows)
- New levels introduce: faster ball speed, power-up cooldowns that remove paddle width gains between levels
- Each cleared level shows a brief "Level Complete" overlay with score

### Enemies/Obstacles (later levels only, from Level 3 onwards)
- **Shielded bricks**: Top 2 rows have a translucent shield overlay; they take 2 hits instead of their normal HP
- **Indestructible bricks**: Gray bricks that act as walls — balls bounce off them but they can never be destroyed. Placed as barriers between color sections.

## Scoring
- Base brick destroy: 10 points x number of chain reactions it triggered
- Chain multiplier: Each successive brick in a chain reaction adds 5x the chain depth to its point value
- Combo bonus: 50 points for completing a full-color-clear (all bricks of one color eliminated in a single chain)
- Level completion bonus: 500 x level number

## UI/UX
- Start screen: title "CHAIN REACTION" with controls and brief instructions
- HUD: score, current level, balls remaining, active power-ups
- Dark background (#0a0a1a), neon-colored bricks and elements
- Particle effect on brick destruction (small squares fly outward, fading)
- Game over when all balls are lost — show final score and "Play Again" button

## Scope Constraints
- Do NOT implement: 3D graphics, complex sprite animations, sound beyond Web Audio API beeps
- DO keep physics predictable and fair
- Ball speed should never exceed ~600px/second
- Canvas resolution: at least 800x600 pixels, centered on screen

## Acceptance Criteria
- [ ] Single HTML file runs in any modern browser without setup
- [ ] Basic paddle-ball-brick physics work correctly (bouncing, collision detection)
- [ ] Chain reaction mechanic triggers when adjacent same-color bricks are destroyed
- [ ] Secondary balls from chain reactions are launched and behave correctly
- [ ] Cascade limit prevents infinite loops (max 5 levels deep)
- [ ] At least 3 power-ups functional with visible effects
- [ ] Scoring system tracks chains, combos, and level bonuses
- [ ] Visual explosion effects on brick destruction
- [ ] Game over condition and restart work properly
- [ ] All visuals procedurally drawn — no external assets
