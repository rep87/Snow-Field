import { perlin2 } from './lib/perlin.js';
import AudioMix from './lib/audio.js';

const CAM = { horizonRatio: 0.6, targetXRatio: 0.5, targetYRatio: 0.72 };
const heroScale = 1.35;
const PAL = {
  skyTop: '#F2F5F8',
  skyBot: '#E7ECEF',
  snowTop: '#DEE6EE',
  snowBot: '#CFD9E3',
  navy: '#1F2933',
  navy2: '#2A3946',
  gun: '#0F1720',
  fog: 'rgba(255,255,255,0.28)',
};
const PIXEL_SCALE = 4;

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const lo = document.createElement('canvas');
const loCtx = lo.getContext('2d', { alpha: true });
const hudInfo = document.getElementById('hud-info');
const btnAudio = document.getElementById('btn-audio');

let width = 1;
let height = 1;
let horizonY = 1;

const state = {
  time: 0,
  lastFrame: performance.now(),
  groundOffset: 0,
  walk: {
    base: 80,
    jitterAmp: 0.08,
    noiseT: Math.random() * 10,
    phase: Math.random() * Math.PI * 2,
    bobAmp: 10,
    swayAmp: 8,
    bob: 0,
    sway: 0,
  },
  stepTimer: 0,
  fps: 60,
  fpsFilter: 0.12,
  audioPrimed: false,
};

const flakes = [];
const FLAKE_COUNT = 320;

const heroImage = new Image();
let heroSpriteReady = false;
heroImage.onload = () => {
  heroSpriteReady = true;
};
heroImage.onerror = () => {};
heroImage.src = './assets/sprites/hero_waist_back.png';

window.__heroScale = heroScale;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resize() {
  const viewW = window.innerWidth || document.documentElement.clientWidth || canvas.clientWidth || 1;
  const viewH = window.innerHeight || document.documentElement.clientHeight || canvas.clientHeight || 1;
  const loW = Math.max(320, Math.round(viewW / PIXEL_SCALE));
  const loH = Math.max(180, Math.round(viewH / PIXEL_SCALE));

  lo.width = loW;
  lo.height = loH;
  canvas.width = loW * PIXEL_SCALE;
  canvas.height = loH * PIXEL_SCALE;
  canvas.style.width = `${viewW}px`;
  canvas.style.height = `${viewH}px`;

  ctx.imageSmoothingEnabled = false;
  loCtx.imageSmoothingEnabled = false;

  width = loW;
  height = loH;
  horizonY = Math.round(height * CAM.horizonRatio);

  rebuildFlakes();
}

function rebuildFlakes() {
  flakes.length = 0;
  for (let i = 0; i < FLAKE_COUNT; i += 1) {
    flakes.push(makeFlake(Math.random() * width, Math.random() * height));
  }
}

function makeFlake(x, y) {
  const depth = Math.random();
  const size = Math.max(1, Math.min(3, Math.round(1 + depth * 2)));
  const speed = 14 + depth * 28;
  return {
    x,
    y,
    depth,
    size,
    speed,
  };
}

function updateFlakes(dt, wind) {
  for (const flake of flakes) {
    const fallFactor = 0.7 + flake.depth * 0.5;
    flake.y += (flake.speed * fallFactor + state.walk.base * 0.05) * dt;
    const drift = wind * (0.35 + flake.depth * 0.65) + state.walk.sway * 0.06;
    flake.x += drift * dt;

    if (flake.y > height) {
      flake.y = horizonY - Math.random() * 20;
      flake.x = Math.random() * width;
    }
    if (flake.x < -10) {
      flake.x = width + 10 * Math.random();
    } else if (flake.x > width + 10) {
      flake.x = -10 * Math.random();
    }
  }
}

function ditherFill(yStart, yEnd, colorA, colorB) {
  const start = Math.max(0, Math.floor(yStart));
  const end = Math.min(height, Math.ceil(yEnd));
  for (let y = start; y < end; y += 1) {
    const useB = (y & 1) === 0;
    loCtx.fillStyle = useB ? colorB : colorA;
    loCtx.fillRect(0, y, width, 1);
  }
}

function drawSky() {
  ditherFill(0, horizonY, PAL.skyTop, PAL.skyBot);
}

