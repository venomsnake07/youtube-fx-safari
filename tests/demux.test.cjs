'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const base = fs.existsSync(path.resolve(__dirname, '../manifest.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../extension');
require(path.join(base, 'stream-demux.js'));
const fixtureRoot = fs.existsSync(path.join(__dirname, 'fixtures')) ? path.join(__dirname, 'fixtures') : path.resolve(__dirname, '../../stream-fixtures');
for (const [type, Constructor, codec, count] of [['mp4', YouTubeFXDemux.MP4Audio, 'mp4a.40.2', 376], ['webm', YouTubeFXDemux.WebMAudio, 'opus', 401], ['opus.mp4', YouTubeFXDemux.MP4Audio, 'opus', 401]]) {
  for (const chunkSize of [13, 777, 4096, 1000000]) test(`${type} demux preserves every clear audio packet across ${chunkSize}-byte appends`, () => {
    const filename = type === 'opus.mp4' ? 'audio-opus.mp4' : 'audio.' + type;
    const bytes = fs.readFileSync(path.join(fixtureRoot, filename)); let config; const packets = [];
    const parser = new Constructor(value => config = value, value => packets.push(value));
    for (let p = 0; p < bytes.length; p += chunkSize) parser.append(bytes.subarray(p, p + chunkSize));
    assert.equal(config.codec, codec); assert.equal(config.sampleRate, 48000); assert.equal(config.numberOfChannels, 2);
    assert.equal(packets.length, count); assert.ok(config.description.length >= 2);
    assert.ok(packets.every((packet, i) => packet.data.length > 0 && packet.duration > 0 && Number.isFinite(packet.timestamp) && (!i || packet.timestamp >= packets[i - 1].timestamp)));
    assert.ok(packets.at(-1).timestamp > 7.9e6 && packets.at(-1).timestamp < 8.1e6);
  });
}
test('Opus duration follows the TOC frame configuration', () => {
  assert.equal(YouTubeFXDemux.opusDuration(Uint8Array.of(0)), 10000);
  assert.equal(YouTubeFXDemux.opusDuration(Uint8Array.of(16 << 3)), 2500);
  assert.equal(YouTubeFXDemux.opusDuration(Uint8Array.of((19 << 3) | 1)), 40000);
  assert.equal(YouTubeFXDemux.opusDuration(Uint8Array.of((19 << 3) | 3, 3)), 60000);
});
