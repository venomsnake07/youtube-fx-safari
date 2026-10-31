/* Minimal clear-audio demuxers for the fMP4/AAC and WebM/Opus buffers used by
 * YouTube. No requests, decryption, playback changes, or third-party code. */
(() => {
  'use strict';
  const concat = (a, b) => {const result = new Uint8Array(a.length + b.length); result.set(a); result.set(b, a.length); return result;};
  const text = bytes => new TextDecoder().decode(bytes);
  const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function boxes(data, start = 0, end = data.length) {
    const list = [], dv = view(data);
    for (let p = start; p + 8 <= end;) {
      let size = dv.getUint32(p), header = 8;
      if (size === 1) {if (p + 16 > end) break; size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12); header = 16;}
      if (size === 0) size = end - p;
      if (size < header || !Number.isSafeInteger(size) || p + size > end) break;
      list.push({type: text(data.subarray(p + 4, p + 8)), start: p, data: p + header, end: p + size}); p += size;
    }
    return list;
  }
  const child = (data, box, name) => box && boxes(data, box.data, box.end).find(item => item.type === name);
  function ascDescriptor(bytes, from, end) {
    for (let p = from; p + 2 <= end;) {
      const tag = bytes[p++]; let size = 0, count = 0, digit;
      do {if (p >= end || count++ > 3) return null; digit = bytes[p++]; size = size * 128 + (digit & 127);} while (digit & 128);
      const stop = p + size; if (stop > end) return null;
      if (tag === 5) return bytes.slice(p, stop);
      let nested = p;
      if (tag === 3) {
        if (p + 3 > stop) return null; const flags = bytes[p + 2]; nested = p + 3;
        if (flags & 128) nested += 2;
        if (flags & 64) {if (nested >= stop) return null; nested += 1 + bytes[nested];}
        if (flags & 32) nested += 2;
      } else if (tag === 4) nested = p + 13;
      else {p = stop; continue;}
      const result = nested < stop ? ascDescriptor(bytes, nested, stop) : null;
      if (result) return result; p = stop;
    }
    return null;
  }
  class MP4Audio {
    constructor(onConfig, onPacket) {this.onConfig = onConfig; this.onPacket = onPacket; this.pending = new Uint8Array(); this.track = null; this.moof = null;}
    init(bytes, moov) {
      const dv = view(bytes);
      for (const trak of boxes(bytes, moov.data, moov.end).filter(box => box.type === 'trak')) {
        const tkhd = child(bytes, trak, 'tkhd'), mdia = child(bytes, trak, 'mdia');
        const hdlr = child(bytes, mdia, 'hdlr'), mdhd = child(bytes, mdia, 'mdhd');
        if (!tkhd || !mdhd || !hdlr || text(bytes.subarray(hdlr.data + 8, hdlr.data + 12)) !== 'soun') continue;
        const minf = child(bytes, mdia, 'minf'), stbl = child(bytes, minf, 'stbl'), stsd = child(bytes, stbl, 'stsd');
        const entry = stsd && boxes(bytes, stsd.data + 8, stsd.end)[0];
        if (!entry || !['mp4a', 'Opus'].includes(entry.type) || entry.data + 28 > entry.end) continue;
        const version = dv.getUint16(entry.data + 8), extra = version === 1 ? 16 : version === 2 ? 36 : 0;
        const extensions = boxes(bytes, entry.data + 28 + extra, entry.end);
        const esds = extensions.find(box => box.type === 'esds'), dops = extensions.find(box => box.type === 'dOps');
        let description = esds && ascDescriptor(bytes, esds.data + 4, esds.end), codec;
        if (entry.type === 'Opus' && dops && dops.end - dops.data >= 11) {
          const input = bytes.subarray(dops.data, dops.end); description = new Uint8Array(19 + Math.max(0, input.length - 11));
          description.set(new TextEncoder().encode('OpusHead')); description[8] = 1; description[9] = input[1];
          const head = view(description); head.setUint16(10, view(input).getUint16(2), true); head.setUint32(12, view(input).getUint32(4), true); head.setInt16(16, view(input).getInt16(8), true);
          description[18] = input[10]; if (input.length > 11) description.set(input.subarray(11), 19); codec = 'opus';
        }
        if (!description) continue;
        const objectType = description[0] >> 3;
        const timescale = dv.getUint32(mdhd.data + (bytes[mdhd.data] === 1 ? 20 : 12));
        const id = dv.getUint32(tkhd.data + (bytes[tkhd.data] === 1 ? 20 : 12));
        const channels = dv.getUint16(entry.data + 16), sampleRate = dv.getUint32(entry.data + 24) >>> 16;
        const mvex = child(bytes, moov, 'mvex'); let duration = 1024, sampleSize = 0;
        for (const trex of mvex ? boxes(bytes, mvex.data, mvex.end) : []) if (trex.type === 'trex' && dv.getUint32(trex.data + 4) === id) {
          duration = dv.getUint32(trex.data + 12) || duration; sampleSize = dv.getUint32(trex.data + 16);
        }
        this.track = {id, timescale, duration, sampleSize};
        this.onConfig({codec: codec || 'mp4a.40.' + objectType, sampleRate, numberOfChannels: channels, description});
        return;
      }
    }
    fragment(bytes) {
      if (!this.track) return;
      const dv = view(bytes), top = boxes(bytes), moof = top.find(box => box.type === 'moof'), mdat = top.find(box => box.type === 'mdat');
      if (!moof || !mdat) return;
      for (const traf of boxes(bytes, moof.data, moof.end).filter(box => box.type === 'traf')) {
        const tfhd = child(bytes, traf, 'tfhd'), tfdt = child(bytes, traf, 'tfdt');
        if (!tfhd || !tfdt || dv.getUint32(tfhd.data + 4) !== this.track.id) continue;
        const flags = dv.getUint32(tfhd.data) & 0xffffff; let p = tfhd.data + 8, base = moof.start;
        if (flags & 1) {base = dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4); p += 8;}
        if (flags & 2) p += 4;
        let defaultDuration = this.track.duration, defaultSize = this.track.sampleSize;
        if (flags & 8) {defaultDuration = dv.getUint32(p); p += 4;}
        if (flags & 16) {defaultSize = dv.getUint32(p); p += 4;}
        const dt = tfdt.data + 4;
        let time = bytes[tfdt.data] === 1 ? dv.getUint32(dt) * 4294967296 + dv.getUint32(dt + 4) : dv.getUint32(dt);
        let cursor = mdat.data;
        for (const trun of boxes(bytes, traf.data, traf.end).filter(box => box.type === 'trun')) {
          const bits = dv.getUint32(trun.data) & 0xffffff, count = dv.getUint32(trun.data + 4); let pos = trun.data + 8;
          if (count > 100000) throw new Error('Invalid audio sample count');
          if (bits & 1) {cursor = base + dv.getInt32(pos); pos += 4;}
          if (bits & 4) pos += 4;
          for (let i = 0; i < count; i++) {
            const duration = bits & 256 ? dv.getUint32(pos) : defaultDuration; if (bits & 256) pos += 4;
            const size = bits & 512 ? dv.getUint32(pos) : defaultSize; if (bits & 512) pos += 4;
            if (bits & 1024) pos += 4;
            let composition = 0;
            if (bits & 2048) {composition = bytes[trun.data] === 1 ? dv.getInt32(pos) : dv.getUint32(pos); pos += 4;}
            if (!size || pos > trun.end || cursor < mdat.data || cursor + size > mdat.end) throw new Error('Incomplete audio fragment');
            this.onPacket({timestamp: Math.round((time + composition) * 1e6 / this.track.timescale), duration: Math.round(duration * 1e6 / this.track.timescale), data: bytes.slice(cursor, cursor + size)});
            cursor += size; time += duration;
          }
        }
      }
    }
    append(bytes) {
      this.pending = concat(this.pending, bytes); if (this.pending.length > 24 * 1024 * 1024) {this.pending = new Uint8Array(); throw new Error('Audio buffer exceeds limit');}
      let consumed = 0;
      for (const box of boxes(this.pending)) {
        if (box.type === 'moov') this.init(this.pending, box);
        if (box.type === 'moof') this.moof = this.pending.slice(box.start, box.end);
        if (box.type === 'mdat' && this.moof) {this.fragment(concat(this.moof, this.pending.subarray(box.start, box.end))); this.moof = null;}
        consumed = box.end;
      }
      this.pending = this.pending.slice(consumed);
    }
  }
  function vint(bytes, p, id = false) {
    if (p >= bytes.length || bytes[p] === 0) return null;
    let length = 1, mask = 128; while (!(bytes[p] & mask)) {mask >>= 1; if (++length > 8) return null;}
    if (p + length > bytes.length) return null;
    let value = id ? bytes[p] : bytes[p] & (mask - 1), unknown = !id && value === mask - 1;
    for (let i = 1; i < length; i++) {value = value * 256 + bytes[p + i]; unknown = unknown && bytes[p + i] === 255;}
    return {length, value, unknown};
  }
  const unsigned = bytes => {let n = 0; for (const value of bytes) n = n * 256 + value; return n;};
  function elements(bytes) {
    const result = []; let p = 0;
    while (p < bytes.length) {
      const id = vint(bytes, p, true); if (!id) break;
      const size = vint(bytes, p + id.length); if (!size) break;
      const data = p + id.length + size.length, end = size.unknown ? bytes.length : data + size.value;
      if (end > bytes.length) break;
      result.push({id: id.value, bytes: bytes.subarray(data, end)}); p = end;
    }
    return result;
  }
  function opusDuration(packet) {
    const config = packet[0] >> 3, code = packet[0] & 3;
    const single = config >= 16 ? 2.5 * 2 ** (config & 3) : config >= 12 ? 10 * 2 ** (config & 1) : [10, 20, 40, 60][config & 3];
    return single * (code === 0 ? 1 : code === 3 ? (packet[1] || 0) & 63 : 2) * 1000;
  }
  class WebMAudio {
    constructor(onConfig, onPacket) {this.onConfig = onConfig; this.onPacket = onPacket; this.pending = new Uint8Array(); this.stack = []; this.position = 0; this.scale = 1e6; this.clusterTime = 0; this.track = null;}
    tracks(bytes) {
      for (const entry of elements(bytes).filter(element => element.id === 0xae)) {
        const values = elements(entry.bytes), get = id => values.find(value => value.id === id)?.bytes;
        if (unsigned(get(0x83) || []) !== 2) continue;
        const codec = text(get(0x86) || new Uint8Array()); if (codec !== 'A_OPUS') continue;
        const audio = elements(get(0xe1) || new Uint8Array());
        const channels = unsigned(audio.find(value => value.id === 0x9f)?.bytes || [2]);
        this.track = unsigned(get(0xd7) || [1]);
        this.onConfig({codec: 'opus', sampleRate: 48000, numberOfChannels: channels, description: (get(0x63a2) || new Uint8Array()).slice()}); return;
      }
    }
    block(bytes) {
      const track = vint(bytes, 0); if (!track || track.value !== this.track || bytes.length < track.length + 3) return;
      const time = view(bytes).getInt16(track.length), flags = bytes[track.length + 2]; let p = track.length + 3;
      const lacing = (flags >> 1) & 3, sizes = []; let count = 1;
      if (lacing) {
        count = bytes[p++] + 1;
        if (lacing === 1) {
          for (let i = 0; i < count - 1; i++) {let n = 0, value; do {if (p >= bytes.length) throw new Error('Invalid audio lacing'); value = bytes[p++]; n += value;} while (value === 255); sizes.push(n);}
        } else if (lacing === 2) {const size = (bytes.length - p) / count; if (!Number.isInteger(size)) throw new Error('Invalid fixed lacing'); for (let i = 0; i < count - 1; i++) sizes.push(size);}
        else {
          const first = vint(bytes, p); if (!first) return; p += first.length; sizes.push(first.value);
          for (let i = 1; i < count - 1; i++) {const delta = vint(bytes, p); if (!delta) return; p += delta.length; sizes.push(sizes[i - 1] + delta.value - (2 ** (7 * delta.length - 1) - 1));}
        }
      }
      sizes.push(bytes.length - p - sizes.reduce((a, b) => a + b, 0));
      let timestamp = Math.round((this.clusterTime + time) * this.scale / 1000);
      for (const size of sizes) {
        if (size <= 0 || p + size > bytes.length) throw new Error('Invalid audio block');
        const data = bytes.slice(p, p + size), duration = opusDuration(data);
        this.onPacket({timestamp, duration, data}); timestamp += duration; p += size;
      }
    }
    append(bytes) {
      this.pending = concat(this.pending, bytes); if (this.pending.length > 24 * 1024 * 1024) throw new Error('Audio buffer exceeds limit');
      let p = 0;
      while (p < this.pending.length) {
        const id = vint(this.pending, p, true); if (!id) break;
        const size = vint(this.pending, p + id.length); if (!size) break;
        const header = id.length + size.length, stop = p + header + size.value;
        // Segment and Cluster are stream containers. Their contents can span appends.
        if (id.value === 0x18538067 || id.value === 0x1f43b675) {
          if (id.value === 0x1f43b675) this.clusterTime = 0;
          p += header; continue;
        }
        if (size.unknown || stop > this.pending.length) break;
        const payload = this.pending.subarray(p + header, stop);
        if (id.value === 0x1654ae6b) this.tracks(payload);
        else if (id.value === 0x1549a966) {const scale = elements(payload).find(value => value.id === 0x2ad7b1); if (scale) this.scale = unsigned(scale.bytes);}
        else if (id.value === 0xe7) this.clusterTime = unsigned(payload);
        else if (id.value === 0xa3) this.block(payload);
        else if (id.value === 0xa0) {const block = elements(payload).find(value => value.id === 0xa1); if (block) this.block(block.bytes);}
        p = stop;
      }
      this.pending = this.pending.slice(p);
    }
  }
  globalThis.YouTubeFXDemux = Object.freeze({MP4Audio, WebMAudio, boxes, opusDuration});
})();
