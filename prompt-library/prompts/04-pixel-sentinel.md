# Prompt 04: Pixel Sentinel — "Neon Lanes"

## Role
You are an expert browser game developer. Create a self-contained web-based tower defense prototype using Three.js, built for long-term progression and retro-sci-fi spectacle. Deliver as a single working project with embedded CSS and JavaScript.

## Core Concept
"Pixel Sentinel" is a grid-based tower defense on a neon-drenched retro-future grid. Players place towers along a winding path that is generated procedurally through a connected tile grid, route enemies through it, and survive indefinitely scaling waves of enemies. The twist: every component is interactive, the map breathes with smoke-like volumetric shaders, and the difficulty curve is governed by a global wave coefficient that increases money and enemy complexity together.

## Technical Architecture
This project follows a browser-game-friendly systems layout based on proven Three.js patterns, with a focused tower-defense subset:

```
project/
├── index.html                  ← Vite/static entry: canvas + HUD overlay
├── package.json
├── vite.config.js
├── src/
│   ├── main.js                 ← Bootstrapper
│   ├── core/
│   │   ├── Constants.js        ← All magic numbers, colors, timings, tower/enemy/wave config
│   │   ├── EventBus.js         ← Singleton pub/sub (domain:action events)
│   │   ├── GameState.js        ← Centralized state singleton
│   │   └── Game.js             ← Orchestrator: init, loop, pause, restart, shutdown
│   ├── systems/
│   │   ├── InputSystem.js      ← Keyboard/mouse bindings, pause, right-click suppress
│   │   ├── RenderSystem.js     ← Three.js renderer, scene, camera, resize/render
│   │   ├── PostProcessingSystem.js
│   │   ├── WaveManager.js      ← Wave scheduling, boss cadence, coefficient scaling
│   │   ├── EconomyManager.js   ← Money, sell-back, milestone tracking
│   │   ├── PathSystem.js       ← Grid path generation, path mesh, tile visualization
│   │   ├── TowerManager.js     ← Tower placement, targeting, upgrades on grid
│   │   ├── EnemyManager.js     ← Spawning, types, movement along path
│   │   ├── ProjectileSystem.js ← Projectiles, collision routing
│   │   ├── CollisionSystem.js  ← Hit-testing tower↔enemy, projectile↔enemy, boss↔tower
│   │   ├── ParticleSystem.js   ← Smoke, hits, explosions
│   │   ├── AudioSystem.js      ← Procedural SFX via Web Audio API
│   │   └── ContextMenuSystem.js← Right-click folding menus on towers/enemies/tiles
│   ├── ui/
│   │   ├── HUD.js
│   │   ├── TooltipMenu.js
│   │   └── PauseOverlay.js
│   ├── utils/
│   │   ├── MathHelpers.js
│   │   └── ShaderHelpers.js    ← Smoke halo + neon grid fragment composition
│   └── styles/
│       └── game.css
```

### Game Loop Architecture
Use a single RAF loop with delta-time and explicit pause state.

```js
class Game {
  constructor(containerId) { this._isRunning = false; this._isPaused = false; this._lastTime = 0; this._delta = 0; }
  init() {
    this._initRenderer();
    this._initScene();
    this._initSystems();
    this._setupEvents();
    this._isRunning = true;
    this._animate();
  }
  _animate() {
    if (!this._isRunning) return;
    requestAnimationFrame(() => this._animate());
    const now = performance.now();
    this._delta = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;
    this._updateInput();
    if (!this._isPaused) {
      this._updateGameplay();
      this._updatePath();
      this._updateTowers();
      this._updateEnemies();
      this._updateProjectiles();
      this._updateCollisions();
      this._updateParticles();
    }
    this._updatePostProcessing();
    this._updateHUD();
    this._render();
  }
  togglePause() {
    this._isPaused = !this._isPaused;
    EventBus.emit('ui:pauseChanged', this._isPaused);
  }
}
```

Critical: `togglePause()` only flips state and emits one event. No systems mutate during pause.

### EventBus + State
Use a tiny pub/sub so systems talk without direct coupling.

