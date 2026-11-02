(() => {
  'use strict';
  const {normalize, DEFAULTS, correctionPitch} = globalThis.YouTubeFXSettings;
  class AudioEngine {
    constructor(resourceURL, onState = () => {}) {
      this.resourceURL = resourceURL; this.onState = onState;
      this.settings = {...DEFAULTS}; this.sources = new WeakMap(); this.activeSources = new Map();
      this.context = null; this.ready = false; this.pending = null;
      this.backend = ''; this.error = ''; this.supportedPage = true;
      this.pitchActive = false; this.pitchReadyAt = 0; this.pitchInfo = null; this.fatal = false;
      this.inputPeak = 0; this.outputPeak = 0; this.lastSignalAt = -Infinity;
      this.inputChannelPeaks = [0, 0]; this.outputChannelPeaks = [0, 0];
      this.monitoringSince = null; this.clockNow = () => Date.now();
      this.workletTimeout = 1800; this.resumeTimeout = 1600;
      this.contextTransitions = [];
    }
    report() { this.onState(); }
    async start() {
      if (this.fatal) throw new Error(this.error);
      // resume() is deliberately called before any await, inside a page gesture.
      if (!this.context) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) throw new Error('This Safari version does not support Web Audio.');
        this.context = new Context({latencyHint: 'playback', sampleRate: 48000});
        this.context.addEventListener('statechange', () => {
          this.contextTransitions.push({state: this.context.state, clock: Math.round(this.context.currentTime * 1000) / 1000});
          if (this.contextTransitions.length > 8) this.contextTransitions.shift();
          this.recovery?.requestTick(); this.report();
        });
      }
      const ctx = this.context;
      const resume = ctx.resume();
      if (this.pending) return this.pending;
      if (this.ready) {
        let timer;
        try { await Promise.race([resume, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Click Enable audio in the panel on the YouTube page.')), this.resumeTimeout); })]); }
        finally { clearTimeout(timer); }
        if (ctx.state !== 'running') throw new Error('Click Enable audio in the panel on the YouTube page.');
        this.error = ''; this.apply(this.settings); this.report(); return;
      }
      this.pending = (async () => {
        let timer;
        try {
          await Promise.race([resume, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Click Enable audio on the YouTube page to allow Safari audio.')), this.resumeTimeout); })]);
        } finally { clearTimeout(timer); }
        if (ctx.state !== 'running') throw new Error('Click Enable audio on the YouTube page.');
        this.input = ctx.createGain();
        this.inputAnalyser = ctx.createAnalyser(); this.inputAnalyser.fftSize = 2048;
        this.inputSamples = new Float32Array(this.inputAnalyser.fftSize);
        this.inputRightAnalyser = ctx.createAnalyser(); this.inputRightAnalyser.fftSize = 2048;
        this.inputRightSamples = new Float32Array(this.inputRightAnalyser.fftSize);
        this.inputSplitter = ctx.createChannelSplitter(2); this.input.connect(this.inputSplitter);
        this.inputSplitter.connect(this.inputAnalyser, 0); this.inputSplitter.connect(this.inputRightAnalyser, 1);
        this.bypass = ctx.createGain(); this.bypass.gain.value = 1;
        this.input.connect(this.bypass); this.bypass.connect(ctx.destination);
        this.pitchDirect = ctx.createGain(); this.pitchDirect.gain.value = 1;
        this.pitchWet = ctx.createGain(); this.pitchWet.gain.value = 0;
        this.postPitch = ctx.createGain();
        this.input.connect(this.pitchDirect); this.pitchDirect.connect(this.postPitch);
        await this.createPitchNode();
        this.input.connect(this.pitchNode); this.pitchNode.connect(this.pitchWet); this.pitchWet.connect(this.postPitch);
        this.dry = ctx.createGain(); this.wet = ctx.createGain(); this.fx = ctx.createGain();
        this.fx.gain.value = 0;
        this.postPitch.connect(this.dry); this.dry.connect(this.fx);
        this.preDelay = ctx.createDelay(0.1); this.preDelay.delayTime.value = 0.018;
        this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 6500; this.tone.Q.value = 0.5;
        this.wetLowCut = ctx.createBiquadFilter(); this.wetLowCut.type = 'highpass'; this.wetLowCut.frequency.value = 120;
        this.wetLowCut.Q.value = -3.01029995664; // Web Audio highpass Q is in dB; Butterworth alignment.
        this.postPitch.connect(this.preDelay); this.preDelay.connect(this.wetLowCut); this.wetLowCut.connect(this.tone); this.wet.connect(this.fx);
        this.compressor = ctx.createDynamicsCompressor();
        // Peak protection only. The previous soft knee compressed ordinary
        // music levels, even with reverb off, reducing the original dynamics.
        this.compressor.threshold.value = -0.3; this.compressor.knee.value = 0;
        this.compressor.ratio.value = 20; this.compressor.attack.value = 0; this.compressor.release.value = 0.08;
        // Web Audio adds automatic makeup gain even below the threshold.
        // Undo it so ordinary pitch-only audio keeps its original level.
        this.peakTrim = ctx.createGain();
        this.peakTrim.gain.value = Math.pow(10, -0.3 * (1 - 1 / 20) * 0.6 / 20);
        this.output = ctx.createGain();
        this.fx.connect(this.compressor); this.compressor.connect(this.peakTrim); this.peakTrim.connect(this.output); this.output.connect(ctx.destination);
        this.outputAnalyser = ctx.createAnalyser(); this.outputAnalyser.fftSize = 2048;
        this.outputSamples = new Float32Array(this.outputAnalyser.fftSize);
        this.outputRightAnalyser = ctx.createAnalyser(); this.outputRightAnalyser.fftSize = 2048;
        this.outputRightSamples = new Float32Array(this.outputRightAnalyser.fftSize);
        this.outputSplitter = ctx.createChannelSplitter(2); this.output.connect(this.outputSplitter);
        this.outputSplitter.connect(this.outputAnalyser, 0); this.outputSplitter.connect(this.outputRightAnalyser, 1);
        this.ready = true; this.error = ''; this.setDecay(this.settings.decay);
        this.apply(this.settings); this.report();
      })();
      try { await this.pending; }
      catch (error) { this.error = error.message; this.report(); throw error; }
      finally { this.pending = null; }
    }
    async createPitchNode() {
      const ctx = this.context;
      // Prepare the filter bank on the page thread before connecting audio.
      // The audio thread only reads it; no filter design happens in process().
      const resamplerTable = globalThis.YouTubeFXDSP.resamplerTable();
      if (ctx.audioWorklet && typeof AudioWorkletNode === 'function') {
        let timer;
        try {
          await Promise.race([
            ctx.audioWorklet.addModule(this.resourceURL('pitch-worklet.js')),
            new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Safari audio-worklet loading timed out')), this.workletTimeout);})
          ]);
          this.pitchNode = new AudioWorkletNode(ctx, 'youtube-fx-pitch', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
            channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
            processorOptions: {resamplerTable}
          });
          await new Promise((resolve, reject) => {
            clearTimeout(timer);
            timer = setTimeout(() => reject(new Error('Stereo pitch processor did not initialize')), this.workletTimeout);
            this.pitchNode.port.onmessage = event => {
              if (event.data?.type !== 'pitch-ready') return;
              this.pitchInfo = event.data; resolve();
            };
            this.pitchNode.onprocessorerror = () => reject(new Error('Stereo pitch processor could not start'));
          });
          this.pitchNode.onprocessorerror = () => {
            this.fatal = true;
            this.error = 'Pitch processor stopped. Effects are bypassed; reload YouTube to restart.';
            this.apply(this.settings); this.report();
          };
          this.backend = 'AudioWorklet'; return;
        } catch (error) {
          if (this.pitchNode?.port) this.pitchNode.port.onmessage = null;
          this.pitchNode?.disconnect(); this.pitchNode = null;
          console.info('[YouTube FX] Using compatibility audio processing:', error.message);
        }
        finally { clearTimeout(timer); }
      }
      // Use the same stereo WASM kernel if Safari blocks worklet loading.
      if (!ctx.createScriptProcessor) throw new Error('Safari could not start an audio processor. Update Safari and reload YouTube.');
      const stereo = new globalThis.YouTubeFXDSP.StereoPitch(ctx.sampleRate, resamplerTable);
      this.pitchInfo = stereo.info();
      this.pitchNode = ctx.createScriptProcessor(2048, 2, 2);
      this.fallbackStereo = stereo; let wasActive = false;
      const inputs = new Array(2), outputs = new Array(2);
      this.pitchNode.onaudioprocess = event => {
        const active = this.pitchActive;
        if (active && !wasActive) stereo.reset();
        wasActive = active;
        for (let c = 0; c < 2; c++) {
          inputs[c] = event.inputBuffer.getChannelData(Math.min(c, event.inputBuffer.numberOfChannels - 1));
          outputs[c] = event.outputBuffer.getChannelData(c);
        }
        if (active) stereo.process(inputs, outputs, correctionPitch(this.settings));
        else for (let c = 0; c < 2; c++) outputs[c].set(inputs[c]);
      };
      this.backend = 'Compatibility';
    }
    ramp(parameter, value, delay = 0) {
      const time = this.context.currentTime + delay;
      parameter.cancelScheduledValues(this.context.currentTime);
      parameter.setValueAtTime(parameter.value, this.context.currentTime);
      parameter.setTargetAtTime(value, time, 0.015);
    }
    apply(raw, supportedPage = this.supportedPage) {
      this.settings = normalize(raw); this.supportedPage = supportedPage;
      if ((!this.settings.enabled || !supportedPage) && this.recovery) this.recovery.stop();
      for (const [media, record] of this.activeSources) this.syncMediaRate(media, record);
      if (!this.ready) return;
      const s = this.settings, enabled = s.enabled && supportedPage && !this.error;
      // The native player and decoded queue both change pitch naturally with
      // speed. Linked playback therefore bypasses time stretching completely.
      const pitch = correctionPitch(s);
      const wasPitchActive = this.pitchActive;
      this.pitchActive = enabled && Math.abs(pitch) > 0.0001;
      if (this.backend === 'AudioWorklet') {
        this.pitchNode.parameters.get('pitch').setValueAtTime(pitch, this.context.currentTime);
        this.pitchNode.parameters.get('active').setValueAtTime(this.pitchActive ? 1 : 0, this.context.currentTime);
      }
      const latency = this.pitchLatencySamples(pitch);
      if (this.pitchActive && !wasPitchActive) this.pitchReadyAt = this.context.currentTime + (Math.ceil(latency) + (this.backend === 'Compatibility' ? 4096 : 256)) / this.context.sampleRate;
      if (!this.pitchActive) this.pitchReadyAt = 0;
      const warmup = Math.max(0, this.pitchReadyAt - this.context.currentTime);
      this.ramp(this.pitchDirect.gain, this.pitchActive ? 0 : 1, warmup);
      this.ramp(this.pitchWet.gain, this.pitchActive ? 1 : 0, warmup);
      this.ramp(this.bypass.gain, enabled ? 0 : 1, warmup);
      this.ramp(this.fx.gain, enabled ? 1 : 0, warmup);
      const mix = s.reverb / 100;
      this.ramp(this.dry.gain, 1 - mix * 0.4);
      this.ramp(this.wet.gain, mix * 0.9);
      this.ramp(this.output.gain, s.volume / 100);
      this.scheduleDecay(s.decay);
      this.recovery?.requestTick?.();
      this.report();
    }
    syncMediaRate(media, record, enabled = this.settings.enabled && this.supportedPage && !this.error && !this.fatal) {
      if (enabled) {
        if (!record.transport) {
          record.transport = {rate: media.playbackRate, pitch: {}};
          for (const key of ['preservesPitch', 'webkitPreservesPitch']) if (key in media) record.transport.pitch[key] = media[key];
        }
        // Disable the browser's time stretch: our stereo engine supplies only
        // the correction needed in independent mode.
        for (const key of Object.keys(record.transport.pitch)) if (media[key] !== false) media[key] = false;
        const rate = this.settings.rate / 100;
        if (Math.abs(media.playbackRate - rate) > 0.00001) media.playbackRate = rate;
      } else if (record.transport) {
        const original = record.transport; record.transport = null;
        for (const [key, value] of Object.entries(original.pitch)) media[key] = value;
        if (Math.abs(media.playbackRate - original.rate) > 0.00001) media.playbackRate = original.rate;
      }
    }
    pitchLatencySamples(pitch = correctionPitch(this.settings)) {
      const info = this.pitchInfo;
      if (!info) return 0;
      const outputLatency = Math.abs(pitch) > 12.5 ? info.extendedOutputLatencySamples ?? info.outputLatencySamples : info.outputLatencySamples;
      return info.inputLatencySamples !== undefined ? info.inputLatencySamples + (outputLatency + info.resamplerRadius) / Math.pow(2, pitch / 12) : info.latencySamples;
    }
    processingLatencySeconds() {
      if (!this.ready || !this.settings.enabled || !this.supportedPage) return 0;
      const pitch = this.pitchActive ? this.pitchLatencySamples() / this.context.sampleRate : 0;
      const compatibility = this.pitchActive && this.backend === 'Compatibility' ? 4096 / this.context.sampleRate : 0;
      return pitch + compatibility + 0.006; // Web Audio compressor lookahead.
    }
    scheduleDecay(seconds) {
      clearTimeout(this.decayTimer);
      if (this.currentDecay === seconds) return;
      // Keep the current room sounding while the slider moves. Construct one
      // new convolution tail after it settles, instead of many at once.
      this.decayTimer = setTimeout(() => this.setDecay(seconds), 150);
    }
    setDecay(seconds) {
      this.currentDecay = seconds;
      const ctx = this.context;
      const convolver = ctx.createConvolver(), gain = ctx.createGain();
      const length = Math.ceil(ctx.sampleRate * seconds), impulse = ctx.createBuffer(2, length, ctx.sampleRate);
      let seed = 0x615a93;
      const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel); let low = 0;
        for (let i = 0; i < length; i++) {
          low += 0.3 * (random() - low);
          const fadeIn = Math.min(1, i / (ctx.sampleRate * 0.012));
          data[i] = low * Math.exp(-6.9078 * i / length) * fadeIn;
        }
        for (const [delay, amplitude] of [[0.019, 0.4], [0.037, 0.26], [0.061, 0.17]]) {
          const index = Math.floor((delay + channel * 0.003) * ctx.sampleRate);
          if (index < length) data[index] += amplitude;
        }
      }
      convolver.buffer = impulse; gain.gain.value = 0;
      this.tone.connect(convolver); convolver.connect(gain); gain.connect(this.wet);
      this.ramp(gain.gain, 1);
      const old = this.reverbNode;
      this.reverbNode = {convolver, gain};
      if (old) {
        this.ramp(old.gain.gain, 0);
        setTimeout(() => { this.tone.disconnect(old.convolver); old.convolver.disconnect(); old.gain.disconnect(); }, 180);
      }
    }
    attach(media) {
      if (!this.ready || !media) return;
      if (media.mediaKeys) {
        this.error = 'This video uses protected audio. Turn effects off and choose a regular YouTube video.';
        this.apply(this.settings); return;
      }
      if (this.sources.has(media)) {
        const record = this.sources.get(media);
        if (!record.connected) { record.source.connect(this.input); record.connected = true; this.activeSources.set(media, record); }
        this.syncMediaRate(media, record);
        return;
      }
      try {
        const source = this.context.createMediaElementSource(media);
        // A working bypass is already connected BEFORE claiming the media element.
        source.connect(this.input);
        // Recovery owns seek classification. A tiny YouTube correction must
        // not erase a third of a second of healthy pitch-processor history.
        const reset = event => {
          if (event?.type !== 'seeking' || this.recovery?.media !== media) this.resetPitch();
          else this.recovery.requestTick?.();
        };
        media.addEventListener('seeking', reset);
        media.addEventListener('emptied', reset);
        const record = {source, connected: true, reset};
        const rateChanged = () => {
          if (!record.connected || !media.isConnected) return;
          this.syncMediaRate(media, record); this.recovery?.requestTick?.();
        };
        media.addEventListener('ratechange', rateChanged);
        media.addEventListener('loadedmetadata', rateChanged);
        media.addEventListener('playing', rateChanged);
        this.sources.set(media, record); this.activeSources.set(media, record);
        this.syncMediaRate(media, record); this.report();
      } catch (error) {
        this.error = error.name === 'InvalidStateError'
          ? 'Another audio extension is using this player. Disable it and reload YouTube.'
          : 'Safari could not process this player. Reload YouTube and try Enable audio again.';
        this.apply(this.settings); this.report();
      }
    }
    resetPitch() {
      if (this.backend === 'AudioWorklet') this.pitchNode.port.postMessage('reset');
      else this.fallbackStereo?.reset();
    }
    prune() {
      // Keep a source per element for its whole lifetime: re-creating one is illegal.
      for (const [media, record] of this.activeSources) if (!media.isConnected && record.connected) {
        this.syncMediaRate(media, record, false);
        record.source.disconnect(); record.connected = false; this.activeSources.delete(media);
      }
    }
    sampleSignal() {
      if (!this.ready || this.context.state !== 'running' || !this.inputAnalyser) return;
      this.inputAnalyser.getFloatTimeDomainData(this.inputSamples);
      this.inputRightAnalyser.getFloatTimeDomainData(this.inputRightSamples);
      this.outputAnalyser.getFloatTimeDomainData(this.outputSamples);
      this.outputRightAnalyser.getFloatTimeDomainData(this.outputRightSamples);
      const peak = data => {let result = 0; for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) result = Math.max(result, Math.abs(data[i])); return result;};
      this.inputChannelPeaks[0] = peak(this.inputSamples); this.inputChannelPeaks[1] = peak(this.inputRightSamples);
      this.outputChannelPeaks[0] = peak(this.outputSamples); this.outputChannelPeaks[1] = peak(this.outputRightSamples);
      this.inputPeak = Math.max(...this.inputChannelPeaks); this.outputPeak = Math.max(...this.outputChannelPeaks);
      const now = this.clockNow();
      const playing = [...this.activeSources].some(([media, record]) => record.connected && media.isConnected && !media.paused && !media.muted && media.volume > 0 && media.readyState >= 2);
      if (!playing || !this.settings.enabled || !this.supportedPage) this.monitoringSince = null;
      else if (this.monitoringSince === null) this.monitoringSince = now;
      if (this.inputPeak > 0.00001) this.lastSignalAt = now;
    }
    diagnostics() {
      this.sampleSignal();
      return {
        version: globalThis.YouTubeFXSettings.VERSION,
        browser: globalThis.navigator?.userAgent || 'unknown',
        settings: {...this.settings}, audio: this.status(),
        playback: {ratePercent: this.settings.rate, linked: this.settings.linked,
          pitchSemitones: this.settings.linked ? globalThis.YouTubeFXSettings.naturalPitch(this.settings.rate) : this.settings.semitones + this.settings.cents / 100,
          correctionSemitones: correctionPitch(this.settings), method: this.settings.linked ? 'natural stereo resampling' : 'stereo resampling + phase-linked pitch correction'},
        sampleRate: this.context?.sampleRate || null,
        audioClock: this.context?.currentTime || 0,
        inputPeak: this.inputPeak, outputPeak: this.outputPeak,
        inputChannelPeaks: [...this.inputChannelPeaks], outputChannelPeaks: [...this.outputChannelPeaks],
        pitch: this.pitchInfo ? {...this.pitchInfo, active: this.pitchActive,
          latencySamples: Math.ceil(this.processingLatencySeconds() * this.context.sampleRate),
          latencyMs: this.processingLatencySeconds() * 1000, peakReductionDb: this.compressor?.reduction || 0} : null,
        captureWorld: 'page',
        visibility: globalThis.document?.visibilityState || 'unknown', contextTransitions: this.contextTransitions.slice(),
        streamTap: globalThis.__youtubeFXTap?.diagnostics() || null,
        recovery: this.recovery?.diagnostics() || null,
        players: [...this.activeSources].map(([media, record]) => {
          const src = media.currentSrc || media.src || '';
          return {type: media.tagName || 'unknown', connected: record.connected, paused: Boolean(media.paused),
            muted: Boolean(media.muted), volume: media.volume, readyState: media.readyState,
            playbackRate: media.playbackRate, preservesPitch: media.preservesPitch ?? media.webkitPreservesPitch ?? null,
            time: Number.isFinite(media.currentTime) ? Math.round(media.currentTime * 10) / 10 : null,
            source: src.startsWith('blob:') ? 'blob / MediaSource' : /m3u8|\/hls\//i.test(src) ? 'HLS' : src.startsWith('data:') ? 'data' : src ? 'URL' : 'empty',
            audioTracks: media.audioTracks?.length ?? null, videoWidth: media.videoWidth ?? null};
        })
      };
    }
    status() {
      const now = this.clockNow();
      return {ready: this.ready, state: this.context?.state || 'idle', backend: this.backend,
        attached: [...this.activeSources].some(([media, record]) => media.isConnected && record.connected), error: this.error,
        signal: now - this.lastSignalAt < 1600,
        noSignal: this.monitoringSince !== null && now - this.monitoringSince > 4500 && now - this.lastSignalAt > 4500,
        inputPeak: this.inputPeak, fatal: this.fatal,
        route: this.recovery?.active ? 'buffered-stream' : 'media-element',
        recoveryPhase: this.recovery?.phase || 'idle', recoveryMessage: this.recovery?.message || ''};
    }
  }
  globalThis.YouTubeFXAudioEngine = AudioEngine;
})();
