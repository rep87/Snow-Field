import { AudioMix } from './lib/audio.js';
import { perlin2 } from './lib/perlin.js';

const QUALITY_STORAGE_KEY = 'snow-field-quality';
const QUALITY_PRESETS = {
  low: { total: 200 },
  medium: { total: 400 },
  high: { total: 800 },
};

const QUALITY_ORDER = ['low', 'medium', 'high'];

const LAYER_CONFIGS = [
  {
    name: 'far',
    weight: 0.32,
    sizeRange: [0.7, 1.4],
    speedRange: [18, 24],
    alphaRange: [0.18, 0.35],
    windFrequency: 0.0009,
    windTimeScale: 0.09,
    windStrength: 12,
    wanderSpeed: 0.35,
    wanderDistance: 2.8,
  },
  {
    name: 'mid',
    weight: 0.36,
    sizeRange: [1.1, 2.3],
    speedRange: [24, 32],
    alphaRange: [0.3, 0.55],
    windFrequency: 0.0012,
    windTimeScale: 0.1,
    windStrength: 18,
    wanderSpeed: 0.45,
    wanderDistance: 3.6,
  },
  {
    name: 'near',
    weight: 0.32,
    sizeRange: [1.8, 3.6],
    speedRange: [32, 44],
    alphaRange: [0.48, 0.82],
    windFrequency: 0.0016,
    windTimeScale: 0.12,
    windStrength: 26,
    wanderSpeed: 0.55,
    wanderDistance: 4.4,
  },
];

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const hudElement = document.querySelector('.hud');

const State = {
  zooming: false,
  worldTime: 0,
  realTime: 0,
  quality: 'medium',
  rngSeed: 1337,
  walk: {
    base: 80,
    jitterAmp: 0.08,
    fatigueNoiseSpeed: 0.1,
  },
};

let dpr = window.devicePixelRatio || 1;
let lastTime = performance.now();
let fps = 0;
const FPS_SMOOTHING = 0.92;
let particleSystem = null;
let groundScroll = 0;
let stepTimer = 0.35;
let nextStepSide = 'left';
let currentWalkSpeed = State.walk.base;
let currentWalkSpeedNormalized = 1;
let heroSprite = null;
let heroSpriteReady = false;

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function loadHeroSprite() {
  try {
    heroSprite = new Image();
    heroSprite.decoding = 'async';
    heroSprite.src = 'assets/sprites/hero_waist_back.png';
    heroSprite.addEventListener('load', () => {
      heroSpriteReady = true;
    });
    heroSprite.addEventListener('error', (err) => {
      console.warn('Hero sprite unavailable, using fallback silhouette', err);
    });
  } catch (err) {
    console.warn('Hero sprite load skipped, using fallback silhouette', err);
  }
}

class ParticleSystem {
  constructor() {
    this.layers = [];
    this.layerMap = new Map();
    this.width = 0;
    this.height = 0;
    this.margin = 0;

    LAYER_CONFIGS.forEach((config) => {
      const layer = {
        ...config,
        particles: [],
        targetCount: 0,
      };
      this.layers.push(layer);
      this.layerMap.set(layer.name, layer);
    });
  }

  setBounds(width, height) {
    this.width = width;
    this.height = height;
    this.margin = Math.max(width, height) * 0.12 + 12;

    if (!width || !height) {
      return;
    }

    this.layers.forEach((layer) => {
      layer.particles.forEach((particle) => {
        if (particle.x < -this.margin || particle.x > width + this.margin) {
          particle.x = randomRange(-this.margin, width + this.margin);
        }
        if (particle.y < -this.margin || particle.y > height + this.margin) {
          particle.y = randomRange(-this.margin, height + this.margin);
        }
      });
      this.syncLayerPopulation(layer, true);
    });
  }

  setQuality(quality) {
    const preset = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.medium;
    const totalWeight = this.layers.reduce((sum, layer) => sum + layer.weight, 0);
    let remaining = preset.total;

    this.layers.forEach((layer, index) => {
      let target = Math.round((layer.weight / totalWeight) * preset.total);
      if (index === this.layers.length - 1) {
        target = remaining;
      } else {
        remaining -= target;
      }
      layer.targetCount = target;
      this.syncLayerPopulation(layer, true);
    });
  }

