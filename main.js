import { perlin2 } from './lib/perlin.js';
import AudioMix from './lib/audio.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

const SETTINGS_KEY = 'snow-field-settings';
const defaultSettings = { muted: true, quality: 'high' };
let settings = { ...defaultSettings };

const soundToggle = document.getElementById('sound-toggle');
const qualityToggle = document.getElementById('quality-toggle');
const infoButton = document.getElementById('info-button');
const infoOverlay = document.getElementById('info-overlay');
const infoCloseButton = infoOverlay ? infoOverlay.querySelector('[data-close]') : null;
const captionBar = document.getElementById('caption-bar');

const CAPTION_TEXT = {
  wind: '[바람이 설원을 스친다]',
  blizzard: '[눈보라가 시야를 뒤덮는다]',
  wolf: '[먼 곳에서 늑대가 울부짖는다]',
  reindeer: '[순록이 눈발을 가르며 달린다]',
  fire: '[장작불이 포근한 온기를 전한다]',
  zoom_short: '[숨을 깊게 들이쉰다]',
  zoom_soft: '[따뜻한 숨결이 공기 속으로 번진다]',
};

let qualityLevel = 'high';
let subtitlesEnabled = false;
let captionTimeoutId = null;
let lastFocusBeforeInfo = null;

const reduceMotionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;
let prefersReducedMotion = reduceMotionQuery ? reduceMotionQuery.matches : false;

const cameraShake = { x: 0, y: 0 };

const QUALITY_SNOW_FACTOR = { high: 1, low: 0.7 };
const REDUCED_MOTION_SNOW_FACTOR = 0.6;

const worldCanvas = document.createElement('canvas');
const worldCtx = worldCanvas.getContext('2d');
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');

function getEffectivePixelRatio() {
  const base = window.devicePixelRatio || 1;
  return qualityLevel === 'low' ? Math.min(1, base) : base;
}

let dpr = getEffectivePixelRatio();
let viewWidth = 0;
let viewHeight = 0;

let worldTime = 0;
const WORLD_TIME_CYCLE = 120; // seconds per full day cycle

let journeyTime = 0;
let groundScrollDistance = 0;

const JOURNEY_BASE_SPEED = 24; // abstract units per second
const JOURNEY_TARGET_RANGE = { min: 600, max: 720 }; // seconds
const BLIZZARD_DURATION = 30;
const BLIZZARD_SPEED_MULTIPLIER = 0.8;

let journeyTargetDuration = 660;
let targetDistance = JOURNEY_BASE_SPEED * journeyTargetDuration;

const snowflakes = [];
const BASE_SNOW_COUNT = 240;
let snowDensityMultiplier = 1;

const windState = {
  amplitude: 18,
  targetAmplitude: 18,
  baseAmplitude: 18,
  boostedAmplitude: 32,
  blizzardAmplitude: 42,
  gustTimer: 0,
  blizzard: false,
};

let walkSpeedMultiplier = 1;
let experienceMode = 'journey';

const endingState = {
  active: false,
  progress: 0,
  indoorSteam: 0,
};

let replayButton = null;

const hero = { x: 0, y: 0, radius: 22 };
const mouse = { x: 0, y: 0, active: false };
let currentAim = { x: 1, y: 0 };

let zooming = false;
let zoomStartRealTime = 0;
let breathState = 'idle';
let lastBreathState = 'idle';
let lastBreathPuffRealTime = -Infinity;
const breathPuffs = [];

const wolfState = {
  active: false,
  withdraw: false,
  calm: false,
  focusTime: 0,
  spawnJourneyTime: 0,
  withdrawJourneyTime: 0,
  growlBoosted: false,
};

const reindeerState = {
  active: false,
  progress: 0,
  speed: 0.12,
};

const hutState = {
  visible: false,
  revealJourneyDistance: 0,
  progress: 0,
};

let eventDirector = null;

let lastFrameRealTime = performance.now() / 1000;
let latestRealTime = lastFrameRealTime;

function loadSettings() {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      return;
    }
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.muted === 'boolean') {
        settings.muted = parsed.muted;
      }
      if (parsed.quality === 'low' || parsed.quality === 'high') {
        settings.quality = parsed.quality;
      }
    }
  } catch (error) {
    // Ignore malformed storage content
  }
}

