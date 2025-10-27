import './lib/perlin.js';
import { AudioMix } from './lib/audio.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

const worldCanvas = document.createElement('canvas');
const worldCtx = worldCanvas.getContext('2d');
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');

let dpr = window.devicePixelRatio || 1;
let viewWidth = 0;
let viewHeight = 0;

let worldTime = 0;
const WORLD_TIME_CYCLE = 120; // seconds per full day cycle

const hero = { x: 0, y: 0, radius: 22 };
const mouse = { x: 0, y: 0, active: false };
let currentAim = { x: 1, y: 0 };

let zooming = false;
let zoomStartRealTime = 0;
let breathState = 'idle';
let lastBreathState = 'idle';
let lastBreathPuffRealTime = -Infinity;
const breathPuffs = [];

let lastFrameRealTime = performance.now() / 1000;
let latestRealTime = lastFrameRealTime;

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  viewWidth = width;
  viewHeight = height;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  worldCanvas.width = canvas.width;
  worldCanvas.height = canvas.height;
  worldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  maskCanvas.width = canvas.width;
  maskCanvas.height = canvas.height;

  updateHeroPosition();
}

function updateHeroPosition() {
  hero.x = viewWidth * 0.5;
  hero.y = viewHeight * 0.68;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function rgbToCss({ r, g, b }) {
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

function lerpColor(hexA, hexB, t) {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  return rgbToCss({
    r: lerp(rgbA.r, rgbB.r, t),
    g: lerp(rgbA.g, rgbB.g, t),
    b: lerp(rgbA.b, rgbB.b, t),
  });
}

const PAL_DAY = {
  sky: '#eaf3fb',
  horizon: '#c8dff2',
  ground: '#d9e9f6',
  hero: '#25313b',
  accent: '#fefefe',
};

const PAL_EVENING = {
  sky: '#f0d2b5',
  horizon: '#f2b88a',
  ground: '#dca47f',
  hero: '#322828',
  accent: '#fbe9da',
};

const PAL_NIGHT = {
  sky: '#0b1828',
  horizon: '#142538',
  ground: '#1e2f40',
  hero: '#6f7c8a',
  accent: '#f0f6ff',
};

function mixPalette(a, b, t) {
  return {
    sky: lerpColor(a.sky, b.sky, t),
    horizon: lerpColor(a.horizon, b.horizon, t),
    ground: lerpColor(a.ground, b.ground, t),
    hero: lerpColor(a.hero, b.hero, t),
    accent: lerpColor(a.accent, b.accent, t),
  };
}

function getWorldPalette(time) {
  const dayEnd = 0.58;
  const eveningEnd = 0.82;

  if (time < dayEnd) {
    const t = time / dayEnd;
    return { ...mixPalette(PAL_DAY, PAL_EVENING, t), period: 'day' };
  }
  if (time < eveningEnd) {
    const t = (time - dayEnd) / (eveningEnd - dayEnd);
    return { ...mixPalette(PAL_EVENING, PAL_NIGHT, t), period: 'evening' };
  }
  const t = (time - eveningEnd) / (1 - eveningEnd);
  return { ...mixPalette(PAL_NIGHT, PAL_DAY, t), period: 'night' };
}

function updateAimDirection() {
  if (!mouse.active) {
    currentAim = { x: 1, y: 0 };
    return;
  }
  const dx = mouse.x - hero.x;
  const dy = mouse.y - hero.y;
  const length = Math.hypot(dx, dy) || 1;
  currentAim = { x: dx / length, y: dy / length };
}

function getMouthPosition() {
  const mouthOffsetForward = 16;
  const mouthOffsetUp = -hero.radius * 0.4;
  return {
    x: hero.x + currentAim.x * mouthOffsetForward,
    y: hero.y + mouthOffsetUp + currentAim.y * 4,
  };
}

function spawnBreathPuff(intensity = 1) {
  const mouth = getMouthPosition();
  const drift = {
    x: currentAim.x * 28 + 18,
    y: currentAim.y * 12 - 40,
  };
  const radius = lerp(10, 18, Math.random()) * intensity;
  breathPuffs.push({
    x: mouth.x,
    y: mouth.y,
    vx: drift.x * (0.8 + Math.random() * 0.4),
    vy: drift.y * (0.8 + Math.random() * 0.3),
    age: 0,
    life: 0.8,
    radius,
    alpha: 0.22 + intensity * 0.25,
  });
}

function updateBreath(realTime, delta) {
  for (let i = breathPuffs.length - 1; i >= 0; i -= 1) {
    const puff = breathPuffs[i];
    puff.age += delta;
    if (puff.age >= puff.life) {
      breathPuffs.splice(i, 1);
      continue;
    }
    puff.x += puff.vx * delta;
    puff.y += puff.vy * delta;
  }

  if (!zooming) {
    breathState = 'idle';
    return;
  }

  const elapsed = realTime - zoomStartRealTime;
  if (elapsed < 0) {
    return;
  }

  if (elapsed < 1.2) {
    breathState = 'phase1';
  } else if (elapsed < 4.2) {
    breathState = 'hold';
  } else {
    breathState = 'soft';
  }

  if (breathState !== lastBreathState) {
    lastBreathState = breathState;
    lastBreathPuffRealTime = -Infinity;
    if (breathState === 'phase1') {
      AudioMix.playZoomBreathShort();
    }
  }

  if (breathState === 'phase1') {
    const interval = 0.4;
    if (realTime - lastBreathPuffRealTime >= interval) {
      spawnBreathPuff(1);
      lastBreathPuffRealTime = realTime;
    }
  } else if (breathState === 'soft') {
    const interval = 2.8;
    if (realTime - lastBreathPuffRealTime >= interval) {
      spawnBreathPuff(0.5);
      lastBreathPuffRealTime = realTime;
      AudioMix.playZoomBreathSoft({ gain: 0.25 });
    }
  }
}

function drawBreath(targetCtx) {
  if (!breathPuffs.length) {
    return;
  }
  targetCtx.save();
  targetCtx.globalCompositeOperation = 'lighter';
  breathPuffs.forEach((puff) => {
    const lifeRatio = 1 - puff.age / puff.life;
    const alpha = puff.alpha * lifeRatio;
    targetCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    targetCtx.beginPath();
    targetCtx.arc(puff.x, puff.y, puff.radius * lifeRatio, 0, Math.PI * 2);
    targetCtx.fill();
  });
  targetCtx.restore();
}

function drawWorld(palette) {
  worldCtx.clearRect(0, 0, viewWidth, viewHeight);

  worldCtx.fillStyle = palette.sky;
  worldCtx.fillRect(0, 0, viewWidth, viewHeight);

  const horizonY = viewHeight * 0.62;
  const groundGradient = worldCtx.createLinearGradient(0, horizonY, 0, viewHeight);
  groundGradient.addColorStop(0, palette.horizon);
  groundGradient.addColorStop(1, palette.ground);
  worldCtx.fillStyle = groundGradient;
  worldCtx.fillRect(0, horizonY, viewWidth, viewHeight - horizonY);

  const celestialX = viewWidth * 0.2;
  const celestialY = viewHeight * 0.25;
  const celestialRadius = 120;
  const celestialGradient = worldCtx.createRadialGradient(
    celestialX,
    celestialY,
    0,
    celestialX,
    celestialY,
    celestialRadius,
  );
  celestialGradient.addColorStop(0, palette.accent);
  celestialGradient.addColorStop(1, 'rgba(255,255,255,0)');
  worldCtx.fillStyle = celestialGradient;
  worldCtx.globalAlpha = palette.period === 'night' ? 0.45 : palette.period === 'evening' ? 0.35 : 0.6;
  worldCtx.beginPath();
  worldCtx.arc(celestialX, celestialY, celestialRadius, 0, Math.PI * 2);
  worldCtx.fill();
  worldCtx.globalAlpha = 1;

  worldCtx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  worldCtx.beginPath();
  worldCtx.ellipse(hero.x, hero.y + hero.radius * 0.7, hero.radius * 1.8, hero.radius * 0.6, 0, 0, Math.PI * 2);
  worldCtx.fill();

  worldCtx.fillStyle = palette.hero;
  worldCtx.beginPath();
  worldCtx.arc(hero.x, hero.y, hero.radius, 0, Math.PI * 2);
  worldCtx.fill();

  worldCtx.strokeStyle = palette.accent;
  worldCtx.lineWidth = 2;
  worldCtx.beginPath();
  worldCtx.arc(hero.x, hero.y - hero.radius * 0.4, hero.radius * 0.38, Math.PI * 0.1, Math.PI * 0.9);
  worldCtx.stroke();

  const aimEndX = hero.x + currentAim.x * hero.radius * 2.2;
  const aimEndY = hero.y + currentAim.y * hero.radius * 2.2;
  worldCtx.strokeStyle = palette.accent;
  worldCtx.lineWidth = 3;
  worldCtx.beginPath();
  worldCtx.moveTo(hero.x, hero.y);
  worldCtx.lineTo(aimEndX, aimEndY);
  worldCtx.stroke();

  drawBreath(worldCtx);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyNightLighting(isZoomed) {
  const maskWidth = maskCanvas.width;
  const maskHeight = maskCanvas.height;
  maskCtx.clearRect(0, 0, maskWidth, maskHeight);

  const baseOpacity = (isZoomed ? 0.85 : 1) * 0.92;
  const coneRadius = (isZoomed ? 140 : 220) * dpr;
  const coneOffset = (isZoomed ? 120 : 160);
  const coneHeightOffset = (isZoomed ? 60 : 80);

  const centerX = clamp((hero.x + currentAim.x * coneOffset) * dpr, 0, maskWidth);
  const centerY = clamp((hero.y + currentAim.y * coneHeightOffset) * dpr, 0, maskHeight);

  const gradient = maskCtx.createRadialGradient(
    centerX,
    centerY,
    coneRadius * 0.2,
    centerX,
    centerY,
    coneRadius,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.65, `rgba(0,0,0,${baseOpacity * 0.55})`);
  gradient.addColorStop(1, `rgba(0,0,0,${baseOpacity})`);

  maskCtx.fillStyle = gradient;
  maskCtx.fillRect(0, 0, maskWidth, maskHeight);

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height, 0, 0, viewWidth, viewHeight);
  ctx.restore();
}

function render(timestamp) {
  const realTime = timestamp / 1000;
  const delta = Math.max(0, realTime - lastFrameRealTime);
  lastFrameRealTime = realTime;
  latestRealTime = realTime;

  updateAimDirection();

  if (!zooming) {
    worldTime = (worldTime + delta / WORLD_TIME_CYCLE) % 1;
  }

  updateBreath(realTime, delta);

  const palette = getWorldPalette(worldTime);
  drawWorld(palette);

  ctx.clearRect(0, 0, viewWidth, viewHeight);
  ctx.drawImage(worldCanvas, 0, 0, canvas.width, canvas.height, 0, 0, viewWidth, viewHeight);

  if (palette.period === 'night') {
    applyNightLighting(zooming);
  }

  window.requestAnimationFrame(render);
}

function updateMousePosition(event) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (event.clientX - rect.left);
  mouse.y = (event.clientY - rect.top);
  mouse.active = true;
}

function startZoom() {
  if (zooming) {
    return;
  }
  zooming = true;
  zoomStartRealTime = latestRealTime;
  breathState = 'phase1';
  lastBreathState = 'idle';
  lastBreathPuffRealTime = -Infinity;
}

function endZoom() {
  if (!zooming) {
    return;
  }
  zooming = false;
  breathState = 'idle';
  lastBreathState = 'idle';
  lastBreathPuffRealTime = -Infinity;
  breathPuffs.length = 0;
  AudioMix.stopZoomBreath();
}

function init() {
  if (!canvas || !ctx) {
    return;
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  window.addEventListener('mousemove', updateMousePosition);
  window.addEventListener('mouseleave', () => {
    mouse.active = false;
  });
  window.addEventListener('mousedown', (event) => {
    if (event.button === 2) {
      startZoom();
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 2) {
      endZoom();
    }
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());

  AudioMix.loadAll().catch(() => undefined);

  window.requestAnimationFrame(render);
}

if (canvas && ctx) {
  init();
}