  syncLayerPopulation(layer, scatter = false) {
    if (!this.width || !this.height) {
      return;
    }

    while (layer.particles.length < layer.targetCount) {
      layer.particles.push(this.spawnParticle(layer, scatter));
    }
    if (layer.particles.length > layer.targetCount) {
      layer.particles.length = layer.targetCount;
    }
  }

  spawnParticle(layer, scatter = false) {
    const particle = {
      x: 0,
      y: 0,
      size: 0,
      speed: 0,
      alpha: 0,
      jitter: 0,
      windJitter: 0,
      phase: 0,
    };
    this.resetParticle(particle, layer, scatter);
    return particle;
  }

  resetParticle(particle, layer, scatter = false) {
    particle.x = randomRange(-this.margin, this.width + this.margin);
    particle.y = scatter
      ? randomRange(-this.margin, this.height + this.margin)
      : randomRange(-this.margin * 1.2, -this.margin * 0.2);
    particle.size = randomRange(layer.sizeRange[0], layer.sizeRange[1]);
    particle.speed = randomRange(layer.speedRange[0], layer.speedRange[1]);
    particle.alpha = randomRange(layer.alphaRange[0], layer.alphaRange[1]);
    particle.jitter = randomRange(-0.08, 0.08);
    particle.windJitter = randomRange(-0.08, 0.08);
    particle.phase = Math.random() * Math.PI * 2;
  }

  update(dt, time) {
    if (!this.width || !this.height) {
      return;
    }

    const width = this.width;
    const height = this.height;
    const margin = this.margin;

    this.layers.forEach((layer) => {
      const {
        windFrequency,
        windTimeScale,
        windStrength,
        wanderSpeed,
        wanderDistance,
      } = layer;

      layer.particles.forEach((particle) => {
        const windSample = perlin2(
          time * windTimeScale + particle.x * windFrequency,
          particle.y * windFrequency,
        );
        const wind = (windSample * 2 - 1) * windStrength * (1 + particle.windJitter);
        const vy = particle.speed * (1 + particle.jitter);
        const wander = Math.cos(particle.phase + time * wanderSpeed) * wanderDistance;

        particle.x += (wind + wander) * dt;
        particle.y += vy * dt;

        if (particle.y > height + margin) {
          this.resetParticle(particle, layer, false);
          return;
        }
        if (particle.x < -margin) {
          particle.x = width + margin;
        } else if (particle.x > width + margin) {
          particle.x = -margin;
        }
      });
    });
  }

  drawLayer(ctxRef, name) {
    const layer = this.layerMap.get(name);
    if (!layer) {
      return;
    }
    ctxRef.save();
    ctxRef.fillStyle = '#ffffff';
    layer.particles.forEach((particle) => {
      ctxRef.globalAlpha = particle.alpha;
      ctxRef.beginPath();
      ctxRef.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctxRef.fill();
    });
    ctxRef.restore();
  }
}

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const { innerWidth: width, innerHeight: height } = window;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (particleSystem) {
    particleSystem.setBounds(canvas.width / dpr, canvas.height / dpr);
  }
}

function handleContextMenu(event) {
  event.preventDefault();
}

function handlePointerDown(event) {
  if (event.button === 2) {
    if (!State.zooming) {
      State.zooming = true;
      console.log('Zoom start, worldTime paused');
    }
  }
}

function handlePointerUp(event) {
  if (event.button === 2) {
    if (State.zooming) {
      State.zooming = false;
      console.log('Zoom end, worldTime resumed');
    }
  }
}

