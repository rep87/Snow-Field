let muted = true;
let mix = { wind: 1, env: 1, ui: 1 };

function noop() {}

export const AudioMix = {
  async loadAll() {
    return Promise.resolve();
  },
  playStep() {
    noop();
  },
  playWind() {
    noop();
  },
  playBlizzard() {
    noop();
  },
  playWolfDistant() {
    noop();
  },
  playZoomBreathShort() {
    noop();
  },
  playZoomBreathSoft() {
    noop();
  },
  stopZoomBreath() {
    noop();
  },
  playIndoorFire() {
    noop();
  },
  setMuted(value) {
    muted = Boolean(value);
  },
  setMix(value) {
    mix = { ...mix, ...value };
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
  setWindFromSpeed() {
    noop();
  },
};

export default AudioMix;
