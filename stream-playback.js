/* One persistent rendering node for all decoded audio packets. */
(() => {
  'use strict';
  class PacketIndex {
    constructor() {this.signature = ''; this.items = []; this.visited = 0;}
    refresh(track) {
      const items = track.packets, key = [track.generation, track.revision, items.length, items[0]?.id, items.at(-1)?.id, items.at(-1)?.timestamp].join(':');
      if (key === this.signature) return;
      this.signature = key; this.items = track.orderedPackets ? items : items.slice().sort((a, b) => a.timestamp - b.timestamp);
    }
    range(start, end) {
      let a = 0, b = this.items.length;
      while (a < b) {const middle = (a + b) >>> 1; if (this.items[middle].timestamp < start) a = middle + 1; else b = middle;}
      const from = a;
      while (a < this.items.length && this.items[a].timestamp <= end) a++;
      this.visited += a - from;
      return {items: this.items, start: from, end: a};
    }
  }
  class PCMPlayback {
    constructor(engine, gain, onNeedData = () => {}) {
      this.engine = engine; this.gain = gain; this.epoch = 0; this.ready = false;
      this.onNeedData = onNeedData;
      this.destroyed = false;
      this.backend = ''; this.cached = {bufferedMs: 0, underruns: 0, underrunFrames: 0, renderedFrames: 0};
    }
    async prepare() {
      const ctx = this.engine.context; let timer;
      this.capacity = 2 ** Math.ceil(Math.log2(Math.max(ctx.sampleRate, this.engine.recovery?.track?.config?.sampleRate || 0) * 32));
      if (ctx.audioWorklet && typeof AudioWorkletNode === 'function') {
        try {
          await Promise.race([ctx.audioWorklet.addModule(this.engine.resourceURL('pcm-worklet.js')),
            new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('PCM worklet loading timed out')), 1800);})]);
          if (this.destroyed) return;
          this.node = new AudioWorkletNode(ctx, 'youtube-fx-pcm', {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
            processorOptions: {capacity: this.capacity, resamplerTable: globalThis.YouTubeFXDSP.resamplerTable()}});
          this.node.port.onmessage = event => {if (event.data.epoch === this.epoch) {this.cached = event.data; if (this.cached.playing && this.cached.bufferedMs < 8000 * (this.engine.settings.rate / 100 || 1)) this.onNeedData();}};
          this.node.onprocessorerror = () => {this.ready = false; this.engine.recovery?.fail('Audio queue stopped. Reload YouTube.');};
          this.backend = 'AudioWorklet queue';
        } catch { /* Keep the continuous queue in compatibility mode as well. */ }
        finally {clearTimeout(timer);}
      }
      if (this.destroyed) return;
      if (!this.node) {
        this.timeline = new globalThis.YouTubeFXPCM.PCMTimeline(ctx.sampleRate, this.capacity);
        this.node = ctx.createScriptProcessor(2048, 0, 2);
        this.node.onaudioprocess = event => {
          this.timeline.render([event.outputBuffer.getChannelData(0), event.outputBuffer.getChannelData(1)], Math.round(event.playbackTime * ctx.sampleRate));
          this.cached = this.timeline.stats();
          if (this.cached.playing && this.cached.bufferedMs < 8000 * (this.engine.settings.rate / 100 || 1)) this.onNeedData();
        };
        this.backend = 'Compatibility queue';
      }
      this.node.connect(this.gain); this.ready = true; this.reset();
    }
    send(op, values = {}, transfer = []) {this.node.port.postMessage({op, epoch: this.epoch, ...values}, transfer);}
    reset(mediaTime) {
      this.epoch++; this.cached = {bufferedMs: 0, underruns: 0, underrunFrames: 0, renderedFrames: 0};
      if (!this.ready) return;
      if (this.timeline) this.timeline.reset(mediaTime); else this.send('reset', {mediaTime});
    }
    enqueue(chunks) {
      if (!this.ready || !chunks.length) return;
      if (this.timeline) for (const chunk of chunks) this.timeline.enqueue(chunk.start, chunk.planes, chunk.sampleRate);
      else for (let i = 0; i < chunks.length; i += 8) {
        const group = chunks.slice(i, i + 8);
        const transfer = [...new Set(group.flatMap(chunk => chunk.planes.map(plane => plane.buffer)))];
        this.send('data', {chunks: group}, transfer);
      }
    }
    play(mediaTime, when) {
      const frame = Math.round(when * this.engine.context.sampleRate);
      if (this.timeline) this.timeline.play(mediaTime, frame); else this.send('play', {mediaTime, contextFrame: frame});
    }
    pause() {if (!this.ready) return; if (this.timeline) this.timeline.pause(); else this.send('pause');}
    rate(value, immediate = false) {if (!this.ready) return; if (this.timeline) this.timeline.setRate(value, immediate); else this.send('rate', {value, immediate});}
    stats() {return {backend: this.backend, ...this.cached};}
    destroy() {this.pause(); this.destroyed = true; if (this.node?.port) {this.send('destroy'); this.node.port.onmessage = null;} this.node?.disconnect(); this.ready = false;}
  }
  globalThis.YouTubeFXPCMPlayback = PCMPlayback;
  globalThis.YouTubeFXPacketIndex = PacketIndex;
})();
