import { PLAYER } from './Constants.js';

export function makeInitialState() {
  return {
    // ── Player ──────────────────────────────────────────────────────────
    playerHP: PLAYER.HP,
    playerMaxHP: PLAYER.HP,
    playerAlive: true,

    // ── Room / World ────────────────────────────────────────────────────
    currentRoomId: 'spawn',
    roomGraph: null,        // set by RoomManager after generation
    roomsVisited: new Set(),
    worldSeed: 0,

    // ── Abilities ───────────────────────────────────────────────────────
    abilities: new Set(),   // e.g. 'doubleJump', 'dash'
    abilityPickupsCollected: new Set(),

    // ── Combat ──────────────────────────────────────────────────────────
    enemiesKilled: 0,

    // ── Run State ───────────────────────────────────────────────────────
    gameOver: false,
    victory: false,
    paused: false,

    // ── Timing ──────────────────────────────────────────────────────────
    playTime: 0,
    roomTime: 0,
  };
}

export class GameState {
  constructor() {
    this._state = makeInitialState();
  }

  get state() { return this._state; }

  patch(partial) {
    Object.assign(this._state, partial);
  }

  reset() {
    this._state = makeInitialState();
  }
}

export default GameState;
