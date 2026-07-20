# Space Exploration — Void Drift

Procedural space exploration game built with **Three.js** and **Vite**.

> **Primary Loop:** Fly → Discover → Navigate → (optionally destroy debris) → Push further.  
> Shooting is supporting; visual immersion is the main goal.

## Quick Start

### One-Command Launcher (Recommended)

```bash
# Start dev server (auto-opens browser)
./launch.sh

# Production build only
./launch.sh build
```

The launcher script:
- Checks for Node.js ≥ 18 and npm
- Installs dependencies if `node_modules/` is missing
- Starts Vite dev server with hot reload
- Auto-opens the game URL in your browser
- Tracks PID, allows graceful Ctrl+C shutdown
- Reuses existing server if already running

### Manual Setup

```bash
npm install          # Install dependencies
npm run dev          # Dev server on localhost:5173
npm run build        # Production build to dist/
npm run preview      # Preview production build
```

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
space-exploration/
├── launch.sh              — One-command launcher (build + serve + open browser)
├── index.html             — Game canvas + HUD overlay
├── public/
│   └── index.html         — Stylish title/launcher screen
├── src/
│   ├── main.js            — Bootstraps Game, mounts canvas
│   ├── core/              — Constants, EventBus, GameState, Game (orchestrator)
│   ├── systems/           — Input, Camera, Physics, Audio, Particles, PostProcessing
│   ├── gameplay/          — PlayerShip, WeaponSystem, ScoreSystem, BuffSystem
│   ├── level/             — Starfield, Nebula, Asteroids, Debris, ChunkManager, BiomeGenerator
│   ├── ui/                — HUD, Crosshair
│   └── utils/             — MathHelpers, ShaderHelpers (GLSL functions)
└── package.json           — Vite + Three.js 0.165
```

## Tech Stack

| Tool | Purpose |
|------|---------|
| **Three.js** 0.165 | 3D rendering |
| **Vite** 5.4 | Build tool & dev server |
| **Web Audio API** | Procedural sound synthesis |
| **GLSL** | Custom shaders (nebula, particles, post-processing) |

## Performance

- Targets 60fps on mid-range hardware
- InstancedMesh for repeated geometry (asteroids, debris)
- Low-end device detection disables expensive post-processing passes
- Delta-time capped at 0.1s to prevent tab-out death spirals

## License

MIT