function drawSnowGround() {
  ditherFill(horizonY, height, PAL.snowTop, PAL.snowBot);

  const fogY = Math.max(0, horizonY - Math.round(height * 0.08));
  const fogH = Math.round(height * 0.22);
  loCtx.fillStyle = PAL.fog;
  loCtx.fillRect(0, fogY, width, fogH);

  const spacing = Math.max(12, Math.round(height * 0.18));
  const offset = (state.groundOffset % spacing + spacing) % spacing;
  loCtx.save();
  loCtx.globalAlpha = 0.35;
  loCtx.strokeStyle = PAL.skyTop;
  loCtx.lineWidth = 1;
  for (let y = horizonY + spacing - offset; y < height; y += spacing) {
    loCtx.beginPath();
    loCtx.moveTo(0, y);
    loCtx.lineTo(width, y - Math.round(spacing * 0.2));
    loCtx.stroke();
  }
  loCtx.restore();
}

function drawFlakes() {
  loCtx.save();
  for (const flake of flakes) {
    const size = flake.size;
    loCtx.globalAlpha = clamp(0.4 + flake.depth * 0.4, 0.4, 0.85);
    loCtx.fillStyle = PAL.skyTop;
    const drawX = Math.round(flake.x);
    const drawY = Math.round(flake.y);
    loCtx.fillRect(drawX, drawY, size, size);
  }
  loCtx.restore();
}

function drawHero() {
  const scale = Number(window.__heroScale) || heroScale;
  const heroHeight = Math.max(24, Math.round(height * 0.22 * scale));
  const heroX = Math.round(width * CAM.targetXRatio + state.walk.sway * 0.4);
  const heroY = Math.round(height * CAM.targetYRatio + state.walk.bob * 0.5);

  const shadowH = Math.max(2, Math.min(3, Math.round(heroHeight * 0.05)));
  const shadowW = Math.round(heroHeight * 0.34);
  loCtx.save();
  loCtx.globalAlpha = 0.2;
  loCtx.fillStyle = PAL.gun;
  loCtx.beginPath();
  loCtx.ellipse(heroX, heroY + Math.round(heroHeight * 0.42), shadowW, shadowH, 0, 0, Math.PI * 2);
  loCtx.fill();
  loCtx.restore();

  if (heroSpriteReady) {
    const aspect = heroImage.width / Math.max(1, heroImage.height);
    const drawHeight = heroHeight;
    const drawWidth = Math.max(1, Math.round(drawHeight * aspect));
    const drawX = Math.round(heroX - drawWidth / 2);
    const drawY = Math.round(heroY - drawHeight);
    loCtx.drawImage(heroImage, drawX, drawY, drawWidth, drawHeight);
    return;
  }

  loCtx.save();
  loCtx.translate(heroX, heroY - heroHeight);

  const torsoWidth = Math.round(heroHeight * 0.38);
  const torsoHeight = Math.round(heroHeight * 0.6);
  const packWidth = Math.round(torsoWidth * 0.9);
  const packHeight = Math.round(torsoHeight * 0.82);
  const headRadius = Math.max(2, Math.round(heroHeight * 0.16));

  drawRoundedRect(
    loCtx,
    -Math.round(packWidth / 2),
    Math.round(heroHeight * 0.12),
    packWidth,
    packHeight,
    Math.round(packWidth * 0.18),
    PAL.navy2,
  );
  drawRoundedRect(
    loCtx,
    -Math.round(torsoWidth / 2),
    Math.round(heroHeight * 0.18),
    torsoWidth,
    torsoHeight,
    Math.round(torsoWidth * 0.22),
    PAL.navy,
  );

  loCtx.fillStyle = PAL.gun;
  loCtx.beginPath();
  loCtx.arc(0, headRadius + Math.round(heroHeight * 0.02), headRadius, 0, Math.PI * 2);
  loCtx.fill();

  loCtx.strokeStyle = PAL.gun;
  loCtx.lineWidth = Math.max(1, Math.round(heroHeight * 0.03));
  loCtx.beginPath();
  loCtx.moveTo(Math.round(torsoWidth * 0.4), Math.round(heroHeight * 0.24));
  loCtx.lineTo(Math.round(torsoWidth * 0.86), Math.round(heroHeight * 0.92));
  loCtx.stroke();

  drawRoundedRect(
    loCtx,
    -Math.round(torsoWidth * 0.55),
    Math.round(heroHeight * 0.65),
    Math.round(torsoWidth * 1.1),
    Math.max(2, Math.round(heroHeight * 0.18)),
    Math.round(torsoWidth * 0.16),
    PAL.navy2,
  );

  loCtx.restore();
}

