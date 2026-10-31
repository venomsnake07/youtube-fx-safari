/* Timestamped PCM ring buffer. All storage is allocated once. Audio rendering
 * neither creates source nodes nor depends on a page timer firing on time. */
(() => {
  'use strict';
  class PCMTimeline {
    constructor(sampleRate = 48000, capacity = 1 << 19, table = globalThis.YouTubeFXDSP.resamplerTable()) {
      this.sampleRate = sampleRate; this.sourceRate = sampleRate; this.capacity = capacity; this.mask = (capacity & (capacity - 1)) === 0 ? capacity - 1 : -1; this.table = table;
      this.resampler = globalThis.YouTubeFXDSP.resampler;
      this.left = new Float32Array(capacity); this.right = new Float32Array(capacity);
      this.tags = new Float64Array(capacity); this.tags.fill(-Infinity);
      this.last = new Float64Array(2); this.reset();
    }
    reset(mediaTime) {
      this.tags.fill(-Infinity); this.playing = false; this.started = false;
      this.renderStarted = false;
      this.anchorSet = Number.isFinite(mediaTime);
      this.readFrame = this.anchorSet ? Math.round(mediaTime * this.sourceRate) : 0; this.startAt = 0; this.currentRate = 1; this.targetRate = 1;
      this.last.fill(0); this.fade = 0; this.maximumFrame = -Infinity;
      this.rendered = 0; this.underrunFrames = 0; this.underruns = 0;
      this.duplicates = 0; this.lateFrames = 0; this.overflows = 0; this.missing = false;
      this.sourceChannels = 0;
      this.ranges = [];
    }
    addRange(start, end) {
      const oldest = this.maximumFrame - this.capacity + 1, merged = [];
      start = Math.max(start, oldest);
      for (const range of this.ranges) {
        if (range[1] <= oldest) continue;
        const a = Math.max(oldest, range[0]), b = range[1];
        if (b < start) merged.push([a, b]);
        else if (a > end) {merged.push([start, end]); start = a; end = b;}
        else {start = Math.min(start, a); end = Math.max(end, b);}
      }
      merged.push([start, end]); this.ranges = merged;
    }
    enqueue(startTime, planes, sourceRate = this.sampleRate) {
      if (!planes?.[0]?.length || !Number.isFinite(startTime) || !Number.isFinite(sourceRate) || sourceRate <= 0) return;
      // Store samples on their ORIGINAL clock grid. Resampling entire continuous
      // audio at render time avoids the per-packet edge filters and treble loss
      // that linear interpolation caused at 44.1 -> 48 kHz and during drift.
      if (sourceRate !== this.sourceRate) {
        const anchor = this.anchorSet ? this.readFrame / this.sourceRate : undefined;
        if (this.maximumFrame !== -Infinity) this.reset(anchor);
        this.sourceRate = sourceRate;
        if (this.anchorSet) this.readFrame = Math.round(anchor * sourceRate);
      }
      const source = planes[0], stereo = planes[1] || source;
      this.sourceChannels = Math.min(2, planes.length);
      const beginFrame = Math.round(startTime * sourceRate), endFrame = beginFrame + source.length;
      if (!this.anchorSet) {this.readFrame = beginFrame; this.anchorSet = true;}
      const minimum = this.started ? Math.floor(this.readFrame) - 2 : Math.floor(this.readFrame) - Math.min(this.capacity / 3, sourceRate * 6);
      const maximum = Math.floor(this.readFrame) + this.capacity - 2;
      let writtenStart = Infinity, writtenEnd = -Infinity;
      for (let frame = beginFrame; frame < endFrame; frame++) {
        if (frame < minimum) {this.lateFrames++; continue;}
        if (frame >= maximum) {this.overflows++; continue;}
        const index = ((frame % this.capacity) + this.capacity) % this.capacity;
        if (this.tags[index] === frame) {this.duplicates++; continue;}
        const a = frame - beginFrame, l = source[a], r = stereo[a];
        this.left[index] = Number.isFinite(l) ? l : 0; this.right[index] = Number.isFinite(r) ? r : 0;
        this.tags[index] = frame; this.maximumFrame = Math.max(this.maximumFrame, frame);
        writtenStart = Math.min(writtenStart, frame); writtenEnd = Math.max(writtenEnd, frame + 1);
      }
      if (writtenEnd > writtenStart) this.addRange(writtenStart, writtenEnd);
    }
    play(mediaTime, contextFrame) {
      this.readFrame = Math.round(mediaTime * this.sourceRate); this.startAt = Math.round(contextFrame);
      this.anchorSet = true;
      this.playing = true; this.started = true; this.fade = 0; this.missing = false;
      this.renderStarted = false;
    }
    pause() {this.playing = false;}
    setRate(value) {this.targetRate = Math.max(0.998, Math.min(1.002, value));}
    render(outputs, contextFrame) {
      const frames = outputs[0]?.length || 0;
      this.contextFrame = contextFrame + frames;
      const ratio = this.sourceRate / this.sampleRate, config = this.resampler, table = this.table;
      const cutoff = config.maximumCutoff / Math.max(1, ratio * 1.002);
      const filter = Math.max(0, Math.min(config.cutoffs - 1e-8, (cutoff - config.minimumCutoff) / (config.maximumCutoff - config.minimumCutoff) * config.cutoffs));
      const bank = Math.floor(filter), bankMix = filter - bank;
      for (let i = 0; i < frames; i++) {
        if (!this.playing || contextFrame + i < this.startAt) {
          this.last[0] *= 0.94; this.last[1] *= 0.94;
          if (outputs[0]) outputs[0][i] = this.last[0]; if (outputs[1]) outputs[1][i] = this.last[1];
          continue;
        }
        if (!this.renderStarted) {this.readFrame += Math.max(0, contextFrame + i - this.startAt) * ratio; this.renderStarted = true;}
        this.currentRate += (this.targetRate - this.currentRate) * 0.00002;
        const frame = Math.floor(this.readFrame), fraction = this.readFrame - frame;
        const a = this.mask >= 0 ? frame & this.mask : ((frame % this.capacity) + this.capacity) % this.capacity;
        const valid = this.tags[a] === frame;
        if (valid) {
          if (this.missing) this.fade = 0;
          this.missing = false; this.fade = Math.min(1, this.fade + 1 / 128);
          let l = this.left[a], r = this.right[a];
          if (ratio !== 1 || this.currentRate !== 1 || fraction !== 0) {
            const phase = fraction * config.phases, phaseIndex = Math.min(config.phases - 1, Math.floor(phase)), phaseMix = phase - phaseIndex;
            const low = bank * config.cutoffStride + phaseIndex * config.phaseStride, high = low + config.cutoffStride;
            const start = frame - config.radius + 1;
            l = 0; r = 0;
            for (let tap = 0; tap < config.taps; tap++) {
              const coefficientLow = table[low + tap] + (table[low + config.phaseStride + tap] - table[low + tap]) * phaseMix;
              const coefficientHigh = table[high + tap] + (table[high + config.phaseStride + tap] - table[high + tap]) * phaseMix;
              const coefficient = coefficientLow + (coefficientHigh - coefficientLow) * bankMix;
              const absolute = start + tap, index = this.mask >= 0 ? absolute & this.mask : ((absolute % this.capacity) + this.capacity) % this.capacity;
              if (this.tags[index] === absolute) {l += this.left[index] * coefficient; r += this.right[index] * coefficient;}
            }
          }
          this.last[0] = l * this.fade; this.last[1] = r * this.fade;
        } else {
          if (!this.missing) this.underruns++;
          this.missing = true; this.underrunFrames++;
          this.last[0] *= 0.98; this.last[1] *= 0.98;
        }
        if (outputs[0]) outputs[0][i] = this.last[0]; if (outputs[1]) outputs[1][i] = this.last[1];
        this.readFrame += ratio * this.currentRate; this.rendered++;
      }
    }
    stats() {
      const range = this.ranges.find(range => this.readFrame >= range[0] - 0.5 && this.readFrame < range[1]);
      return {mediaTime: this.readFrame / this.sourceRate, renderedFrames: this.rendered,
        contextTime: (this.contextFrame || 0) / this.sampleRate,
        bufferedMs: range ? Math.max(0, Math.min(this.capacity, range[1] - this.readFrame) / this.sourceRate * 1000) : 0,
        capacityMs: this.capacity / this.sourceRate * 1000,
        cachedMs: Math.min(this.capacity, this.ranges.reduce((sum, range) => sum + range[1] - range[0], 0)) / this.sourceRate * 1000,
        sourceSampleRate: this.sourceRate, sourceChannels: this.sourceChannels, interpolation: '96-tap sinc',
        underruns: this.underruns, underrunFrames: this.underrunFrames,
        duplicateFrames: this.duplicates, lateFrames: this.lateFrames, overflowFrames: this.overflows,
        rate: this.currentRate, playing: this.playing};
    }
  }
  class DecodedTimeline {
    constructor() {this.reset();}
    reset() {this.end = null; this.rawTime = null; this.lastFrames = 0; this.adjustments = 0; this.duplicates = 0; this.gapFrames = 0;}
    append(start, planes, sampleRate) {
      let length = planes[0].length;
      if (this.rawTime !== null && Math.abs(start - this.rawTime) < 0.5 / sampleRate && length === this.lastFrames) {this.duplicates++; return null;}
      this.rawTime = start; this.lastFrames = length;
      if (this.end !== null) {
        const gap = start - this.end;
        if (Math.abs(gap) <= 0.008) {if (Math.abs(gap) > 0.5 / sampleRate) this.adjustments++; start = this.end;}
        else if (gap < 0) {
          const trim = Math.round(-gap * sampleRate);
          if (trim >= length) {this.duplicates++; return null;}
          planes = planes.map(plane => plane.subarray(trim)); length -= trim; start = this.end; this.adjustments++;
        } else this.gapFrames += Math.round(gap * sampleRate);
      }
      const end = start + length / sampleRate; this.end = end;
      return {start, end, planes, sampleRate};
    }
  }
  globalThis.YouTubeFXPCM = Object.freeze({PCMTimeline, DecodedTimeline});
})();
