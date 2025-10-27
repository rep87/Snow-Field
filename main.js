import { perlin2 } from './lib/perlin.js';
import AudioMix from './lib/audio.js';

const CAM = { horizonRatio: 0.6, heroScaleBase: 1.12 };
const COLORS = {
  skyTop: '#F2F5F8',
  skyBot: '#E7ECEF',
  snowTop: '#DEE6EE',
  snowBot: '#CFD9E3',
  fogNear: 0.18,
  fogFar: 0.55,
};

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const hudInfo = document.getElementById('hud-info');
const btnAudio = document.getElementById('btn-audio');

let dpr = window.devicePixelRatio || 1;
let width = window.innerWidth || canvas.clientWidth || 1;
let height = window.innerHeight || canvas.clientHeight || 1;
let horizonY = height * CAM.horizonRatio;

const state = {
  time: 0,
  lastFrame: performance.now(),
  groundOffset: 0,
  walk: { base: 80, jitterAmp: 0.08, noiseT: Math.random() * 10 },
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

window.__heroScale = CAM.heroScaleBase;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  width = window.innerWidth || document.documentElement.clientWidth || canvas.clientWidth || 1;
  height = window.innerHeight || document.documentElement.clientHeight || canvas.clientHeight || 1;
  horizonY = height * CAM.horizonRatio;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
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
  return {
    x,
    y,
    depth,
    size: 1.2 + depth * 2.4,
    speed: 24 + depth * 62,
  };
}

function updateFlakes(dt, wind) {
  for (const flake of flakes) {
    flake.y += (flake.speed + state.walk.base * 0.08) * dt;
    flake.x += wind * dt * (0.4 + flake.depth * 0.8);

    if (flake.y > height) {
      flake.y = horizonY - Math.random() * 40;
      flake.x = Math.random() * width;
    }
    if (flake.x < -20) {
      flake.x = width + 20 * Math.random();
    } else if (flake.x > width + 20) {
      flake.x = -20 * Math.random();
    }
  }
}

function drawSky() {
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, COLORS.skyTop);
  grad.addColorStop(1, COLORS.skyBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const sunX = width * 0.1;
  const sunY = height * 0.12;
  const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, height * 0.25);
  sunGrad.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  sunGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.25)');
  sunGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sunGrad;
  ctx.fillRect(0, 0, width, horizonY);
  ctx.restore();
}

function drawSnowGround() {
  ctx.save();
  const snowGrad = ctx.createLinearGradient(0, horizonY, 0, height);
  snowGrad.addColorStop(0, COLORS.snowTop);
  snowGrad.addColorStop(1, COLORS.snowBot);
  ctx.fillStyle = snowGrad;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  const fogGrad = ctx.createLinearGradient(0, horizonY - height * 0.04, 0, horizonY + height * 0.2);
  fogGrad.addColorStop(0, `rgba(255, 255, 255, ${COLORS.fogNear})`);
  fogGrad.addColorStop(1, `rgba(255, 255, 255, ${COLORS.fogFar})`);
  ctx.fillStyle = fogGrad;
  ctx.fillRect(0, horizonY - height * 0.04, width, height * 0.24);

  const spacing = 140;
  const offset = (state.groundOffset % spacing + spacing) % spacing;
  for (let y = horizonY + spacing - offset; y < height; y += spacing) {
    const rel = clamp((y - horizonY) / (height - horizonY), 0, 1);
    const alpha = 0.26 * (1 - rel) + 0.05;
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y - spacing * 0.12);
    ctx.stroke();
  }

  ctx.restore();
}

function drawFlakes() {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  for (const flake of flakes) {
    const size = flake.size;
    ctx.globalAlpha = clamp(0.35 + flake.depth * 0.65, 0.35, 1);
    ctx.beginPath();
    ctx.arc(flake.x, flake.y, size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHero() {
  const scale = Number(window.__heroScale) || CAM.heroScaleBase;
  const heroHeight = height * 0.2 * scale;
  const heroX = width * 0.5;
  const heroY = height * 0.68;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(heroX, heroY + heroHeight * 0.45, heroHeight * 0.42, heroHeight * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (heroSpriteReady) {
    const aspect = heroImage.width / Math.max(1, heroImage.height);
    const drawHeight = heroHeight;
    const drawWidth = drawHeight * aspect;
    ctx.drawImage(heroImage, heroX - drawWidth / 2, heroY - drawHeight, drawWidth, drawHeight);
    return;
  }

  ctx.save();
  ctx.translate(heroX, heroY - heroHeight);

  const torsoWidth = heroHeight * 0.36;
  const torsoHeight = heroHeight * 0.58;
  const packWidth = torsoWidth * 0.9;
  const packHeight = torsoHeight * 0.8;
  const headRadius = heroHeight * 0.16;

  drawRoundedRect(ctx, -packWidth / 2, heroHeight * 0.12, packWidth, packHeight, packWidth * 0.22, '#23313f');
  drawRoundedRect(ctx, -torsoWidth / 2, heroHeight * 0.18, torsoWidth, torsoHeight, torsoWidth * 0.28, '#2d3c4d');

  ctx.fillStyle = '#1e252f';
  ctx.beginPath();
  ctx.arc(0, headRadius + heroHeight * 0.02, headRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#141920';
  ctx.lineWidth = heroHeight * 0.03;
  ctx.beginPath();
  ctx.moveTo(torsoWidth * 0.4, heroHeight * 0.24);
  ctx.lineTo(torsoWidth * 0.9, heroHeight * 0.9);
  ctx.stroke();

  ctx.fillStyle = '#3a4a5c';
  drawRoundedRect(ctx, -torsoWidth * 0.55, heroHeight * 0.65, torsoWidth * 1.1, heroHeight * 0.18, torsoWidth * 0.18, '#3a4a5c');

  ctx.restore();
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

  const wind = Math.sin(state.walk.noiseT * 1.3) * 22;
  updateFlakes(dt, wind);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawSky();
  drawSnowGround();
  drawHero();
  drawFlakes();
}

updateAudioButton();
resize();
updateHud();
setupEvents();
requestAnimationFrame(tick);
