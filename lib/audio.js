export default (function () {
  const A = {
    muted: true,
    gains: { wind: 0.6, env: 0.25, ui: 0.15 },
    bank: {},
    has: {},
    async loadAll() {
      const names = [
        'wind_loop',
        'blizzard_loop',
        'step_generic',
        'wolf_distant',
        'zoom_breath_short',
        'zoom_breath_soft',
        'indoor_fire_loop',
        'reindeer_pass',
        'cup_clink',
      ];
      for (const n of names) {
        for (const ext of ['mp3', 'ogg']) {
          try {
            const url = `./audio/${n}.${ext}`;
            const a = new Audio();
            a.src = url;
            a.loop = /loop/.test(n);
            await a.play().catch(() => {});
            a.pause();
            a.currentTime = 0;
            A.bank[n] = a;
            A.has[n] = true;
            break;
          } catch (e) {
            // ignore
          }
        }
      }
      A.setMuted(true);
    },
    setMuted(b) {
      A.muted = !!b;
      for (const k in A.bank) {
        try {
          A.bank[k].muted = A.muted;
        } catch (_) {
          // ignore
        }
      }
    },
    toggleMuted() {
      A.setMuted(!A.muted);
      return A.muted;
    },
    isMuted() {
      return A.muted;
    },
    _play(name, group = 'env') {
      const a = A.bank[name];
      if (!a || A.muted) return;
      try {
        a.currentTime = 0;
        a.volume = group === 'wind' ? A.gains.wind : group === 'ui' ? A.gains.ui : A.gains.env;
        a.play().catch(() => {});
      } catch (_) {
        // ignore
      }
    },
    playWind(loop = true) {
      const a = A.bank['wind_loop'];
      if (!a || A.muted) return;
      a.loop = loop;
      a.volume = A.gains.wind;
      try {
        if (a.currentTime > a.duration - 0.05) {
          a.currentTime = 0;
        }
      } catch (_) {}
      a.play().catch(() => {});
    },
    playBlizzard(loop = true) {
      const a = A.bank['blizzard_loop'];
      if (!a || A.muted) return;
      a.loop = loop;
      a.volume = A.gains.wind;
      try {
        if (a.currentTime > a.duration - 0.05) {
          a.currentTime = 0;
        }
      } catch (_) {}
      a.play().catch(() => {});
    },
    playIndoorFire(loop = true) {
      const a = A.bank['indoor_fire_loop'];
      if (!a || A.muted) return;
      a.loop = loop;
      a.volume = A.gains.env;
      try {
        if (a.currentTime > a.duration - 0.05) {
          a.currentTime = 0;
        }
      } catch (_) {}
      a.play().catch(() => {});
    },
    playStep() {
      A._play('step_generic', 'ui');
    },
    playWolfDistant() {
      A._play('wolf_distant');
    },
    playZoomBreathShort() {
      A._play('zoom_breath_short');
    },
    playZoomBreathSoft() {
      A._play('zoom_breath_soft');
    },
    playReindeerPass() {
      A._play('reindeer_pass');
    },
    playCupClink() {
      A._play('cup_clink', 'ui');
    },
    setMix(m) {
      A.gains = { ...A.gains, ...m };
    },
  };
  return A;
})();
