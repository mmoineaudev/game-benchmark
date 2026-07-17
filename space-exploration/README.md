# Space Exploration

Procedural space exploration game built with **Three.js** and **Vite**.

## Quick Start

```bash
# Install dependencies
npm install

# Development server (hot reload)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

Open the dev server URL in your browser to play.

## Controls

| Input | Action |
|-------|--------|
| **W/A/S/D** | Thrust / Strafe |
| **Mouse** | Steer ship (roll & pitch) |
| **Space / Left Click** | Fire weapons |
| **M** | Toggle mute |
| **R** | Restart (on game over) |

## Features

- **Procedural infinite world** — Biome progression (Open Space → Asteroid Belt → Nebula Corridor → Wormhole Tunnel)
- **Detailed ship model** — Fuselage, wings, cockpit glass, engine nacelles, navigation lights, engine flames
- **Particle effects** — Exhaust trails, laser impacts, explosions with custom GLSL shaders
- **Post-processing pipeline** — Bloom, chromatic aberration, vignette, film grain
- **Procedural audio** — Web Audio API engine rumble, laser shots, explosions, warning beeps
- **Instanced rendering** — Thousands of asteroids/debris via InstancedMesh for performance
- **Collision system** — Sphere-based physics for ship and projectiles
- **Score & health tracking** — HUD overlay with localStorage high score persistence

## Architecture

```
src/
├── core/        — Constants, EventBus, GameState, Game (orchestrator)
├── systems/     — Input, Camera, Physics, Audio, Particles, PostProcessing
├── gameplay/    — PlayerShip, WeaponSystem, ScoreSystem, BuffSystem
├── level/       — Starfield, Nebula, Asteroids, Debris, ChunkManager, BiomeGenerator
├── ui/          — HUD, Crosshair
├── utils/       — MathHelpers, ShaderHelpers (GLSL functions)
└── main.js      — Entry point
```

## Tech Stack

- **Three.js** 0.165 — 3D rendering
- **Vite** 5.4 — Build tool & dev server
- **Web Audio API** — Procedural sound synthesis
- **GLSL** — Custom shaders for nebula clouds, particles, post-processing

## Performance

- Targets 60fps on mid-range hardware
- InstancedMesh for repeated geometry (asteroids, debris)
- Low-end device detection disables expensive post-processing passes
- Delta-time capped at 0.1s to prevent tab-out death spirals

## License

MIT
