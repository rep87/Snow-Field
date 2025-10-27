const AudioContextClass = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
const canUseAudio = Boolean(AudioContextClass);

const SOUND_DEFS = {
  step: { url: new URL('../audio/step_generic.mp3', import.meta.url).href, group: 'env' },
  wind: { url: new URL('../audio/wind_loop.mp3', import.meta.url).href, group: 'wind', loop: true },
  blizzard: { url: new URL('../audio/blizzard_loop.mp3', import.meta.url).href, group: 'wind', loop: true },
  wolf_distant: { url: new URL('../audio/wolf_distant.mp3', import.meta.url).href, group: 'env' },
  zoom_breath_short: { url: new URL('../audio/zoom_breath_short.mp3', import.meta.url).href, group: 'env' },
  zoom_breath_soft: { url: new URL('../audio/zoom_breath_soft.mp3', import.meta.url).href, group: 'env' },
  indoor_fire: { url: new URL('../audio/indoor_fire_loop.mp3', import.meta.url).href, group: 'env', loop: true },
  reindeer_pass: { url: new URL('../audio/step_generic.mp3', import.meta.url).href, group: 'env' },
};

const defaultMix = { wind: 0.6, env: 0.25, ui: 0.15 };

let audioContext = null;
let masterGain = null;
const groupNodes = new Map();
const buffers = new Map();
const bufferPromises = new Map();
const loopPlayers = new Map();
const zoomSources = new Set();
let muted = true;
let mix = { ...defaultMix };

function ensureContext() {
  if (!canUseAudio) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioContextClass();
    setupGraph(audioContext);
  }
  return audioContext;
}

function setupGraph(ctx) {
  if (masterGain) {
    return;
  }
  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : 1;
  masterGain.connect(ctx.destination);
  Object.keys(defaultMix).forEach((group) => {
    const node = ctx.createGain();
    node.gain.value = mix[group] ?? defaultMix[group] ?? 1;
    node.connect(masterGain);
    groupNodes.set(group, node);
  });
}

function getGroupNode(group) {
  const ctx = ensureContext();
  if (!ctx) {
    return null;
  }
  setupGraph(ctx);
  return groupNodes.get(group) || masterGain;
}

async function resumeContext() {
  if (!audioContext) {
    return;
  }
  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume();
    } catch (error) {
      // Ignore resume errors (e.g. user gesture not yet received)
    }
  }
}

function loadBuffer(key) {
  if (!canUseAudio) {
    return Promise.resolve(null);
  }
  if (buffers.has(key)) {
    return Promise.resolve(buffers.get(key));
  }
  if (bufferPromises.has(key)) {
    return bufferPromises.get(key);
  }
  const config = SOUND_DEFS[key];
  if (!config) {
    return Promise.resolve(null);
  }
  const ctx = ensureContext();
  if (!ctx) {
    return Promise.resolve(null);
  }
  const promise = fetch(config.url)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error('Failed to load audio'))))
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      buffers.set(key, buffer);
      bufferPromises.delete(key);
      return buffer;
    })
    .catch((error) => {
      bufferPromises.delete(key);
      console.warn('[AudioMix] Could not load sound', key, error);
      return null;
    });
  bufferPromises.set(key, promise);
  return promise;
}

function rampGain(gainNode, value, fade = 0.35) {
  const ctx = ensureContext();
  if (!ctx || !gainNode) {
    return;
  }
  const now = ctx.currentTime;
  try {
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(value, now + Math.max(0.01, fade));
  } catch (error) {
    gainNode.gain.value = value;
  }
}

function startLoop(key, options = {}) {
  const config = SOUND_DEFS[key];
  if (!config) {
    return;
  }
  loadBuffer(key).then((buffer) => {
    if (!buffer) {
      return;
    }
    const ctx = ensureContext();
    if (!ctx) {
      return;
    }
    resumeContext();
    let player = loopPlayers.get(key);
    if (!player) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0;
      const groupNode = getGroupNode(config.group);
      if (!groupNode) {
        return;
      }
      source.connect(gainNode);
      gainNode.connect(groupNode);
      source.start(0);
      player = { source, gainNode };
      loopPlayers.set(key, player);
      source.onended = () => {
        if (loopPlayers.get(key)?.source === source) {
          loopPlayers.delete(key);
        }
      };
    }
    const gain = typeof options.gain === 'number' ? options.gain : 1;
    rampGain(player.gainNode, gain, typeof options.fade === 'number' ? options.fade : 0.35);
  });
}

