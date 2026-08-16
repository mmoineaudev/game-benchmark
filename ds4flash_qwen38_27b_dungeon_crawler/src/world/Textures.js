/**
 * Textures.js — Canvas-2D procedural texture generators (§15).
 *
 * All canvas/DOM access is gated behind canvasAvailable() so the module
 * imports cleanly in headless Node and every generator returns null when no
 * canvas is present (§27 headless shim).
 */

import * as THREE from 'three';
import { MATERIALS } from '../core/Constants.js';

/** True only in a real browser where a 2D canvas context is usable. */
function canvasAvailable() {
  return typeof document !== 'undefined' &&
    typeof document.createElement === 'function' &&
    typeof document.createElement('canvas') === 'function';
}

/**
 * Mix a base rgb color toward a target hex color by `amount` (0..1).
 * Returns a CSS rgb() string.
 */
export function mixHex(a, b, amount = MATERIALS.MIX_HEX_AMOUNT) {
  const pa = parseInt(a.toString(16).padStart(6, '0'), 16);
  const pb = parseInt(b.toString(16).padStart(6, '0'), 16);
  const ar = (pa >> 16) & 0xff, ag = (pa >> 8) & 0xff, ab = pa & 0xff;
  const br = (pb >> 16) & 0xff, bg = (pb >> 8) & 0xff, bb = pb & 0xff;
  const r = Math.round(ar + (br - ar) * amount);
  const g = Math.round(ag + (bg - ag) * amount);
  const bl = Math.round(ab + (bb - ab) * amount);
  return `rgb(${r}, ${g}, ${bl})`;
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

function makeTexture(canvas, repeat = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  if (repeat > 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
  tex.needsUpdate = true;
  return tex;
}

/**
 * Stone wall: staggered brick courses with mortar lines and a few cracks,
 * tinted toward `tint` (hex) with mixHex.
 */
export function generateStoneWallTexture(size = MATERIALS.TEXTURE_SIZE, tint = 0x6b6560) {
  if (!canvasAvailable()) return null;
  const { canvas, ctx } = makeCanvas(size);
  const base = mixHex(tint, 0xffffff, 0.08);
  const mortar = mixHex(tint, 0x000000, 0.5);
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, size, size);

  const rows = 8;
  const bh = size / rows;
  const bw = size / 4;
  for (let row = 0; row < rows; row++) {
    const offset = (row % 2 === 0) ? 0 : bw / 2;
    for (let col = -1; col < 5; col++) {
      const x = col * bw + offset;
      const y = row * bh;
      // per-brick slight shade variation
      const v = Math.random() * 20 - 10;
      const shade = mixHex(tint, v > 0 ? 0xffffff : 0x000000, Math.min(0.25, Math.abs(v) / 80));
      ctx.fillStyle = shade;
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
  }
  // cracks
  ctx.strokeStyle = mixHex(tint, 0x000000, 0.6);
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (Math.random() - 0.5) * 30;
      y += Math.random() * 20;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;

  return makeTexture(canvas, MATERIALS.TEXTURE_REPEAT);
}

/**
 * Floor: flagstone tiles with grout lines and light scratches, tinted.
 */
export function generateFloorTexture(size = MATERIALS.TEXTURE_SIZE, tint = 0x4a453f) {
  if (!canvasAvailable()) return null;
  const { canvas, ctx } = makeCanvas(size);
  const grout = mixHex(tint, 0x000000, 0.5);
  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, size, size);

  const tiles = 4;
  const ts = size / tiles;
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      const v = Math.random() * 18 - 9;
      ctx.fillStyle = mixHex(tint, v > 0 ? 0xffffff : 0x000000, Math.min(0.3, Math.abs(v) / 60));
      ctx.fillRect(col * ts + 2, row * ts + 2, ts - 4, ts - 4);
    }
  }
  // scratches
  ctx.strokeStyle = mixHex(tint, 0xffffff, 0.2);
  ctx.lineWidth = 1;
  for (let i = 0; i < 20; i++) {
    ctx.beginPath();
    const x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 40);
    ctx.stroke();
  }
  return makeTexture(canvas, MATERIALS.TEXTURE_REPEAT);
}

/**
 * Ceiling: dark stone with rough patches, tinted.
 */
export function generateCeilingTexture(size = MATERIALS.TEXTURE_SIZE, tint = 0x2e2b28) {
  if (!canvasAvailable()) return null;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = mixHex(tint, 0x000000, 0.2);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const r = 4 + Math.random() * 18;
    const v = Math.random();
    ctx.fillStyle = mixHex(tint, v > 0.5 ? 0xffffff : 0x000000, 0.15);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return makeTexture(canvas, MATERIALS.TEXTURE_REPEAT);
}

/**
 * Rune: soft glow blob behind a glyph character, drawn in `color` (hex).
 */
export function generateRuneTexture(char = '◆', color = 0x66ffcc, size = 64) {
  if (!canvasAvailable()) return null;
  const { canvas, ctx } = makeCanvas(size);
  const css = `#${color.toString(16).padStart(6, '0')}`;
  // glow
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, css);
  g.addColorStop(0.4, css + '80');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // glyph
  ctx.fillStyle = css;
  ctx.font = `bold ${size * 0.55}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generic radial soft glow sprite (additive-friendly), 64×64.
 */
export function generateGlowTexture(size = MATERIALS.GLOW_TEXTURE_SIZE) {
  if (!canvasAvailable()) return null;
  const { canvas, ctx } = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
