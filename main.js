import { AudioMix } from './lib/audio.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

const State = {
  zooming: false,
  worldTime: 0,
  realTime: 0,
  quality: 'medium',
  rngSeed: 1337,
};

let dpr = window.devicePixelRatio || 1;
let lastTime = performance.now();

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const { innerWidth: width, innerHeight: height } = window;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

function drawHero(width, height) {
  const heroWidth = width * 0.12;
  const heroHeight = height * 0.25;
  const heroX = (width - heroWidth) / 2;
  const heroY = height - heroHeight - height * 0.05;
  const radius = Math.min(heroWidth, heroHeight) * 0.2;

  ctx.fillStyle = '#334866';
  ctx.beginPath();
  ctx.moveTo(heroX + radius, heroY);
  ctx.lineTo(heroX + heroWidth - radius, heroY);
  ctx.quadraticCurveTo(heroX + heroWidth, heroY, heroX + heroWidth, heroY + radius);
  ctx.lineTo(heroX + heroWidth, heroY + heroHeight - radius);
  ctx.quadraticCurveTo(heroX + heroWidth, heroY + heroHeight, heroX + heroWidth - radius, heroY + heroHeight);
  ctx.lineTo(heroX + radius, heroY + heroHeight);
  ctx.quadraticCurveTo(heroX, heroY + heroHeight, heroX, heroY + heroHeight - radius);
  ctx.lineTo(heroX, heroY + radius);
  ctx.quadraticCurveTo(heroX, heroY, heroX + radius, heroY);
  ctx.closePath();
  ctx.fill();

  const headRadius = heroWidth * 0.35;
  const headX = width / 2;
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
  drawHero(width, height);
  ctx.restore();
}

function tick() {
  const now = performance.now();
  let dt = now - lastTime;
  if (dt > 50) {
    dt = 50;
  }
  dt /= 1000;

  State.realTime += dt;
  if (!State.zooming) {
    State.worldTime += dt;
  }

  render();

  lastTime = now;
  window.requestAnimationFrame(tick);
}

function init() {
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
  });

  canvas.addEventListener('contextmenu', handleContextMenu);
  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mouseup', handlePointerUp);

  AudioMix.loadAll().catch((err) => console.warn('Audio preload failed', err));
  AudioMix.setMuted(true);

  console.log('Snow-Field v0.1 loop ok');
  window.requestAnimationFrame((time) => {
    lastTime = time;
    tick();
  });
}

init();

export { State };