function drawRoundedRect(context, x, y, w, h, r, fillStyle) {
  context.save();
  context.fillStyle = fillStyle;
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + w - radius, y);
  context.quadraticCurveTo(x + w, y, x + w, y + radius);
  context.lineTo(x + w, y + h - radius);
  context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  context.lineTo(x + radius, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fill();
  context.restore();
}

function updateHud() {
  if (!hudInfo) return;
  const fps = Math.round(state.fps);
  hudInfo.textContent = `Quality: High • FPS: ${fps}`;
}

function updateAudioButton() {
  if (!btnAudio) return;
  const muted = AudioMix.isMuted ? AudioMix.isMuted() : true;
  btnAudio.setAttribute('aria-pressed', String(!muted));
  btnAudio.textContent = muted ? '🔇' : '🔈';
}

async function primeAudio() {
  if (state.audioPrimed) {
    return;
  }
  state.audioPrimed = true;
  try {
    await AudioMix.loadAll();
  } catch (error) {
    console.warn('Audio load failed', error);
  }
  AudioMix.setMuted(false);
  AudioMix.playWind(true);
  updateAudioButton();
}

function setupEvents() {
  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', async () => {
    await primeAudio();
    if (state.stepTimer <= 0) {
      state.stepTimer = 0.01;
    }
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  if (btnAudio) {
    btnAudio.addEventListener('click', async () => {
      if (!state.audioPrimed) {
        await primeAudio();
        return;
      }
      const muted = AudioMix.toggleMuted();
      if (!muted) {
        AudioMix.playWind(true);
      }
      updateAudioButton();
    });
  }

  window.addEventListener('error', (event) => {
    console.error(event.error || event.message);
    showErrorOverlay('Something went wrong. Check the console for details.');
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error(event.reason);
    showErrorOverlay('Unhandled promise rejection. Check the console for details.');
  });
}

const errorOverlay = document.createElement('div');
errorOverlay.style.position = 'fixed';
errorOverlay.style.left = '50%';
errorOverlay.style.top = '12px';
errorOverlay.style.transform = 'translateX(-50%)';
errorOverlay.style.padding = '8px 12px';
errorOverlay.style.borderRadius = '8px';
errorOverlay.style.background = 'rgba(0,0,0,0.72)';
errorOverlay.style.color = '#fff';
errorOverlay.style.font = '12px/1.2 system-ui, sans-serif';
errorOverlay.style.zIndex = '100';
errorOverlay.style.display = 'none';
errorOverlay.setAttribute('role', 'alert');
document.body.appendChild(errorOverlay);

function showErrorOverlay(message) {
  errorOverlay.textContent = message;
  errorOverlay.style.display = 'block';
}

function tick(now) {
  requestAnimationFrame(tick);
  const dt = clamp((now - state.lastFrame) / 1000, 0, 0.1);
  state.lastFrame = now;
  state.time += dt;

  const walkNoise = perlin2(state.walk.noiseT, 0);
  state.walk.noiseT += dt * 0.4;
  const jitter = walkNoise * state.walk.jitterAmp;
  const speed = state.walk.base * (1 + jitter);
  state.groundOffset += speed * dt;
  state.walk.phase += dt * speed * 0.045;
  state.walk.bob = Math.sin(state.walk.phase * 2) * state.walk.bobAmp;
  state.walk.sway = Math.sin(state.walk.phase + Math.PI / 2) * state.walk.swayAmp;

  const speedNorm = clamp((speed - state.walk.base) / state.walk.base, 0, 1);
  const stepInterval = clamp(0.48 - speedNorm * 0.2, 0.3, 0.55);
  state.stepTimer -= dt;
  if (state.stepTimer <= 0) {
    AudioMix.playStep();
    state.stepTimer += stepInterval;
  }

  const fpsInstant = dt > 0 ? 1 / dt : 0;
  state.fps += (fpsInstant - state.fps) * state.fpsFilter;
  updateHud();

  const wind = Math.sin(state.walk.noiseT * 1.3) * 6 + state.walk.sway * 0.4;
  updateFlakes(dt, wind);

  loCtx.setTransform(1, 0, 0, 1, 0, 0);
  loCtx.clearRect(0, 0, width, height);
  drawSky();
  drawSnowGround();
  drawHero();
  drawFlakes();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(lo, 0, 0, canvas.width, canvas.height);
}

updateAudioButton();
resize();
updateHud();
setupEvents();
requestAnimationFrame(tick);
