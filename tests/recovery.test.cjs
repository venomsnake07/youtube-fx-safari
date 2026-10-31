'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = fs.existsSync(path.resolve(__dirname, '../manifest.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../extension');
require(path.join(root, 'pcm-buffer.js')); require(path.join(root, 'stream-playback.js')); require(path.join(root, 'stream-recovery.js'));
const Recovery = globalThis.YouTubeFXStreamRecovery;
function make() {
  const original = {enabled: true}, media = {isConnected: true, mediaKeys: null, playbackRate: 1, currentTime: .1, readyState: 4, paused: false, seeking: false, volume: .4, muted: false, audioTracks: [original]};
  const track = {config: {codec: 'opus'}, packets: [], generation: 1};
  globalThis.__youtubeFXTap = {find: () => track};
  const nodes = [];
  const engine = {settings: {enabled: true}, supportedPage: true, fatal: false, input: {}, pitchResets: 0, resetPitch() {this.pitchResets++;}, context: {currentTime: .1, state: 'running', createBufferSource() {const node = {connect() {}, disconnect() {}, start(when, offset) {this.when = when; this.offset = offset;}, stop() {this.stopped = true;}}; nodes.push(node); return node;}}};
  const recovery = new Recovery(engine); recovery.media = media; recovery.track = track;
  recovery.decoder = {state: 'configured', decodeQueueSize: 0, close() {this.state = 'closed';}};
  recovery.configGeneration = 1; recovery.gain = {gain: {value: 0}, disconnect() {}};
  recovery.transport = {ready: true, resets: 0, reset() {this.resets++; nodes.forEach(node => node.stopped = true);}, enqueue() {}, play(time, when) {nodes.push({time, when});}, pause() {nodes.forEach(node => node.stopped = true);}, rate() {}, stats() {return {bufferedMs: 1000, underrunFrames: 0};}, destroy() {}};
  return {recovery, engine, media, original, nodes};
}
test('recovery leaves original audio enabled until a decoded buffer covers the playback position', () => {
  const {recovery, original} = make(); recovery.tick(); assert.equal(original.enabled, true); assert.equal(recovery.active, false);
});
test('a decoded buffer switches from native audio to local playback at the original volume', () => {
  const {recovery, original, nodes} = make(); recovery.buffers = [{start: 0, end: 1, buffer: {duration: 1}, key: 'a'}]; recovery.tick();
  assert.equal(original.enabled, false); assert.equal(recovery.active, true); assert.equal(recovery.gain.gain.value, .4);
  assert.equal(nodes.length, 1); assert.ok(nodes[0].time >= .1 && nodes[0].time < .2);
});
test('turning effects off restores native audio and stops every scheduled source', () => {
  const {recovery, original, nodes} = make(); recovery.buffers = [{start: 0, end: 1, buffer: {duration: 1}, key: 'a'}]; recovery.tick(); recovery.stop();
  assert.equal(original.enabled, true); assert.equal(recovery.active, false); assert.ok(nodes.every(node => node.stopped));
});
test('a decoder failure restores original sound', () => {
  const {recovery, original} = make(); recovery.buffers = [{start: 0, end: 1, buffer: {duration: 1}, key: 'a'}]; recovery.tick(); recovery.fail('decoder error');
  assert.equal(original.enabled, true); assert.equal(recovery.active, false); assert.equal(recovery.phase, 'error');
});
test('pause restores native track state while retaining decoded coverage and the queue', () => {
  const {recovery, original, media, nodes} = make(); recovery.buffers = [{start: 0, end: 1, buffer: {duration: 1}, key: 'a'}]; recovery.tick(); media.paused = true; recovery.tick();
  assert.equal(original.enabled, true); assert.ok(nodes.every(node => node.stopped));
  assert.equal(recovery.transport.resets, 0); assert.equal(recovery.buffers.length, 1); assert.equal(recovery.decoder.state, 'configured');
});
test('a transient readyState/seeking flag during progressing playback does not cut or reset audio', () => {
  const {recovery, engine, media, nodes, original} = make(); recovery.buffers = [{start: 0, end: 10, key: 'a'}]; recovery.tick();
  media.seeking = true; media.readyState = 1; engine.context.currentTime = media.currentTime = .25; recovery.tick();
  assert.equal(recovery.active, true); assert.equal(original.enabled, false); assert.equal(recovery.transport.resets, 0);
  assert.equal(engine.pitchResets, 0); assert.equal(nodes.length, 1); assert.equal(recovery.phase, 'active');
});
test('pause/resume reuses decoded audio without decoder or PCM resets', () => {
  const {recovery, engine, media, nodes} = make(); recovery.buffers = [{start: 0, end: 10, key: 'a'}]; recovery.tick();
  media.paused = true; engine.context.currentTime = 1; recovery.tick();
  media.paused = false; media.currentTime = .12; engine.context.currentTime = 1.02; recovery.tick();
  assert.equal(recovery.active, true); assert.equal(recovery.transport.resets, 0); assert.equal(nodes.length, 2);
  assert.equal(recovery.resumeCount, 1); assert.equal(engine.pitchResets, 0);
});
test('a genuinely stalled player pauses the queue but does not discard it', () => {
  const {recovery, engine, media} = make(); recovery.buffers = [{start: 0, end: 10, key: 'a'}]; recovery.tick();
  engine.context.currentTime = .8; recovery.tick(); assert.equal(recovery.phase, 'buffering'); assert.equal(recovery.transport.resets, 0);
  media.currentTime = .2; engine.context.currentTime = .9; recovery.tick();
  assert.equal(recovery.phase, 'active'); assert.equal(recovery.transport.resets, 0); assert.equal(recovery.resumeCount, 1);
});
test('an audio clock delayed relative to wall time does not masquerade as a forward seek', () => {
  const {recovery, engine, media} = make(); let wall = .1; recovery.wallNow = () => wall;
  recovery.buffers = [{start: 0, end: 30, key: 'a'}]; recovery.tick();
  wall = 10.1; media.currentTime = 10.1; engine.context.currentTime = 8.1; recovery.tick();
  assert.equal(recovery.active, true); assert.equal(recovery.transport.resets, 0); assert.equal(engine.pitchResets, 0);
});
test('a buffered forward jump reuses the decoded queue', () => {
  const {recovery, engine, media} = make(); let wall = .1, resets = 0; recovery.wallNow = () => wall;
  recovery.buffers = [{start: 0, end: 30, key: 'a'}]; recovery.tick(); recovery.makeDecoder = () => resets++;
  wall = .2; media.currentTime = 10.1; engine.context.currentTime = .2; recovery.tick();
  assert.equal(resets, 0); assert.equal(engine.pitchResets, 0);
});
test('an uncached forward seek still resets once', () => {
  const {recovery, engine, media} = make(); let wall = .1, resets = 0; recovery.wallNow = () => wall;
  recovery.buffers = [{start: 0, end: 1, key: 'a'}]; recovery.tick(); recovery.makeDecoder = () => resets++;
  wall = .2; media.currentTime = 10.1; engine.context.currentTime = .2; recovery.tick();
  assert.equal(resets, 1); assert.equal(engine.pitchResets, 1);
});
test('several stale-then-catching-up media clock samples after a page stall do not restart audio', () => {
  const {recovery, engine, media, nodes} = make(); let wall = .1; recovery.wallNow = () => wall;
  recovery.buffers = [{start: 0, end: 30, key: 'a'}]; recovery.tick();
  for (const [w, clock, time] of [[6.1, 6.1, 2.8], [6.2, 6.2, 3.8], [6.3, 6.3, 6.3]]) {
    wall = w; engine.context.currentTime = clock; media.currentTime = time; recovery.tick();
  }
  assert.equal(recovery.transport.resets, 0); assert.equal(engine.pitchResets, 0); assert.equal(nodes.length, 1);
});
test('seeking within retained data while paused does not start the PCM queue', () => {
  const {recovery, engine, media, nodes} = make(); recovery.buffers = [{start: 0, end: 10, key: 'a'}]; recovery.tick();
  media.paused = true; engine.context.currentTime = .2; recovery.tick();
  media.currentTime = 3; media.seeking = true; engine.context.currentTime = .3; recovery.tick();
  assert.equal(nodes.length, 1); assert.equal(recovery.active, false); assert.equal(recovery.transport.resets, 0);
});
test('non-normal YouTube speed keeps the native audio path and requests 1x without changing playbackRate', () => {
  const {recovery, original, media} = make(); media.playbackRate = 1.5; recovery.tick();
  assert.equal(original.enabled, true); assert.equal(media.playbackRate, 1.5); assert.match(recovery.message, /Normal/);
});
test('recovery preloads and advances decoded input by the pitch processor latency', () => {
  const {recovery, engine, nodes} = make(); engine.processingLatencySeconds = () => .318;
  recovery.buffers = [{start: 0, end: .4, key: 'a'}]; recovery.tick(); assert.equal(recovery.active, false);
  recovery.buffers.push({start: .4, end: 3, key: 'b'}); recovery.tick();
  assert.equal(recovery.active, true); assert.ok(Math.abs(nodes[0].time - .443) < 1e-10);
  assert.equal(recovery.diagnostics().latencyCompensationMs, 318);
});
test('latency retargeting waits for pitch controls to settle and does not restart continuously', () => {
  const {recovery, engine, media, nodes} = make(); let latency = .318; engine.processingLatencySeconds = () => latency;
  recovery.buffers = [{start: 0, end: 10, key: 'a'}]; recovery.tick();
  latency = .25; engine.context.currentTime = media.currentTime = .2; recovery.tick();
  engine.context.currentTime = media.currentTime = .4; recovery.tick(); assert.equal(nodes.length, 1);
  engine.context.currentTime = media.currentTime = .6; recovery.tick(); assert.equal(nodes.length, 2);
  engine.context.currentTime = media.currentTime = .8; recovery.tick(); assert.equal(nodes.length, 2);
  assert.equal(recovery.decoder.state, 'configured'); assert.equal(recovery.lookahead, .25);
});