function saveSettings() {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    const payload = JSON.stringify({
      muted: settings.muted,
      quality: settings.quality,
    });
    localStorage.setItem(SETTINGS_KEY, payload);
  } catch (error) {
    // Storage may be unavailable (private mode, etc.)
  }
}

function updateSoundButton() {
  if (!soundToggle) {
    return;
  }
  const mutedState = AudioMix.isMuted();
  soundToggle.setAttribute('aria-pressed', String(!mutedState));
  soundToggle.setAttribute('aria-label', mutedState ? 'Unmute sound' : 'Mute sound');
  const icon = soundToggle.querySelector('.hud-icon');
  if (icon) {
    icon.textContent = mutedState ? '🔇' : '🔊';
  }
}

function setMutedState(value, { persist = true } = {}) {
  const nextMuted = Boolean(value);
  settings.muted = nextMuted;
  AudioMix.setMuted(nextMuted);
  updateSoundButton();
  if (!nextMuted && AudioMix.playWind) {
    AudioMix.playWind();
  }
  if (persist) {
    saveSettings();
  }
}

function updateQualityButton() {
  if (!qualityToggle) {
    return;
  }
  const isHigh = qualityLevel === 'high';
  qualityToggle.setAttribute('aria-pressed', String(isHigh));
  qualityToggle.setAttribute(
    'aria-label',
    isHigh ? 'Switch to lower quality visuals' : 'Switch to higher quality visuals',
  );
  const icon = qualityToggle.querySelector('.hud-icon');
  if (icon) {
    icon.textContent = isHigh ? 'HQ' : 'LQ';
  }
}

function setQuality(level, { persist = true, resize = true } = {}) {
  qualityLevel = level === 'low' ? 'low' : 'high';
  settings.quality = qualityLevel;
  updateQualityButton();
  if (resize) {
    resizeCanvas();
  }
  if (persist) {
    saveSettings();
  }
}

function updateInfoButton(isOpen) {
  if (infoButton) {
    infoButton.setAttribute('aria-expanded', String(Boolean(isOpen)));
  }
}

function hideCaption() {
  if (!captionBar) {
    return;
  }
  captionBar.removeAttribute('data-visible');
  captionBar.textContent = '';
  captionTimeoutId = null;
}

function showCaption(text, duration = 3200, { force = false } = {}) {
  if (!captionBar) {
    return;
  }
  if (!subtitlesEnabled && !force) {
    return;
  }
  captionBar.textContent = text;
  captionBar.setAttribute('data-visible', 'true');
  clearTimeout(captionTimeoutId);
  captionTimeoutId = window.setTimeout(() => {
    hideCaption();
  }, duration);
}

function queueCaption(key, options = {}) {
  const text = CAPTION_TEXT[key];
  if (!text) {
    return;
  }
  showCaption(text, options.duration || 3200, { force: Boolean(options.force) });
}

function toggleSubtitles() {
  subtitlesEnabled = !subtitlesEnabled;
  const message = subtitlesEnabled ? '[자막 켜짐]' : '[자막 꺼짐]';
  showCaption(message, 1800, { force: true });
}

function openInfoOverlay() {
  if (!infoOverlay || !infoOverlay.hidden) {
    return;
  }
  infoOverlay.hidden = false;
  updateInfoButton(true);
  lastFocusBeforeInfo = document.activeElement;
  const focusTarget = infoCloseButton || infoOverlay;
  window.requestAnimationFrame(() => {
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  });
}

function closeInfoOverlay() {
  if (!infoOverlay || infoOverlay.hidden) {
    return;
  }
  infoOverlay.hidden = true;
  updateInfoButton(false);
  const target = lastFocusBeforeInfo && typeof lastFocusBeforeInfo.focus === 'function'
    ? lastFocusBeforeInfo
    : infoButton;
  if (target && typeof target.focus === 'function') {
    target.focus();
  }
}

function toggleInfoOverlay(forceState) {
  const shouldOpen = typeof forceState === 'boolean' ? forceState : infoOverlay?.hidden;
  if (shouldOpen) {
    openInfoOverlay();
  } else {
    closeInfoOverlay();
  }
}

function getSnowMotionFactor() {
  return prefersReducedMotion ? REDUCED_MOTION_SNOW_FACTOR : 1;
}

function getQualitySnowFactor() {
  return QUALITY_SNOW_FACTOR[qualityLevel] ?? 1;
}

