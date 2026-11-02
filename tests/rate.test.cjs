'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const file of ['settings.js', 'pitch-kernel.js', 'dsp.js', 'pcm-buffer.js']) require(path.join(root, file));
const S = globalThis.YouTubeFXSettings, {PCMTimeline} = globalThis.YouTubeFXPCM;
const sr = 48000;
function frequency(data) {
  let first, last, count = 0;
  for (let i = sr + 1; i < sr * 2; i++) if (data[i - 1] <= 0 && data[i] > 0) {
    const at = i - 1 - data[i - 1] / (data[i] - data[i - 1]);
    if (first === undefined) first = at; last = at; count++;
  }
  return (count - 1) * sr / (last - first);
}
function rms(data) {let energy = 0; for (let i = sr; i < sr * 2; i++) energy += data[i] ** 2; return Math.sqrt(energy / sr);}
function render(rate, targetPitch, tones = [440, 660]) {
  const timeline = new PCMTimeline(sr, 1 << 20), frames = sr * 3;
  const input = tones.map(f => Float32Array.from({length: sr * 7}, (_, i) => .2 * Math.sin(2 * Math.PI * f * i / sr)));
  timeline.enqueue(0, input, sr); timeline.setRate(rate, true); timeline.play(0, 0);
  const output = [new Float32Array(frames), new Float32Array(frames)];
  const processor = targetPitch === undefined ? null : new YouTubeFXDSP.StereoPitch(sr);
  const correction = (targetPitch || 0) - 12 * Math.log2(rate);
  for (let frame = 0; frame < frames; frame += 128) {
    const block = output.map(channel => channel.subarray(frame, frame + 128));
    if (!processor) timeline.render(block, frame);
    else {
      const source = [new Float32Array(block[0].length), new Float32Array(block[0].length)];
      timeline.render(source, frame); processor.process(source, block, correction);
    }
  }
  assert.equal(timeline.stats().underrunFrames, 0);
  return {output, timeline};
}
test('legacy saved pitch migrates without changing tempo; new defaults are linked', () => {
  assert.equal(S.normalize({enabled: true, semitones: -1, reverb: 62}).linked, false);
  assert.equal(S.normalize({semitones: -1}).rate, 100);
  assert.equal(S.normalize().linked, true);
  assert.equal(S.patch(S.DEFAULTS, {semitones: 3}).linked, false);
  assert.equal(S.normalize({rate: -10, linked: 'yes'}).rate, 50);
  assert.equal(S.normalize({rate: Infinity}).rate, 100);
  assert.equal(S.normalize({rate: 900}).rate, 200);
});
for (const rate of [.5, .95, 1, 1.5, 2]) test(`linked ${rate * 100}% changes pitch and duration naturally while preserving both stereo channels`, () => {
  const {output, timeline} = render(rate);
  for (let channel = 0; channel < 2; channel++) {
    const expected = (channel ? 660 : 440) * rate, measured = frequency(output[channel]);
    assert.ok(Math.abs(1200 * Math.log2(measured / expected)) < .02, `${measured} vs ${expected}`);
    assert.ok(Math.abs(rms(output[channel]) - .2 / Math.sqrt(2)) < .0002);
  }
  assert.ok(Math.abs(timeline.stats().mediaTime - 3 * rate) < 1 / sr);
});
for (const [rate, pitch] of [[.5, 12], [.95, 0], [.95, -3], [1.5, 3], [2, -12]]) test(`independent ${rate * 100}% speed / ${pitch} semitones keeps the requested pitch in stereo`, () => {
  const {output} = render(rate, pitch);
  for (let channel = 0; channel < 2; channel++) {
    const expected = (channel ? 660 : 440) * 2 ** (pitch / 12), measured = frequency(output[channel]);
    assert.ok(Math.abs(1200 * Math.log2(measured / expected)) < 4, `${measured} vs ${expected}`);
    assert.ok(rms(output[channel]) > .11 && rms(output[channel]) < .17);
  }
});
test('95% linked playback retains stereo treble; 200% rejects out-of-band aliasing', () => {
  const slow = render(.95, undefined, [14000, 17000]).output;
  assert.ok(slow.every(channel => rms(channel) > .14));
  const fast = render(2, undefined, [16000, 18000]).output;
  assert.ok(fast.every(channel => rms(channel) < .0001), 'Ultrasonic input must not fold back into the audible band');
});
test('rate changes retain cached PCM and continue from the current sample', () => {
  const timeline = new PCMTimeline(sr), source = new Float32Array(sr * 3).fill(.2);
  timeline.enqueue(0, [source, source.map(v => -v)], sr); timeline.play(0, 0);
  const out = [new Float32Array(sr), new Float32Array(sr)]; timeline.render(out, 0);
  timeline.setRate(.95, true); timeline.render(out, sr);
  assert.ok(Math.abs(timeline.stats().mediaTime - 1.95) < 1 / sr);
  assert.equal(timeline.stats().underruns, 0); assert.equal(timeline.stats().duplicateFrames, 0);
  for (let i = 0; i < sr; i++) assert.ok(Math.abs(out[0][i] + out[1][i]) < 1e-7);
});
