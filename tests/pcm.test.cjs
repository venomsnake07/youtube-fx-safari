'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = fs.existsSync(path.resolve(__dirname, '../manifest.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../extension');
require(path.join(root, 'dsp.js')); require(path.join(root, 'pcm-buffer.js')); require(path.join(root, 'stream-playback.js'));
const {PCMTimeline, DecodedTimeline} = globalThis.YouTubeFXPCM;
const sr = 48000;
const sine = (start, count, frequency = 440) => Float32Array.from({length: count}, (_, i) => .2 * Math.sin((start + i) * frequency * 2 * Math.PI / sr));
test('20 ms chunks render one continuous waveform without boundary gaps or repeated samples', () => {
  const queue = new PCMTimeline(sr);
  for (let p = 0; p < sr * 3; p += 960) queue.enqueue(p / sr, [sine(p, 960), sine(p, 960, 660)], sr);
  queue.play(0, 0); let worst = 0;
  for (let p = 0; p < sr * 10; p += 128) {
    if (p % (sr / 2) < 128) for (let start = Math.floor((p + sr * 2) / 960) * 960; start < p + sr * 3; start += 960) queue.enqueue(start / sr, [sine(start, 960), sine(start, 960, 660)], sr);
    const out = [new Float32Array(128), new Float32Array(128)]; queue.render(out, p);
    for (let i = 0; i < 128; i++) if (p + i >= 128) worst = Math.max(worst, Math.abs(out[0][i] - .2 * Math.sin((p + i) * 440 * 2 * Math.PI / sr)));
  }
  assert.ok(worst < 1e-7, 'maximum waveform error ' + worst); assert.equal(queue.stats().underrunFrames, 0);
});
test('late page refills do not interrupt already-buffered playback', () => {
  const queue = new PCMTimeline(sr); queue.enqueue(0, [sine(0, sr * 4)], sr); queue.play(0, 0);
  for (let p = 0; p < sr * 3; p += 128) queue.render([new Float32Array(128), new Float32Array(128)], p);
  assert.equal(queue.stats().underrunFrames, 0); assert.ok(queue.stats().bufferedMs > 990);
});
test('duplicate PCM delivery never mixes a frame twice', () => {
  const queue = new PCMTimeline(sr), samples = sine(0, 960); queue.enqueue(0, [samples], sr); queue.enqueue(0, [samples], sr);
  queue.play(0, 0); const out = [new Float32Array(960), new Float32Array(960)]; queue.render(out, 0);
  assert.equal(queue.stats().duplicateFrames, 960); assert.ok(Math.abs(out[0][500] - samples[500]) < 1e-8);
});
test('missing input is counted and fades rather than repeating audio chunks', () => {
  const queue = new PCMTimeline(sr); queue.enqueue(0, [new Float32Array(960).fill(.2)], sr); queue.play(0, 0);
  const out = [new Float32Array(1920), new Float32Array(1920)]; queue.render(out, 0);
  assert.equal(queue.stats().underruns, 1); assert.equal(queue.stats().underrunFrames, 960);
  assert.ok(Math.abs(out[0][1919]) < 1e-7); assert.ok(Math.abs(out[0][960] - out[0][959]) < .01);
});
test('reset clears old audio and supports absolute timestamps after a seek', () => {
  const queue = new PCMTimeline(sr); queue.enqueue(0, [new Float32Array(960).fill(.2)], sr); queue.reset();
  queue.enqueue(600, [new Float32Array(960).fill(-.1)], sr); queue.play(600, 1000);
  const out = [new Float32Array(960), new Float32Array(960)]; queue.render(out, 1000);
  assert.equal(queue.stats().underrunFrames, 0); assert.ok(out[0][500] < -.09);
});
test('small Opus timestamp rounding is normalized while real missing packets remain gaps', () => {
  const timeline = new DecodedTimeline();
  let end = 0;
  for (let i = 0; i < 1000; i++) {
    const jitter = i ? (i % 3 - 1) * .001 : 0;
    const chunk = timeline.append(i * .02 + jitter, [new Float32Array(960)], sr);
    assert.ok(Math.abs(chunk.start - end) < 1e-10); end = chunk.end;
  }
  assert.ok(timeline.adjustments > 0); assert.equal(timeline.gapFrames, 0);
  const gap = timeline.append(end + .04, [new Float32Array(960)], sr); assert.ok(gap.start > end); assert.equal(timeline.gapFrames, 1920);
});
test('duplicate decoded chunks are rejected', () => {
  const timeline = new DecodedTimeline(), data = [new Float32Array(960)]; assert.ok(timeline.append(0, data, sr)); assert.equal(timeline.append(0, data, sr), null); assert.equal(timeline.duplicates, 1);
});
test('packet lookup examines only the current playback window in a large cache', () => {
  const index = new globalThis.YouTubeFXPacketIndex(), packets = Array.from({length: 20106}, (_, id) => ({id, timestamp: id * 20000}));
  index.refresh({packets, generation: 1}); const range = index.range(10e6, 15e6);
  assert.equal(range.end - range.start, 251); assert.equal(range.items[range.start].timestamp, 10e6); assert.equal(index.visited, 251);
});
test('clock correction preserves treble instead of averaging away high frequencies', () => {
  const queue = new PCMTimeline(sr), count = sr * 3;
  queue.enqueue(0, [sine(0, count, 18000), sine(0, count, 16000)], sr); queue.play(0, 0); queue.setRate(1.0015);
  let energy = 0, samples = 0;
  for (let p = 0; p < sr * 2; p += 128) {
    const output = [new Float32Array(128), new Float32Array(128)]; queue.render(output, p);
    if (p > sr / 2) for (const value of output[0]) {energy += value * value; samples++;}
  }
  const rms = Math.sqrt(energy / samples);
  assert.ok(rms > 0.138 && rms < 0.145, '18 kHz level: ' + rms); assert.equal(queue.stats().underrunFrames, 0);
});
test('44.1 kHz packet conversion retains stereo treble across every packet boundary', () => {
  const sourceRate = 44100, queue = new PCMTimeline(sr), count = sourceRate * 3, frequency = 19000;
  for (let p = 0; p < count; p += 1024) {
    const samples = Float32Array.from({length: Math.min(1024, count - p)}, (_, i) => 0.2 * Math.sin((p + i) * frequency * 2 * Math.PI / sourceRate));
    queue.enqueue(p / sourceRate, [samples, samples.map(value => -value)], sourceRate);
  }
  queue.play(0, 0); let energy = 0, error = 0, samples = 0, stereoError = 0;
  for (let p = 0; p < sr * 2; p += 128) {
    const output = [new Float32Array(128), new Float32Array(128)]; queue.render(output, p);
    for (let i = 0; i < 128; i++) if (p + i > sr / 2) {
      energy += output[0][i] ** 2; error += (output[0][i] - 0.2 * Math.sin((p + i) * frequency * 2 * Math.PI / sr)) ** 2;
      stereoError += (output[0][i] + output[1][i]) ** 2; samples++;
    }
  }
  assert.ok(Math.sqrt(energy / samples) > 0.138); assert.ok(Math.sqrt(error / samples) < 0.001);
  assert.ok(stereoError < 1e-12); assert.equal(queue.stats().underrunFrames, 0); assert.equal(queue.stats().sourceSampleRate, sourceRate);
});
test('absolute timestamps and a paused queue never report hundreds of seconds of impossible buffer', () => {
  const queue = new PCMTimeline(sr); queue.reset(614.1);
  queue.enqueue(614, [new Float32Array(sr * 6).fill(.1)], sr); queue.pause();
  const state = queue.stats(); assert.ok(state.bufferedMs > 5800 && state.bufferedMs < 6000);
  assert.ok(state.bufferedMs <= state.capacityMs);
});
test('buffer accounting stops at a genuine hole instead of counting the furthest timestamp', () => {
  const queue = new PCMTimeline(sr); queue.enqueue(600, [new Float32Array(sr).fill(.1)], sr);
  queue.enqueue(602, [new Float32Array(sr).fill(.1)], sr); queue.play(600.5, 0);
  assert.ok(Math.abs(queue.stats().bufferedMs - 500) < .01);
});
test('a larger reserve survives ten seconds without page refills', () => {
  const queue = new PCMTimeline(sr, 1 << 20); queue.enqueue(0, [sine(0, sr * 14), sine(0, sr * 14, 660)], sr); queue.play(0, 0);
  const out = [new Float32Array(128), new Float32Array(128)];
  for (let p = 0; p < sr * 10; p += 128) queue.render(out, p);
  assert.equal(queue.stats().underrunFrames, 0); assert.ok(queue.stats().bufferedMs > 3990);
});