function playOneShot(key, options = {}, tracker) {
  const config = SOUND_DEFS[key];
  if (!config) {
    return;
  }
  loadBuffer(key).then((buffer) => {
    if (!buffer) {
      return;
    }
    const ctx = ensureContext();
    if (!ctx) {
      return;
    }
    resumeContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (typeof options.rate === 'number') {
      source.playbackRate.value = options.rate;
    }
    const gainNode = ctx.createGain();
    gainNode.gain.value = typeof options.gain === 'number' ? options.gain : 1;
    const groupNode = getGroupNode(config.group);
    if (!groupNode) {
      return;
    }
    source.connect(gainNode);
    gainNode.connect(groupNode);
    if (tracker) {
      tracker.add(source);
      const cleanup = () => {
        tracker.delete(source);
      };
      source.addEventListener('ended', cleanup, { once: true });
    }
    source.start();
  });
}

function stopTrackedSources(tracker) {
  tracker.forEach((source) => {
    try {
      source.stop();
    } catch (error) {
      // ignore
    }
  });
  tracker.clear();
}

function updateMasterGain() {
  if (!masterGain) {
    return;
  }
  const target = muted ? 0 : 1;
  rampGain(masterGain, target, 0.1);
}

function updateMixGains() {
  if (!masterGain) {
    return;
  }
  const ctx = audioContext;
  const now = ctx ? ctx.currentTime : 0;
  groupNodes.forEach((node, group) => {
    const value = mix[group] ?? defaultMix[group] ?? 1;
    try {
      if (ctx) {
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.linearRampToValueAtTime(value, now + 0.12);
      } else {
        node.gain.value = value;
      }
    } catch (error) {
      node.gain.value = value;
    }
  });
}

const AudioMix = {
  async loadAll() {
    if (!canUseAudio) {
      return;
    }
    const ctx = ensureContext();
    if (!ctx) {
      return;
    }
    await Promise.all(Object.keys(SOUND_DEFS).map((key) => loadBuffer(key)));
  },
  playStep(options = {}) {
    playOneShot('step', options);
  },
  playWind(options = {}) {
    startLoop('wind', options);
  },
  playBlizzard(options = {}) {
    startLoop('blizzard', options);
  },
  playWolfDistant(options = {}) {
    playOneShot('wolf_distant', options);
  },
  playZoomBreathShort(options = {}) {
    playOneShot('zoom_breath_short', options, zoomSources);
  },
  playZoomBreathSoft(options = {}) {
    playOneShot('zoom_breath_soft', options, zoomSources);
  },
  playIndoorFire(options = {}) {
    startLoop('indoor_fire', options);
  },
  playReindeerPass(options = {}) {
    playOneShot('reindeer_pass', options);
  },
  playReindeer(options = {}) {
    this.playReindeerPass(options);
  },
  playCupClink(options = {}) {
    playOneShot('cup_clink', options);
  },
  stopZoomBreath() {
    stopTrackedSources(zoomSources);
  },
  setMuted(value) {
    muted = Boolean(value);
    if (canUseAudio) {
      ensureContext();
      updateMasterGain();
    }
  },
  setMix(value = {}) {
    mix = { ...mix, ...value };
    updateMixGains();
  },
  hasDirectionalSteps() {
    return false;
  },
  toggleMute() {
    this.setMuted(!muted);
  },
  isMuted() {
    return muted;
  },
  setWindFromSpeed(speed) {
    if (typeof speed !== 'number') {
      return;
    }
    const gain = Math.min(1.2, Math.max(0.1, speed / 12));
    this.playWind({ gain });
  },
};

AudioMix.setMix(defaultMix);

export default AudioMix;
