# Classic Retro Game Prompt Library

A curated collection of benchmark prompts for evaluating AI/autonomous agent game development capabilities. Each prompt describes a web-based game with classic retro mechanics plus a unique thematic or gameplay twist, designed to be challenging but achievable within a single development goal using standard web technologies (HTML5 Canvas, CSS, JavaScript).

## Index

1. [Gravity Flip Platformer](./prompts/01-gravity-flip-platformer.md) - Side-scrolling platformer with gravity inversion mechanic
2. [Neon Breakout](./prompts/02-neon-breakout.md) - Brick-breaking game with power-up chain reactions and neon aesthetic
3. [Maze of Mirrors](./prompts/03-maze-of-mirrors.md) - Pac-Man style chase game with maze-generating mirror portals
4. [Pixel Sentinel](./prompts/04-pixel-sentinel.md) - Tower defense with unit evolution and organic lane merging
5. [Void Invaders](./prompts/05-void-invaders.md) - Arcade shooter with spiral formation enemies and energy management

## Usage

Each prompt file is self-contained and can be fed directly to an autonomous agent or AI worker as a `/goal` instruction. The prompts are structured to:
- Define clear core mechanics and the thematic variation
- Specify technical requirements (HTML5 Canvas, no external assets)
- Outline scope boundaries to keep implementation feasible in one session
- Include win/lose conditions and progression systems
- Define scoring or benchmark metrics

## Genre Selection Criteria

Genres were selected from a pool of 10 classic retro types based on:
- **Feasibility**: Can be implemented in a single HTML5 file (~1000-2000 lines) within one development session
- **Benchmark value**: Tests specific AI coding competencies (physics, state machines, procedural generation, etc.)
- **Distinct mechanics**: Each tests different programming paradigms and logic patterns
