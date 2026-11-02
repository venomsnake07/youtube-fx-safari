import './pitch-kernel.js';
import './dsp.js';

class YouTubePitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{name: 'pitch', defaultValue: 0, minValue: -24.5, maxValue: 24.5, automationRate: 'k-rate'},
      {name: 'active', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate'}];
  }
  constructor(options = {}) {
    super();
    this.stereo = new globalThis.YouTubeFXDSP.StereoPitch(sampleRate, options.processorOptions?.resamplerTable);
    this.wasActive = false;
    this.port.onmessage = event => {if (event.data === 'reset') this.stereo.reset();};
    this.port.postMessage({type: 'pitch-ready', ...this.stereo.info()});
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0];
    const active = parameters.active[0] >= 0.5;
    if (active && !this.wasActive) this.stereo.reset();
    this.wasActive = active;
    if (active) this.stereo.process(input, output, parameters.pitch[0]);
    else for (let c = 0; c < output.length; c++) {
      const source = input[c] || input[0];
      if (source) output[c].set(source); else output[c].fill(0);
    }
    return true;
  }
}
registerProcessor('youtube-fx-pitch', YouTubePitchProcessor);
