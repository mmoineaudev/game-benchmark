
export const GRID_COLS = 56;
export const GRID_ROWS = 40;
export const TILE_SIZE = 1;
export const PATH_WIDTH = 1;
export const START_TILE = { qx: 0, qy: Math.floor(GRID_ROWS/2) };
export const END_TILE = { qx: GRID_COLS - 1, qy: Math.floor(GRID_ROWS/2) };
export const CAMERA = {
  isoX: 0,
  isoY: 50,
  isoZ: 0,
  lookAt: { x: (GRID_COLS*TILE_SIZE)/2, y: 0, z: (GRID_ROWS*TILE_SIZE)/2 },
  near: 0.1,
  far: 600,
  moveSpeed: 18,
  zoomSpeed: 12,
  minZoom: 12,
  maxZoom: 80,
};

export const COLORS = {
  bg: '#05060d',
  gridDim: 0x111827,
  gridLine: 0x1f2937,
  pathBase: '#0a1325',
  pathGlow: '#00d4ff',
  pathEdge: '#7df9ff',
  buildable: '#0f172a',
  smoke: '#8b5cf6',
  buildableHover: '#1d4ed8',
  towerEmissive: '#00ffcc',
  projectile: '#bf00ff',
  towerStrong: '#ffcc00',
  bossStrong: '#ff3300',
  pauseBg: 'rgba(0,0,0,0.45)',
};

export const BUDGET = {
  startMoney: 132,
  killBase: 1,
  killWaveScale: 0.15,
  waveBonus: 15,
  waveMilestoneEvery: 5,
  lives: 25,
  sellBackRatio: 0.7,
};

export const HP_WAVE_SCALE = 0.20;  // enemy HP multiplier per wave: hp * (1 + (wave-1)*scale)

export const TOWER_DEFS = [
  { id: 0, name: 'Pulse Emitter', cost: 25,  range: 6.5, rate: 0.35, damage: 1, color: '#22d3ee', projSpeed: 28, splash: 0, desc: 'Fast, cheap — solid starter' },
  { id: 1, name: 'Arc Spool', cost: 55,   range: 5.5, rate: 0.55, damage: 1, color: '#a78bfa', projSpeed: 22, splash: 0, arc: true, desc: 'Lightning arcs between foes' },
  { id: 2, name: 'Rail Sentry', cost: 75,  range: 13,  rate: 1.4,  damage: 5, color: '#f9a8d4', projSpeed: 50, splash: 0, desc: 'Long-range precision strikes' },
  { id: 3, name: 'Plasma Mortar', cost: 95, range: 6.5, rate: 0.9,  damage: 3, color: '#fbbf24', projSpeed: 14, splash: 1.8, desc: 'AoE splash damage' },
  { id: 4, name: 'Frost Core', cost: 110,  range: 5.2, rate: 0.65, damage: 1, color: '#67e8f9', projSpeed: 24, splash: 0, slow: 0.45, desc: 'Slows enemies on hit' },
  { id: 5, name: 'Beam Harvester', cost: 130, range: 9, rate: 0.08, damage: 4, color: '#34d399', projSpeed: 0, splash: 0, beam: true, desc: 'Continuous energy beam' },
  { id: 6, name: 'Tesla Coil', cost: 145,  range: 7.5, rate: 0.75, damage: 2, color: '#e2e8f0', projSpeed: 36, splash: 0, chain: 3, desc: 'Chains to nearby enemies' },
  { id: 7, name: 'Railgun Array', cost: 190, range: 16,  rate: 2.6,  damage: 10, color: '#f472b6', projSpeed: 60, splash: 0, parallel: 2, desc: 'Twin heavy slugs' },
  { id: 8, name: 'Ion Storm', cost: 240,   range: 5.8, rate: 0.55, damage: 1.5, color: '#f59e0b', projSpeed: 20, splash: 2.4, dot: true, desc: 'Wide burn + lingering fire' },
  { id: 9, name: 'Singularity', cost: 420,  range: 10,  rate: 3.5,  damage: 0.5, color: '#ffffff', projSpeed: 16, splash: 6.5, gravity: true, desc: 'Massive gravity pull' },
  // ── new towers ────────────────────────────────────────────────────────
  { id: 10, name: 'Scatter Gun', cost: 80,  range: 4.5, rate: 0.9,  damage: 2, color: '#fb923c', projSpeed: 22, parallel: 3, desc: '3-way spread shot' },
  { id: 11, name: 'Void Lance', cost: 170,  range: 10,  rate: 1.8,  damage: 8, color: '#c084fc', projSpeed: 40, pierce: true, desc: 'Pierces through enemies' },
  { id: 12, name: 'Corrosive Spire', cost: 135, range: 6,   rate: 0.5,  damage: 2, color: '#4ade80', projSpeed: 20, corrode: 0.12, desc: 'Strips enemy armor' },
  { id: 13, name: 'Chrono Prism', cost: 200,  range: 8,   rate: 0,    damage: 0, color: '#38bdf8', projSpeed: 0,  auraSlow: 0.35, desc: 'Passive slow field aura' },
  { id: 14, name: 'Doom Cannon', cost: 350,  range: 14,  rate: 5.0,  damage: 45, color: '#ef4444', projSpeed: 35, stun: 2.5, desc: 'Devastating shot + long stun' },
];

