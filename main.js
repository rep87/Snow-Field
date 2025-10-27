import './lib/perlin.js';
import './lib/audio.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
let dpr = window.devicePixelRatio || 1;

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function render() {
  ctx.fillStyle = '#eaf3fb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  window.requestAnimationFrame(render);
}

function init() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  console.log('Snow-Field boot ok');
  window.requestAnimationFrame(render);
}

if (canvas && ctx) {
  init();
}
