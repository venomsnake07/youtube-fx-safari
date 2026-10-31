'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const base = fs.existsSync(path.resolve(__dirname, '../manifest.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../extension');
require(path.join(base, 'settings.js')); require(path.join(base, 'pitch-kernel.js')); require(path.join(base, 'dsp.js'));
const {StereoPitch} = globalThis.YouTubeFXDSP;
const {normalize, isYouTube} = globalThis.YouTubeFXSettings;
const sr = 48000;
function render(tone, semitones, sampleRate = sr, seconds = 3, block = 128) {
  const processor = new StereoPitch(sampleRate), count = Math.floor(seconds * sampleRate);
  const input = [new Float32Array(count), new Float32Array(count)], output = [new Float32Array(count), new Float32Array(count)];
  for (let i = 0; i < count; i++) {const pair = tone(i / sampleRate); input[0][i] = pair[0]; input[1][i] = pair[1];}
  for (let i = 0; i < count; i += block) processor.process(input.map(channel => channel.subarray(i, i + block)), output.map(channel => channel.subarray(i, i + block)), semitones);
  return {input, output, processor};
}
function sine(t, f = 440) {return 0.25 * Math.sin(2 * Math.PI * f * t);}
function estimateFrequency(data, sampleRate) {
  const begin = sampleRate, end = Math.min(data.length, sampleRate * 2.5);
  let first = -1, last = 0, crossings = 0;
  for (let i = begin + 1; i < end; i++) if (data[i - 1] <= 0 && data[i] > 0) {
    const time = i - 1 - data[i - 1] / (data[i] - data[i - 1]);
    if (first < 0) first = time;
    last = time; crossings++;
  }
  return (crossings - 1) * sampleRate / (last - first);
}
function rms(data, start = 0) {let sum = 0; for (let i = start; i < data.length; i++) sum += data[i] ** 2; return Math.sqrt(sum / (data.length - start));}
function correlation(left, right, start = sr) {
  let l = 0, r = 0, cross = 0;
  for (let i = start; i < left.length; i++) {l += left[i] ** 2; r += right[i] ** 2; cross += left[i] * right[i];}
  return cross / Math.sqrt(l * r);
}
function amplitude(data, frequency, start = sr, count = sr) {
  let real = 0, imag = 0, weight = 0;
  for (let i = 0; i < count; i++) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / count), value = data[start + i] * window;
    real += value * Math.cos(2 * Math.PI * frequency * i / sr); imag += value * Math.sin(2 * Math.PI * frequency * i / sr); weight += window;
  }
  return 2 * Math.hypot(real, imag) / weight;
}
for (const sampleRate of [44100, 48000]) for (const semitones of [-12, -7, -2, -0.37, 0, 0.5, 3, 7, 12]) {
  test(`stereo pitch ${semitones} semitones at ${sampleRate} Hz keeps duration and pitch accuracy`, () => {
    const {input, output} = render(t => [sine(t), sine(t, 330)], semitones, sampleRate);
    for (let c = 0; c < 2; c++) {
      const expected = (c ? 330 : 440) * 2 ** (semitones / 12), actual = estimateFrequency(output[c], sampleRate);
      assert.equal(output[c].length, input[c].length);
      assert.ok(output[c].every(Number.isFinite));
      assert.ok(Math.abs(1200 * Math.log2(actual / expected)) < 3, `${actual} Hz; expected ${expected}`);
      assert.ok(rms(output[c], sampleRate) > 0.08); assert.ok(rms(output[c], sampleRate) < 0.4);
    }
  });
}
for (const semitones of [-12, -7, -1, 0.5, 7, 12]) {
  test(`pitch ${semitones} preserves opposite-polarity stereo and panning gain`, () => {
    const {output} = render(t => {const s = sine(t) + sine(t, 220) * 0.3; return [s, -s * 0.6];}, semitones);
    assert.ok(correlation(...output) < -0.99999, 'stereo side information must not collapse to mono');
    assert.ok(Math.abs(20 * Math.log10(rms(output[1], sr) / rms(output[0], sr) / 0.6)) < 0.05, 'channel balance');
  });
}
test('90-degree stereo phase remains wide instead of drifting toward the center', () => {
  const {output} = render(t => [sine(t), 0.25 * Math.cos(2 * Math.PI * 440 * t)], -1, sr, 5);
  assert.ok(Math.abs(correlation(...output)) < 0.003);
});
test('mono material stays centered; hard-panned material cannot leak into the silent side', () => {
  const {output: mono} = render(t => [sine(t), sine(t)], 7);
  assert.ok(correlation(...mono) > 0.99999);
  const {output: panned} = render(t => [sine(t), 0], -3);
  assert.ok(rms(panned[0], sr) > 0.1); assert.ok(rms(panned[1], sr) < 1e-7);
});
test('pitch-only output retains 14 kHz and 17 kHz stereo detail without a low-pass filter', () => {
  const {output} = render(t => [sine(t, 14000), sine(t, 17000)], -1);
  for (let c = 0; c < 2; c++) {
    assert.ok(rms(output[c], sr) > 0.15, 'treble level retained');
    assert.ok(amplitude(output[c], (c ? 17000 : 14000) * 2 ** (-1 / 12)) > 0.17, 'correct treble pitch');
  }
});
test('mixed chord retains its partials and stereo mid/side balance', () => {
  const fundamentals = [110, 138.591315, 164.813778];
  const {output} = render(t => {
    let mid = 0; for (const f of fundamentals) for (let h = 1; h <= 16; h++) mid += 0.035 / h * Math.sin(2 * Math.PI * f * h * t);
    const side = sine(t, 2100) * 0.2;
    return [mid + side, mid - side];
  }, -1, sr, 4);
  const mid = output[0].map((l, i) => (l + output[1][i]) * 0.5), side = output[0].map((l, i) => (l - output[1][i]) * 0.5);
  const ratio = 2 ** (-1 / 12);
  for (const f of fundamentals) assert.ok(amplitude(mid, f * ratio) > 0.016);
  assert.ok(amplitude(side, 2100 * ratio) > 0.035);
  assert.ok(amplitude(mid, 2100 * ratio) < 0.001, 'side tone must stay in the stereo sides');
  assert.ok(amplitude(side, 110 * ratio) < 0.001, 'center bass must stay centered');
});
test('upward shifts reject content mapped beyond Nyquist instead of aliasing it to a buzz', () => {
  const {output} = render(t => [sine(t, 16000), sine(t, 16000)], 12);
  assert.ok(rms(output[0], sr) < 0.002);
});
test('reset clears history and invalid samples cannot poison the stereo processor', () => {
  const processor = new StereoPitch(sr), input = [new Float32Array(sr), new Float32Array(sr)], output = input.map(v => new Float32Array(v.length));
  input[0][120] = NaN; input[1][500] = Infinity;
  processor.process(input, output, 12); assert.ok(output.every(channel => channel.every(value => value === 0)));
  input[0].fill(0.1); processor.process(input, output, -3); processor.reset(); input[0].fill(0);
  processor.process(input, output, -7); assert.ok(output.every(channel => channel.every(value => value === 0)));
});
test('compatibility blocks use the same kernel and timing as AudioWorklet blocks', () => {
  const tone = t => [sine(t) + sine(t, 660) * 0.3, sine(t, 330)];
  const a = render(tone, -1, sr, 3, 128), b = render(tone, -1, sr, 3, 2048);
  for (let c = 0; c < 2; c++) assert.ok(a.output[c].every((v, i) => Math.abs(v - b.output[c][i]) < 1e-6));
  const memory = a.processor.kernel.memory.buffer, views = a.processor.views.slice();
  const inputs = [new Float32Array(128), new Float32Array(128)], outputs = inputs.map(v => new Float32Array(v.length));
  for (let i = 0; i < 2000; i++) a.processor.process(inputs, outputs, -1);
  assert.equal(a.processor.kernel.memory.buffer, memory); assert.deepEqual(a.processor.views, views);
});
test('pitch changes are smoothed and cannot produce nonfinite spikes', () => {
  const processor = new StereoPitch(sr), input = [new Float32Array(128), new Float32Array(128)], output = input.map(v => new Float32Array(v.length));
  let peak = 0;
  for (let block = 0; block < 1200; block++) {
    for (let i = 0; i < 128; i++) input[0][i] = input[1][i] = sine((block * 128 + i) / sr);
    processor.process(input, output, block < 400 ? -12 : block < 800 ? 12 : -1);
    for (const channel of output) for (const value of channel) {assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value));}
  }
  assert.ok(peak < 0.5);
});
test('settings reject corrupt/extreme values; site checks reject lookalikes', () => {
  assert.deepEqual(normalize(null), normalize());
  const result = normalize({enabled: 'true', semitones: 150, cents: -900, reverb: NaN, volume: -2, decay: Infinity, injected: 1});
  assert.equal(result.enabled, false); assert.equal(result.semitones, 12); assert.equal(result.cents, -50);
  assert.equal(result.reverb, 25); assert.equal(result.volume, 0); assert.equal(result.decay, 2.8); assert.ok(!('injected' in result));
  for (const site of ['https://www.youtube.com/watch?v=abc', 'https://music.youtube.com/watch?v=abc', 'https://youtube.com/shorts/a']) assert.ok(isYouTube(site));
  for (const site of ['https://youtube.com.evil.test/', 'https://example.com', 'http://youtube.com', 'not a URL', 'https://studio.youtube.com']) assert.ok(!isYouTube(site));
});
test('real worklet entry uses the stereo kernel and preserves bypass samples exactly', () => {
  let Processor, ready;
  const sandbox = {sampleRate: sr, AudioWorkletProcessor: class {constructor() {this.port = {postMessage: data => ready = data};}}, registerProcessor: (name, ctor) => {assert.equal(name, 'youtube-fx-pitch'); Processor = ctor;}};
  sandbox.globalThis = sandbox; vm.createContext(sandbox);
  for (const file of ['pitch-kernel.js', 'dsp.js', 'pitch-worklet.js']) vm.runInContext(fs.readFileSync(path.join(base, file), 'utf8').replace(/^import .*;\n/gm, ''), sandbox);
  const processor = new Processor({processorOptions: {resamplerTable: globalThis.YouTubeFXDSP.resamplerTable()}}); assert.equal(ready.algorithm, 'Signalsmith Stretch'); assert.equal(ready.channels, 2); assert.equal(ready.latencySamples, 14448);
  const input = [new Float32Array(128).fill(0.2), new Float32Array(128).fill(-0.3)], output = input.map(v => new Float32Array(v.length));
  assert.equal(processor.process([input], [output], {pitch: [0], active: [0]}), true);
  assert.deepEqual(output[0], input[0]); assert.deepEqual(output[1], input[1]);
  for (let i = 0; i < 100; i++) processor.process([input], [output], {pitch: [-7], active: [1]});
  assert.ok(output.every(channel => channel.every(Number.isFinite))); processor.port.onmessage({data: 'reset'});
});
