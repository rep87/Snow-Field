const AUDIO_PATHS = {
  step: 'audio/step.mp3',
  step_left: 'audio/step_left.mp3',
  step_right: 'audio/step_right.mp3',
  wind: 'audio/wind.mp3',
  blizzard: 'audio/blizzard.mp3',
  wolfDistant: 'audio/wolf-distant.mp3',
  zoomBreathShort: 'audio/zoom-breath-short.mp3',
  zoomBreathSoft: 'audio/zoom-breath-soft.mp3',
  indoorFire: 'audio/indoor-fire.mp3',
};

const cache = new Map();
const stepSides = { left: false, right: false };
let mutedState = true;
let mix = {
  wind: 1,
  env: 1,
  ui: 1,
};

function createAudio(path, key) {
  try {
    const audio = new Audio(path);
    audio.preload = 'auto';
    audio.loop = false;
    audio.volume = 0;
    audio._failed = false;
    audio.muted = mutedState;
    audio.addEventListener('canplaythrough', () => {
      audio.volume = mutedState ? 0 : 1;
      if (key === 'step_left') {
        stepSides.left = true;
      } else if (key === 'step_right') {
        stepSides.right = true;
      }
    }, { once: true });
    audio.addEventListener('error', (err) => {
      audio._failed = true;
      if (key === 'step_left') {
        stepSides.left = false;
      } else if (key === 'step_right') {
        stepSides.right = false;
      }
      console.warn('Audio load failed:', key ?? path, err);
    });
    return audio;
  } catch (err) {
    console.warn('Audio load skipped:', path, err);
    return null;
  }
}

function getGainKey(key) {
  if (key === 'wind' || key === 'blizzard') {
    return 'wind';
  }
  if (key === 'step' || key === 'step_left' || key === 'step_right' || key.startsWith('zoom')) {
    return 'ui';
  }
  return 'env';
}

function isPlayable(audio) {
  return Boolean(audio) && !audio._failed;
}

function applyMixToAudio(audio, key) {
  if (!audio) {
    return;
  }
  const gainKey = getGainKey(key);
  const baseVolume = mix[gainKey] ?? 1;
  audio.volume = mutedState ? 0 : baseVolume;
}

function playCached(key, { loop = false, gainKey } = {}) {
  const audio = cache.get(key);
  if (!isPlayable(audio)) {
    return false;
  }
  try {
    audio.loop = loop;
    audio.currentTime = 0;
    applyMixToAudio(audio, key);
    audio.play().catch((err) => {
      if (err && err.name !== 'NotAllowedError') {
        console.warn('Audio playback issue:', key, err);
      }
    });
    return true;
  } catch (err) {
    console.warn('Audio play skipped:', key, err);
    return false;
  }
}

function updateAllVolumes() {
  cache.forEach((audio, key) => {
    if (!audio) {
      return;
    }
    audio.muted = mutedState;
    applyMixToAudio(audio, key);
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export const AudioMix = {
  async loadAll() {
    cache.clear();
    stepSides.left = false;
    stepSides.right = false;
    Object.entries(AUDIO_PATHS).forEach(([key, path]) => {
      try {
        const audio = createAudio(path, key);
        if (audio) {
          cache.set(key, audio);
        }
      } catch (err) {
        console.warn('Audio create failed:', key, err);
      }
    });
    updateAllVolumes();
    return Promise.resolve();
  },
  playStep(side) {
    if (side === 'left' && stepSides.left) {
      if (playCached('step_left', { gainKey: 'ui' })) {
        return;
      }
    } else if (side === 'right' && stepSides.right) {
      if (playCached('step_right', { gainKey: 'ui' })) {
        return;
      }
    }
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
    mutedState = Boolean(muted);
    updateAllVolumes();
  },
  setMix(newMix) {
    mix = { ...mix, ...newMix };
    updateAllVolumes();
  },
  hasDirectionalSteps() {
    return stepSides.left && stepSides.right;
  },
  toggleMute() {
    this.setMuted(!mutedState);
  },
  isMuted() {
    return mutedState;
  },
  setWindFromSpeed(speedNormalized = 1) {
    const target = clamp(0.45 + speedNormalized * 0.22, 0.2, 1);
    mix = { ...mix, wind: target };
    updateAllVolumes();
  },
};

export default AudioMix;
