import './dsp.js';
import './pcm-buffer.js';
class YouTubePCMProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super(); this.timeline = new globalThis.YouTubeFXPCM.PCMTimeline(sampleRate, options.processorOptions?.capacity || 1 << 20, options.processorOptions?.resamplerTable); this.epoch = 0; this.blocks = 0; this.alive = true;
    this.port.onmessage = event => {
      const data = event.data;
      if (data.op === 'destroy') {this.alive = false; return;}
      if (data.op === 'reset') {this.epoch = data.epoch; this.timeline.reset(data.mediaTime);}
      else if (data.epoch === this.epoch) {
        if (data.op === 'data') for (const chunk of data.chunks) this.timeline.enqueue(chunk.start, chunk.planes, chunk.sampleRate);
        else if (data.op === 'play') this.timeline.play(data.mediaTime, data.contextFrame);
        else if (data.op === 'pause') this.timeline.pause();
        else if (data.op === 'rate') this.timeline.setRate(data.value);
      }
    };
  }
  process(inputs, outputs) {
    if (!this.alive) return false;
    this.timeline.render(outputs[0], currentFrame);
    if (++this.blocks >= 96) {this.blocks = 0; this.port.postMessage({epoch: this.epoch, ...this.timeline.stats()});}
    return true;
  }
}
registerProcessor('youtube-fx-pcm', YouTubePCMProcessor);
