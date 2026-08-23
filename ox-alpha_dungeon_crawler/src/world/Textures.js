// Textures.js — canvas texture generators (§15). Browser-only; biome tinting via mixHex.
import { MATERIALS } from '../core/Constants.js';

export function mixHex(a, b, amount) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * amount);
  const g = Math.round(ag + (bg - ag) * amount);
  const bl = Math.round(ab + (bb - ab) * amount);
  return (r << 16) | (g << 8) | bl;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

export function generateStoneWallTexture(size, tint) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + mixHex(0x4a443c, tint, 0.35).toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size); // mortar
  const bh = size / 8, bw = size / 4;
  for (let row = 0; row < 8; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col < 5; col++) {
      const x = col * bw + off, y = row * bh;
      const shade = 0.85 + Math.random() * 0.3;
      const base = mixHex(0x7a7268, tint, 0.35);
      const r = Math.min(255, Math.round(((base >> 16) & 255) * shade));
      const g = Math.min(255, Math.round(((base >> 8) & 255) * shade));
      const b = Math.min(255, Math.round((base & 255) * shade));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
  }
  // cracks
  ctx.strokeStyle = 'rgba(20,16,12,.5)';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) { x += (Math.random() - .5) * 30; y += Math.random() * 20; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return c;
}

export function generateFloorTexture(size, tint) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + mixHex(0x5a564e, tint, 0.35).toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size);
  const t = size / 4;
  for (let ry = 0; ry < 4; ry++) for (let rx = 0; rx < 4; rx++) {
    const shade = 0.9 + Math.random() * 0.35;
    const base = mixHex(0x8a8274, tint, 0.35);
    const r = Math.round(((base >> 16) & 255) * shade), g = Math.round(((base >> 8) & 255) * shade), b = Math.round((base & 255) * shade);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(rx * t + 2, ry * t + 2, t - 4, t - 4);
  }
  // scratches
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * size, Math.random() * size);
    ctx.lineTo(Math.random() * size, Math.random() * size);
    ctx.stroke();
  }
  return c;
}

export function generateCeilingTexture(size, tint) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + mixHex(0x2e2a26, tint, 0.35).toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const shade = 0.7 + Math.random() * 0.5;
    ctx.fillStyle = `rgba(${60 * shade | 0},${55 * shade | 0},${48 * shade | 0},.6)`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 4 + Math.random() * 14, 0, 7);
    ctx.fill();
  }
  return c;
}

export function generateRuneTexture(char, color) {
  const c = canvas(MATERIALS.GLOW_SIZE);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.font = 'bold 40px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, c.width / 2, c.height / 2);
  return c;
}

export function generateGlowTexture(size = MATERIALS.GLOW_SIZE) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