- `game:paused` / `game:resumed`
- `economy:changed`, `economy:sell`, `economy:upgrade`
- `wave:started`, `wave:ended`, `wave:bossIncoming`
- `enemy:spawned`, `enemy:despawned`, `enemy:leaked`
- `tower:placed`, `tower:sold`, `tower:upgraded`
- `menu:open`, `menu:close`
- `path:rebuilt`

`GameState` holds pause flag, money, wave, lives, stats, selected tower type, and current grid state.

### Input Handling
- **Space** pauses/resumes. Prevent default scrolling.
- **Left-click** places towers / selects entities.
- **Right-click** opens a folding HTML context menu on the clicked game object. Call `preventDefault()` on `contextmenu`.
- **Middle-click drag / wheel** orbits camera lightly around the scene center.

### Camera
Fixed isometric view with light orbit-lite: allow wheel zoom and middle-click pan. Do not clamp input to [-1,1] before steering the camera offset.

### Post-Processing
Use EffectComposer with RenderPass, UnrealBloomPass, optional ChromaticAberration/FilmGrain, and OutputPass.
- Bloom strength moderate so neon reads “bright,” not blown out.
- Threshold lane: bloom only emissives/neon; throw low-luminance surfaces to the dark background.

### Delta-Time Pattern
All movement and cooldowns use delta-time in seconds.

```js
cooldown -= dt;
if (cooldown <= 0) { fire(); cooldown = fireInterval; }
position.addScaledVector(velocity, dt);
```

### Shader Composition
When composing smoke/glow effects from `ShaderHelpers.js` fragments, ensure the smoke path shell declares its varying and timer uniforms. A common failure is omitting `varying vec2 vUv;` or forgetting `vec3(vUv, uTime)` for noise sampling. Keep one ShaderMaterial per unique effect and animate only `uTime` in `update()`.

## Gameplay Mechanics

### Towers
- 10 tower types, sorted by increasing cost and power.
- Tier list:
  1. Pulse Emitter — cheap, single-target, moderate fire rate
  2. Arc Spool — chains nearby enemies lightly
  3. Rail Sentry — long range, slow, high damage
  4. Plasma Mortar — area splash on impact
  5. Frost Core — slows enemies in radius
  6. Beam Harvester — continuous beam, builds charge over time
  7. Tesla Coil — arc lightning, jumps between groups
  8. Railgun Array — multiple parallel lines, very long cooldown
  9. Ion Storm Generator — wide area debuff + damage over time
  10. Singularity Cannon — ultra-expensive, pulls and destroys everything in radius
- Towers can be selected and upgraded in-place up to 3 levels.
- Each tower has distinct projectile behavior, color palette, and targeting priority options.

### Enemies
- 10 enemy types total: 7 mobs + 3 bosses.
- Mobs are introduced gradually as waves progress; bosses appear periodically.
- Bosses spawn every 5 waves (wave 5, 10, 15, …).
- Bosses are visually larger, have multiple health bars, and can directly damage adjacent towers.
- Mob archetypes include:
  - Drone — fast, fragile
  - Grunt — standard
  - Shield Bearer — front armor, low rear damage
  - Sprinter — high speed, low health
  - Splitter — splits into 2 on death
  - Tank — very slow, very tough
  - Teleporter — short-range warp along the path
- Boss archetypes include:
  - Warlord — charges the nearest tower, deals AOE melee damage
  - Mothership — spawns waves of mobs mid-route while moving
  - Core — stationary, generates strong shield zones, must outrange

### Wave System
- Waves are continuous; difficulty never resets.
- Wave number is the global coefficient `W`.
- Enemy count scales with `W`; enemy budgets increase so later waves include mixed compositions.
- Boss waves skip the standard spawn queue and introduce boss entries directly.
- Money earned per kill is proportional to max(1, `W`) × enemy tier multiplier.

### Economy
- Starting cash is enough for 2–3 early towers.
- Players earn cash from kills and end-of-wave bonuses.
- Towers can be sold for 60% of cumulative investment.
- Show affordable tower choices first, scrollable to full list.

