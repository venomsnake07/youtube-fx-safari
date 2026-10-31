'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = fs.existsSync(path.resolve(__dirname, '../manifest.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../extension');
const fixtures = fs.existsSync(path.join(__dirname, 'fixtures')) ? path.join(__dirname, 'fixtures') : path.resolve(__dirname, '../../stream-fixtures');
require(path.join(root, 'stream-cache.js'));
const {PacketCache, sameConfig} = globalThis.YouTubeFXStreamCache;
function fixture() {
  let serial = 0; const media = {src: '', currentTime: 0};
  class SourceBuffer {
    constructor() {this.timestampOffset = 0; this.nativeCalls = 0;}
    appendBuffer(value) {if (this.failNext) {this.failNext = false; throw new Error('Native append failed');} this.lastNativeInput = value; this.nativeCalls++; return 'native result';}
    changeType() {return 'native change';} abort() {return 'native abort';}
  }
  class MediaSource {addSourceBuffer() {return new SourceBuffer();}}
  const sandbox = {TextDecoder, TextEncoder, document: {querySelectorAll: () => [media]}, MediaSource, SourceBuffer,
    AudioDecoder: class {}, URL: {createObjectURL: () => 'blob:fixture-' + (++serial), revokeObjectURL() {}}, queueMicrotask};
  sandbox.globalThis = sandbox; vm.createContext(sandbox);
  for (const name of ['stream-cache.js', 'stream-demux.js', 'stream-tap.js']) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), sandbox);
  const source = new sandbox.MediaSource(); media.src = sandbox.URL.createObjectURL(source);
  return {source, media, tap: sandbox.__youtubeFXTap};
}
for (const type of ['mp4', 'webm']) test(`${type}: fifty repeated headers/fragments retain one decoder configuration and one packet copy`, () => {
  const f = fixture(), mime = type === 'mp4' ? 'audio/mp4; codecs="mp4a.40.2"' : 'audio/webm; codecs="opus"';
  const buffer = f.source.addSourceBuffer(mime), bytes = fs.readFileSync(path.join(fixtures, 'audio.' + type));
  assert.equal(buffer.appendBuffer(bytes), 'native result'); const track = f.tap.find(f.media), count = track.packets.length;
  for (let i = 1; i < 50; i++) buffer.appendBuffer(bytes);
  assert.equal(buffer.nativeCalls, 50); assert.equal(buffer.lastNativeInput, bytes);
  assert.equal(track.generation, 1); assert.equal(track.packets.length, count);
  assert.equal(track.cache.duplicates, count * 49); assert.equal(track.configRepeats, 49);
  assert.equal(f.tap.diagnostics().packets, count * 50);
  assert.equal(f.tap.diagnostics().cachedBytes, track.cache.bytes);
});
test('same changeType/init header does not clear useful audio, but a real decoder-description change does', () => {
  const f = fixture(), buffer = f.source.addSourceBuffer('audio/webm; codecs="opus"');
  const data = fs.readFileSync(path.join(fixtures, 'audio.webm')); buffer.appendBuffer(data);
  const track = f.tap.find(f.media), count = track.packets.length;
  buffer.changeType('audio/webm; codecs="opus"'); buffer.appendBuffer(data);
  assert.equal(track.generation, 1); assert.equal(track.packets.length, count);
  const changed = Buffer.from(data), head = changed.indexOf('OpusHead'); assert.ok(head >= 0); changed[head + 12] ^= 1;
  buffer.appendBuffer(changed); assert.equal(track.generation, 2); assert.equal(track.configChanges, 2); assert.equal(track.packets.length, count);
});
test('native append failures leave the extension cache untouched', () => {
  const f = fixture(), buffer = f.source.addSourceBuffer('audio/webm; codecs="opus"'), data = fs.readFileSync(path.join(fixtures, 'audio.webm'));
  buffer.appendBuffer(data); const track = f.tap.find(f.media), revision = track.revision;
  buffer.failNext = true; assert.throws(() => buffer.appendBuffer(data), /Native append failed/); assert.equal(track.revision, revision);
});
test('track choice follows current-time coverage and does not jump to a stale prefetched track', () => {
  const f = fixture(), data = fs.readFileSync(path.join(fixtures, 'audio.webm'));
  const a = f.source.addSourceBuffer('audio/webm; codecs="opus"'); a.appendBuffer(data); const first = f.tap.find(f.media);
  const b = f.source.addSourceBuffer('audio/webm; codecs="opus"'); b.timestampOffset = 8; b.appendBuffer(data);
  f.media.currentTime = 10; const second = f.tap.find(f.media, first); assert.notEqual(first, second);
  a.appendBuffer(data); assert.equal(f.tap.find(f.media, second), second);
});
test('bulk cache eviction protects the playback position and remains within byte and packet limits', () => {
  for (const playhead of [0, 1.5]) {
    const cache = new PacketCache(1024, 6);
    for (let i = 0; i < 100; i++) cache.add({timestamp: i * 20000, duration: 20000, data: new Uint8Array(256).fill(i)});
    cache.commit(playhead); assert.ok(cache.bytes <= 1024); assert.ok(cache.items.length <= 6); assert.ok(cache.covers(playhead));
    assert.equal(cache.byTime.size, cache.items.length);
  }
});
test('out-of-order packets are indexed once; overlapping replacement cannot multiply a timestamp', () => {
  const cache = new PacketCache();
  for (const timestamp of [60000, 0, 40000, 20000]) cache.add({timestamp, duration: 20000, data: Uint8Array.of(1)});
  cache.commit(); assert.deepEqual(cache.items.map(p => p.timestamp), [0, 20000, 40000, 60000]);
  cache.add({timestamp: 40000, duration: 20000, data: Uint8Array.of(2, 3)}); cache.commit();
  assert.equal(cache.items.length, 4); assert.equal(cache.bytes, 5); assert.equal(cache.replaced, 1);
});
test('decoder configuration identity includes channels, rate and exact codec description', () => {
  const a = {codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description: Uint8Array.of(1, 2)};
  assert.ok(sameConfig(a, {...a, description: Uint8Array.of(1, 2)}));
  assert.ok(!sameConfig(a, {...a, numberOfChannels: 1})); assert.ok(!sameConfig(a, {...a, description: Uint8Array.of(1, 3)}));
});
