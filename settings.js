/* Shared, strictly validated settings. No network access. */
(() => {
  'use strict';
  const DEFAULTS = Object.freeze({enabled: false, rate: 100, linked: true, semitones: 0, cents: 0, reverb: 25, decay: 2.8, volume: 100});
  const PRESETS = Object.freeze({
    'Piano hall': {rate: 100, linked: true, semitones: 0, cents: 0, reverb: 28, decay: 3.2},
    'Warm room': {rate: 100, linked: true, semitones: 0, cents: 0, reverb: 16, decay: 1.1},
    'Dreamy': {rate: 89, linked: true, semitones: 0, cents: 0, reverb: 44, decay: 4.8}
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
      rate: Math.round(bounded(raw.rate, 50, 200, 100) * 100) / 100,
      // Preserve old saved pitch-only settings at their original speed.
      linked: typeof raw.linked === 'boolean' ? raw.linked : !(Number(raw.semitones) || Number(raw.cents)),
      semitones: Math.round(bounded(raw.semitones, -12, 12, 0)),
      cents: Math.round(bounded(raw.cents, -50, 50, 0)),
      reverb: Math.round(bounded(raw.reverb, 0, 100, 25)),
      decay: Math.round(bounded(raw.decay, 0.4, 6, 2.8) * 10) / 10,
      volume: Math.round(bounded(raw.volume, 0, 100, 100))
    };
  }
  function patch(settings, changes = {}) {
    if (!changes || typeof changes !== 'object') return normalize(settings);
    const next = {...settings, ...changes};
    // Legacy messages which explicitly request a pitch still mean pitch-only.
    if (!Object.hasOwn(changes, 'linked') && (Object.hasOwn(changes, 'semitones') || Object.hasOwn(changes, 'cents'))) next.linked = false;
    return normalize(next);
  }
  const naturalPitch = rate => 12 * Math.log2(rate / 100);
  const correctionPitch = settings => {
    const pitch = settings.linked ? 0 : settings.semitones + settings.cents / 100 - naturalPitch(settings.rate);
    // Unlinking rounds the visible pitch to a cent. Do not start a spectral
    // processor merely to correct this inaudible half-cent rounding residue.
    return Math.abs(pitch) < 0.005 ? 0 : pitch;
  };
  const isYouTube = url => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && ['www.youtube.com', 'youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(parsed.hostname);
    } catch { return false; }
  };
  globalThis.YouTubeFXSettings = Object.freeze({VERSION: '1.5.0', DEFAULTS, PRESETS, KEY, normalize, patch, naturalPitch, correctionPitch, isYouTube});
})();