## Procedural Path Generation + Grid Snapping

### Grid and Tile Coordinate System
- The map lives on a 2D square grid `(qx, qy)` in world XZ space.
- World position of tile center: `x = qx * TILE_SIZE`, `z = qy * TILE_SIZE`.
- Every tower/enemy position snaps to the tile center. Tower placement is rejected if the tile is occupied, blocked, or off-path.

### Path Generation Algorithm
Use randomized depth-first search with corridor enforcement between start and end:
1. Define start tile on map edge and end tile on opposite edge.
2. Maintain a `Set` of walkway tiles. Carve a primary corridor: from end, run random-walk steps toward start, choosing cardinal neighbors uniformly within valid bounds until start is reached. Remove cycles by retracing and replacing loops.
3. Branch creation: after corridor is established, traverse it and with probability `P_BRANCH` extend a short side branch of 2–6 tiles. Branches themselves do not branch again.
4. Ensure minimum width `p` = 1 tile: the resulting tile set is a 4-connected graph with no isolated islands.
5. Validate reachability: BFS from start to end after generation; on failure, regenerate with same seed.

### Path to Mesh
Convert tile centers into a centerline spline using Catmull-Rom or a polyline through tile centers. Build a mesh band around the spline by extruding a fixed-width ribbon in the XZ plane.

### Tile Rendering
- Path wireframe/emissive band with a translucent smoke shell around it using a custom fragment shader with time-varying noise.
- Non-path tiles render dim grid tiles; buildable tiles glow faintly on hover.

## Visual Design
- Retro sci-fi aesthetic: dark background with neon grid floor.
- Emissive materials and post-processing bloom on neon elements.
- Path is rendered as a glowing wireframe strip with fog-like translucent smoke shell using custom Three.js fragment shaders or alpha-blended transparent shells.
- Camera is fixed isometric with light orbit-lite pan/zoom.
- Particle effects on hits, explosions, and enemy deaths.

## Interaction
- **Space** pauses/resumes the game; pause overlay shows economics summary.
- **Right-click context menu** on:
  - Towers: upgrade / sell / change target priority / toggle range preview
  - Enemies: highlight, ping teammates if future multiplayer is attached
  - Map tiles: place tower / remove tower / cancel placement
- Context menu should be a folding panel, not a browser native context menu; prevent default browser right-click.

## Progression and Endgame
- No hard level cap; waves continue with sustained difficulty.
- Award milestone bonuses every 10 waves.
- Track stats: towers built, enemies killed, money earned, waves survived.
- Game-over condition: 20 enemies leak through the path exit.

## Scope Constraints
- Do NOT implement multiplayer, account systems, or asset downloads.
- DO keep input handling robust: right-click must not open browser context menu.
- Canvas resolution should stay performant on mid-range hardware.

## Verification and Build
- `npm run dev` serves the game with HMR.
- `npm run build` succeeds and produces a production bundle.
- All changed JS files pass `node --check`.
- For browser smoke/graphics checks, reload the page and inspect state via live DOM/canvas evidence instead of stale cached sources.

## Acceptance Criteria
- [ ] Three.js scene renders with neon aesthetic, bloom-like emissives, and smoke-style path halo.
- [ ] Path is generated procedurally each run and drawn as a continuous walkable tile strip with corresponding mesh ribbon.
- [ ] Tower placement snaps to the tile grid; placement is rejected on invalid tiles.
- [ ] 10 distinct tower types are placeable, upgradeable, and visually identifiable.
- [ ] 10 enemy types exist, including 7 mobs and 3 bosses that spawn every 5 waves.
- [ ] Wave count scales enemy count and kill reward via a global coefficient.
- [ ] Space pauses and resumes the game cleanly.
- [ ] Right-click opens a folding context menu on towers, enemies, and tiles.
- [ ] At least one boss damages towers directly when in range.
- [ ] Game over triggers after 20 leaks; score and wave summary are shown.
- [ ] All visuals are procedurally generated; no external image dependencies.