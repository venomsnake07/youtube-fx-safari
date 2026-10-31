'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const base = fs.existsSync(path.resolve(__dirname, '../manifest.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../extension');
require(path.join(base, 'settings.js')); require(path.join(base, 'pitch-kernel.js')); require(path.join(base, 'dsp.js'));
const claimed = new WeakSet();
class Param {
  constructor(value = 0) {this.value = value; this.target = value; this.time = 0;}
  cancelScheduledValues() {}
  setValueAtTime(value, time) {this.value = value; this.time = time;}
  setTargetAtTime(value, time) {this.target = value; this.time = time;}
}
class AudioNode {
  constructor() {this.connections = new Set(); this.gain = new Param(1);}
  connect(node) {this.connections.add(node); return node;}
  disconnect(node) {if (node) this.connections.delete(node); else this.connections.clear();}
}
class Context {
  constructor() {
    this.sampleRate = 48000; this.currentTime = 0; this.state = 'suspended'; this.destination = new AudioNode(); this.claims = 0;
    this.audioWorklet = {addModule: async () => {throw new Error('Simulated Safari worklet restriction');}};
  }
  addEventListener() {}
  resume() {this.state = 'running'; return Promise.resolve();}
  createGain() {return new AudioNode();}
  createChannelSplitter() {return new AudioNode();}
  createAnalyser() {const node = new AudioNode(); node.fftSize = 2048; node.getFloatTimeDomainData = data => data.fill(0); return node;}
  createDelay() {const node = new AudioNode(); node.delayTime = new Param(); return node;}
  createBiquadFilter() {const node = new AudioNode(); node.frequency = new Param(); node.Q = new Param(); return node;}
  createDynamicsCompressor() {const node = new AudioNode(); for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Param(); return node;}
  createConvolver() {return new AudioNode();}
  createBuffer(channels, length) {const data = Array.from({length: channels}, () => new Float32Array(length)); return {getChannelData: c => data[c]};}
  createScriptProcessor() {return new AudioNode();}
  createMediaElementSource(media) {
    if (claimed.has(media)) throw Object.assign(new Error('Already claimed'), {name: 'InvalidStateError'});
    claimed.add(media); this.claims++; return new AudioNode();
  }
}
globalThis.AudioContext = Context;
globalThis.AudioWorkletNode = class {};
require(path.join(base, 'audio-engine.js'));
const Engine = globalThis.YouTubeFXAudioEngine;
const makeMedia = () => ({isConnected: true, addEventListener() {}, playbackRate: 1, paused: false, muted: false, volume: 1, readyState: 4, tagName: 'VIDEO', currentTime: 1});
const enabled = {...globalThis.YouTubeFXSettings.DEFAULTS, enabled: true};

