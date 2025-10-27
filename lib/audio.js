let muted = true;
let mix = { wind: 1, env: 1, ui: 1 };

const noop = () => {};

const AudioMix = {
  async loadAll() {},
  playStep() {},
  playWind() {},
  playBlizzard() {},
  playWolfDistant() {},
  playZoomBreathShort() {},
  playZoomBreathSoft() {},
  playIndoorFire() {},
  playReindeerPass() {},
  playCupClink() {},
  setMuted(value) {
    muted = Boolean(value);
  },
  setMix(value = {}) {
    mix = { ...mix, ...value };
  },
  stopZoomBreath: noop,
  hasDirectionalSteps() {
    return false;
  },
  toggleMute() {
    this.setMuted(!muted);
  },
  isMuted() {
    return muted;
  },
  setWindFromSpeed: noop,
};

export default AudioMix;