function handleMotionPreferenceChange(event) {
  prefersReducedMotion = Boolean(event.matches);
  cameraShake.x = 0;
  cameraShake.y = 0;
  adjustSnowflakes();
}

if (reduceMotionQuery) {
  const motionListener = (event) => handleMotionPreferenceChange(event);
  if (typeof reduceMotionQuery.addEventListener === 'function') {
    reduceMotionQuery.addEventListener('change', motionListener);
  } else if (typeof reduceMotionQuery.addListener === 'function') {
    reduceMotionQuery.addListener(motionListener);
  }
}

function resizeCanvas() {
  dpr = getEffectivePixelRatio();
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
  adjustSnowflakes();
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

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function jitterTime(baseSeconds) {
  const variance = baseSeconds * 0.15;
  return baseSeconds + (Math.random() * 2 - 1) * variance;
}

function resetJourneyTargets() {
  journeyTargetDuration = randomRange(JOURNEY_TARGET_RANGE.min, JOURNEY_TARGET_RANGE.max);
  const baseTravel = JOURNEY_BASE_SPEED * Math.max(0, journeyTargetDuration - BLIZZARD_DURATION);
  const blizzardTravel = JOURNEY_BASE_SPEED * BLIZZARD_SPEED_MULTIPLIER * BLIZZARD_DURATION;
  targetDistance = baseTravel + blizzardTravel;
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
      queueCaption('zoom_short', { duration: 2400 });
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
      queueCaption('zoom_soft', { duration: 3200 });
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

  drawDistantRidges(worldCtx, palette);
  drawHut(worldCtx);
  drawReindeer(worldCtx);
  drawWolf(worldCtx);

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
  drawSnowflakes(worldCtx);

  if (windState.blizzard) {
    worldCtx.fillStyle = 'rgba(180, 200, 220, 0.25)';
    worldCtx.fillRect(0, 0, viewWidth, viewHeight);
  }
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

function updateWindState(delta) {
  const smoothing = 1 - Math.exp(-delta * 3.2);
  windState.amplitude = lerp(windState.amplitude, windState.targetAmplitude, smoothing);
}

function updateCameraShake(realTime) {
  if (prefersReducedMotion) {
    cameraShake.x = 0;
    cameraShake.y = 0;
    return;
  }
  const intensity = clamp(windState.amplitude / windState.blizzardAmplitude, 0, 1);
  const qualityModifier = qualityLevel === 'low' ? 0.7 : 1;
  const amplitude = 2.6 * intensity * qualityModifier;
  cameraShake.x = Math.sin(realTime * 0.9) * amplitude;
  cameraShake.y = Math.cos(realTime * 1.2) * amplitude * 0.6;
}

function setWindTargetAmplitude(value) {
  windState.targetAmplitude = value;
}

function startWindBurst() {
  windState.gustTimer = 20;
  setWindTargetAmplitude(windState.boostedAmplitude);
}

function endWindBurst() {
  windState.gustTimer = 0;
  if (!windState.blizzard) {
    setWindTargetAmplitude(windState.baseAmplitude);
  }
}

function startBlizzard() {
  windState.blizzard = true;
  setWindTargetAmplitude(windState.blizzardAmplitude);
  snowDensityMultiplier = 1.6;
  walkSpeedMultiplier = BLIZZARD_SPEED_MULTIPLIER;
  if (AudioMix.playBlizzard) {
    AudioMix.playBlizzard();
  }
  queueCaption('blizzard');
}

function endBlizzard() {
  windState.blizzard = false;
  snowDensityMultiplier = 1;
  walkSpeedMultiplier = 1;
  if (windState.gustTimer <= 0) {
    setWindTargetAmplitude(windState.baseAmplitude);
  }
  if (AudioMix.playWind) {
    AudioMix.playWind();
  }
  queueCaption('wind');
}

function startWolfEncounter(currentJourneyTime) {
  wolfState.active = true;
  wolfState.withdraw = false;
  wolfState.calm = false;
  wolfState.focusTime = 0;
  wolfState.spawnJourneyTime = currentJourneyTime;
  wolfState.withdrawJourneyTime = 0;
  wolfState.growlBoosted = false;
  if (AudioMix.playWolfDistant) {
    AudioMix.playWolfDistant();
  }
  queueCaption('wolf');
}

function beginWolfWithdraw(boosted) {
  if (!wolfState.active || wolfState.withdraw) {
    return;
  }
  wolfState.withdraw = true;
  wolfState.growlBoosted = Boolean(boosted);
  wolfState.withdrawJourneyTime = 0;
}

function endWolfEncounter() {
  wolfState.active = false;
  wolfState.withdraw = false;
}

function startReindeerPass() {
  reindeerState.active = true;
  reindeerState.progress = -0.25;
  reindeerState.speed = 0.16 + Math.random() * 0.04;
  if (AudioMix.playReindeerPass) {
    AudioMix.playReindeerPass();
  } else if (AudioMix.playReindeer) {
    AudioMix.playReindeer();
  }
  queueCaption('reindeer');
}

function endReindeerPass() {
  reindeerState.active = false;
  reindeerState.progress = 0;
}

function startHutReveal() {
  hutState.visible = true;
  hutState.revealJourneyDistance = groundScrollDistance;
  hutState.progress = 0;
}

function resetHut() {
  hutState.visible = false;
  hutState.revealJourneyDistance = 0;
  hutState.progress = 0;
}

class EventDirector {
  constructor() {
    this.events = [];
    this.reset();
  }

  reset() {
    this.events = [
      {
        key: 'windBurst',
        time: jitterTime(90),
        duration: 20,
        started: false,
        completed: false,
        onStart: startWindBurst,
        onEnd: endWindBurst,
      },
      {
        key: 'wolf',
        time: jitterTime(210),
        started: false,
        completed: false,
        onStart: (t) => startWolfEncounter(t),
      },
      {
        key: 'blizzard',
        time: jitterTime(330),
        duration: 30,
        started: false,
        completed: false,
        onStart: startBlizzard,
        onEnd: endBlizzard,
      },
      {
        key: 'reindeer',
        time: jitterTime(450),
        started: false,
        completed: false,
        onStart: startReindeerPass,
      },
      {
        key: 'hut',
        time: jitterTime(540),
        started: false,
        completed: false,
        onStart: startHutReveal,
      },
    ];
  }

  update(currentJourneyTime, delta) {
    this.events.forEach((event) => {
      if (event.completed) {
        return;
      }
      if (!event.started && currentJourneyTime >= event.time) {
        event.started = true;
        if (event.onStart) {
          event.onStart(currentJourneyTime);
        }
      }
      if (event.started && event.duration) {
        if (!event.endTime) {
          event.endTime = event.time + event.duration;
        }
        if (currentJourneyTime >= event.endTime) {
          event.completed = true;
          if (event.onEnd) {
            event.onEnd();
          }
        }
      }
      if (event.started && !event.duration && event.key === 'reindeer') {
        if (!reindeerState.active) {
          event.completed = true;
        }
      }
      if (event.started && !event.duration && event.key === 'hut' && hutState.visible) {
        event.completed = true;
      }
    });
  }
}

function getTargetSnowflakeCount() {
  const areaFactor = (viewWidth * viewHeight) / (1280 * 720);
  const motionFactor = getSnowMotionFactor();
  const qualityFactor = getQualitySnowFactor();
  return Math.max(
    80,
    Math.floor(BASE_SNOW_COUNT * snowDensityMultiplier * areaFactor * motionFactor * qualityFactor),
  );
}

function spawnSnowflake(atTop = false) {
  const radius = randomRange(1, 3.8);
  const speed = 34 + radius * 16 + Math.random() * 14;
  const seed = Math.random() * 1000;
  const x = Math.random() * viewWidth;
  const y = atTop ? -Math.random() * viewHeight * 0.1 : Math.random() * viewHeight;
  snowflakes.push({ x, y, radius, speed, seed });
}

function adjustSnowflakes() {
  const targetCount = getTargetSnowflakeCount();
  while (snowflakes.length < targetCount) {
    spawnSnowflake(true);
  }
  while (snowflakes.length > targetCount) {
    snowflakes.pop();
  }
}

function updateSnowflakes(delta, realTime) {
  adjustSnowflakes();
  const windAmplitude = windState.amplitude;
  const noiseScale = 0.0025;
  for (let i = snowflakes.length - 1; i >= 0; i -= 1) {
    const flake = snowflakes[i];
    const wind = perlin2((flake.seed + realTime * 0.08) * 0.3, (flake.y + groundScrollDistance) * noiseScale);
    const drift = wind * windAmplitude;
    flake.x += drift * delta;
    flake.y += flake.speed * delta;

    if (flake.x < -40) {
      flake.x = viewWidth + 20;
    } else if (flake.x > viewWidth + 40) {
      flake.x = -20;
    }
    if (flake.y > viewHeight + 40) {
      flake.y = -randomRange(20, viewHeight * 0.2);
      flake.x = Math.random() * viewWidth;
    }
  }
}

function drawSnowflakes(targetCtx) {
  targetCtx.save();
  targetCtx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  snowflakes.forEach((flake) => {
    targetCtx.beginPath();
    targetCtx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
    targetCtx.fill();
  });
  targetCtx.restore();
}

function drawDistantRidges(targetCtx, palette) {
  const ridgeCount = 3;
  for (let i = 0; i < ridgeCount; i += 1) {
    const layer = i + 1;
    const layerDepth = layer / ridgeCount;
    const yBase = viewHeight * (0.45 + layer * 0.06);
    const color = lerpColor(palette.horizon, palette.ground, layerDepth * 0.6);
    targetCtx.fillStyle = color;
    targetCtx.beginPath();
    targetCtx.moveTo(0, viewHeight);
    const peakCount = 5 + layer;
    const scale = 0.004 + layer * 0.0025;
    const amplitude = 40 + layer * 20;
    const offset = groundScrollDistance * 0.02 * (1 - layerDepth);
    for (let x = -60; x <= viewWidth + 60; x += viewWidth / peakCount) {
      const noiseValue = perlin2((x + offset) * scale, layer * 17.31);
      const peakHeight = yBase + noiseValue * amplitude;
      targetCtx.lineTo(x, peakHeight);
    }
    targetCtx.lineTo(viewWidth, viewHeight);
    targetCtx.closePath();
    targetCtx.fill();
  }
}

function getWolfScreenPosition() {
  return {
    x: viewWidth * 0.8,
    y: viewHeight * 0.46,
  };
}

function updateWolfState(delta) {
  if (!wolfState.active) {
    return;
  }

  const wolfPos = getWolfScreenPosition();
  const toWolf = { x: wolfPos.x - hero.x, y: wolfPos.y - hero.y };
  const distance = Math.hypot(toWolf.x, toWolf.y) || 1;
  const dir = { x: toWolf.x / distance, y: toWolf.y / distance };
  const dot = currentAim.x * dir.x + currentAim.y * dir.y;
  const alignmentThreshold = Math.cos((Math.PI / 180) * 6);
  if (zooming && dot >= alignmentThreshold) {
    wolfState.focusTime += delta;
  } else {
    wolfState.focusTime = Math.max(0, wolfState.focusTime - delta * 0.5);
  }

  if (!wolfState.calm && wolfState.focusTime >= 2.2) {
    wolfState.calm = true;
    beginWolfWithdraw(false);
  }

  const timeSinceSpawn = journeyTime - wolfState.spawnJourneyTime;
  if (!wolfState.withdraw && timeSinceSpawn >= 5) {
    beginWolfWithdraw(true);
  }

  if (wolfState.withdraw) {
    wolfState.withdrawJourneyTime += delta;
    if (wolfState.withdrawJourneyTime >= 3.2) {
      endWolfEncounter();
    }
  }
}

function drawWolf(targetCtx) {
  if (!wolfState.active) {
    return;
  }
  const wolfPos = getWolfScreenPosition();
  let offsetX = 0;
  if (wolfState.withdraw) {
    const progress = clamp(wolfState.withdrawJourneyTime / 2.2, 0, 1);
    offsetX = progress * viewWidth * 0.25;
  }
  const x = wolfPos.x + offsetX;
  const y = wolfPos.y;
  targetCtx.save();
  targetCtx.fillStyle = '#2a3137';
  targetCtx.beginPath();
  targetCtx.ellipse(x, y + 12, 46, 24, 0, 0, Math.PI * 2);
  targetCtx.fill();

  targetCtx.fillStyle = '#1b1f23';
  targetCtx.beginPath();
  targetCtx.moveTo(x - 30, y + 10);
  targetCtx.lineTo(x - 12, y - 26);
  targetCtx.lineTo(x + 18, y - 22);
  targetCtx.lineTo(x + 34, y + 6);
  targetCtx.closePath();
  targetCtx.fill();

  targetCtx.fillStyle = '#f2f4f7';
  targetCtx.beginPath();
  targetCtx.arc(x + 14, y - 6, 4, 0, Math.PI * 2);
  targetCtx.fill();

  targetCtx.fillStyle = wolfState.calm ? 'rgba(196, 230, 255, 0.5)' : 'rgba(255, 196, 140, 0.6)';
  const auraRadius = wolfState.calm ? 30 : 40;
  targetCtx.beginPath();
  targetCtx.arc(x, y, auraRadius, 0, Math.PI * 2);
  targetCtx.fill();

  if (wolfState.withdraw && wolfState.growlBoosted) {
    targetCtx.fillStyle = 'rgba(255, 120, 120, 0.9)';
    targetCtx.font = '20px "Noto Sans KR", sans-serif';
    targetCtx.textAlign = 'center';
    targetCtx.fillText('그르르…', x, y - 52);
  } else if (wolfState.withdraw && wolfState.calm) {
    targetCtx.fillStyle = 'rgba(180, 220, 255, 0.85)';
    targetCtx.font = '18px "Noto Sans KR", sans-serif';
    targetCtx.textAlign = 'center';
    targetCtx.fillText('시선을 피했다.', x, y - 48);
  }
  targetCtx.restore();
}

function updateReindeer(delta) {
  if (!reindeerState.active) {
    return;
  }
  reindeerState.progress += delta * reindeerState.speed;
  if (reindeerState.progress >= 1.4) {
    endReindeerPass();
  }
}

function drawReindeer(targetCtx) {
  if (!reindeerState.active) {
    return;
  }
  const progress = reindeerState.progress;
  const x = viewWidth * (0.1 + progress * 0.9);
  const yBase = viewHeight * 0.5;
  const bob = Math.sin(progress * Math.PI * 2) * 10;
  targetCtx.save();
  targetCtx.translate(x, yBase + bob);
  targetCtx.fillStyle = 'rgba(120, 82, 60, 0.9)';
  targetCtx.beginPath();
  targetCtx.ellipse(0, 0, 34, 16, 0, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.fillStyle = 'rgba(90, 62, 44, 0.9)';
  targetCtx.fillRect(-12, -24, 6, 28);
  targetCtx.fillRect(6, -24, 6, 28);
  targetCtx.strokeStyle = 'rgba(220, 210, 200, 0.9)';
  targetCtx.lineWidth = 2;
  targetCtx.beginPath();
  targetCtx.moveTo(-6, -24);
  targetCtx.bezierCurveTo(-14, -38, -30, -44, -34, -56);
  targetCtx.stroke();
  targetCtx.beginPath();
  targetCtx.moveTo(10, -22);
  targetCtx.bezierCurveTo(20, -32, 28, -40, 34, -52);
  targetCtx.stroke();
  targetCtx.restore();
}

function updateHutProgress() {
  if (!hutState.visible) {
    return;
  }
  const span = Math.max(40, targetDistance - hutState.revealJourneyDistance);
  const traveled = clamp(groundScrollDistance - hutState.revealJourneyDistance, 0, span);
  hutState.progress = traveled / span;
}

function drawHut(targetCtx) {
  if (!hutState.visible) {
    return;
  }
  const progress = hutState.progress;
  const baseScale = 0.35 + progress * 0.65;
  const x = viewWidth * 0.5;
  const y = viewHeight * (0.62 - progress * 0.14);
  const width = 180 * baseScale;
  const height = 140 * baseScale;
  targetCtx.save();
  targetCtx.translate(x, y);
  targetCtx.fillStyle = 'rgba(150, 110, 80, 0.92)';
  targetCtx.fillRect(-width * 0.5, -height, width, height);
  targetCtx.fillStyle = 'rgba(120, 88, 60, 0.92)';
  targetCtx.beginPath();
  targetCtx.moveTo(-width * 0.6, -height);
  targetCtx.lineTo(0, -height - height * 0.6);
  targetCtx.lineTo(width * 0.6, -height);
  targetCtx.closePath();
  targetCtx.fill();

  targetCtx.fillStyle = 'rgba(240, 210, 160, 0.9)';
  targetCtx.fillRect(-width * 0.15, -height * 0.6, width * 0.3, height * 0.4);

  targetCtx.fillStyle = 'rgba(255, 240, 210, 0.6)';
  targetCtx.beginPath();
  targetCtx.arc(0, -height * 0.6, width * 0.12, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.restore();
}

function ensureReplayButton() {
  if (replayButton) {
    return;
  }
  replayButton = document.createElement('button');
  replayButton.type = 'button';
  replayButton.textContent = 'Replay';
  replayButton.style.position = 'absolute';
  replayButton.style.left = '50%';
  replayButton.style.top = '70%';
  replayButton.style.transform = 'translate(-50%, -50%)';
  replayButton.style.padding = '0.6rem 1.6rem';
  replayButton.style.borderRadius = '999px';
  replayButton.style.border = '1px solid rgba(255,255,255,0.5)';
  replayButton.style.background = 'rgba(255,255,255,0.15)';
  replayButton.style.color = '#f7f1e8';
  replayButton.style.backdropFilter = 'blur(6px)';
  replayButton.style.fontFamily = '"Noto Sans KR", sans-serif';
  replayButton.style.fontSize = '16px';
  replayButton.style.letterSpacing = '0.05em';
  replayButton.style.cursor = 'pointer';
  replayButton.style.display = 'none';
  replayButton.style.transition = 'opacity 0.3s ease';
  replayButton.addEventListener('click', () => {
    resetExperience();
  });
  document.body.appendChild(replayButton);
}

function showReplayButton() {
  ensureReplayButton();
  if (replayButton) {
    replayButton.style.display = 'block';
    replayButton.style.opacity = '1';
  }
}

function hideReplayButton() {
  if (replayButton) {
    replayButton.style.display = 'none';
    replayButton.style.opacity = '0';
  }
}

function triggerEnding() {
  if (endingState.active) {
    return;
  }
  experienceMode = 'ending';
  endingState.active = true;
  endingState.progress = 0;
  endingState.indoorSteam = 0;
  setWindTargetAmplitude(6);
  if (AudioMix.playWind) {
    AudioMix.playWind({ gain: 0 });
  }
  if (AudioMix.playIndoorFire) {
    AudioMix.playIndoorFire({ loop: true });
  }
  queueCaption('fire');
  showReplayButton();
}

function updateEnding(delta) {
  endingState.progress = clamp(endingState.progress + delta * 0.25, 0, 1);
  endingState.indoorSteam += delta;
}

function drawEndingOverlay() {
  const fade = endingState.progress;
  if (fade <= 0) {
    return;
  }
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.8, fade)})`;
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  ctx.globalAlpha = fade;
  const gradient = ctx.createLinearGradient(0, 0, 0, viewHeight);
  gradient.addColorStop(0, '#2b1a1a');
  gradient.addColorStop(1, '#a0572f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  ctx.fillStyle = 'rgba(220, 180, 120, 0.7)';
  ctx.beginPath();
  ctx.arc(viewWidth * 0.72, viewHeight * 0.55, 70, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(30, 17, 10, 0.8)';
  ctx.fillRect(viewWidth * 0.2, viewHeight * 0.65, viewWidth * 0.6, viewHeight * 0.08);

  const mugX = viewWidth * 0.45;
  const mugY = viewHeight * 0.63;
  ctx.fillStyle = 'rgba(245, 230, 220, 0.9)';
  ctx.fillRect(mugX - 18, mugY - 46, 36, 46);
  ctx.beginPath();
  ctx.arc(mugX, mugY - 46, 18, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(245, 230, 220, 0.5)';
  ctx.beginPath();
  ctx.arc(mugX + 22, mugY - 26, 16, Math.PI * 0.5, Math.PI * 1.5);
  ctx.fill();

  const steamPhase = endingState.indoorSteam;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i += 1) {
    const offset = (i - 1) * 8;
    const sway = Math.sin(steamPhase * 1.2 + i * 1.4) * 6;
    ctx.beginPath();
    ctx.moveTo(mugX + offset, mugY - 50);
    ctx.bezierCurveTo(
      mugX + offset + sway,
      mugY - 90,
      mugX + offset - sway * 0.5,
      mugY - 120,
      mugX + offset + sway * 0.4,
      mugY - 150,
    );
    ctx.stroke();
  }

  ctx.restore();

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#f9f3ec';
  ctx.font = '28px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('따뜻함이 손끝으로 번진다.', viewWidth * 0.5, viewHeight * 0.42);
  ctx.restore();
}

function resetSnowflakes() {
  snowflakes.length = 0;
  adjustSnowflakes();
}

function resetWolfState() {
  wolfState.active = false;
  wolfState.withdraw = false;
  wolfState.calm = false;
  wolfState.focusTime = 0;
  wolfState.spawnJourneyTime = 0;
  wolfState.withdrawJourneyTime = 0;
  wolfState.growlBoosted = false;
}

function resetReindeerState() {
  reindeerState.active = false;
  reindeerState.progress = 0;
}

function resetExperience() {
  experienceMode = 'journey';
  endingState.active = false;
  endingState.progress = 0;
  endingState.indoorSteam = 0;
  hideReplayButton();
  journeyTime = 0;
  groundScrollDistance = 0;
  worldTime = 0;
  zooming = false;
  zoomStartRealTime = latestRealTime;
  breathState = 'idle';
  lastBreathState = 'idle';
  lastBreathPuffRealTime = -Infinity;
  breathPuffs.length = 0;
  if (AudioMix.stopZoomBreath) {
    AudioMix.stopZoomBreath();
  }
  windState.blizzard = false;
  windState.gustTimer = 0;
  setWindTargetAmplitude(windState.baseAmplitude);
  windState.amplitude = windState.baseAmplitude;
  walkSpeedMultiplier = 1;
  snowDensityMultiplier = 1;
  resetJourneyTargets();
  resetSnowflakes();
  resetWolfState();
  resetReindeerState();
  resetHut();
  if (!eventDirector) {
    eventDirector = new EventDirector();
  } else {
    eventDirector.reset();
  }
  if (AudioMix.playWind) {
    AudioMix.playWind();
  }
}

function render(timestamp) {
  const realTime = timestamp / 1000;
  const delta = Math.max(0, realTime - lastFrameRealTime);
  lastFrameRealTime = realTime;
  latestRealTime = realTime;

  updateAimDirection();

  if (experienceMode === 'journey' && !zooming) {
    journeyTime += delta;
    groundScrollDistance += delta * JOURNEY_BASE_SPEED * walkSpeedMultiplier;
  }

  worldTime = (journeyTime % WORLD_TIME_CYCLE) / WORLD_TIME_CYCLE;

  if (eventDirector) {
    eventDirector.update(journeyTime, delta);
  }

  updateWindState(delta);
  updateSnowflakes(delta, realTime);
  updateWolfState(delta);
  updateReindeer(delta);
  updateHutProgress();

  if (experienceMode === 'journey' && groundScrollDistance >= targetDistance) {
    triggerEnding();
  }

  updateBreath(realTime, delta);

  if (endingState.active) {
    updateEnding(delta);
  }

  const palette = getWorldPalette(worldTime);
  drawWorld(palette);

  ctx.clearRect(0, 0, viewWidth, viewHeight);
  updateCameraShake(realTime);
  ctx.save();
  ctx.translate(cameraShake.x, cameraShake.y);
  ctx.drawImage(worldCanvas, 0, 0, canvas.width, canvas.height, 0, 0, viewWidth, viewHeight);

  if (palette.period === 'night') {
    applyNightLighting(zooming);
  }

  if (endingState.active) {
    drawEndingOverlay();
  }
  ctx.restore();

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

  loadSettings();
  setQuality(settings.quality, { persist: false, resize: false });
  setMutedState(settings.muted, { persist: false });
  updateInfoButton(false);

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

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && endingState.active) {
      resetExperience();
    } else if (event.key === 'c' || event.key === 'C') {
      toggleSubtitles();
    } else if (event.key === 'i' || event.key === 'I') {
      toggleInfoOverlay();
    } else if (event.key === 'Escape') {
      closeInfoOverlay();
    }
  });

  if (soundToggle) {
    soundToggle.addEventListener('click', () => {
      setMutedState(!AudioMix.isMuted());
    });
  }

  if (qualityToggle) {
    qualityToggle.addEventListener('click', () => {
      const nextQuality = qualityLevel === 'high' ? 'low' : 'high';
      setQuality(nextQuality);
    });
  }

  if (infoButton) {
    infoButton.addEventListener('click', () => {
      toggleInfoOverlay();
    });
  }

  if (infoCloseButton) {
    infoCloseButton.addEventListener('click', () => {
      closeInfoOverlay();
    });
  }

  if (infoOverlay) {
    infoOverlay.addEventListener('click', (event) => {
      if (event.target === infoOverlay) {
        closeInfoOverlay();
      }
    });
  }

  AudioMix.loadAll().catch(() => undefined);

  ensureReplayButton();
  resetExperience();

  window.requestAnimationFrame(render);
}

if (canvas && ctx) {
  init();
}
