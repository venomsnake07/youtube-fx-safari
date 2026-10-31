/* Shared, strictly validated settings. No network access. */
(() => {
  'use strict';
  const DEFAULTS = Object.freeze({enabled: false, semitones: 0, cents: 0, reverb: 25, decay: 2.8, volume: 100});
  const PRESETS = Object.freeze({
    'Piano hall': {semitones: 0, cents: 0, reverb: 28, decay: 3.2},
    'Warm room': {semitones: 0, cents: 0, reverb: 16, decay: 1.1},
    'Dreamy': {semitones: -2, cents: 0, reverb: 44, decay: 4.8}
  });
  const KEY = 'youtubeFX.settings.v1';
  const bounded = (value, low, high, fallback) => {
    const n = typeof value === 'number' ? value : NaN;
    return Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : fallback;
  };
  function normalize(raw = {}) {
    if (!raw || typeof raw !== 'object') raw = {};
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULTS.enabled,
      semitones: Math.round(bounded(raw.semitones, -12, 12, 0)),
      cents: Math.round(bounded(raw.cents, -50, 50, 0)),
      reverb: Math.round(bounded(raw.reverb, 0, 100, 25)),
      decay: Math.round(bounded(raw.decay, 0.4, 6, 2.8) * 10) / 10,
      volume: Math.round(bounded(raw.volume, 0, 100, 100))
    };
  }
  const isYouTube = url => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && ['www.youtube.com', 'youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(parsed.hostname);
    } catch { return false; }
  };
  globalThis.YouTubeFXSettings = Object.freeze({VERSION: '1.4.0', DEFAULTS, PRESETS, KEY, normalize, isYouTube});
})();