export const ENEMY_DEFS = [
  { id: 0, name: 'Drone',       hp: 10,  speed: 2.0, reward: 10, scale: 0.32, color: '#ff4dff', type: 'mob' },
  { id: 1, name: 'Grunt',       hp: 18,  speed: 1.5, reward: 15, scale: 0.38, color: '#ff9f1a', type: 'mob' },
  { id: 2, name: 'Shield Bearer', hp: 28, speed: 1.3, reward: 20, scale: 0.42, color: '#23c6ff', type: 'mob', shieldPercent: 0.25 },
  { id: 3, name: 'Sprinter',    hp: 14,  speed: 2.2, reward: 13, scale: 0.30, color: '#ff1943', type: 'mob' },
  { id: 4, name: 'Splitter',    hp: 24,  speed: 1.5, reward: 18, scale: 0.36, color: '#99ff33', type: 'mob', split: true },
  { id: 5, name: 'Tank',        hp: 55,  speed: 0.9, reward: 30, scale: 0.52, color: '#ccc', type: 'mob', armor: 0.15 },
  { id: 6, name: 'Teleporter',  hp: 20,  speed: 1.8, reward: 17, scale: 0.34, color: '#cc66ff', type: 'mob', teleport: true },
  { id: 7, name: 'Warlord',    hp: 300, speed: 1.0, reward: 160, scale: 0.9, color: '#ff4d4d', type: 'boss', pierceTower: true },
  { id: 8, name: 'Mothership', hp: 400, speed: 0.7, reward: 200, scale: 1.05, color: '#ff66cc', type: 'boss', spawnsMobs: true },
  { id: 9, name: 'Core',       hp: 600, speed: 0.0, reward: 250, scale: 1.1, color: '#ffffff', type: 'boss', stationary: true, shieldZone: 14 },
];

export const WAVE = {
  mobsBase: 4,
  mobsGrow: 0.5,
  bossEvery: 5,
  spawnIntervalBase: 1.2,
  spawnIntervalMin: 0.4,
};

export const UPGRADE_COST = (towerIndex, level) => Math.floor(TOWER_DEFS[towerIndex].cost * (0.9 + 0.55 * level));
export const UPGRADE_STATS = (def, level) => ({
  damage: def.damage * (1 + 0.35 * level),
  range: def.range * (1 + 0.12 * level),
  rate: def.rate * (1 - 0.08 * level),
});

export const STATS_KEYS = ['towersBuilt','enemiesKilled','moneyEarned','wavesSurvived'];