function drawBackground(width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#dfe8f2');
  gradient.addColorStop(1, '#f7fbff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawGround(width, height) {
  const anchorY = height * 0.72;
  const bandTop = anchorY - height * 0.12;
  const bandHeight = height - bandTop;
  const gradient = ctx.createLinearGradient(0, bandTop, 0, bandTop + bandHeight);
  gradient.addColorStop(0, 'rgba(199, 211, 226, 0.65)');
  gradient.addColorStop(0.5, 'rgba(165, 182, 206, 0.85)');
  gradient.addColorStop(1, 'rgba(129, 150, 178, 0.95)');

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, bandTop, width, bandHeight);

  const layerCount = 18;
  const baseSpacing = 26;

  for (let i = 0; i < layerCount; i += 1) {
    const depth = i / layerCount;
    const eased = depth * depth;
    const yBase = anchorY + eased * (height - anchorY);
    const speedScale = 1 + depth * 1.6;
    const offset = (groundScroll * speedScale) % baseSpacing;
    const y = yBase - offset;
    if (y < bandTop - baseSpacing || y > height + baseSpacing) {
      continue;
    }

    const dotSpacing = baseSpacing * (0.6 + depth * 1.8);
    const size = Math.max(0.8, (1 - depth) * 2.6);
    const alpha = 0.18 + (1 - depth) * 0.12;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#9baec7';

    for (let x = -dotSpacing; x < width + dotSpacing; x += dotSpacing) {
      const jitter = perlin2(
        x * 0.05 + depth * 8.2,
        State.worldTime * 0.35 + depth * 3.8,
      );
      const perspectiveShift = (x - width / 2) * depth * 0.05;
      const dotX = x + jitter * dotSpacing * 0.25 - perspectiveShift;
      ctx.beginPath();
      ctx.arc(dotX, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawHero(width, height) {
  const heroWidth = width * 0.12;
  const heroHeight = height * 0.25;
  const anchorX = width * 0.5;
  const anchorY = height * 0.72;
  const heroX = anchorX - heroWidth / 2;
  const heroY = anchorY - heroHeight;

  if (heroSpriteReady && heroSprite) {
    ctx.drawImage(heroSprite, heroX, heroY, heroWidth, heroHeight);
    return;
  }

  const radius = Math.min(heroWidth, heroHeight) * 0.2;
  ctx.fillStyle = '#334866';
  ctx.beginPath();
  ctx.moveTo(heroX + radius, heroY);
  ctx.lineTo(heroX + heroWidth - radius, heroY);
  ctx.quadraticCurveTo(heroX + heroWidth, heroY, heroX + heroWidth, heroY + radius);
  ctx.lineTo(heroX + heroWidth, heroY + heroHeight - radius);
  ctx.quadraticCurveTo(
    heroX + heroWidth,
    heroY + heroHeight,
    heroX + heroWidth - radius,
    heroY + heroHeight,
  );
  ctx.lineTo(heroX + radius, heroY + heroHeight);
  ctx.quadraticCurveTo(heroX, heroY + heroHeight, heroX, heroY + heroHeight - radius);
  ctx.lineTo(heroX, heroY + radius);
  ctx.quadraticCurveTo(heroX, heroY, heroX + radius, heroY);
  ctx.closePath();
  ctx.fill();

  const headRadius = heroWidth * 0.35;
  const headX = anchorX;
  const headY = heroY - headRadius * 0.2;

  ctx.fillStyle = '#f0f4fa';
  ctx.beginPath();
  ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();
}

function render() {
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);
  if (particleSystem) {
    particleSystem.drawLayer(ctx, 'far');
    particleSystem.drawLayer(ctx, 'mid');
  }
  drawGround(width, height);
  drawHero(width, height);
  if (particleSystem) {
    particleSystem.drawLayer(ctx, 'near');
  }
  ctx.restore();
}

function updateHud() {
  if (!hudElement) {
    return;
  }
  hudElement.style.opacity = '1';
  const fpsDisplay = fps > 0 ? Math.round(fps).toString().padStart(2, ' ') : '--';
  hudElement.textContent = `fps: ${fpsDisplay}\nquality: ${State.quality}`;
}

function saveQuality(quality) {
  try {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, quality);
  } catch (err) {
    console.warn('Quality persistence unavailable', err);
  }
}

function loadQuality() {
  try {
    const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    if (stored && QUALITY_PRESETS[stored]) {
      State.quality = stored;
    }
  } catch (err) {
    console.warn('Quality persistence unavailable', err);
  }
}

function applyQuality(quality) {
  const next = QUALITY_PRESETS[quality] ? quality : 'medium';
  if (State.quality === next && particleSystem) {
    particleSystem.setQuality(next);
    updateHud();
    return;
  }
  State.quality = next;
  if (particleSystem) {
    particleSystem.setQuality(next);
  }
  saveQuality(next);
  updateHud();
}

function cycleQuality() {
  const currentIndex = QUALITY_ORDER.indexOf(State.quality);
  const nextIndex = (currentIndex + 1) % QUALITY_ORDER.length;
  applyQuality(QUALITY_ORDER[nextIndex]);
}

function triggerFootstep(speedNormalized) {
  const interval = clamp(0.48 - speedNormalized * 0.2, 0.28, 0.55);
  const hasDirectional = AudioMix.hasDirectionalSteps();
  const side = hasDirectional ? nextStepSide : null;
  AudioMix.playStep(side);
  console.log(hasDirectional ? `step:${side}` : 'step');
  if (hasDirectional) {
    nextStepSide = nextStepSide === 'left' ? 'right' : 'left';
  }
  stepTimer += interval;
}

function updateWalk(dt) {
  const { base, jitterAmp, fatigueNoiseSpeed } = State.walk;
  const fatigueSample = perlin2(State.worldTime * fatigueNoiseSpeed, 3.1) * 2 - 1;
  const jitter = fatigueSample * jitterAmp;
  currentWalkSpeed = base * (1 + jitter);
  currentWalkSpeedNormalized = currentWalkSpeed / base;
  AudioMix.setWindFromSpeed(currentWalkSpeedNormalized);

  const patternLength = 320;
  if (!State.zooming) {
    groundScroll = (groundScroll + currentWalkSpeed * dt) % patternLength;
    stepTimer -= dt;
    while (stepTimer <= 0) {
      triggerFootstep(currentWalkSpeedNormalized);
    }
  }
}

function tick() {
  const now = performance.now();
  let dt = now - lastTime;
  if (document.hidden) {
    lastTime = now;
    window.requestAnimationFrame(tick);
    return;
  }
  if (dt > 50) {
    dt = 50;
  }
  dt /= 1000;

  State.realTime += dt;
  if (!State.zooming) {
    State.worldTime += dt;
  }

  if (dt > 0) {
    const fpsInstant = 1 / dt;
    fps = fps === 0 ? fpsInstant : fps * FPS_SMOOTHING + fpsInstant * (1 - FPS_SMOOTHING);
  }

  if (particleSystem) {
    particleSystem.update(dt, State.worldTime);
  }

  updateWalk(dt);

  render();
  updateHud();

  lastTime = now;
  window.requestAnimationFrame(tick);
}

function init() {
  loadHeroSprite();
  loadQuality();
  particleSystem = new ParticleSystem();
  resizeCanvas();
  applyQuality(State.quality);
  window.addEventListener('resize', () => {
    resizeCanvas();
  });

  canvas.addEventListener('contextmenu', handleContextMenu);
  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mouseup', handlePointerUp);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'q' || event.key === 'Q') {
      event.preventDefault();
      cycleQuality();
    } else if (event.key === 'm' || event.key === 'M') {
      event.preventDefault();
      AudioMix.toggleMute();
      console.log(`Audio mute: ${AudioMix.isMuted() ? 'on' : 'off'}`);
    }
  });

  AudioMix.loadAll()
    .then(() => {
      AudioMix.setWindFromSpeed(currentWalkSpeedNormalized);
      AudioMix.playWind(true);
    })
    .catch((err) => console.warn('Audio preload failed', err));
  AudioMix.setMuted(true);

  console.log('Snow-Field v0.1 loop ok');
  window.requestAnimationFrame((time) => {
    lastTime = time;
    tick();
  });
}

init();

export { State };
