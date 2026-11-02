/* Stereo time stretching plus band-limited pitch resampling. One two-channel
 * Signalsmith engine keeps inter-channel phase, while a 96-tap sinc resampler
 * sets pitch accurately without rounding spectral bins or changing duration.
 * All working buffers are allocated before audio processing.
 * See THIRD-PARTY-NOTICES.md for the kernel's MIT license and provenance.
 */
(() => {
  'use strict';
  const TAPS = 96, RADIUS = TAPS / 2, PHASES = 256, CUTOFFS = 64;
  const MIN_CUTOFF = 0.20, MAX_CUTOFF = 0.95;
  const PHASE_STRIDE = TAPS, CUTOFF_STRIDE = (PHASES + 1) * TAPS;
  let sharedTable;
  function resamplerTable() {
    if (sharedTable) return sharedTable;
    const table = new Float32Array((CUTOFFS + 1) * CUTOFF_STRIDE);
    for (let bank = 0; bank <= CUTOFFS; bank++) {
      const cutoff = MIN_CUTOFF + (MAX_CUTOFF - MIN_CUTOFF) * bank / CUTOFFS;
      for (let phase = 0; phase <= PHASES; phase++) {
        const offset = bank * CUTOFF_STRIDE + phase * PHASE_STRIDE;
        let sum = 0;
        for (let tap = 0; tap < TAPS; tap++) {
          const distance = tap - RADIUS + 1 - phase / PHASES, x = distance * cutoff;
          const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
          const u = distance / RADIUS;
          const window = Math.abs(u) > 1 ? 0 : 0.35875 + 0.48829 * Math.cos(Math.PI * u)
            + 0.14128 * Math.cos(2 * Math.PI * u) + 0.01168 * Math.cos(3 * Math.PI * u);
          const value = sinc * window; table[offset + tap] = value; sum += value;
        }
        for (let tap = 0; tap < TAPS; tap++) table[offset + tap] /= sum;
      }
    }
    sharedTable = table; return table;
  }
  class StereoPitch {
    constructor(sampleRate = 48000, table = resamplerTable(), extended = false) {
      this.sampleRate = sampleRate; this.table = table;
      this.kernel = globalThis.YouTubeFXPitchKernel.create(); this.api = this.kernel.api;
      // The high quality time-stretch configuration. Split computation spreads
      // spectral work across render calls rather than one large FFT burst.
      this.api.configure(2, Math.round(sampleRate * 0.24), Math.round(sampleRate * (extended ? 0.03 : 0.06)), 1);
      this.api.reset(); this.api.setTransposeSemitones(0, 0);
      this.capacity = 2048; this.pointer = this.api.setBuffers(2, this.capacity);
      this.inputLatency = this.api.inputLatency(); this.outputLatency = this.api.outputLatency();
      this.views = new Array(4); this.updateViews();
      this.ringSize = 4096; this.mask = this.ringSize - 1;
      this.left = new Float32Array(this.ringSize); this.right = new Float32Array(this.ringSize);
      this.smoothing = 1 - Math.exp(-128 / (sampleRate * 0.025));
      // Preallocate a denser-overlap engine for extreme independent ratios.
      // Ordinary shifts retain the established chord/transient behaviour.
      // No engine construction or FFT reconfiguration occurs in process().
      this.extended = extended ? null : new StereoPitch(sampleRate, table, true);
      this.reset();
    }
    updateViews() {
      this.memoryBuffer = this.kernel.memory.buffer;
      for (let c = 0; c < 4; c++) this.views[c] = new Float32Array(this.memoryBuffer, this.pointer + c * this.capacity * 4, this.capacity);
    }
    reset() {
      this.api.reset(); this.pitch = NaN; this.targetPitch = NaN;
      this.left.fill(0); this.right.fill(0);
      this.generated = 0; this.fraction = 0; this.position = -RADIUS;
      this.usingExtended = false; this.extended?.reset();
    }
    process(inputs, outputs, semitones) {
      const left = inputs?.[0], right = inputs?.[1] || left;
      const frames = outputs[0].length;
      const target = Number.isFinite(semitones) ? Math.max(-24.5, Math.min(24.5, semitones)) : 0;
      if (this.extended && Math.abs(target) > 12.5) {
        if (!this.usingExtended) this.extended.reset();
        this.usingExtended = true; this.targetPitch = target;
        this.extended.process(inputs, outputs, target); return;
      }
      if (this.usingExtended) this.reset();
      if (!Number.isFinite(this.pitch)) this.pitch = target;
      this.targetPitch = target;
      const table = this.table, mask = this.mask;
      for (let offset = 0; offset < frames; offset += 128) {
        const count = Math.min(128, frames - offset);
        if (this.kernel.memory.buffer !== this.memoryBuffer) this.updateViews();
        const inputLeft = this.views[0], inputRight = this.views[1];
        for (let i = 0; i < count; i++) {
          const l = left?.[offset + i], r = right?.[offset + i];
          inputLeft[i] = Number.isFinite(l) ? l : 0; inputRight[i] = Number.isFinite(r) ? r : 0;
        }
        this.pitch += (target - this.pitch) * this.smoothing;
        if (Math.abs(target - this.pitch) < 0.00001) this.pitch = target;
        const ratio = Math.pow(2, this.pitch / 12);
        this.fraction += count * ratio;
        const intermediate = Math.floor(this.fraction); this.fraction -= intermediate;
        // First change duration at unchanged pitch; resampling then changes
        // pitch and restores exactly the original input/output sample count.
        this.api.process(count, intermediate);
        if (this.kernel.memory.buffer !== this.memoryBuffer) this.updateViews();
        for (let i = 0; i < intermediate; i++) {
          const index = this.generated++ & mask;
          this.left[index] = this.views[2][i]; this.right[index] = this.views[3][i];
        }
        // Cutoff follows upward transposition to prevent aliasing. Downward
        // shifts retain the full source bandwidth. Adjacent filter/phase tables
        // are interpolated so slider changes cannot step the filter abruptly.
        const cutoff = MAX_CUTOFF / Math.max(1, ratio);
        const filter = Math.max(0, Math.min(CUTOFFS - 1e-8, (cutoff - MIN_CUTOFF) / (MAX_CUTOFF - MIN_CUTOFF) * CUTOFFS));
        const bank = Math.floor(filter), bankMix = filter - bank;
        for (let i = 0; i < count; i++) {
          const center = Math.floor(this.position), phase = (this.position - center) * PHASES;
          const phaseIndex = Math.min(PHASES - 1, Math.floor(phase)), phaseMix = phase - phaseIndex;
          const a = bank * CUTOFF_STRIDE + phaseIndex * PHASE_STRIDE, b = a + CUTOFF_STRIDE;
          const start = center - RADIUS + 1;
          let l = 0, r = 0;
          for (let tap = 0; tap < TAPS; tap++) {
            const low = table[a + tap] + (table[a + PHASE_STRIDE + tap] - table[a + tap]) * phaseMix;
            const high = table[b + tap] + (table[b + PHASE_STRIDE + tap] - table[b + tap]) * phaseMix;
            const coefficient = low + (high - low) * bankMix, index = (start + tap) & mask;
            l += this.left[index] * coefficient; r += this.right[index] * coefficient;
          }
          if (outputs[0]) outputs[0][offset + i] = Number.isFinite(l) ? l : 0;
          if (outputs[1]) outputs[1][offset + i] = Number.isFinite(r) ? r : 0;
          this.position += ratio;
        }
      }
    }
    info() {
      const pitch = Number.isFinite(this.targetPitch) ? this.targetPitch : 0;
      const latency = this.inputLatency + (this.outputLatency + RADIUS) / Math.pow(2, pitch / 12);
      return {algorithm: 'Signalsmith Stretch', version: '1.3.2', method: 'stereo stretch + 96-tap sinc', stereo: 'phase-linked',
        channels: 2, sampleRate: this.sampleRate, sampleFormat: 'float32',
        inputLatencySamples: this.inputLatency, outputLatencySamples: this.outputLatency, resamplerRadius: RADIUS,
        extendedOutputLatencySamples: this.extended?.outputLatency ?? this.outputLatency,
        latencySamples: Math.ceil(latency), latencyMs: latency / this.sampleRate * 1000};
    }
  }
  globalThis.YouTubeFXDSP = Object.freeze({StereoPitch, resamplerTable,
    resampler: Object.freeze({taps: TAPS, radius: RADIUS, phases: PHASES, cutoffs: CUTOFFS,
      minimumCutoff: MIN_CUTOFF, maximumCutoff: MAX_CUTOFF, phaseStride: PHASE_STRIDE, cutoffStride: CUTOFF_STRIDE})});
})();
