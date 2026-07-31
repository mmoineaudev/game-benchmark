// Procedural textures generated at init time
// All use Canvas 2D — no external assets needed

// Mix a hex color toward a tint hex by `amount` (0..1). Used for biome tints.
function mixHex(base, tint, amount) {
  const b = [base >> 16 & 255, base >> 8 & 255, base & 255];
  const t = [tint >> 16 & 255, tint >> 8 & 255, tint & 255];
  const m = (i) => Math.round(b[i] + (t[i] - b[i]) * amount);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

export function generateStoneWallTexture(size = 256, tint = null) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base dark stone
  ctx.fillStyle = tint ? mixHex(0x2a2a38, tint, 0.35) : '#2a2a38';
  ctx.fillRect(0, 0, size, size);

  // Individual stones with mortar lines
  const stoneRows = 8;
  const rowH = size / stoneRows;
  const colors = tint
    ? ['#2e2e3c', '#262634', '#303040', '#282838', '#2c2c3a'].map((c) => c)
    : ['#2e2e3c', '#262634', '#303040', '#282838', '#2c2c3a'];

  for (let row = 0; row < stoneRows; row++) {
    const y = row * rowH;
    const offset = (row % 2) * rowH * 0.5; // staggered bricks
    const stonesInRow = Math.floor(size / (rowH * 1.6)) + 1;

    for (let col = 0; col < stonesInRow; col++) {
      const x = col * rowH * 1.6 + offset - rowH * 0.8;
      const w = rowH * 1.5 + (Math.random() - 0.5) * rowH * 0.3;
      const h = rowH * 0.9 + (Math.random() - 0.5) * rowH * 0.15;
      ctx.fillStyle = tint ? mixHex(parseInt(colors[Math.floor(Math.random() * colors.length)].slice(1), 16), tint, 0.35) : colors[Math.floor(Math.random() * colors.length)];
      ctx.fillRect(x, y + rowH * 0.05, w, h);

      // Subtle highlight on top edge
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(x, y + rowH * 0.05, w, 2);

      // Subtle shadow on bottom edge
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(x, y + rowH * 0.05 + h - 2, w, 2);
    }
  }

  // Mortar lines (darker between stones)
  ctx.strokeStyle = '#1a1a24';
  ctx.lineWidth = 1.5;
  for (let row = 0; row < stoneRows; row++) {
    const y = row * rowH;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Random cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const sx = Math.random() * size;
    const sy = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (let j = 0; j < 4; j++) {
      ctx.lineTo(sx + (Math.random() - 0.5) * 60, sy + Math.random() * 40);
    }
    ctx.stroke();
  }

  return new THREE.CanvasTexture(canvas);
}

export function generateFloorTexture(size = 256, tint = null) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base dark stone
  ctx.fillStyle = tint ? mixHex(0x22222a, tint, 0.35) : '#22222a';
  ctx.fillRect(0, 0, size, size);

  // Large flagstones
  const tileCount = 5;
  const tileSize = size / tileCount;
  const colors = tint
    ? ['#24242e', '#20202a', '#262630', '#22222c', '#282832']
    : ['#24242e', '#20202a', '#262630', '#22222c', '#282832'];

  for (let row = 0; row < tileCount; row++) {
    for (let col = 0; col < tileCount; col++) {
      const x = col * tileSize + (Math.random() - 0.5) * 6;
      const y = row * tileSize + (Math.random() - 0.5) * 6;
      const w = tileSize - 4;
      const h = tileSize - 4;
      ctx.fillStyle = tint ? mixHex(parseInt(colors[Math.floor(Math.random() * colors.length)].slice(1), 16), tint, 0.35) : colors[Math.floor(Math.random() * colors.length)];
      ctx.fillRect(x, y, w, h);

      // Edge highlight
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y, 1, h);
    }
  }

  // Grout lines
  ctx.strokeStyle = '#15151a';
  ctx.lineWidth = 2;
  for (let i = 0; i <= tileCount; i++) {
    const pos = i * tileSize;
    ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(size, pos); ctx.stroke();
  }

  // Subtle dirt/scratches
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let i = 0; i < 30; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, Math.random() * 20 + 2, 1);
  }

  return new THREE.CanvasTexture(canvas);
}

export function generateCeilingTexture(size = 256, tint = null) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Dark rough stone — simpler than walls
  ctx.fillStyle = tint ? mixHex(0x181820, tint, 0.35) : '#181820';
  ctx.fillRect(0, 0, size, size);

  // Rough patches
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 20 + 5;
    ctx.fillStyle = tint
      ? mixHex(0x141420, tint, 0.35).replace('rgb', 'rgba').replace(')', ',0.3)')
      : `rgba(${20 + Math.random() * 15},${20 + Math.random() * 15},${25 + Math.random() * 15},0.3)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(canvas);
}

export function generateRuneTexture(char, color, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, size, size);

  // Glow aura
  const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.45);
  glow.addColorStop(0, 'rgba(255,255,255,0.4)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Rune symbol
  const hex = '#' + color.toString(16).padStart(6, '0');
  ctx.fillStyle = hex;
  ctx.font = `bold ${size * 0.6}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = hex;
  ctx.shadowBlur = 8;
  ctx.fillText(char, size / 2, size / 2);
  ctx.shadowBlur = 0;

  return new THREE.CanvasTexture(canvas);
}

export function generateGlowTexture(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,200,100,1)');
  gradient.addColorStop(0.1, 'rgba(255,150,50,0.8)');
  gradient.addColorStop(0.4, 'rgba(255,100,20,0.2)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

import * as THREE from 'three';
