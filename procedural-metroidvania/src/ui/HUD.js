import { COLORS, ABILITY, PLAYER, LOG } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

const HUD_EL = document.getElementById('hud');
const OVERLAY = document.getElementById('overlay');

/**
 * HUD — DOM overlay showing health (hearts), ability icons, minimap, game-over/victory.
 */
export default class HUD {
  constructor(gs) {
    this._gs = gs;
    this._panel = null;
    this._hearts = null;
    this._abilitySlot = null;
    this._minimap = null;
    this._popup = null;
    this._popupTimer = 0;
  }

  init() {
    this._panel = document.createElement('div');
    this._panel.id = 'hudPanel';
    this._panel.style.cssText = `
      position:absolute; top:10px; left:10px;
      pointer-events:none; z-index:10;
      font-family:monospace; font-size:14px; color:${COLORS.HUD_TEXT};
    `;
    HUD_EL.innerHTML = '';
    HUD_EL.appendChild(this._panel);

    // Health hearts
    this._hearts = document.createElement('div');
    this._hearts.id = 'hudHearts';
    this._hearts.style.cssText = 'margin-bottom:8px; font-size:22px;';
    this._panel.appendChild(this._hearts);

    // Ability indicator
    this._abilitySlot = document.createElement('div');
    this._abilitySlot.id = 'hudAbility';
    this._abilitySlot.style.cssText = 'margin-bottom:8px; font-size:13px; opacity:0.8;';
    this._panel.appendChild(this._abilitySlot);

    // Minimap
    this._minimap = document.createElement('canvas');
    this._minimap.id = 'hudMinimap';
    this._minimap.width = 120;
    this._minimap.height = 100;
    this._minimap.style.cssText = `
      position:absolute; bottom:10px; right:10px;
      background:${COLORS.MINIMAP_BG};
      border:1px solid rgba(100,160,255,0.3);
      border-radius:4px;
      pointer-events:none; z-index:10;
    `;
    HUD_EL.appendChild(this._minimap);

    // Ability popup
    this._popup = document.createElement('div');
    this._popup.id = 'hudPopup';
    this._popup.style.cssText = `
      position:absolute; top:50%; left:50%; transform:translate(-50%, -50%);
      font-family:monospace; font-size:20px; font-weight:bold;
      color:#ffcc00; text-shadow:0 0 10px #ffaa00;
      pointer-events:none; z-index:30; opacity:0;
      transition:opacity 0.2s;
    `;
    HUD_EL.appendChild(this._popup);

    LOG('HUD', 'Initialized');
  }

  update() {
    const state = this._gs.state;
    if (!state) return;

    // Health
    this._hearts.innerHTML = '';
    for (let i = 0; i < state.playerMaxHP; i++) {
      if (i < state.playerHP) {
        this._hearts.innerHTML += '<span style="color:#ff4444;">♥</span>';
      } else {
        this._hearts.innerHTML += '<span style="color:#331111;">♥</span>';
      }
    }

    // Abilities
    const abilities = Array.from(state.abilities);
    this._abilitySlot.textContent = abilities.length > 0
      ? 'Abilities: ' + abilities.map(a => ABILITY.NAMES[a] || a).join(', ')
      : '';

    // Minimap
    this._drawMinimap();

    // Ability popup timer
    if (this._popupTimer > 0) {
      this._popupTimer -= 1/60;
      if (this._popupTimer <= 0) {
        this._popup.style.opacity = '0';
      }
    }
  }

  _drawMinimap() {
    const ctx = this._minimap.getContext('2d');
    const w = this._minimap.width;
    const h = this._minimap.height;
    ctx.clearRect(0, 0, w, h);

    const state = this._gs.state;
    const graph = state.roomGraph;
    if (!graph) return;

    // Layout rooms on minimap
    const entries = Object.entries(graph);
    // Center: find average position
    let cx = 0, cy = 0;
    for (const [, room] of entries) {
      cx += room.worldX;
      cy += room.worldY;
    }
    cx /= entries.length;
    cy /= entries.length;

    const scale = 28;
    const ox = w/2 - cx * scale;
    const oy = h/2 + cy * scale;

    for (const [id, room] of entries) {
      const rx = ox + room.worldX * scale;
      const ry = oy - room.worldY * scale;

      // Room rect
      ctx.fillStyle = id === state.currentRoomId ? COLORS.MINIMAP_CURRENT : COLORS.MINIMAP_ROOM;
      ctx.fillRect(rx - 10, ry - 7, 20, 14);
      ctx.strokeStyle = id === state.currentRoomId ? 'rgba(100,180,255,0.8)' : 'rgba(60,100,160,0.5)';
      ctx.strokeRect(rx - 10, ry - 7, 20, 14);

      // Room label
      ctx.fillStyle = id === state.currentRoomId ? '#fff' : '#889';
      ctx.font = '8px monospace';
      ctx.fillText(room.label.slice(0, 6), rx - 9, ry + 4);
    }
  }

  showAbilityPopup(name) {
    const displayName = ABILITY.NAMES[name] || name;
    this._popup.textContent = `✦ NEW ABILITY: ${displayName} ✦`;
    this._popup.style.opacity = '1';
    this._popupTimer = 2.5;
  }

  showGameOver() {
    OVERLAY.innerHTML = `
      <div style="background:rgba(0,0,0,0.7);padding:30px 50px;border-radius:8px;text-align:center;font-family:monospace;color:#ff4444;border:2px solid #ff4444;">
        <div style="font-size:28px;margin-bottom:15px;">GAME OVER</div>
        <div style="font-size:14px;color:#aaa;margin-bottom:20px;">Press R to restart</div>
      </div>`;
    OVERLAY.classList.add('active');
  }

  showVictory() {
    OVERLAY.innerHTML = `
      <div style="background:rgba(0,0,0,0.7);padding:30px 50px;border-radius:8px;text-align:center;font-family:monospace;color:#ffcc00;border:2px solid #ffcc00;">
        <div style="font-size:28px;margin-bottom:15px;">✦ VICTORY ✦</div>
        <div style="font-size:14px;color:#aaa;margin-bottom:20px;">The Guardian is defeated!</div>
        <div style="font-size:12px;color:#888;">Press R to play again</div>
      </div>`;
    OVERLAY.classList.add('active');
  }

  showPause() {
    OVERLAY.innerHTML = `
      <div style="background:rgba(0,0,0,0.6);padding:25px 40px;border-radius:8px;text-align:center;font-family:monospace;color:#ccddee;">
        <div style="font-size:22px;margin-bottom:10px;">PAUSED</div>
        <div style="font-size:12px;color:#889;">Press ESC to resume</div>
      </div>`;
    OVERLAY.classList.add('active');
  }

  hidePause() {
    OVERLAY.innerHTML = '';
    OVERLAY.classList.remove('active');
  }

  dispose() {
    HUD_EL.innerHTML = '';
    OVERLAY.innerHTML = '';
    OVERLAY.classList.remove('active');
  }
}
