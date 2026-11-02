/* Clear MediaSource audio -> WebCodecs -> continuous, buffered PCM playback.
 * Headers, player state flags and page timer delays are not discontinuities. */
(() => {
  'use strict';
  class StreamRecovery {
    constructor(engine) {
      this.engine = engine; this.media = null; this.track = null; this.decoder = null;
      this.buffers = []; this.queued = new Set(); this.sent = new Set();
      this.index = new globalThis.YouTubeFXPacketIndex(); this.timeline = new globalThis.YouTubeFXPCM.DecodedTimeline();
      this.active = false; this.phase = 'idle'; this.message = ''; this.savedTracks = [];
      this.lastTime = null; this.lastClock = null; this.lastAdvanceClock = null;
      this.wallNow = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000; this.lastWall = null;
      this.clockSettleUntil = 0; this.pendingRelocation = false;
      this.decoded = 0; this.generation = 0; this.resets = 0; this.drifts = 0; this.lastRateUpdate = 0;
      this.transport = null; this.lookahead = 0; this.pendingLookahead = null; this.lookaheadChangedAt = 0;
      this.knownMedia = new WeakSet(); this.horizon = 12; this.events = []; this.lastResetReason = '';
      this.rebuffers = 0; this.resumeCount = 0; this.held = false; this.wakeQueued = false; this.retryAt = Infinity; this.failures = 0;
      this.unflushedCount = 0;
    }
    note(reason) {
      this.events.push({reason, time: Math.round((this.media?.currentTime || 0) * 1000) / 1000,
        clock: Math.round((this.engine.context?.currentTime || 0) * 1000) / 1000,
        bufferedMs: Math.round(this.transport?.stats().bufferedMs || 0)});
      if (this.events.length > 16) this.events.shift();
    }
    requestTick() {
      if (this.wakeQueued || !this.media) return;
      this.wakeQueued = true;
      queueMicrotask(() => {this.wakeQueued = false; if (this.media) this.tick();});
    }
    bindTrack(track) {
      this.unsubscribe?.(); this.track = track;
      this.unsubscribe = track.subscribe?.(() => this.requestTick());
      this.index.signature = '';
    }
    consider() {
      const engine = this.engine;
      if (!engine.settings.enabled || !engine.supportedPage || engine.fatal) {this.stop(); return;}
      if (this.media) return;
      const media = [...engine.activeSources].map(([element]) => element).find(element => element.isConnected && !element.paused && !element.muted && (element.currentSrc || element.src || '').startsWith('blob:'));
      if (!media || media.mediaKeys || (!engine.status().noSignal && !this.knownMedia.has(media))) return;
      const track = globalThis.__youtubeFXTap?.find(media);
      if (!track) {this.phase = 'waiting'; this.message = 'Reload YouTube so stream recovery can observe the player from the start.'; return;}
      if (typeof globalThis.AudioDecoder !== 'function') {this.phase = 'unsupported'; this.message = 'This Safari build does not expose the audio decoder required for stream recovery.'; return;}
      if (!media.audioTracks?.length) {this.phase = 'unsupported'; this.message = 'Safari does not expose an audio-track switch for this player.'; return;}
      this.media = media; this.bindTrack(track); this.lastTime = null; this.lastClock = null; this.lastAdvanceClock = engine.context.currentTime;
      this.gain = engine.context.createGain(); this.gain.gain.value = 0; this.gain.connect(engine.input);
      this.transport = new globalThis.YouTubeFXPCMPlayback(engine, this.gain, () => this.requestTick());
      const transport = this.transport;
      void transport.prepare().then(() => {if (this.transport === transport) this.requestTick();}, error => {if (this.transport === transport) this.fail(error.message);});
      this.phase = 'decoding'; this.message = ''; this.failures = 0; this.makeDecoder('initial recovery');
    }
    makeDecoder(reason = 'initial recovery', preserveQueue = false) {
      if (!this.track?.config) return;
      if (preserveQueue && this.decoderConfig?.sampleRate !== this.track.config.sampleRate) {this.restore(); preserveQueue = false;}
      try {
        try {this.decoder?.close();} catch {}
        const generation = ++this.generation; this.resets++; this.lastResetReason = reason; this.note(reason);
        this.timeline.reset(); this.queued.clear(); this.retryAt = Infinity;
        if (!preserveQueue) {this.clearPlayback(); this.buffers.length = 0;}
        this.decoder = new AudioDecoder({output: data => {
          try {
            if (generation !== this.generation || !this.media) return;
            const start = data.timestamp / 1e6;
            // Ignore a stale decoder callback instead of filling the queue with
            // samples from an abandoned position after a seek or track change.
            if (start + data.numberOfFrames / data.sampleRate < this.media.currentTime - 6) return;
            const planes = [];
            for (let c = 0; c < Math.min(2, data.numberOfChannels); c++) {
              const plane = new Float32Array(data.numberOfFrames); data.copyTo(plane, {planeIndex: c, format: 'f32-planar'}); planes.push(plane);
            }
            const item = this.timeline.append(start, planes, data.sampleRate);
            if (!item) return;
            item.key = generation + ':' + (++this.decoded); this.buffers.push(item); this.unflushedCount++;
            if (!this.active || this.unflushedCount >= 8 || this.decoder.decodeQueueSize === 0) this.requestTick();
          } catch (error) {this.fail(error.message);}
          finally {data.close();}
        }, error: error => {if (generation === this.generation) this.fail(error.message);}});
        this.decoder.configure(this.track.config); this.decoderConfig = {...this.track.config}; this.configGeneration = this.track.generation;
      } catch (error) {this.fail('Safari could not decode this audio format: ' + error.message);}
    }
    clearPlayback() {this.transport?.reset(this.media?.currentTime); this.sent.clear();}
    restore() {
      for (const [track, enabled] of this.savedTracks) {try {track.enabled = enabled;} catch {}}
      this.savedTracks.length = 0; this.active = false; this.transport?.pause();
      if (this.gain) this.gain.gain.value = 0;
    }
    fail(message) {
      this.message = message; this.phase = 'error'; this.note('decoder error: ' + message);
      this.restore(); this.clearPlayback(); this.buffers.length = 0;
      try {this.decoder?.close();} catch {} this.decoder = null; this.generation++;
      this.failures++; this.retryAt = this.failures <= 3 ? this.engine.context.currentTime + Math.min(8, 2 ** this.failures) : Infinity;
    }
    stop() {
      if (!this.media && !this.transport) return;
      this.restore(); this.clearPlayback(); this.unsubscribe?.(); this.unsubscribe = null;
      try {this.decoder?.close(); this.transport?.destroy(); this.gain?.disconnect();} catch {}
      this.generation++; this.decoder = null; this.media = null; this.track = null; this.gain = null; this.transport = null;
      this.buffers.length = 0; this.queued.clear(); this.phase = 'idle'; this.message = ''; this.lastTime = null; this.lastClock = null;
      this.lastAdvanceClock = null; this.held = false; this.starvingSince = null;
    }
    pump(time) {
      if (!this.decoder || this.decoder.state !== 'configured') return;
      this.index.refresh(this.track);
      const range = this.index.range((time - 0.3) * 1e6, (time + this.horizon) * 1e6);
      for (const timestamp of this.queued) if (timestamp < (time - 6.5) * 1e6) this.queued.delete(timestamp);
      let count = 0;
      for (let i = range.start; i < range.end; i++) {
        const packet = range.items[i]; if (this.queued.has(packet.timestamp)) continue;
        if (this.decoder.decodeQueueSize >= 64) break;
        this.decoder.decode(new EncodedAudioChunk({type: 'key', timestamp: packet.timestamp, duration: packet.duration, data: packet.data}));
        this.queued.add(packet.timestamp); if (++count >= 64) break;
      }
    }
    flushPCM(time) {
      this.buffers = this.buffers.filter(item => {
        const keep = item.end > time - 6 && item.start < time + this.horizon + 2;
        if (!keep) this.sent.delete(item.key); return keep;
      });
      if (!this.transport?.ready) return;
      const fresh = this.buffers.filter(item => item.planes && !this.sent.has(item.key));
      this.transport.enqueue(fresh);
      this.unflushedCount = 0;
      // The worklet owns the transferred samples. Retain only small coverage
      // metadata on the page; pause/resume keeps the actual queue intact.
      for (const item of fresh) {this.sent.add(item.key); item.planes = null;}
    }
    tick() {
      const media = this.media, engine = this.engine;
      if (!media) return;
      if (!media.isConnected || !engine.settings.enabled || !engine.supportedPage || media.mediaKeys) {this.stop(); return;}
      const track = globalThis.__youtubeFXTap?.find(media, this.track);
      if (!track) {this.stop(); return;}
      if (track !== this.track) {
        const same = globalThis.YouTubeFXStreamCache?.sameConfig(this.track.config, track.config);
        this.bindTrack(track); this.note('audio track changed');
        if (same && this.decoder?.state === 'configured') this.configGeneration = track.generation;
        else this.makeDecoder('decoder format changed', this.active);
      }
      if (this.track.generation !== this.configGeneration) this.makeDecoder('decoder configuration changed', this.active);
      const time = media.currentTime, clock = engine.context.currentTime;
      const wall = this.wallNow();
      const speed = media.playbackRate;
      if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {this.restore(); this.phase = 'waiting'; this.message = 'Choose a playback rate from 50% to 200%.'; return;}
      this.horizon = 12 * Math.max(1, speed);
      // Queue timestamps are media seconds; DSP latency is in wall seconds.
      const desiredLookahead = speed * (engine.processingLatencySeconds?.() || 0);
      const rateChanged = this.playbackRate !== speed;
      if (rateChanged && this.transport?.ready) {
        this.transport.rate(speed, true); this.playbackRate = speed;
        this.anchorTime = time; this.anchorClock = clock; this.lastRateUpdate = clock;
        if (this.active) this.note('playback rate adjusted; queue retained');
      }
      if (this.pendingLookahead === null || Math.abs(this.pendingLookahead - desiredLookahead) > 0.00001) {
        this.pendingLookahead = desiredLookahead; this.lookaheadChangedAt = clock;
      }
      const delta = this.lastTime === null ? 0 : time - this.lastTime;
      const elapsed = this.lastClock === null ? 0 : clock - this.lastClock;
      const wallElapsed = this.lastWall === null ? 0 : Math.max(0, wall - this.lastWall);
      if (Math.max(elapsed, wallElapsed) > 0.75) this.clockSettleUntil = clock + 0.75;
      // A delayed page callback or an interrupted audio clock is not a seek.
      // Wall time distinguishes it from a real forward timeline jump.
      const discontinuity = this.lastTime !== null && (delta < -0.2 || delta - Math.max(0, elapsed, wallElapsed) * speed > 0.75
        || (media.seeking && Math.abs(delta - (media.paused ? 0 : Math.max(0, elapsed) * speed)) > 0.2));
      if (discontinuity) {
        const target = time + speed * 0.025 + desiredLookahead;
        const buffered = this.buffers.some(item => item.start <= target && item.end > target);
        if (buffered) {
          // After a blocked page, media.currentTime can catch up in several
          // large steps. Do not mistake those updates for separate seeks.
          if (clock >= this.clockSettleUntil && this.active && !media.paused && engine.context.state === 'running') {
            this.transport.play(target, clock + 0.025); this.note('buffered timeline realigned; queue retained');
            this.anchorTime = time; this.anchorClock = clock;
          }
        } else if (!media.seeking && clock < this.clockSettleUntil) this.pendingRelocation = true;
        else {this.restore(); this.makeDecoder(media.seeking ? 'player seek' : 'uncached player timeline jump'); engine.resetPitch();}
        this.lastAdvanceClock = clock; this.held = false;
      }
      if (this.pendingRelocation && clock >= this.clockSettleUntil) {
        this.pendingRelocation = false;
        const target = time + speed * 0.025 + desiredLookahead;
        if (!this.buffers.some(item => item.start <= target && item.end > target)) {
          this.restore(); this.makeDecoder('uncached timeline relocation'); engine.resetPitch();
        }
      }
      if (delta > 0.002 || this.lastAdvanceClock === null) this.lastAdvanceClock = clock;
      this.lastTime = time; this.lastClock = clock; this.lastWall = wall;
      if (media.paused || engine.context.state !== 'running') {
        if (this.active) {this.note(media.paused ? 'player paused; queue retained' : 'playback interrupted; queue retained'); this.restore();}
        this.held = true;
        this.phase = media.paused ? 'paused' : 'interrupted';
        this.message = '';
        this.flushPCM(time); return;
      }
      if (!this.decoder || this.decoder.state !== 'configured') {
        if (clock >= this.retryAt) this.makeDecoder('decoder retry');
        if (!this.decoder || this.decoder.state !== 'configured') return;
      }
      try {this.pump(time); this.flushPCM(time);} catch (error) {this.fail(error.message); return;}
      if (!this.transport?.ready) return;
      const stalled = this.lastAdvanceClock !== null && clock - this.lastAdvanceClock > 0.55;
      if (stalled) {
        if (!this.held) {this.note('player buffering; queue retained'); this.transport.pause(); this.held = true;}
        this.phase = 'buffering'; this.message = 'Waiting for the YouTube player…'; return;
      }
      const covered = this.buffers.some(item => item.start <= time + speed * 0.04 && item.end > time + speed * 0.025);
      const queueState = this.transport.stats();
      if (this.active && !this.held && !covered && queueState.bufferedMs < 30 && queueState.underrunFrames > 0) {
        if (this.starvingSince === null || this.starvingSince === undefined) this.starvingSince = clock;
        if (clock - this.starvingSince > 0.35) {
          this.note('PCM gap; original audio restored'); this.restore(); this.rebuffers++; this.phase = 'decoding'; this.starvingSince = null; return;
        }
      } else this.starvingSince = null;
      if (!this.active || this.held) {
        const target = time + speed * 0.025 + desiredLookahead;
        const lookaheadCovered = this.buffers.some(item => item.start <= target && item.end > target);
        const furthest = this.buffers.reduce((end, item) => Math.max(end, item.end), time);
        if (!covered || !lookaheadCovered || furthest < target + 0.5 * speed) {this.phase = 'decoding'; this.message = ''; return;}
        try {
          this.lookahead = desiredLookahead; this.transport.rate(speed, true); this.transport.play(target, clock + 0.025);
          if (!this.active) {
            this.savedTracks = [];
            for (let i = 0; i < media.audioTracks.length; i++) {const track = media.audioTracks[i]; this.savedTracks.push([track, track.enabled]); track.enabled = false;}
          }
          this.active = true; this.knownMedia.add(media); this.anchorTime = time; this.anchorClock = clock;
          if (this.held) {this.resumeCount++; this.note('resumed from retained queue');} else this.note('buffered playback started');
          this.held = false;
        } catch (error) {this.fail(error.message); return;}
      }
      if (Math.abs(this.lookahead - desiredLookahead) > 0.004 && clock - this.lookaheadChangedAt > 0.35) {
        this.lookahead = desiredLookahead; this.transport.play(time + speed * 0.025 + this.lookahead, clock + 0.025);
        this.anchorTime = time; this.anchorClock = clock; this.note('pitch latency adjusted');
      }
      if (clock >= this.clockSettleUntil && clock - this.lastRateUpdate > 1) {
        const observed = queueState.playing && Number.isFinite(queueState.contextTime)
          ? queueState.mediaTime + Math.max(0, clock - queueState.contextTime) * queueState.rate - this.lookahead
          : this.anchorTime + (clock - this.anchorClock) * speed;
        const drift = time - observed;
        if (Number.isFinite(drift) && Math.abs(drift) > 0.35 && clock - (this.lastRealign || 0) > 3) {
          const target = time + speed * 0.025 + this.lookahead;
          if (this.buffers.some(item => item.start <= target && item.end > target)) {
            this.transport.play(target, clock + 0.025); this.anchorTime = time; this.anchorClock = clock;
            this.lastRealign = clock; this.note('audio clock realigned; queue retained');
          }
        }
        const correction = !Number.isFinite(drift) || Math.abs(drift) < 0.08 ? 1 : Math.max(0.998, Math.min(1.002, 1 + drift * 0.005));
        this.transport.rate(speed * correction); this.lastRateUpdate = clock; if (correction !== 1) this.drifts++;
      }
      const volume = media.muted ? 0 : media.volume;
      if (this.gain.gain.setTargetAtTime) this.gain.gain.setTargetAtTime(volume, clock, 0.008); else this.gain.gain.value = volume;
      this.phase = 'active'; this.message = '';
    }
    diagnostics() {
      return {phase: this.phase, active: this.active, message: this.message, decodedBuffers: this.decoded, scheduled: 0,
        codec: this.track?.config?.codec || null, playback: this.transport?.stats() || null, reserveTargetMs: this.horizon * 1000,
        decoderResets: this.resets, lastResetReason: this.lastResetReason, rebuffers: this.rebuffers, retainedQueueResumes: this.resumeCount,
        timestampAdjustments: this.timeline.adjustments, duplicateChunks: this.timeline.duplicates,
        playbackRate: this.playbackRate || 1, reserveWallMs: this.horizon / (this.playbackRate || 1) * 1000,
        latencyCompensationMs: Math.round(this.lookahead / (this.playbackRate || 1) * 1000), mediaLookaheadMs: Math.round(this.lookahead * 1000), encodedGapFrames: this.timeline.gapFrames,
        driftUpdates: this.drifts, indexedPackets: this.index.items.length, recentEvents: this.events.slice()};
    }
  }
  globalThis.YouTubeFXStreamRecovery = StreamRecovery;
})();
