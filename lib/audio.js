const AUDIO_PATHS = {
  step: 'audio/step.mp3',
  wind: 'audio/wind.mp3',
  blizzard: 'audio/blizzard.mp3',
  wolfDistant: 'audio/wolf-distant.mp3',
  zoomBreathShort: 'audio/zoom-breath-short.mp3',
  zoomBreathSoft: 'audio/zoom-breath-soft.mp3',
  indoorFire: 'audio/indoor-fire.mp3',
};

const cache = new Map();
let isMuted = true;
let mix = {
  wind: 1,
  env: 1,
  ui: 1,
};

function createAudio(path) {
  try {
    const audio = new Audio(path);
    audio.preload = 'auto';
    audio.loop = false;
    audio.volume = 0;
    audio.addEventListener('canplaythrough', () => {
      audio.volume = isMuted ? 0 : 1;
    }, { once: true });
    return audio;
  } catch (err) {
    console.warn('Audio load skipped:', path, err);
    return null;
  }
}

function playCached(key, { loop = false, gainKey = 'env' } = {}) {
  const audio = cache.get(key);
  if (!audio) {
    return;
  }
  try {
    audio.loop = loop;
    audio.currentTime = 0;
    const baseVolume = mix[gainKey] ?? 1;
    audio.volume = isMuted ? 0 : baseVolume;
    audio.play().catch((err) => {
      if (err && err.name !== 'NotAllowedError') {
        console.warn('Audio playback issue:', key, err);
      }
    });
  } catch (err) {
    console.warn('Audio play skipped:', key, err);
  }
}

export const AudioMix = {
  async loadAll() {
    Object.entries(AUDIO_PATHS).forEach(([key, path]) => {
      try {
        const audio = createAudio(path);
        if (audio) {
          cache.set(key, audio);
        }
      } catch (err) {
        console.warn('Audio create failed:', key, err);
      }
    });
    return Promise.resolve();
  },
  playStep() {
    playCached('step', { gainKey: 'ui' });
  },
  playWind(loop = true) {
    playCached('wind', { loop, gainKey: 'wind' });
  },
  playBlizzard(loop = true) {
    playCached('blizzard', { loop, gainKey: 'wind' });
  },
  playWolfDistant() {
    playCached('wolfDistant', { gainKey: 'env' });
  },
  playZoomBreathShort() {
    playCached('zoomBreathShort', { gainKey: 'ui' });
  },
  playZoomBreathSoft() {
    playCached('zoomBreathSoft', { gainKey: 'ui' });
  },
  playIndoorFire(loop = true) {
    playCached('indoorFire', { loop, gainKey: 'env' });
  },
  setMuted(muted) {
    isMuted = Boolean(muted);
    cache.forEach((audio) => {
      if (!audio) return;
      audio.muted = isMuted;
      if (!isMuted) {
        const key = [...cache.entries()].find(([, value]) => value === audio)?.[0];
        const gainKey = (key === 'wind' || key === 'blizzard') ? 'wind' : (key === 'step' || key.startsWith('zoom')) ? 'ui' : 'env';
        audio.volume = mix[gainKey] ?? 1;
      }
    });
  },
  setMix(newMix) {
    mix = { ...mix, ...newMix };
    cache.forEach((audio, key) => {
      if (!audio || audio.muted) return;
      const gainKey = (key === 'wind' || key === 'blizzard') ? 'wind' : (key === 'step' || key.startsWith('zoom')) ? 'ui' : 'env';
      audio.volume = isMuted ? 0 : (mix[gainKey] ?? 1);
    });
  },
};

export default AudioMix;