test('worklet load failure selects the real fallback; enabled/disabled routing preserves the player speed', async () => {
  const engine = new Engine(file => file), media = makeMedia();
  engine.apply({...enabled, semitones: 7}); await engine.start(); engine.attach(media);
  assert.equal(engine.backend, 'Compatibility'); assert.equal(engine.status().attached, true);
  assert.equal(engine.context.claims, 1); assert.equal(media.playbackRate, 1);
  assert.equal(engine.bypass.gain.target, 0); assert.equal(engine.fx.gain.target, 1);
  const inChannels = [new Float32Array(2048).fill(0.1), new Float32Array(2048).fill(0.2)];
  const outChannels = [new Float32Array(2048), new Float32Array(2048)];
  engine.pitchNode.onaudioprocess({inputBuffer: {numberOfChannels: 2, getChannelData: c => inChannels[c]}, outputBuffer: {getChannelData: c => outChannels[c]}});
  assert.ok(outChannels.every(channel => channel.every(Number.isFinite)));
  engine.apply({...enabled, enabled: false});
  assert.equal(engine.bypass.gain.target, 1); assert.equal(engine.fx.gain.target, 0); assert.equal(engine.pitchActive, false);
});
test('a reused YouTube video is claimed once, disconnected elements are released, and reattached elements work', async () => {
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start();
  const old = makeMedia(); engine.attach(old); engine.attach(old);
  assert.equal(engine.context.claims, 1);
  old.isConnected = false; engine.prune(); assert.equal(engine.activeSources.size, 0);
  old.isConnected = true; engine.attach(old); assert.equal(engine.context.claims, 1);
  const replacement = makeMedia(); engine.attach(replacement); assert.equal(engine.context.claims, 2);
  assert.equal(engine.status().attached, true);
});
test('leaving a video page bypasses effects and protected audio is not claimed', async () => {
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start();
  engine.apply(enabled, false); assert.equal(engine.bypass.gain.target, 1);
  const protectedVideo = {...makeMedia(), mediaKeys: {}};
  engine.attach(protectedVideo); assert.equal(engine.context.claims, 0); assert.match(engine.error, /protected audio/);
});
test('another extension owning the media yields an actionable error and bypass', async () => {
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start();
  const media = makeMedia(); claimed.add(media); engine.attach(media);
  assert.match(engine.error, /Another audio extension/); assert.equal(engine.bypass.gain.target, 1); assert.equal(engine.fx.gain.target, 0);
});
test('repeated settings updates do not cancel the pitch startup warmup', async () => {
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start();
  engine.apply({...enabled, semitones: 3}); const readyAt = engine.pitchReadyAt;
  engine.context.currentTime += 0.01; engine.apply({...enabled, semitones: 3, reverb: 40});
  assert.equal(engine.pitchReadyAt, readyAt); assert.ok(engine.pitchWet.gain.time >= readyAt - 1e-6);
});
test('a stopped worklet fails open and cannot be accidentally re-enabled', async t => {
  const PreviousContext = globalThis.AudioContext, PreviousNode = globalThis.AudioWorkletNode;
  globalThis.AudioContext = class extends Context {constructor() {super(); this.audioWorklet = {addModule: async () => {}};}};
  globalThis.AudioWorkletNode = class extends AudioNode {constructor() {super(); this.parameters = new Map([['pitch', new Param()], ['active', new Param()]]); this.port = {postMessage() {}}; queueMicrotask(() => this.port.onmessage?.({data: {type: 'pitch-ready', algorithm: 'Signalsmith Stretch', channels: 2, latencySamples: 7200}}));}};
  t.after(() => {globalThis.AudioContext = PreviousContext; globalThis.AudioWorkletNode = PreviousNode;});
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start(); engine.attach(makeMedia());
  assert.equal(engine.backend, 'AudioWorklet'); engine.pitchNode.onprocessorerror();
  assert.equal(engine.bypass.gain.target, 1); assert.equal(engine.fx.gain.target, 0); assert.equal(engine.fatal, true);
  await assert.rejects(engine.start(), /reload YouTube/);
});
test('an audio context that Safari has not unlocked never claims the media element', async t => {
  const PreviousContext = globalThis.AudioContext;
  globalThis.AudioContext = class extends Context {resume() {return Promise.resolve();}};
  t.after(() => {globalThis.AudioContext = PreviousContext;});
  const engine = new Engine(file => file);
  await assert.rejects(engine.start(), /Enable audio/);
  assert.equal(engine.context.claims, 0); assert.equal(engine.ready, false);
});
test('a worklet load that never settles falls back instead of leaving nonfunctional controls', async t => {
  const PreviousContext = globalThis.AudioContext;
  globalThis.AudioContext = class extends Context {constructor() {super(); this.audioWorklet = {addModule: () => new Promise(() => {})};}};
  t.after(() => {globalThis.AudioContext = PreviousContext;});
  const engine = new Engine(file => file); engine.workletTimeout = 15;
  await engine.start(); assert.equal(engine.ready, true); assert.equal(engine.backend, 'Compatibility');
});
test('running status alone does not claim audio was detected, and muted/paused media do not trigger a no-signal warning', async () => {
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start(); const media = makeMedia(); engine.attach(media);
  let clock = 100; engine.clockNow = () => clock;
  engine.sampleSignal(); assert.equal(engine.status().signal, false); assert.equal(engine.status().noSignal, false);
  clock += 5000; engine.sampleSignal(); assert.equal(engine.status().noSignal, true);
  media.paused = true; engine.sampleSignal(); assert.equal(engine.status().noSignal, false);
  media.paused = false; media.muted = true; engine.sampleSignal(); clock += 5000; engine.sampleSignal(); assert.equal(engine.status().noSignal, false);
});
test('the indicator measures PCM samples and diagnostics omit signed media URLs', async () => {
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start();
  engine.attach({...makeMedia(), src: 'https://googlevideo.com/audio?secret=SIGNED_TOKEN'});
  engine.inputAnalyser.getFloatTimeDomainData = data => data.fill(0.05);
  engine.outputAnalyser.getFloatTimeDomainData = data => data.fill(0.02);
  engine.sampleSignal(); assert.equal(engine.status().signal, true); assert.ok(engine.inputPeak > 0);
  const report = engine.diagnostics(); assert.equal(report.players[0].source, 'URL');
  assert.doesNotMatch(JSON.stringify(report), /SIGNED_TOKEN|googlevideo/);
});
test('stereo signal monitoring detects right-only audio without canceling the channels together', async () => {
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start(); engine.attach(makeMedia());
  engine.inputRightAnalyser.getFloatTimeDomainData = data => data.fill(.07);
  engine.outputRightAnalyser.getFloatTimeDomainData = data => data.fill(.03);
  engine.sampleSignal(); const data = engine.diagnostics();
  assert.equal(data.audio.signal, true); assert.ok(data.inputChannelPeaks[1] > .069); assert.equal(data.inputChannelPeaks[0], 0);
});
test('recovery classifies seeking events before pitch history is cleared', async () => {
  const callbacks = {}, media = {...makeMedia(), addEventListener(type, callback) {callbacks[type] = callback;}};
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start(); engine.attach(media);
  engine.recovery = {media}; let resets = 0; engine.fallbackStereo.reset = () => resets++;
  callbacks.seeking({type: 'seeking'}); assert.equal(resets, 0);
  callbacks.emptied({type: 'emptied'}); assert.equal(resets, 1);
});
test('rapid decay changes construct only one convolution tail after controls settle', async () => {
  const engine = new Engine(file => file); engine.apply(enabled); await engine.start(); const built = [];
  engine.setDecay = seconds => {built.push(seconds); engine.currentDecay = seconds;};
  for (const decay of [1, 2, 3, 4, 4.8]) engine.apply({...enabled, decay});
  assert.equal(built.length, 0); await new Promise(resolve => setTimeout(resolve, 190)); assert.deepEqual(built, [4.8]);
});
test('manifest and packaged resources have YouTube-only scope and no remote executable code', () => {
  const root = base;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'storage']);
  for (const match of [...manifest.host_permissions, ...manifest.content_scripts.flatMap(script => script.matches)]) assert.match(match, /^https:\/\/(www\.|music\.|m\.)?youtube\.com\/\*$/);
  for (const file of [...manifest.content_scripts.flatMap(script => script.js), ...manifest.web_accessible_resources.flatMap(group => group.resources), manifest.action.default_popup]) assert.ok(fs.existsSync(path.join(root, file)), file);
  for (const file of fs.readdirSync(root).filter(name => name.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(code, /\beval\s*\(|new Function\s*\(|\bfetch\s*\(|XMLHttpRequest|\.playbackRate\s*=/, file);
  }
});
